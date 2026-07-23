import assert from "node:assert/strict";
import test from "node:test";

import {
  ALBUM_SHARE_FRIEND_FALLBACK,
  ALBUM_SHARE_TIMELINE_FALLBACK,
  albumShareCoverContextKey,
  albumShareCoverPreparationIsCurrent,
  albumShareCoverRecipe,
  albumShareFriendPayload,
  albumShareImage,
  albumShareMenus,
  albumShareTimelinePayload,
  createAlbumShareRequestAuthority,
  startAlbumShareCoverPreparation
} from "../src/utils/albumShareCover.js";
import { createAlbumShareCanvasPreparation } from "../src/utils/albumShareCanvas.js";

test("两个渠道使用不同本地降级图", () => {
  assert.equal(ALBUM_SHARE_FRIEND_FALLBACK, "/static/art/album-share-friend.jpg");
  assert.equal(ALBUM_SHARE_TIMELINE_FALLBACK, "/static/art/album-share-timeline.jpg");
});

test("响应只读取客户端 Canvas 配方，不读取旧远程合成封面 URL", () => {
  const recipe = {
    version: "client-canvas-v1",
    images: [{ id: 1, thumbnail_url: "/api/album/thumb-1" }]
  };
  assert.deepEqual(albumShareCoverRecipe({
    cover_recipe: recipe,
    friend_cover_url: "https://cdn.example.test/friend-composite.jpg",
    cover_url: "https://cdn.example.test/legacy-composite.jpg",
    timeline_cover_url: "https://cdn.example.test/timeline-composite.jpg"
  }), recipe);
  assert.equal(albumShareCoverRecipe({ cover_url: "https://cdn.example.test/legacy.jpg" }), null);
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

test("远程 URL 永远不能作为分享 imageUrl，按渠道降级到本地静态图", () => {
  assert.equal(albumShareImage("friend", ""), ALBUM_SHARE_FRIEND_FALLBACK);
  assert.equal(albumShareImage("timeline", ""), ALBUM_SHARE_TIMELINE_FALLBACK);
  assert.equal(
    albumShareImage("friend", "https://cdn.example.test/server-composite.jpg"),
    ALBUM_SHARE_FRIEND_FALLBACK
  );
  assert.equal(
    albumShareImage("timeline", "/api/session-album/cover.jpg"),
    ALBUM_SHARE_TIMELINE_FALLBACK
  );
  assert.equal(albumShareImage("friend", "wxfile://tmp/friend-cover.jpg"), "wxfile://tmp/friend-cover.jpg");
  assert.equal(albumShareImage("friend", "http://tmp/friend-cover.jpg"), "http://tmp/friend-cover.jpg");
  assert.equal(
    albumShareImage("friend", "http://example.test/friend-cover.jpg"),
    ALBUM_SHARE_FRIEND_FALLBACK
  );
  assert.throws(() => albumShareImage("poster", ""), /kind/);
});

test("好友与时间线使用各自的微信分享返回结构", () => {
  assert.deepEqual(
    albumShareFriendPayload({
      title: " 好友标题 ",
      path: " /pages/session/album?id=1&albumShareToken=t ",
      imageUrl: " wxfile://tmp/friend-cover "
    }),
    {
      title: "好友标题",
      path: "/pages/session/album?id=1&albumShareToken=t",
      imageUrl: "wxfile://tmp/friend-cover"
    }
  );
  assert.deepEqual(
    albumShareTimelinePayload({
      title: " 时间线标题 ",
      query: " id=1&albumShareToken=t ",
      imageUrl: " wxfile://tmp/timeline-cover "
    }),
    {
      title: "时间线标题",
      query: "id=1&albumShareToken=t",
      imageUrl: "wxfile://tmp/timeline-cover"
    }
  );
});

test("好友 Canvas 完成后不等待慢速时间线，配方按渠道独立准备并跳过过期结果", async () => {
  let resolveFriend;
  let resolveTimeline;
  let current = true;
  const prepared = [];
  const recipe = {
    version: "client-canvas-v1",
    images: [{ id: 1, thumbnail_url: "/api/album/thumb-1" }]
  };
  const jobs = startAlbumShareCoverPreparation({
    response: {
      cover_recipe: recipe,
      cover_url: "https://cdn.example.test/old-composite.jpg"
    },
    prepare(kind, receivedRecipe) {
      assert.deepEqual(receivedRecipe, recipe);
      return new Promise((resolve) => {
        if (kind === "friend") resolveFriend = resolve;
        else resolveTimeline = resolve;
      });
    },
    isCurrent: () => current,
    onPrepared: (kind, imageUrl) => prepared.push({ kind, imageUrl })
  });

  await Promise.resolve();
  resolveFriend({ ok: true, path: "wxfile://tmp/friend-ready.jpg" });
  await jobs[0];
  assert.deepEqual(prepared, [{ kind: "friend", imageUrl: "wxfile://tmp/friend-ready.jpg" }]);

  current = false;
  resolveTimeline({ ok: true, path: "wxfile://tmp/timeline-late.jpg" });
  await jobs[1];
  assert.deepEqual(prepared, [{ kind: "friend", imageUrl: "wxfile://tmp/friend-ready.jpg" }]);
});

test("正文分页不会丢弃仍属于当前 token 与配方的延迟 Canvas 封面", async () => {
  const recipe = {
    version: "client-canvas-v1",
    images: [{ id: 1, thumbnail_url: "/api/album/thumb-1" }]
  };
  const deferred = new Map();
  const canvasPreparation = createAlbumShareCanvasPreparation({
    renderer: ({ kind }) => new Promise((resolve) => deferred.set(kind, resolve))
  });
  const canvasRequest = canvasPreparation.beginRequest();
  const requestAuthority = createAlbumShareRequestAuthority();
  let shareToken = "current-share-token";
  const coverRequest = requestAuthority.beginCoverRequest(shareToken);
  let listSerial = 1;
  const initialListRequest = listSerial;
  let friendImageUrl = "";
  let timelineImageUrl = "";

  const jobs = startAlbumShareCoverPreparation({
    response: { cover_recipe: recipe },
    prepare: (kind, coverRecipe) => canvasPreparation.prepare({
      shareId: shareToken,
      kind,
      recipe: coverRecipe,
      request: canvasRequest
    }),
    isCurrent: () => albumShareCoverPreparationIsCurrent({
      requestAuthority,
      coverRequest,
      token: shareToken,
      canvasPreparation,
      canvasRequest
    }),
    onPrepared(kind, imageUrl) {
      if (kind === "friend") friendImageUrl = imageUrl;
      if (kind === "timeline") timelineImageUrl = imageUrl;
    }
  });

  await Promise.resolve();
  listSerial += 1;
  assert.notEqual(listSerial, initialListRequest);

  deferred.get("friend")({ ok: true, path: "wxfile://tmp/friend-pagination.jpg" });
  await jobs[0];
  assert.equal(friendImageUrl, "wxfile://tmp/friend-pagination.jpg");
  assert.deepEqual(albumShareMenus({
    token: shareToken,
    friendReady: Boolean(friendImageUrl),
    timelineReady: Boolean(timelineImageUrl)
  }), ["shareAppMessage"]);

  deferred.get("timeline")({ ok: true, path: "wxfile://tmp/timeline-pagination.jpg" });
  await jobs[1];
  assert.deepEqual(albumShareMenus({
    token: shareToken,
    friendReady: Boolean(friendImageUrl),
    timelineReady: Boolean(timelineImageUrl)
  }), ["shareAppMessage", "shareTimeline"]);

  shareToken = "replacement-share-token";
  assert.equal(albumShareCoverPreparationIsCurrent({
    requestAuthority,
    coverRequest,
    token: shareToken,
    canvasPreparation,
    canvasRequest
  }), false);
  requestAuthority.beginCoverRequest(shareToken);
  canvasPreparation.beginRequest();
  assert.equal(albumShareCoverPreparationIsCurrent({
    requestAuthority,
    coverRequest,
    token: shareToken,
    canvasPreparation,
    canvasRequest
  }), false);
});

test("相同 token、配方 URL 与标题的媒体刷新复用本地 Canvas 缓存", async () => {
  const contextKeyFor = albumShareCoverContextKey;
  assert.equal(typeof contextKeyFor, "function");
  const recipe = {
    version: "client-canvas-v1",
    images: [{ id: 7, thumbnail_url: "/api/album/thumb-7?signature=same" }]
  };
  let renderCalls = 0;
  let disposeCalls = 0;
  let currentContextKey = "";
  let preparedPath = "";
  const preparation = createAlbumShareCanvasPreparation({
    renderer: ({ kind }) => {
      renderCalls += 1;
      return { ok: true, kind, path: "wxfile://tmp/cached-refresh-cover.jpg" };
    }
  });
  const applyPublicResponse = async ({ token, coverRecipe, title }) => {
    const nextContextKey = contextKeyFor({ token, recipe: coverRecipe, title });
    if (nextContextKey === currentContextKey && preparedPath) return preparedPath;
    if (currentContextKey) {
      disposeCalls += 1;
      preparation.dispose();
    }
    currentContextKey = nextContextKey;
    const request = preparation.beginRequest();
    const result = await preparation.prepare({
      shareId: token,
      kind: "friend",
      recipe: coverRecipe,
      title,
      request
    });
    preparedPath = result.path;
    return preparedPath;
  };

  assert.equal(await applyPublicResponse({
    token: "share-token",
    coverRecipe: recipe,
    title: "同一相册"
  }), "wxfile://tmp/cached-refresh-cover.jpg");
  assert.equal(await applyPublicResponse({
    token: "share-token",
    coverRecipe: {
      version: "client-canvas-v1",
      images: [{ id: 7, thumbnail_url: "/api/album/thumb-7?signature=same" }]
    },
    title: "同一相册"
  }), "wxfile://tmp/cached-refresh-cover.jpg");
  assert.equal(renderCalls, 1);
  assert.equal(disposeCalls, 0);
  assert.equal(preparedPath, "wxfile://tmp/cached-refresh-cover.jpg");

  assert.equal(await applyPublicResponse({
    token: "share-token",
    coverRecipe: {
      version: "client-canvas-v1",
      images: [{ id: 7, thumbnail_url: "/api/album/thumb-7?signature=changed" }]
    },
    title: "同一相册"
  }), "wxfile://tmp/cached-refresh-cover.jpg");
  assert.equal(renderCalls, 2);
  assert.equal(disposeCalls, 1);
});

test("一个渠道 Canvas 失败会使用该渠道静态图，不阻塞另一个渠道", async () => {
  let resolveFriend;
  let rejectTimeline;
  const prepared = [];
  const jobs = startAlbumShareCoverPreparation({
    response: {
      cover_recipe: { version: "client-canvas-v1", images: [{ id: 1, thumbnail_url: "/api/thumb" }] }
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
  resolveFriend({ ok: true, path: "wxfile://tmp/friend-ready.jpg" });
  await jobs[0];
  assert.deepEqual(prepared, [{ kind: "friend", imageUrl: "wxfile://tmp/friend-ready.jpg" }]);

  rejectTimeline(new Error("timeline unavailable"));
  await jobs[1];
  assert.deepEqual(prepared, [
    { kind: "friend", imageUrl: "wxfile://tmp/friend-ready.jpg" },
    { kind: "timeline", imageUrl: ALBUM_SHARE_TIMELINE_FALLBACK }
  ]);
});

test("时间线先回退后，仍会等待并接收好友的 Canvas 就绪回调", async () => {
  let resolveFriend;
  let rejectTimeline;
  const prepared = [];
  const jobs = startAlbumShareCoverPreparation({
    response: {
      cover_recipe: { version: "client-canvas-v1", images: [{ id: 1, thumbnail_url: "/api/thumb" }] }
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
  assert.deepEqual(prepared, [{ kind: "timeline", imageUrl: ALBUM_SHARE_TIMELINE_FALLBACK }]);

  resolveFriend({ ok: true, path: "wxfile://tmp/friend-ready.jpg" });
  await jobs[0];
  assert.deepEqual(prepared, [
    { kind: "timeline", imageUrl: ALBUM_SHARE_TIMELINE_FALLBACK },
    { kind: "friend", imageUrl: "wxfile://tmp/friend-ready.jpg" }
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
