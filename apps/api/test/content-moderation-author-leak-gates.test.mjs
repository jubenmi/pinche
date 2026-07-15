import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertPublicResponseSafe,
  authorPrivateResponseHeaders,
  containsAuthorPrivateContent
} from "../src/modules/content-moderation/response-privacy.js";
import {
  attachPublicSessionAlbumMediaUrls,
  attachSessionAlbumMediaUrls
} from "../src/server.js";
import {
  albumMediaCountSql,
  visibleSignupAlbumMediaCount
} from "../src/modules/core/session-album-media-count.js";

const PRIVATE_TEXT = "不应出现在公共响应或日志的待审正文";
const PRIVATE_URL = "/api/content-moderation/author-media/images/9/preview?token=reusable-secret";

function authorPrivateImage(overrides = {}) {
  return {
    id: 9,
    session_id: 3,
    media_type: "image",
    moderation_status: "rejected",
    publication_state: "author_only",
    uploader_user_id: 7,
    is_mine: true,
    can_preview: true,
    can_tag: false,
    tags: [],
    preview_display_url: PRIVATE_URL,
    thumbnail_display_url: PRIVATE_URL,
    download_url: null,
    ...overrides
  };
}

test("D46 public leak canary reports only a bounded reason and never private values", () => {
  const emitted = [];
  const unsafe = {
    data: {
      draft_id: 51,
      content_ref: "text-proposal:51",
      publication_state: "author_only",
      content: PRIVATE_TEXT,
      preview_display_url: PRIVATE_URL,
      object_key: "uploads/session-album/display/private.jpg",
      provider: "private-provider-result"
    }
  };

  assert.throws(
    () => assertPublicResponseSafe(unsafe, {
      routeKind: "session_public_share",
      emit: (event, fields) => emitted.push({ event, fields })
    }),
    (error) => error?.code === "CONTENT_MODERATION_AUTHOR_PRIVATE_LEAK"
  );
  assert.deepEqual(emitted, [{
    event: "author_private_public_leak",
    fields: {
      routeKind: "session_public_share",
      reasonCode: "draft_id",
      priority: "high"
    }
  }]);
  const serialized = JSON.stringify(emitted);
  for (const secret of [PRIVATE_TEXT, "reusable-secret", "private.jpg", "private-provider-result", "51"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.throws(
    () => assertPublicResponseSafe(unsafe, {
      routeKind: PRIVATE_TEXT,
      emit: () => { throw new Error(PRIVATE_URL); }
    }),
    (error) => error?.code === "CONTENT_MODERATION_AUTHOR_PRIVATE_LEAK"
  );
});

test("D46 responses containing author content are always private no-store", () => {
  const nested = { ok: true, data: { rows: [{ author_private: {
    publication_state: "author_only",
    moderation_status: "review"
  } }] } };
  assert.equal(containsAuthorPrivateContent(nested), true);
  assert.deepEqual(authorPrivateResponseHeaders(nested), {
    "cache-control": "private, no-store"
  });
  assert.equal(containsAuthorPrivateContent({ ok: true, data: [{ id: 1, status: "active" }] }), false);
  assert.deepEqual(authorPrivateResponseHeaders({ ok: true }), {});
});

test("D46 public album serializer drops an injected author row instead of trusting its caller", () => {
  const approved = {
    id: 8,
    session_id: 3,
    media_type: "image",
    moderation_status: "approved",
    image_url: "/approved.jpg"
  };
  const result = attachPublicSessionAlbumMediaUrls({
    session_id: 3,
    photos: [approved, authorPrivateImage()],
    media: [approved, authorPrivateImage()]
  }, {
    sessionId: 3,
    sharerUserId: 7,
    seatId: 2,
    exp: 2_000_000_000
  }, "public-share-token", {
    directMediaUrls: false,
    nowSeconds: 1000,
    emit: () => {}
  });
  assert.deepEqual(result.photos.map((photo) => photo.id), [8]);
  assert.deepEqual(result.media.map((photo) => photo.id), [8]);
  assert.doesNotThrow(() => assertPublicResponseSafe(result, {
    routeKind: "session_public_share"
  }));
  assert.equal(JSON.stringify(result).includes("author_only"), false);
  assert.equal(JSON.stringify(result).includes("author-media"), false);
});

test("D46 member serializer retains current-author preview while keeping propagation disabled", () => {
  const result = attachSessionAlbumMediaUrls({
    session_id: 3,
    photos: [authorPrivateImage()]
  }, 7, {
    buildAuthorUrls: () => ({
      preview_display_url: PRIVATE_URL,
      thumbnail_display_url: PRIVATE_URL,
      download_url: null,
      media_url_expires_at: "2026-07-15T08:00:00.000Z"
    }),
    emit: () => {}
  });
  assert.equal(result.photos[0].publication_state, "author_only");
  assert.equal(result.photos[0].can_tag, false);
  assert.equal(result.photos[0].download_url, null);
  assert.deepEqual(authorPrivateResponseHeaders(result), {
    "cache-control": "private, no-store"
  });
});

test("D46 counts and public media paths remain approved-only", async () => {
  const countSql = albumMediaCountSql("album_photo");
  assert.match(countSql, /moderation_status IN \('approved', 'approved_legacy'\)/);
  assert.doesNotMatch(countSql, /uploader|author_visibility|author_only/);
  assert.equal(visibleSignupAlbumMediaCount("approved", 2), 2);
  assert.equal(visibleSignupAlbumMediaCount("pending", 2), 0);

  const core = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
  for (const name of [
    "getVisibleSessionAlbumPhotoForMedia",
    "getPublicSessionAlbumPhotoForMedia",
    "getVisibleSessionAlbumVideoForPlayback",
    "getPublicSessionAlbumVideoCoverForMedia"
  ]) {
    const start = core.indexOf(`export async function ${name}`);
    const end = core.indexOf("\nexport async function ", start + 1);
    const block = core.slice(start, end === -1 ? undefined : end);
    assert.ok(start >= 0, name);
    assert.match(block, /isModerationPublished\(/, name);
    assert.doesNotMatch(block, /authorTextReader|author_only|author_visibility_version/, name);
  }
});

test("D46 public discovery, calendar, review, unread, tag and notification paths do not read projections", async () => {
  const [core, server, talkClient] = await Promise.all([
    readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8"),
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../../../packages/talk/miniprogram/ChatEntry.vue", import.meta.url), "utf8")
  ]);
  for (const name of [
    "listDiscoverableSessions",
    "listPublicUpcomingSessions",
    "listPublicSessionAlbumShare",
    "listSessionReviews",
    "listSessionAlbumPeople"
  ]) {
    const start = core.indexOf(`export async function ${name}`);
    const end = core.indexOf("\nexport async function ", start + 1);
    const block = core.slice(start, end === -1 ? undefined : end);
    assert.ok(start >= 0, name);
    assert.doesNotMatch(block, /authorTextReader|author_private|publication_state|content_ref|draft_id/, name);
  }
  const unreadStart = talkClient.indexOf("updateUnreadCount(nextMessages = [])");
  const unreadEnd = talkClient.indexOf("messageErrorText(error)", unreadStart);
  const unreadBlock = talkClient.slice(unreadStart, unreadEnd);
  assert.match(unreadBlock, /publicChatMessages\(nextMessages\)/);
  assert.doesNotMatch(unreadBlock, /author_private|draft_id/);
  for (const name of ["createSignup", "approveSignup", "rejectSignup"]) {
    const start = core.indexOf(`export async function ${name}`);
    const end = core.indexOf("\nexport async function ", start + 1);
    const block = core.slice(start, end === -1 ? undefined : end);
    assert.ok(start >= 0, name);
    assert.doesNotMatch(block, /authorTextReader|author_private|content_ref|draft_id/, name);
  }
  assert.match(server, /public-share/);
  assert.match(server, /\/tags\$/);
  assert.match(server, /\/video-file\$/);
  assert.match(server, /request\.headers\.range/);
  assert.match(server, /\/cover\$/);
});
