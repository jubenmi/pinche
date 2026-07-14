import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const scriptPath = path.join(repoRoot, "scripts/d45-content-moderation-live-contract.js");
const d45TasksPath = path.join(repoRoot, "specs/d45-hybrid-content-moderation/tasks.md");
const policyId = "d45.live-contract.preflight.v1";
const isolatedApiBaseUrl = "https://d45-content-moderation-staging.invalid/contract";
const harmlessSamplePairs = [
  ["d45-safe-text-001", "wechat-text-pass"],
  ["d45-safe-image-001", "wechat-image-pass"],
  ["d45-safe-video-001", "tencent-video-pass"]
];
const credentialCanaries = {
  WECHAT_APP_SECRET: "canary-wechat-app-secret",
  WECHAT_CONTENT_SECURITY_EVENT_TOKEN: "canary-wechat-event-token",
  COS_SECRET_KEY: "canary-cos-secret-key",
  TENCENT_CI_VIDEO_CALLBACK_TOKEN: "canary-tencent-callback-token"
};
const expectedLiveContractSource = [
  "/* D45 offline contract: source-locked, dependency-free preflight. */",
  "const POLICY_ID = \"d45.live-contract.preflight.v1\";",
  "const ISOLATED_API_BASE_URL = \"https://d45-content-moderation-staging.invalid/contract\";",
  "",
  "const ALLOWED_LIVE_ENVIRONMENT_KEYS = new Set([",
  "  \"D45_LIVE_CONTRACT\",",
  "  \"D45_LIVE_CONTRACT_CONFIRM\",",
  "  \"D45_LIVE_API_BASE_URL\",",
  "  \"D45_LIVE_SAFE_SAMPLE_ID\",",
  "  \"D45_LIVE_SAFE_SAMPLE_NAME\"",
  "]);",
  "",
  "const HARMLESS_SAMPLE_PAIRS = new Set([",
  "  \"d45-safe-text-001\\u0000wechat-text-pass\",",
  "  \"d45-safe-image-001\\u0000wechat-image-pass\",",
  "  \"d45-safe-video-001\\u0000tencent-video-pass\"",
  "]);",
  "",
  "function isApprovedPreflight(environment) {",
  "  const hasUnsupportedLiveInput = Object.keys(environment).some((key) =>",
  "    key.startsWith(\"D45_LIVE_\") && !ALLOWED_LIVE_ENVIRONMENT_KEYS.has(key)",
  "  );",
  "  if (hasUnsupportedLiveInput) return false;",
  "  if (environment.D45_LIVE_CONTRACT !== \"staging\") return false;",
  "  if (environment.D45_LIVE_CONTRACT_CONFIRM !== \"run\") return false;",
  "  if (environment.D45_LIVE_API_BASE_URL !== ISOLATED_API_BASE_URL) return false;",
  "",
  "  const samplePair = `${environment.D45_LIVE_SAFE_SAMPLE_ID}\\u0000${environment.D45_LIVE_SAFE_SAMPLE_NAME}`;",
  "  return HARMLESS_SAMPLE_PAIRS.has(samplePair);",
  "}",
  "",
  "function main() {",
  "  const startedAt = Date.now();",
  "  let approved = false;",
  "",
  "  try {",
  "    approved = isApprovedPreflight(process.env);",
  "  } catch {",
  "    approved = false;",
  "  }",
  "",
  "  console.log(JSON.stringify({",
  "    policy_id: POLICY_ID,",
  "    outcome: approved ? \"dry_run_deferred\" : \"rejected\",",
  "    elapsed_ms: Math.max(0, Date.now() - startedAt)",
  "  }));",
  "  process.exitCode = approved ? 0 : 1;",
  "}",
  "",
  "main();"
].join("\n") + "\n";

function stagingEnvironment(overrides = {}) {
  const [sampleId, sampleName] = harmlessSamplePairs[0];
  return {
    D45_LIVE_CONTRACT: "staging",
    D45_LIVE_CONTRACT_CONFIRM: "run",
    D45_LIVE_API_BASE_URL: isolatedApiBaseUrl,
    D45_LIVE_SAFE_SAMPLE_ID: sampleId,
    D45_LIVE_SAFE_SAMPLE_NAME: sampleName,
    ...overrides
  };
}

