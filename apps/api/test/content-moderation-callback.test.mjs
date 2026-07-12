import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  authenticateTencentCallback,
  parseTencentCallbackPayload
} from "../src/modules/content-moderation/callback.js";

test("callback token comparison accepts exact token and rejects missing or forged values", () => {
  const token = "x".repeat(32);
  assert.equal(authenticateTencentCallback(token, token), true);
  assert.equal(authenticateTencentCallback("", token), false);
  assert.equal(authenticateTencentCallback("y".repeat(32), token), false);
  assert.equal(authenticateTencentCallback("x", token), false);
});

test("strict JSON callback parser extracts immutable media identifiers and result", () => {
  const event = parseTencentCallbackPayload(JSON.stringify({
    JobsDetail: {
      JobId: "job-1",
      DataId: "data-1",
      Object: "uploads/session-album/display/a.jpg",
      Suggestion: "Review",
      Label: "Porn",
      SubLabel: "Sexy",
      Score: 78
    }
  }));
  assert.deepEqual(event, {
    providerJobId: "job-1",
    dataId: "data-1",
    objectKey: "uploads/session-album/display/a.jpg",
    result: {
      decision: "review",
      suggestion: "Review",
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
    "<Object>uploads/session-album/videos/source/a.mp4</Object><Suggestion>Block</Suggestion>" +
    "<Label>Terrorism</Label><Score>98</Score></JobsDetail></Response>"
  );
  assert.equal(event.providerJobId, "job-2");
  assert.equal(event.dataId, "data-2");
  assert.equal(event.result.decision, "block");
});

test("callback parser rejects unknown, incomplete, oversized, and non-terminal events", () => {
  for (const body of [
    "{}",
    JSON.stringify({ JobsDetail: { JobId: "j", DataId: "d", Object: "x", Suggestion: "Unknown" } }),
    "not-json-or-xml",
    "x".repeat(256 * 1024 + 1)
  ]) {
    assert.throws(() => parseTencentCallbackPayload(body), {
      code: "CONTENT_MODERATION_INVALID_CALLBACK"
    });
  }
});

test("server wires the authenticated callback before the generic JSON body parser", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const route = server.indexOf('/api/internal/content-moderation/tencent-video/callback');
  const genericBody = server.indexOf("const body = await bodyFor(request)");
  assert.ok(route > 0 && route < genericBody);
  const routeBody = server.slice(route, genericBody);
  assert.match(routeBody, /authenticateTencentCallback/);
  assert.match(routeBody, /parseTencentCallbackPayload/);
  assert.match(routeBody, /findModerationJobByDataId/);
  assert.match(routeBody, /findModerationJobByProviderJobId/);
  assert.match(routeBody, /contentModeration\.applyMediaResult/);
});
