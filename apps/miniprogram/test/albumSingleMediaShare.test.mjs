import assert from "node:assert/strict";
import test from "node:test";

import {
  beginSingleMediaShareRequest,
  createFocusedPublicVideoRequestContext,
  createSingleMediaShareAuthority,
  createSingleMediaShareState,
  focusedPublicMedia,
  focusedPublicSnapshotProjection,
  isFocusedPublicVideoRequestCurrent,
  normalizeFocusedMediaId,
  rejectSingleMediaShareRequest,
  resetSingleMediaShareState,
  resolveSingleMediaShareRequest,
  singleMediaShareCardImage,
  singleMediaShareEntryFor,
  singleMediaShareFailClosedPayload,
  singleMediaSharePath,
  singleMediaShareRouteState
} from "../src/utils/albumSingleMediaShare.js";
import * as albumSingleMediaShare from "../src/utils/albumSingleMediaShare.js";

test("public album cards show each safe media category instead of repeating the sharer role", () => {
  assert.equal(typeof albumSingleMediaShare.publicAlbumMediaCaption, "function");
  assert.equal(
    albumSingleMediaShare.publicAlbumMediaCaption(
      { media_type: "image", public_category: "share_subject" },
      "叶辰"
    ),
    "包含 叶辰"
  );
  assert.equal(
    albumSingleMediaShare.publicAlbumMediaCaption(
      { media_type: "image", public_category: "other" },
      "叶辰"
    ),
    "其他"
  );
  assert.equal(
    albumSingleMediaShare.publicAlbumMediaCaption(
      { media_type: "image" },
      "叶辰"
    ),
    "其他"
  );
  assert.equal(
    albumSingleMediaShare.publicAlbumMediaCaption(
      { media_type: "video", public_category: "other" },
      "叶辰"
    ),
    "打开小程序查看视频"
  );
});

test("normalizes only positive safe integer media IDs", () => {
  assert.equal(normalizeFocusedMediaId(12), 12);
  assert.equal(normalizeFocusedMediaId(" 12 "), 12);
  assert.equal(normalizeFocusedMediaId("0012"), 12);

  for (const invalidValue of [0, "0", -1, "-1", 1.5, "1.5", Number.MAX_SAFE_INTEGER + 1, "", "  ", "photo-12", null, undefined]) {
    assert.equal(normalizeFocusedMediaId(invalidValue), null, `expected ${String(invalidValue)} to be invalid`);
  }
});

test("finds only the exact normalized focused public media ID", () => {
  const photos = [{ id: 11, label: "first" }, { id: "12", label: "focused" }];

  assert.equal(focusedPublicMedia(photos, "12"), photos[1]);
  assert.equal(focusedPublicMedia(photos, 13), null);
  assert.equal(focusedPublicMedia(photos, "not-an-id"), null);
  assert.equal(focusedPublicMedia({ 0: photos[0], length: 1 }, 11), null);
});

test("routes every single-media source through the public path and fails closed without token or focus", () => {
  assert.deepEqual(
    singleMediaShareRouteState({
      source: "single_media_share",
      albumShareToken: "snapshot-token",
      focusMediaId: "12"
    }),
    {
      token: "snapshot-token",
      focusMediaId: 12,
      singleMediaShareRequested: true,
      timelineMode: true,
      focusedPublicMode: true,
      focusedPublicMediaUnavailable: false
    }
  );
  for (const options of [
    { source: "single_media_share", focusMediaId: 12 },
    { source: "single_media_share", albumShareToken: "snapshot-token", focusMediaId: "invalid" }
  ]) {
    const route = singleMediaShareRouteState(options);
    assert.equal(route.timelineMode, true);
    assert.equal(route.focusedPublicMode, false);
    assert.equal(route.focusedPublicMediaUnavailable, true);
  }
});

test("projects valid image or ready video snapshots to one exact focused item without fallback", () => {
  const photos = [
    { id: 11, media_type: "image", label: "image" },
    { id: 12, media_type: "video", processing_status: "ready", label: "ready video" }
  ];
  assert.deepEqual(focusedPublicSnapshotProjection(photos, 11), {
    photo: photos[0],
    photos: [photos[0]],
    unavailable: false
  });
  assert.deepEqual(focusedPublicSnapshotProjection(photos, 12), {
    photo: photos[1],
    photos: [photos[1]],
    unavailable: false
  });
  assert.deepEqual(focusedPublicSnapshotProjection(photos, 99), {
    photo: null,
    photos: [],
    unavailable: true
  });
});

