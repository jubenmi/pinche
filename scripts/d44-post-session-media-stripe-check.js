import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { albumMediaCountSql } from "../apps/api/src/modules/core/session-album-media-count.js";
import { sessionCalendarStripeTone } from "../apps/miniprogram/src/utils/sessionCalendarStripe.js";

const stripeCases = [
  {
    name: "future session stays amber without media",
    input: { failed: false, postStart: false, albumMediaCount: 0 },
    expected: "amber"
  },
  {
    name: "future session stays amber even if media already exists",
    input: { failed: false, postStart: false, albumMediaCount: 1 },
    expected: "amber"
  },
  {
    name: "ended session without media is red",
    input: { failed: false, postStart: true, albumMediaCount: 0 },
    expected: "red"
  },
  {
    name: "ended session with media is green",
    input: { failed: false, postStart: true, albumMediaCount: 1 },
    expected: "green"
  },
  {
    name: "missing media count is treated as zero",
    input: { failed: false, postStart: true },
    expected: "red"
  },
  {
    name: "cancelled or rejected state wins over media",
    input: { failed: true, postStart: true, albumMediaCount: 9 },
    expected: "red"
  }
];

for (const testCase of stripeCases) {
  assert.equal(
    sessionCalendarStripeTone(testCase.input),
    testCase.expected,
    testCase.name
  );
}

const expectedAlbumMediaCountSql =
  "COUNT(DISTINCT CASE WHEN album_media.status = 'active' " +
  "AND (album_media.media_type = 'image' OR " +
  "(album_media.media_type = 'video' AND album_media.processing_status <> 'failed')) " +
  "THEN album_media.id END)";

assert.equal(albumMediaCountSql("album_media"), expectedAlbumMediaCountSql);
assert.throws(
  () => albumMediaCountSql("album media"),
  /safe SQL identifier/,
  "SQL aliases must not allow injected syntax"
);

const serviceSource = readFileSync(
  new URL("../apps/api/src/modules/core/service.js", import.meta.url),
  "utf8"
);
assert(
  serviceSource.includes('${albumMediaCountSql("album_photo")} AS album_media_count'),
  "listMySessions must select album_media_count"
);
assert(
  serviceSource.includes('SELECT ${albumMediaCountSql("album_media")}'),
  "listMySignups must select album_media_count"
);
assert(
  serviceSource.match(/album_media_count: Number\(row\.album_media_count \|\| 0\)/g)?.length >= 2,
  "both list responses must normalize album_media_count to a number"
);

const calendarSource = readFileSync(
  new URL("../apps/miniprogram/src/components/SessionCalendar.vue", import.meta.url),
  "utf8"
);
assert(
  calendarSource.includes(
    'import { sessionCalendarStripeTone } from "../utils/sessionCalendarStripe";'
  ),
  "SessionCalendar must import the pure stripe helper"
);
for (const token of [
  "return sessionCalendarStripeTone({",
  "failed: calendarItemFailed(item)",
  "postStart: isCalendarItemPostStart(item)",
  "albumMediaCount: item.raw?.album_media_count"
]) {
  assert(calendarSource.includes(token), `SessionCalendar stripe wiring must include: ${token}`);
}
assert(
  !calendarSource.includes('if (isCalendarItemPostStart(item)) {\n    return "green";'),
  "post-start sessions must no longer become green unconditionally"
);

console.log("D44 post-session media stripe checks passed");
