import assert from "node:assert/strict";
import test from "node:test";

import {
  albumShareCoverRecipe,
  albumShareFriendPayload,
  albumShareLocalImagePath,
  albumShareMenus,
  albumShareTimelinePayload,
  selectAlbumShareTimelineImage
} from "../src/utils/albumShareCover.js";

const response = {
  cover_recipe: {
    version: "client-canvas-v1",
    images: [
      { id: 41, thumbnail_url: "/api/thumb/41?token=t" },
      { id: 52, thumbnail_url: "/api/thumb/52?token=t" }
    ]
  }
};

test("cover recipe ignores legacy composite URLs", () => {
  assert.equal(albumShareCoverRecipe(response), response.cover_recipe);
  assert.equal(albumShareCoverRecipe({
    cover_url: "https://cdn.test/legacy.jpg"
  }), null);
});

test("representative image prefers the first candidate local preview", () => {
  assert.equal(selectAlbumShareTimelineImage({
    response,
    localPreviewByMediaId: new Map([[41, "wxfile://tmp/41.jpg"]]),
    thumbnailUrlResolver: (url) => `https://api.test${url}`
  }), "wxfile://tmp/41.jpg");
});

test("representative image falls back to the same candidate online thumbnail", () => {
  assert.equal(selectAlbumShareTimelineImage({
    response,
    localPreviewByMediaId: new Map([[41, "https://private.test/41.jpg"]]),
    thumbnailUrlResolver: (url) => `https://api.test${url}`
  }), "https://api.test/api/thumb/41?token=t");
});

test("representative image skips a fully unusable first candidate", () => {
  assert.equal(selectAlbumShareTimelineImage({
    response: {
      cover_recipe: {
        images: [
          { id: 41, thumbnail_url: "" },
          { id: 52, thumbnail_url: "/api/thumb/52?token=t" }
        ]
      }
    },
    localPreviewByMediaId: {},
    thumbnailUrlResolver: (url) => `https://api.test${url}`
  }), "https://api.test/api/thumb/52?token=t");
});

test("only WeChat temporary paths count as local previews", () => {
  assert.equal(albumShareLocalImagePath("wxfile://tmp/cover.jpg"), "wxfile://tmp/cover.jpg");
  assert.equal(albumShareLocalImagePath("http://tmp/cover.jpg"), "http://tmp/cover.jpg");
  assert.equal(albumShareLocalImagePath("/private/tmp/cover.jpg"), "/private/tmp/cover.jpg");
  assert.equal(albumShareLocalImagePath("https://cdn.test/cover.jpg"), "");
  assert.equal(albumShareLocalImagePath("/static/cover.jpg"), "");
});

test("representative image returns empty when no candidate is usable", () => {
  assert.equal(selectAlbumShareTimelineImage({
    response: { cover_recipe: { images: [{ id: 41, thumbnail_url: "" }] } }
  }), "");
});

test("friend payload omits imageUrl and timeline payload requires a real image", () => {
  const friend = albumShareFriendPayload({
    title: " 相册 ",
    path: " /pages/session/album?id=1 "
  });
  assert.deepEqual(friend, {
    title: "相册",
    path: "/pages/session/album?id=1"
  });
  assert.equal(Object.hasOwn(friend, "imageUrl"), false);

  assert.equal(albumShareTimelinePayload({
    title: "相册",
    query: "id=1",
    imageUrl: ""
  }), null);
  assert.equal(albumShareTimelinePayload({
    title: "相册",
    query: "id=1",
    imageUrl: "/static/fallback.jpg"
  }), null);
  assert.deepEqual(albumShareTimelinePayload({
    title: " 相册 ",
    query: " id=1 ",
    imageUrl: "https://api.test/thumb.jpg"
  }), {
    title: "相册",
    query: "id=1",
    imageUrl: "https://api.test/thumb.jpg"
  });
});

test("share menu adds Moments only after a representative image is ready", () => {
  assert.deepEqual(albumShareMenus({ token: "t", timelineReady: false }), [
    "shareAppMessage"
  ]);
  assert.deepEqual(albumShareMenus({ token: "t", timelineReady: true }), [
    "shareAppMessage",
    "shareTimeline"
  ]);
  assert.deepEqual(albumShareMenus({ token: "", timelineReady: true }), []);
});
