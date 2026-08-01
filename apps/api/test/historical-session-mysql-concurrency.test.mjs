import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { assertD46IsolatedSmokeEnvironment } from "../src/modules/content-moderation/d46-isolated-smoke.js";

const explicitlyEnabled = process.argv.includes("--run");
const FIXTURE_LOCK_NAME = "pinche-historical-session-mysql-concurrency";
const START_AT = "2020-01-01 13:00:00";
const CANONICAL_START_AT = "2020-01-01T05:00:00.000Z";
const WAIT_PROBE_MS = 150;

if (!explicitlyEnabled) {
  test("historical-session real MySQL concurrency smoke", {
    skip: "pass --run with the strict D46 isolated environment"
  }, () => {});
} else {
  // Keep this before every dynamic import that can read API configuration or
  // open a database connection. A direct run may never inherit a normal DB.
  assertD46IsolatedSmokeEnvironment(process.env);

  const [
    { default: mysql },
    { runMigrations },
    { createDatabaseConnection },
    { createSessionWithConnection },
    { buildTextModerationDescriptor },
    {
      createProductionTextProposalHandlers,
      expectedTextCreationBase
    },
    { createTextProposalApplicator },
    {
      historicalSessionTextIdempotencyKey,
      textCreationTargetSubjectId,
      textOperationSubjectId
    }
  ] = await Promise.all([
    import("mysql2/promise"),
    import("../src/db/migrate.js"),
    import("../src/db/mysql.js"),
    import("../src/modules/core/service.js"),
    import("../src/modules/content-moderation/text-boundaries.js"),
    import("../src/modules/content-moderation/text-proposal-handlers.js"),
    import("../src/modules/content-moderation/text-proposal-applicator.js"),
    import("../src/modules/content-moderation/text-request-identity.js")
  ]);

  function historicalBody(fixture, historicalCreationKey, overrides = {}) {
    return {
      storeId: fixture.storeId,
      scriptId: fixture.scriptId,
      startAt: START_AT,
      sessionPurpose: "historical_record",
      historicalCreationKey,
      ...overrides
    };
  }

  function historicalCreationKeyHash(key) {
    return crypto.createHash("sha256").update(key, "utf8").digest("hex");
  }

  function historicalCreationPayloadHash(fixture, overrides = {}) {
    const payload = {
      storeId: fixture.storeId,
      scriptId: fixture.scriptId,
      startAt: CANONICAL_START_AT,
      sessionPurpose: "historical_record",
      dmUserId: null,
      dmNameSnapshot: null,
      npcUserId: null,
      npcNameSnapshot: null,
      depositAmount: 0,
      visibility: "share_only",
      joinPolicy: "review_required",
      joinPhoneRequired: 0,
      npcJoinEnabled: 0,
      note: null,
      pinnedMessageText: null,
      extraNpcRoles: [],
      ...overrides
    };
    return crypto.createHash("sha256").update(JSON.stringify(payload)).digest();
  }

  function twoPartyBarrier(timeoutMs = 5_000) {
    let arrivals = 0;
    let release;
    const released = new Promise((resolve) => {
      release = resolve;
    });
    return async () => {
      arrivals += 1;
      if (arrivals === 2) release();
      let timer;
      try {
        await Promise.race([
          released,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("historical MySQL concurrency barrier timed out")),
              timeoutMs
            );
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
  }

  async function assertStillPending(promise, label) {
    const outcome = await Promise.race([
      promise.then(
        () => "resolved",
        (error) => ({ rejected: error })
      ),
      new Promise((resolve) => setTimeout(() => resolve("pending"), WAIT_PROBE_MS))
    ]);
    if (outcome && typeof outcome === "object" && outcome.rejected) {
      throw outcome.rejected;
    }
    assert.equal(outcome, "pending", `${label} must wait on the opposing transaction`);
  }

  async function configureTransactionConnection(connection) {
    await connection.query("SET SESSION innodb_lock_wait_timeout = 5");
    await connection.query("SET time_zone = '+00:00'");
  }

  async function beginRepeatableRead(connection) {
    await configureTransactionConnection(connection);
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.beginTransaction();
  }

  async function inTransaction(connection, work) {
    await beginRepeatableRead(connection);
    try {
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }

  async function rollbackQuietly(connection) {
    if (!connection) return;
    try {
      await connection.rollback();
    } catch {}
  }

  async function endQuietly(connection) {
    if (!connection) return;
    try {
      await connection.end();
    } catch {}
  }

  async function applyApprovedSessionProposal(connection, actor, body, creationKeyHash) {
    const targetSubjectId = textCreationTargetSubjectId({
      action: "create_session",
      actorUserId: actor.user.id
    });
    const unused = async () => null;
    const handlers = createProductionTextProposalHandlers({
      currentActorTextSnapshot: unused,
      currentSessionCreateTextBase: async () => expectedTextCreationBase(actor.user.id),
      currentSessionTextBase: unused,
      currentNpcRoleTextBase: unused,
      currentReviewTextBase: unused,
      currentMessageTextBase: unused,
      currentPinnedTextBase: unused,
      updateUserProfileWithConnection: unused,
      createPrivateStoreWithConnection: unused,
      createPrivateScriptWithConnection: unused,
      createSessionWithConnection,
      updateSessionWithConnection: unused,
      createSessionNpcRoleWithConnection: unused,
      updateSessionNpcRoleWithConnection: unused,
      upsertMySessionReviewWithConnection: unused,
      createSessionMessageWithConnection: unused,
      updateSessionPinnedMessageWithConnection: unused
    });
    const applicator = createTextProposalApplicator({
      loadActor: async () => actor,
      handlers
    });
    const idempotencyKey = historicalSessionTextIdempotencyKey(creationKeyHash);
    const proposal = {
      action: "create_session",
      created_by_user_id: actor.user.id,
      target_subject_id: targetSubjectId,
      base_version: expectedTextCreationBase(actor.user.id),
      idempotency_key: idempotencyKey,
      normalized_payload_json: JSON.stringify({
        body,
        context: { targetSubjectId }
      })
    };
    return applicator.apply(connection, {
      job: {
        subject_id: textOperationSubjectId({
          action: proposal.action,
          actorUserId: actor.user.id,
          idempotencyKey
        })
      },
      proposal
    });
  }

  async function fixtureSessionIds(connection, fixture) {
    if (!fixture?.userId) return [];
    const [rows] = await connection.query(
      "SELECT id FROM sessions WHERE organizer_user_id = ? ORDER BY id",
      [fixture.userId]
    );
    return rows.map((row) => Number(row.id));
  }

  async function deleteSessionFixture(connection, sessionId, organizerUserId) {
    const [ownedRows] = await connection.query(
      "SELECT id FROM sessions WHERE id = ? AND organizer_user_id = ? LIMIT 1",
      [sessionId, organizerUserId]
    );
    if (ownedRows.length === 0) return;
    await connection.query(
      "UPDATE session_chat_rooms SET pinned_message_id = NULL WHERE session_id = ?",
      [sessionId]
    );
    await connection.query(
      "DELETE FROM session_messages WHERE room_id IN (SELECT id FROM session_chat_rooms WHERE session_id = ?)",
      [sessionId]
    );
    await connection.query("DELETE FROM session_chat_rooms WHERE session_id = ?", [sessionId]);
    await connection.query("DELETE FROM signups WHERE session_id = ?", [sessionId]);
    await connection.query("DELETE FROM session_npc_roles WHERE session_id = ?", [sessionId]);
    await connection.query("DELETE FROM share_events WHERE session_id = ?", [sessionId]);
    await connection.query("DELETE FROM session_seats WHERE session_id = ?", [sessionId]);
    await connection.query(
      "DELETE FROM sessions WHERE id = ? AND organizer_user_id = ?",
      [sessionId, organizerUserId]
    );
  }

  async function cleanupFixture(connection, fixture) {
    if (!fixture) return;
    for (const sessionId of await fixtureSessionIds(connection, fixture)) {
      await deleteSessionFixture(connection, sessionId, fixture.userId);
    }
    if (fixture.userId) {
      await connection.query(
        "DELETE FROM historical_session_creation_operations WHERE organizer_user_id = ?",
        [fixture.userId]
      );
    }
    if (fixture.scriptId) {
      await connection.query("DELETE FROM script_npc_roles WHERE script_id = ?", [fixture.scriptId]);
      await connection.query("DELETE FROM scripts WHERE id = ?", [fixture.scriptId]);
    }
    if (fixture.storeId) {
      await connection.query("DELETE FROM stores WHERE id = ?", [fixture.storeId]);
    }
    if (fixture.userId) {
      await connection.query("DELETE FROM user_roles WHERE user_id = ?", [fixture.userId]);
      await connection.query("DELETE FROM users WHERE id = ?", [fixture.userId]);
    }
  }

  async function createFixture(connection) {
    const prefix = `historical-mysql-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    const fixture = { prefix };
    const [userResult] = await connection.query(
      `INSERT INTO users (open_id, nickname, phone_verified_at)
       VALUES (?, 'Historical MySQL fixture', CURRENT_TIMESTAMP)`,
      [`${prefix}-openid`]
    );
    fixture.userId = Number(userResult.insertId);
    await connection.query(
      "INSERT INTO user_roles (user_id, role, status) VALUES (?, 'organizer', 'active')",
      [fixture.userId]
    );
    const [storeResult] = await connection.query(
      `INSERT INTO stores (name, city, status, claim_status, visibility, review_status)
       VALUES (?, '北京', 'active', 'unclaimed', 'public', 'approved')`,
      [`${prefix}-store`]
    );
    fixture.storeId = Number(storeResult.insertId);
    const [scriptResult] = await connection.query(
      `INSERT INTO scripts (name, player_count, status, claim_status, visibility, review_status)
       VALUES (?, 2, 'active', 'unclaimed', 'public', 'approved')`,
      [`${prefix}-script`]
    );
    fixture.scriptId = Number(scriptResult.insertId);
    fixture.actor = {
      user: {
        id: fixture.userId,
        openid: `${prefix}-openid`,
        nickname: "Historical MySQL fixture",
        phoneVerifiedAt: new Date()
      },
      roles: ["organizer"]
    };
    return fixture;
  }

  test("historical-session real MySQL concurrency smoke", { timeout: 120_000 }, async (t) => {
    await runMigrations();
    const coordinator = await createDatabaseConnection();
    let fixture;
    let fixtureLockHeld = false;
    const openConnections = new Set();
    let primaryError;
    try {
      const [databaseRows] = await coordinator.query("SELECT DATABASE() AS database_name");
      assert.equal(databaseRows[0]?.database_name, "pinche_d46_test");
      const [lockRows] = await coordinator.query("SELECT GET_LOCK(?, 0) AS acquired", [
        FIXTURE_LOCK_NAME
      ]);
      assert.equal(Number(lockRows[0]?.acquired), 1, "fixture named lock must be exclusive");
      fixtureLockHeld = true;

      const [sessionForeignKeys] = await coordinator.query(
        `SELECT CONSTRAINT_NAME AS constraint_name
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'historical_session_creation_operations'
           AND COLUMN_NAME = 'session_id'
           AND REFERENCED_TABLE_NAME = 'sessions'`
      );
      assert.deepEqual(
        sessionForeignKeys,
        [],
        "fresh schema must not retain the historical-operation session FK"
      );
      fixture = await createFixture(coordinator);

      await t.test(
        "same-key direct and approved requests serialize and RR replay sees the committed session",
        { timeout: 15_000 },
        async () => {
          const key = `${fixture.prefix}-same-key`;
          const keyHash = historicalCreationKeyHash(key);
          const pinnedMessageText = `${fixture.prefix} pinned message`;
          const npcRoleName = `${fixture.prefix} NPC role`;
          const directBody = historicalBody(fixture, key, {
            note: "same-key replay",
            pinnedMessageText,
            extraNpcRoles: [{
              name: npcRoleName,
              description: "same-key replay role",
              roleGender: "unlimited"
            }]
          });
          const descriptor = buildTextModerationDescriptor({
            action: "create_session",
            subjectId: `session-create:${fixture.userId}`,
            actorUserId: fixture.userId,
            openid: fixture.actor.user.openid,
            baseVersion: expectedTextCreationBase(fixture.userId),
            idempotencyKey: historicalSessionTextIdempotencyKey(keyHash),
            idempotencyExplicit: true,
            body: directBody
          });
          const direct = await mysql.createConnection({
            host: "127.0.0.1",
            port: 3346,
            database: "pinche_d46_test",
            user: "pinche_d46",
            password: "pinche_d46_local_only"
          });
          const approved = await mysql.createConnection({
            host: "127.0.0.1",
            port: 3346,
            database: "pinche_d46_test",
            user: "pinche_d46",
            password: "pinche_d46_local_only"
          });
          openConnections.add(direct);
          openConnections.add(approved);
          let replayPromise;
          try {
            await beginRepeatableRead(approved);
            const [snapshotRows] = await approved.query(
              "SELECT COUNT(*) AS count FROM sessions WHERE organizer_user_id = ?",
              [fixture.userId]
            );
            const snapshotCount = Number(snapshotRows[0]?.count || 0);

            await beginRepeatableRead(direct);
            const created = await createSessionWithConnection(
              direct,
              fixture.actor,
              directBody
            );
            replayPromise = applyApprovedSessionProposal(
              approved,
              fixture.actor,
              descriptor.payload.body,
              keyHash
            );
            await assertStillPending(replayPromise, "same-key approved replay");
            await direct.commit();

            const replay = await replayPromise;
            const [repeatableReadRows] = await approved.query(
              "SELECT COUNT(*) AS count FROM sessions WHERE organizer_user_id = ?",
              [fixture.userId]
            );
            assert.equal(
              Number(repeatableReadRows[0]?.count || 0),
              snapshotCount,
              "the replay transaction must retain its older consistent-read snapshot"
            );
            await approved.commit();
            assert.equal(Number(replay.id), Number(created.id));
            const [operationRows] = await coordinator.query(
              `SELECT session_id
               FROM historical_session_creation_operations
               WHERE organizer_user_id = ? AND creation_key_hash = UNHEX(?)`,
              [fixture.userId, keyHash]
            );
            assert.equal(operationRows.length, 1);
            assert.equal(Number(operationRows[0].session_id), Number(created.id));
            const [sessionRows] = await coordinator.query(
              "SELECT id FROM sessions WHERE organizer_user_id = ? AND note = ?",
              [fixture.userId, "same-key replay"]
            );
            assert.deepEqual(sessionRows.map((row) => Number(row.id)), [Number(created.id)]);
            const [roomRows] = await coordinator.query(
              "SELECT id, pinned_message_id FROM session_chat_rooms WHERE session_id = ?",
              [created.id]
            );
            assert.equal(roomRows.length, 1);
            assert.equal(Number(roomRows[0].pinned_message_id) > 0, true);
            const [pinnedRows] = await coordinator.query(
              `SELECT id, content
               FROM session_messages
               WHERE room_id = ? AND message_type = 'pinned'`,
              [roomRows[0].id]
            );
            assert.deepEqual(
              pinnedRows.map((row) => ({ id: Number(row.id), content: row.content })),
              [{
                id: Number(roomRows[0].pinned_message_id),
                content: pinnedMessageText
              }]
            );
            const [npcRoleRows] = await coordinator.query(
              "SELECT name FROM session_npc_roles WHERE session_id = ? ORDER BY id",
              [created.id]
            );
            assert.deepEqual(npcRoleRows.map((row) => row.name), [npcRoleName]);
          } finally {
            replayPromise?.catch(() => {});
            await rollbackQuietly(direct);
            await rollbackQuietly(approved);
            await endQuietly(direct);
            await endQuietly(approved);
            openConnections.delete(direct);
            openConnections.delete(approved);
          }
        }
      );

      await t.test(
        "different keys for one organizer complete without an FK lock-conversion deadlock",
        { timeout: 15_000 },
        async () => {
          const keys = [
            `${fixture.prefix}-different-a`,
            `${fixture.prefix}-different-b`
          ];
          const connections = await Promise.all(keys.map(async () => {
            const connection = await mysql.createConnection({
              host: "127.0.0.1",
              port: 3346,
              database: "pinche_d46_test",
              user: "pinche_d46",
              password: "pinche_d46_local_only"
            });
            openConnections.add(connection);
            return connection;
          }));
          const waitAtBoundary = twoPartyBarrier();
          try {
            const sessions = await Promise.all(connections.map((connection, index) => (
              inTransaction(connection, async () => {
                const keyHash = historicalCreationKeyHash(keys[index]);
                await connection.query(
                  `INSERT INTO historical_session_creation_operations
                     (organizer_user_id, creation_key_hash, payload_hash, session_id)
                   VALUES (?, UNHEX(?), ?, NULL)`,
                  [
                    fixture.userId,
                    keyHash,
                    historicalCreationPayloadHash(fixture)
                  ]
                );
                await waitAtBoundary();
                return createSessionWithConnection(
                  connection,
                  fixture.actor,
                  historicalBody(fixture, keys[index])
                );
              })
            )));
            assert.equal(new Set(sessions.map((session) => Number(session.id))).size, 2);
            const [operationRows] = await coordinator.query(
              `SELECT session_id
               FROM historical_session_creation_operations
               WHERE organizer_user_id = ?
                 AND creation_key_hash IN (UNHEX(?), UNHEX(?))`,
              [
                fixture.userId,
                historicalCreationKeyHash(keys[0]),
                historicalCreationKeyHash(keys[1])
              ]
            );
            assert.equal(operationRows.length, 2);
            assert.equal(operationRows.every((row) => Number(row.session_id) > 0), true);
          } finally {
            for (const connection of connections) {
              await rollbackQuietly(connection);
              await endQuietly(connection);
              openConnections.delete(connection);
            }
          }
        }
      );

      await t.test(
        "bound replay and hard delete do not deadlock after removing the session FK",
        { timeout: 15_000 },
        async () => {
          const key = `${fixture.prefix}-delete-replay`;
          const body = historicalBody(fixture, key, { note: "delete replay" });
          const created = await inTransaction(coordinator, (connection) =>
            createSessionWithConnection(connection, fixture.actor, body)
          );
          const sessionId = Number(created.id);
          const deleter = await mysql.createConnection({
            host: "127.0.0.1",
            port: 3346,
            database: "pinche_d46_test",
            user: "pinche_d46",
            password: "pinche_d46_local_only"
          });
          const replay = await mysql.createConnection({
            host: "127.0.0.1",
            port: 3346,
            database: "pinche_d46_test",
            user: "pinche_d46",
            password: "pinche_d46_local_only"
          });
          openConnections.add(deleter);
          openConnections.add(replay);
          let replayPromise;
          try {
            await beginRepeatableRead(deleter);
            const [lockedRows] = await deleter.query(
              "SELECT id FROM sessions WHERE id = ? FOR UPDATE",
              [sessionId]
            );
            assert.equal(lockedRows.length, 1);

            await beginRepeatableRead(replay);
            replayPromise = createSessionWithConnection(
              replay,
              fixture.actor,
              body
            );
            await assertStillPending(replayPromise, "bound operation replay");

            await deleter.query(
              "UPDATE session_chat_rooms SET pinned_message_id = NULL WHERE session_id = ?",
              [sessionId]
            );
            await deleter.query(
              "DELETE FROM session_messages WHERE room_id IN (SELECT id FROM session_chat_rooms WHERE session_id = ?)",
              [sessionId]
            );
            await deleter.query("DELETE FROM session_chat_rooms WHERE session_id = ?", [sessionId]);
            await deleter.query("DELETE FROM session_npc_roles WHERE session_id = ?", [sessionId]);
            const [deleteResult] = await deleter.query(
              "DELETE FROM sessions WHERE id = ? AND organizer_user_id = ?",
              [sessionId, fixture.userId]
            );
            assert.equal(Number(deleteResult.affectedRows), 1);
            await deleter.commit();

            await assert.rejects(replayPromise, {
              statusCode: 409,
              code: "HISTORICAL_SESSION_CREATION_OPERATION_INVALID"
            });
            await replay.rollback();
            const [operationRows] = await coordinator.query(
              `SELECT session_id
               FROM historical_session_creation_operations
               WHERE organizer_user_id = ? AND creation_key_hash = UNHEX(?)`,
              [fixture.userId, historicalCreationKeyHash(key)]
            );
            assert.equal(operationRows.length, 1);
            assert.equal(Number(operationRows[0].session_id), sessionId);
          } finally {
            replayPromise?.catch(() => {});
            await rollbackQuietly(deleter);
            await rollbackQuietly(replay);
            await endQuietly(deleter);
            await endQuietly(replay);
            openConnections.delete(deleter);
            openConnections.delete(replay);
          }
        }
      );
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      for (const connection of openConnections) {
        await rollbackQuietly(connection);
        await endQuietly(connection);
      }
      let cleanupError;
      try {
        await cleanupFixture(coordinator, fixture);
      } catch (error) {
        cleanupError = error;
      }
      try {
        if (fixtureLockHeld) {
          const [releaseRows] = await coordinator.query("SELECT RELEASE_LOCK(?) AS released", [
            FIXTURE_LOCK_NAME
          ]);
          assert.equal(Number(releaseRows[0]?.released), 1);
        }
      } catch (error) {
        cleanupError ||= error;
      }
      await endQuietly(coordinator);
      if (cleanupError) {
        if (primaryError) primaryError.cleanupError = cleanupError;
        else throw cleanupError;
      }
    }
  });
}
