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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function startAt(hoursFromNow = 36) {
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
      name: `D6测试店-${suffix}`,
      city: "北京",
      district: "朝阳",
      address: "D6测试地址"
    },
    admin.token,
    201
  );

  const script = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `D6测试本-${suffix}`,
      typeTags: ["情感", "恋陪"],
      playerCount: 5,
      summaryNoSpoiler: "D6 smoke script",
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
      dmNameSnapshot: `D6指定DM-${suffix}`,
      npcNameSnapshot: `D6指定NPC-${suffix}`,
      depositAmount: 5000,
      note: "D6 smoke session"
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

  const owner = await login(`dev-d6-owner-${suffix}`);
  const intruder = await login(`dev-d6-intruder-${suffix}`);
  const playerA = await login(`dev-d6-player-a-${suffix}`);
  const playerB = await login(`dev-d6-player-b-${suffix}`);
  const playerC = await login(`dev-d6-player-c-${suffix}`);

  const { session, seats } = await createPublishedSession(admin, owner);
  const targetSeat = seats.find((seat) => seat.name === "F4-1");
  const otherSeat = seats.find((seat) => seat.name === "F4-2");

  const mySessions = await request(
    "GET",
    "/api/users/me/sessions",
    undefined,
    owner.token
  );
  assert(
    mySessions.data.some((item) => item.id === session.id),
    "owner should see own session"
  );

  const intruderSessions = await request(
    "GET",
    "/api/users/me/sessions",
    undefined,
    intruder.token
  );
  assert(
    !intruderSessions.data.some((item) => item.id === session.id),
    "intruder should not see owner session in own list"
  );

  const signupA = await request(
    "POST",
    "/api/signups",
    {
      seatId: targetSeat.id,
      contactText: `d6-player-a-${suffix}`,
      note: "想申请F4-1"
    },
    playerA.token,
    201
  );
  const signupB = await request(
    "POST",
    "/api/signups",
    {
      seatId: targetSeat.id,
      contactText: `d6-player-b-${suffix}`,
      note: "同座竞争"
    },
    playerB.token,
    201
  );
  const signupC = await request(
    "POST",
    "/api/signups",
    {
      seatId: otherSeat.id,
      contactText: `d6-player-c-${suffix}`,
      note: "用于拒绝测试"
    },
    playerC.token,
    201
  );

  await request(
    "GET",
    `/api/sessions/${session.id}/signups`,
    undefined,
    intruder.token,
    403
  );

  const signups = await request(
    "GET",
    `/api/sessions/${session.id}/signups`,
    undefined,
    owner.token
  );
  assert(signups.data.length >= 3, "owner should see session signups");
  assert(
    signups.data.some((item) => item.contact_text === `d6-player-a-${suffix}`),
    "owner should see applicant contact"
  );

  const approved = await request(
    "PATCH",
    `/api/signups/${signupA.data.id}/approve`,
    {},
    owner.token
  );
  assert(approved.data.status === "approved", "approved signup should be approved");

  const afterApproveSignups = await request(
    "GET",
    `/api/sessions/${session.id}/signups`,
    undefined,
    owner.token
  );
  const rejectedCompetitor = afterApproveSignups.data.find(
    (item) => item.id === signupB.data.id
  );
  assert(rejectedCompetitor.status === "rejected", "same-seat competitor should be rejected");

  const afterApproveDetail = await request("GET", `/api/sessions/${session.id}`);
  const confirmedSeat = afterApproveDetail.data.seats.find((seat) => seat.id === targetSeat.id);
  assert(confirmedSeat.status === "confirmed", "seat should become confirmed");
  assert(
    Number(confirmedSeat.confirmed_user_id) === Number(playerA.user.id),
    "seat confirmed user should match approved player"
  );

  await request(
    "PATCH",
    `/api/signups/${signupB.data.id}/approve`,
    {},
    owner.token,
    400
  );

  const rejected = await request(
    "PATCH",
    `/api/signups/${signupC.data.id}/reject`,
    {},
    owner.token
  );
  assert(rejected.data.status === "rejected", "rejected signup should be rejected");

  const afterRejectDetail = await request("GET", `/api/sessions/${session.id}`);
  const reopenedSeat = afterRejectDetail.data.seats.find((seat) => seat.id === otherSeat.id);
  assert(
    reopenedSeat.status === "open",
    "seat should reopen after rejecting its only active signup"
  );

  await request(
    "PATCH",
    `/api/signups/${signupA.data.id}/deposit`,
    { depositStatus: "pending_confirm" },
    intruder.token,
    403
  );

  const pendingDeposit = await request(
    "PATCH",
    `/api/signups/${signupA.data.id}/deposit`,
    { depositStatus: "pending_confirm" },
    owner.token
  );
  assert(
    pendingDeposit.data.deposit_status === "pending_confirm",
    "deposit should be pending confirm"
  );

  const confirmedDeposit = await request(
    "PATCH",
    `/api/signups/${signupA.data.id}/deposit`,
    { depositStatus: "confirmed" },
    owner.token
  );
  assert(
    confirmedDeposit.data.deposit_status === "confirmed",
    "deposit should be confirmed"
  );

  await request(
    "POST",
    `/api/session-seats/${otherSeat.id}/lock`,
    {},
    owner.token,
    400
  );

  const locked = await request(
    "POST",
    `/api/session-seats/${targetSeat.id}/lock`,
    {},
    owner.token
  );
  assert(locked.data.status === "locked", "confirmed seat should lock");

  const finalDetail = await request("GET", `/api/sessions/${session.id}`);
  const lockedSeat = finalDetail.data.seats.find((seat) => seat.id === targetSeat.id);
  assert(lockedSeat.status === "locked", "final seat status should be locked");

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        sessionId: session.id,
        approvedSignupId: signupA.data.id,
        lockedSeatId: targetSeat.id
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
