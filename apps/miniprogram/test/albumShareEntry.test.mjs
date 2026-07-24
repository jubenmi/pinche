import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ALBUM_SHARE_INTENT,
  albumShareAppMessageIntent,
  createAlbumShareEntryAuthority,
  memberDefaultAlbumShareMediaFingerprint,
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
  const prewarm = "if (this.sessionId && this.currentUserId && (!this.defaultAlbumShareToken || !this.recruitInviteToken))";
  const prewarmIndex = onShow.indexOf(prewarm);
  const skipRefreshIndex = onShow.indexOf("if (skipRefresh && !accountChanged)");

  assert.notEqual(prewarmIndex, -1);
  assert.ok(prewarmIndex < skipRefreshIndex);
  assert.match(onShow, /this\.primeAlbumShareEntries\(\)/);
  assert.doesNotMatch(onShow, /await this\.primeAlbumShareEntries\(\)/);
});

test("recruit share titles include script, store, and Beijing-formatted start time", async () => {
  const source = await readFile(
    new URL("../src/pages/session/album.vue", import.meta.url),
    "utf8"
  );
  const sessionTitle = sourceBlock(
    source,
    "albumShareSessionTitle() {",
    "defaultAlbumShareSubjectLabel() {"
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
    "defaultAlbumShareTimelineCoverUrl",
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
  assert.match(
    prepareDefault,
    /this\.installDefaultAlbumShareSnapshot\(data, token\)[\s\S]*this\.showShareMenus\(\)/
  );
  assert.match(prepareDefault, /this\.selectAlbumShareTimelineImage\(data\)/);
  assert.match(prepareDefault, /this\.applyDefaultAlbumShareTimelineImage\(/);
  assert.doesNotMatch(prepareDefault, /Canvas|startAlbumShareCoverPreparation/);
});

test("member menu payloads isolate active and default full-album snapshots", async () => {
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
  const publicBranch = sourceBlock(
    appMessage,
    "if (intent.kind === ALBUM_SHARE_INTENT.PUBLIC)",
    "\n    return singleMediaShareFailClosedPayload();\n  },"
  );
  const defaultPayload = sourceBlock(
    source,
    "defaultAlbumSharePayload() {",
    "defaultAlbumShareTimelinePayload() {"
  );
  const activePayload = sourceBlock(
    source,
    "activeAlbumSharePayload() {",
    "beginAlbumShareSnapshotRequest() {"
  );

  assert.match(activeBranch, /activeAlbumSharePayload\(\)/);
  assert.match(memberMenuBranch, /defaultAlbumSharePayload\(\)/);
  assert.doesNotMatch(memberMenuBranch, /activeAlbumShareToken|recruitInviteToken|singleMediaShareAuthority/);
  assert.doesNotMatch(publicBranch, /imageUrl|albumFriendShareImage/);
  assert.doesNotMatch(defaultPayload, /defaultAlbumShareFriendCoverPrepared|imageUrl/);
  assert.doesNotMatch(activePayload, /activeAlbumShareFriendCoverPrepared|imageUrl/);
  assert.match(timeline, /albumShareReadyVisible/);
  assert.match(timeline, /activeAlbumShareToken/);
  assert.match(timeline, /activeAlbumShareTimelinePayload\(\)/);
  assert.match(timeline, /defaultAlbumShareTimelinePayload\(\)/);
  assert.match(menus, /defaultAlbumShareToken/);
  assert.doesNotMatch(menus, /defaultAlbumShareFriendCoverPrepared/);
  assert.match(menus, /defaultAlbumShareTimelineCoverPrepared/);
});

test("member default all-photo sharing opens friend sharing from its token", () => {
  assert.deepEqual(
    memberDefaultAlbumShareState({
      defaultAlbumShareToken: "default-all-token",
      defaultAlbumShareFriendCoverPrepared: false,
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

test("member default media fingerprint ignores signed URLs but tracks share semantics", () => {
  const photos = [{
    id: 41,
    media_type: "image",
    moderation_status: "approved",
    processing_status: "ready",
    is_mine: true,
    tags: [{ key: "seat:8", label: "侦探" }],
    image_width: 1600,
    image_height: 1200,
    focus_x: 0.25,
    focus_y: 0.75,
    thumbnail_url: "https://cdn.example.test/41.jpg?token=old",
    media_url_expires_at: "2026-07-24T01:00:00.000Z"
  }];
  const fingerprint = memberDefaultAlbumShareMediaFingerprint(photos);

  assert.equal(
    memberDefaultAlbumShareMediaFingerprint([{
      ...photos[0],
      thumbnail_url: "https://cdn.example.test/41.jpg?token=renewed",
      media_url_expires_at: "2026-07-24T02:00:00.000Z"
    }]),
    fingerprint
  );
  assert.notEqual(memberDefaultAlbumShareMediaFingerprint([]), fingerprint);
  assert.notEqual(memberDefaultAlbumShareMediaFingerprint([...photos, { ...photos[0], id: 42 }]), fingerprint);
  assert.notEqual(
    memberDefaultAlbumShareMediaFingerprint([{ ...photos[0], tags: [] }]),
    fingerprint
  );
  assert.notEqual(
    memberDefaultAlbumShareMediaFingerprint([{ ...photos[0], moderation_status: "review" }]),
    fingerprint
  );
  assert.notEqual(
    memberDefaultAlbumShareMediaFingerprint([{ ...photos[0], image_width: 1200 }]),
    fingerprint
  );
  assert.notEqual(
    memberDefaultAlbumShareMediaFingerprint([{ ...photos[0], focus_x: 0.5 }]),
    fingerprint
  );
});

test("member lifecycle invalidates share entries without Canvas cleanup", async () => {
  const source = await readFile(
    new URL("../src/pages/session/album.vue", import.meta.url),
    "utf8"
  );
  const onHide = sourceBlock(source, "onHide() {", "onUnload() {");
  const onUnload = sourceBlock(source, "onUnload() {", "onPageScroll(event) {");

  for (const lifecycle of [onHide, onUnload]) {
    assert.match(lifecycle, /this\.invalidateDefaultAlbumShare\(\)/);
    assert.match(lifecycle, /this\.invalidateRecruitInviteShare\(\)/);
    assert.doesNotMatch(lifecycle, /Canvas|canvas/);
  }
});

test("member entry authority closes on identity, semantic load, and permission failure", async () => {
  const source = await readFile(
    new URL("../src/pages/session/album.vue", import.meta.url),
    "utf8"
  );
  const authChange = sourceBlock(
    source,
    "handleAlbumAuthChange(auth = {}) {",
    "updateTopActionsFloating() {"
  );
  const loadAlbum = sourceBlock(source, "async loadAlbum() {", "async loadPublicAlbum() {");
  const permissionFailure = sourceBlock(
    loadAlbum,
    "if (error?.statusCode === 401 || error?.statusCode === 403) {",
    "} else {"
  );

  assert.match(authChange, /this\.invalidateDefaultAlbumShare\(\)/);
  assert.match(authChange, /this\.invalidateRecruitInviteShare\(\)/);
  assert.match(loadAlbum, /this\.invalidateDefaultAlbumShare\(\{ hideMenus: true \}\)/);
  assert.match(permissionFailure, /this\.invalidateDefaultAlbumShare\(\{ hideMenus: true \}\)/);
  assert.match(permissionFailure, /this\.invalidateRecruitInviteShare\(\)/);
});

test("member refresh authorization failure invalidates entry state before emptying photos", async () => {
  const source = await readFile(
    new URL("../src/pages/session/album.vue", import.meta.url),
    "utf8"
  );
  const refreshController = sourceBlock(
    source,
    "initializeAlbumMediaRefreshController() {",
    "async loadAlbum() {"
  );
  const authorizationFailure = sourceBlock(
    refreshController,
    "if (error?.statusCode === 401 || error?.statusCode === 403) {",
    "throw error;"
  );
  const memberInvalidation = sourceBlock(
    authorizationFailure,
    "if (!this.timelineMode) {",
    "return {"
  );

  assert.match(memberInvalidation, /this\.invalidateDefaultAlbumShare\(\{ hideMenus: true \}\)/);
  assert.match(memberInvalidation, /this\.invalidateRecruitInviteShare\(\)/);
  assert.ok(
    authorizationFailure.indexOf("this.invalidateDefaultAlbumShare({ hideMenus: true })") <
      authorizationFailure.indexOf("photos: []")
  );
});

test("member onShow silently reprimes both missing entry states before skipping refresh", async () => {
  const source = await readFile(
    new URL("../src/pages/session/album.vue", import.meta.url),
    "utf8"
  );
  const onShow = sourceBlock(source, "async onShow() {", "onHide() {");
  const prewarm = "if (this.sessionId && this.currentUserId && (!this.defaultAlbumShareToken || !this.recruitInviteToken))";
  const prewarmIndex = onShow.indexOf(prewarm);
  const skipRefreshIndex = onShow.indexOf("if (skipRefresh && !accountChanged)");

  assert.notEqual(prewarmIndex, -1);
  assert.ok(prewarmIndex < skipRefreshIndex);
  assert.match(onShow, /this\.primeAlbumShareEntries\(\)/);
  assert.doesNotMatch(onShow, /await this\.primeAlbumShareEntries\(\)/);
});

test("entry prewarm stays local and ignores display-only member and public updates", async () => {
  const source = await readFile(
    new URL("../src/pages/session/album.vue", import.meta.url),
    "utf8"
  );
  const watch = sourceBlock(source, "watch: {", "methods: {");
  const scroll = sourceBlock(source, "onPageScroll(event) {", "onReachBottom() {");
  const publicPagination = sourceBlock(
    source,
    "async loadMorePublicAlbum() {",
    "normalizeAlbumMediaUrl(path) {"
  );
  const refreshUrls = sourceBlock(
    source,
    "applyFreshAlbumMediaUrls(freshPhotos = []) {",
    "refreshAlbumMediaUrlsForPreview() {"
  );
  const prepareDefault = sourceBlock(
    source,
    "prepareDefaultAlbumShare() {",
    "handleRecruitShareTap() {"
  );

  for (const displayOnlyPath of [watch, scroll, publicPagination, refreshUrls]) {
    assert.doesNotMatch(displayOnlyPath, /primeAlbumShareEntries|prepareDefaultAlbumShare|invalidateDefaultAlbumShare/);
  }
  assert.doesNotMatch(prepareDefault, /albumBusy|statusText|albumShareReadyVisible|showToast/);
});

test("stale member album loads stop after people and guard people fallback writes", async () => {
  const source = await readFile(
    new URL("../src/pages/session/album.vue", import.meta.url),
    "utf8"
  );
  const loadAlbum = sourceBlock(source, "async loadAlbum() {", "async loadPublicAlbum() {");
  const loadPeople = sourceBlock(source, "async loadPeople(", "async loadSessionPeopleFallback(");
  const fallback = sourceBlock(source, "async loadSessionPeopleFallback(", "sessionDetailPeople(session) {");
  const awaitPeople = loadAlbum.indexOf("await this.loadPeople(() => this.isCurrentAlbumListRequest(listRequest))");
  const currentCheck = loadAlbum.indexOf(
    "if (!this.isCurrentAlbumListRequest(listRequest)) {",
    awaitPeople
  );
  const navigationTitle = loadAlbum.indexOf("this.applyAlbumNavigationTitle()", awaitPeople);
  const scheduleRefresh = loadAlbum.indexOf("this.albumMediaRefresh?.schedule()", awaitPeople);
  const primeEntries = loadAlbum.indexOf("this.primeAlbumShareEntries()", awaitPeople);

  assert.notEqual(awaitPeople, -1);
  assert.notEqual(currentCheck, -1);
  assert.ok(currentCheck < navigationTitle);
  assert.ok(currentCheck < scheduleRefresh);
  assert.ok(currentCheck < primeEntries);
  assert.match(loadPeople, /async loadPeople\(isCurrent = \(\) => true\)/);
  assert.match(loadPeople, /if \(!isCurrent\(\)\) \{\s*return;\s*\}[\s\S]*this\.people =/);
  assert.match(fallback, /async loadSessionPeopleFallback\(isCurrent = \(\) => true\)/);
  assert.match(fallback, /if \(!isCurrent\(\)\) \{\s*return \[\];\s*\}[\s\S]*this\.applyAlbumSessionFallback\(session\)/);
});

test("member background refresh replaces default sharing only for semantic media changes", async () => {
  const source = await readFile(
    new URL("../src/pages/session/album.vue", import.meta.url),
    "utf8"
  );
  const refreshController = sourceBlock(
    source,
    "initializeAlbumMediaRefreshController() {",
    "async loadAlbum() {"
  );
  const writeAlbum = sourceBlock(refreshController, "writeAlbum: (next) => {", "reloadAlbum: async () => {");
  const invalidateDefault = writeAlbum.indexOf("this.invalidateDefaultAlbumShare({ hideMenus: true })");
  const assignPhotos = writeAlbum.indexOf("this.photos =");
  const refreshWaterfall = writeAlbum.indexOf("this.refreshWaterfall()");
  const primeEntries = writeAlbum.indexOf("this.primeAlbumShareEntries()");

  assert.match(source, /memberDefaultAlbumShareMediaFingerprint/);
  assert.match(writeAlbum, /const beforeMedia = memberDefaultAlbumShareMediaFingerprint\(this\.photos\)/);
  assert.match(writeAlbum, /const nextMedia = memberDefaultAlbumShareMediaFingerprint\(next\.photos\)/);
  assert.match(writeAlbum, /if \(!this\.timelineMode && beforeMedia !== nextMedia\)/);
  assert.notEqual(invalidateDefault, -1);
  assert.ok(invalidateDefault < assignPhotos);
  assert.ok(refreshWaterfall < primeEntries);
});
