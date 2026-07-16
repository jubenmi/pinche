import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildAuthorImageCapabilityUrls,
  createAuthorPrivateMediaView,
  getAuthorMediaPreviewRecord,
  validateAuthorImageCapabilityClaims
} from "../src/modules/content-moderation/author-media-preview.js";

function image(overrides = {}) {
  return {
    id: 41,
    session_id: 9,
    uploader_user_id: 7,
    media_type: "image",
    photo_url: "/uploads/session-album/display/album-9-7-1-a.jpg",
    object_key: "uploads/session-album/display/album-9-7-1-a.jpg",
    object_etag: "etag-image-1",
    moderation_object_version: "etag-image-1",
    author_visibility_version: 1,
    moderation_status: "pending",
    status: "active",
    ...overrides
  };
}

function video(overrides = {}) {
  return {
    id: 42,
    session_id: 9,
    uploader_user_id: 7,
    media_type: "video",
    source_url: "/uploads/session-album/videos/source/album-9-7-source.mp4",
    display_url: "/uploads/session-album/videos/display/album-9-7-display.mp4",
    moderation_object_version: "etag-video-1",
    author_visibility_version: 1,
    moderation_status: "rejected",
    status: "active",
    ...overrides
  };
}

test("D46 image author receives a private view with no storage facts or download capability", () => {
  const view = createAuthorPrivateMediaView(image(), {
    viewerUserId: 7,
    imageEnabled: true,
    videoEnabled: false
  });
  assert.equal(view.publication_state, "author_only");
  assert.equal(view.moderation_message, "仅自己可见 · 审核中");
  assert.equal(view.is_mine, true);
  assert.equal(view.can_preview, true);
  assert.equal(view.can_delete, true);
  assert.equal(view.can_tag, false);
  assert.deepEqual(view.tags, []);
  for (const key of [
    "object_key", "object_etag", "moderation_object_version", "photo_url",
    "source_url", "display_url", "download_url"
  ]) {
    assert.equal(Object.keys(view).includes(key), false, `${key} must not be enumerable`);
  }
  assert.equal(getAuthorMediaPreviewRecord(view).imageObjectKey,
    "uploads/session-album/display/album-9-7-1-a.jpg");
});

test("D46 local image preview accepts only an exact local storage identity", () => {
  const photoUrl = "/uploads/session-album/display/album-9-7-1-a.jpg";
  const version = `local:${photoUrl}:123`;
  const localMedia = image({
    object_key: null,
    object_etag: null,
    image_byte_size: 123,
    moderation_object_version: version
  });
  assert.equal(createAuthorPrivateMediaView(localMedia, {
    viewerUserId: 7,
    imageEnabled: true
  }), null);
  const view = createAuthorPrivateMediaView(localMedia, {
    viewerUserId: 7,
    imageEnabled: true,
    allowLocalD46Preview: true
  });

  assert.equal(view?.publication_state, "author_only");
  assert.equal(getAuthorMediaPreviewRecord(view)?.previewPath, photoUrl);
  assert.equal(getAuthorMediaPreviewRecord(view)?.objectVersion, version);

  for (const invalid of [
    image({ ...localMedia, moderation_object_version: `${version}-changed` }),
    image({ ...localMedia, image_byte_size: null }),
    image({ ...localMedia, object_key: "uploads/session-album/display/album-9-7-1-a.jpg" }),
    image({ ...localMedia, photo_url: "/uploads/session-album/display/../unowned.jpg" })
  ]) {
    assert.equal(createAuthorPrivateMediaView(invalid, {
      viewerUserId: 7,
      imageEnabled: true,
      allowLocalD46Preview: true
    }), null);
  }
});

test("D46 author scope rejects organizer, member, tagged user, admin, anonymous, legacy, and public rows", () => {
  for (const viewerUserId of [1, 2, 3, 99, null]) {
    assert.equal(createAuthorPrivateMediaView(image(), {
      viewerUserId,
      imageEnabled: true,
      videoEnabled: true
    }), null);
  }
  assert.equal(createAuthorPrivateMediaView(image({ author_visibility_version: 0 }), {
    viewerUserId: 7,
    imageEnabled: true
  }), null);
  assert.equal(createAuthorPrivateMediaView(image({ moderation_status: "approved" }), {
    viewerUserId: 7,
    imageEnabled: true
  }), null);
  assert.equal(createAuthorPrivateMediaView(image({ status: "deleting" }), {
    viewerUserId: 7,
    imageEnabled: true
  }), null);
});

