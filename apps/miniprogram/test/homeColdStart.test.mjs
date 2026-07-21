import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(
  new URL("../src/pages/index/index.vue", import.meta.url),
  "utf8"
);

test("cold home renders a native boot state before custom components", () => {
  const pageRoot = '<view class="page home-page">';
  const rootStart = homeSource.indexOf(pageRoot);
  const bootStart = homeSource.indexOf(
    '<view v-if="isHomeBooting" class="home-boot-state">',
    rootStart
  );
  const businessStart = homeSource.indexOf("<template v-else>", bootStart);
  const authStart = homeSource.indexOf("<AuthIdentityBar", businessStart);

  assert.notEqual(rootStart, -1, "home page root must exist");
  assert.notEqual(bootStart, -1, "home page must expose a native cold-start state");
  assert.notEqual(businessStart, -1, "home business components must be deferred to v-else");
  assert.ok(bootStart < businessStart, "boot state must render before the business branch");
  assert.ok(authStart > businessStart, "AuthIdentityBar must mount only after boot completes");

  const bootMarkup = homeSource.slice(bootStart, businessStart);
  assert.match(bootMarkup, /剧本迷·拼车/);
  assert.match(bootMarkup, /首页加载中/);
  assert.doesNotMatch(
    bootMarkup,
    /<(?:[A-Z]|t-)/,
    "cold-start state must not depend on custom or TDesign components"
  );
  assert.match(
    homeSource,
    /const isHomeBooting = computed\(\(\) => backendStatus\.available === null\);/,
    "boot state must last until the first backend availability result"
  );
});
