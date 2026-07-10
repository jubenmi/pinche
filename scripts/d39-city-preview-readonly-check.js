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

function methodBody(source, methodName) {
  const asyncMarker = `async ${methodName}(`;
  const plainMarker = `${methodName}(`;
  const asyncStart = source.indexOf(asyncMarker);
  const start = asyncStart === -1 ? source.indexOf(plainMarker) : asyncStart;
  if (start === -1) {
    return "";
  }
  const bodyStart = source.indexOf("{", start);
  if (bodyStart === -1) {
    return "";
  }
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart + 1, index);
      }
    }
  }
  return "";
}

const calendar = read("apps/miniprogram/src/components/SessionCalendar.vue");
const detail = read("apps/miniprogram/src/pages/session/detail.vue");
const share = read("apps/miniprogram/src/pages/session/share.vue");

assert(
  calendar.includes("/pages/session/detail?id=${id}&entry=city"),
  "D39 city cards should mark the detail entry as city"
);

for (const token of [
  'entry: ""',
  "isCityPreview()",
  'return this.entry === "city"',
  'this.entry = options.entry || ""',
  "同城发现仅供浏览。请先联系店家；收到店家或车友分享卡片后可选择角色上车。",
  'this.isCityPreview ? "需联系店家" : "可选"',
  "uni.hideShareMenu",
  '"shareAppMessage"',
  '"shareTimeline"',
  '<view v-if="!isCityPreview" class="actions">',
  'v-if="!isCityPreview && myReviewState.can_review"',
  '<template v-if="!isCityPreview && (!isGuestPreview || currentUserId)">'
]) {
  assert(detail.includes(token), `D39 detail should include the read-only contract: ${token}`);
}

for (const methodName of [
  "handleDetailSeatTap",
  "handleDetailSeatAction",
  "relinkSessionMembership"
]) {
  const body = methodBody(detail, methodName);
  assert(body, `D39 detail should expose method: ${methodName}`);
  assert(
    body.includes("this.isCityPreview") && body.includes("return;"),
    `D39 ${methodName} should stop in city preview`
  );
}

const seatCards = methodBody(detail, "detailSeatCards");
assert(
  seatCards.includes("this.isCityPreview") && seatCards.includes("actions"),
  "D39 city-preview seat cards should not expose actions"
);
const npcCards = methodBody(detail, "detailNpcRoleCards");
assert(
  npcCards.includes("this.isCityPreview") && npcCards.includes("actions"),
  "D39 city-preview NPC cards should not expose actions"
);

for (const shareJoinToken of [
  "/api/session-seats/${seatId}/claim",
  'url: "/api/signups"',
  "await this.claimSeat(targetRole)"
]) {
  assert(
    share.includes(shareJoinToken),
    `D39 should preserve the share-card join flow: ${shareJoinToken}`
  );
}

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("node scripts/d39-city-preview-readonly-check.js"),
  "npm run check should include the D39 read-only check"
);

console.log("D39 city preview read-only checks passed");
