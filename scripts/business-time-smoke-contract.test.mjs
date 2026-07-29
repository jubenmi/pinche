import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = [
  "d2-smoke-test.js",
  "d4-smoke-test.js",
  "d5-smoke-test.js",
  "d6-smoke-test.js",
  "d7-smoke-test.js",
  "d8-qa-check.js",
  "d10-pseudo-chat-smoke.js",
  "d18-session-album-privacy-smoke.js",
  "d23-album-share-join-policy-smoke.js",
  "d30-current-signup-role-check.js",
  "d32-admin-album-video-smoke.js",
  "d34-store-location-smoke.js",
  "d38-city-session-discovery-smoke.js",
  "d40-guest-calendar-home-smoke.js",
  "d46-author-private-content-api-smoke.js",
  "d53-album-four-action-selection-smoke.js"
];

test("API smoke clients retain the timezone on generated startAt values", async () => {
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /toISOString\(\)[\s\S]{0,80}slice\(0,\s*19\)[\s\S]{0,80}replace\(["']T["'],\s*["'] ["']\)/,
      file
    );
  }
});
