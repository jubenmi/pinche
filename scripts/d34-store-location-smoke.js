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
    throw new Error(`${method} ${path} expected ${expectedStatus}, got ${response.status}: ${text}`);
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

function coordinateMatches(value, expected) {
  return Math.abs(Number(value) - expected) < 0.000001;
}

function emptyCoordinate(value) {
  return value === null || value === undefined || value === "";
}

function startAt(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

async function createAdminStore(admin, body = {}) {
  const payload = await request(
    "POST",
    "/api/admin/stores",
    {
      name: `D34位置测试店-${suffix}`,
      city: "北京",
      district: "朝阳",
      address: "D34位置测试地址",
      status: "active",
      ...body
    },
    admin.token,
    201
  );
  return payload.data;
}

async function createAdminScript(admin) {
  const payload = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `D34位置测试本-${suffix}`,
      typeTags: ["情感", "沉浸"],
      playerCount: 4,
      summaryNoSpoiler: "D34 store location smoke",
      defaultSeatTemplate: [
        {
          name: "A",
          seatType: "normal",
          roleName: "A",
          basePrice: 58000,
          adjustment: 0
        }
      ],
      status: "active"
    },
    admin.token,
    201
  );
  return payload.data;
}

async function createSession(auth, store, script, label) {
  const payload = await request(
    "POST",
    "/api/sessions",
    {
      storeId: store.id,
      scriptId: script.id,
      startAt: startAt(24),
      joinPolicy: "review_required",
      depositAmount: 5000,
      note: label
    },
    auth.token,
    201
  );
  return payload.data;
}

async function main() {
  const admin = await authorizePhone(await login("dev-admin-openid"), "d34-admin-phone");
  const player = await authorizePhone(await login(`dev-d34-player-${suffix}`), "d34-player-phone");
  assert(admin.roles.includes("system_admin"), "admin should have system_admin role");

  const privateStore = await request(
    "POST",
    "/api/stores",
    {
      name: `D34私有位置店-${suffix}`,
      city: "北京",
      district: "东城",
      address: "D34私有位置地址",
      latitude: "39.9042000",
      longitude: "116.4074000",
      contactNote: "D34 private coordinate smoke"
    },
    player.token,
    201
  );
  assert(
    coordinateMatches(privateStore.data.latitude, 39.9042) &&
      coordinateMatches(privateStore.data.longitude, 116.4074),
    "private store should save legal GCJ-02 coordinates"
  );

  await request(
    "POST",
    "/api/stores",
    {
      name: `D34非法纬度店-${suffix}`,
      city: "北京",
      latitude: "91",
      longitude: "116.4074000"
    },
    player.token,
    400
  );
  await request(
    "POST",
    "/api/stores",
    {
      name: `D34非法经度店-${suffix}`,
      city: "北京",
      latitude: "39.9042000",
      longitude: "181"
    },
    player.token,
    400
  );

  const store = await createAdminStore(admin, {
    latitude: "39.9981000",
    longitude: "116.4803000"
  });
  assert(
    coordinateMatches(store.latitude, 39.9981) && coordinateMatches(store.longitude, 116.4803),
    "admin store creation should save coordinates"
  );

  const updated = await request(
    "PATCH",
    `/api/admin/stores/${store.id}`,
    {
      latitude: "39.9100000",
      longitude: "116.4100000"
    },
    admin.token
  );
  assert(
    coordinateMatches(updated.data.latitude, 39.91) &&
      coordinateMatches(updated.data.longitude, 116.41),
    "admin store update should save coordinates"
  );

  const script = await createAdminScript(admin);
  const session = await createSession(admin, updated.data, script, "D34 location smoke session");
  const detail = await request("GET", `/api/sessions/${session.id}`, undefined, admin.token);
  assert(detail.data.store_address === updated.data.address, "session detail should return store address");
  assert(
    coordinateMatches(detail.data.store_latitude, 39.91) &&
      coordinateMatches(detail.data.store_longitude, 116.41),
    "session detail should return store coordinates"
  );

  const legacyStore = await createAdminStore(admin, {
    name: `D34无坐标旧店-${suffix}`,
    address: "D34无坐标旧地址",
    latitude: "",
    longitude: ""
  });
  assert(
    emptyCoordinate(legacyStore.latitude) && emptyCoordinate(legacyStore.longitude),
    "blank coordinates should remain empty"
  );
  const publicStores = await request(
    "GET",
    `/api/stores?keyword=${encodeURIComponent(legacyStore.name)}&limit=10`
  );
  assert(
    publicStores.data.some((item) => Number(item.id) === Number(legacyStore.id)),
    "store without coordinates should remain searchable"
  );
  const legacySession = await createSession(admin, legacyStore, script, "D34 legacy location smoke session");
  assert(legacySession.id, "store without coordinates should still be usable for session creation");

  console.log("D34 store location smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
