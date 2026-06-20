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

function startAt(hoursFromNow = 40) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

const seatTemplate = [
  {
    name: "情感沉浸位",
    seatType: "love_companion",
    roleName: "主线互动位",
    basePrice: 58000,
    adjustment: 20000
  },
  {
    name: "F4-1",
    seatType: "f4",
    roleName: "玩家CP位",
    basePrice: 58000,
    adjustment: -5000
  },
  {
    name: "F4-2",
    seatType: "f4",
    roleName: "玩家CP位",
    basePrice: 58000,
    adjustment: -5000
  },
  {
    name: "F4-3",
    seatType: "f4",
    roleName: "玩家CP位",
    basePrice: 58000,
    adjustment: -5000
  },
  {
    name: "F4-4",
    seatType: "f4",
    roleName: "玩家CP位",
    basePrice: 58000,
    adjustment: -5000
  }
];

async function createSeat(sessionId, seat, token) {
  const payload = await request(
    "POST",
    `/api/sessions/${sessionId}/seats`,
    {
      name: seat.name,
      seatType: seat.seatType,
      roleName: seat.roleName,
      basePrice: seat.basePrice,
      adjustment: seat.adjustment
    },
    token,
    201
  );
  return payload.data;
}

async function createPublishedSession(admin, owner) {
  const store = await request(
    "POST",
    "/api/admin/stores",
    {
      name: `D7测试店-${suffix}`,
      city: "北京",
      district: "朝阳",
      address: "D7测试地址"
    },
    admin.token,
    201
  );

  const script = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `D7测试本-${suffix}`,
      typeTags: ["情感", "沉浸"],
      playerCount: 5,
      summaryNoSpoiler: "D7 smoke script",
      defaultSeatTemplate: seatTemplate
    },
    admin.token,
    201
  );

  const session = await request(
    "POST",
    "/api/sessions",
    {
      storeId: store.data.id,
      scriptId: script.data.id,
      startAt: startAt(),
      dmNameSnapshot: `D7指定DM-${suffix}`,
      npcNameSnapshot: `D7指定NPC-${suffix}`,
      depositAmount: 3000,
      note: "D7 smoke session"
    },
    owner.token,
    201
  );

  const seats = [];
  for (const seat of seatTemplate) {
    seats.push(await createSeat(session.data.id, seat, owner.token));
  }

  await request("POST", `/api/sessions/${session.data.id}/publish`, {}, owner.token);

  return {
    session: session.data,
    seats
  };
}

async function assertFrontendHooks() {
  const detailSource = await readFile(
    new URL("../apps/miniprogram/src/pages/session/detail.vue", import.meta.url),
    "utf8"
  );
  assert(detailSource.includes('open-type="share"'), "detail page should use open-type share");
  assert(detailSource.includes("data-seat-id"), "detail page should support seat share path");
  assert(detailSource.includes("copyRecruitmentText"), "detail page should copy recruitment text");
  assert(detailSource.includes("firstRiskWord"), "detail page should block risky copy text");
  assert(detailSource.includes("share-stats"), "detail page should load share stats");
}

async function main() {
  await assertFrontendHooks();

  const admin = await login("dev-admin-openid");
  assert(admin.roles.includes("system_admin"), "admin should have system_admin role");

  const owner = await login(`dev-d7-owner-${suffix}`);
  const player = await login(`dev-d7-player-${suffix}`);
  await authorizePhone(owner, "d7-owner-phone");
  const { session, seats } = await createPublishedSession(admin, owner);
  const targetSeat = seats.find((seat) => seat.name === "F4-1");

  const initialStats = await request("GET", `/api/sessions/${session.id}/share-stats`);
  assert(initialStats.data.view_count === 0, "initial view count should be zero");
  assert(initialStats.data.signup_count === 0, "initial signup count should be zero");

  await request(
    "POST",
    "/api/share-events/view",
    {
      sessionId: session.id,
      shareCode: `share-d7-${suffix}`,
      source: "wechat_share",
      path: `/pages/session/detail?id=${session.id}&seatId=${targetSeat.id}`,
      seatId: targetSeat.id
    },
    undefined,
    201
  );
  await request(
    "POST",
    "/api/share-events/view",
    {
      sessionId: session.id,
      shareCode: `share-d7-${suffix}-copy`,
      source: "copy_text",
      path: `/pages/session/detail?id=${session.id}`
    },
    undefined,
    201
  );

  const signup = await request(
    "POST",
    "/api/signups",
    {
      seatId: targetSeat.id,
      contactText: `d7-player-${suffix}`,
      note: "想申请D7统计测试位"
    },
    player.token,
    201
  );

  await request(
    "POST",
    "/api/share-events/convert",
    {
      sessionId: session.id,
      shareCode: `share-d7-${suffix}`,
      source: "wechat_share",
      path: `/pages/session/apply?id=${session.id}&seatId=${targetSeat.id}`,
      seatId: targetSeat.id,
      convertedSignupId: signup.data.id
    },
    player.token,
    201
  );

  const stats = await request("GET", `/api/sessions/${session.id}/share-stats`);
  assert(stats.data.view_count === 2, "view count should include two views");
  assert(stats.data.convert_count === 1, "convert count should include one convert");
  assert(stats.data.converted_signup_count === 1, "converted signup count should be one");
  assert(stats.data.signup_count === 1, "signup count should include one signup");

  const seatStats = stats.data.seats.find((seat) => seat.id === targetSeat.id);
  assert(seatStats.view_count === 1, "seat view count should include one seat view");
  assert(seatStats.convert_count === 1, "seat convert count should include one seat convert");
  assert(seatStats.signup_count === 1, "seat signup count should include one signup");

  await request("GET", "/api/sessions/999999999/share-stats", undefined, undefined, 404);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        sessionId: session.id,
        seatId: targetSeat.id,
        signupId: signup.data.id,
        viewCount: stats.data.view_count,
        signupCount: stats.data.signup_count
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
