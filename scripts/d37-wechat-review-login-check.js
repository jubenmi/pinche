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

function count(source, token) {
  return source.split(token).length - 1;
}

function methodBody(source, name) {
  let start = source.indexOf(`function ${name}(`);
  if (start < 0) {
    start = source.indexOf(`async ${name}(`);
  }
  if (start < 0) {
    start = source.indexOf(`${name}(`);
  }
  assert(start >= 0, `Missing function: ${name}`);
  const parametersEnd = source.indexOf(")", start);
  const braceStart = source.indexOf("{", parametersEnd);
  assert(braceStart >= 0, `Missing function body: ${name}`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart + 1, index);
      }
    }
  }
  throw new Error(`Unclosed function body: ${name}`);
}

const indexSource = read("apps/miniprogram/src/pages/index/index.vue");
const loadGuestSessionsSource = methodBody(indexSource, "loadGuestSessions");
const handleCreateActionSource = methodBody(indexSource, "handleCreateAction");
const loginFromIdentityActionSource = methodBody(indexSource, "loginFromIdentityAction");

assert(
  !indexSource.includes("发起第一辆车") && !indexSource.includes("first-session"),
  "Home page must open on the shared calendar instead of the retired first-session screen"
);
assert(
  indexSource.includes('isAuthenticated.value ? "我的车局（点击创建）" : "我的车局（点击登录）"'),
  "Home page must expose the D40 guest and member primary-action labels"
);
assert(
  loadGuestSessionsSource.includes("/api/sessions/public/upcoming?limit=20"),
  "Guest home must load the anonymous public upcoming-session feed"
);
for (const forbiddenToken of ["ensureLoggedIn", "getCurrentUser", "getToken"]) {
  assert(
    !loadGuestSessionsSource.includes(forbiddenToken),
    `Guest calendar loading must not call ${forbiddenToken}`
  );
}
assert(
  handleCreateActionSource.includes("loginFromIdentityAction") &&
    handleCreateActionSource.includes("goCreate"),
  "Home primary action must request login for guests and create only for members"
);
assert(
  loginFromIdentityActionSource.includes("ensureLoggedIn") &&
    loginFromIdentityActionSource.includes("loadHomeCalendar"),
  "Explicit identity actions must login and then refresh the shared calendar"
);

for (const page of ["create", "script", "role"]) {
  const source = read(`apps/miniprogram/src/pages/session/${page}.vue`);
  const onLoadSource = methodBody(source, "onLoad");
  assert(
    !onLoadSource.includes("ensureLoggedIn"),
    `Creation ${page} step must not request login on page load`
  );
}

const setupSource = read("apps/miniprogram/src/pages/session/setup.vue");
const publishSource = methodBody(setupSource, "createPublishedSession");
assert(
  publishSource.includes("ensureLoggedIn") && publishSource.includes("requirePhone: true"),
  "Publishing a session must still require login and phone authorization"
);
assert(
  publishSource.includes("登录后发布并分享你的剧本局。"),
  "Publishing login prompt must be tied to the explicit publish action"
);

const builtOutputFiles = [
  "apps/miniprogram/dist/build/mp-weixin/pages/index/index.js",
  "apps/miniprogram/dist/build/mp-weixin/pages/index/index.wxml",
  "apps/miniprogram/dist/build/mp-weixin/pages/session/setup.js"
];
const builtOutputAvailable = builtOutputFiles.every((relativePath) =>
  fs.existsSync(path.join(root, relativePath))
);

if (builtOutputAvailable) {
  const [builtIndexJs, builtIndexWxml, builtSetupJs] = builtOutputFiles.map(read);

  assert(
    !builtIndexWxml.includes("发起第一辆车") && !builtIndexWxml.includes("first-session"),
    "Built home WXML must remove the retired first-session screen"
  );
  assert(
    builtIndexJs.includes("我的车局（点击登录）") &&
      builtIndexJs.includes("我的车局（点击创建）") &&
      builtIndexJs.includes("/api/sessions/public/upcoming?limit=20"),
    "Built home JS must contain both D40 states and the anonymous upcoming feed"
  );
  assert(
    count(builtIndexJs, "ensureLoggedIn") === 1 && builtIndexJs.includes("登录后可创建车局。"),
    "Built home JS may request login only from explicit identity actions"
  );
  assert(
    !builtIndexJs.includes("发起第一辆车") && builtIndexJs.includes("/pages/session/create"),
    "Built home JS must keep creation navigation without the retired entry screen"
  );
  assert(
    builtSetupJs.includes("ensureLoggedIn") &&
      builtSetupJs.includes("requirePhone:!0") &&
      builtSetupJs.includes("登录后发布并分享你的剧本局。"),
    "Built setup JS must keep login on the explicit publish action"
  );
}

console.log("D37 WeChat review login check passed");
