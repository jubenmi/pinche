import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAlbumCosError,
  createSingleFlight,
  executeAlbumCosUpload,
  mergeAlbumMediaUrls,
  shouldRefreshAlbumMedia
} from "../src/albumMedia.js";

test("network and 5xx retry, overwrite conflicts reconcile, ordinary 4xx fail", () => {
  assert.equal(classifyAlbumCosError({ code: "COS_NETWORK_ERROR" }).action, "retry-put");
  assert.equal(classifyAlbumCosError({ statusCode: 503 }).action, "retry-put");
  assert.equal(classifyAlbumCosError({ statusCode: 412 }).action, "reconcile");
  assert.equal(classifyAlbumCosError({ code: "PreconditionFailed" }).action, "reconcile");
  assert.equal(classifyAlbumCosError({ statusCode: 400 }).action, "fail");
  assert.equal(
    classifyAlbumCosError({ statusCode: 0, code: "COS_DOMAIN_NOT_ALLOWED" }).action,
    "fail"
  );
});

test("ambiguous failure checks status before doing one of two retries", async () => {
  const calls = [];
  let puts = 0;
  const result = await executeAlbumCosUpload({
    putObject: async () => {
      calls.push("put");
      puts += 1;
      if (puts === 1) {
        throw Object.assign(new Error("reset"), { code: "COS_NETWORK_ERROR" });
      }
    },
    getStatus: async () => {
      calls.push("status");
      return puts === 1
        ? { validationState: "missing", canFinalize: false }
        : { validationState: "ready", canFinalize: true };
    },
    finalize: async () => ({ photo: { id: 17 } }),
    refreshAuthorization: async () => {},
    sleep: async () => calls.push("sleep"),
    random: () => 0,
    maxStatusPolls: 2,
    onPhase: () => {}
  });
  assert.deepEqual(calls, ["put", "status", "sleep", "put", "status"]);
  assert.equal(result.photo.id, 17);
});

test("overwrite conflict never issues a second PUT and unresolved conflict is stable", async () => {
  let puts = 0;
  await assert.rejects(
    executeAlbumCosUpload({
      putObject: async () => {
        puts += 1;
        throw Object.assign(new Error("exists"), { statusCode: 412 });
      },
      getStatus: async () => ({ validationState: "missing", canFinalize: false }),
      finalize: async () => ({ photo: { id: 1 } }),
      refreshAuthorization: async () => {},
      sleep: async () => {},
      random: () => 0,
      maxStatusPolls: 2,
      onPhase: () => {}
    }),
    (error) => error.code === "COS_UPLOAD_CONFLICT_UNRESOLVED"
  );
  assert.equal(puts, 1);
});

test("signature authorization refreshes once without exceeding three PUT requests", async () => {
  let puts = 0;
  let refreshes = 0;
  const result = await executeAlbumCosUpload({
    putObject: async () => {
      puts += 1;
      if (puts === 1) {
        throw Object.assign(new Error("expired"), { code: "SignatureDoesNotMatch" });
      }
      if (puts === 2) {
        throw Object.assign(new Error("timeout"), { code: "COS_REQUEST_TIMEOUT" });
      }
    },
    getStatus: async () =>
      puts < 3
        ? { validationState: "missing", canFinalize: false }
        : { validationState: "ready", canFinalize: true },
    finalize: async () => ({ photo: { id: 18 } }),
    refreshAuthorization: async () => {
      refreshes += 1;
    },
    sleep: async () => {},
    random: () => 0,
    maxStatusPolls: 2,
    onPhase: () => {}
  });
  assert.equal(result.photo.id, 18);
  assert.equal(puts, 3);
  assert.equal(refreshes, 1);
});

test("retryable failures stop after exactly three PUT requests", async () => {
  let puts = 0;
  await assert.rejects(
    executeAlbumCosUpload({
      putObject: async () => {
        puts += 1;
        throw Object.assign(new Error("unavailable"), { statusCode: 503 });
      },
      getStatus: async () => ({ validationState: "missing", canFinalize: false }),
      finalize: async () => ({ photo: { id: 19 } }),
      refreshAuthorization: async () => {},
      sleep: async () => {},
      random: () => 0,
      onPhase: () => {}
    }),
    (error) => error.statusCode === 503
  );
  assert.equal(puts, 3);
});

test("expiry, authoritative URL merge, and single flight preserve page state", async () => {
  assert.equal(
    shouldRefreshAlbumMedia("2026-07-11T01:05:00.000Z", {
      nowMs: Date.parse("2026-07-11T01:04:30.000Z")
    }),
    true
  );
  const current = {
    photos: [
      { id: 1, preview_display_url: "old", local_preview_path: "wxfile://cached" },
      { id: 2, preview_display_url: "now-hidden" }
    ],
    selected_ids: [1]
  };
  const refreshed = {
    photos: [
      {
        id: 1,
        preview_display_url: "new",
        media_url_expires_at: "2026-07-11T01:10:00.000Z"
      },
      { id: 3, preview_display_url: "new-photo" }
    ]
  };
  assert.deepEqual(mergeAlbumMediaUrls(current, refreshed), {
    photos: [
      {
        id: 1,
        preview_display_url: "new",
        local_preview_path: "wxfile://cached",
        media_url_expires_at: "2026-07-11T01:10:00.000Z"
      },
      { id: 3, preview_display_url: "new-photo" }
    ],
    selected_ids: [1]
  });

  let runs = 0;
  const flight = createSingleFlight();
  const first = flight.run(async () => {
    runs += 1;
    return 9;
  });
  const second = flight.run(async () => {
    runs += 1;
    return 10;
  });
  assert.equal(await first, 9);
  assert.equal(await second, 9);
  assert.equal(runs, 1);
});
