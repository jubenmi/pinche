const baseUrl = process.env.BASE_URL || "http://localhost:3018";
const suffix = Date.now();

const seatTemplate = [
  {
    name: "恋陪位",
    seatType: "love_companion",
    roleName: "爱D对位",
    basePrice: 58000,
    adjustment: 20000
  },
  {
    name: "F4-1",
    seatType: "f4",
    roleName: "玩家CP",
    basePrice: 58000,
    adjustment: -5000
  },
  {
    name: "F4-2",
    seatType: "f4",
    roleName: "玩家CP",
    basePrice: 58000,
    adjustment: -5000
  },
  {
    name: "F4-3",
    seatType: "f4",
    roleName: "玩家CP",
    basePrice: 58000,
    adjustment: -5000
  },
  {
    name: "F4-4",
    seatType: "f4",
    roleName: "玩家CP",
    basePrice: 58000,
    adjustment: -5000
  }
];

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

function searchParam(value) {
  return encodeURIComponent(value);
}

async function createStores(adminToken, marker) {
  const created = [];
  for (let index = 1; index <= 10; index += 1) {
    const payload = await request(
      "POST",
      "/api/admin/stores",
      {
        name: `${marker}店家${index}`,
        city: "北京",
        district: index % 2 === 0 ? "朝阳" : "海淀",
        address: `D3测试地址${index}`,
        status: "active"
      },
      adminToken,
      201
    );
    created.push(payload.data);
  }
  return created;
}

async function createScripts(adminToken, marker) {
  const created = [];
  for (let index = 1; index <= 20; index += 1) {
    const payload = await request(
      "POST",
      "/api/admin/scripts",
      {
        name: `${marker}剧本${index}`,
        typeTags: ["情感", index % 2 === 0 ? "恋陪" : "都市"],
        playerCount: index % 5 === 0 ? 5 : 6,
        summaryNoSpoiler: `D3自动化无剧透简介${index}`,
        defaultSeatTemplate: seatTemplate,
        status: "active"
      },
      adminToken,
      201
    );
    created.push(payload.data);
  }
  return created;
}