function runLiveContract(environment = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      ...environment
    },
    timeout: 5_000
  });
}

function readAuditText(stdout, stderr) {
  assert.equal(stderr, "");
  assert.equal(stdout.endsWith("\n"), true);
  const json = stdout.slice(0, -1);
  assert.match(json, /^\{[^\r\n]*\}$/);
  assert.equal(json, json.trim());
  return JSON.parse(json);
}

function assertAuditRecord(result, { status, outcome, inputValues = [] }) {
  assert.equal(result.status, status);
  for (const value of inputValues) {
    assert.equal(result.stdout.includes(value), false, "stdout must not contain input values");
    assert.equal(result.stderr.includes(value), false, "stderr must not contain input values");
  }

  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  const record = readAuditText(result.stdout, result.stderr);
  assert.deepEqual(Object.keys(record).sort(), ["elapsed_ms", "outcome", "policy_id"]);
  assert.equal(record.policy_id, policyId);
  assert.equal(record.outcome, outcome);
  assert.equal(Number.isInteger(record.elapsed_ms), true);
  assert.ok(record.elapsed_ms >= 0);
}

function assertRejected(environment, inputValues = []) {
  assertAuditRecord(runLiveContract(environment), {
    status: 1,
    outcome: "rejected",
    inputValues
  });
}

test("defaults to one redacted JSON audit line without an explicit staging opt-in", () => {
  assertAuditRecord(runLiveContract(), {
    status: 1,
    outcome: "rejected"
  });
});

test("requires the literal staging contract and run confirmation", () => {
  const missingConfirmation = stagingEnvironment();
  delete missingConfirmation.D45_LIVE_CONTRACT_CONFIRM;
  assertRejected(missingConfirmation, [isolatedApiBaseUrl]);

  const wrongConfirmation = "confirm";
  assertRejected(stagingEnvironment({ D45_LIVE_CONTRACT_CONFIRM: wrongConfirmation }), [wrongConfirmation]);

  const nonStaging = "production";
  assertRejected(stagingEnvironment({ D45_LIVE_CONTRACT: nonStaging }), [nonStaging]);
});

test("requires an exact nonempty target URL, sample ID, and sample name", () => {
  for (const key of [
    "D45_LIVE_API_BASE_URL",
    "D45_LIVE_SAFE_SAMPLE_ID",
    "D45_LIVE_SAFE_SAMPLE_NAME"
  ]) {
    const environment = stagingEnvironment();
    delete environment[key];
    assertRejected(environment);
  }
});

test("rejects every API URL outside the compiled isolated .invalid target", () => {
  const disallowedUrls = [
    "https://staging.example.invalid/contract",
    "https://user:password@d45-content-moderation-staging.invalid/contract",
    "https://d45-content-moderation-staging.invalid/contract?signature=reusable-value",
    "https://d45-content-moderation-staging.invalid/contract#fragment",
    "https://d45-content-moderation-staging.invalid/contract/extra"
  ];

  for (const url of disallowedUrls) {
    assertRejected(stagingEnvironment({ D45_LIVE_API_BASE_URL: url }), [url]);
  }
});

test("rejects case, whitespace, port, and path variants of the target and paired sample references", () => {
  const variants = [
    { D45_LIVE_API_BASE_URL: "https://D45-content-moderation-staging.invalid/contract" },
    { D45_LIVE_API_BASE_URL: ` ${isolatedApiBaseUrl}` },
    { D45_LIVE_API_BASE_URL: `${isolatedApiBaseUrl} ` },
    { D45_LIVE_API_BASE_URL: "https://d45-content-moderation-staging.invalid:443/contract" },
    { D45_LIVE_API_BASE_URL: "https://d45-content-moderation-staging.invalid/Contract" },
    { D45_LIVE_SAFE_SAMPLE_ID: "D45-safe-text-001" },
    { D45_LIVE_SAFE_SAMPLE_ID: "d45-safe-text-001 " },
    { D45_LIVE_SAFE_SAMPLE_NAME: "Wechat-text-pass" },
    { D45_LIVE_SAFE_SAMPLE_NAME: " wechat-text-pass" }
  ];

  for (const overrides of variants) {
    assertRejected(stagingEnvironment(overrides), Object.values(overrides));
  }
});

