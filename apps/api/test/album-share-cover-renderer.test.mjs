import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import sharp from "sharp";

import {
  albumShareCoverCopy,
  escapeAlbumShareCoverXml
} from "../src/modules/album-share-cover/copy.js";
import { renderAlbumShareCover } from "../src/modules/album-share-cover/renderer.js";

const IVORY = { r: 244, g: 235, b: 221 };

async function source(width, height, color) {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

function image(id, buffer, width, height, overrides = {}) {
  return { id, buffer, width, height, quality: 1 - id / 100, ...overrides };
}

async function pixel(buffer, x, y) {
  const { data } = await sharp(buffer).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({
    resolveWithObject: true
  });
  return { r: data[0], g: data[1], b: data[2] };
}

function near(actual, expected, tolerance = 8) {
  return Math.abs(actual.r - expected.r) <= tolerance
    && Math.abs(actual.g - expected.g) <= tolerance
    && Math.abs(actual.b - expected.b) <= tolerance;
}

test("builds exact cinematic display copy with and without optional names", () => {
  assert.deepEqual(albumShareCoverCopy({ scriptName: " 琼崖Ⅱ海角 ", roleName: " 叶辰 " }), {
    label: "本场掉落",
    main: "这一晚，我是「叶辰」",
    subtitle: "《琼崖Ⅱ海角》 · 游玩相册"
  });
  assert.deepEqual(albumShareCoverCopy({ scriptName: "", roleName: "" }), {
    label: "本场掉落",
    main: "这一晚，故事没有散场",
    subtitle: "游玩相册"
  });
  assert.equal(albumShareCoverCopy({ scriptName: "  ", roleName: "  " }).subtitle, "游玩相册");
});

test("escapes XML once and truncates names by Unicode code point without splitting emoji", () => {
  assert.equal(escapeAlbumShareCoverXml(`&<>"'`), "&amp;&lt;&gt;&quot;&apos;");

  const roleName = `${"叶".repeat(16)}😀尾巴`;
  const scriptName = `${"琼".repeat(20)}😀尾巴`;
  const copy = albumShareCoverCopy({ roleName, scriptName });
  assert.equal(copy.main, `这一晚，我是「${"叶".repeat(16)}😀…」`);
  assert.equal(copy.subtitle, `《${"琼".repeat(20)}😀…》 · 游玩相册`);
  assert.equal([...copy.main.match(/「(.+)」/u)[1]].length, 18);
  assert.equal([...copy.subtitle.match(/《(.+)》/u)[1]].length, 22);
  assert.doesNotMatch(copy.main, /[\uD800-\uDFFF](?![\uDC00-\uDFFF])/u);
});

test("replaces illegal XML 1.0 code points while retaining legal whitespace", () => {
  const invalid = "A\0\u0001\u000b\u000c\uD800\uFFFE\uFFFF\t\n\rB";
  const sanitized = "A�������\t\n\rB";
  assert.equal(albumShareCoverCopy({ roleName: invalid }).main, `这一晚，我是「${sanitized}」`);
  assert.equal(
    escapeAlbumShareCoverXml(`&<>"'${invalid}`),
    `&amp;&lt;&gt;&quot;&apos;${sanitized}`
  );
});

test("renders JPEGs at exact dimensions for both variants and every supported image count", async (t) => {
  const colors = ["#b44732", "#345d71", "#b28a45", "#536345", "#7b5365", "#cb7650", "#57688b", "#886b42", "#607459"];
  const buffers = await Promise.all(colors.map((color, index) => source(180 + index * 7, 130 + index * 5, color)));

  for (const [variant, expected] of [["friend", [1000, 800]], ["timeline", [1000, 1000]]]) {
    for (let count = 1; count <= 9; count += 1) {
      await t.test(`${variant}/${count}`, async () => {
        const images = buffers.slice(0, count).map((buffer, index) => image(index + 1, buffer, 180 + index * 7, 130 + index * 5));
        const output = await renderAlbumShareCover({ variant, images, scriptName: "琼崖Ⅱ海角", roleName: "叶辰" });
        const metadata = await sharp(output).metadata();
        assert.equal(metadata.format, "jpeg", `${variant}/${count} format`);
        assert.deepEqual([metadata.width, metadata.height], expected, `${variant}/${count} dimensions`);
      });
    }
  }
});

test("rejects empty, excessive, malformed, and unsupported renderer input clearly", async () => {
  const goodBuffer = await source(40, 30, "#000000");
  await assert.rejects(() => renderAlbumShareCover({ variant: "friend", images: [] }), /1.*9|count/i);
  await assert.rejects(() => renderAlbumShareCover({ variant: "poster", images: [image(1, goodBuffer, 40, 30)] }), /variant/i);
  await assert.rejects(
    () => renderAlbumShareCover({ variant: "friend", images: Array.from({ length: 10 }, (_, index) => image(index, goodBuffer, 40, 30)) }),
    /1.*9|count/i
  );
  await assert.rejects(() => renderAlbumShareCover({ variant: "friend", images: [{ id: 1, width: 40, height: 30, quality: 1 }] }), /buffer/i);
});

test("preserves both Sharp failures when attention and centre crops fail", async () => {
  const complete = await source(100, 100, "#123456");
  const truncated = complete.subarray(0, complete.length - 10);
  await sharp(truncated, { failOn: "error" }).metadata();

  await assert.rejects(
    () => renderAlbumShareCover({ variant: "friend", images: [image(1, truncated, 100, 100)] }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /attention.*centre.*failed/i);
      assert.equal(error.errors.length, 2);
      assert.equal(error.cause, error.errors[0]);
      return true;
    }
  );
});