async function main() {
  const marker = `D3-${suffix}-`;
  const admin = await login("dev-admin-openid");
  const organizer = await login(`dev-d3-organizer-${suffix}`);

  assert(admin.roles.includes("system_admin"), "admin should have system_admin role");
  assert(
    !organizer.roles.includes("system_admin"),
    "organizer should not have system_admin role"
  );

  await request("GET", "/api/admin/stores", undefined, organizer.token, 403);
  await request("GET", "/api/admin/scripts", undefined, organizer.token, 403);
  await request("GET", "/api/admin/catalog-requests", undefined, organizer.token, 403);

  const stores = await createStores(admin.token, marker);
  const scripts = await createScripts(admin.token, marker);

  const adminStores = await request(
    "GET",
    `/api/admin/stores?keyword=${searchParam(marker)}&limit=100`,
    undefined,
    admin.token
  );
  const adminScripts = await request(
    "GET",
    `/api/admin/scripts?keyword=${searchParam(marker)}&limit=100`,
    undefined,
    admin.token
  );
  assert(adminStores.data.length >= 10, "admin should list 10 created stores");
  assert(adminScripts.data.length >= 20, "admin should list 20 created scripts");

  const inactiveStore = stores[0];
  const inactiveScript = scripts[0];
  await request(
    "PATCH",
    `/api/admin/stores/${inactiveStore.id}`,
    { status: "inactive" },
    admin.token
  );
  await request(
    "PATCH",
    `/api/admin/scripts/${inactiveScript.id}`,
    { status: "inactive" },
    admin.token
  );

  const publicInactiveStores = await request(
    "GET",
    `/api/stores?keyword=${searchParam(inactiveStore.name)}`
  );
  const publicInactiveScripts = await request(
    "GET",
    `/api/scripts?keyword=${searchParam(inactiveScript.name)}`
  );
  assert(
    !publicInactiveStores.data.some((item) => item.id === inactiveStore.id),
    "inactive store should be hidden from public search"
  );
  assert(
    !publicInactiveScripts.data.some((item) => item.id === inactiveScript.id),
    "inactive script should be hidden from public search"
  );

  const publicActiveStores = await request(
    "GET",
    `/api/stores?keyword=${searchParam(stores[1].name)}`
  );
  const publicActiveScripts = await request(
    "GET",
    `/api/scripts?keyword=${searchParam(scripts[1].name)}`
  );
  assert(
    publicActiveStores.data.some((item) => item.id === stores[1].id),
    "active store should be searchable"
  );
  assert(
    publicActiveScripts.data.some((item) => item.id === scripts[1].id),
    "active script should be searchable"
  );

  const requestedStoreName = `${marker}玩家申请店`;
  const requestedScriptName = `${marker}玩家申请本`;
  const storeRequest = await request(
    "POST",
    "/api/catalog-requests",
    {
      requestType: "store",
      name: requestedStoreName,
      city: "北京",
      district: "朝阳",
      description: "D3 smoke store request"
    },
    organizer.token,
    201
  );
  const scriptRequest = await request(
    "POST",
    "/api/catalog-requests",
    {
      requestType: "script",
      name: requestedScriptName,
      description: "D3 smoke script request"
    },
    organizer.token,
    201
  );

  const pendingRequests = await request(
    "GET",
    `/api/admin/catalog-requests?status=pending&keyword=${searchParam(marker)}`,
    undefined,
    admin.token
  );
  assert(
    pendingRequests.data.some((item) => item.id === storeRequest.data.id),
    "pending store request should be visible to admin"
  );
  assert(
    pendingRequests.data.some((item) => item.id === scriptRequest.data.id),
    "pending script request should be visible to admin"
  );

  await request(
    "PATCH",
    `/api/admin/catalog-requests/${storeRequest.data.id}`,
    { status: "approved", reviewNote: "通过" },
    admin.token
  );
  await request(
    "PATCH",
    `/api/admin/catalog-requests/${scriptRequest.data.id}`,
    {
      status: "approved",
      reviewNote: "通过",
      typeTags: ["情感", "恋陪"],
      playerCount: 6,
      defaultSeatTemplate: seatTemplate
    },
    admin.token
  );

  const approvedStoreSearch = await request(
    "GET",
    `/api/stores?keyword=${searchParam(requestedStoreName)}`
  );
  const approvedScriptSearch = await request(
    "GET",
    `/api/scripts?keyword=${searchParam(requestedScriptName)}`
  );
  assert(
    approvedStoreSearch.data.some((item) => item.name === requestedStoreName),
    "approved store request should create public store"
  );
  assert(
    approvedScriptSearch.data.some((item) => item.name === requestedScriptName),
    "approved script request should create public script"
  );

  const rejectedRequestName = `${marker}待拒绝资料`;
  const rejectedRequest = await request(
    "POST",
    "/api/catalog-requests",
    {
      requestType: "store",
      name: rejectedRequestName,
      city: "北京",
      description: "D3 smoke reject request"
    },
    organizer.token,
    201
  );
  await request(
    "PATCH",
    `/api/admin/catalog-requests/${rejectedRequest.data.id}`,
    { status: "rejected", reviewNote: "资料不完整" },
    admin.token
  );
  const rejectedRequests = await request(
    "GET",
    `/api/admin/catalog-requests?status=rejected&keyword=${searchParam(
      rejectedRequestName
    )}`,
    undefined,
    admin.token
  );
  assert(
    rejectedRequests.data.some(
      (item) => item.id === rejectedRequest.data.id && item.review_note === "资料不完整"
    ),
    "rejected request should keep review note"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        createdStores: stores.length,
        createdScripts: scripts.length,
        approvedStore: requestedStoreName,
        approvedScript: requestedScriptName
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
