import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    return "";
  }
  return fs.readFileSync(fullPath, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function methodBody(source, name) {
  const pattern = new RegExp(`${name}\\s*\\([^)]*\\)\\s*\\{`);
  const match = source.match(pattern);
  if (!match || match.index === undefined) {
    return "";
  }
  const start = match.index + match[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
    }
    if (depth === 0) {
      return source.slice(start, index);
    }
  }
  return "";
}

const manage = read("apps/miniprogram/src/pages/session/manage.vue");

const visibleSignupsBody = methodBody(manage, "visibleSignups");
assert(
  visibleSignupsBody.includes("this.signups") &&
    visibleSignupsBody.includes('signup.status !== "rejected"'),
  "manage page must hide rejected signups from the visible signup list"
);

const signupSummaryBody = methodBody(manage, "signupSummary");
assert(
  signupSummaryBody.includes("this.visibleSignups"),
  "signup summary must count only visible signups"
);
assert(
  !signupSummaryBody.includes("rejected") && !signupSummaryBody.includes("已拒绝"),
  "signup summary must not show rejected signup counts"
);

const signupCardsBody = methodBody(manage, "signupCards");
assert(
  signupCardsBody.includes("this.visibleSignups"),
  "signup cards must render only visible signups"
);

console.log("D27 signup rejection list checks passed");
