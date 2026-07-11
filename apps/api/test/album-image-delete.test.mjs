import assert from "node:assert/strict";
import test from "node:test";

import { requestAlbumImageDeletion } from "../src/modules/core/service.js";

function deletionConnection(photo) {
  const calls = [];
  let job = null;
  return {
    calls,
    get job() { return job; },
    async query(sql, values) {
      const text = String(sql);
      calls.push({ sql: text, values });
      if (/SELECT \* FROM session_album_photos/.test(text)) return [[photo]];
      if (/SELECT \* FROM session_album_object_cleanup_jobs/.test(text)) return [[job].filter(Boolean)];
      if (/UPDATE session_album_photos/.test(text)) { photo.status = "deleting"; return [{ affectedRows: 1 }]; }
      if (/INSERT INTO session_album_object_cleanup_jobs/.test(text)) {
        job = { id: 7, media_id: photo.id, status: "pending" };
        return [{ insertId: 7, affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${text}`);
    }
  };
}

test("image delete commits deleting plus durable job without object I/O", async () => {
  const connection = deletionConnection({
    id: 91, session_id: 8, uploader_user_id: 3, media_type: "image", status: "active",
    object_key: "uploads/session-album/display/a.jpg", photo_url: "/uploads/session-album/display/a.jpg"
  });
  const result = await requestAlbumImageDeletion(connection, {
    user: { user: { id: 3 }, roles: [] }, mediaId: 91
  });
  assert.equal(result.status, "deleting");
  assert.equal(connection.job.media_id, 91);
  assert.match(connection.calls.at(-1).sql, /session_album_object_cleanup_jobs/);
});

test("repeated deletion returns existing job and video never enters image job", async () => {
  const connection = deletionConnection({
    id: 91, session_id: 8, uploader_user_id: 3, media_type: "image", status: "deleting",
    object_key: "k", photo_url: "/uploads/session-album/display/a.jpg"
  });
  connection.query = async (sql, values) => {
    const text = String(sql);
    connection.calls.push({ sql: text, values });
    if (/session_album_photos/.test(text)) return [[{
      id: 91, uploader_user_id: 3, media_type: "image", status: "deleting"
    }]];
    if (/session_album_object_cleanup_jobs/.test(text)) return [[{ id: 7, media_id: 91, status: "pending" }]];
    throw new Error("unexpected mutation");
  };
  assert.equal((await requestAlbumImageDeletion(connection, {
    user: { user: { id: 3 }, roles: [] }, mediaId: 91
  })).job.id, 7);

  const video = deletionConnection({
    id: 92, uploader_user_id: 3, media_type: "video", status: "active"
  });
  await assert.rejects(requestAlbumImageDeletion(video, {
    user: { user: { id: 3 }, roles: [] }, mediaId: 92
  }), (error) => error.code === "BAD_REQUEST");
  assert.equal(video.job, null);
});