test("keeps outer tiles flush while exposing warm-ivory internal gutters", async () => {
  const black = await source(80, 80, "#000000");
  const images = Array.from({ length: 4 }, (_, index) => image(index + 1, black, 80, 80));
  const output = await renderAlbumShareCover({ variant: "timeline", images });

  for (const [x, y] of [[0, 0], [999, 0]]) {
    assert.ok(near(await pixel(output, x, y), { r: 0, g: 0, b: 0 }, 12), `outer pixel ${x},${y}`);
  }
  for (const [x, y] of [[0, 999], [999, 999]]) {
    assert.ok(!near(await pixel(output, x, y), IVORY, 20), `bottom outer pixel ${x},${y} is covered by the tile and band`);
  }
  assert.ok(near(await pixel(output, 500, 100), IVORY), "vertical gutter");
  assert.ok(near(await pixel(output, 100, 500), IVORY), "horizontal gutter");
});

test("uses each variant's exact split gutter width at shared slot edges", async () => {
  const black = await source(80, 80, "#000000");
  for (const [variant, boundary, firstGutterX, lastGutterX] of [
    ["friend", 620, 616, 623],
    ["timeline", 580, 575, 584]
  ]) {
    const output = await renderAlbumShareCover({
      variant,
      images: [image(1, black, 80, 80), image(2, black, 80, 80)]
    });
    assert.ok(near(await pixel(output, firstGutterX - 1, 100), { r: 0, g: 0, b: 0 }, 12));
    assert.ok(near(await pixel(output, firstGutterX, 100), IVORY));
    assert.ok(near(await pixel(output, boundary, 100), IVORY));
    assert.ok(near(await pixel(output, lastGutterX, 100), IVORY));
    assert.ok(near(await pixel(output, lastGutterX + 1, 100), { r: 0, g: 0, b: 0 }, 12));
  }
});

