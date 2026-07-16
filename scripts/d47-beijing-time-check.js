import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [calendarSource, detailSource, shareSource] = await Promise.all([
  read("apps/miniprogram/src/components/SessionCalendar.vue"),
  read("apps/miniprogram/src/pages/session/detail.vue"),
  read("apps/miniprogram/src/pages/session/share.vue")
]);

assert.match(calendarSource, /@pinche\/shared/, "calendar must use shared Beijing-time helpers");
assert.doesNotMatch(calendarSource, /function parseStartAt\(/, "calendar must not parse time locally");
assert.doesNotMatch(calendarSource, /date\.getHours\(\)/, "calendar time must not use device hours");
assert.match(detailSource, /formatBeijingDateTime/, "detail must format Beijing time");
assert.match(shareSource, /formatBeijingDateTime/, "share must format Beijing time");

console.log("Beijing time source contract passed.");