test("D46 video author preview chooses a controlled display path then controlled source fallback", () => {
  const display = createAuthorPrivateMediaView(video(), {
    viewerUserId: 7,
    videoEnabled: true
  });
  assert.equal(getAuthorMediaPreviewRecord(display).previewPath,
    "/uploads/session-album/videos/display/album-9-7-display.mp4");
  assert.equal(display.moderation_message, "仅自己可见 · 未通过");
  assert.equal(display.can_resubmit, false);

  const source = createAuthorPrivateMediaView(video({ display_url: "/invalid/display.mp4" }), {
    viewerUserId: 7,
    videoEnabled: true
  });
  assert.equal(getAuthorMediaPreviewRecord(source).previewPath,
    "/uploads/session-album/videos/source/album-9-7-source.mp4");
  assert.equal(createAuthorPrivateMediaView(video({
    display_url: "/invalid/display.mp4",
    source_url: "/invalid/source.mp4"
  }), { viewerUserId: 7, videoEnabled: true }), null);
});

test("D46 image capability lasts at most 60 seconds and closes on row/version change", () => {
  const view = createAuthorPrivateMediaView(image(), {
    viewerUserId: 7,
    imageEnabled: true
  });
  const captured = [];
  const fingerprint = (record) => `fp:${record.objectVersion}:${record.previewPath}`;
  const urls = buildAuthorImageCapabilityUrls(view, {
    nowSeconds: 1000,
    ttlSeconds: 60,
    fingerprint,
    signToken: (claims) => {
      captured.push(claims);
      return `signed-${claims.variant}`;
    }
  });
  assert.equal(urls.media_url_expires_at, "1970-01-01T00:17:40.000Z");
  assert.match(urls.preview_display_url, /author-media\/images\/41\/preview\?token=signed-preview/);
  assert.match(urls.thumbnail_display_url, /token=signed-thumbnail/);
  assert.equal(urls.download_url, null);
  assert.equal(captured[0].exp - captured[0].iat, 60);
  assert.equal("objectVersion" in captured[0], false);
  assert.ok(validateAuthorImageCapabilityClaims(image(), captured[0], {
    nowSeconds: 1000,
    ttlSeconds: 60,
    fingerprint
  }));
  assert.ok(validateAuthorImageCapabilityClaims(image(), captured[0], {
    nowSeconds: captured[0].exp - 1,
    ttlSeconds: 60,
    fingerprint
  }));
  assert.equal(validateAuthorImageCapabilityClaims(image(), captured[0], {
    nowSeconds: captured[0].exp,
    ttlSeconds: 60,
    fingerprint
  }), null);
  assert.equal(validateAuthorImageCapabilityClaims(image({ object_etag: "changed" }), captured[0], {
    nowSeconds: 1000,
    ttlSeconds: 60,
    fingerprint
  }), null);
  assert.throws(() => buildAuthorImageCapabilityUrls(view, {
    nowSeconds: 1000,
    ttlSeconds: 61,
    fingerprint,
    signToken: () => "token"
  }), /1 and 60/);
});

test("D46 server keeps author preview routes separate from approved public media routes", async () => {
  const [core, server] = await Promise.all([
    readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8"),
    readFile(new URL("../src/server.js", import.meta.url), "utf8")
  ]);
  assert.match(core, /getAuthorAlbumImagePreview/);
  assert.match(core, /getAuthorAlbumVideoPreview/);
  assert.match(
    core,
    /getAuthorAlbumMediaPreview[\s\S]*withTransaction[\s\S]*findById\([\s\S]*forUpdate: true[\s\S]*options\.consume\(media, record\)/,
    "author media authorization must keep the row lock through preview consumption"
  );
  assert.match(server, /author-media\\\/images/);
  assert.match(
    server,
    /getAuthorAlbumImagePreview\([\s\S]*consume: async \(media\)[\s\S]*serveUploadedSessionAlbumPhoto/,
    "author image bytes must be consumed while the locked row is still valid"
  );
  assert.match(
    server,
    /getAuthorAlbumVideoPreview\([\s\S]*consume: async \(_media, record\)[\s\S]*signedCosAlbumVideoUrl/,
    "author video URL must be signed while the locked row is still valid"
  );
  assert.match(server, /buildAuthorImageCapabilityUrls/);
  assert.match(server, /CONTENT_MODERATION_AUTHOR_PREVIEW_TTL_SECONDS|authorPreviewTtlSeconds/);
  const publicGetter = core.slice(
    core.indexOf("export async function getVisibleSessionAlbumPhotoForMedia"),
    core.indexOf("export async function getPublicSessionAlbumPhotoForMedia")
  );
  assert.doesNotMatch(publicGetter, /author_visibility_version|author_only/);
});