test("uses normalized focus coordinates for an observable exact-aspect crop", async () => {
  const raw = Buffer.alloc(300 * 100 * 3);
  for (let y = 0; y < 100; y += 1) {
    for (let x = 0; x < 300; x += 1) {
      const offset = (y * 300 + x) * 3;
      raw[offset] = x < 100 ? 230 : 20;
      raw[offset + 1] = x >= 100 && x < 200 ? 220 : 20;
      raw[offset + 2] = x >= 200 ? 230 : 20;
    }
  }
  const striped = await sharp(raw, { raw: { width: 300, height: 100, channels: 3 } }).png().toBuffer();
  const left = await renderAlbumShareCover({
    variant: "timeline",
    images: [image(1, striped, 300, 100, { focusX: 0, focusY: 0.5 })]
  });
  const right = await renderAlbumShareCover({
    variant: "timeline",
    images: [image(1, striped, 300, 100, { focusX: 1, focusY: 0.5 })]
  });
  assert.ok((await pixel(left, 500, 100)).r > 180, "left focus selects the red region");
  assert.ok((await pixel(right, 500, 100)).b > 180, "right focus selects the blue region");
});

test("auto-orients EXIF sources before cropping and strips final metadata", async () => {
  const raw = Buffer.alloc(40 * 20 * 3);
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 40; x += 1) {
      const offset = (y * 40 + x) * 3;
      if (y < 10) raw[offset] = 240;
      else raw[offset + 2] = 240;
    }
  }
  const oriented = await sharp(raw, { raw: { width: 40, height: 20, channels: 3 } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const output = await renderAlbumShareCover({
    variant: "friend",
    images: [image(1, oriented, 40, 20, { focusX: 0.5, focusY: 0.5 })]
  });

  const left = await pixel(output, 100, 100);
  const right = await pixel(output, 900, 100);
  assert.ok(left.b > left.r + 100, "rotated lower half appears on the left");
  assert.ok(right.r > right.b + 100, "rotated upper half appears on the right");

  const metadata = await sharp(output).metadata();
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.equal(metadata.orientation, undefined);
});

test("renders long special-character names without double escaping or SVG parse errors", async () => {
  const buffer = await source(100, 100, "#6d5442");
  const rawMetacharacters = await renderAlbumShareCover({
    variant: "timeline",
    images: [image(1, buffer, 100, 100)],
    roleName: `<&"'>\0\u0001\u000b\u000c\uD800\uFFFE\uFFFF😀${"角".repeat(30)}`,
    scriptName: `<&"'>\0\u0001\u000b\u000c\uD800\uFFFE\uFFFF😀${"海".repeat(30)}`
  });
  const preescapedLookingInput = await renderAlbumShareCover({
    variant: "timeline",
    images: [image(1, buffer, 100, 100)],
    roleName: "&amp;",
    scriptName: "&amp;"
  });
  assert.equal((await sharp(rawMetacharacters).metadata()).format, "jpeg");
  assert.equal((await sharp(preescapedLookingInput).metadata()).format, "jpeg");
  assert.notDeepEqual(rawMetacharacters, preescapedLookingInput);
});