test("rejects unsafe, malformed, unreviewed, and mismatched sample references", () => {
  const cases = [
    {
      D45_LIVE_SAFE_SAMPLE_ID: "d45-safe-extra-001",
      D45_LIVE_SAFE_SAMPLE_NAME: "wechat-text-pass"
    },
    {
      D45_LIVE_SAFE_SAMPLE_ID: "d45-safe-text-001",
      D45_LIVE_SAFE_SAMPLE_NAME: "unsafe/sample-name"
    },
    {
      D45_LIVE_SAFE_SAMPLE_ID: "d45-safe-text-001",
      D45_LIVE_SAFE_SAMPLE_NAME: "wechat-image-pass"
    }
  ];

  for (const overrides of cases) {
    assertRejected(stagingEnvironment(overrides), Object.values(overrides));
  }
});

test("rejects forbidden and generic unknown D45 live inputs without exposing their values", () => {
  const forbiddenInputs = {
    D45_LIVE_SAMPLE_BODY: "forbidden-body-value",
    D45_LIVE_SAMPLE_OBJECT_KEY: "forbidden-object-key",
    D45_LIVE_SAMPLE_SIGNED_URL: "https://signed.example.invalid/forbidden-url",
    D45_LIVE_TOKEN: "forbidden-token-value",
    D45_LIVE_OPENID: "forbidden-openid-value",
    D45_LIVE_FUTURE_OPTION: "unreviewed-option"
  };

  for (const [name, value] of Object.entries(forbiddenInputs)) {
    assertRejected(stagingEnvironment({ [name]: value }), [value]);
  }
});

test("permits only the compiled isolated target and its paired harmless sample references", () => {
  for (const [sampleId, sampleName] of harmlessSamplePairs) {
    const result = runLiveContract(stagingEnvironment({
      D45_LIVE_SAFE_SAMPLE_ID: sampleId,
      D45_LIVE_SAFE_SAMPLE_NAME: sampleName
    }));
    assertAuditRecord(result, {
      status: 0,
      outcome: "dry_run_deferred",
      inputValues: [isolatedApiBaseUrl, sampleId, sampleName]
    });
  }
});

test("CLI dry-run never emits unrelated credential canaries", () => {
  const result = runLiveContract(stagingEnvironment(credentialCanaries));
  assertAuditRecord(result, {
    status: 0,
    outcome: "dry_run_deferred",
    inputValues: Object.values(credentialCanaries)
  });
});

