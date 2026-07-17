import assert from "node:assert/strict";
import test from "node:test";

import {
  createAlbumMediaRefreshController,
  normalizeAlbumImageUrls
} from "../src/utils/albumMediaUrls.js";
import * as albumMediaUrlHelpers from "../src/utils/albumMediaUrls.js";

test("signed fields win while old and local paths remain compatible", () => {
  assert.deepEqual(normalizeAlbumImageUrls({
    id: 1,
    thumbnail_display_url: "cos-thumb",
    preview_display_url: "cos-preview",
    download_url: "cos-download",
    thumbnail_load_url: "api-thumb",
    preview_load_url: "api-preview"
  }), {
    thumbnailUrl: "cos-thumb",
    previewUrl: "cos-preview",
    downloadUrl: "cos-download",
    expiresAt: ""
  });
  assert.deepEqual(normalizeAlbumImageUrls({
    image_url: "legacy", thumbnail_load_url: "api-thumb", preview_load_url: "api-preview"
  }), {
    thumbnailUrl: "api-thumb",
    previewUrl: "api-preview",
    downloadUrl: "api-preview",
    expiresAt: ""
  });
});

test("concurrent refreshes cause one full-album reload and preserve page state", async () => {
  let loads = 0;
  let album = {
    photos: [{
      id: 1,
      moderation_status: "approved",
      preview_display_url: "old",
      local_preview_path: "wxfile://one"
    }],
    activeFilter: "mine",
    selectedPhotoIds: [1],
    scrollTop: 123,
    previewCurrentIndex: 4
  };
  const controller = createAlbumMediaRefreshController({
    readAlbum: () => album,
    writeAlbum: (next) => { album = next; },
    reloadAlbum: async () => {
      loads += 1;
      return { photos: [{ id: 1, moderation_status: "approved", preview_display_url: "new" }] };
    },
    setTimer: () => 1,
    clearTimer: () => {},
    now: () => Date.parse("2026-07-11T01:04:40.000Z")
  });
  await Promise.all([controller.refresh(), controller.refresh(), controller.refresh()]);
  assert.equal(loads, 1);
  assert.equal(album.photos[0].preview_display_url, "new");
  assert.equal(album.photos[0].local_preview_path, "wxfile://one");
  assert.equal(album.activeFilter, "mine");
  assert.deepEqual(album.selectedPhotoIds, [1]);
  assert.equal(album.scrollTop, 123);
  assert.equal(album.previewCurrentIndex, 4);
});

test("timer schedules 30 seconds early, onShow checks suspended expiry, and dispose clears", async () => {
  const nowMs = Date.parse("2026-07-11T01:00:00.000Z");
  let album = {
    photos: [{ id: 1, media_url_expires_at: "2026-07-11T01:05:00.000Z" }]
  };
  const delays = [];
  const cleared = [];
  let loads = 0;
  let currentNow = nowMs;
  const controller = createAlbumMediaRefreshController({
    readAlbum: () => album,
    writeAlbum: (next) => { album = next; },
    reloadAlbum: async () => {
      loads += 1;
      return { photos: [{ id: 1, media_url_expires_at: "2026-07-11T01:10:00.000Z" }] };
    },
    setTimer: (_callback, delay) => { delays.push(delay); return 17; },
    clearTimer: (timer) => cleared.push(timer),
    now: () => currentNow
  });
  controller.schedule();
  assert.equal(delays[0], 270_000);
  currentNow = Date.parse("2026-07-11T01:04:40.000Z");
  await controller.checkNow();
  assert.equal(loads, 1);
  controller.dispose();
  assert.equal(cleared.includes(17), true);
});

test("public-share reload is supplied as a closure and remains single-flight", async () => {
  const calls = [];
  let album = { photos: [] };
  const controller = createAlbumMediaRefreshController({
    readAlbum: () => album,
    writeAlbum: (next) => { album = next; },
    reloadAlbum: async () => { calls.push("public-share-token"); return { photos: [] }; },
    setTimer: () => 1,
    clearTimer: () => {}
  });
  await Promise.all([controller.refresh(), controller.refresh()]);
  assert.deepEqual(calls, ["public-share-token"]);
});