test("uses only the same-media share image and a safe explicit fallback", () => {
  assert.equal(singleMediaShareCardImage("wxfile://focused-cover.jpg"), "wxfile://focused-cover.jpg");
  assert.equal(singleMediaShareCardImage(""), "/static/art/ticket-landscape.jpg");
  assert.equal(singleMediaShareCardImage(null), "/static/art/ticket-landscape.jpg");
});

test("returns a credential-free fail-closed payload after a button-cache reset or invalid dataset", () => {
  const authority = createSingleMediaShareAuthority();
  authority.begin(12);
  authority.reset();
  assert.equal(authority.entryFor("not-an-id"), null);
  assert.deepEqual(
    singleMediaShareFailClosedPayload({
      sessionId: 42,
      mediaId: "not-an-id",
      token: "must-not-leak"
    }),
    {
      title: "该内容暂不可分享",
      path: "/pages/session/album?source=single_media_share",
      imageUrl: "/static/art/ticket-landscape.jpg"
    }
  );
});

test("rejects late public video results after focused context deactivates or changes", () => {
  const context = createFocusedPublicVideoRequestContext({
    albumShareToken: "snapshot-token",
    focusMediaId: "12",
    mediaId: 12,
    focusedPublicMode: true,
    previewOverlayVisible: true,
    previewCurrentPhotoId: "12"
  });
  assert.ok(context);
  assert.equal(isFocusedPublicVideoRequestCurrent(context, { ...context }), true);
  for (const changedState of [
    { ...context, albumShareToken: "different-token" },
    { ...context, focusMediaId: 13 },
    { ...context, previewCurrentPhotoId: 11 },
    { ...context, focusedPublicMode: false },
    { ...context, previewOverlayVisible: false }
  ]) {
    assert.equal(isFocusedPublicVideoRequestCurrent(context, changedState), false);
  }
});

test("pure state helpers replace entries without mutating prior snapshots", () => {
  const initial = createSingleMediaShareState();
  const begun = beginSingleMediaShareRequest(initial, 1);
  const resolved = resolveSingleMediaShareRequest(begun.state, begun.request, {
    token: "token-1",
    mediaId: 999
  });

  assert.equal(singleMediaShareEntryFor(initial, 1), null);
  assert.deepEqual(singleMediaShareEntryFor(begun.state, 1), {
    mediaId: 1,
    serial: 1,
    status: "loading"
  });
  assert.deepEqual(singleMediaShareEntryFor(resolved, 1), {
    mediaId: 1,
    serial: 1,
    status: "ready",
    token: "token-1"
  });
});

test("keeps loading and resolved entries under their own media IDs", () => {
  const authority = createSingleMediaShareAuthority();
  const first = authority.begin(1);
  const second = authority.begin("2");
  const firstLoading = authority.currentEntry(1);

  assert.deepEqual(first, { mediaId: 1, serial: 1 });
  assert.deepEqual(second, { mediaId: 2, serial: 2 });
  assert.deepEqual(firstLoading, { mediaId: 1, serial: 1, status: "loading" });

  authority.resolve(second, { status: "ready", token: "token-2", mediaId: 999 });
  authority.resolve(first, { status: "ready", token: "token-1" });

  assert.deepEqual(authority.entryFor(1), { mediaId: 1, serial: 1, status: "ready", token: "token-1" });
  assert.deepEqual(authority.currentEntry(2), { mediaId: 2, serial: 2, status: "ready", token: "token-2" });
  assert.equal(authority.currentEntry(3), null);
  assert.equal(firstLoading.status, "loading", "entry replacement must not mutate a previous entry");
});

test("looks up a button dataset media ID without a live-index fallback", () => {
  const authority = createSingleMediaShareAuthority();
  const first = authority.begin(1);
  const second = authority.begin(2);
  authority.resolve(first, { token: "token-1" });
  authority.resolve(second, { token: "token-2" });
  const buttonDataset = { mediaId: "2" };

  assert.deepEqual(singleMediaShareEntryFor(authority.snapshot(), buttonDataset.mediaId), {
    mediaId: 2,
    serial: second.serial,
    status: "ready",
    token: "token-2"
  });
  assert.deepEqual(authority.entryFor(buttonDataset.mediaId), {
    mediaId: 2,
    serial: second.serial,
    status: "ready",
    token: "token-2"
  });
  assert.equal(authority.entryFor(3), null);
});

