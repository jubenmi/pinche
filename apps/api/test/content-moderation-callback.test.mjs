import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TENCENT_VIDEO_CALLBACK_MAX_BYTES,
  authenticateTencentCallback,
  parseTencentCallbackPayload,
  resolveTencentVideoCallback
} from "../src/modules/content-moderation/callback.js";

test("callback token comparison accepts exact token and rejects missing or forged values", () => {
  const current = "x".repeat(32);
  const previous = "p".repeat(32);
  assert.equal(authenticateTencentCallback(current, [current, previous]), true);
  assert.equal(authenticateTencentCallback(previous, [current, previous]), true);
  assert.equal(authenticateTencentCallback("", [current, previous]), false);
  assert.equal(authenticateTencentCallback("y".repeat(32), [current, previous]), false);
  assert.equal(authenticateTencentCallback("x", [current, previous]), false);
});

test("strict JSON callback parser extracts immutable media identifiers and result", () => {
  const event = parseTencentCallbackPayload(JSON.stringify({
    JobsDetail: {
      JobId: "job-1",
      DataId: "data-1",
      Object: "uploads/session-album/videos/source/a.mp4",
      State: "Success",
      Result: 2,
      Label: "Porn",
      SubLabel: "Sexy",
      Score: 78
    }
  }));
  assert.deepEqual(event, {
    providerJobId: "job-1",
    dataId: "data-1",
    objectKey: "uploads/session-album/videos/source/a.mp4",
    result: {
      decision: "review",
      suggestion: "review",
      label: "Porn",
      subLabel: "Sexy",
      score: 78,
      providerJobId: "job-1",
      dataId: "data-1"
    }
  });
});

test("strict XML callback parser supports CI detail callbacks", () => {
  const event = parseTencentCallbackPayload(
    "<Response><JobsDetail><JobId>job-2</JobId><DataId>data-2</DataId>" +
    "<Object>uploads/session-album/videos/source/a.mp4</Object><State>Success</State><Result>1</Result>" +
    "<Label>Terrorism</Label><Score>98</Score></JobsDetail></Response>"
  );
  assert.equal(event.providerJobId, "job-2");
  assert.equal(event.dataId, "data-2");
  assert.equal(event.result.decision, "block");
});

test("callback parser rejects incomplete, oversized, and non-video-source events", () => {
  for (const body of [
    "{}",
    JSON.stringify({ JobsDetail: { JobId: "j", DataId: "d", Object: "uploads/session-album/videos/display/a.mp4", Suggestion: "Pass" } }),
    JSON.stringify({ JobsDetail: { JobId: "j", DataId: "d", Object: "uploads/session-album/videos/source/a.mov", Suggestion: "Pass" } }),
    "not-json-or-xml",
    "x".repeat(TENCENT_VIDEO_CALLBACK_MAX_BYTES + 1)
  ]) {
    assert.throws(() => parseTencentCallbackPayload(body), {
      code: "CONTENT_MODERATION_INVALID_CALLBACK"
    });
  }
});

test("CI Detail callback requires official JobId, DataId, and Object field names", () => {
  for (const detail of [
    {
      TaskId: "legacy-task",
      DataId: "data-1",
      Object: "uploads/session-album/videos/source/a.mp4",
      State: "Success",
      Result: 0
    },
    {
      JobId: "job-1",
      dataId: "data-1",
      Object: "uploads/session-album/videos/source/a.mp4",
      State: "Success",
      Result: 0
    },
    {
      JobId: "job-1",
      DataId: "data-1",
      object: "uploads/session-album/videos/source/a.mp4",
      State: "Success",
      Result: 0
    }
  ]) {
    assert.throws(() => parseTencentCallbackPayload(JSON.stringify({ JobsDetail: detail })), {
      code: "CONTENT_MODERATION_INVALID_CALLBACK"
    });
  }
});

test("bounded Tencent Detail callback accepts 256KiB to 1MiB bodies without retaining audio text", () => {
  const body = JSON.stringify({
    JobsDetail: {
      JobId: "job-large",
      DataId: "data-large",
      Object: "uploads/session-album/videos/source/a.mp4",
      State: "Success",
      Result: 0,
      AudioSection: [{ Text: "x".repeat(256 * 1024) }]
    }
  });
  assert.ok(Buffer.byteLength(body, "utf8") > 256 * 1024);
  assert.ok(Buffer.byteLength(body, "utf8") <= TENCENT_VIDEO_CALLBACK_MAX_BYTES);
  const callback = parseTencentCallbackPayload(body);
  assert.equal(callback.result.decision, "pass");
  assert.equal(JSON.stringify(callback).includes("x".repeat(512)), false);
});

