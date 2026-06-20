import { readFile } from "node:fs/promises";

const baseUrl = process.env.BASE_URL || "http://localhost:3018";
const suffix = Date.now();

async function request(method, path, body, token, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (response.status !== expectedStatus) {
    throw new Error(
      `${method} ${path} expected ${expectedStatus}, got ${response.status}: ${text}`
    );
  }

  return payload;
}

async function login(code) {
  const payload = await request("POST", "/api/auth/wechat/login", { code });
  return payload.data;
}

async function authorizePhone(auth, label) {
  const payload = await request(
    "POST",
    "/api/auth/wechat/phone",
    { code: `${label}-${suffix}` },
    auth.token
  );
  auth.user = payload.data.user;
  auth.roles = payload.data.roles;
  return auth;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function startAt(hoursFromNow = 48) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

async function readSource(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function assertStaticChecks() {
  const appSource = await readSource("apps/miniprogram/src/App.vue");
  const detailSource = await readSource("apps/miniprogram/src/pages/session/detail.vue");
  const createSource = await readSource("apps/miniprogram/src/pages/session/create.vue");
  const adminSource = await readSource("apps/miniprogram/src/pages/admin/catalog.vue");
  const apiSource = await readSource("apps/api/src/modules/core/service.js");

  assert(
    appSource.includes("VITE_API_BASE_URL") &&
      appSource.includes('"http://127.0.0.1:3018"'),
    "miniprogram API base should support release env and default to 127.0.0.1"
  );
  assert(
    !detailSource.includes("session.note"),
    "public detail page should not render free-form session note"
  );
  assert(
    createSource.includes("findPublicTextRisk"),
    "create page should validate public text before publish"
  );
  assert(
    !createSource.includes("红包或现实陪伴承诺"),
    "create page placeholder should avoid high-risk words"
  );
  assert(
    adminSource.includes('typeTagsText: "情感,沉浸"'),
    "admin default script tags should use neutral public wording"
  );
  assert(!adminSource.includes("恋陪位"), "admin default template should avoid public slang");
  assert(!adminSource.includes("爱D对位"), "admin default template should avoid public slang");
  assert(
    apiSource.includes("publicScriptRow") && apiSource.includes("assertPublicTextSafe"),
    "API should sanitize public script output and reject risky public fields"
  );
}

function assertNoPublicSlang(value, label) {
  const text = JSON.stringify(value);
  for (const word of ["恋陪", "爱D", "红包", "返现", "现实陪伴", "线下陪伴"]) {
    assert(!text.includes(word), `${label} should not expose ${word}`);
  }
}

async function assertApiChecks() {
  const admin = await login("dev-admin-openid");
  assert(admin.roles.includes("system_admin"), "admin should have system_admin role");
  const owner = await login(`dev-d8-owner-${suffix}`);
  await authorizePhone(owner, "d8-owner-phone");

  const scripts = await request("GET", "/api/scripts?limit=100");
  assertNoPublicSlang(scripts.data, "public script list");

  const store = await request(
    "POST",
    "/api/admin/stores",
    {
      name: `D8测试店-${suffix}`,
      city: "北京",
      district: "朝阳",
      address: "D8测试地址"
    },
    admin.token,
    201
  );
  const script = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `D8测试本-${suffix}`,
      typeTags: ["情感", "沉浸"],
      playerCount: 1,
      summaryNoSpoiler: "D8 QA script",
      defaultSeatTemplate: [
        {
          name: "情感沉浸位",
          seatType: "love_companion",
          roleName: "主线互动位",
          basePrice: 50000,
          adjustment: 0
        }
      ]
    },
    admin.token,
    201
  );

  await request(
    "POST",
    "/api/sessions",
    {
      storeId: store.data.id,
      scriptId: script.data.id,
      startAt: startAt(),
      dmNameSnapshot: "加微信看详情"
    },
    owner.token,
    400
  );

  const session = await request(
    "POST",
    "/api/sessions",
    {
      storeId: store.data.id,
      scriptId: script.data.id,
      startAt: startAt(),
      dmNameSnapshot: `D8指定DM-${suffix}`,
      npcNameSnapshot: `D8指定NPC-${suffix}`,
      depositAmount: 0,
      note: `D8-private-note-13800138000-${suffix}`
    },
    owner.token,
    201
  );

  await request(
    "POST",
    `/api/sessions/${session.data.id}/seats`,
    {
      name: "恋陪位",
      seatType: "love_companion",
      roleName: "主线互动位",
      basePrice: 50000,
      adjustment: 0
    },
    owner.token,
    400
  );

  const seat = await request(
    "POST",
    `/api/sessions/${session.data.id}/seats`,
    {
      name: "情感沉浸位",
      seatType: "love_companion",
      roleName: "主线互动位",
      basePrice: 50000,
      adjustment: 0
    },
    owner.token,
    201
  );

  await request("POST", `/api/sessions/${session.data.id}/publish`, {}, owner.token);
  const publicSession = await request("GET", `/api/sessions/${session.data.id}`);
  assert(!Object.hasOwn(publicSession.data, "note"), "public session API should omit note");
  assert(publicSession.data.seats.some((item) => item.id === seat.data.id), "seat should be visible");
}

async function main() {
  await assertStaticChecks();
  await assertApiChecks();
  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        checkedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
