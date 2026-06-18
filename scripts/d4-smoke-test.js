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

function startAt(hoursFromNow = 28) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

const balancedTemplate = [
  { name: "情感沉浸位", seatType: "love_companion", roleName: "主线互动位", basePrice: 58000, adjustment: 20000 },
  { name: "F4-1", seatType: "f4", roleName: "玩家CP位", basePrice: 58000, adjustment: -5000 },
  { name: "F4-2", seatType: "f4", roleName: "玩家CP位", basePrice: 58000, adjustment: -5000 },
  { name: "F4-3", seatType: "f4", roleName: "玩家CP位", basePrice: 58000, adjustment: -5000 },
  { name: "F4-4", seatType: "f4", roleName: "玩家CP位", basePrice: 58000, adjustment: -5000 }
];

async function createSeat(sessionId, seat, token, expectedStatus = 201) {
  return request(
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
    expectedStatus
  );
}

async function createSession(storeId, scriptId, ownerToken, overrides = {}) {
  const payload = await request(
    "POST",
    "/api/sessions",
    {
      storeId,
      scriptId,
      startAt: startAt(),
      dmNameSnapshot: `D4指定DM-${suffix}`,
      npcNameSnapshot: `D4指定NPC-${suffix}`,
      depositAmount: 5000,
      note: "D4 smoke session",
      ...overrides
    },
    ownerToken,
    201
  );
  return payload.data;
}

async function main() {
  const admin = await login("dev-admin-openid");
  assert(admin.roles.includes("system_admin"), "admin should have system_admin role");
  const owner = await login(`dev-d4-owner-${suffix}`);
  await authorizePhone(owner, "d4-owner-phone");

  const store = await request(
    "POST",
    "/api/admin/stores",
    {
      name: `D4测试店-${suffix}`,
      city: "北京",
      district: "朝阳",
      address: "D4测试地址"
    },
    admin.token,
    201
  );

  const script = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `D4测试本-${suffix}`,
      typeTags: ["情感", "沉浸"],
      playerCount: 5,
      summaryNoSpoiler: "D4 smoke script",
      defaultSeatTemplate: balancedTemplate
    },
    admin.token,
    201
  );

  const negativeSession = await createSession(store.data.id, script.data.id, owner.token, {
    startAt: startAt(24)
  });
  await createSeat(
    negativeSession.id,
    {
      name: "负实付位",
      seatType: "f4",
      roleName: "异常测试",
      basePrice: 1000,
      adjustment: -2000
    },
    owner.token,
    400
  );

  const unbalancedSession = await createSession(store.data.id, script.data.id, owner.token, {
    startAt: startAt(25)
  });
  await createSeat(
    unbalancedSession.id,
    {
      name: "未配平A",
      seatType: "love_companion",
      roleName: "异常测试",
      basePrice: 58000,
      adjustment: 10000
    },
    owner.token
  );
  await createSeat(
    unbalancedSession.id,
    {
      name: "未配平B",
      seatType: "f4",
      roleName: "异常测试",
      basePrice: 58000,
      adjustment: -5000
    },
    owner.token
  );
  await request(
    "POST",
    `/api/sessions/${unbalancedSession.id}/publish`,
    {},
    owner.token,
    400
  );

  const balancedSession = await createSession(store.data.id, script.data.id, owner.token, {
    startAt: startAt(30)
  });
  for (const seat of balancedTemplate) {
    await createSeat(balancedSession.id, seat, owner.token);
  }

  const published = await request(
    "POST",
    `/api/sessions/${balancedSession.id}/publish`,
    {},
    owner.token
  );
  assert(published.data.status === "recruiting", "published session should recruit");

  const detail = await request("GET", `/api/sessions/${balancedSession.id}`);
  assert(detail.data.seats.length === 5, "published session should have 5 seats");
  const adjustmentSum = detail.data.seats.reduce(
    (sum, seat) => sum + Number(seat.adjustment),
    0
  );
  assert(adjustmentSum === 0, "published session adjustments should balance");
  assert(
    detail.data.seats.every((seat) => Number(seat.payable_price) >= 0),
    "all published seats should have non-negative payable price"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        sessionId: balancedSession.id,
        seatCount: detail.data.seats.length
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
