import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const LOCAL_MYSQL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const ISOLATED_DATABASE = "pinche_d42_test";
const SMOKE_OBJECT_BYTE_SIZE = 4096;
const BARRIER_TIMEOUT_MS = 10_000;

export function assertD42SmokeIsolation(env) {
  const source = env || {};
  const failures = [];
  if (source.NODE_ENV === "production") {
    failures.push("NODE_ENV must not be production");
  }
  if (source.WECHAT_MOCK_LOGIN !== "true") {
    failures.push("WECHAT_MOCK_LOGIN must equal true");
  }
  if (source.D42_SMOKE_ISOLATED !== "1") {
    failures.push("D42_SMOKE_ISOLATED must equal 1");
  }
  if (!LOCAL_MYSQL_HOSTS.has(String(source.MYSQL_HOST || "").trim().toLowerCase())) {
    failures.push("MYSQL_HOST must be localhost, 127.0.0.1, or ::1");
  }
  if (source.MYSQL_DATABASE !== ISOLATED_DATABASE) {
    failures.push(`MYSQL_DATABASE must equal ${ISOLATED_DATABASE}`);
  }
  if (failures.length > 0) {
    throw new Error(`D42 smoke isolation rejected before imports/API/database: ${failures.join("; ")}`);
  }
  return true;
}

function fixturePrefix() {
  return `d42-smoke-${Date.now()}-${randomBytes(6).toString("hex")}`;
}

function fixtureSourceUrl(sessionId, userId, prefix, sequence) {
  const serial = Date.now() + sequence;
  const suffix = createHash("sha256")
    .update(`${prefix}:${sessionId}:${userId}:${sequence}`)
    .digest("hex")
    .slice(0, 16);
  return `/uploads/session-album/videos/source/admin-video-${sessionId}-${userId}-${serial}-${suffix}.mp4`;
}

function smokeUser(userId) {
  return {
    user: { id: Number(userId) },
    roles: ["system_admin"]
  };
}

function assertLoadedDatabaseIsIsolated(config) {
  const actualHost = String(config?.mysql?.host || "").trim().toLowerCase();
  const actualDatabase = config?.mysql?.database;
  if (!LOCAL_MYSQL_HOSTS.has(actualHost) || actualDatabase !== ISOLATED_DATABASE) {
    throw new Error(
      `D42 smoke isolation rejected loaded database target: host=${actualHost || "(empty)"} database=${actualDatabase || "(empty)"}`
    );
  }
}

function createTwoPartyBarrier(timeoutMs = BARRIER_TIMEOUT_MS) {
  let arrived = 0;
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });

  return {
    get arrived() {
      return arrived;
    },
    async wait() {
      arrived += 1;
      if (arrived === 2) {
        release();
      }

      let timeout;
      try {
        await Promise.race([
          released,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("D42 concurrent create barrier timed out")),
              timeoutMs
            );
          })
        ]);
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function createConcurrentTransactionRunner(withTransaction) {
  const barrier = createTwoPartyBarrier();
  let initialEmptyLookups = 0;

  return {
    get initialEmptyLookups() {
      return initialEmptyLookups;
    },
    withTransaction: async (work) => {
      const result = await withTransaction(work);
      // createSessionAlbumVideo uses a null result only for its initial
      // idempotency lookup. Hold both real transactions after commit so both
      // inserts race against the same MySQL unique index.
      if (result === null && initialEmptyLookups < 2) {
        initialEmptyLookups += 1;
        await barrier.wait();
      }
      return result;
    }
  };
}

async function loadD42SmokeDependencies() {
  const [migration, mysql, service, lifecycle, environment] = await Promise.all([
    import("../apps/api/src/db/migrate.js"),
    import("../apps/api/src/db/mysql.js"),
    import("../apps/api/src/modules/core/service.js"),
    import("../apps/api/src/modules/album-video/lifecycle.js"),
    import("../apps/api/src/config/env.js")
  ]);
  return {
    runMigrations: migration.runMigrations,
    createDatabaseConnection: mysql.createDatabaseConnection,
    withTransaction: mysql.withTransaction,
    createSessionAlbumVideo: service.createSessionAlbumVideo,
    prepareSessionAlbumPhotoDeletion: service.prepareSessionAlbumPhotoDeletion,
    finalizeSessionAlbumPhotoDeletion: service.finalizeSessionAlbumPhotoDeletion,
    cleanupAlbumVideoBeforeDelete: lifecycle.cleanupAlbumVideoBeforeDelete,
    config: environment.config
  };
}

