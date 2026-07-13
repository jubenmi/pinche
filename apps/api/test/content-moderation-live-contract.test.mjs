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

test("D45.18 and every listed live-integration subtask remain unchecked", () => {
  const taskCard = readFileSync(d45TasksPath, "utf8");
  const sectionStart = taskCard.indexOf("- [ ] D45.18 执行非生产真实联调。");
  assert.notEqual(sectionStart, -1);
  const sectionEnd = taskCard.indexOf("\n## ", sectionStart);
  const section = taskCard.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd);
  const checklistLines = section.match(/^(?:- |  - )\[[ x]\] .+$/gm) ?? [];

  assert.equal(checklistLines.length, 7);
  for (const line of checklistLines) {
    assert.match(line, /\[ \]/);
  }
});

test("contract source stays an exact offline, dependency-free preflight", () => {
  const source = readFileSync(scriptPath, "utf8");
  assert.equal(source, expectedLiveContractSource);
});
