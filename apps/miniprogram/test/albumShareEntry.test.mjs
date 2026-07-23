import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ALBUM_SHARE_INTENT,
  albumShareAppMessageIntent,
  createAlbumShareEntryAuthority,
  createAlbumShareEntryCoordinator,
  memberDefaultAlbumShareState,
  recruitmentSharePayload
} from "../src/utils/albumShareEntry.js";

test("album share app-message intent uses the documented source priority", () => {
  assert.deepEqual(
    albumShareAppMessageIntent({
      from: "button",
      target: { dataset: { albumShare: "recruit", mediaId: "41" } }
    }),
    { kind: ALBUM_SHARE_INTENT.RECRUIT }
  );
  assert.deepEqual(
    albumShareAppMessageIntent({
      from: "button",
      target: { dataset: { albumShare: "active", mediaId: "41" } }
    }),
    { kind: ALBUM_SHARE_INTENT.ACTIVE }
  );
  assert.deepEqual(
    albumShareAppMessageIntent({
      from: "button",
      target: { dataset: { mediaId: "41" } }
    }),
    { kind: ALBUM_SHARE_INTENT.SINGLE, mediaId: 41 }
  );
  assert.deepEqual(
    albumShareAppMessageIntent({
      from: "button",
      target: { dataset: { mediaId: "0" } }
    }),
    { kind: ALBUM_SHARE_INTENT.UNKNOWN }
  );
  assert.deepEqual(
    albumShareAppMessageIntent({
      from: "button",
      target: { dataset: { mediaId: "1.5" } }
    }),
    { kind: ALBUM_SHARE_INTENT.UNKNOWN }
  );
  assert.deepEqual(
    albumShareAppMessageIntent({ from: "button", target: { dataset: {} } }),
    { kind: ALBUM_SHARE_INTENT.UNKNOWN }
  );
  assert.deepEqual(albumShareAppMessageIntent({ from: "menu" }), {
    kind: ALBUM_SHARE_INTENT.DEFAULT_ALL
  });
  assert.deepEqual(
    albumShareAppMessageIntent({ from: "menu" }, { timelineMode: true }),
    { kind: ALBUM_SHARE_INTENT.PUBLIC }
  );
});

test("recruitment share payload encodes the invite card and injects its timestamp", () => {
  assert.deepEqual(
    recruitmentSharePayload({
      sessionId: 123,
      inviteToken: "invite token",
      title: "剧本｜店家｜时间",
      now: 1720000000000
    }),
    {
      title: "剧本｜店家｜时间",
      path: "/pages/session/share?id=123&shareCode=s123-1720000000000&inviteToken=invite%20token&source=wechat_share",
      imageUrl: "/static/art/ticket-landscape.jpg"
    }
  );
});

test("recruitment share payload fails closed without a valid session, token, or title", () => {
  for (const payload of [
    { sessionId: 0, inviteToken: "invite", title: "title" },
    { sessionId: 123, inviteToken: "", title: "title" },
    { sessionId: 123, inviteToken: "invite", title: "   " }
  ]) {
    assert.equal(recruitmentSharePayload(payload), null);
  }
});

test("album share entry authority reuses its current key and invalidates stale requests", () => {
  const authority = createAlbumShareEntryAuthority();
  const first = authority.begin({ sessionId: 1, userId: 2, mediaVersion: 3 });
  const reused = authority.begin({ sessionId: 1, userId: 2, mediaVersion: 3 });

  assert.equal(reused.key, first.key);
  assert.equal(reused, first);
  assert.equal(authority.isCurrent(first), true);

  const changed = authority.begin({ sessionId: 1, userId: 2, mediaVersion: 4 });
  assert.notEqual(changed, first);
  assert.equal(authority.isCurrent(first), false);
  assert.equal(authority.isCurrent(changed), true);

  authority.invalidate();
  assert.equal(authority.isCurrent(changed), false);
});

test("album share entry authority fails closed for invalid identity without displacing the current request", () => {
  const authority = createAlbumShareEntryAuthority();
  const valid = authority.begin({ sessionId: 1, userId: 2, mediaVersion: 3 });
  const invalid = authority.begin({ sessionId: 0, userId: 0, mediaVersion: 0 });

  assert.equal(invalid, null);
  assert.equal(authority.isCurrent(invalid), false);
  assert.equal(authority.isCurrent(valid), true);
});

