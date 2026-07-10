const baseUrl = process.env.BASE_URL || "http://localhost:3018";
const suffix = Date.now();

async function request(method, path, body, token, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(30_000),
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function login(code) {
  return (await request("POST", "/api/auth/wechat/login", { code })).data;
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

function startAt(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

async function createStore(admin) {
  return (
    await request(
      "POST",
      "/api/admin/stores",
      {
        name: `D40游客店-${suffix}`,
        city: "北京",
        district: "朝阳",
        address: "D40隔离烟测地址",
        latitude: 39.9042,
        longitude: 116.4074,
        status: "active"
      },
      admin.token,
      201
    )
  ).data;
}

async function createScript(admin) {
  return (
    await request(
      "POST",
      "/api/admin/scripts",
      {
        name: `D40游客本-${suffix}`,
        typeTags: ["情感", "沉浸"],
        playerCount: 2,
        summaryNoSpoiler: "D40 isolated guest calendar smoke",
        defaultSeatTemplate: [
          {
            name: "角色A",
            seatType: "normal",
            roleName: "角色A",
            basePrice: 58000,
            adjustment: 0
          }
        ],
        status: "active"
      },
      admin.token,
      201
    )
  ).data;
}

async function createSession(owner, store, script, label, options = {}) {
  const session = (
    await request(
      "POST",
      "/api/sessions",
      {
        storeId: store.id,
        scriptId: script.id,
        startAt: options.startAt || startAt(24),
        visibility: options.visibility || "public",
        joinPolicy: options.joinPolicy || "direct",
        depositAmount: 0,
        note: `D40 private note ${label}`
      },
      owner.token,
      201
    )
  ).data;
  const seat = (
    await request(
      "POST",
      `/api/sessions/${session.id}/seats`,
      {
        name: `D40-${label}`,
        seatType: "normal",
        roleName: `D40-${label}`,
        basePrice: 58000,
        adjustment: 0
      },
      owner.token,
      201
    )
  ).data;
  if (options.publish !== false) {
    await request("POST", `/api/sessions/${session.id}/publish`, {}, owner.token);
  }
  if (options.status) {
    await request(
      "PATCH",
      `/api/sessions/${session.id}`,
      { status: options.status },
      owner.token
    );
  }
  return { session, seat };
}

function ids(rows) {
  return new Set(rows.map((row) => Number(row.id)));
}

function sortedByStartAt(rows) {
  return rows.every((row, index) => {
    if (index === 0) {
      return true;
    }
    const previous = rows[index - 1];
    if (String(previous.start_at) !== String(row.start_at)) {
      return String(previous.start_at) <= String(row.start_at);
    }
    return Number(previous.id) <= Number(row.id);
  });
}

function assertPublicCardShape(row) {
  for (const key of [
    "note",
    "organizer_user_id",
    "confirmed_user_id",
    "confirmed_user_open_id",
    "phone",
    "store_latitude",
    "store_longitude",
    "photo_count",
    "active_album_photo_count"
  ]) {
    assert(!(key in row), `public card must not expose ${key}`);
  }
}

async function main() {
  await request("GET", "/api/sessions/public/upcoming?limit=20");

  const admin = await authorizePhone(await login("dev-admin-openid"), "d40-admin-phone");
  const organizer = await authorizePhone(
    await login(`dev-d40-organizer-${suffix}`),
    "d40-organizer-phone"
  );
  const member = await authorizePhone(
    await login(`dev-d40-member-${suffix}`),
    "d40-member-phone"
  );
  const outsider = await authorizePhone(
    await login(`dev-d40-outsider-${suffix}`),
    "d40-outsider-phone"
  );
  assert(admin.roles.includes("system_admin"), "D40 smoke requires system admin");

  const store = await createStore(admin);
  const script = await createScript(admin);
  const eligibleEarly = await createSession(organizer, store, script, "eligible-early", {
    startAt: startAt(12)
  });
  const eligibleLate = await createSession(organizer, store, script, "eligible-late", {
    startAt: startAt(18)
  });
  const shareOnly = await createSession(organizer, store, script, "share-only", {
    visibility: "share_only",
    startAt: startAt(13)
  });
  const cancelled = await createSession(organizer, store, script, "cancelled", {
    startAt: startAt(14),
    status: "cancelled"
  });
  const locked = await createSession(organizer, store, script, "locked", {
    startAt: startAt(15),
    status: "locked"
  });
  const started = await createSession(organizer, store, script, "started", {
    startAt: startAt(-2)
  });

  const listPayload = await request("GET", "/api/sessions/public/upcoming?limit=999");
  const rows = listPayload.data.sessions;
  assert(Array.isArray(rows), "public upcoming response must contain sessions array");
  const visibleIds = ids(rows);
  assert(visibleIds.has(eligibleEarly.session.id), "earlier eligible session must be visible");
  assert(visibleIds.has(eligibleLate.session.id), "later eligible session must be visible");
  assert(!visibleIds.has(shareOnly.session.id), "share-only session must be hidden");
  assert(!visibleIds.has(cancelled.session.id), "cancelled session must be hidden");
  assert(!visibleIds.has(locked.session.id), "locked session must be hidden");
  assert(!visibleIds.has(started.session.id), "started session must be hidden");
  assert(rows.length <= 20, "public upcoming response must clamp limit to 20");
  assert(sortedByStartAt(rows), "public upcoming response must sort by start_at then id");
  rows.forEach(assertPublicCardShape);

  const publicDetail = (
    await request("GET", `/api/sessions/${eligibleEarly.session.id}`)
  ).data;
  assert(publicDetail.access_scope === "public_preview", "future public detail must be a preview");
  assert(!JSON.stringify(publicDetail).includes("confirmed_user_open_id"), "preview hides open_id");

  await request("GET", `/api/sessions/${started.session.id}`, undefined, undefined, 404);
  await request("GET", `/api/sessions/${started.session.id}`, undefined, outsider.token, 404);
  const ownerDetail = (
    await request("GET", `/api/sessions/${started.session.id}`, undefined, organizer.token)
  ).data;
  assert(ownerDetail.access_scope === "member", "organizer must keep member detail access");

  await request(
    "POST",
    `/api/session-seats/${started.seat.id}/claim`,
    { note: "D40 member claim" },
    member.token
  );
  const memberDetail = (
    await request("GET", `/api/sessions/${started.session.id}`, undefined, member.token)
  ).data;
  assert(memberDetail.access_scope === "member", "confirmed member must keep detail access");
  const albumShare = (
    await request(
      "POST",
      `/api/sessions/${started.session.id}/album/share-token`,
      {},
      member.token
    )
  ).data;
  const publicAlbum = (
    await request(
      "GET",
      `/api/sessions/${started.session.id}/album/public-share?token=${encodeURIComponent(
        albumShare.token
      )}`
    )
  ).data;
  assert(publicAlbum.session?.id, "D23 album token must still return its authorized album shell");

  await request(
    "GET",
    `/api/sessions/${started.session.id}?shareCode=guessable-${suffix}`,
    undefined,
    undefined,
    404
  );
  const invite = (
    await request(
      "POST",
      `/api/sessions/${started.session.id}/join-invite-token`,
      {},
      organizer.token,
      201
    )
  ).data;
  assert(invite.token, "join invite endpoint must return a signed token");
  const inviteDetail = (
    await request(
      "GET",
      `/api/sessions/${started.session.id}?inviteToken=${encodeURIComponent(invite.token)}`
    )
  ).data;
  assert(inviteDetail.access_scope === "invite_preview", "valid invite grants invite preview");
  assert(!("active_album_photo_count" in inviteDetail), "invite preview must not grant album data");

  console.log("D40 guest calendar home smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
