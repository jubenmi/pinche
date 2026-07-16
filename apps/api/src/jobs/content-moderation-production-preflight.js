#!/usr/bin/env node

import { buildWechatImageModerationUrl } from "../modules/album-image/signed-urls.js";
import { buildContentModerationConfig, buildRedisUrl, config } from "../config/env.js";
import { createDatabaseConnection } from "../db/mysql.js";
import {
  assertProductionPreflightGuards,
  createProductionPreflightRunner,
  parseProductionPreflightCliArgs,
  runProductionPreflightCase
} from "../modules/content-moderation/production-preflight.js";
import {
  acquireProductionPreflightRun,
  finalizeProductionPreflightRun,
  findProductionPreflightAttemptByAssociation,
  markProductionPreflightRunAwaitingCallback,
  markProductionPreflightRunSubmitting,
  recordProductionPreflightAssociation
} from "../modules/content-moderation/production-preflight-repository.js";
import {
  createTencentProductionPreflightVideoModerationClient,
  createTencentProductionPreflightVideoModerationTransport
} from "../modules/content-moderation/tencent-video-client.js";
import { emitContentModerationEvent } from "../modules/content-moderation/telemetry.js";
import { createWechatContentSecurityClient } from "../modules/content-moderation/wechat-client.js";
import {
  createDefaultRedisClientResolver,
  createWechatAccessTokenProvider
} from "../modules/wechat/access-token.js";
import { deleteCosObject, headCosObject, putCosObject } from "../storage/cos.js";

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  exit = process.exit
} = {}) {
  try {
    const { caseId } = parseProductionPreflightCliArgs(argv);
    const moderationConfig = buildContentModerationConfig(env);
    return await runProductionPreflightJob({ caseId, moderationConfig, env, stdout });
  } catch (error) {
    stderr.write(JSON.stringify({
      ok: false,
      code: "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_JOB_FAILED"
    }) + "\n");
    exit(1);
  }
}

export async function runProductionPreflightJob({
  caseId,
  moderationConfig,
  env = process.env,
  stdout = process.stdout,
  createConnection = createDatabaseConnection,
  createRunner = createProductionPreflightRunnerFromRuntime,
  buildRuntime = buildProductionPreflightRuntime,
  runCase = runProductionPreflightCase,
  createWechatClientScope = createProductionPreflightWechatClientScope
} = {}) {
  const connection = await createConnection();
  let disposeWechatClient = () => undefined;
  try {
    const wechatClientScope = createWechatClientScope({ moderationConfig, env });
    disposeWechatClient = wechatClientScope.dispose;
    const runner = createRunner({
      connection,
      moderationConfig,
      env,
      wechatClient: wechatClientScope.wechatClient
    });
    const runtime = await buildRuntime({ connection, moderationConfig, env });
    const result = await runCase(runner, { caseId, runtime });
    stdout.write(JSON.stringify({ ok: true, caseId, runId: result.runId, state: result.state }) + "\n");
    return result;
  } finally {
    try {
      await connection.end();
    } finally {
      await disposeWechatClient();
    }
  }
}

export function createProductionPreflightWechatClientScope({
  moderationConfig,
  env = process.env,
  createRedisResolver = createDefaultRedisClientResolver,
  createTokenProvider = createWechatAccessTokenProvider,
  createWechatClient = createWechatContentSecurityClient
} = {}) {
  const redisResolver = createRedisResolver({
    enabled: () => Boolean(moderationConfig?.redisEnabled),
    url: () => buildRedisUrl(env)
  });
  const tokenProvider = createTokenProvider({
    appId: moderationConfig?.wechatAppId,
    appSecret: moderationConfig?.wechatAppSecret,
    getRedis: redisResolver,
    resetRedis: redisResolver.reset
  });
  return {
    wechatClient: createWechatClient({ tokenProvider }),
    dispose: () => redisResolver.reset()
  };
}

