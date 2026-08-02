import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { reactive } from "vue";

const albumSource = await readFile(
  new URL("../src/pages/session/album.vue", import.meta.url),
  "utf8"
);

function braceBlockAt(source, openBraceIndex, label) {
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openBraceIndex, index + 1);
  }
  assert.fail(label);
}

function objectMethodDefinition(source, name) {
  const match = source.match(new RegExp(`(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`));
  assert.ok(match && match.index !== undefined, `missing object method ${name}`);
  const openBraceIndex = match.index + match[0].lastIndexOf("{");
  const block = braceBlockAt(source, openBraceIndex, `unterminated object method ${name}`);
  return source.slice(match.index, openBraceIndex) + block;
}

function compileObjectMethod(source, name, dependencies = {}) {
  const dependencyNames = Object.keys(dependencies);
  const factory = new Function(
    ...dependencyNames,
    `return ({ ${objectMethodDefinition(source, name)} }).${name};`
  );
  return factory(...dependencyNames.map((key) => dependencies[key]));
}

function albumContext() {
  const listRequest = Symbol("current-album-list");
  return reactive({
    timelineMode: false,
    currentUserId: 7,
    sessionId: 91,
    albumAuthGeneration: 1,
    loadingAlbum: false,
    albumLoadFailed: false,
    albumRequiresFullLoad: true,
    photos: [],
    people: [],
    albumSession: null,
    hiddenCount: 0,
    canUpload: false,
    statusText: "",
    mediaLoadSerial: 0,
    visiblePhotoMedia: {},
    visiblePhotoMediaRequests: {},
    mediaProgressById: {},
    listThumbnailLoadedById: {},
    listThumbnailFailedById: {},
    beginAlbumListRequest() {
      return listRequest;
    },
    isCurrentAlbumListRequest(candidate) {
      return candidate === listRequest;
    },
    beginAlbumMemberRequest(candidate) {
      return {
        listRequest: candidate,
        authGeneration: this.albumAuthGeneration,
        userId: this.currentUserId
      };
    },
    isCurrentAlbumMemberRequest(owner) {
      return Boolean(
        owner &&
          owner.listRequest === listRequest &&
          owner.authGeneration === this.albumAuthGeneration &&
          owner.userId === this.currentUserId
      );
    },
    clearMemberAlbumProjection(message = "") {
      this.photos = [];
      this.people = [];
      this.albumSession = null;
      this.canUpload = false;
      this.statusText = message;
    },
    disconnectPhotoObservers() {},
    invalidateDefaultAlbumShare() {},
    normalizePhotoMedia(photo) {
      return photo;
    },
    pruneUnpublishedAlbumMediaState() {},
    albumSessionSummary(data) {
      return { id: data.session_id || this.sessionId };
    },
    refreshWaterfall() {},
    applyAlbumNavigationTitle() {},
    albumMediaRefresh: { schedule() {} },
    primeAlbumShareEntries() {}
  });
}

test("album busy state does not reference removed share-preview flags", () => {
  const albumBusy = objectMethodDefinition(albumSource, "albumBusy");

  assert.doesNotMatch(albumBusy, /preparingSharePreview|savingShareSelection/);
});

test("current member album load releases loading through Vue reactive state", async () => {
  const context = albumContext();
  const loadAlbum = compileObjectMethod(albumSource, "loadAlbum", {
    request: async () => ({
      data: {
        session_id: 91,
        photos: [{ id: 10 }],
        can_upload: false
      }
    }),
    dataOf: (response) => response.data
  });

  const loaded = await loadAlbum.call(context);

  assert.equal(loaded, true);
  assert.deepEqual(context.photos, [{ id: 10 }]);
  assert.equal(context.loadingAlbum, false);
});

test("current member album failure releases loading and exposes retry state", async () => {
  const context = albumContext();
  const loadAlbum = compileObjectMethod(albumSource, "loadAlbum", {
    request: async () => {
      throw new Error("network unavailable");
    },
    dataOf: (response) => response.data
  });

  const loaded = await loadAlbum.call(context);

  assert.equal(loaded, false);
  assert.equal(context.loadingAlbum, false);
  assert.equal(context.albumLoadFailed, true);
  assert.equal(context.statusText, "相册加载失败，请稍后重试。");
});
