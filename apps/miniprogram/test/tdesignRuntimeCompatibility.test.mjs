import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const miniprogramRoot = path.resolve(testDirectory, "..");
const tdesignBuildRoot = path.join(
  miniprogramRoot,
  "dist/build/mp-weixin/wxcomponents/tdesign-miniprogram"
);

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(file);
    }
    return entry.isFile() ? [file] : [];
  });
}

function collectJavaScriptFiles(directory) {
  return collectFiles(directory).filter((file) => file.endsWith(".js"));
}

test("TDesign build output does not ship ESM syntax to the WeChat runtime", () => {
  assert.ok(fs.existsSync(tdesignBuildRoot), "run the mp-weixin build before this test");

  const esmFiles = collectJavaScriptFiles(tdesignBuildRoot)
    .filter((file) => /(^|\n)\s*(?:import|export)\b/.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(miniprogramRoot, file));

  assert.deepEqual(
    esmFiles,
    [],
    `WeChat registers these files with require(), so ESM syntax prevents component registration:\n${esmFiles.join("\n")}`
  );
});

test("TDesign build output includes every bare runtime dependency", () => {
  assert.ok(fs.existsSync(tdesignBuildRoot), "run the mp-weixin build before this test");

  const dependencies = new Set();
  for (const file of collectJavaScriptFiles(tdesignBuildRoot)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
      if (!match[1].startsWith(".")) {
        dependencies.add(match[1]);
      }
    }
  }

  const missingDependencies = [...dependencies]
    .filter((dependency) => {
      const runtimePath = path.join(
        tdesignBuildRoot,
        "miniprogram_npm",
        dependency
      );
      return ![`${runtimePath}.js`, path.join(runtimePath, "index.js")].some(fs.existsSync);
    })
    .sort();

  assert.deepEqual(
    missingDependencies,
    [],
    `TDesign runtime dependencies must be copied into miniprogram_npm:\n${missingDependencies.join("\n")}`
  );
});

test("TDesign build output omits TypeScript declarations", () => {
  assert.ok(fs.existsSync(tdesignBuildRoot), "run the mp-weixin build before this test");

  const declarationFiles = collectFiles(tdesignBuildRoot)
    .filter((file) => file.endsWith(".d.ts"))
    .map((file) => path.relative(miniprogramRoot, file));

  assert.deepEqual(
    declarationFiles,
    [],
    `TypeScript declarations are not loaded by the WeChat runtime and bloat the main package:\n${declarationFiles.join("\n")}`
  );
});
