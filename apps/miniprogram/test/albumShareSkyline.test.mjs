import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const pagesJson = JSON.parse(
  fs.readFileSync(new URL("../src/pages.json", import.meta.url), "utf8")
);

const SKYLINE_UNI_VERSION = "3.0.0-5010520260709002";

test("album page alone opts into Skyline and GlassEasel", () => {
  const album = pagesJson.pages.find((page) => page.path === "pages/session/album");
  assert.equal(album?.style?.renderer, "skyline");
  assert.equal(album?.style?.componentFramework, "glass-easel");

  for (const page of pagesJson.pages.filter(
    (item) => item.path !== "pages/session/album"
  )) {
    assert.notEqual(page?.style?.renderer, "skyline", page.path);
    assert.notEqual(page?.style?.componentFramework, "glass-easel", page.path);
  }
});

test("uni compiler packages use the stable snapshot-capable release", () => {
  for (const name of [
    "@dcloudio/uni-app",
    "@dcloudio/uni-mp-weixin",
    "@dcloudio/vite-plugin-uni"
  ]) {
    assert.equal(packageJson.devDependencies[name], SKYLINE_UNI_VERSION, name);
  }
});