test("stale refresh result skips the list write", async () => {
  let writes = 0;
  let album = {
    photos: [{ id: 1, moderation_status: "rejected" }]
  };
  const controller = createAlbumMediaRefreshController({
    readAlbum: () => album,
    writeAlbum: (next) => {
      writes += 1;
      album = next;
    },
    reloadAlbum: async () => null,
    setTimer: () => 1,
    clearTimer: () => {}
  });

  await controller.refresh();
  assert.equal(writes, 0);
  assert.deepEqual(album.photos, [{ id: 1, moderation_status: "rejected" }]);
});

test("refresh rechecks list authority immediately before writing", async () => {
  let writes = 0;
  const controller = createAlbumMediaRefreshController({
    readAlbum: () => ({ photos: [{ id: 1, moderation_status: "rejected" }] }),
    writeAlbum: () => { writes += 1; },
    reloadAlbum: async () => ({
      photos: [{ id: 1, moderation_status: "approved", preview_display_url: "late-url" }],
      isCurrent: () => false
    }),
    setTimer: () => 1,
    clearTimer: () => {}
  });

  await controller.refresh();
  assert.equal(writes, 0);
});

test("refresh drops a response invalidated after its initial list check", async () => {
  const authority = albumMediaUrlHelpers.createAlbumListRequestAuthority();
  const response = deferred();
  let writes = 0;
  const controller = createAlbumMediaRefreshController({
    readAlbum: () => ({ photos: [{ id: 1, moderation_status: "rejected" }] }),
    writeAlbum: () => { writes += 1; },
    reloadAlbum: async () => {
      const request = authority.begin();
      const photos = await response.promise;
      assert.equal(authority.isCurrent(request), true, "initial response check accepts its token");
      authority.begin();
      return {
        photos,
        isCurrent: () => authority.isCurrent(request)
      };
    },
    setTimer: () => 1,
    clearTimer: () => {}
  });

  const refresh = controller.refresh();
  response.resolve([{ id: 1, moderation_status: "approved", preview_display_url: "late-url" }]);
  await refresh;
  assert.equal(writes, 0);
});

