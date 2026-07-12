import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeNotificationCursor,
  listMyNotifications
} from "../src/modules/core/user-notifications.js";

function row(id, createdAt, readAt = null, unreadCount = 4) {
  return {
    id,
    type: "signup_reviewed",
    session_id: id + 100,
    title: `notification ${id}`,
    payload_json: "{}",
    read_at: readAt,
    created_at: createdAt,
    cursor_created_at: typeof createdAt === "string" ? `${createdAt}.000000` : undefined,
    unread_count: unreadCount
  };
}

test("returns limit items plus a stable opaque next cursor", async () => {
  const queries = [];
  const result = await listMyNotifications(
    { async query(sql, values) { queries.push({ sql, values }); return [[
      row(5, "2026-07-12 12:05:00"),
      row(4, "2026-07-12 12:04:00"),
      row(3, "2026-07-12 12:03:00")
    ]]; } },
    7,
    { limit: 2 }
  );

  assert.deepEqual(result.items.map(({ id }) => id), [5, 4]);
  assert.equal(result.unread_count, 4);
  assert.equal(result.has_more, true);
  assert.match(result.next_cursor, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /LIMIT \?/);
  assert.equal(queries[0].values.at(-1), 3);
});

test("cursor crosses the unread-to-read boundary without duplicates", async () => {
  const cursor = encodeNotificationCursor(7, row(20, "2026-07-12 10:00:00"));
  const calls = [];
  const result = await listMyNotifications(
    { async query(sql, values) { calls.push({ sql, values }); return [[
      row(19, "2026-07-12 09:00:00"),
      row(18, "2026-07-12 13:00:00", "2026-07-12 13:10:00")
    ]]; } },
    7,
    { limit: 2, cursor }
  );

  assert.deepEqual(result.items.map(({ id }) => id), [19, 18]);
  assert.equal(result.has_more, false);
  assert.equal(result.next_cursor, null);
  assert.match(calls[0].sql, /\(read_at IS NULL\) < \?/);
  assert(calls[0].values.every((value, index) => index > 1 || value === 7));
});

test("cursor binds the DB-native DATETIME key instead of mysql2 Date UTC serialization", async () => {
  const firstPageCalls = [];
  const mysqlDate = new Date("2026-07-12T04:05:00.000Z");
  const firstPage = await listMyNotifications(
    { async query(sql, values) { firstPageCalls.push({ sql, values }); return [[
      {
        ...row(9, mysqlDate),
        cursor_created_at: "2026-07-12 12:05:00.000000"
      },
      {
        ...row(8, new Date("2026-07-12T04:04:00.000Z")),
        cursor_created_at: "2026-07-12 12:04:00.000000"
      }
    ]]; } },
    7,
    { limit: 1 }
  );
  assert.match(firstPageCalls[0].sql, /DATE_FORMAT\(created_at, '%Y-%m-%d %H:%i:%s\.%f'\) AS cursor_created_at/);

  const secondPageCalls = [];
  await listMyNotifications(
    { async query(sql, values) { secondPageCalls.push({ sql, values }); return [[]]; } },
    7,
    { limit: 1, cursor: firstPage.next_cursor }
  );
  assert.equal(secondPageCalls[0].values[4], "2026-07-12 12:05:00.000000");
  assert.equal(secondPageCalls[0].values[6], "2026-07-12 12:05:00.000000");
  assert(!secondPageCalls[0].values.includes(mysqlDate.toISOString()));
});

test("rejects invalid and tampered cursors", async () => {
  const connection = { async query() { throw new Error("must not query"); } };
  await assert.rejects(
    () => listMyNotifications(connection, 7, { cursor: "not-a-cursor" }),
    (error) => error?.statusCode === 400
  );
  const valid = encodeNotificationCursor(7, row(2, "2026-07-12 10:00:00"));
  await assert.rejects(
    () => listMyNotifications(connection, 7, { cursor: `${valid.slice(0, -1)}x` }),
    (error) => error?.statusCode === 400
  );
});

test("rejects a valid cursor issued for another owner", async () => {
  const cursor = encodeNotificationCursor(7, row(2, "2026-07-12 10:00:00"));
  await assert.rejects(
    () => listMyNotifications({ async query() { throw new Error("must not query"); } }, 8, { cursor }),
    (error) => error?.statusCode === 400
  );
});
