import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const EXPECTED = new Map([
  ["apps/miniprogram/src/static/art/album-share-friend.jpg", [1000, 800]],
  ["apps/miniprogram/src/static/art/album-share-timeline.jpg", [1000, 1000]]
]);
const helperPath = "apps/miniprogram/src/utils/albumShareCover.js";
const fallbackNames = Array.from(EXPECTED.keys()).map((file) => path.basename(file));
const allowMissingTask7Helper = process.argv.includes("--allow-missing-task7-helper");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyFallbackArtwork() {
  for (const [relativePath, [width, height]] of EXPECTED) {
    const absolutePath = path.join(root, relativePath);
    assert(fs.existsSync(absolutePath), `D52 fallback artwork is missing: ${relativePath}`);

    const metadata = await sharp(absolutePath).metadata();
    assert(metadata.format === "jpeg", `D52 fallback artwork must be JPEG: ${relativePath}`);
    assert(
      metadata.width === width && metadata.height === height,
      `D52 fallback artwork must be ${width}×${height}: ${relativePath} is ${metadata.width}×${metadata.height}`
    );
    await sharp(absolutePath, { failOn: "error" }).raw().toBuffer();
  }
}

function verifyShareHelperWhenPresent() {
  const helper = path.join(root, helperPath);
  if (!fs.existsSync(helper)) {
    if (allowMissingTask7Helper) {
      console.log("D52 helper integration temporarily skipped for Task 6");
      return;
    }
    throw new Error(
      `D52 album share helper is missing: ${helperPath}. ` +
      "Use --allow-missing-task7-helper only for the temporary Task 6 asset check."
    );
  }

  const source = fs.readFileSync(helper, "utf8");
  for (const fallbackName of fallbackNames) {
    assert(
      source.includes(fallbackName),
      `D52 album share helper must reference ${fallbackName}`
    );
  }
  assert(
    !source.includes("ticket-landscape.jpg"),
    "D52 album share helper must not use the single-media ticket fallback"
  );
  console.log("D52 helper fallback references verified");
}

await verifyFallbackArtwork();
verifyShareHelperWhenPresent();
console.log("D52 adaptive album share fallback artwork checks passed");