test("drops stale same-media resolutions and rejects without overwriting the newer entry", () => {
  const authority = createSingleMediaShareAuthority();
  const first = authority.begin(7);
  const second = authority.begin(8);
  const newerFirst = authority.begin(7);

  authority.resolve(first, { status: "ready", token: "stale" });
  authority.reject(first, { code: "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE" });
  assert.deepEqual(authority.currentEntry(7), {
    mediaId: 7,
    serial: newerFirst.serial,
    status: "loading"
  });
  authority.reject(second, { code: "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE" });
  authority.resolve(newerFirst, { status: "ready", token: "current" });

  assert.deepEqual(authority.currentEntry(7), {
    mediaId: 7,
    serial: newerFirst.serial,
    status: "ready",
    token: "current"
  });
  assert.deepEqual(authority.currentEntry(8), {
    mediaId: 8,
    serial: second.serial,
    status: "blocked",
    error: { code: "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE" }
  });
  assert.equal(authority.currentEntry(9), null);
});

test("stores only frozen safe error fields and preserves unavailable as blocked", () => {
  const initial = createSingleMediaShareState();
  const begun = beginSingleMediaShareRequest(initial, 8);
  const backendError = {
    code: "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE",
    statusCode: 409,
    userMessage: "该内容已不可查看",
    response: { private: "must not be retained" }
  };
  const rejected = rejectSingleMediaShareRequest(begun.state, begun.request, backendError);
  backendError.code = "CHANGED";
  backendError.statusCode = 500;
  backendError.userMessage = "changed";

  const entry = singleMediaShareEntryFor(rejected, 8);
  assert.equal(entry.status, "blocked");
  assert.deepEqual(entry.error, {
    code: "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE",
    statusCode: 409,
    userMessage: "该内容已不可查看"
  });
  assert.equal(Object.isFrozen(entry.error), true);
  assert.equal("response" in entry.error, false);
});

test("reset clears cache without letting old request tokens collide", () => {
  const authority = createSingleMediaShareAuthority();
  const oldRequest = authority.begin(7);
  authority.reset();
  const currentRequest = authority.begin(7);

  assert.notEqual(currentRequest.serial, oldRequest.serial);
  assert.equal(currentRequest.serial > oldRequest.serial, true);
  assert.equal(authority.resolve(oldRequest, { token: "stale" }), null);
  assert.equal(authority.reject(oldRequest, { code: "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE" }), null);
  assert.deepEqual(authority.currentEntry(7), {
    mediaId: 7,
    serial: currentRequest.serial,
    status: "loading"
  });

  authority.resolve(currentRequest, { token: "current" });
  assert.deepEqual(authority.currentEntry(7), {
    mediaId: 7,
    serial: currentRequest.serial,
    status: "ready",
    token: "current"
  });
});

test("pure reset preserves serial while rejecting requests from its prior state", () => {
  const initial = createSingleMediaShareState();
  const oldRequest = beginSingleMediaShareRequest(initial, 7);
  const reset = resetSingleMediaShareState(oldRequest.state);
  const currentRequest = beginSingleMediaShareRequest(reset, 7);

  assert.deepEqual(reset.entries, {});
  assert.deepEqual(reset.latestSerialByMediaId, {});
  assert.equal(reset.serial, oldRequest.request.serial);
  assert.equal(currentRequest.request.serial > oldRequest.request.serial, true);
  assert.equal(
    resolveSingleMediaShareRequest(currentRequest.state, oldRequest.request, { token: "stale" }),
    currentRequest.state
  );
  assert.equal(
    rejectSingleMediaShareRequest(currentRequest.state, oldRequest.request, { code: "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE" }),
    currentRequest.state
  );

  const resolved = resolveSingleMediaShareRequest(currentRequest.state, currentRequest.request, {
    token: "current"
  });
  assert.deepEqual(singleMediaShareEntryFor(resolved, 7), {
    mediaId: 7,
    serial: currentRequest.request.serial,
    status: "ready",
    token: "current"
  });
});

test("builds the exact encoded single-media share path and rejects invalid inputs", () => {
  assert.equal(
    singleMediaSharePath({ sessionId: "42", token: "token&with spaces/?", mediaId: "7" }),
    "/pages/session/album?id=42&source=single_media_share&albumShareToken=token%26with%20spaces%2F%3F&focusMediaId=7"
  );

  for (const input of [
    { sessionId: 0, token: "token", mediaId: 7 },
    { sessionId: 42, token: "", mediaId: 7 },
    { sessionId: 42, token: "   ", mediaId: 7 },
    { sessionId: 42, token: "token", mediaId: 0 }
  ]) {
    assert.equal(singleMediaSharePath(input), "");
  }
});
