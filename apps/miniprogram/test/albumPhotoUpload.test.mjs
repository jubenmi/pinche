import assert from "node:assert/strict";
import test from "node:test";

import { executeAlbumCosUpload } from "@pinche/shared";
import { uploadAlbumPhoto } from "../src/utils/albumPhotoUpload.js";

function directUpload(overrides = {}) {
  return {
    uploadMode: "cos-direct-v2", direct: true, fallbackAllowed: false,
    uploadId: "upload-1", key: "photo.jpg", ...overrides
  };
}

function fakeApi(calls, upload, options = {}) {
  let putCount = 0;
  return {
    createSessionAlbumPhotoUploadIntent: async (sessionId, facts) => {
      calls.push(["intent", sessionId, facts]);
      return upload;
    },
    putSessionAlbumPhotoToCos: async () => {
      putCount += 1;
      calls.push(["put", putCount]);
      if (options.putError?.(putCount)) throw options.putError(putCount);
    },
    getSessionAlbumPhotoUploadStatus: async () => {
      calls.push(["status"]);
      return (typeof options.status === "function" ? options.status(putCount) : options.status) ||
        { validationState: "ready", canFinalize: true };
    },
    finalizeSessionAlbumPhotoUpload: async () => {
      calls.push(["finalize"]);
      return { photo: { id: 91 } };
    },
    clearSessionAlbumPhotoAuthorization: () => calls.push(["clearAuth"]),
    uploadSessionAlbumPhotoLocal: async () => { calls.push(["localUpload"]); return "/local.jpg"; },
    createSessionAlbumPhotoLegacy: async () => { calls.push(["legacyCreate"]); return { photo: { id: 92 } }; }
  };
}

const fastExecute = (options) => executeAlbumCosUpload({
  ...options, sleep: async () => {}, random: () => 0, maxStatusPolls: 2
});

test("direct v2 sends exact facts and returns finalized photo without multipart", async () => {
  const calls = [];
  const phases = [];
  const result = await uploadAlbumPhoto({
    sessionId: 8, filePath: "/tmp/photo.png", fileSize: 2048, contentType: "image/png",
    api: fakeApi(calls, directUpload()), execute: fastExecute,
    onPhase: (phase) => phases.push([phase.phase, phase.retry])
  });
  assert.equal(result.photo.id, 91);
  assert.equal(calls.some(([name]) => name === "localUpload"), false);
  assert.deepEqual(calls.find(([name]) => name === "intent").slice(1), [
    8, { extension: ".png", contentType: "image/png", byteSize: 2048, adminOwner: false }
  ]);
  assert.deepEqual(phases.map(([phase]) => phase), ["preparing", "preparing", "uploading", "validating", "complete"]);
});

test("unknown or failed direct response never opts itself into fallback", async () => {
  for (const upload of [
    { direct: false, fallbackAllowed: false },
    { uploadMode: "unknown", direct: false, fallbackAllowed: true }
  ]) {
    const calls = [];
    await assert.rejects(uploadAlbumPhoto({
      sessionId: 8, filePath: "/tmp/a.jpg", fileSize: 10, contentType: "image/jpeg",
      api: fakeApi(calls, upload), onPhase: () => {}
    }), (error) => error.code === "DIRECT_UPLOAD_REQUIRED");
    assert.equal(calls.some(([name]) => name === "localUpload"), false);
  }
});

test("only explicit api-local plus fallbackAllowed uses local path", async () => {
  const calls = [];
  const result = await uploadAlbumPhoto({
    sessionId: 8, filePath: "/tmp/a.jpg", fileSize: 10, contentType: "image/jpeg",
    api: fakeApi(calls, { uploadMode: "api-local", direct: false, fallbackAllowed: true })
  });
  assert.equal(result.photo.id, 92);
  assert.equal(calls.filter(([name]) => name === "localUpload").length, 1);
});

test("network retry reconciles status before one of two retries", async () => {
  const calls = [];
  const api = fakeApi(calls, directUpload(), {
    putError: (count) => count === 1
      ? Object.assign(new Error("reset"), { code: "COS_NETWORK_ERROR", status: 0 })
      : null,
    status: (putCount) => putCount === 1
      ? { validationState: "missing", canFinalize: false }
      : { validationState: "ready", canFinalize: true }
  });
  const result = await uploadAlbumPhoto({
    sessionId: 8, filePath: "/tmp/a.jpg", fileSize: 10, contentType: "image/jpeg",
    api, execute: fastExecute
  });
  assert.equal(result.photo.id, 91);
  assert.deepEqual(calls.filter(([name]) => ["put", "status"].includes(name)).map(([name]) => name), [
    "put", "status", "put", "status"
  ]);
});

test("conflict reconciles without second PUT and signature refresh happens once", async () => {
  const conflictCalls = [];
  await uploadAlbumPhoto({
    sessionId: 8, filePath: "/tmp/a.jpg", fileSize: 10, contentType: "image/jpeg",
    api: fakeApi(conflictCalls, directUpload(), {
      putError: () => Object.assign(new Error("exists"), { statusCode: 412 })
    }), execute: fastExecute
  });
  assert.equal(conflictCalls.filter(([name]) => name === "put").length, 1);

  const signatureCalls = [];
  await uploadAlbumPhoto({
    sessionId: 8, filePath: "/tmp/a.jpg", fileSize: 10, contentType: "image/jpeg",
    api: fakeApi(signatureCalls, directUpload(), {
      putError: (count) => count === 1
        ? Object.assign(new Error("expired"), { code: "SignatureDoesNotMatch" })
        : null
    }), execute: fastExecute
  });
  assert.equal(signatureCalls.filter(([name]) => name === "clearAuth").length, 1);
  assert.equal(signatureCalls.filter(([name]) => name === "put").length, 2);
});

test("API and COS errors preserve rich transport facts", async () => {
  const error = Object.assign(new Error("真实错误"), {
    code: "COS_DOMAIN_NOT_ALLOWED", status: 0, statusCode: 0, details: { field: "domain" }
  });
  const api = fakeApi([], directUpload(), { putError: () => error });
  await assert.rejects(uploadAlbumPhoto({
    sessionId: 8, filePath: "/tmp/a.jpg", fileSize: 10, contentType: "image/jpeg",
    api, execute: fastExecute
  }), (actual) => actual === error && actual.details.field === "domain" && actual.message === "真实错误");
});

test("album API requests suppress maintenance without changing generic default", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/utils/api.js", import.meta.url), "utf8")
  );
  for (const name of [
    "createSessionAlbumPhotoUploadIntent",
    "getSessionAlbumPhotoUploadStatus",
    "finalizeSessionAlbumPhotoUpload"
  ]) {
    const start = source.indexOf(`function ${name}`);
    assert.equal(start > 0, true, name);
    assert.match(source.slice(start, start + 700), /suppressMaintenance:\s*true/);
  }
  assert.match(source, /if \(!options\.suppressMaintenance\)[\s\S]*markBackendMaintenance/);
  assert.match(source, /ContentLength:\s*Number\(upload\.contentLength\)/);
  assert.match(source, /"pic-operations":\s*albumUpload\.picOperations/);
  assert.match(source, /albumUploadIdsByKey\.delete\(String\(upload\.key\)\)/);
  assert.match(source, /300_000/);
  assert.match(source, /task\?\.abort\?\.\(\)/);
});
