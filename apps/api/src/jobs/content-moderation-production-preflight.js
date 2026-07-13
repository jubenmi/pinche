#!/usr/bin/env node

import { buildWechatImageModerationUrl } from "../modules/album-image/signed-urls.js";
import { buildContentModerationConfig, config } from "../config/env.js";
import { createDatabaseConnection } from "../db/mysql.js";
import {
  assertProductionPreflightGuards,
  createProductionPreflightRunner,
  parseProductionPreflightCliArgs,
  runProductionPreflightCase
} from "../modules/content-moderation/production-preflight.js";
import {
  acquireProductionPreflightRun,
  findProductionPreflightAttemptByAssociation,
  finishProductionPreflightRun,
  recordProductionPreflightAssociation,
  releaseProductionPreflightLock
} from "../modules/content-moderation/production-preflight-repository.js";
import {
  createTencentProductionPreflightVideoModerationClient,
  createTencentVideoModerationTransport
} from "../modules/content-moderation/tencent-video-client.js";
import { createWechatContentSecurityClient } from "../modules/content-moderation/wechat-client.js";
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
    const connection = await createDatabaseConnection();
    try {
      const runner = createProductionPreflightRunnerFromRuntime({
        connection,
        moderationConfig,
        env
      });
      const runtime = await buildProductionPreflightRuntime({
        connection,
        moderationConfig,
        env
      });
      const result = await runProductionPreflightCase(runner, { caseId, runtime });
      stdout.write(JSON.stringify({ ok: true, caseId, runId: result.runId, state: result.state }) + "\n");
      return result;
    } finally {
      await connection.end();
    }
  } catch (error) {
    stderr.write(JSON.stringify({ ok: false, error: String(error.message || error) }) + "\n");
    exit(1);
  }
}

export function createProductionPreflightRunnerFromRuntime({ connection, moderationConfig }) {
  const tencentTransport = createTencentVideoModerationTransport({
    config: moderationConfig
  });
  return createProductionPreflightRunner({
    hmacKey: moderationConfig.productionPreflight.referenceHmacKey,
    guards: assertProductionPreflightGuards,
    repository: bindProductionPreflightRepository(connection),
    userRepository: {
      getOpenIdForUserId: (userId) => getOpenIdForUserId(connection, userId)
    },
    wechatClient: createWechatContentSecurityClient(),
    tencentVideoClient: createTencentProductionPreflightVideoModerationClient({
      config: moderationConfig,
      transport: {
        submitVideo: (input) => tencentTransport({
          kind: "video",
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
    finishRun: (input) => finishProductionPreflightRun({ connection, ...input }),
    releaseLock: (input) => releaseProductionPreflightLock({ connection, ...input })
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