test("album page uses one-step finalize, one auth retry, signed download, and lifecycle disposal", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/pages/session/album.vue", import.meta.url), "utf8")
  );
  const uploadStart = source.indexOf("async uploadChosenPhotos");
  const uploadEnd = source.indexOf("deletePhoto(photo)", uploadStart);
  const uploadBlock = source.slice(uploadStart, uploadEnd);
  assert.match(uploadBlock, /uploadAlbumPhoto\(\{/);
  assert.doesNotMatch(uploadBlock, /data:\s*\{\s*photoUrl/);
  assert.match(source, /mediaRefreshAttempts/);
  assert.match(source, /MEDIA_URL_EXPIRED/);
  assert.match(source, /photo\.download_url/);
  assert.match(source, /albumMediaRefresh\?\.dispose\(\)/);
  assert.match(source, /shouldAttachApiAuthorization\(imageUrl, getApiBaseUrl\(\)\)/);
});

test("prunes cached media for removed or unapproved rows", () => {
  assert.equal(typeof albumMediaUrlHelpers.pruneUnpublishedAlbumMediaCache, "function");
  const cache = {
    1: { thumbnail: "wxfile://approved-thumb", preview: "wxfile://approved-preview" },
    2: { thumbnail: "wxfile://pending-thumb", preview: "wxfile://pending-preview" },
    3: { thumbnail: "wxfile://removed-thumb" }
  };
  assert.deepEqual(
    albumMediaUrlHelpers.pruneUnpublishedAlbumMediaCache(cache, [
      { id: 1, moderation_status: "approved" },
      { id: 2, moderation_status: "pending" }
    ]),
    {
      1: { thumbnail: "wxfile://approved-thumb", preview: "wxfile://approved-preview" }
    }
  );
});

test("only accepts async media writes for the still-published current row", () => {
  assert.equal(typeof albumMediaUrlHelpers.isCurrentPublishedAlbumMedia, "function");
  const requestPhoto = { id: 1, moderation_status: "approved" };
  assert.equal(
    albumMediaUrlHelpers.isCurrentPublishedAlbumMedia(
      [{ id: 1, moderation_status: "approved" }],
      requestPhoto
    ),
    true
  );
  for (const photos of [
    [{ id: 1, moderation_status: "pending" }],
    [{ id: 1, moderation_status: "rejected" }],
    [],
    [{ id: 1 }]
  ]) {
    assert.equal(albumMediaUrlHelpers.isCurrentPublishedAlbumMedia(photos, requestPhoto), false);
  }
});

test("album page uses the approved download helper for candidates and blocks cached unapproved previews", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/pages/session/album.vue", import.meta.url), "utf8")
  );
  const candidateBlock = source.slice(
    source.indexOf("downloadablePhotos()"),
    source.indexOf("previewCurrentPhoto()")
  );
  const downloadBlock = source.slice(
    source.indexOf("async downloadSelectedPhotos"),
    source.indexOf("goPrivacy()")
  );
  const previewBlock = source.slice(
    source.indexOf("canOpenPhotoPreview(photo)"),
    source.indexOf("disconnectPhotoObservers()", source.indexOf("canOpenPhotoPreview(photo)"))
  );

  assert.match(candidateBlock, /isApprovedAlbumImageDownloadCandidate/);
  assert.match(downloadBlock, /isApprovedAlbumImageDownloadCandidate/);
  assert.match(downloadBlock, /isCurrentPublishedAlbumMedia\(photo\)/);
  assert.match(previewBlock, /isModerationPublished\(photo\?\.moderation_status\)/);
  assert.match(source, /pruneUnpublishedAlbumMediaCache/);
  assert.match(source, /isCurrentPublishedAlbumMedia/);
  assert.match(source, /mediaLoadSerial \+= 1/);
});

test("onShow forces a server refresh so a revoked cached video is pruned", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/pages/session/album.vue", import.meta.url), "utf8")
  );
  const onShowBlock = source.slice(
    source.indexOf("async onShow()"),
    source.indexOf("onUnload()", source.indexOf("async onShow()"))
  );

  assert.match(onShowBlock, /await this\.albumMediaRefresh\?\.refresh\(\)/);
  assert.doesNotMatch(onShowBlock, /checkNow/);
  assert.match(source, /pruneUnpublishedAlbumMediaState\(this\.photos\)/);
});

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function applyLatestAlbumList(state, photos) {
  state.photos = photos;
  state.visiblePhotoMedia = albumMediaUrlHelpers.pruneUnpublishedAlbumMediaCache(
    state.visiblePhotoMedia,
    photos
  );
  state.previewPhotos = state.previewPhotos.filter((photo) =>
    photos.some(
      (current) =>
        String(current.id) === String(photo.id) &&
        current.moderation_status === "approved"
    )
  );
  if (!state.previewPhotos.length) {
    state.previewOverlayVisible = false;
  }
}

