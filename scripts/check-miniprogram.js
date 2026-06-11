import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const miniprogramRoot = path.join(root, "apps/miniprogram");
const srcRoot = path.join(miniprogramRoot, "src");
const pagesJsonPath = path.join(srcRoot, "pages.json");

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!fs.existsSync(pagesJsonPath)) {
  fail("apps/miniprogram/src/pages.json is missing");
} else {
  const pagesJson = JSON.parse(fs.readFileSync(pagesJsonPath, "utf8"));
  const pages = pagesJson.pages || [];

  for (const page of pages) {
    const pagePath = typeof page === "string" ? page : page.path;
    const file = path.join(srcRoot, `${pagePath}.vue`);
    if (!fs.existsSync(file)) {
      fail(`Missing UniApp page file: ${file}`);
    }
  }

  for (const required of ["App.vue", "main.js", "manifest.json"]) {
    const file = path.join(srcRoot, required);
    if (!fs.existsSync(file)) {
      fail(`Missing UniApp source file: ${file}`);
    }
  }

  if (!process.exitCode) {
    console.log(`UniApp miniprogram check passed: ${pages.length} pages`);
  }
}