export function createProductionPreflightRunnerFromRuntime({
  connection,
  moderationConfig,
  env = process.env,
  fetchImpl,
  wechatClient
}) {
  const tencentTransport = createTencentProductionPreflightVideoModerationTransport({
    config: moderationConfig,
    ...(typeof fetchImpl === "function" ? { fetchImpl } : {})
  });
  return createProductionPreflightRunner({
    hmacKey: moderationConfig.productionPreflight.referenceHmacKey,
    guards: assertProductionPreflightGuards,
    refreshRuntime: () => buildProductionPreflightRuntime({
      connection,
      moderationConfig,
      env
    }),
    repository: bindProductionPreflightRepository(connection),
    userRepository: {
      getOpenIdForUserId: (userId) => getOpenIdForUserId(connection, userId)
    },
    wechatClient: wechatClient || createWechatContentSecurityClient(),
    tencentVideoClient: createTencentProductionPreflightVideoModerationClient({
      config: moderationConfig,
      transport: {
        submitVideo: (input) => tencentTransport({
          kind: "video",
          runId: input.runId,
          policyId: moderationConfig.tencentVideoPolicyId,
          dataId: input.dataId,
          objectKey: input.objectKey,
          region: moderationConfig.tencentVideoRegion,
          bucket: moderationConfig.bucket,
          callbackUrl: moderationConfig.tencentVideoCallbackUrl
        })
      }
    }),
    cos: {
      putObject: ({ key, body, forbidOverwrite }) =>
        putCosObject({ key, body, forbidOverwrite, config: config.cos }),
      buildSignedUrl: (objectKey) =>
        buildWechatImageModerationUrl({
          objectKey,
          nowSeconds: Math.floor(Date.now() / 1000),
          config: config.cos
        }),
      deleteObject: (key) => deleteCosObject({ key, config: config.cos }),
      headObject: (key) => headCosObject({ key, config: config.cos })
    },
    onCleanupFailure: () => emitContentModerationEvent("moderation_operational_alert", {
      outcome: "error",
      errorCode: "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CLEANUP_FAILED",
      priority: "high"
    }),
    clock: () => new Date()
  });
}

export async function buildProductionPreflightRuntime({ connection, moderationConfig, env }) {
  const operatorUserId = moderationConfig.productionPreflight.operatorUserId;
  const operatorStatus = await resolveOperatorStatus(connection, operatorUserId);
  return {
    nodeEnv: moderationConfig.nodeEnv,
    preflightEnabled: moderationConfig.productionPreflight.enabled,
    confirmation: env.D45_PREFLIGHT_CONFIRMATION || "",
    expectedConfirmation: moderationConfig.productionPreflight.confirmation,
    operatorUserId,
    testAdminUserId: moderationConfig.productionPreflight.testAdminUserId,
    operatorRole: "system_admin",
    operatorStatus,
    intakeModes: {
      text: moderationConfig.textIntakeMode,
      image: moderationConfig.imageIntakeMode,
      video: moderationConfig.videoIntakeMode
    },
    providerConfig: {
      wechatText: Boolean(moderationConfig.wechatTextEnabled && moderationConfig.wechatAppId && moderationConfig.wechatAppSecret),
      wechatImage: Boolean(moderationConfig.wechatImageEnabled && moderationConfig.wechatAppId && moderationConfig.wechatAppSecret),
      tencentVideo: Boolean(moderationConfig.tencentVideoEnabled && moderationConfig.tencentVideoPolicyId),
      cos: Boolean(moderationConfig.cosEnabled && moderationConfig.bucket && moderationConfig.cosRegion),
      redis: Boolean(moderationConfig.redisEnabled && (moderationConfig.redisUrl || moderationConfig.redisHost)),
      callback: Boolean(moderationConfig.tencentVideoCallbackToken || moderationConfig.wechatEventToken)
    },
    releaseFingerprint: moderationConfig.productionPreflight.releaseFingerprint,
    appId: moderationConfig.wechatAppId
  };
}

function bindProductionPreflightRepository(connection) {
  return {
    acquireRun: (input) => acquireProductionPreflightRun({ connection, ...input }),
    recordAssociation: (input) => recordProductionPreflightAssociation({ connection, ...input }),
    findAttemptByAssociation: (input) => findProductionPreflightAttemptByAssociation({ connection, ...input }),
    markSubmitting: (input) => markProductionPreflightRunSubmitting({ connection, ...input }),
    markAwaitingCallback: (input) => markProductionPreflightRunAwaitingCallback({ connection, ...input }),
    finalizeRun: (input) => finalizeProductionPreflightRun({ connection, ...input })
  };
}

async function getOpenIdForUserId(connection, userId) {
  const [rows] = await connection.query("SELECT open_id FROM users WHERE id = ? LIMIT 1", [Number(userId)]);
  return rows[0]?.open_id || "";
}

async function resolveOperatorStatus(connection, userId) {
  const [rows] = await connection.query(
    "SELECT role, status FROM user_roles WHERE user_id = ? AND role = 'system_admin' LIMIT 1",
    [Number(userId)]
  );
  const row = rows[0];
  return row?.role === "system_admin" && row?.status === "active" ? "active" : "missing";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
