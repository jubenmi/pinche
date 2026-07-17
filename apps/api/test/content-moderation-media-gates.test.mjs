import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createSessionAlbumPhoto,
  isModerationPublished,
  serializeSessionAlbumImage
} from "../src/modules/core/service.js";
import { albumMediaCountSql } from "../src/modules/core/session-album-media-count.js";

test("only approved and approved_legacy media pass the content gate", () => {
  assert.equal(isModerationPublished("approved"), true);
  assert.equal(isModerationPublished("approved_legacy"), true);
  for (const status of ["pending", "review", "rejected", "error"]) {
    assert.equal(isModerationPublished(status), false);
  }
  assert.equal(isModerationPublished(undefined), false);
});

test("lower-level local image creation defaults direct and rejects unwired moderation before INSERT", async () => {
  let inserts = 0;
  let insertedModerationStatus = null;
  let insertedAuthorVisibilityVersion = null;
  const timeline = [];
  const photo = {
    id: 31, session_id: 8, uploader_user_id: 3, media_type: "image",
    moderation_status: "approved_legacy", status: "active"
  };
  const connection = {
    async query(sql, values = []) {
      if (String(sql).includes("INSERT INTO session_album_photos")) {
        timeline.push("insert_business");
        inserts += 1;
        insertedModerationStatus = values.at(-3);
        insertedAuthorVisibilityVersion = values.at(-1);
        return [{ insertId: photo.id }];
      }
      if (String(sql).includes("SELECT * FROM session_album_photos WHERE id")) return [[photo]];
      throw new Error(`unexpected SQL: ${sql}`);
    }
  };
  const baseOptions = {
    withTransaction: async (run) => run(connection),
    authorizeSessionAlbumPhotoCreate: async () => timeline.push("authorize")
  };
  const body = {
    photoUrl: "/uploads/session-album/display/album-8-3-1-0123456789abcdef.jpg",
    imageWidth: 10,
    imageHeight: 10,
    imageByteSize: 100,
    imageContentType: "image/jpeg"
  };
  const result = await createSessionAlbumPhoto(
    { user: { id: 3 }, roles: [] }, 8, body, baseOptions
  );
  assert.equal(result.moderation_status, "approved_legacy");
  assert.equal(insertedModerationStatus, "approved_legacy");
  assert.equal(insertedAuthorVisibilityVersion, 0);

  timeline.length = 0;
  await assert.rejects(createSessionAlbumPhoto(
    { user: { id: 3 }, roles: [] }, 8, body,
    {
      ...baseOptions,
      assertImageIntake: async () => {
        timeline.push("final_intake");
        return { moderationRequired: true };
      }
    }
  ), { code: "CONTENT_MODERATION_CONFIGURATION_ERROR", statusCode: 500 });
  assert.equal(inserts, 1, "the rejected call must fail before its INSERT");
  assert.deepEqual(timeline, ["final_intake", "authorize"]);
});

test("album count SQL excludes every non-approved moderation state", () => {
  const sql = albumMediaCountSql("album_media");
  assert.match(sql, /moderation_status IN \('approved', 'approved_legacy'\)/);
});

