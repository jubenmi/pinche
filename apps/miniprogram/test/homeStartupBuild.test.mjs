import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const outputRoot = new URL("../dist/build/mp-weixin/", import.meta.url);

async function readBuildOutput(relativePath) {
  try {
    return await readFile(new URL(relativePath, outputRoot), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      assert.fail(
        `${relativePath} is missing; run the production build before this test`
      );
    }
    throw error;
  }
}

test("home page enables static initial rendering in the uploaded build", async () => {
  const pageJson = JSON.parse(
    await readBuildOutput("pages/index/index.json")
  );

  assert.equal(
    pageJson.initialRenderingCache,
    "static",
    "the uploaded home page must enable initialRenderingCache=static"
  );
});

test("home boot state renders before the business component block", async () => {
  const pageWxml = await readBuildOutput("pages/index/index.wxml");
  const bootIndex = pageWxml.indexOf('class="home-boot-state');
  const businessBlockIndex = pageWxml.indexOf("<block wx:if=", bootIndex);

  assert.notEqual(
    bootIndex,
    -1,
    'the uploaded home WXML must include class="home-boot-state"'
  );
  assert.notEqual(
    businessBlockIndex,
    -1,
    "the uploaded home WXML must include a conditional business block after the boot state"
  );
  assert.ok(
    bootIndex < businessBlockIndex,
    "the home boot state must appear strictly before the first business condition block"
  );

  const bootFragment = pageWxml.slice(bootIndex, businessBlockIndex);
  assert.match(bootFragment, /剧本迷·拼车/);
  assert.match(bootFragment, /首页加载中/);
  assert.doesNotMatch(
    bootFragment,
    /<(?:auth-identity-bar|session-calendar|feedback-host|t-[\w-]+)(?:\s|\/|>)/,
    "the boot fragment must not depend on custom components"
  );
});

test("uploaded vendor runtime avoids unsupported Intl startup APIs", async () => {
  const vendorSource = await readBuildOutput("common/vendor.js");

  assert.doesNotMatch(
    vendorSource,
    /Intl\.DateTimeFormat|formatToParts/,
    "Intl.DateTimeFormat or formatToParts can break review-device startup before wx.createPage registers the home page"
  );
});
