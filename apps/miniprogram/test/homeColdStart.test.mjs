import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(
  new URL("../src/pages/index/index.vue", import.meta.url),
  "utf8"
);
const pages = JSON.parse(
  await readFile(new URL("../src/pages.json", import.meta.url), "utf8")
);

test("cold home renders a native boot state before custom components", () => {
  const pageRoot = '<view class="page home-page">';
  const rootStart = homeSource.indexOf(pageRoot);
  const bootStart = homeSource.indexOf(
    `<view class="home-boot-state" :style="{ display: showHomeBoot ? 'flex' : 'none' }">`,
    rootStart
  );
  const businessStart = homeSource.indexOf(
    '<template v-if="hasBackendResult">',
    bootStart
  );
  const authStart = homeSource.indexOf("<AuthIdentityBar", businessStart);

  assert.notEqual(rootStart, -1, "home page root must exist");
  assert.notEqual(bootStart, -1, "home page must expose a native cold-start state");
  assert.notEqual(businessStart, -1, "home business components must wait for readiness");
  assert.ok(bootStart < businessStart, "boot state must render before the business branch");
  assert.ok(authStart > businessStart, "AuthIdentityBar must mount only after boot completes");

  const bootMarkup = homeSource.slice(bootStart, businessStart);
  assert.match(bootMarkup, /剧本谜/);
  assert.match(bootMarkup, />谜<\/view>/);
  assert.match(bootMarkup, /首页加载中/);
  assert.doesNotMatch(
    bootMarkup,
    /<(?:[A-Z]|t-)/,
    "cold-start state must not depend on custom or TDesign components"
  );
  assert.doesNotMatch(
    bootMarkup,
    /v-if=/,
    "native boot state must use dynamic display instead of conditional rendering"
  );
});

test("home enables WeChat static initial rendering cache", () => {
  const homePage = pages.pages.find((page) => page.path === "pages/index/index");

  assert.ok(homePage, "home page config must exist");
  assert.equal(homePage.style.initialRenderingCache, "static");
});

test("home boot state waits for the backend result and initial calendar load", () => {
  assert.match(homeSource, /const initialHomeSettled = ref\(false\);/);
  assert.match(
    homeSource,
    /const hasBackendResult = computed\(\(\) => backendStatus\.available !== null\);/
  );
  assert.match(
    homeSource,
    /const showHomeBoot = computed\(\s*\(\) =>\s*backendStatus\.available === null \|\|\s*\(backendStatus\.available === true && !initialHomeSettled\.value\)\s*\);/,
    "boot state must remain visible until the available backend finishes its initial calendar load"
  );

  const loadHomeCalendarStart = homeSource.indexOf(
    "async function loadHomeCalendar()"
  );
  const loadGuestSessionsStart = homeSource.indexOf(
    "async function loadGuestSessions()",
    loadHomeCalendarStart
  );
  const loadHomeCalendarSource = homeSource.slice(
    loadHomeCalendarStart,
    loadGuestSessionsStart
  );

  assert.notEqual(loadHomeCalendarStart, -1, "loadHomeCalendar must exist");
  assert.notEqual(loadGuestSessionsStart, -1, "loadGuestSessions must follow it");
  assert.match(
    loadHomeCalendarSource,
    /finally\s*{\s*initialHomeSettled\.value = true;\s*}/,
    "initial calendar load must settle the boot state after success or failure"
  );
});
