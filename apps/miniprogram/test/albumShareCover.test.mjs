import assert from "node:assert/strict";
import test from "node:test";

import {
  ALBUM_SHARE_FRIEND_FALLBACK,
  ALBUM_SHARE_TIMELINE_FALLBACK,
  albumShareCoverResponse,
  albumShareFriendPayload,
  albumShareImage,
  albumShareMenus,
  albumShareTimelinePayload,
  createAlbumShareRequestAuthority,
  startAlbumShareCoverPreparation
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

test("好友封面完成后不等待慢速时间线封面，并跳过过期结果", async () => {
  let resolveFriend;
  let resolveTimeline;
  let current = true;
  const prepared = [];
  const jobs = startAlbumShareCoverPreparation({
    response: {
      friend_cover_url: "friend-generated",
      timeline_cover_url: "timeline-generated"
    },
    prepare(kind) {
      return new Promise((resolve) => {
        if (kind === "friend") resolveFriend = resolve;
        else resolveTimeline = resolve;
      });
    },
    isCurrent: () => current,
    onPrepared: (kind, imageUrl) => prepared.push({ kind, imageUrl })
  });

  await Promise.resolve();
  resolveFriend("friend-ready");
  await jobs[0];
  assert.deepEqual(prepared, [{ kind: "friend", imageUrl: "friend-ready" }]);

  current = false;
  resolveTimeline("timeline-late");
  await jobs[1];
  assert.deepEqual(prepared, [{ kind: "friend", imageUrl: "friend-ready" }]);
});

test("一个渠道预检失败不阻塞另一个渠道的就绪回调", async () => {
  let resolveFriend;
  let rejectTimeline;
  const prepared = [];
  const jobs = startAlbumShareCoverPreparation({
    response: {
      friend_cover_url: "friend-generated",
      timeline_cover_url: "timeline-generated"
    },
    prepare(kind) {
      return new Promise((resolve, reject) => {
        if (kind === "friend") resolveFriend = resolve;
        else rejectTimeline = reject;
      });
    },
    onPrepared: (kind, imageUrl) => prepared.push({ kind, imageUrl })
  });

  await Promise.resolve();
  resolveFriend("friend-ready");
  await jobs[0];
  assert.deepEqual(prepared, [{ kind: "friend", imageUrl: "friend-ready" }]);

  rejectTimeline(new Error("timeline unavailable"));
  await jobs[1];
  assert.deepEqual(prepared, [
    { kind: "friend", imageUrl: "friend-ready" },
    { kind: "timeline", imageUrl: "" }
  ]);
});

test("时间线先失败完成后，仍会等待并接收好友的就绪回调", async () => {
  let resolveFriend;
  let rejectTimeline;
  const prepared = [];
  const jobs = startAlbumShareCoverPreparation({
    response: {
      friend_cover_url: "friend-generated",
      timeline_cover_url: "timeline-generated"
    },
    prepare(kind) {
      return new Promise((resolve, reject) => {
        if (kind === "friend") resolveFriend = resolve;
        else rejectTimeline = reject;
      });
    },
    onPrepared: (kind, imageUrl) => prepared.push({ kind, imageUrl })
  });

  await Promise.resolve();
  rejectTimeline(new Error("timeline unavailable"));
  await jobs[1];
  assert.deepEqual(prepared, [{ kind: "timeline", imageUrl: "" }]);

  resolveFriend("friend-ready");
  await jobs[0];
  assert.deepEqual(prepared, [
    { kind: "timeline", imageUrl: "" },
    { kind: "friend", imageUrl: "friend-ready" }
  ]);
});

test("鉴权变更会阻止旧分享 token 响应启动封面或菜单回调", async () => {
  let resolveOldToken;
  const authority = createAlbumShareRequestAuthority();
  const oldRequest = authority.beginTokenRequest();
  let appliedToken = "";
  let coverPreparationCalls = 0;
  let menuUpdates = 0;
  const oldResponse = new Promise((resolve) => {
    resolveOldToken = resolve;
  }).then((data) => {
    if (!authority.isTokenRequestCurrent(oldRequest)) return;
    appliedToken = data.token;
    coverPreparationCalls += 1;
    menuUpdates += 1;
  });

  authority.invalidate();
  resolveOldToken({ token: "old-account-token" });
  await oldResponse;

  assert.equal(appliedToken, "");
  assert.equal(coverPreparationCalls, 0);
  assert.equal(menuUpdates, 0);
});
