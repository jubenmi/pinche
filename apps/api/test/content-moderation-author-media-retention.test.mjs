import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseAdminModerationPurgeBody } from "../src/modules/content-moderation/admin-api.js";
import { shouldRetainRejectedMedia } from "../src/modules/content-moderation/service.js";
import { purgeSessionAlbumMedia } from "../src/modules/core/service.js";

test("D46 provider/admin rejection retains only persisted policy-version-one media", () => {
  assert.equal(shouldRetainRejectedMedia({
    status: "active",
    author_visibility_version: 1,
    media_type: "image"
  }), true);
  assert.equal(shouldRetainRejectedMedia({
    status: "active",
    author_visibility_version: 1,
    media_type: "video"
  }), true);
  for (const media of [
    { status: "active", author_visibility_version: 0, media_type: "image" },
    { status: "active", author_visibility_version: null, media_type: "video" },
    { status: "deleting", author_visibility_version: 1, media_type: "image" },
    { status: "active", author_visibility_version: 2, media_type: "image" }
  ]) {
    assert.equal(shouldRetainRejectedMedia(media), false);
  }
});

test("D46 purge requires a bounded reason and literal second confirmation", () => {
  assert.deepEqual(parseAdminModerationPurgeBody({
    reason: "紧急合规移除",
    confirmation: "PURGE"
  }), {
    reason: "紧急合规移除",
    confirmation: "PURGE"
  });
  for (const body of [
    {},
    { reason: "紧急合规移除" },
    { reason: "", confirmation: "PURGE" },
    { reason: "紧急合规移除", confirmation: "确认" },
    { reason: "紧急合规移除", confirmation: "PURGE", mediaId: 91 }
  ]) {
    assert.throws(() => parseAdminModerationPurgeBody(body), /purge/i);
  }
});

test("D46 author delete and admin purge cancel moderation before durable cleanup", async () => {
  const [core, repository, adminApi, server] = await Promise.all([
    readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/content-moderation/repository.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/content-moderation/admin-api.js", import.meta.url), "utf8"),
    readFile(new URL("../src/server.js", import.meta.url), "utf8")
  ]);
  const deletionStart = core.indexOf("export async function requestAlbumImageDeletion");
  const deletionEnd = core.indexOf("\nexport async function ", deletionStart + 1);
  const deletion = core.slice(deletionStart, deletionEnd);
  assert.match(deletion, /cancelMediaModerationJobsForDeletion/);
  assert.match(deletion, /status = 'deleting'/);
  assert.match(deletion, /enqueueRejectedMediaCleanup/);
  assert.doesNotMatch(deletion, /media_type\(photo\).*image|Video deletion must use/);
  assert.match(repository, /export async function cancelMediaModerationJobsForDeletion/);
  assert.match(adminApi, /\(approve\|reject\|retry\|purge\)/);
  assert.match(server, /purgeSessionAlbumMedia/);
});

test("D46 retained media remains a database object reference and late output only cleans deleting rows", async () => {
  const [repository, core] = await Promise.all([
    readFile(new URL("../src/modules/content-moderation/repository.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8")
  ]);
  const references = repository.slice(
    repository.indexOf("export async function findContentModerationObjectReferences"),
    repository.indexOf("export async function listModerationMediaForReconciliation")
  );
  assert.match(references, /status IN \('active', 'deleting'\)/);
  assert.doesNotMatch(references, /moderation_status IN \('approved'/);
  const callbackStart = core.indexOf("export async function updateSessionAlbumVideoProcessingResult");
  const callbackEnd = core.indexOf("\nexport async function ", callbackStart + 1);
  const callback = core.slice(callbackStart, callbackEnd);
  assert.match(callback, /shouldRetainRejectedMedia/);
  assert.match(callback, /media\.status === "deleting"/);
});

test("D46 administrator purge cancels once, audits once, and reuses the durable cleanup job", async () => {
  const job = {
    id: 7,
    subject_type: "album_video",
    subject_id: "91",
    subject_version: "etag-v1",
    status: "rejected"
  };
  let media = {
    id: 91,
    session_id: 8,
    uploader_user_id: 3,
    media_type: "video",
    status: "active",
    moderation_status: "rejected",
    moderation_object_version: "etag-v1",
    author_visibility_version: 1,
    source_url: "/uploads/session-album/videos/source/a.mp4",
    display_url: "/uploads/session-album/videos/display/a.mp4",
    cover_url: "/uploads/session-album/videos/cover/a.jpg"
  };
  let cleanupJob = null;
  const audits = [];
  const connection = {
    async query(sql, values) {
      const text = String(sql);
      if (/SELECT \* FROM content_moderation_jobs WHERE id = \?/.test(text)) return [[job]];
      if (/SELECT \* FROM session_album_photos WHERE id = \?/.test(text)) {
        return [[media].filter(Boolean)];
      }
      if (/FROM content_moderation_audit_logs/.test(text)) {
        return audits.length > 0 ? [[{ id: 41, action: "purge" }]] : [[]];
      }
      if (/SELECT id, status FROM content_moderation_jobs/.test(text)) {
        return job.status === "rejected" ? [[{ id: 7, status: "rejected" }]] : [[]];
      }
      if (/UPDATE content_moderation_jobs/.test(text)) {
        job.status = "cancelled";
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE content_moderation_provider_attempts/.test(text)) return [{ affectedRows: 1 }];
      if (/UPDATE session_album_photos SET status = 'deleting'/.test(text)) {
        media.status = "deleting";
        return [{ affectedRows: 1 }];
      }
      if (/SELECT \* FROM session_album_object_cleanup_jobs/.test(text)) {
        return [[cleanupJob].filter(Boolean)];
      }
      if (/INSERT INTO session_album_object_cleanup_jobs/.test(text)) {
        cleanupJob = {
          id: 29,
          media_id: 91,
          storage_kind: "multi",
          object_urls_json: null,
          status: "pending"
        };
        return [{ insertId: 29, affectedRows: 1 }];
      }
      if (/UPDATE session_album_object_cleanup_jobs/.test(text)) return [{ affectedRows: 1 }];
      if (/INSERT INTO content_moderation_audit_logs/.test(text)) {
        audits.push(values);
        return [{ insertId: 41, affectedRows: 1 }];
      }
      throw new Error(`unexpected query: ${text}`);
    }
  };
  const input = {
    admin: { user: { id: 2 }, roles: ["system_admin"] },
    jobId: 7,
    reason: "紧急合规移除",
    confirmation: "PURGE"
  };
  const options = { transaction: async (run) => run(connection) };

  assert.deepEqual(await purgeSessionAlbumMedia(input, options), {
    id: 91,
    moderation_job_id: 7,
    status: "deleting",
    purge_pending: true
  });
  assert.equal(job.status, "cancelled");
  assert.equal(media.status, "deleting");
  assert.equal(cleanupJob.id, 29);
  assert.equal(audits.length, 1);

  assert.deepEqual(await purgeSessionAlbumMedia(input, options), {
    id: 91,
    moderation_job_id: 7,
    status: "deleting",
    purge_pending: true
  });
  assert.equal(audits.length, 1);

  media = null;
  assert.deepEqual(await purgeSessionAlbumMedia(input, options), {
    id: 91,
    moderation_job_id: 7,
    status: "deleted",
    purge_pending: false
  });
  assert.equal(audits.length, 1);
});
