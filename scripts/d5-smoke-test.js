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

function startAt(hoursFromNow = 32) {
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
      name: `D5测试店-${suffix}`,
      city: "北京",
      district: "朝阳",
      address: "D5测试地址"
    },
    admin.token,
    201
  );

  const script = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `D5测试本-${suffix}`,
      typeTags: ["情感", "沉浸"],
      playerCount: 5,
      summaryNoSpoiler: "D5 smoke script",
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
      dmNameSnapshot: `D5指定DM-${suffix}`,
      npcNameSnapshot: `D5指定NPC-${suffix}`,
      depositAmount: 3000,
      note: "D5 smoke session"
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

async function main() {
  const admin = await login("dev-admin-openid");
  assert(admin.roles.includes("system_admin"), "admin should have system_admin role");

  const owner = await login(`dev-d5-owner-${suffix}`);
  const player = await login(`dev-d5-player-${suffix}`);
  await authorizePhone(owner, "d5-owner-phone");
  const { session, seats } = await createPublishedSession(admin, owner);
  const targetSeat = seats.find((seat) => seat.seat_type === "f4");

  await request(
    "POST",
    "/api/share-events/view",
    {
      sessionId: session.id,
      shareCode: `share-d5-${suffix}`,
      source: "smoke",
      path: `/pages/session/detail?id=${session.id}`,
      seatId: targetSeat.id
    },
    undefined,
    201
  );

  const signup = await request(
    "POST",
    "/api/signups",
    {
      seatId: targetSeat.id,
      contactText: `d5-player-${suffix}`,
      note: "想申请F4位"
    },
    player.token,
    201
  );
  assert(signup.data.status === "pending", "signup should be pending");

  await request(
    "POST",
    "/api/signups",
    {
      seatId: targetSeat.id,
      contactText: `d5-player-${suffix}`,
      note: "duplicate"
    },
    player.token,
    409
  );

  const detail = await request("GET", `/api/sessions/${session.id}`);
  const appliedSeat = detail.data.seats.find((seat) => seat.id === targetSeat.id);
  assert(appliedSeat.status === "applied", "seat should move to applied");

  const mySignups = await request("GET", "/api/users/me/signups", undefined, player.token);
  assert(
    mySignups.data.some((item) => item.id === signup.data.id),
    "player should see own signup"
  );

  const subscription = await request(
    "POST",
    "/api/subscriptions/request-result",
    {
      scene: "signup_result",
      accepted: false,
      rawResult: {
        signupId: signup.data.id,
        reason: "smoke"
      }
    },
    player.token,
    201
  );
  assert(subscription.data.scene === "signup_result", "subscription scene should match");

  const convert = await request(
    "POST",
    "/api/share-events/convert",
    {
      sessionId: session.id,
      shareCode: `share-d5-${suffix}`,
      source: "smoke",
      path: `/pages/session/apply?id=${session.id}&seatId=${targetSeat.id}`,
      seatId: targetSeat.id,
      convertedSignupId: signup.data.id
    },
    player.token,
    201
  );
  assert(convert.data.event_type === "convert", "share convert event should be recorded");

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        sessionId: session.id,
        seatId: targetSeat.id,
        signupId: signup.data.id
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