test("album share entry coordinator runs renderer jobs strictly in order", async () => {
  const coordinator = createAlbumShareEntryCoordinator();
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = coordinator.enqueue(async () => {
    order.push("startA");
    await firstGate;
    order.push("endA");
  });
  const second = coordinator.enqueue(async () => {
    order.push("startB");
    order.push("endB");
  });

  await Promise.resolve();
  assert.deepEqual(order, ["startA"]);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(order, ["startA", "endA", "startB", "endB"]);
});

test("album share entry coordinator invalidates a running job and skips stale queued renderers", async () => {
  const coordinator = createAlbumShareEntryCoordinator();
  const order = [];
  let releaseFirst;
  let isFirstCurrent;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = coordinator.enqueue(async ({ isCurrent }) => {
    isFirstCurrent = isCurrent;
    order.push("startA");
    await firstGate;
    order.push("endA");
  });
  const second = coordinator.enqueue(async () => {
    order.push("startB");
    order.push("endB");
  });

  await Promise.resolve();
  assert.equal(isFirstCurrent(), true);
  coordinator.invalidate();
  assert.equal(isFirstCurrent(), false);
  releaseFirst();
  await Promise.all([first, second]);
  await coordinator.whenIdle();

  assert.deepEqual(order, ["startA", "endA"]);
});

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

