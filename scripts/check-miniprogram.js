import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const miniprogramRoot = path.join(root, "apps/miniprogram");
const appJsonPath = path.join(miniprogramRoot, "app.json");

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!fs.existsSync(appJsonPath)) {
  fail("apps/miniprogram/app.json is missing");
} else {
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
  const pages = appJson.pages || [];
  const extensions = [".js", ".json", ".wxml", ".wxss"];

  for (const page of pages) {
    for (const extension of extensions) {
      const file = path.join(miniprogramRoot, `${page}${extension}`);
      if (!fs.existsSync(file)) {
        fail(`Missing miniprogram page file: ${file}`);
      }
    }
  }

  if (!process.exitCode) {
    console.log(`Miniprogram check passed: ${pages.length} pages`);
  }
}
