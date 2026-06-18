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

function startAt(hoursFromNow = 24) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

async function createSessionFixture(admin, owner) {
  const store = await request(
    "POST",
    "/api/admin/stores",
    {
      name: `D10测试店-${suffix}`,
      city: "北京",
      district: "朝阳"
    },
    admin.token,
    201
  );

  const script = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `D10测试本-${suffix}`,
      typeTags: ["情感", "协作"],
      playerCount: 2,
      summaryNoSpoiler: "D10 pseudo chat smoke",
      defaultSeatTemplate: [
        { name: "角色A", seatType: "normal", roleName: "角色A", basePrice: 0, adjustment: 0 },
        { name: "角色B", seatType: "normal", roleName: "角色B", basePrice: 0, adjustment: 0 }
      ]
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
      dmNameSnapshot: `D10指定DM-${suffix}`,
      npcNameSnapshot: `D10指定NPC-${suffix}`,
      depositAmount: 0,
      note: "D10 pseudo chat session"
    },
    owner.token,
    201
  );

  const seatA = await request(
    "POST",
    `/api/sessions/${session.data.id}/seats`,
    { name: "角色A", seatType: "normal", roleName: "角色A", basePrice: 0, adjustment: 0 },
    owner.token,
    201
  );
  const seatB = await request(
    "POST",
    `/api/sessions/${session.data.id}/seats`,
    { name: "角色B", seatType: "normal", roleName: "角色B", basePrice: 0, adjustment: 0 },
    owner.token,
    201
  );

  await request("POST", `/api/sessions/${session.data.id}/publish`, {}, owner.token);

  return { session: session.data, seats: [seatA.data, seatB.data] };
}

async function main() {
  const admin = await login("dev-admin-openid");
  const owner = await login(`dev-d10-owner-${suffix}`);
  const player = await login(`dev-d10-player-${suffix}`);
  const intruder = await login(`dev-d10-intruder-${suffix}`);
  await authorizePhone(owner, "d10-owner-phone");
  await authorizePhone(player, "d10-player-phone");
  const { session, seats } = await createSessionFixture(admin, owner);
  const targetSeat = seats[0];

  await request(
    "GET",
    `/api/sessions/${session.id}/chat`,
    undefined,
    intruder.token,
    403
  );

  const claimedSeat = await request(
    "POST",
    `/api/session-seats/${targetSeat.id}/claim`,
    {
      note: "分享页直接选择角色"
    },
    player.token
  );
  assert(
    claimedSeat.data.status === "confirmed",
    "share page direct claim should confirm seat"
  );

  const initialMessages = await request(
    "GET",
    `/api/sessions/${session.id}/chat`,
    undefined,
    player.token
  );
  assert(initialMessages.data.room.id, "onboard player should receive chat room");
  assert(initialMessages.data.pinnedMessage.content.includes("D10测试本"), "chat should include pinned message");
  assert(Array.isArray(initialMessages.data.messages), "onboard player should list messages");

  const message = await request(
    "POST",
    `/api/sessions/${session.id}/messages`,
    {
      content: "大家好，时间我都可以。"
    },
    player.token,
    201
  );
  assert(message.data.content.includes("时间"), "message content should persist");

  const ownerMessages = await request(
    "GET",
    `/api/sessions/${session.id}/chat`,
    undefined,
    owner.token
  );
  assert(
    ownerMessages.data.messages.some((item) => item.id === message.data.id),
    "organizer should see player message"
  );

  const pinned = await request(
    "PATCH",
    `/api/sessions/${session.id}/chat/pin`,
    {
      pinnedMessageText: "置顶：周六 19:30 店门口集合。"
    },
    owner.token
  );
  assert(pinned.data.pinnedMessage.content.includes("周六"), "pinned message should persist");

  await request(
    "PATCH",
    `/api/session-seats/${targetSeat.id}/kick`,
    {
      reason: "玩家临时退出"
    },
    owner.token
  );
  await request(
    "GET",
    `/api/sessions/${session.id}/chat`,
    undefined,
    player.token,
    403
  );

  const cancelled = await request(
    "PATCH",
    `/api/sessions/${session.id}/cancel`,
    {
      reason: "人数不足"
    },
    owner.token
  );
  assert(cancelled.data.status === "cancelled", "session should be cancelled");

  await request(
    "POST",
    `/api/sessions/${session.id}/messages`,
    {
      content: "取消后不能再留言"
    },
    owner.token,
    400
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        sessionId: session.id,
        messageId: message.data.id,
        kickedSeatId: targetSeat.id
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