test("D45.18 only allows specifically evidenced non-preflight milestones", () => {
  const taskCard = readFileSync(d45TasksPath, "utf8");
  const sectionStart = taskCard.search(
    /^- \[[ x]\] D45\.18 执行生产受控预演与完整放行验证。$/m
  );
  assert.notEqual(sectionStart, -1);
  const sectionEnd = taskCard.indexOf("\n## ", sectionStart);
  const section = taskCard.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd);
  const checklistLines = section.match(/^\s*- \[[ x]\] .+$/gm) ?? [];
  const checklistItems = checklistLines.map((line) => {
    const parsed = line.match(/^\s*- \[([ x])\] (.+)$/);
    assert.notEqual(parsed, null, `failed to parse D45.18 checklist line: ${line}`);
    const [, mark, text] = parsed;
    return { mark, text };
  });
  const recordedMilestoneTexts = [
    "复核 requirements v1.3、design v1.3、tasks v1.2 与生产手册中的 GET/POST 协议边界；2026-07-14 用户已确认该版 spec，可以进入 TDD 实施。",
    "先补失败测试，再覆盖微信官方示例、伪造/缺失 `signature`、精确回显不裁剪，以及仅携带 `msg_signature` 与加密 `echostr` 的首版错误协议必须被拒绝；静态路由检查须区分 GET 的 `signature` 与 POST 的 `msg_signature`。",
    "按 develop → main → publish 顺序逐级完成 CI，记录三分支提交、Actions run 与发布镜像摘要；任一级失败立即停止。",
    "微信后台以安全模式与 JSON 数据格式真实保存成功，官方 GET 验证通过且配置持久化；脱敏确认未写入审核、媒体或预演状态。"
  ];

  for (const recordedMilestoneText of recordedMilestoneTexts) {
    const matchingItems = checklistItems.filter(({ text }) => text === recordedMilestoneText);
    assert.equal(
      matchingItems.length,
      1,
      `expected exactly one D45.18 recorded milestone: ${recordedMilestoneText}`
    );
  }

  const recordedMilestoneTextSet = new Set(recordedMilestoneTexts);
  const liveChecklistItems = checklistItems.filter(
    ({ text }) => !recordedMilestoneTextSet.has(text)
  );
  const expectedLiveChecklistTexts = [
    "D45.18 执行生产受控预演与完整放行验证。",
    "D45.18A 实现并验证生产受控预演（有限验证）。",
    "新增默认关闭的一次性 API 容器 Job；仅在生产、精确确认、指定有效 `system_admin`、完整 provider 配置和三个 intake 均为 `closed` 时运行；不新增 HTTP 路由或后台入口。",
    "新增隔离预演运行/尝试存储、单活动运行与 15 分钟人工限频；只保存不可逆 provider 关联摘要和最小审计，不复用用户审核、文本提案、媒体、普通重试或通知。",
    "使用代码白名单无害 case：文本以专用测试管理员 openid 调用微信；图片/视频使用专用私有 COS 前缀和严格白名单；调用方不能提供正文、openid、对象 Key、URL、回调地址或 provider 参数。",
    "微信/腾讯回调先解析预演关联，只更新预演状态；重复/迟到事件幂等，未命中保持现有用户回调链；任何结果不得调用用户状态机或签发用户 URL。",
    "为同一路由补齐微信官方 GET URL 验证；以 `signature` 对 Token、timestamp、nonce 的三参数 SHA-1 结果验签并原样回显明文 `echostr`，GET 不读取或使用 `msg_signature`、AESKey、AppID、`encrypt_type` 或 body；无效验证无副作用且不泄漏请求参数或密钥。",
    "经当次确认仅替换 `pinche-api-1`，核对不可变镜像摘要、`/health`、`/health/db` 和三个 intake 仍为 `closed`；其他容器不得重启或改动。",
    "依次验证文本、图片、视频无害 `Pass`、鉴权、私有对象抓取、回调认证与清理；完成/失败/超时均核验预演对象删除，且所有门禁仍为 `closed`。",
    "新增预演单测、回调隔离/重复测试、门禁/配置/日志脱敏检查与生产手册；记录仅含 case、服务商、结果类别、耗时、配置/镜像指纹和清理结论。",
    "D45.18B 完整结果与故障放行验证（不由生产预演替代）。",
    "以假客户端、签名回放或服务商正式支持的隔离能力验证微信/腾讯 `Review`/`Block`/`Error`、超时、权限、额度、重复/过期回调和拒绝后清理；不得在生产发送违规样本或故意破坏生产凭证。",
    "只有 D45.18A 与本项均完成、独立放行审批通过且观察指标满足条件后，才可另行讨论将任一 intake 切为 `moderated`；本任务不执行该切换。"
  ];

  assert.deepEqual(
    liveChecklistItems.map(({ text }) => text).sort(),
    [...expectedLiveChecklistTexts].sort(),
    "D45.18 live checklist texts must match the exact reviewed set"
  );
  for (const { mark, text } of liveChecklistItems) {
    assert.equal(mark, " ", `D45.18 live checklist item must remain unchecked: ${text}`);
  }
});

test("contract source stays an exact offline, dependency-free preflight", () => {
  const source = readFileSync(scriptPath, "utf8");
  assert.equal(source, expectedLiveContractSource);
});
