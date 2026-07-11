import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  const target = path.join(root, file);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const calendar = read("apps/miniprogram/src/components/SessionCalendar.vue");
const icons = [
  ["settings-light.svg", "#eaf8f1"],
  ["return-green.svg", "#24745f"],
  ["calendar-green.svg", "#24745f"]
];

for (const [name, color] of icons) {
  const source = read(`apps/miniprogram/src/static/icons/${name}`);
  assert(calendar.includes(`/static/icons/${name}`), `calendar should reference ${name}`);
  assert(source.includes("<svg"), `${name} should be a local SVG asset`);
  assert(source.includes(color), `${name} should use the specified icon color`);
}

for (const label of ["管理", "归位到今天", "选择日期"]) {
  assert(calendar.includes(`aria-label="${label}"`), `calendar should expose aria-label: ${label}`);
}

assert(
  !calendar.includes('/static/icons/toolbox-light.svg'),
  "calendar should no longer use the ambiguous toolbox icon"
);
assert(
  !calendar.includes('/static/icons/target-green.svg'),
  "calendar reset should use a curved return arrow instead of a targeting reticle"
);
assert(
  /<t-button class="today-reset-button"[\s\S]*?<\/t-button>\s*<t-button\s+class="date-picker-button"/.test(
    calendar
  ),
  "calendar reset and date controls should use the same button primitive"
);
assert(
  calendar.includes('class="calendar-tool-icon"'),
  "calendar tools should share a consistent icon class"
);

console.log("calendar action icon checks passed");