test("CI Detail callback failure, missing state, or unknown result is a valid hidden error result", () => {
  const providerFailure = parseTencentCallbackPayload(JSON.stringify({
    JobsDetail: {
      JobId: "job-3",
      DataId: "data-3",
      Object: "uploads/session-album/videos/source/a.mp4",
      State: "Failed",
      Result: 0
    }
  }));
  assert.equal(providerFailure.result.decision, "error");
  assert.equal(providerFailure.result.suggestion, "");

  const unknownResult = parseTencentCallbackPayload(JSON.stringify({
    JobsDetail: {
      JobId: "job-4",
      DataId: "data-4",
      Object: "uploads/session-album/videos/source/a.mp4",
      State: "Success",
      Result: 9
    }
  }));
  assert.equal(unknownResult.result.decision, "error");
  assert.equal(unknownResult.result.suggestion, "");

  const missingState = parseTencentCallbackPayload(JSON.stringify({
    JobsDetail: {
      JobId: "job-5",
      DataId: "data-5",
      Object: "uploads/session-album/videos/source/a.mp4",
      Result: 0
    }
  }));
  assert.equal(missingState.result.decision, "error");
});

test("CI Detail callback maps only the documented aggregate results", () => {
  for (const [resultCode, expectedDecision] of [[0, "pass"], [1, "block"], [2, "review"]]) {
    const callback = parseTencentCallbackPayload(JSON.stringify({
      JobsDetail: {
        JobId: `job-${resultCode}`,
        DataId: `data-${resultCode}`,
        Object: "uploads/session-album/videos/source/a.mp4",
        State: "Success",
        Result: resultCode
      }
    }));
    assert.equal(callback.result.decision, expectedDecision);
    assert.equal(callback.result.suggestion, expectedDecision);
  }
});

test("known pending Tencent video job without a recorded attempt asks CI to retry instead of losing an early callback", async () => {
  const state = { lookedUpAttempt: 0 };
  const result = await resolveTencentVideoCallback({
    callback: { providerJobId: "ci-new", dataId: "data-7" },
    withDatabaseConnection: async (run) => run({}),
    repository: {
      findModerationJobByDataId: async () => ({
        id: 7,
        provider: "tencent_ci_video",
        subject_type: "album_video",
        status: "pending",
        decided_by_admin_user_id: null
      }),
      findModerationAttemptByProviderJobId: async () => {
        state.lookedUpAttempt += 1;
        return null;
      }
    }
  });
  assert.deepEqual(result, { retryable: true, stale: false, job: null });
  assert.equal(state.lookedUpAttempt, 1);
});

test("unknown DataId and a recorded old attempt remain idempotent stale callbacks", async () => {
  const unknown = await resolveTencentVideoCallback({
    callback: { providerJobId: "ci-unknown", dataId: "unknown-data" },
    withDatabaseConnection: async (run) => run({}),
    repository: {
      findModerationJobByDataId: async () => null,
      findModerationAttemptByProviderJobId: async () => { throw new Error("attempt must not be queried"); }
    }
  });
  assert.deepEqual(unknown, { retryable: false, stale: true, job: null });

  const old = await resolveTencentVideoCallback({
    callback: { providerJobId: "ci-old", dataId: "data-7" },
    withDatabaseConnection: async (run) => run({}),
    repository: {
      findModerationJobByDataId: async () => ({
        id: 7,
        provider: "tencent_ci_video",
        subject_type: "album_video",
        status: "pending",
        decided_by_admin_user_id: null
      }),
      findModerationAttemptByProviderJobId: async () => ({
        id: 99,
        moderation_job_id: 8,
        provider: "tencent_ci_video",
        provider_job_id: "ci-old"
      })
    }
  });
  assert.deepEqual(old, { retryable: false, stale: true, job: null });
});

test("server wires the authenticated callback before the generic JSON body parser", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const route = server.indexOf('/api/internal/content-moderation/tencent-video/callback');
  const genericBody = server.indexOf("const body = await bodyFor(request)");
  assert.ok(route > 0 && route < genericBody);
  const routeBody = server.slice(route, genericBody);
  assert.match(routeBody, /authenticateTencentCallback/);
  assert.match(routeBody, /parseTencentCallbackPayload/);
  assert.match(routeBody, /resolveTencentVideoCallback/);
  assert.doesNotMatch(routeBody, /findModerationJobByProviderJobId/);
  assert.match(routeBody, /provider: "tencent_ci_video"/);
  assert.match(routeBody, /providerJobId: callback\.providerJobId/);
  assert.match(routeBody, /stale: true/);
  assert.match(routeBody, /retryable/);
  assert.match(routeBody, /errorResponse\(\s*response,\s*503/);
  assert.match(routeBody, /tencentVideoCallbackPreviousToken/);
  assert.match(routeBody, /readRawBody\(request, TENCENT_VIDEO_CALLBACK_MAX_BYTES\)/);
  assert.match(routeBody, /contentModeration\.applyMediaResult/);
  assert.match(routeBody, /emitContentModerationEvent\("moderation_callback_failure"/);
  assert.match(routeBody, /outcome: "unauthorized"/);
  assert.doesNotMatch(routeBody, /providedToken[\s\S]{0,200}console\.(?:log|info|warn)/);
});
