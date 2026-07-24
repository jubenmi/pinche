import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const pagesJson = JSON.parse(
  fs.readFileSync(new URL("../src/pages.json", import.meta.url), "utf8")
);

const ORIGINAL_UNI_VERSION = "3.0.0-5000720260410001";

test("every page keeps the default WebView renderer", () => {
  for (const page of pagesJson.pages) {
    assert.notEqual(page?.style?.renderer, "skyline", page.path);
    assert.notEqual(page?.style?.componentFramework, "glass-easel", page.path);
  }
});

test("uni compiler packages return to the pre-Skyline version", () => {
  for (const name of [
    "@dcloudio/uni-app",
    "@dcloudio/uni-mp-weixin",
    "@dcloudio/vite-plugin-uni"
  ]) {
    assert.equal(packageJson.devDependencies[name], ORIGINAL_UNI_VERSION, name);
  }
});
