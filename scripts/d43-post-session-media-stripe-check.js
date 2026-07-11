import assert from "node:assert/strict";

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

console.log("D43 post-session media stripe checks passed");
