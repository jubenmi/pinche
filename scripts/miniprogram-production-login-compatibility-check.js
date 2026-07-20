import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const apiSource = read("apps/miniprogram/src/utils/api.js");
const safeFeedbackPath = "apps/miniprogram/src/utils/safeFeedback.js";

assert(
  apiSource.includes('import * as tdesignFeedback from "./tdesignFeedback.js";'),
  "Shared API must import TDesign feedback as an optional namespace"
);
assert(
  apiSource.includes('import { createSafeFeedback } from "./safeFeedback.js";'),
  "Shared API must use the safe feedback gateway"
);
assert(
  !apiSource.includes(
    'import { showActionSheet, showModal, showToast } from "./tdesignFeedback.js";'
  ),
  "Shared API must not access feedback exports through a direct destructured import"
);
assert(fs.existsSync(path.join(root, safeFeedbackPath)), "Safe feedback gateway is missing");

const safeFeedbackSource = read(safeFeedbackPath);
for (const method of ["showModal", "showToast", "showActionSheet"]) {
  assert(safeFeedbackSource.includes(method), `Safe feedback gateway must expose ${method}`);
}
assert(
  safeFeedbackSource.includes("getPreferredFeedback") &&
    safeFeedbackSource.includes("getPlatformFeedback"),
  "Safe feedback gateway must resolve preferred and platform providers lazily"
);

const builtApiPath = "apps/miniprogram/dist/build/mp-weixin/utils/api.js";
const builtSafeFeedbackPath = "apps/miniprogram/dist/build/mp-weixin/utils/safeFeedback.js";
if (fs.existsSync(path.join(root, builtApiPath))) {
  const builtApi = read(builtApiPath);
  assert(
    builtApi.includes('require("./safeFeedback.js")'),
    "Production API bundle must include the safe feedback gateway"
  );
  assert(
    !/typeof\s+[A-Za-z_$][\w$]*\.showModal/.test(builtApi),
    "Production API bundle must not dereference showModal before checking its provider"
  );
  assert(
    fs.existsSync(path.join(root, builtSafeFeedbackPath)),
    "Production bundle must emit the safe feedback gateway"
  );
}

console.log("Miniprogram production login compatibility check passed");
