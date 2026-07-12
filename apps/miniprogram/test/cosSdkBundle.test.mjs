import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const outputRoot = new URL("../dist/build/mp-weixin/", import.meta.url);

test("production bundle resolves the COS SDK at build time", async () => {
  const [apiBundle, vendorBundle] = await Promise.all([
    readFile(new URL("utils/api.js", outputRoot), "utf8"),
    readFile(new URL("common/vendor.js", outputRoot), "utf8")
  ]);

  assert.doesNotMatch(apiBundle, /cos-wx-sdk-v5/);
  assert.doesNotMatch(apiBundle, /utils\/cos-wx-sdk-v5/);
  assert.match(vendorBundle, /sdkVersionName:\s*["']cos-wx-sdk-v5["']/);
});
