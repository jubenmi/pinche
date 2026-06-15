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

async function main() {
  const admin = await login("dev-admin-openid");
  const normal = await login(`dev-d12-normal-${suffix}`);

  const ticket = await request(
    "POST",
    "/api/admin/web-login/tickets",
    { userAgent: "d12-smoke" },
    undefined,
    201
  );

  assert(ticket.data.ticketId, "ticket should include ticketId");
  assert(ticket.data.ticketSecret, "ticket should include ticketSecret");
  assert(
    ticket.data.qrText.includes("pinche-admin-login://ticket/"),
    "ticket should include QR text"
  );

  await request(
    "POST",
    `/api/admin/web-login/tickets/${ticket.data.ticketId}/approve`,
    { secret: ticket.data.ticketSecret },
    normal.token,
    403
  );

  await request(
    "POST",
    `/api/admin/web-login/tickets/${ticket.data.ticketId}/approve`,
    { secret: ticket.data.ticketSecret },
    admin.token
  );

  const approved = await request(
    "GET",
    `/api/admin/web-login/tickets/${ticket.data.ticketId}?secret=${encodeURIComponent(
      ticket.data.ticketSecret
    )}`
  );
  assert(approved.data.status === "approved", "poll should return approved");
  assert(approved.data.token, "approved poll should return token");
  assert(approved.data.roles.includes("system_admin"), "approved token should be admin");

  const consumed = await request(
    "GET",
    `/api/admin/web-login/tickets/${ticket.data.ticketId}?secret=${encodeURIComponent(
      ticket.data.ticketSecret
    )}`
  );
  assert(consumed.data.status === "consumed", "second poll should be consumed");

  const marker = `D12-${suffix}`;
  const store = await request(
    "POST",
    "/api/admin/stores",
    {
      name: `${marker}硬删店`,
      city: "北京",
      district: "朝阳",
      address: "D12硬删测试地址",
      status: "active"
    },
    admin.token,
    201
  );
  const otherStore = await request(
    "POST",
    "/api/admin/stores",
    {
      name: `${marker}关联店B`,
      city: "北京",
      district: "东城",
      address: "D12关联测试地址B",
      status: "active"
    },
    admin.token,
    201
  );

  const script = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `${marker}硬删本`,
      typeTags: ["情感", "测试"],
      playerCount: 2,
      summaryNoSpoiler: "D12硬删测试剧本",
      defaultSeatTemplate: [
        {
          name: "角色A",
          seatType: "normal",
          roleName: "男主",
          roleGender: "male",
          basePrice: 10000,
          adjustment: 0
        },
        {
          name: "角色B",
          seatType: "normal",
          roleName: "女主",
          roleGender: "female",
          basePrice: 10000,
          adjustment: 0
        }
      ],
      status: "active"
    },
    admin.token,
    201
  );
  const otherScript = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `${marker}关联本B`,
      typeTags: ["推理", "测试"],
      playerCount: 2,
      summaryNoSpoiler: "D12关联测试剧本B",
      defaultSeatTemplate: [
        {
          name: "角色C",
          seatType: "normal",
          roleName: "推理位",
          roleGender: "male",
          basePrice: 10000,
          adjustment: 0
        },
        {
          name: "角色D",
          seatType: "normal",
          roleName: "推理位",
          roleGender: "female",
          basePrice: 10000,
          adjustment: 0
        }
      ],
      status: "active"
    },
    admin.token,
    201
  );
  const unlinkedScript = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `${marker}未关联本`,
      typeTags: ["测试"],
      playerCount: 1,
      summaryNoSpoiler: "D12未关联测试剧本",
      defaultSeatTemplate: [
        {
          name: "角色E",
          seatType: "normal",
          roleName: "观察位",
          roleGender: "unlimited",
          basePrice: 10000,
          adjustment: 0
        }
      ],
      status: "active"
    },
    admin.token,
    201
  );

  await request(
    "PUT",
    `/api/admin/stores/${store.data.id}/scripts`,
    { scriptIds: [script.data.id] },
    admin.token
  );
  await request(
    "PUT",
    `/api/admin/stores/${otherStore.data.id}/scripts`,
    { scriptIds: [otherScript.data.id] },
    admin.token
  );

  const linkedScripts = await request(
    "GET",
    `/api/admin/stores/${store.data.id}/scripts`,
    undefined,
    admin.token
  );
  assert(
    linkedScripts.data.some((item) => item.id === script.data.id),
    "admin linked scripts should include store script"
  );

  const scopedScripts = await request("GET", `/api/scripts?storeId=${store.data.id}`);
  assert(
    scopedScripts.data.some((item) => item.id === script.data.id),
    "store-scoped script list should include linked script"
  );
  assert(
    !scopedScripts.data.some((item) => item.id === otherScript.data.id),
    "store-scoped script list should not include another store script"
  );
  assert(
    !scopedScripts.data.some((item) => item.id === unlinkedScript.data.id),
    "store-scoped script list should not include unlinked script"
  );

  await request(
    "PUT",
    `/api/admin/stores/${store.data.id}/scripts`,
    { scriptIds: [otherScript.data.id] },
    admin.token
  );
  const replacedScripts = await request("GET", `/api/scripts?storeId=${store.data.id}`);
  assert(
    replacedScripts.data.some((item) => item.id === otherScript.data.id),
    "store-scoped script list should include replacement link"
  );
  assert(
    !replacedScripts.data.some((item) => item.id === script.data.id),
    "store-scoped script list should remove old replacement link"
  );

  await request("DELETE", `/api/admin/stores/${store.data.id}`, undefined, normal.token, 403);
  await request(
    "DELETE",
    `/api/admin/scripts/${otherScript.data.id}`,
    undefined,
    normal.token,
    403
  );
  await request("DELETE", `/api/admin/scripts/${otherScript.data.id}`, undefined, admin.token);

  const afterScriptDeleteLinks = await request(
    "GET",
    `/api/admin/stores/${store.data.id}/scripts`,
    undefined,
    admin.token
  );
  assert(
    !afterScriptDeleteLinks.data.some((item) => item.id === otherScript.data.id),
    "hard-deleted script should be removed from store links"
  );

  await request("DELETE", `/api/admin/stores/${store.data.id}`, undefined, admin.token);
  await request("DELETE", `/api/admin/scripts/${script.data.id}`, undefined, admin.token);
  await request("DELETE", `/api/admin/scripts/${unlinkedScript.data.id}`, undefined, admin.token);
  await request("DELETE", `/api/admin/stores/${otherStore.data.id}`, undefined, admin.token);

  const deletedStores = await request(
    "GET",
    `/api/admin/stores?keyword=${encodeURIComponent(store.data.name)}`,
    undefined,
    admin.token
  );
  const deletedScripts = await request(
    "GET",
    `/api/admin/scripts?keyword=${encodeURIComponent(otherScript.data.name)}`,
    undefined,
    admin.token
  );
  assert(
    !deletedStores.data.some((item) => item.id === store.data.id),
    "hard-deleted store should disappear"
  );
  assert(
    !deletedScripts.data.some((item) => item.id === otherScript.data.id),
    "hard-deleted script should disappear"
  );

  const referencedStore = await request(
    "POST",
    "/api/admin/stores",
    {
      name: `${marker}引用店`,
      city: "北京",
      district: "海淀",
      address: "D12引用测试地址",
      status: "active"
    },
    admin.token,
    201
  );
  const referencedScript = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `${marker}引用本`,
      typeTags: ["情感"],
      playerCount: 1,
      summaryNoSpoiler: "D12引用测试剧本",
      defaultSeatTemplate: [
        {
          name: "角色",
          seatType: "normal",
          roleName: "角色",
          roleGender: "unlimited",
          basePrice: 10000,
          adjustment: 0
        }
      ],
      status: "active"
    },
    admin.token,
    201
  );

  await request(
    "POST",
    "/api/sessions",
    {
      storeId: referencedStore.data.id,
      scriptId: referencedScript.data.id,
      startAt: "2030-01-01 12:00:00",
      depositAmount: 0,
      note: "D12 hard delete reference"
    },
    admin.token,
    201
  );

  const blockedStoreDelete = await request(
    "DELETE",
    `/api/admin/stores/${referencedStore.data.id}`,
    undefined,
    admin.token,
    409
  );
  const blockedScriptDelete = await request(
    "DELETE",
    `/api/admin/scripts/${referencedScript.data.id}`,
    undefined,
    admin.token,
    409
  );
  assert(
    blockedStoreDelete.error.code === "RESOURCE_IN_USE",
    "referenced store delete should be blocked"
  );
  assert(
    blockedScriptDelete.error.code === "RESOURCE_IN_USE",
    "referenced script delete should be blocked"
  );

  console.log("d12 admin web smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
