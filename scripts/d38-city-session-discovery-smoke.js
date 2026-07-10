const baseUrl = process.env.BASE_URL || "http://localhost:3018";
const suffix = Date.now();

async function request(method, path, body, token, expectedStatus = 200) {
  const startedAt = Date.now();
  console.log(`[D38 smoke] -> ${method} ${path}`);
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
  console.log(`[D38 smoke] <- ${response.status} ${method} ${path} (${Date.now() - startedAt}ms)`);
  return payload;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

function startAt(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function startAtDay(dayOffset, hour, minute = 0) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + dayOffset);
  value.setUTCHours(hour, minute, 0, 0);
  return value.toISOString().slice(0, 19).replace("T", " ");
}

async function createStore(admin, label, overrides = {}) {
  const payload = await request(
    "POST",
    "/api/admin/stores",
    {
      name: `D38同城店-${suffix}-${label}`,
      city: "北京",
      district: "朝阳",
      address: `D38地址-${label}`,
      latitude: 39.9042,
      longitude: 116.4074,
      status: "active",
      ...overrides
    },
    admin.token,
    201
  );
  return payload.data;
}

async function createScript(admin) {
  const payload = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `D38同城本-${suffix}`,
      typeTags: ["情感", "沉浸"],
      playerCount: 2,
      summaryNoSpoiler: "D38 city discovery smoke",
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
  );
  return payload.data;
}