test("member and public lists, counts, and direct getters contain independent moderation gates", async () => {
  const service = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
  const publicList = service.slice(
    service.indexOf("export async function listPublicSessionAlbumShare"),
    service.indexOf("export async function createSessionAlbumPhoto")
  );
  assert.match(publicList, /moderation_status IN \('approved', 'approved_legacy'\)/);

  const memberList = service.slice(
    service.indexOf("export async function listSessionAlbum"),
    service.indexOf("export async function listPublicSessionAlbumShare")
  );
  assert.match(memberList, /isModerationPublished\(photo\.moderation_status\)/);
  assert.match(memberList, /Number\(photo\.uploader_user_id\) !== Number\(user\.user\.id\)/);

  for (const getter of [
    "getVisibleSessionAlbumPhotoForMedia",
    "getPublicSessionAlbumPhotoForMedia",
    "getVisibleSessionAlbumVideoForPlayback",
    "getPublicSessionAlbumVideoCoverForMedia"
  ]) {
    const start = service.indexOf(`export async function ${getter}`);
    const next = service.indexOf("\nexport async function ", start + 10);
    const body = service.slice(start, next === -1 ? undefined : next);
    assert.match(body, /isModerationPublished\(/, `${getter} must gate moderation`);
  }
});

test("unapproved uploader serialization disables tags and does not expose storage facts", () => {
  const placeholder = serializeSessionAlbumImage({
    id: 81,
    session_id: 9,
    media_type: "image",
    moderation_status: "pending",
    uploader_user_id: 7,
    object_key: "uploads/session-album/display/private.jpg",
    object_etag: "private-etag"
  }, 7);

  assert.equal(placeholder.moderation_status, "pending");
  assert.equal(placeholder.can_tag, false);
  assert.deepEqual(placeholder.tags, []);
  assert.equal("object_key" in placeholder, false);
  assert.equal("object_etag" in placeholder, false);
  assert.equal("storage_object_key" in placeholder, false);
  assert.equal("storage_object_etag" in placeholder, false);
});

test("member list filters other users' unapproved media in SQL before tag lookup", async () => {
  const service = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
  const memberList = service.slice(
    service.indexOf("export async function listSessionAlbum"),
    service.indexOf("export async function listPublicSessionAlbumShare")
  );

  assert.match(
    memberList,
    /photo\.moderation_status IN \('approved', 'approved_legacy'\)[\s\S]*photo\.uploader_user_id = \?/
  );
  assert.match(memberList, /\[id, user\.user\.id\]/);
});

test("member album visible_count excludes the uploader's unapproved status placeholders", async () => {
  const service = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
  const memberList = service.slice(
    service.indexOf("export async function listSessionAlbum"),
    service.indexOf("export async function listPublicSessionAlbumShare")
  );

  assert.match(
    memberList,
    /visible_count:\s*photos\.filter\(\(photo\) => isModerationPublished\(photo\.moderation_status\)\)\.length/
  );
});

test("organizer session media counts include only published active media without dropping failed videos", async () => {
  const service = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
  const listMySessions = service.slice(
    service.indexOf("export async function listMySessions"),
    service.indexOf("export async function listDiscoverableSessions")
  );
  const publishedCount = "COUNT(DISTINCT CASE WHEN album_photo.moderation_status IN ('approved', 'approved_legacy') THEN album_photo.id END)";

  assert.match(listMySessions, new RegExp(`${publishedCount.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} AS active_album_photo_count`));
  assert.match(listMySessions, new RegExp(`${publishedCount.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} AS photo_count`));
  assert.match(listMySessions, /\$\{albumMediaCountSql\("album_photo"\)\} AS album_media_count/);
});

test("unapproved direct media reads retain a 404 response while emitting a safe denial metric", async () => {
  const [service, server] = await Promise.all([
    readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8"),
    readFile(new URL("../src/server.js", import.meta.url), "utf8")
  ]);
  assert.match(service, /function moderationUnpublishedNotFound\(subjectType\)/);
  for (const subjectType of ["album_image", "album_video"]) {
    assert.equal(service.includes(`moderationUnpublishedNotFound("${subjectType}")`), true);
  }
  assert.match(server, /error\?\.contentModerationDenied === true/);
  assert.match(server, /emitContentModerationEvent\("moderation_access_denied"/);
  const denialStart = server.indexOf("error?.contentModerationDenied === true");
  const denialBody = server.slice(denialStart, denialStart + 600);
  assert.doesNotMatch(denialBody, /photo_url|object_key|signedUrl|signature|token/);
});

test("public image reads mark unpublished content as a moderation denial without changing its 404 response", async () => {
  const service = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
  const start = service.indexOf("export async function getPublicSessionAlbumPhotoForMedia");
  const next = service.indexOf("\nexport async function ", start + 10);
  const body = service.slice(start, next === -1 ? undefined : next);

  assert.match(body, /if \(!photo \|\| photo\.status !== "active"\) \{\s*throw notFound\("Album photo not found"\);\s*\}/);
  assert.match(body, /if \(!isModerationPublished\(photo\.moderation_status\)\) \{\s*throw moderationUnpublishedNotFound\("album_image"\);\s*\}/);
});