async function createFixture(connection, fixture) {
  const [userResult] = await connection.query(
    "INSERT INTO users (open_id, nickname) VALUES (?, ?)",
    [`${fixture.prefix}-openid`, "D42 album video smoke"]
  );
  fixture.userId = Number(userResult.insertId);
  await connection.query(
    "INSERT INTO user_roles (user_id, role, status) VALUES (?, 'system_admin', 'active')",
    [fixture.userId]
  );

  const [storeResult] = await connection.query(
    `
      INSERT INTO stores (name, city, district, address, status, claim_status)
      VALUES (?, '北京', '朝阳', 'D42 isolated smoke fixture', 'active', 'unclaimed')
    `,
    [`${fixture.prefix}-store`]
  );
  fixture.storeId = Number(storeResult.insertId);

  const [scriptResult] = await connection.query(
    `
      INSERT INTO scripts
        (name, type_tags, player_count, summary_no_spoiler, status, claim_status)
      VALUES (?, '["D42"]', 2, 'D42 isolated album-video smoke fixture', 'active', 'unclaimed')
    `,
    [`${fixture.prefix}-script`]
  );
  fixture.scriptId = Number(scriptResult.insertId);

  const [sessionResult] = await connection.query(
    `
      INSERT INTO sessions
        (
          organizer_user_id, script_id, script_name_snapshot, store_id,
          store_name_snapshot, start_at, status, visibility,
          join_policy, join_phone_required, npc_join_enabled
        )
      VALUES (?, ?, ?, ?, ?, DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE),
        'recruiting', 'share_only', 'review_required', 0, 1)
    `,
    [
      fixture.userId,
      fixture.scriptId,
      `${fixture.prefix}-script`,
      fixture.storeId,
      `${fixture.prefix}-store`
    ]
  );
  fixture.sessionId = Number(sessionResult.insertId);
}

