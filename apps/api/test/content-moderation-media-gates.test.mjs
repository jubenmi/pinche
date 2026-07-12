import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isAlbumMediaModerationApproved
} from "../src/modules/core/service.js";
import { albumMediaCountSql } from "../src/modules/core/session-album-media-count.js";

test("only approved and approved_legacy media pass the content gate", () => {
  assert.equal(isAlbumMediaModerationApproved({ moderation_status: "approved" }), true);
  assert.equal(isAlbumMediaModerationApproved({ moderation_status: "approved_legacy" }), true);
  for (const status of ["pending", "review", "rejected", "error"]) {
    assert.equal(isAlbumMediaModerationApproved({ moderation_status: status }), false);
  }
  assert.equal(isAlbumMediaModerationApproved({}), true, "pre-migration test fixtures remain legacy-compatible");
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
  assert.match(memberList, /isAlbumMediaModerationApproved\(photo\)/);
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
    assert.match(body, /isAlbumMediaModerationApproved\(/, `${getter} must gate moderation`);
  }
});

