import assert from "node:assert/strict";
import test from "node:test";

import { requestAlbumImageDeletion } from "../src/modules/core/service.js";

function deletionConnection(photo) {
  const calls = [];
  let job = null;
  let moderationJob = photo.moderation_object_version
    ? { id: 11, status: "rejected" }
    : null;
  return {
    calls,
    get job() { return job; },
    async query(sql, values) {
      const text = String(sql);
      calls.push({ sql: text, values });
      if (/SELECT \* FROM session_album_photos/.test(text)) return [[photo]];
      if (/SELECT id, status FROM content_moderation_jobs/.test(text)) {
        return [[moderationJob].filter(Boolean)];
      }
      if (/UPDATE content_moderation_jobs/.test(text)) {
        moderationJob = null;
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE content_moderation_provider_attempts/.test(text)) return [{ affectedRows: 1 }];
      if (/SELECT \* FROM session_album_object_cleanup_jobs/.test(text)) return [[job].filter(Boolean)];
      if (/UPDATE session_album_photos/.test(text)) { photo.status = "deleting"; return [{ affectedRows: 1 }]; }
      if (/INSERT INTO session_album_object_cleanup_jobs/.test(text)) {
        job = {
          id: 7,
          media_id: photo.id,
          status: "pending",
          storage_kind: photo.media_type === "video" ? "multi" : "cos",
          object_urls_json: null
        };
        return [{ insertId: 7, affectedRows: 1 }];
      }
      if (/UPDATE session_album_object_cleanup_jobs/.test(text)) {
        job.status = "pending";
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${text}`);
    }
  };
}

test("image delete commits deleting plus durable job without object I/O", async () => {
  const connection = deletionConnection({
    id: 91, session_id: 8, uploader_user_id: 3, media_type: "image", status: "active",
    object_key: "uploads/session-album/display/a.jpg", photo_url: "/uploads/session-album/display/a.jpg",
    moderation_object_version: "etag-a"
  });
  const result = await requestAlbumImageDeletion(connection, {
    user: { user: { id: 3 }, roles: [] }, mediaId: 91
  });
  assert.equal(result.status, "deleting");
  assert.equal(connection.job.media_id, 91);
  assert.match(connection.calls.at(-1).sql, /session_album_object_cleanup_jobs/);
});

test("a non-uploader cannot cancel moderation or enqueue media deletion", async () => {
  const connection = deletionConnection({
    id: 93,
    session_id: 8,
    uploader_user_id: 3,
    media_type: "image",
    status: "active",
    object_key: "uploads/session-album/display/private.jpg",
    moderation_object_version: "etag-private"
  });
  await assert.rejects(requestAlbumImageDeletion(connection, {
    user: { user: { id: 4 }, roles: [] },
    mediaId: 93
  }), { code: "FORBIDDEN" });
  assert.equal(connection.calls.length, 1);
  assert.equal(connection.job, null);
});

test("repeated deletion returns its existing job and video uses the same durable queue", async () => {
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
    if (/content_moderation_jobs/.test(text)) return [[]];
    if (/session_album_object_cleanup_jobs/.test(text)) return [[{ id: 7, media_id: 91, status: "pending" }]];
    throw new Error("unexpected mutation");
  };
  assert.equal((await requestAlbumImageDeletion(connection, {
    user: { user: { id: 3 }, roles: [] }, mediaId: 91
  })).job.id, 7);

  const video = deletionConnection({
    id: 92,
    session_id: 8,
    uploader_user_id: 3,
    media_type: "video",
    status: "active",
    moderation_status: "rejected",
    moderation_object_version: "etag-video",
    source_url: "/uploads/session-album/videos/source/a.mp4",
    display_url: "/uploads/session-album/videos/display/a.mp4",
    cover_url: "/uploads/session-album/videos/cover/a.jpg"
  });
  const videoDeletion = await requestAlbumImageDeletion(video, {
    user: { user: { id: 3 }, roles: [] }, mediaId: 92
  });
  assert.equal(videoDeletion.status, "deleting");
  assert.equal(video.job.storage_kind, "multi");
  assert.match(video.calls.find((call) => /UPDATE content_moderation_jobs/.test(call.sql)).sql, /cancelled/);
});