async function fixtureRowCount(connection, table, idColumn, id) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count FROM ${table} WHERE ${idColumn} = ?`,
    [id]
  );
  return Number(rows[0]?.count || 0);
}

async function cleanupFixture(connection, fixture = {}) {
  // Fixture construction is deliberately incremental. Each branch is guarded
  // so a failed insert cannot leave an earlier user/store/script behind.
  if (fixture.sessionId) {
    await connection.query(
      `
        DELETE tag
        FROM session_album_photo_tags tag
        INNER JOIN session_album_photos photo ON photo.id = tag.photo_id
        WHERE photo.session_id = ?
      `,
      [fixture.sessionId]
    );
    await connection.query("DELETE FROM session_album_photos WHERE session_id = ?", [fixture.sessionId]);
    await connection.query("DELETE FROM session_album_privacy WHERE session_id = ?", [fixture.sessionId]);
    await connection.query("DELETE FROM session_npc_roles WHERE session_id = ?", [fixture.sessionId]);
    await connection.query("DELETE FROM session_seats WHERE session_id = ?", [fixture.sessionId]);
    await connection.query("DELETE FROM sessions WHERE id = ?", [fixture.sessionId]);
  }
  if (fixture.userId) {
    await connection.query("DELETE FROM user_roles WHERE user_id = ?", [fixture.userId]);
    await connection.query("DELETE FROM users WHERE id = ?", [fixture.userId]);
  }
  if (fixture.storeId) {
    await connection.query("DELETE FROM stores WHERE id = ?", [fixture.storeId]);
  }
  if (fixture.scriptId) {
    await connection.query("DELETE FROM scripts WHERE id = ?", [fixture.scriptId]);
  }
}

async function runConcurrentCreateScenario(dependencies, connection, fixture) {
  const user = smokeUser(fixture.userId);
  const sourceUrl = fixtureSourceUrl(fixture.sessionId, fixture.userId, fixture.prefix, 1);
  const transactionRunner = createConcurrentTransactionRunner(dependencies.withTransaction);
  let inspected = 0;
  const inspectObject = async (url) => {
    assert.equal(url, sourceUrl);
    inspected += 1;
    return { byteSize: SMOKE_OBJECT_BYTE_SIZE, contentType: "video/mp4" };
  };
  const body = {
    sourceUrl,
    durationSeconds: 12,
    videoWidth: 1280,
    videoHeight: 720
  };

  const [first, second] = await Promise.all([
    dependencies.createSessionAlbumVideo(user, fixture.sessionId, body, {
      inspectObject,
      withTransaction: transactionRunner.withTransaction
    }),
    dependencies.createSessionAlbumVideo(user, fixture.sessionId, body, {
      inspectObject,
      withTransaction: transactionRunner.withTransaction
    })
  ]);

  assert.equal(transactionRunner.initialEmptyLookups, 2, "both creates must observe the empty source before insert");
  assert.equal(inspected, 2, "each real create request must inspect the object");
  assert.equal(first.id, second.id, "concurrent creates must resolve to one media row");

  const [rows] = await connection.query(
    `
      SELECT id, source_url, video_byte_size, video_content_type
      FROM session_album_photos
      WHERE session_id = ? AND source_url = ? AND media_type = 'video' AND status = 'active'
    `,
    [fixture.sessionId, sourceUrl]
  );
  assert.equal(rows.length, 1, "MySQL unique source index must leave exactly one active video");
  assert.equal(Number(rows[0].id), Number(first.id));
  assert.equal(Number(rows[0].video_byte_size), SMOKE_OBJECT_BYTE_SIZE);
  assert.equal(rows[0].video_content_type, "video/mp4");
  return { user, mediaId: Number(first.id), sourceUrl };
}

async function runDeleteRetryScenario(dependencies, connection, fixture, created) {
  await connection.query(
    `
      INSERT INTO session_album_photo_tags (photo_id, tag_type, label, sort_order)
      VALUES (?, 'user', 'D42 smoke deletion tag', 0)
    `,
    [created.mediaId]
  );
  const prepared = await dependencies.prepareSessionAlbumPhotoDeletion(created.user, created.mediaId);
  assert.equal(prepared.media_type, "video");
  assert.deepEqual(prepared.object_urls, [created.sourceUrl]);

  let finalizeCalls = 0;
  await assert.rejects(
    dependencies.cleanupAlbumVideoBeforeDelete({
      urls: prepared.object_urls,
      deleteObject: async () => {
        throw Object.assign(new Error("D42 intentional object cleanup failure"), { statusCode: 503 });
      },
      finalizeSnapshot: async () => {
        finalizeCalls += 1;
        return { deleted: true };
      }
    }),
    (error) => Number(error?.statusCode) === 503
  );
  assert.equal(finalizeCalls, 0, "failed object cleanup must not delete the database retry anchor");
  assert.equal(await fixtureRowCount(connection, "session_album_photos", "id", created.mediaId), 1);
  assert.equal(await fixtureRowCount(connection, "session_album_photo_tags", "photo_id", created.mediaId), 1);

  const deletedUrls = [];
  const finalized = await dependencies.cleanupAlbumVideoBeforeDelete({
    urls: prepared.object_urls,
    deleteObject: async (url) => {
      deletedUrls.push(url);
    },
    finalizeSnapshot: (urls) => dependencies.finalizeSessionAlbumPhotoDeletion(
      created.user,
      created.mediaId,
      { object_urls: urls }
    )
  });
  assert.equal(finalized.deleted, true);
  assert.deepEqual(deletedUrls, [created.sourceUrl]);
  assert.equal(await fixtureRowCount(connection, "session_album_photos", "id", created.mediaId), 0);
  assert.equal(await fixtureRowCount(connection, "session_album_photo_tags", "photo_id", created.mediaId), 0);
}

export async function runD42AlbumVideoHardeningSmoke(options = {}) {
  const env = options.env || process.env;
  assertD42SmokeIsolation(env);
  // A caller can pass a fixture env only for the pre-import contract test; a
  // real run must still have the same safe values in process.env because API
  // modules read process.env while loading their database configuration.
  if (env !== process.env) {
    assertD42SmokeIsolation(process.env);
  }

  const dependencies = await (options.loadDependencies || loadD42SmokeDependencies)();
  assertLoadedDatabaseIsIsolated(dependencies.config);
  await dependencies.runMigrations();

  let connection;
  let fixture;
  let primaryError;
  try {
    connection = await dependencies.createDatabaseConnection();
    // Keep the mutable record in the outer scope before its first INSERT so
    // finally can clean every successfully created prefix row after a later
    // fixture step fails.
    fixture = { prefix: fixturePrefix() };
    await createFixture(connection, fixture);
    const created = await runConcurrentCreateScenario(dependencies, connection, fixture);
    await runDeleteRetryScenario(dependencies, connection, fixture, created);
    return {
      database: dependencies.config.mysql.database,
      concurrentCreates: 2,
      cleanupRetryVerified: true
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let cleanupError;
    if (connection) {
      try {
        await cleanupFixture(connection, fixture);
      } catch (error) {
        cleanupError = error;
      }
      try {
        await connection.end();
      } catch (error) {
        cleanupError ||= error;
      }
    }
    if (cleanupError) {
      if (primaryError) {
        primaryError.cleanupError = cleanupError;
      } else {
        throw cleanupError;
      }
    }
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  if (!process.argv.slice(2).includes("--run")) {
    console.log("D42 smoke skipped (pass --run with the isolated test environment to execute)");
  } else {
    runD42AlbumVideoHardeningSmoke()
      .then((result) => {
        console.log(
          `D42 isolated album-video smoke passed: ${result.concurrentCreates} concurrent creates, cleanup retry, database=${result.database}`
        );
      })
      .catch((error) => {
        console.error(error.stack || error.message);
        if (error.cleanupError) {
          console.error(`D42 fixture cleanup also failed: ${error.cleanupError.stack || error.cleanupError.message}`);
        }
        process.exitCode = 1;
      });
  }
}
