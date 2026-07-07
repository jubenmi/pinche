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

async function createSeat(sessionId, seat, token) {
  const payload = await request(
    "POST",
    `/api/sessions/${sessionId}/seats`,
    {
      name: seat.name,
      seatType: "normal",
      roleName: seat.roleName,
      basePrice: 58000,
      adjustment: 0
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
      name: `D30当前身份测试店-${suffix}`,
      city: "北京",
      district: "朝阳",
      address: "D30测试地址"
    },
    admin.token,
    201
  );

  const script = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `D30当前身份测试本-${suffix}`,
      typeTags: ["情感"],
      playerCount: 2,
      summaryNoSpoiler: "D30 current signup role smoke"
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
      joinPolicy: "direct",
      joinPhoneRequired: true,
      dmNameSnapshot: `D30指定DM-${suffix}`,
      npcNameSnapshot: `D30指定NPC-${suffix}`,
      depositAmount: 3000
    },
    owner.token,
    201
  );

  const seatC = await createSeat(
    session.data.id,
    { name: "C", roleName: "C" },
    owner.token
  );
  const seatE = await createSeat(
    session.data.id,
    { name: "E", roleName: "E" },
    owner.token
  );

  await request("POST", `/api/sessions/${session.data.id}/publish`, {}, owner.token);
  return { session: session.data, seatC, seatE };
}

async function main() {
  const admin = await login("dev-admin-openid");
  assert(admin.roles.includes("system_admin"), "admin should have system_admin role");

  const owner = await login(`dev-d30-owner-${suffix}`);
  await authorizePhone(owner, "d30-owner-phone");

  const { session, seatC, seatE } = await createPublishedSession(admin, owner);
  await request("POST", `/api/session-seats/${seatC.id}/claim`, {}, owner.token);
  await request("POST", `/api/session-seats/${seatE.id}/claim`, {}, owner.token);

  const mySignups = await request("GET", "/api/users/me/signups", undefined, owner.token);
  const sessionSignups = mySignups.data.filter(
    (item) => Number(item.session_id) === Number(session.id)
  );

  assert(
    sessionSignups.every((item) => !["cancelled", "rejected"].includes(item.status)),
    `my signups must hide inactive seat history after switching seats: ${JSON.stringify(
      sessionSignups
    )}`
  );
  assert(sessionSignups.length === 1, "my signups must expose only one current seat per session");
  assert(sessionSignups[0].seat_role_name === "E", "my signups must expose the current role E");

  console.log(
    JSON.stringify({
      ok: true,
      sessionId: session.id,
      currentRole: sessionSignups[0].seat_role_name
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
