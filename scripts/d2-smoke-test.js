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

function startAt() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

async function main() {
  const admin = await login("dev-admin-openid");
  assert(admin.roles.includes("system_admin"), "admin should have system_admin role");

  const owner = await login(`dev-owner-${suffix}`);
  const player = await login(`dev-player-${suffix}`);
  assert(!owner.roles.includes("system_admin"), "owner should not be admin");

  const me = await request("GET", "/api/users/me", undefined, admin.token);
  assert(me.data.user.openid === "dev-admin-openid", "me should return admin user");

  await request(
    "POST",
    "/api/admin/stores",
    { name: "越权店", city: "北京" },
    owner.token,
    403
  );

  const store = await request(
    "POST",
    "/api/admin/stores",
    {
      name: `D2测试店-${suffix}`,
      city: "北京",
      district: "朝阳",
      address: "测试地址"
    },
    admin.token,
    201
  );

  const script = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `D2测试本-${suffix}`,
      typeTags: ["情感", "沉浸"],
      playerCount: 6,
      summaryNoSpoiler: "无剧透简介"
    },
    admin.token,
    201
  );

  const stores = await request("GET", "/api/stores");
  assert(stores.data.some((item) => item.id === store.data.id), "store should be public");

  const scripts = await request("GET", "/api/scripts");
  assert(
    scripts.data.some((item) => item.id === script.data.id),
    "script should be public"
  );

  const catalogRequest = await request(
    "POST",
    "/api/catalog-requests",
    {
      requestType: "store",
      name: `玩家申请店-${suffix}`,
      city: "北京",
      description: "玩家提交的新增资料"
    },
    owner.token,
    201
  );

  await request(
    "PATCH",
    `/api/admin/catalog-requests/${catalogRequest.data.id}`,
    { status: "approved", reviewNote: "通过" },
    admin.token
  );

  await request(
    "POST",
    "/api/performer-profiles",
    {
      displayName: `D2演绎-${suffix}`,
      city: "北京",
      bio: "测试演绎档案"
    },
    owner.token
  );

  const missingOwnerPhone = await request(
    "POST",
    "/api/sessions",
    {
      storeId: store.data.id,
      scriptId: script.data.id,
      startAt: startAt(),
      depositAmount: 5000,
      note: "D2 missing phone session"
    },
    owner.token,
    403
  );
  assert(
    missingOwnerPhone.error?.code === "PHONE_REQUIRED",
    "session creation should require owner phone"
  );

  const ownerPhone = await request(
    "POST",
    "/api/auth/wechat/phone",
    { code: `phone-owner-${suffix}` },
    owner.token
  );
  assert(ownerPhone.data.user.phoneVerifiedAt, "owner phone should be verified");

  const session = await request(
    "POST",
    "/api/sessions",
    {
      storeId: store.data.id,
      scriptId: script.data.id,
      startAt: startAt(),
      depositAmount: 5000,
      note: "D2 smoke session"
    },
    owner.token,
    201
  );

  const seatA = await request(
    "POST",
    `/api/sessions/${session.data.id}/seats`,
    {
      name: "情感沉浸位",
      seatType: "love_companion",
      basePrice: 50000,
      adjustment: 10000
    },
    owner.token,
    201
  );

  const seatB = await request(
    "POST",
    `/api/sessions/${session.data.id}/seats`,
    {
      name: "F4位",
      seatType: "f4",
      basePrice: 50000,
      adjustment: -10000
    },
    owner.token,
    201
  );

  await request("POST", `/api/sessions/${session.data.id}/publish`, {}, owner.token);

  const missingPlayerPhone = await request(
    "POST",
    `/api/session-seats/${seatA.data.id}/claim`,
    {},
    player.token,
    403
  );
  assert(
    missingPlayerPhone.error?.code === "PHONE_REQUIRED",
    "seat claim should require player phone"
  );

  const playerPhone = await request(
    "POST",
    "/api/auth/wechat/phone",
    { code: `phone-player-${suffix}` },
    player.token
  );
  assert(playerPhone.data.user.phoneVerifiedAt, "player phone should be verified");

  const forbiddenDirectClaim = await request(
    "POST",
    `/api/session-seats/${seatA.data.id}/claim`,
    {},
    player.token,
    403
  );
  assert(
    forbiddenDirectClaim.error?.code === "FORBIDDEN",
    "player direct seat claim should require organizer review"
  );

  const firstSignup = await request(
    "POST",
    "/api/signups",
    {
      seatId: seatA.data.id,
      contactText: "wx-first-test",
      note: "先申请一个角色"
    },
    player.token,
    201
  );
  await request("PATCH", `/api/signups/${firstSignup.data.id}/approve`, {}, owner.token);

  const signup = await request(
    "POST",
    "/api/signups",
    {
      seatId: seatB.data.id,
      contactText: "wx-test",
      note: "想上车"
    },
    player.token,
    201
  );

  const signups = await request(
    "GET",
    `/api/sessions/${session.data.id}/signups`,
    undefined,
    owner.token
  );
  assert(signups.data.length >= 1, "owner should see signups");

  await request("PATCH", `/api/signups/${signup.data.id}/approve`, {}, owner.token);
  await request(
    "PATCH",
    `/api/signups/${signup.data.id}/deposit`,
    { depositStatus: "confirmed" },
    owner.token
  );
  await request("POST", `/api/session-seats/${seatB.data.id}/lock`, {}, owner.token);

  await request(
    "POST",
    "/api/share-events/view",
    {
      sessionId: session.data.id,
      shareCode: `share-${suffix}`,
      source: "copy_text",
      path: `/pages/session/detail?id=${session.data.id}`
    },
    undefined,
    201
  );

  await request(
    "POST",
    "/api/share-events/convert",
    {
      sessionId: session.data.id,
      seatId: seatB.data.id,
      convertedSignupId: signup.data.id,
      source: "copy_text"
    },
    player.token,
    201
  );

  await request(
    "POST",
    "/api/subscriptions/request-result",
    {
      templateId: "template-test",
      scene: "signup_result",
      accepted: false,
      rawResult: { templateTest: "reject" }
    },
    player.token,
    201
  );

  await request(
    "POST",
    "/api/entity-claims",
    {
      entityType: "store",
      entityId: store.data.id,
      note: "认领测试"
    },
    owner.token,
    201
  );

  const detail = await request("GET", `/api/sessions/${session.data.id}`);
  assert(detail.data.seats.some((seat) => seat.id === seatA.data.id), "detail has seats");

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        sessionId: session.data.id,
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
