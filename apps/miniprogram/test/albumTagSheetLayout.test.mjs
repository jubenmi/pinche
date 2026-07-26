import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const albumPath = fileURLToPath(new URL("../src/pages/session/album.vue", import.meta.url));
const albumSource = readFileSync(albumPath, "utf8");

function tagSheetMarkup() {
  const popupStart = albumSource.indexOf('<t-popup\n      :visible="tagSheetVisible"');
  const popupEnd = albumSource.indexOf("</t-popup>", popupStart);
  assert.notEqual(popupStart, -1, "album tag popup must exist");
  assert.notEqual(popupEnd, -1, "album tag popup must close");
  return albumSource.slice(popupStart, popupEnd);
}

function styleRule(className) {
  const styleStart = albumSource.lastIndexOf("<style scoped>");
  const styleSource = albumSource.slice(styleStart);
  const match = styleSource.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `.${className} style rule must exist`);
  return match[1];
}

test("album tag actions stay outside the native scrolling role content", () => {
  const markup = tagSheetMarkup();
  const scrollStart = markup.indexOf('<scroll-view scroll-y class="tag-sheet-scroll">');
  const scrollEnd = markup.indexOf("</scroll-view>", scrollStart);
  const actionsStart = markup.indexOf('<view class="sheet-actions">');

  assert.notEqual(scrollStart, -1, "tag sheet must use a native vertical scroll-view");
  assert.notEqual(scrollEnd, -1, "tag sheet native scroll-view must close");
  assert.notEqual(actionsStart, -1, "tag sheet actions must exist");
  assert.ok(
    scrollEnd < actionsStart,
    "cancel and save actions must be outside the scrolling role content",
  );
});

test("album tag sheet bounds scrolling and keeps the footer from shrinking", () => {
  const sheet = styleRule("tag-sheet");
  const scroll = styleRule("tag-sheet-scroll");
  const actions = styleRule("sheet-actions");

  assert.match(sheet, /display:\s*flex/);
  assert.match(sheet, /flex-direction:\s*column/);
  assert.match(sheet, /overflow:\s*hidden/);
  assert.doesNotMatch(sheet, /overflow-y:\s*auto/);
  assert.match(scroll, /flex:\s*1/);
  assert.match(scroll, /min-height:\s*0/);
  assert.match(actions, /flex:\s*0\s+0\s+auto/);
});
