import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSessionAlbumImageUploadAllowed,
  serializeSessionAlbumImage
} from "../src/modules/core/service.js";

const member = (id, roles = []) => ({ user: { id }, roles });

function accessConnection({ session, seats = [], npcRoles = [] }) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      const text = String(sql);
      calls.push({ sql: text, values });
      if (/FROM sessions session/.test(text)) return [[session].filter(Boolean)];
      if (/FROM sessions\s+WHERE/.test(text)) return [[session].filter(Boolean)];
      if (/FROM session_seats/.test(text)) return [seats];
      if (/FROM session_npc_roles/.test(text)) return [npcRoles];
      throw new Error(`Unexpected SQL: ${text}`);
    }
  };
}

for (const [label, session] of [
  ["organizer", { id: 5, organizer_user_id: 9 }],
  ["DM", { id: 5, organizer_user_id: 1, dm_user_id: 9 }],
  ["NPC", { id: 5, organizer_user_id: 1, npc_user_id: 9 }]
]) {
  test(`member upload accepts ${label}`, async () => {
    const connection = accessConnection({ session });
    assert.equal((await assertSessionAlbumImageUploadAllowed(connection, member(9), {
      sessionId: 5, kind: "sessionAlbumPhoto", forUpdate: true
    })).id, 5);
    assert.match(connection.calls[0].sql, /FOR UPDATE/);
  });
}

test("member upload accepts confirmed seat and active bound NPC role with locks", async () => {
  for (const fixtures of [{ seats: [{ id: 1 }] }, { seats: [], npcRoles: [{ id: 2 }] }]) {
    const connection = accessConnection({
      session: { id: 5, organizer_user_id: 1 }, ...fixtures
    });
    await assertSessionAlbumImageUploadAllowed(connection, member(9), {
      sessionId: 5, kind: "sessionAlbumPhoto", forUpdate: true
    });
    assert.equal(connection.calls.every(({ sql }) => /FOR UPDATE/.test(sql)), true);
  }
});

test("admin upload requires system admin and matching organizer", async () => {
  const allowed = accessConnection({ session: { id: 5, organizer_user_id: 9 } });
  await assertSessionAlbumImageUploadAllowed(allowed, member(9, ["system_admin"]), {
    sessionId: 5, kind: "adminSessionAlbumPhoto", forUpdate: true
  });
  for (const user of [member(9), member(8, ["system_admin"])]) {
    const denied = accessConnection({ session: { id: 5, organizer_user_id: 9 } });
    await assert.rejects(
      assertSessionAlbumImageUploadAllowed(denied, user, {
        sessionId: 5, kind: "adminSessionAlbumPhoto", forUpdate: true
      }),
      (error) => error.statusCode === 403
    );
  }
});

test("closed album and revoked membership reject", async () => {
  const closed = accessConnection({ session: null });
  await assert.rejects(
    assertSessionAlbumImageUploadAllowed(closed, member(9), {
      sessionId: 5, kind: "sessionAlbumPhoto", forUpdate: true
    }),
    (error) => error.statusCode === 404 || error.statusCode === 403
  );
  const revoked = accessConnection({ session: { id: 5, organizer_user_id: 1 } });
  await assert.rejects(
    assertSessionAlbumImageUploadAllowed(revoked, member(9), {
      sessionId: 5, kind: "sessionAlbumPhoto", forUpdate: true
    }),
    (error) => error.statusCode === 403
  );
});

test("image serialization exposes storage facts only as explicit internal projection inputs", () => {
  const media = serializeSessionAlbumImage({
    id: 3,
    session_id: 5,
    uploader_user_id: 9,
    media_type: "image",
    moderation_status: "approved",
    status: "active",
    object_key: "uploads/session-album/display/a.jpg",
    object_etag: "etag",
    image_width: 10,
    image_height: 20,
    image_byte_size: 30,
    image_content_type: "image/jpeg"
  }, 9);
  assert.equal(media.storage_object_key, "uploads/session-album/display/a.jpg");
  assert.equal(media.storage_object_etag, "etag");
  assert.equal("object_key" in media, false);
  assert.equal("object_etag" in media, false);
});