test("keeps longest two-line caption copy fully inside the friend caption band", async () => {
  const white = await source(80, 80, "#ffffff");
  const output = await renderAlbumShareCover({
    variant: "friend",
    images: Array.from({ length: 7 }, (_, index) => image(index + 1, white, 80, 80)),
    roleName: "叶".repeat(19),
    scriptName: "海".repeat(23)
  });
  const { data, info } = await sharp(output)
    .extract({ left: 56, top: 610, width: 260, height: 25 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += info.channels) {
    assert.ok(data[offset] > 235 && data[offset + 1] > 235 && data[offset + 2] > 235,
      "text must not paint above the y=640 caption-band edge");
  }
});

test("keeps text glyph pixels out of the bottom 56px safe margin in every overlay mode", async (t) => {
  const black = await source(80, 80, "#000000");
  for (const [variant, count, height, mode] of [
    ["friend", 1, 800, "gradient"],
    ["friend", 7, 800, "caption-band"],
    ["timeline", 1, 1000, "gradient"],
    ["timeline", 7, 1000, "caption-band"]
  ]) {
    await t.test(`${variant}/${mode}`, async () => {
      const output = await renderAlbumShareCover({
        variant,
        images: Array.from({ length: count }, (_, index) => image(index + 1, black, 80, 80)),
        scriptName: "gypqj"
      });
      const { data, info } = await sharp(output)
        .extract({ left: 56, top: height - 56, width: 244, height: 56 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const textPixels = [];
      for (let offset = 0; offset < data.length; offset += info.channels) {
        if (data[offset] > 90 && data[offset + 1] > 80 && data[offset + 2] > 70) {
          const pixelIndex = offset / info.channels;
          textPixels.push({ x: 56 + pixelIndex % info.width, y: height - 56 + Math.floor(pixelIndex / info.width) });
          if (textPixels.length === 3) break;
        }
      }
      assert.deepEqual(textPixels, [], `text entered the bottom safe margin at ${JSON.stringify(textPixels)}`);

      const visibleText = await sharp(output)
        .extract({ left: 56, top: height - 230, width: 244, height: 168 })
        .raw()
        .toBuffer();
      let visibleGlyphPixels = 0;
      for (let offset = 0; offset < visibleText.length; offset += 3) {
        if (visibleText[offset] > 90 && visibleText[offset + 1] > 80 && visibleText[offset + 2] > 70) {
          visibleGlyphPixels += 1;
        }
      }
      assert.ok(visibleGlyphPixels > 20, `expected visible text glyphs, found ${visibleGlyphPixels}`);
    });
  }
});

test("bounds source processing to two Sharp jobs without materializing oriented full-resolution buffers", async () => {
  const rendererSource = await readFile(new URL("../src/modules/album-share-cover/renderer.js", import.meta.url), "utf8");
  assert.match(rendererSource, /SOURCE_JOB_CONCURRENCY\s*=\s*2/);
  assert.doesNotMatch(rendererSource, /Promise\.all\((?:images|placements)\.map|async function orientImage/);

  const largeBuffer = await sharp({
    create: { width: 2048, height: 2048, channels: 3, background: "#685040" }
  }).png().toBuffer();
  const images = Array.from({ length: 9 }, (_, index) => image(index + 1, largeBuffer, 2048, 2048));
  let maximumActiveJobs = 0;
  const poll = setInterval(() => {
    maximumActiveJobs = Math.max(maximumActiveJobs, sharp.counters().process);
  }, 1);
  let output;
  try {
    output = await renderAlbumShareCover({ variant: "timeline", images });
  } finally {
    clearInterval(poll);
  }
  assert.ok(maximumActiveJobs <= 2, `expected at most 2 active Sharp jobs, observed ${maximumActiveJobs}`);
  assert.deepEqual([(await sharp(output).metadata()).width, (await sharp(output).metadata()).height], [1000, 1000]);
});

test("is byte-deterministic for the same input", async () => {
  const buffer = await source(120, 80, "#8b5b46");
  const options = {
    variant: "friend",
    images: [image(1, buffer, 120, 80)],
    scriptName: "琼崖Ⅱ海角",
    roleName: "叶辰"
  };
  assert.deepEqual(await renderAlbumShareCover(options), await renderAlbumShareCover(options));
});

test("every 1-6 count uses a gradient and every 7-9 count uses a visibly different caption band", async () => {
  const white = await source(80, 80, "#ffffff");
  const samples = [];
  for (let count = 1; count <= 9; count += 1) {
    const output = await renderAlbumShareCover({
      variant: "friend",
      images: Array.from({ length: count }, (_, index) => image(index + 1, white, 80, 80))
    });
    samples.push(await pixel(output, 950, 670));
  }
  for (let count = 1; count <= 6; count += 1) {
    assert.ok(samples[count - 1].r > 55, `count ${count} retains the lighter gradient at the sample`);
  }
  for (let count = 7; count <= 9; count += 1) {
    assert.ok(samples[count - 1].r < 45, `count ${count} uses the near-black caption band at the sample`);
  }
});
