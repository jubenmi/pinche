import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  calendarSource,
  detailSource,
  shareSource,
  adminAppSource,
  adminCatalogSource,
  adminPreviewSource,
  adminAlbumSource
] = await Promise.all([
  read("apps/miniprogram/src/components/SessionCalendar.vue"),
  read("apps/miniprogram/src/pages/session/detail.vue"),
  read("apps/miniprogram/src/pages/session/share.vue"),
  read("apps/admin-web/src/App.vue"),
  read("apps/admin-web/src/components/CatalogWorkspace.vue"),
  read("apps/admin-web/src/components/MiniProgramWorkspace.vue"),
  read("apps/admin-web/src/components/SessionAlbumWorkspace.vue")
]);

assert.match(calendarSource, /@pinche\/shared/, "calendar must use shared Beijing-time helpers");
assert.doesNotMatch(calendarSource, /function parseStartAt\(/, "calendar must not parse time locally");
assert.doesNotMatch(calendarSource, /date\.getHours\(\)/, "calendar time must not use device hours");
assert.match(detailSource, /formatBeijingDateTime/, "detail must format Beijing time");
assert.match(shareSource, /formatBeijingDateTime/, "share must format Beijing time");
for (const [name, source] of [
  ["admin app", adminAppSource],
  ["admin catalog", adminCatalogSource],
  ["admin preview", adminPreviewSource],
  ["admin album", adminAlbumSource]
]) {
  assert.match(source, /@pinche\/shared/, `${name} must use shared Beijing-time helpers`);
}
assert.doesNotMatch(
  adminPreviewSource,
  /function parseMineStartAt\(/,
  "admin preview must not duplicate local-time parsing"
);
assert.doesNotMatch(
  `${adminPreviewSource}\n${adminAlbumSource}`,
  /function formatShanghaiDate\(/,
  "admin workspaces must not duplicate Beijing formatting"
);

console.log("Beijing time source contract passed.");
