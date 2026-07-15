import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  authorPrivateContentModerationStatusText
} from "../src/utils/contentModeration.js";
import {
  isAuthorPrivateAlbumMedia,
  isCurrentPreviewableAlbumMedia,
  normalizeAuthorPrivateAlbumImageUrls,
  pruneAlbumMediaPreviewCache
} from "../src/utils/albumMediaUrls.js";

function authorImage(overrides = {}) {
  return {
    id: 41,
    uploader_user_id: 7,
    media_type: "image",
    moderation_status: "rejected",
    publication_state: "author_only",
    is_mine: true,
    can_preview: true,
    can_delete: true,
    can_tag: false,
    thumbnail_display_url: "/api/content-moderation/author-media/images/41/preview?token=thumb",
    preview_display_url: "/api/content-moderation/author-media/images/41/preview?token=preview",
    download_url: "must-never-be-used",
    ...overrides
  };
}

test("D46 author media uses exactly the three safe private status messages", () => {
  for (const status of ["pending", "processing", "error"]) {
    assert.equal(authorPrivateContentModerationStatusText(status), "仅自己可见 · 审核中");
  }
  assert.equal(authorPrivateContentModerationStatusText("review"), "仅自己可见 · 进一步审核");
  assert.equal(authorPrivateContentModerationStatusText("rejected"), "仅自己可见 · 未通过");
  assert.equal(authorPrivateContentModerationStatusText("approved"), "");
  assert.equal(authorPrivateContentModerationStatusText("unknown"), "");
});

test("D46 author media identity requires the current uploader and never applies to public rows", () => {
  assert.equal(isAuthorPrivateAlbumMedia(authorImage(), 7), true);
  for (const [row, viewerUserId] of [
    [authorImage(), 8],
    [authorImage({ uploader_user_id: null }), 7],
    [authorImage({ is_mine: false }), 7],
    [authorImage({ can_preview: false }), 7],
    [authorImage({ publication_state: "public" }), 7],
    [authorImage({ moderation_status: "approved" }), 7]
  ]) {
    assert.equal(isAuthorPrivateAlbumMedia(row, viewerUserId), false);
  }
});

test("D46 author image URLs are preview-only and cannot become download candidates", () => {
  assert.deepEqual(normalizeAuthorPrivateAlbumImageUrls(authorImage(), 7), {
    thumbnailUrl: "/api/content-moderation/author-media/images/41/preview?token=thumb",
    previewUrl: "/api/content-moderation/author-media/images/41/preview?token=preview",
    downloadUrl: "",
    expiresAt: ""
  });
  assert.deepEqual(normalizeAuthorPrivateAlbumImageUrls(authorImage(), 8), {
    thumbnailUrl: "",
    previewUrl: "",
    downloadUrl: "",
    expiresAt: ""
  });
});

test("D46 preview authority accepts current author rows only outside timeline mode", () => {
  const row = authorImage();
  assert.equal(isCurrentPreviewableAlbumMedia([row], row, {
    viewerUserId: 7,
    timelineMode: false
  }), true);
  assert.equal(isCurrentPreviewableAlbumMedia([row], row, {
    viewerUserId: 7,
    timelineMode: true
  }), false);
  assert.equal(isCurrentPreviewableAlbumMedia([row], row, {
    viewerUserId: 8,
    timelineMode: false
  }), false);
  assert.equal(isCurrentPreviewableAlbumMedia([], row, {
    viewerUserId: 7,
    timelineMode: false
  }), false);
});

test("D46 private preview cache follows the current server row and current account", () => {
  const cache = {
    41: { thumbnail: "private-memory-url", preview: "private-memory-preview" },
    42: { thumbnail: "public-memory-url" },
    43: { thumbnail: "removed-url" }
  };
  const publicPhoto = { id: 42, moderation_status: "approved" };
  assert.deepEqual(pruneAlbumMediaPreviewCache(cache, [authorImage(), publicPhoto], {
    viewerUserId: 7,
    timelineMode: false
  }), {
    41: cache[41],
    42: cache[42]
  });
  assert.deepEqual(pruneAlbumMediaPreviewCache(cache, [authorImage(), publicPhoto], {
    viewerUserId: 8,
    timelineMode: false
  }), {
    42: cache[42]
  });
});

test("D46 album page renders private previews but clears them on hide and keeps propagation disabled", async () => {
  const source = await readFile(new URL("../src/pages/session/album.vue", import.meta.url), "utf8");
  assert.match(source, /isCurrentPreviewableAlbumMedia/);
  assert.match(source, /normalizeAuthorPrivateAlbumImageUrls/);
  assert.match(source, /:allow-download="previewAllowsDownload"/);
  assert.match(source, /onHide\(\)\s*\{[\s\S]*clearAuthorPrivateAlbumState/);
  assert.match(source, /AUTH_CHANGE_EVENT/);
  assert.match(source, /uni\.\$on\(AUTH_CHANGE_EVENT, this\.handleAlbumAuthChange\)/);
  assert.match(source, /uni\.\$off\(AUTH_CHANGE_EVENT, this\.handleAlbumAuthChange\)/);
  assert.match(source, /clearAuthorPrivateAlbumState\(\)/);
  assert.match(source, /variant === "download"/);
  assert.match(source, /isDownloadableAlbumImage\(photo\)/);
  assert.match(source, /photo\.can_tag/);
  const authorImageLoad = source.slice(
    source.indexOf("async downloadAlbumImage(photo"),
    source.indexOf("async retryCurrentMediaAfterAuthFailure")
  );
  assert.match(authorImageLoad, /isAuthorPrivateAlbumMedia\(targetPhoto\)/);
  assert.match(authorImageLoad, /const previewUrl = this\.mediaUrlForPhoto\(targetPhoto, variant\)/);
  assert.match(authorImageLoad, /return previewUrl/);
});

test("D46 account changes clear old private state before onShow may skip a refresh", async () => {
  const source = await readFile(new URL("../src/pages/session/album.vue", import.meta.url), "utf8");
  const onShow = source.slice(
    source.indexOf("async onShow()"),
    source.indexOf("onHide()", source.indexOf("async onShow()"))
  );
  const accountShow = onShow.slice(onShow.indexOf("const auth = getCurrentUser()"));
  assert.ok(accountShow.indexOf("this.handleAlbumAuthChange(auth)") >= 0);
  assert.ok(accountShow.indexOf("this.handleAlbumAuthChange(auth)") < accountShow.indexOf("this.consumePreviewReturnRefreshSkip()"));
  const authChange = source.slice(
    source.indexOf("handleAlbumAuthChange(auth = {})"),
    source.indexOf("updateTopActionsFloating()", source.indexOf("handleAlbumAuthChange(auth = {})"))
  );
  assert.match(authChange, /this\.clearAuthorPrivateAlbumState\(\)/);
  assert.ok(authChange.indexOf("this.clearAuthorPrivateAlbumState()") < authChange.indexOf("this.currentUserId = nextUserId"));
});
