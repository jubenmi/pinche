import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
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
