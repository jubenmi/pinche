import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";
import { createClient as createRedisClient } from "redis";

const EXPECTED_DATABASE = "pinche_d51_test";
const EXPECTED_MYSQL_HOST = "mysql";
const EXPECTED_API_BASE_URL = "http://api:3018";

function targetError() {
  return Object.assign(new Error("D51 integration target is not the isolated Compose fixture"), {
    code: "D51_INTEGRATION_TARGET_INVALID",
  });
}

export function assertD51IntegrationEnvironment(env = process.env) {
  const apiBaseUrl = String(env.D51_API_BASE_URL || "").replace(/\/$/, "");
  const database = String(env.MYSQL_DATABASE || "");
  const mysqlHost = String(env.MYSQL_HOST || "");
  if (
    env.D51_INTEGRATION_ISOLATED !== "1"
    || String(env.NODE_ENV || "").toLowerCase() === "production"
    || String(env.WECHAT_MOCK_LOGIN || "").toLowerCase() !== "true"
    || database !== EXPECTED_DATABASE
    || mysqlHost !== EXPECTED_MYSQL_HOST
    || apiBaseUrl !== EXPECTED_API_BASE_URL
  ) {
    throw targetError();
  }
  return { apiBaseUrl, database, mysqlHost };
}

function assertCondition(condition, message) {
  if (!condition) {
    throw Object.assign(new Error(message), { code: "D51_INTEGRATION_ASSERTION_FAILED" });
  }
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw Object.assign(new Error(`D51 integration received non-JSON HTTP ${response.status}`), {
      code: "D51_INTEGRATION_HTTP_INVALID",
    });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`D51 integration HTTP request failed with ${response.status}`), {
      code: "D51_INTEGRATION_HTTP_FAILED",
      status: response.status,
    });
  }
  return body;
}

async function fixtureCounts(connection, { openId, userId = 0 }) {
  const [[users]] = await connection.query(
    "SELECT COUNT(*) AS count FROM users WHERE open_id = ?",
    [openId],
  );
  const [[identities]] = await connection.query(
    "SELECT COUNT(*) AS count FROM wechat_identities WHERE open_id = ? OR user_id = ?",
    [openId, userId],
  );
  const [[roles]] = await connection.query(
    "SELECT COUNT(*) AS count FROM user_roles WHERE user_id = ?",
    [userId],
  );
  return {
    users: Number(users.count),
    wechatIdentities: Number(identities.count),
    userRoles: Number(roles.count),
  };
}

async function cleanupFixture(connection, { openId, userId = 0 }) {
  const ids = new Set();
  if (Number.isSafeInteger(userId) && userId > 0) ids.add(userId);
  const [rows] = await connection.query(
    "SELECT id FROM users WHERE open_id = ? FOR UPDATE",
    [openId],
  );
  for (const row of rows) ids.add(Number(row.id));

  for (const id of ids) {
    await connection.query("DELETE FROM wechat_identities WHERE user_id = ?", [id]);
    await connection.query("DELETE FROM user_roles WHERE user_id = ?", [id]);
    await connection.query("DELETE FROM users WHERE id = ? AND open_id = ?", [id, openId]);
  }
}

export async function runD51IntegrationSmoke(env = process.env) {
  const target = assertD51IntegrationEnvironment(env);
  const fixture = {
    openId: `dev-d51-${crypto.randomUUID()}`,
    userId: 0,
  };
  const connection = await mysql.createConnection({
    host: target.mysqlHost,
    port: Number(env.MYSQL_PORT || 3306),
    database: target.database,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    timezone: "Z",
  });
  const redis = createRedisClient({ url: env.REDIS_URL || "redis://redis:6379/15" });
  let primaryError;
  let beforeCleanup = null;
  let afterCleanup = null;
  let migrationHistory = null;

  try {
    await redis.connect();
    assertCondition(await redis.ping() === "PONG", "Redis fixture did not answer PING");

    const health = await requestJson(target.apiBaseUrl, "/health");
    assertCondition(health?.ok === true, "API health is not ready");
    assertCondition(health?.database?.connected === true, "API database is not connected");
    assertCondition(health?.database?.schemaReady === true, "API schema is not ready");

    const databaseHealth = await requestJson(target.apiBaseUrl, "/health/db");
    assertCondition(databaseHealth?.ok === true, "database health is not ready");

    const [[history]] = await connection.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT version) AS distinct_versions,
        SUM(checksum_sha256 IS NULL) AS missing_checksums
      FROM schema_migrations
    `);
    migrationHistory = {
      total: Number(history.total),
      distinctVersions: Number(history.distinct_versions),
      missingChecksums: Number(history.missing_checksums),
    };
    assertCondition(migrationHistory.total >= 38, "migration history is incomplete");
    assertCondition(
      migrationHistory.distinctVersions === migrationHistory.total,
      "migration history contains duplicate versions",
    );
    assertCondition(migrationHistory.missingChecksums === 0, "migration checksum history is incomplete");

    const stores = await requestJson(target.apiBaseUrl, "/api/stores");
    assertCondition(Array.isArray(stores?.data), "public catalog response is not an array");

    const login = await requestJson(target.apiBaseUrl, "/api/auth/wechat/login", {
      method: "POST",
      body: JSON.stringify({ code: fixture.openId }),
    });
    fixture.userId = Number(login?.data?.user?.id);
    const token = String(login?.data?.token || "");
    assertCondition(Number.isSafeInteger(fixture.userId) && fixture.userId > 0, "mock login has no user");
    assertCondition(login?.data?.mocked === true && token.length > 20, "mock login contract changed");

    const me = await requestJson(target.apiBaseUrl, "/api/users/me", {
      headers: { authorization: `Bearer ${token}` },
    });
    assertCondition(Number(me?.data?.user?.id) === fixture.userId, "authenticated read lost identity");
    beforeCleanup = await fixtureCounts(connection, fixture);
    assertCondition(beforeCleanup.users === 1, "mock login did not persist exactly one fixture user");
    assertCondition(beforeCleanup.wechatIdentities === 1, "mock login identity count changed");
    assertCondition(beforeCleanup.userRoles >= 1, "mock login role was not persisted");
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await connection.beginTransaction();
      await cleanupFixture(connection, fixture);
      await connection.commit();
      afterCleanup = await fixtureCounts(connection, fixture);
      assertCondition(
        Object.values(afterCleanup).every((count) => count === 0),
        "D51 integration fixture cleanup left residue",
      );
    } catch (cleanupError) {
      await connection.rollback().catch(() => {});
      if (primaryError) primaryError.cleanupError = cleanupError;
      else primaryError = cleanupError;
    }
    await Promise.allSettled([
      connection.end(),
      redis.isOpen ? redis.quit() : Promise.resolve(),
    ]);
  }

  if (primaryError) throw primaryError;
  return { ok: true, migrationHistory, beforeCleanup, afterCleanup };
}

function isMain() {
  return Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isMain()) {
  runD51IntegrationSmoke()
    .then((result) => {
      process.stdout.write(`${JSON.stringify({ event: "d51_integration_passed", ...result })}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({
        event: "d51_integration_failed",
        code: String(error?.code || "D51_INTEGRATION_FAILED").slice(0, 80),
        cleanupCode: error?.cleanupError?.code
          ? String(error.cleanupError.code).slice(0, 80)
          : undefined,
      })}\n`);
      process.exitCode = 1;
    });
}
