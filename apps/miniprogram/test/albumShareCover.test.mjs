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
import * as albumShareCover from "../src/utils/albumShareCover.js";
import { createAlbumShareCanvasPreparation } from "../src/utils/albumShareCanvas.js";

const semanticCoverImage = (id, query, overrides = {}) => ({
  id,
  thumbnail_url: `/api/public/session-album/photos/${id}/image?${query}`,
  width: 1600,
  height: 1200,
  focus_x: 0.5,
  focus_y: 0.5,
  ...overrides
});

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

test("有效 token 立即开放好友菜单，朋友圈仍等待独立封面", () => {
  assert.deepEqual(albumShareMenus({ token: "t", friendReady: false, timelineReady: false }), [
    "shareAppMessage"
  ]);
  assert.deepEqual(albumShareMenus({ token: "t", friendReady: false, timelineReady: true }), [
    "shareAppMessage",
    "shareTimeline"
  ]);
  assert.deepEqual(albumShareMenus({ token: "", friendReady: false, timelineReady: true }), []);
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

test("好友分享省略 imageUrl 以使用微信默认页面截图", () => {
  const payload = albumShareFriendPayload({
    title: " 好友标题 ",
    path: " /pages/session/album?id=1&albumShareToken=t ",
    imageUrl: " wxfile://tmp/friend-cover "
  });

  assert.deepEqual(payload, {
    title: "好友标题",
    path: "/pages/session/album?id=1&albumShareToken=t"
  });
  assert.equal(Object.hasOwn(payload, "imageUrl"), false);
});

test("时间线继续使用独立微信分享封面", () => {
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

test("调用方可以只准备朋友圈 Canvas", async () => {
  const preparedKinds = [];
  const jobs = startAlbumShareCoverPreparation({
    response: {
      cover_recipe: {
        version: "client-canvas-v1",
        images: [{ id: 1, thumbnail_url: "/api/thumb" }]
      }
    },
    kinds: ["timeline"],
    prepare: async (kind) => {
      preparedKinds.push(kind);
      return { ok: true, path: "wxfile://tmp/timeline.jpg" };
    }
  });

  await Promise.all(jobs);
  assert.deepEqual(preparedKinds, ["timeline"]);
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

test("封面上下文忽略签名查询并区分 token、标题与绘制语义", () => {
  const recipeA = {
    version: "client-canvas-v1",
    images: [
      semanticCoverImage(41, "exp=1770000000&sig=old-signature&token=old-token"),
      semanticCoverImage(52, "exp=1770000000&sig=stable-signature&token=stable-token")
    ]
  };
  const recipeB = {
    version: "client-canvas-v1",
    images: [
      semanticCoverImage(41, "token=new-token&exp=1880000000&sig=new-signature"),
      semanticCoverImage(52, "token=renewed-token&exp=1880000000&sig=renewed-signature")
    ]
  };
  const base = { token: "share-token", recipe: recipeA, title: "同一相册" };
  const contextKey = albumShareCoverContextKey(base);

  assert.equal(
    albumShareCoverContextKey({ ...base, recipe: recipeB }),
    contextKey
  );
  for (const [change, input] of [
    ["selected ID", {
      ...base,
      recipe: {
        ...recipeB,
        images: [
          semanticCoverImage(42, "exp=1880000000&sig=new-signature&token=new-token"),
          recipeB.images[1]
        ]
      }
    }],
    ["order", { ...base, recipe: { ...recipeB, images: [recipeB.images[1], recipeB.images[0]] } }],
    ["count", { ...base, recipe: { ...recipeB, images: [recipeB.images[0]] } }],
    ["dimensions", {
      ...base,
      recipe: {
        ...recipeB,
        images: [{ ...recipeB.images[0], width: 2048 }, recipeB.images[1]]
      }
    }],
    ["focus", {
      ...base,
      recipe: {
        ...recipeB,
        images: [{ ...recipeB.images[0], focus_x: 0.25 }, recipeB.images[1]]
      }
    }],
    ["version", { ...base, recipe: { ...recipeB, version: "client-canvas-v2" } }],
    ["title", { ...base, recipe: recipeB, title: "另一相册" }],
    ["share token", { ...base, token: "replacement-share-token", recipe: recipeB }]
  ]) {
    assert.notEqual(albumShareCoverContextKey(input), contextKey, change);
  }
});

test("相同 token、媒体语义与标题的签名刷新复用本地 Canvas 缓存", async () => {
  const contextKeyFor = albumShareCoverContextKey;
  assert.equal(typeof contextKeyFor, "function");
  const recipe = {
    version: "client-canvas-v1",
    images: [
      semanticCoverImage(41, "exp=1770000000&sig=old-signature&token=old-token")
    ]
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
      images: [
        semanticCoverImage(41, "exp=1880000000&sig=new-signature&token=new-token")
      ]
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
      images: [
        semanticCoverImage(
          41,
          "exp=1990000000&sig=latest-signature&token=latest-token",
          { focus_x: 0.25 }
        )
      ]
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

test("已移除旧预览响应与跨页面本地图片交接导出", () => {
  for (const name of [
    "loadCurrentAlbumShareTokenResponse",
    "rememberAlbumShareLocalPreviewHandoff",
    "takeAlbumShareLocalPreviewHandoff",
    "forgetAlbumShareLocalPreviewHandoff",
    "ALBUM_SHARE_LOCAL_PREVIEW_HANDOFF_TTL_MS"
  ]) {
    assert.equal(name in albumShareCover, false, name);
  }
});
