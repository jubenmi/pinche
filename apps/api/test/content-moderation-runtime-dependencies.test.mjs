import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("API declares the shared workspace package imported by its production server", async () => {
  const [serverSource, packageJson] = await Promise.all([
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8")
  ]);
  const apiPackage = JSON.parse(packageJson);

  assert.match(serverSource, /from "@pinche\/shared"/);
  assert.equal(apiPackage.dependencies?.["@pinche/shared"], "file:../../packages/shared");
});
