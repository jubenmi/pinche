import assert from "node:assert/strict";
import test from "node:test";

import { executeAlbumCosUpload } from "@pinche/shared";
import { uploadAdminAlbumPhoto } from "../src/albumMedia.js";

function photoFile(size = 2048, name = "photo.png", type = "image/png") {
  return new File([new Uint8Array(size)], name, { type });
}

function directUpload(overrides = {}) {
  return {
    uploadMode: "cos-direct-v2", direct: true, fallbackAllowed: false,
    uploadId: "upload-43", key: "photo.jpg", ...overrides
  };
}

function fakeAdminApi(calls, upload, options = {}) {
  let puts = 0;
  return {
    requestAlbumPhotoUploadIntent: async (sessionId, file, input) => {
      calls.push(["intent", sessionId, file.size, file.type, input]);
      return upload;
    },
    putAlbumPhotoToCos: async () => {
      puts += 1;
      calls.push(["put", puts]);
      const error = options.putError?.(puts);
      if (error) throw error;
    },
    getAlbumPhotoUploadStatus: async () => {
      calls.push(["status"]);
      return (typeof options.status === "function" ? options.status(puts) : options.status) ||
        { validationState: "ready", canFinalize: true };
    },
    finalizeAlbumPhotoUpload: async () => { calls.push(["finalize"]); return { photo: { id: 91 } }; },
    clearAlbumPhotoAuthorization: () => calls.push(["clearAuth"]),
    uploadSessionAlbumPhotoLocal: async () => { calls.push(["multipart"]); return "/local.jpg"; },
    createSessionAlbumPhoto: async () => { calls.push(["legacyCreate"]); return { id: 92 }; },
    reportAlbumMediaEvent: () => {}
  };
}

const fastExecute = (options) => executeAlbumCosUpload({
  ...options, sleep: async () => {}, random: () => 0, maxStatusPolls: 2
});

test("admin v2 upload finalizes directly and never calls multipart", async () => {
  const calls = [];
  const result = await uploadAdminAlbumPhoto({
    sessionId: 8,
    file: photoFile(),
    adminOwner: true,
    api: fakeAdminApi(calls, directUpload()),
    execute: fastExecute,
    onPhase: (phase) => calls.push(["phase", phase.phase, phase.retry])
  });
  assert.equal(result.photo.id, 91);
  assert.equal(calls.some(([name]) => name === "multipart"), false);
  assert.deepEqual(calls.find(([name]) => name === "intent").slice(1), [
    8, 2048, "image/png", { adminOwner: true }
  ]);
});

test("admin local fallback requires exact server fields", async () => {
  const calls = [];
  const result = await uploadAdminAlbumPhoto({
    sessionId: 8,
    file: photoFile(10, "photo.jpg", "image/jpeg"),
    adminOwner: true,
    api: fakeAdminApi(calls, { uploadMode: "api-local", direct: false, fallbackAllowed: true })
  });
  assert.equal(result.photo.id, 92);
  assert.equal(calls.filter(([name]) => name === "multipart").length, 1);
});

test("unknown response cannot opt into multipart fallback", async () => {
  for (const upload of [
    { direct: false, fallbackAllowed: false },
    { uploadMode: "unknown", direct: false, fallbackAllowed: true }
  ]) {
    const calls = [];
    await assert.rejects(uploadAdminAlbumPhoto({
      sessionId: 8, file: photoFile(), adminOwner: true, api: fakeAdminApi(calls, upload)
    }), { code: "DIRECT_UPLOAD_REQUIRED" });
    assert.equal(calls.some(([name]) => name === "multipart"), false);
  }
});

test("retry checks status, conflict avoids second PUT, and signature refreshes once", async () => {
  const retryCalls = [];
  await uploadAdminAlbumPhoto({
    sessionId: 8, file: photoFile(), adminOwner: true,
    api: fakeAdminApi(retryCalls, directUpload(), {
      putError: (count) => count === 1 ? Object.assign(new Error("reset"), { code: "COS_NETWORK_ERROR" }) : null,
      status: (count) => count === 1
        ? { validationState: "missing", canFinalize: false }
        : { validationState: "ready", canFinalize: true }
    }), execute: fastExecute
  });
  assert.deepEqual(retryCalls.filter(([name]) => ["put", "status"].includes(name)).map(([name]) => name), [
    "put", "status", "put", "status"
  ]);

  const conflictCalls = [];
  await uploadAdminAlbumPhoto({
    sessionId: 8, file: photoFile(), adminOwner: true,
    api: fakeAdminApi(conflictCalls, directUpload(), {
      putError: () => Object.assign(new Error("exists"), { statusCode: 412 })
    }), execute: fastExecute
  });
  assert.equal(conflictCalls.filter(([name]) => name === "put").length, 1);

  const signatureCalls = [];
  await uploadAdminAlbumPhoto({
    sessionId: 8, file: photoFile(), adminOwner: true,
    api: fakeAdminApi(signatureCalls, directUpload(), {
      putError: (count) => count === 1
        ? Object.assign(new Error("expired"), { code: "SignatureDoesNotMatch" }) : null
    }), execute: fastExecute
  });
  assert.equal(signatureCalls.filter(([name]) => name === "clearAuth").length, 1);
});

test("browser and COS errors preserve message, code, status, and details", async () => {
  const expected = Object.assign(new Error("CORS blocked"), {
    code: "COS_DOMAIN_NOT_ALLOWED", status: 0, statusCode: 0, details: { origin: "admin" }
  });
  await assert.rejects(uploadAdminAlbumPhoto({
    sessionId: 8, file: photoFile(), adminOwner: true,
    api: fakeAdminApi([], directUpload(), { putError: () => expected }), execute: fastExecute
  }), (error) => error === expected && error.details.origin === "admin");
});

test("generic album video continues using generic fallback upload", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/api.js", import.meta.url), "utf8")
  );
  const videoStart = source.indexOf("function uploadSessionAlbumVideo");
  assert.match(source.slice(videoStart, videoStart + 700), /uploadCosBackedFile/);
  assert.match(source.slice(videoStart, videoStart + 700), /fallbackUploadSessionAlbumVideo/);
  assert.match(source, /uploadId:\s*albumUpload\.uploadId/);
  assert.match(source, /ContentLength:\s*file\.size/);
  assert.match(source, /albumAuthorizationErrorsByKey\.get\(key\)/);
  assert.match(source, /300_000/);
  assert.match(source, /task\?\.abort\?\.\(\)/);
});
