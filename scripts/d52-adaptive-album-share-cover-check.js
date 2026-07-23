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
  }
}

function verifyShareHelperWhenPresent() {
  const helper = path.join(root, helperPath);
  if (!fs.existsSync(helper)) {
    console.log("D52 helper integration pending Task 7: albumShareCover.js is not present yet");
    return;
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