test("album toolbar uses an icon-only privacy control and ordered native recruit share", async () => {
  const source = await readFile(
    new URL("../src/pages/session/album.vue", import.meta.url),
    "utf8"
  );
  const template = sourceBlock(source, "<template>", "<script>");
  const style = sourceBlock(source, "<style", "</style>");
  const privacyButton = sourceBlock(
    template,
    'class="button secondary album-privacy-action"',
    "</t-button>"
  );
  const actionGroup = sourceBlock(
    template,
    'class="album-action-groups"',
    "</view>\n\n        <view class=\"album-filter-panel"
  );
  const recruitIconIndex = actionGroup.indexOf('src="/static/icons/album-recruit.svg"');
  const recruitButtonStart = actionGroup.lastIndexOf("<t-button", recruitIconIndex);
  const recruitButtonEnd = actionGroup.indexOf("</t-button>", recruitIconIndex);
  const recruitButton = actionGroup.slice(recruitButtonStart, recruitButtonEnd);

  assert.ok(privacyButton.includes('aria-label="相册隐私"'));
  assert.doesNotMatch(privacyButton, />\s*隐私\s*</);
  assert.match(style, /grid-template-columns:\s*minmax\(0, 1fr\)\s+78rpx/);
  assert.match(
    style,
    /\.album-privacy-action[\s\S]*width:\s*78rpx[\s\S]*height:\s*78rpx/
  );
  assert.match(style, /\.album-privacy-action[\s\S]*border-radius:\s*12rpx/);

  const shareIndex = actionGroup.indexOf("album-share.svg");
  const downloadIndex = actionGroup.indexOf("album-download.svg");
  const recruitIndex = actionGroup.indexOf("album-recruit.svg");
  const tagIndex = actionGroup.indexOf("album-tag-white.svg");
  assert.ok(shareIndex < downloadIndex);
  assert.ok(downloadIndex < recruitIndex);
  assert.ok(recruitIndex < tagIndex);
  assert.match(recruitButton, /data-album-share="recruit"/);
  assert.match(recruitButton, /:open-type="recruitInviteToken \? 'share' : ''"/);
  assert.match(recruitButton, /@tap="handleRecruitShareTap"/);
  assert.doesNotMatch(source, /openRecruitment/);
  assert.doesNotMatch(source, /navigateTo\(\{ url: `\/pages\/session\/share/);
});

test("album page prewarms recruit authority and fail-closes recruit app-message sharing", async () => {
  const source = await readFile(
    new URL("../src/pages/session/album.vue", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /import\s+\{[\s\S]*albumShareAppMessageIntent[\s\S]*recruitmentSharePayload[\s\S]*createAlbumShareEntryAuthority[\s\S]*\}\s+from "\.\.\/\.\.\/utils\/albumShareEntry";/
  );
  assert.match(source, /recruitInviteToken:\s*""/);
  assert.match(source, /recruitInviteGeneration:\s*0/);
  assert.match(source, /recruitInvitePromise:\s*null/);

  const loadAlbum = sourceBlock(source, "async loadAlbum() {", "async loadPublicAlbum() {");
  assert.match(loadAlbum, /this\.primeAlbumShareEntries\(\)/);
  const prepareRecruit = sourceBlock(
    source,
    "prepareRecruitInvite() {",
    "handleRecruitShareTap() {"
  );
  assert.match(prepareRecruit, /url:\s*`\/api\/sessions\/\$\{this\.sessionId\}\/join-invite-token`/);
  assert.match(prepareRecruit, /method:\s*"POST"/);
  assert.match(prepareRecruit, /data:\s*\{\s*\}/);
  assert.match(prepareRecruit, /this\.isCurrentRecruitInviteRequest\(requestContext\)/);
  assert.doesNotMatch(prepareRecruit, /albumBusy|albumShareReadyVisible|statusText/);

  const recruitTap = sourceBlock(
    source,
    "handleRecruitShareTap() {",
    "toggleSelectionMode() {"
  );
  assert.match(recruitTap, /this\.prepareRecruitInvite\(\)/);
  assert.match(recruitTap, /正在准备招募分享，请稍后再点/);
  assert.doesNotMatch(recruitTap, /navigateTo/);

  const appMessage = sourceBlock(source, "onShareAppMessage(options) {", "watch: {");
  assert.ok(
    appMessage.indexOf("albumShareAppMessageIntent(options") <
      appMessage.indexOf("if (intent.kind")
  );
  const recruitBranch = sourceBlock(
    appMessage,
    "if (intent.kind === ALBUM_SHARE_INTENT.RECRUIT)",
    "if (intent.kind === ALBUM_SHARE_INTENT.ACTIVE)"
  );
  assert.match(recruitBranch, /inviteToken:\s*this\.recruitInviteToken/);
  assert.match(recruitBranch, /recruitmentSharePayload/);
  assert.match(recruitBranch, /singleMediaShareFailClosedPayload\(\)/);
  assert.doesNotMatch(recruitBranch, /activeAlbumShare|albumShareToken|singleMediaShareAuthority/);
});

test("member onShow silently reprimes a missing recruit token before the preview refresh shortcut", async () => {
  const source = await readFile(
    new URL("../src/pages/session/album.vue", import.meta.url),
    "utf8"
  );
  const onShow = sourceBlock(source, "async onShow() {", "onHide() {");
  const prewarm = "if (this.sessionId && this.currentUserId && !this.recruitInviteToken)";
  const prewarmIndex = onShow.indexOf(prewarm);
  const skipRefreshIndex = onShow.indexOf("if (skipRefresh && !accountChanged)");

  assert.notEqual(prewarmIndex, -1);
  assert.ok(prewarmIndex < skipRefreshIndex);
  assert.match(onShow, /this\.prepareRecruitInvite\(\)/);
  assert.doesNotMatch(onShow, /await this\.prepareRecruitInvite\(\)/);
});

test("recruit share titles include script, store, and Beijing-formatted start time", async () => {
  const source = await readFile(
    new URL("../src/pages/session/album.vue", import.meta.url),
    "utf8"
  );
  const sessionTitle = sourceBlock(
    source,
    "albumShareSessionTitle() {",
    "albumFriendShareImage() {"
  );
  const appMessage = sourceBlock(source, "onShareAppMessage(options) {", "watch: {");
  const recruitBranch = sourceBlock(
    appMessage,
    "if (intent.kind === ALBUM_SHARE_INTENT.RECRUIT)",
    "if (intent.kind === ALBUM_SHARE_INTENT.ACTIVE)"
  );

  assert.match(
    source,
    /import\s+\{[\s\S]*formatBeijingDateTime[\s\S]*\}\s+from "@pinche\/shared";/
  );
  assert.match(
    sessionTitle,
    /return `\$\{this\.albumScriptName \|\| "剧本待定"\}｜\$\{this\.albumStoreName \|\| "店家待定"\}｜\$\{formatBeijingDateTime\(this\.albumSession\?\.start_at, "时间待定"\)\}`/
  );
  assert.match(recruitBranch, /title:\s*this\.albumShareSessionTitle\(\)/);
});

test("member default all-photo sharing has its own silent state, authority, and request", async () => {
  const source = await readFile(
    new URL("../src/pages/session/album.vue", import.meta.url),
    "utf8"
  );
  const loadAlbum = sourceBlock(source, "async loadAlbum() {", "async loadPublicAlbum() {");
  const primeEntries = sourceBlock(
    source,
    "primeAlbumShareEntries() {",
    "prepareDefaultAlbumShare() {"
  );
  const prepareDefault = sourceBlock(
    source,
    "prepareDefaultAlbumShare() {",
    "handleRecruitShareTap() {"
  );

  for (const field of [
    "defaultAlbumShareToken",
    "defaultAlbumShareFriendCoverUrl",
    "defaultAlbumShareTimelineCoverUrl",
    "defaultAlbumShareFriendCoverPrepared",
    "defaultAlbumShareTimelineCoverPrepared",
    "defaultAlbumShareSubject",
    "defaultAlbumShareCounts",
    "defaultAlbumShareGeneration",
    "defaultAlbumSharePromise",
    "defaultAlbumShareAuthority"
  ]) {
    assert.match(source, new RegExp(`${field}:`));
  }
  assert.match(loadAlbum, /this\.primeAlbumShareEntries\(\)/);
  assert.match(primeEntries, /this\.prepareRecruitInvite\(\)/);
  assert.match(primeEntries, /this\.prepareDefaultAlbumShare\(\)/);
  assert.match(
    prepareDefault,
    /url:\s*`\/api\/sessions\/\$\{this\.sessionId\}\/album\/share-token`/
  );
  assert.match(prepareDefault, /method:\s*"POST"/);
  assert.match(prepareDefault, /data:\s*\{\s*scope:\s*"all"\s*\}/);
  assert.match(source, /this\.defaultAlbumShareAuthority\.begin\(/);
  assert.doesNotMatch(prepareDefault, /albumBusy|statusText|albumSharePreparing|albumShareReadyVisible/);
});

test("member menu payloads read only the default all-photo snapshot while active remains button-only", async () => {
  const source = await readFile(
    new URL("../src/pages/session/album.vue", import.meta.url),
    "utf8"
  );
  const appMessage = sourceBlock(source, "onShareAppMessage(options) {", "onShareTimeline() {");
  const timeline = sourceBlock(source, "onShareTimeline() {", "watch: {");
  const menus = sourceBlock(source, "showShareMenus() {", "async prepareShareCoverUrl");
  const activeBranch = sourceBlock(
    appMessage,
    "if (intent.kind === ALBUM_SHARE_INTENT.ACTIVE)",
    "if (intent.kind === ALBUM_SHARE_INTENT.SINGLE)"
  );
  const memberMenuBranch = sourceBlock(
    appMessage,
    "if (intent.kind === ALBUM_SHARE_INTENT.DEFAULT_ALL)",
    "if (intent.kind === ALBUM_SHARE_INTENT.PUBLIC)"
  );

  assert.match(activeBranch, /activeAlbumSharePayload\(\)/);
  assert.match(memberMenuBranch, /defaultAlbumSharePayload\(\)/);
  assert.doesNotMatch(memberMenuBranch, /activeAlbumShareToken|recruitInviteToken|singleMediaShareAuthority/);
  assert.match(timeline, /defaultAlbumShareTimelinePayload\(\)/);
  assert.doesNotMatch(timeline, /activeAlbumShareToken/);
  assert.match(menus, /defaultAlbumShareToken/);
  assert.match(menus, /defaultAlbumShareFriendCoverPrepared/);
  assert.match(menus, /defaultAlbumShareTimelineCoverPrepared/);
  assert.doesNotMatch(menus, /activeAlbumShareToken/);
});

test("member menu state keeps a selected active snapshot out of the default all-photo payload", () => {
  assert.deepEqual(
    memberDefaultAlbumShareState({
      defaultAlbumShareToken: "default-all-token",
      defaultAlbumShareFriendCoverPrepared: true,
      defaultAlbumShareTimelineCoverPrepared: false,
      activeAlbumShareToken: "selected-active-token",
      activeAlbumShareFriendCoverPrepared: true,
      activeAlbumShareTimelineCoverPrepared: true
    }),
    {
      token: "default-all-token",
      friendReady: true,
      timelineReady: false
    }
  );
});