test("shared list authority drops late approved member and public responses", async () => {
  assert.equal(typeof albumMediaUrlHelpers.createAlbumListRequestAuthority, "function");

  for (const mode of ["member", "public"]) {
    const authority = albumMediaUrlHelpers.createAlbumListRequestAuthority();
    const oldApproved = deferred();
    const newestResult = deferred();
    const state = {
      photos: [{ id: 1, moderation_status: "approved", preview_display_url: "old-approved-url" }],
      visiblePhotoMedia: { 1: { preview: "wxfile://old-approved-preview" } },
      previewPhotos: [{ id: 1, moderation_status: "approved" }],
      previewOverlayVisible: true
    };
    const applyWhenCurrent = async (response) => {
      const request = authority.begin();
      const photos = await response;
      if (!authority.isCurrent(request)) {
        return false;
      }
      applyLatestAlbumList(state, photos);
      return true;
    };

    const oldWrite = applyWhenCurrent(oldApproved.promise);
    const newestWrite = applyWhenCurrent(newestResult.promise);
    newestResult.resolve(
      mode === "member"
        ? [{ id: 1, moderation_status: "rejected", preview_display_url: "" }]
        : []
    );
    assert.equal(await newestWrite, true, `${mode} newest response applies`);
    oldApproved.resolve([{ id: 1, moderation_status: "approved", preview_display_url: "late-url" }]);
    assert.equal(await oldWrite, false, `${mode} late response is ignored`);
    assert.equal(state.visiblePhotoMedia[1], undefined, `${mode} cache stays pruned`);
    assert.deepEqual(state.previewPhotos, [], `${mode} preview stays removed`);
    assert.equal(state.previewOverlayVisible, false, `${mode} preview stays closed`);
    if (mode === "member") {
      assert.equal(state.photos[0].moderation_status, "rejected");
      assert.equal(state.photos[0].preview_display_url, "");
    } else {
      assert.deepEqual(state.photos, []);
    }
  }
});

test("current member and public refresh access loss clears cached media", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/pages/session/album.vue", import.meta.url), "utf8")
  );
  const refreshBlock = source.slice(
    source.indexOf("initializeAlbumMediaRefreshController() {"),
    source.indexOf("async loadAlbum()")
  );
  const memberBlock = source.slice(
    source.indexOf("async loadAlbum()"),
    source.indexOf("async loadPublicAlbum()")
  );
  assert.match(refreshBlock, /error\?\.statusCode === 401/);
  assert.match(refreshBlock, /error\?\.statusCode === 403/);
  assert.match(refreshBlock, /photos:\s*\[\]/);
  assert.match(memberBlock, /error\?\.statusCode === 401/);
  assert.match(memberBlock, /error\?\.statusCode === 403/);

  for (const mode of ["member", "public"]) {
    const authority = albumMediaUrlHelpers.createAlbumListRequestAuthority();
    const request = authority.begin();
    const state = {
      photos: [{ id: 1, moderation_status: "approved", preview_display_url: "old-approved-url" }],
      visiblePhotoMedia: { 1: { preview: "wxfile://old-approved-preview" } },
      previewPhotos: [{ id: 1, moderation_status: "approved" }],
      previewOverlayVisible: true
    };
    const controller = createAlbumMediaRefreshController({
      readAlbum: () => ({ photos: state.photos }),
      writeAlbum: (next) => applyLatestAlbumList(state, next.photos),
      reloadAlbum: async () => ({
        photos: [],
        isCurrent: () => authority.isCurrent(request)
      }),
      setTimer: () => 1,
      clearTimer: () => {}
    });

    await controller.refresh();
    assert.deepEqual(state.photos, [], `${mode} list clears`);
    assert.deepEqual(state.visiblePhotoMedia, {}, `${mode} cache clears`);
    assert.deepEqual(state.previewPhotos, [], `${mode} preview rows clear`);
    assert.equal(state.previewOverlayVisible, false, `${mode} preview closes`);
  }
});

test("album page shares list authority across direct and refresh reads", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/pages/session/album.vue", import.meta.url), "utf8")
  );
  const refreshBlock = source.slice(
    source.indexOf("initializeAlbumMediaRefreshController()"),
    source.indexOf("async loadAlbum()")
  );
  const memberBlock = source.slice(
    source.indexOf("async loadAlbum()"),
    source.indexOf("async loadPublicAlbum()")
  );
  const publicBlock = source.slice(
    source.indexOf("async loadPublicAlbum()"),
    source.indexOf("normalizeAlbumMediaUrl(path)")
  );

  assert.match(source, /createAlbumListRequestAuthority/);
  assert.match(
    refreshBlock,
    /isCurrent:\s*\(\)\s*=>\s*this\.isCurrentAlbumListRequest\(listRequest\)/
  );
  for (const block of [refreshBlock, memberBlock, publicBlock]) {
    assert.match(block, /this\.beginAlbumListRequest\(\)/);
    assert.match(block, /this\.isCurrentAlbumListRequest\(listRequest\)/);
  }
});

