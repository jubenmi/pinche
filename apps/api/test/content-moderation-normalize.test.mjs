import assert from "node:assert/strict";
import test from "node:test";

import {
  MODERATION_DECISIONS,
  MODERATION_JOB_STATUSES,
  MODERATION_PROVIDERS
} from "../src/modules/content-moderation/constants.js";
import {
  createResponseSummary,
  digestNormalizedText,
  normalizeProviderResult,
  normalizeTextFields
} from "../src/modules/content-moderation/normalize.js";

test("moderation constants expose only the spec states and providers", () => {
  assert.deepEqual(MODERATION_DECISIONS, ["pass", "review", "block", "error"]);
  assert.deepEqual(MODERATION_JOB_STATUSES, [
    "pending", "processing", "approved", "review", "rejected", "error"
  ]);
  assert.deepEqual(MODERATION_PROVIDERS, ["tencent_ci", "tencent_tms"]);
});

test("provider suggestions map case-insensitively and unknown values fail closed", () => {
  assert.equal(normalizeProviderResult({ Suggestion: "Pass" }).decision, "pass");
  assert.equal(normalizeProviderResult({ suggestion: "REVIEW" }).decision, "review");
  assert.equal(normalizeProviderResult({ Suggestion: "block" }).decision, "block");
  assert.equal(normalizeProviderResult({ Suggestion: "allow" }).decision, "error");
  assert.equal(normalizeProviderResult({}).decision, "error");
  assert.equal(normalizeProviderResult(null).decision, "error");
});

test("provider result keeps bounded decision metadata without private content", () => {
  const result = normalizeProviderResult({
    Suggestion: "Review",
    Label: "Porn",
    SubLabel: "SexualBehavior",
    Score: 87,
    JobId: "job-1",
    DataId: "data-1",
    Text: "private text",
    SecretKey: "secret"
  });

  assert.deepEqual(result, {
    decision: "review",
    suggestion: "Review",
    label: "Porn",
    subLabel: "SexualBehavior",
    score: 87,
    providerJobId: "job-1",
    dataId: "data-1"
  });
  const summary = createResponseSummary(result, { maxBytes: 256 });
  assert.equal(JSON.stringify(summary).includes("private text"), false);
  assert.equal(JSON.stringify(summary).includes("secret"), false);
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) <= 256);
});

test("text fields normalize deterministically with labels and stable digest", () => {
  const left = normalizeTextFields({ summary: "  周末\r\n欢乐本  ", nickname: "Ａlice" });
  const right = normalizeTextFields({ nickname: "Alice", summary: "周末\n欢乐本" });

  assert.equal(left, "[nickname]Alice\n[summary]周末\n欢乐本");
  assert.equal(right, left);
  assert.match(digestNormalizedText(left), /^[a-f0-9]{64}$/);
  assert.equal(digestNormalizedText(left), digestNormalizedText(right));
  assert.notEqual(digestNormalizedText(left), digestNormalizedText(`${right}!`));
});

test("text normalization drops empty fields and rejects unsafe labels", () => {
  assert.equal(normalizeTextFields({ nickname: " ", summary: "ok" }), "[summary]ok");
  assert.throws(() => normalizeTextFields({ "bad\nlabel": "text" }), /label/i);
  assert.throws(() => normalizeTextFields({}), /at least one/i);
});
