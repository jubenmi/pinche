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
  const bootStart = pageWxml.indexOf('<view class="home-boot-state');
  const firstBusinessIndex = pageWxml.indexOf("<block wx:if=");

  assert.ok(
    bootStart >= 0,
    'the uploaded home WXML must include a root <view class="home-boot-state">'
  );
  assert.ok(
    firstBusinessIndex >= 0,
    "the uploaded home WXML must include a conditional business block"
  );
  assert.ok(
    bootStart < firstBusinessIndex,
    "the home boot state must appear strictly before the first business condition block"
  );

  const bootMarkup = pageWxml.slice(bootStart, firstBusinessIndex);
  assert.match(bootMarkup, /剧本谜/);
  assert.match(bootMarkup, />谜<\/view>/);
  assert.match(bootMarkup, /首页加载中/);

  const nativeTags = new Set(["view", "text", "image"]);
  const unsupportedTags = [
    ...new Set(
      [...bootMarkup.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/gi)]
        .map((match) => match[1].toLowerCase())
        .filter((tagName) => !nativeTags.has(tagName))
    )
  ].sort();
  assert.deepEqual(
    unsupportedTags,
    [],
    `the boot markup must use only native view/text/image tags; found: ${unsupportedTags.join(", ")}`
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
