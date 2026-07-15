import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { cleanupAlbumVideoBeforeDelete } from "../apps/api/src/modules/album-video/lifecycle.js";
import { deleteUploadedObject } from "../apps/api/src/server.js";
import { deleteCosObject } from "../apps/api/src/storage/cos.js";

const COS_CONFIG = {
  enabled: true,
  secretId: "d42-secret-id",
  secretKey: "d42-secret-key",
  bucket: "d42-bucket",
  region: "ap-guangzhou"
};
const VIDEO_SOURCE_PREFIX = "/uploads/session-album/videos/source/";

function cosResponse(statusCode) {
  return (options, onResponse) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => {
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = statusCode;
        response.headers = {};
        response.destroy = () => {};
        onResponse(response);
        queueMicrotask(() => response.emit("end"));
      });
    };
    return request;
  };
}

const server = await readFile(new URL("../apps/api/src/server.js", import.meta.url), "utf8");
const service = await readFile(new URL("../apps/api/src/modules/core/service.js", import.meta.url), "utf8");

assert.match(server, /requestSessionAlbumImageDeletion\(user, sessionAlbumPhotoId\)/);
assert.match(server, /deletionPending: true/);
const routeStart = server.indexOf("if (request.method === \"DELETE\" && sessionAlbumPhotoId)");
const routeEnd = server.indexOf("const sessionAlbumPhotoTagsId", routeStart);
const deletionRoute = server.slice(routeStart, routeEnd);
assert.match(deletionRoute, /requestSessionAlbumImageDeletion/);
assert.doesNotMatch(deletionRoute, /cleanupAlbumVideoBeforeDelete|prepareSessionAlbumPhotoDeletion/);
assert.match(service, /SELECT \* FROM \$\{table\} WHERE id = \?\$\{options\.forUpdate/);
const requestDeleteStart = service.indexOf("export async function requestAlbumImageDeletion");
const requestDeleteEnd = service.indexOf("export async function requestSessionAlbumImageDeletion", requestDeleteStart);
const durableDeletion = service.slice(requestDeleteStart, requestDeleteEnd);
assert.match(durableDeletion, /cancelMediaModerationJobsForDeletion/);
assert.match(durableDeletion, /status = 'deleting'/);
assert.match(durableDeletion, /enqueueRejectedMediaCleanup/);
const deleteObjectStart = server.indexOf("async function deleteUploadedSessionAlbumPhotoObject");
const deleteObjectEnd = server.indexOf("async function cleanupUploadedSessionAlbumPhotoObject", deleteObjectStart);
const albumObjectDelete = server.slice(deleteObjectStart, deleteObjectEnd);
for (const videoPrefix of [
  "videos/source/",
  "videos/display/",
  "videos/cover/"
]) {
  assert.match(
    albumObjectDelete,
    new RegExp(`${videoPrefix.replace("/", "\\/")}[\\s\\S]*?strictCosErrors: true`)
  );
}

const deleted = [];
const result = await cleanupAlbumVideoBeforeDelete({
  urls: ["/uploads/session-album/videos/source/a.mp4", "/uploads/session-album/videos/source/a.mp4", "/uploads/session-album/videos/cover/a.jpg"],
  deleteObject: async (url) => { deleted.push(url); },
  finalizeSnapshot: async (urls) => ({ deleted: true, urls })
});
assert.equal(result.deleted, true);
assert.equal(deleted.length, 2);

let finalizeCalled = false;
await assert.rejects(
  cleanupAlbumVideoBeforeDelete({
    urls: ["a"],
    deleteObject: async () => { throw Object.assign(new Error("upstream"), { statusCode: 503 }); },
    finalizeSnapshot: async () => { finalizeCalled = true; return { deleted: true }; }
  }),
  (error) => error.statusCode === 503
);
assert.equal(finalizeCalled, false);

await cleanupAlbumVideoBeforeDelete({
  urls: ["missing"],
  deleteObject: async () => { throw Object.assign(new Error("gone"), { statusCode: 404 }); },
  finalizeSnapshot: async () => ({ deleted: true })
});

await assert.rejects(
  cleanupAlbumVideoBeforeDelete({ urls: ["changed"], deleteObject: async () => {}, finalizeSnapshot: async () => ({ deleted: false, reason: "snapshot_changed" }) }),
  (error) => error.statusCode === 409
);

for (const testCase of [
  {
    name: "trusted COS 503",
    deleteCos: async ({ key, config }) => deleteCosObject({
      key,
      config,
      request: cosResponse(503)
    })
  },
  {
    name: "unknown COS network failure",
    deleteCos: async () => { throw new Error("unknown COS failure"); }
  },
  {
    name: "untrusted COS 404",
    deleteCos: async () => {
      throw Object.assign(new Error("untrusted COS not found"), { statusCode: 404 });
    }
  },
  {
    name: "untrusted COS status 404",
    deleteCos: async () => {
      throw Object.assign(new Error("untrusted COS status not found"), { status: 404 });
    }
  },
  {
    name: "untrusted COS httpStatus 404",
    deleteCos: async () => {
      throw Object.assign(new Error("untrusted COS HTTP status not found"), { httpStatus: 404 });
    }
  }
]) {
  let localUnlinkCalls = 0;
  let finalizeCalls = 0;
  await assert.rejects(
    cleanupAlbumVideoBeforeDelete({
      urls: [`${VIDEO_SOURCE_PREFIX}delete-test.mp4`],
      deleteObject: (url) => deleteUploadedObject({
        url: new URL(url, "http://localhost"),
        prefix: VIDEO_SOURCE_PREFIX,
        localDir: "/not-used",
        cosEnabled: true,
        strictCosErrors: true,
        cosConfig: COS_CONFIG,
        deleteCos: testCase.deleteCos,
        unlinkFile: async () => { localUnlinkCalls += 1; }
      }),
      finalizeSnapshot: async () => {
        finalizeCalls += 1;
        return { deleted: true };
      }
    }),
    undefined,
    testCase.name
  );
  assert.equal(localUnlinkCalls, 0, `${testCase.name} must not fall through to local storage`);
  assert.equal(finalizeCalls, 0, `${testCase.name} must preserve the database retry anchor`);
}

let missingLocalUnlinkCalls = 0;
let missingFinalizeCalls = 0;
await cleanupAlbumVideoBeforeDelete({
  urls: [`${VIDEO_SOURCE_PREFIX}already-missing.mp4`],
  deleteObject: (url) => deleteUploadedObject({
    url: new URL(url, "http://localhost"),
    prefix: VIDEO_SOURCE_PREFIX,
    localDir: "/not-used",
    cosEnabled: true,
    strictCosErrors: true,
    cosConfig: COS_CONFIG,
    deleteCos: async ({ key, config }) => deleteCosObject({
      key,
      config,
      request: cosResponse(404)
    }),
    unlinkFile: async () => { missingLocalUnlinkCalls += 1; }
  }),
  finalizeSnapshot: async () => {
    missingFinalizeCalls += 1;
    return { deleted: true };
  }
});
assert.equal(missingLocalUnlinkCalls, 0, "trusted COS 404 must not use local fallback");
assert.equal(missingFinalizeCalls, 1, "trusted COS 404 is cleanup success");

let imageLocalUnlinkCalls = 0;
await deleteUploadedObject({
  url: new URL("/uploads/session-album/display/legacy-image.jpg", "http://localhost"),
  prefix: "/uploads/session-album/display/",
  localDir: "/not-used",
  cosEnabled: true,
  cosConfig: COS_CONFIG,
  deleteCos: async () => { throw new Error("legacy image COS failure"); },
  unlinkFile: async () => { imageLocalUnlinkCalls += 1; }
});
assert.equal(imageLocalUnlinkCalls, 1, "existing image cleanup keeps its local fallback behavior");

console.log("D42 album video delete integration checks passed: durable route handoff plus legacy storage ordering, trusted 404 idempotency, and retry preservation");
