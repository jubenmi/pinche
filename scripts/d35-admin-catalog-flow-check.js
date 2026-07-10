const baseUrl = process.env.D35_API_BASE_URL || "http://127.0.0.1:3029";
const adminCode = process.env.D35_ADMIN_CODE || "dev-admin-openid";
const playerCode = process.env.D35_PLAYER_CODE || "dev-player-openid";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertLocalBaseUrl(value) {
  const parsed = new URL(value);
  const allowedHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  assert(
    allowedHosts.has(parsed.hostname),
    `D35 flow check only runs against a local API, got ${parsed.origin}`
  );
  return parsed.origin;
}

const apiOrigin = assertLocalBaseUrl(baseUrl);

async function request(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
  };
  const url = `${apiOrigin}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch (error) {
    error.message = `${options.method || "GET"} ${path} failed before response: ${error.message}`;
    throw error;
  }
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || payload.ok === false) {
    const error = new Error(
      `${options.method || "GET"} ${path} failed with ${response.status}: ${
        payload.error?.message || text
      }`
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload.data;
}

async function requestExpectingError(path, options = {}, expectedStatus) {
  try {
    await request(path, options);
  } catch (error) {
    assert(
      error.status === expectedStatus,
      `Expected ${path} to fail with ${expectedStatus}, got ${error.status || error.message}`
    );
    return error.payload;
  }
  throw new Error(`Expected ${path} to fail with ${expectedStatus}`);
}

async function login(code) {
  const data = await request("/api/auth/wechat/login", {
    method: "POST",
    body: { code }
  });
  assert(data.token, `login for ${code} should return a token`);
  return data;
}

function roleTemplate(prefix, count) {
  return Array.from({ length: count }, (_, index) => ({
    name: `${prefix}-role-${index + 1}`,
    roleGender: index % 2 === 0 ? "unlimited" : "female",
    description: `${prefix} role ${index + 1}`
  }));
}

function npcRoles(prefix) {
  return [
    {
      name: `${prefix}-npc-1`,
      roleGender: "unlimited",
      description: `${prefix} npc`
    }
  ];
}

function parseJson(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return JSON.parse(value || "[]");
}

async function findAdminScriptById(token, id) {
  const rows = await request(`/api/admin/scripts?keyword=D35-flow&limit=200`, { token });
  return rows.find((row) => Number(row.id) === Number(id));
}

async function findAdminStoreById(token, id) {
  const rows = await request(`/api/admin/stores?keyword=D35-flow&limit=200`, { token });
  return rows.find((row) => Number(row.id) === Number(id));
}

async function cleanup(token, created) {
  for (const scriptId of created.scripts.reverse()) {
    try {
      await request(`/api/admin/scripts/${scriptId}`, {
        method: "PATCH",
        token,
        body: { status: "inactive" }
      });
      await request(`/api/admin/scripts/${scriptId}`, { method: "DELETE", token });
    } catch (error) {
      console.warn(`D35 cleanup skipped script ${scriptId}: ${error.message}`);
    }
  }
  for (const storeId of created.stores.reverse()) {
    try {
      await request(`/api/admin/stores/${storeId}`, {
        method: "PATCH",
        token,
        body: { status: "inactive" }
      });
      await request(`/api/admin/stores/${storeId}`, { method: "DELETE", token });
    } catch (error) {
      console.warn(`D35 cleanup skipped store ${storeId}: ${error.message}`);
    }
  }
}

async function main() {
  const runId = `${Date.now()}`;
  const prefix = `D35-flow-${runId}`;
  const admin = await login(adminCode);
  const player = await login(playerCode);
  const created = { stores: [], scripts: [] };

  assert(
    Array.isArray(admin.roles) && admin.roles.includes("system_admin"),
    "admin login should include system_admin"
  );

  try {
    const publicScript = await request("/api/admin/scripts", {
      method: "POST",
      token: admin.token,
      body: {
        name: `${prefix}-public-script`,
        typeTags: ["D35", "flow"],
        playerCount: 4,
        summaryNoSpoiler: "D35 structured role flow",
        defaultSeatTemplate: roleTemplate(prefix, 4),
        npcRoles: npcRoles(prefix),
        status: "active"
      }
    });
    created.scripts.push(publicScript.id);
    const fetchedScript = await findAdminScriptById(admin.token, publicScript.id);
    assert(fetchedScript, "created script should be visible in admin script list");
    assert(parseJson(fetchedScript.default_seat_template_json).length === 4, "script roles should persist");
    assert(fetchedScript.npc_roles?.[0]?.name === `${prefix}-npc-1`, "script NPC roles should persist");

    const publicStore = await request("/api/admin/stores", {
      method: "POST",
      token: admin.token,
      body: {
        name: `${prefix}-public-store`,
        city: "Beijing",
        district: "Chaoyang",
        address: "D35 GCJ-02 manual coordinate address",
        contactNote: "D35 flow note",
        latitude: "39.908823",
        longitude: "116.39747",
        status: "active"
      }
    });
    created.stores.push(publicStore.id);
    const fetchedStore = await findAdminStoreById(admin.token, publicStore.id);
    assert(fetchedStore, "created store should be visible in admin store list");
    assert(Number(fetchedStore.latitude).toFixed(6) === "39.908823", "store latitude should persist");
    assert(Number(fetchedStore.longitude).toFixed(6) === "116.397470", "store longitude should persist");

    await request(`/api/admin/stores/${publicStore.id}/scripts`, {
      method: "PUT",
      token: admin.token,
      body: {
        scriptLinks: [{ scriptId: publicScript.id, pricePerPlayer: 18800 }]
      }
    });
    const linkedScripts = await request(`/api/admin/stores/${publicStore.id}/scripts`, {
      token: admin.token
    });
    const linkedScript = linkedScripts.find((row) => Number(row.id) === Number(publicScript.id));
    assert(linkedScript, "store should link the saved script");
    assert(Number(linkedScript.price_per_player) === 18800, "store script price should persist");

    const pendingStore = await request("/api/stores", {
      method: "POST",
      token: player.token,
      body: {
        name: `${prefix}-pending-store`,
        city: "Beijing",
        district: "Haidian",
        address: "D35 pending store address",
        latitude: "39.991",
        longitude: "116.302",
        contactNote: "D35 pending note"
      }
    });
    created.stores.push(pendingStore.id);
    const approvedStore = await request(
      `/api/admin/catalog-review-items/store/${pendingStore.id}/approve`,
      {
        method: "POST",
        token: admin.token,
        body: {
          name: `${prefix}-approved-store`,
          city: "Beijing",
          district: "Haidian",
          address: "D35 edited approval address",
          latitude: "39.992",
          longitude: "116.303",
          reviewNote: "approved in D35 flow"
        }
      }
    );
    assert(approvedStore.review_status === "approved", "pending store should approve");
    assert(approvedStore.visibility === "public", "approved store should become public");
    assert(Number(approvedStore.latitude).toFixed(3) === "39.992", "approved store edits should persist");

    const pendingScript = await request("/api/scripts", {
      method: "POST",
      token: player.token,
      body: {
        name: `${prefix}-pending-script`,
        typeTags: ["D35", "pending"],
        playerCount: 3,
        summaryNoSpoiler: "D35 pending script",
        defaultSeatTemplate: roleTemplate(`${prefix}-pending`, 3)
      }
    });
    created.scripts.push(pendingScript.id);
    const approvedScript = await request(
      `/api/admin/catalog-review-items/script/${pendingScript.id}/approve`,
      {
        method: "POST",
        token: admin.token,
        body: {
          name: `${prefix}-approved-script`,
          typeTags: ["D35", "approved"],
          playerCount: 3,
          summaryNoSpoiler: "D35 edited script approval",
          defaultSeatTemplate: roleTemplate(`${prefix}-approved`, 3),
          npcRoles: npcRoles(`${prefix}-approved`),
          storeScriptLinks: [{ storeId: publicStore.id, pricePerPlayer: 16600 }],
          reviewNote: "approved script in D35 flow"
        }
      }
    );
    assert(approvedScript.review_status === "approved", "pending script should approve");
    const approvedScriptFromList = await findAdminScriptById(admin.token, pendingScript.id);
    assert(approvedScriptFromList?.npc_roles?.[0]?.name === `${prefix}-approved-npc-1`, "approved script NPC edit should persist");
    const linksAfterScriptApproval = await request(`/api/admin/stores/${publicStore.id}/scripts`, {
      token: admin.token
    });
    assert(
      linksAfterScriptApproval.some(
        (row) => Number(row.id) === Number(pendingScript.id) && Number(row.price_per_player) === 16600
      ),
      "approved script should link to selected store with price"
    );

    const needsStore = await request("/api/stores", {
      method: "POST",
      token: player.token,
      body: {
        name: `${prefix}-needs-store`,
        city: "Beijing",
        address: "D35 needs address"
      }
    });
    created.stores.push(needsStore.id);
    const needsChanged = await request(
      `/api/admin/catalog-review-items/store/${needsStore.id}/needs-changes`,
      {
        method: "POST",
        token: admin.token,
        body: { reviewNote: "please add detail" }
      }
    );
    assert(needsChanged.review_status === "needs_changes", "needs-changes action should persist");

    const rejectedStore = await request("/api/stores", {
      method: "POST",
      token: player.token,
      body: {
        name: `${prefix}-reject-store`,
        city: "Beijing",
        address: "D35 reject address"
      }
    });
    created.stores.push(rejectedStore.id);
    const rejected = await request(`/api/admin/catalog-review-items/store/${rejectedStore.id}/reject`, {
      method: "POST",
      token: admin.token,
      body: { reviewNote: "reject in D35 flow" }
    });
    assert(rejected.review_status === "rejected", "reject action should persist");
    assert(rejected.status === "inactive", "rejected item should become inactive");

    const mergeStore = await request("/api/stores", {
      method: "POST",
      token: player.token,
      body: {
        name: `${prefix}-merge-store`,
        city: "Beijing",
        address: "D35 merge address"
      }
    });
    created.stores.push(mergeStore.id);
    const merged = await request(`/api/admin/catalog-review-items/store/${mergeStore.id}/merge`, {
      method: "POST",
      token: admin.token,
      body: {
        mergedIntoId: publicStore.id,
        reviewNote: "merge in D35 flow"
      }
    });
    assert(merged.review_status === "merged", "merge action should persist");
    assert(Number(merged.merged_into_id) === Number(publicStore.id), "merge target should persist");

    const bulkStore = await request("/api/admin/stores", {
      method: "POST",
      token: admin.token,
      body: {
        name: `${prefix}-bulk-store`,
        city: "Beijing",
        address: "D35 bulk address",
        status: "inactive"
      }
    });
    created.stores.push(bulkStore.id);
    await request(`/api/admin/stores/${bulkStore.id}`, {
      method: "PATCH",
      token: admin.token,
      body: { status: "active" }
    });
    const activeBulkStore = await findAdminStoreById(admin.token, bulkStore.id);
    assert(activeBulkStore?.status === "active", "bulk-style status update should activate store");
    await requestExpectingError(
      `/api/admin/stores/${bulkStore.id}`,
      { method: "DELETE", token: admin.token },
      409
    );
    await request(`/api/admin/stores/${bulkStore.id}`, {
      method: "PATCH",
      token: admin.token,
      body: { status: "inactive" }
    });
    await request(`/api/admin/stores/${bulkStore.id}`, { method: "DELETE", token: admin.token });
    created.stores = created.stores.filter((id) => Number(id) !== Number(bulkStore.id));

    console.log("D35 admin catalog flow check passed");
  } finally {
    await cleanup(admin.token, created);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  if (error.cause) {
    console.error(error.cause);
  }
  process.exit(1);
});