test("waterfall drops delayed snapshots and replaces delayed event rows with canonical media", async () => {
  assert.equal(typeof albumMediaUrlHelpers.createAlbumWaterfallRenderAuthority, "function");
  assert.equal(typeof albumMediaUrlHelpers.findCurrentAlbumMediaRow, "function");

  const authority = albumMediaUrlHelpers.createAlbumWaterfallRenderAuthority();
  const delayedRender = authority.begin();
  const currentRender = authority.begin();
  const oldApproved = {
    id: 17,
    moderation_status: "approved",
    preview_display_url: "https://stale.example.test/approved.jpg"
  };
  const rejected = { id: 17, moderation_status: "rejected", preview_display_url: "" };
  let waterfallPhotos = [];
  const writeSnapshotIfCurrent = (render, photos) => {
    if (authority.isCurrent(render)) waterfallPhotos = photos;
  };

  writeSnapshotIfCurrent(currentRender, [rejected]);
  writeSnapshotIfCurrent(delayedRender, [oldApproved]);
  assert.deepEqual(waterfallPhotos, [rejected]);

  assert.deepEqual(
    albumMediaUrlHelpers.findCurrentAlbumMediaRow([rejected], oldApproved),
    rejected
  );
  assert.equal(albumMediaUrlHelpers.findCurrentAlbumMediaRow([], oldApproved), null);
  const filteredOutRows = [];
  const delayedEventRows = [];
  const currentPhoto = albumMediaUrlHelpers.findCurrentAlbumMediaRow(
    filteredOutRows,
    oldApproved
  );
  if (currentPhoto) delayedEventRows.push(currentPhoto);
  assert.deepEqual(delayedEventRows, []);

  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/pages/session/album.vue", import.meta.url), "utf8")
  );
  const refreshBlock = source.slice(
    source.indexOf("    refreshWaterfall() {"),
    source.indexOf("    changeWaterfallList(event) {")
  );
  const changeBlock = source.slice(
    source.indexOf("    changeWaterfallList(event) {"),
    source.indexOf("    photoDomId(photo) {")
  );
  assert.match(source, /albumWaterfallRenderAuthority:\s*createAlbumWaterfallRenderAuthority\(\)/);
  assert.match(refreshBlock, /const waterfallRender = this\.albumWaterfallRenderAuthority\.begin\(\)/);
  assert.match(refreshBlock, /isCurrent\(waterfallRender\)/);
  assert.match(changeBlock, /findCurrentAlbumMediaRow\(this\.filteredPhotos, event\.value\)/);
  assert.match(changeBlock, /push\(currentPhoto\)/);
});

test("only the current async media request may clear its request-map slot", async () => {
  assert.equal(typeof albumMediaUrlHelpers.clearAlbumMediaRequestIfCurrent, "function");

  const previousRequest = {};
  const currentRequest = {};
  const requestKey = "17:thumbnail";
  assert.deepEqual(
    albumMediaUrlHelpers.clearAlbumMediaRequestIfCurrent(
      { [requestKey]: currentRequest },
      requestKey,
      previousRequest
    ),
    { [requestKey]: currentRequest }
  );
  assert.deepEqual(
    albumMediaUrlHelpers.clearAlbumMediaRequestIfCurrent(
      { [requestKey]: currentRequest },
      requestKey,
      currentRequest
    ),
    {}
  );

  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/pages/session/album.vue", import.meta.url), "utf8")
  );
  const visibleMediaBlock = source.slice(
    source.indexOf("async loadVisiblePhotoMedia"),
    source.indexOf("onPhotoVisible(photo)")
  );
  const previewVideoBlock = source.slice(
    source.indexOf("loadPreviewVideoUrl(photo, options = {})"),
    source.indexOf("handlePreviewDownload(event)")
  );
  assert.match(visibleMediaBlock, /clearAlbumMediaRequestIfCurrent\(/);
  assert.match(previewVideoBlock, /clearAlbumMediaRequestIfCurrent\(/);
});
