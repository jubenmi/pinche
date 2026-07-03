import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function assertIncludes(source, needle, message) {
  if (!source.includes(needle)) {
    fail(message);
  }
}

function assertNotIncludes(source, needle, message) {
  if (source.includes(needle)) {
    fail(message);
  }
}

function methodBody(source, name) {
  const patterns = [
    new RegExp(`async\\s+${name}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`${name}\\s*\\([^)]*\\)\\s*\\{`)
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match || match.index === undefined) {
      continue;
    }
    const start = match.index + match[0].length;
    let depth = 1;
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === "{") {
        depth += 1;
      } else if (source[i] === "}") {
        depth -= 1;
      }
      if (depth === 0) {
        return source.slice(start, i);
      }
    }
  }
  return "";
}

const shareSource = read("apps/miniprogram/src/pages/session/share.vue");
const manageSource = read("apps/miniprogram/src/pages/session/manage.vue");
const serviceSource = read("apps/api/src/modules/core/service.js");
const envSource = read("apps/api/src/config/env.js");
const packageJson = read("package.json");
const d6SmokeSource = read("scripts/d6-smoke-test.js");

const subscribeHelperPath = "apps/miniprogram/src/utils/subscribeMessages.js";
if (!fs.existsSync(path.join(root, subscribeHelperPath))) {
  fail("D14 requires Mini Program subscription helper at apps/miniprogram/src/utils/subscribeMessages.js");
} else {
  const subscribeSource = read(subscribeHelperPath);
  for (const requiredText of [
    "organizer_signup_created",
    "player_signup_reviewed",
    "wx.requestSubscribeMessage",
    "/api/subscriptions/request-result"
  ]) {
    assertIncludes(subscribeSource, requiredText, `Subscription helper missing ${requiredText}`);
  }
}

const backendSubscribeSource = read("apps/api/src/modules/wechat/subscribe-message.js");
for (const requiredText of [
  "skipped",
  "config.subscribeMessage.enabled",
  "template_missing",
  "openid_missing",
  "wechat_config_missing"
]) {
  assertIncludes(
    backendSubscribeSource,
    requiredText,
    `Backend subscribe-message module must skip safely when unavailable: ${requiredText}`
  );
}

const claimSeatBody = methodBody(shareSource, "claimSeat");
assertNotIncludes(
  claimSeatBody,
  "/api/session-seats/",
  "share.vue claimSeat must not call direct seat claim"
);
assertIncludes(
  claimSeatBody,
  "/api/signups",
  "share.vue claimSeat must create a pending signup"
);
assertIncludes(
  claimSeatBody,
  "已提交申请，等待车头审核",
  "share.vue must show pending review success copy"
);
assertIncludes(
  shareSource,
  "requestSignupReviewedSubscription",
  "share.vue must request player review-result subscription after signup"
);

assertIncludes(
  manageSource,
  "requestSignupCreatedSubscription",
  "manage.vue must expose organizer new-signup subscription action"
);
assertIncludes(
  manageSource,
  "申请提醒",
  "manage.vue must show organizer signup reminder copy"
);

for (const requiredEnvText of [
  "subscribeMessage",
  "WECHAT_SUBSCRIBE_MESSAGE_ENABLED",
  "WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_CREATED",
  "WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_REVIEWED"
]) {
  assertIncludes(envSource, requiredEnvText, `Backend env config missing ${requiredEnvText}`);
}

assertIncludes(
  serviceSource,
  "../wechat/subscribe-message.js",
  "service.js must import backend subscribe-message notification module"
);
assertIncludes(
  serviceSource,
  "forbidPlayerDirectClaim",
  "service.js must explicitly block ordinary player direct claim"
);
assertIncludes(
  serviceSource,
  "notifySignupCreated",
  "service.js must trigger organizer signup-created notification"
);
assertIncludes(
  serviceSource,
  "notifySignupReviewed",
  "service.js must trigger applicant signup-reviewed notification"
);
assertIncludes(
  serviceSource,
  `seat.session_status === "locked"`,
  "createSignup must allow post-start locked sessions to receive pending signups"
);
assertIncludes(
  serviceSource,
  "session_started",
  "createSignup must check whether a locked session has started before accepting refill signups"
);
assertIncludes(
  d6SmokeSource,
  "post-start empty seat direct claim should require organizer review",
  "D6 smoke must cover post-start refill direct claim rejection"
);
assertIncludes(
  d6SmokeSource,
  "after start empty seat signup",
  "D6 smoke must cover post-start refill via pending signup"
);

assertIncludes(
  packageJson,
  "d14-session-signup-notifications-check.js",
  "package.json check script must include the D14 check"
);

if (!process.exitCode) {
  console.log("D14 signup notification checks passed");
}