async function createSession(owner, store, script, label, options = {}) {
  const sessionPayload = await request(
    "POST",
    "/api/sessions",
    {
      storeId: store.id,
      scriptId: script.id,
      startAt: options.startAt || startAt(24),
      visibility: options.visibility || "public",
      joinPolicy: options.joinPolicy || "review_required",
      depositAmount: 0,
      note: `D38 smoke ${label}`
    },
    owner.token,
    201
  );
  const session = sessionPayload.data;
  const seats = [];
  const seatCount = Math.max(Number(options.seatCount || 1), 1);
  for (let index = 0; index < seatCount; index += 1) {
    const seatPayload = await request(
      "POST",
      `/api/sessions/${session.id}/seats`,
      {
        name: `角色-${label}-${index + 1}`,
        seatType: "normal",
        roleName: `角色-${label}-${index + 1}`,
        basePrice: 58000,
        adjustment: 0
      },
      owner.token,
      201
    );
    seats.push(seatPayload.data);
  }
  if (options.publish !== false) {
    await request("POST", `/api/sessions/${session.id}/publish`, {}, owner.token);
  }
  return { session, seat: seats[0], seats };
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

async function main() {
  const admin = await authorizePhone(await login("dev-admin-openid"), "d38-admin-phone");
  const organizer = await authorizePhone(
    await login(`dev-d38-organizer-${suffix}`),
    "d38-organizer-phone"
  );
  const player = await authorizePhone(await login(`dev-d38-player-${suffix}`), "d38-player-phone");
  const filler = await authorizePhone(await login(`dev-d38-filler-${suffix}`), "d38-filler-phone");
  assert(admin.roles.includes("system_admin"), "D38 smoke requires a system admin");

  const nearStore = await createStore(admin, "near");
  const farStore = await createStore(admin, "far", {
    latitude: 40.2042,
    longitude: 116.8074
  });
  const precisionStore = await createStore(admin, "precision", {
    latitude: 39.9045,
    longitude: 116.4074
  });
  const noCoordinateStore = await createStore(admin, "no-coordinate", {
    latitude: "",
    longitude: ""
  });
  const shanghaiStore = await createStore(admin, "shanghai", {
    city: "上海市",
    district: "黄浦",
    latitude: 31.2304,
    longitude: 121.4737
  });
  const script = await createScript(admin);
  const sharedStart = startAtDay(3, 12);

  const qualifying = await createSession(organizer, nearStore, script, "qualifying", {
    startAt: startAt(20)
  });
  const near = await createSession(organizer, nearStore, script, "near", {
    startAt: sharedStart
  });
  const far = await createSession(organizer, farStore, script, "far", {
    startAt: sharedStart
  });
  const precisionFar = await createSession(organizer, precisionStore, script, "precision-far", {
    startAt: startAtDay(3, 13)
  });
  const precisionNear = await createSession(organizer, nearStore, script, "precision-near", {
    startAt: startAtDay(3, 14)
  });
  const noCoordinate = await createSession(
    organizer,
    noCoordinateStore,
    script,
    "no-coordinate",
    { startAt: startAtDay(3, 11) }
  );
  const shareOnly = await createSession(organizer, nearStore, script, "share-only", {
    visibility: "share_only",
    startAt: startAt(22)
  });
  const draft = await createSession(organizer, nearStore, script, "draft", {
    publish: false,
    startAt: startAt(23)
  });
  const locked = await createSession(organizer, nearStore, script, "locked", {
    startAt: startAt(24)
  });
  await request(
    "PATCH",
    `/api/sessions/${locked.session.id}`,
    { status: "locked" },
    organizer.token
  );
  const cancelled = await createSession(organizer, nearStore, script, "cancelled", {
    startAt: startAt(26)
  });
  await request(
    "PATCH",
    `/api/sessions/${cancelled.session.id}`,
    { status: "cancelled" },
    organizer.token
  );
  const past = await createSession(organizer, nearStore, script, "past", {
    startAt: startAt(-2)
  });
  const wrongCity = await createSession(organizer, shanghaiStore, script, "wrong-city", {
    startAt: startAt(18)
  });
  const own = await createSession(player, nearStore, script, "owned-by-player", {
    startAt: startAt(19)
  });
  const joined = await createSession(organizer, nearStore, script, "already-joined", {
    startAt: startAt(21)
  });
  await request(
    "POST",
    "/api/signups",
    { seatId: joined.seat.id, contactText: "D38 pending signup" },
    player.token,
    201
  );
  const approved = await createSession(organizer, nearStore, script, "already-approved", {
    joinPolicy: "direct",
    seatCount: 2,
    startAt: startAt(22)
  });
  await request(
    "POST",
    `/api/session-seats/${approved.seat.id}/claim`,
    { note: "D38 approved signup" },
    player.token
  );
  const full = await createSession(organizer, nearStore, script, "full", {
    joinPolicy: "direct",
    startAt: startAt(25)
  });
  await request(
    "POST",
    `/api/session-seats/${full.seat.id}/claim`,
    { note: "D38 fill seat" },
    filler.token
  );

  await request(
    "POST",
    "/api/sessions",
    {
      storeId: nearStore.id,
      scriptId: script.id,
      startAt: startAt(40),
      visibility: "private"
    },
    organizer.token,
    400
  );

  const cityPayload = await request(
    "POST",
    "/api/sessions/discovery",
    {
      city: "北京市",
      latitude: 39.9042,
      longitude: 116.4074,
      limit: 50
    },
    player.token
  );
  assert(cityPayload.data.mode === "city", "cached city should select city mode");
  assert(cityPayload.data.city === "北京市", "city mode should return the normalized city");
  const cityRows = cityPayload.data.sessions;
  const cityIds = ids(cityRows);
  assert(cityIds.has(Number(qualifying.session.id)), "qualifying public session should be discoverable");
  assert(!cityIds.has(Number(shareOnly.session.id)), "share-only session should not be discoverable");
  assert(!cityIds.has(Number(draft.session.id)), "draft session should not be discoverable");
  assert(!cityIds.has(Number(past.session.id)), "past session should not be discoverable");
  assert(!cityIds.has(Number(wrongCity.session.id)), "other-city session should not be discoverable");
  assert(!cityIds.has(Number(own.session.id)), "organizer-owned session should not be discoverable");
  assert(!cityIds.has(Number(joined.session.id)), "active signup session should not be discoverable");
  assert(!cityIds.has(Number(approved.session.id)), "approved signup session should not be discoverable");
  assert(!cityIds.has(Number(locked.session.id)), "locked session should not be discoverable");
  assert(!cityIds.has(Number(cancelled.session.id)), "cancelled session should not be discoverable");
  assert(!cityIds.has(Number(full.session.id)), "full session should not be discoverable");
  const nearIndex = cityRows.findIndex((row) => Number(row.id) === Number(near.session.id));
  const farIndex = cityRows.findIndex((row) => Number(row.id) === Number(far.session.id));
  assert(nearIndex >= 0 && farIndex >= 0 && nearIndex < farIndex, "same-day sessions should sort by distance");
  const precisionNearIndex = cityRows.findIndex(
    (row) => Number(row.id) === Number(precisionNear.session.id)
  );
  const precisionFarIndex = cityRows.findIndex(
    (row) => Number(row.id) === Number(precisionFar.session.id)
  );
  assert(
    precisionNearIndex >= 0 &&
      precisionFarIndex >= 0 &&
      precisionNearIndex < precisionFarIndex,
    "distance ordering should use unrounded precision"
  );
  const noCoordinateIndex = cityRows.findIndex(
    (row) => Number(row.id) === Number(noCoordinate.session.id)
  );
  assert(
    noCoordinateIndex > precisionNearIndex && noCoordinateIndex > precisionFarIndex,
    "store without coordinates should sort after measured stores"
  );
  assert(
    cityRows[noCoordinateIndex]?.distance_km === null,
    "store without coordinates should return a null distance"
  );
  const qualifyingRow = cityRows.find((row) => Number(row.id) === Number(qualifying.session.id));
  assert(Number(qualifyingRow.available_seat_count) === 1, "discovery should return available seats");
  assert(Number.isFinite(Number(qualifyingRow.distance_km)), "city result should return distance");
  for (const privateKey of ["organizer_open_id", "organizer_phone", "contact_text", "note"]) {
    assert(!(privateKey in qualifyingRow), `discovery should not return ${privateKey}`);
  }

  const fallbackPayload = await request(
    "POST",
    "/api/sessions/discovery",
    {},
    player.token
  );
  assert(fallbackPayload.data.mode === "time_fallback", "no location should select time fallback");
  assert(
    fallbackPayload.data.sessions.length <= 5,
    "fallback should return at most five sessions"
  );
  assert(sortedByStartAt(fallbackPayload.data.sessions), "fallback sessions should sort by start time");

  await request(
    "POST",
    "/api/sessions/discovery",
    { latitude: 91, longitude: 116.4074 },
    player.token,
    400
  );
  console.log("discovery should reject invalid coordinates");
  await request("POST", "/api/sessions/discovery", {}, undefined, 401);
  console.log("discovery should require login");

  console.log("D38 city session discovery smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
