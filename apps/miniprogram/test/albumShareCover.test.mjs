import assert from "node:assert/strict";
import test from "node:test";

import {
  ALBUM_SHARE_FRIEND_FALLBACK,
  ALBUM_SHARE_TIMELINE_FALLBACK,
  albumShareCoverResponse,
  albumShareFriendPayload,
  albumShareImage,
  albumShareMenus,
  albumShareTimelinePayload
} from "../src/utils/albumShareCover.js";

test("两个渠道使用不同本地降级图", () => {
  assert.equal(ALBUM_SHARE_FRIEND_FALLBACK, "/static/art/album-share-friend.jpg");
  assert.equal(ALBUM_SHARE_TIMELINE_FALLBACK, "/static/art/album-share-timeline.jpg");
});

test("响应分别归一化 friend 与 timeline URL", () => {
  assert.deepEqual(albumShareCoverResponse({
    friend_cover_url: " friend-generated ",
    cover_url: "legacy-generated",
    timeline_cover_url: " timeline-generated "
  }), {
    friend: "friend-generated",
    timeline: "timeline-generated"
  });
  assert.deepEqual(albumShareCoverResponse({
    cover_url: " friend-generated ",
    timeline_cover_url: " timeline-generated "
  }), {
    friend: "friend-generated",
    timeline: "timeline-generated"
  });
});

test("只开放已准备成功且有 token 的菜单", () => {
  assert.deepEqual(albumShareMenus({ token: "t", friendReady: true, timelineReady: false }), [
    "shareAppMessage"
  ]);
  assert.deepEqual(albumShareMenus({ token: "t", friendReady: true, timelineReady: true }), [
    "shareAppMessage",
    "shareTimeline"
  ]);
  assert.deepEqual(albumShareMenus({ token: "", friendReady: true, timelineReady: true }), []);
});

test("远程图缺失时按渠道返回正确降级图", () => {
  assert.equal(albumShareImage("friend", ""), ALBUM_SHARE_FRIEND_FALLBACK);
  assert.equal(albumShareImage("timeline", ""), ALBUM_SHARE_TIMELINE_FALLBACK);
  assert.throws(() => albumShareImage("poster", ""), /kind/);
});

test("好友与时间线使用各自的微信分享返回结构", () => {
  assert.deepEqual(
    albumShareFriendPayload({
      title: " 好友标题 ",
      path: " /pages/session/album?id=1&albumShareToken=t ",
      imageUrl: " friend-cover "
    }),
    {
      title: "好友标题",
      path: "/pages/session/album?id=1&albumShareToken=t",
      imageUrl: "friend-cover"
    }
  );
  assert.deepEqual(
    albumShareTimelinePayload({
      title: " 时间线标题 ",
      query: " id=1&albumShareToken=t ",
      imageUrl: " timeline-cover "
    }),
    {
      title: "时间线标题",
      query: "id=1&albumShareToken=t",
      imageUrl: "timeline-cover"
    }
  );
});
