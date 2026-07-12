const rawBaseUrl = process.env.BASE_URL || "http://127.0.0.1:3029";
const baseUrl = new URL(rawBaseUrl);
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

if (baseUrl.protocol !== "http:" || !loopbackHosts.has(baseUrl.hostname)) {
  throw new Error(
    `D45 smoke safety rejected non-local BASE_URL before any API write: ${baseUrl.origin}`
  );
}

const prefix = `d45-smoke-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(method, path, body, token, expectedStatus = 200) {
  const response = await fetch(new URL(path, baseUrl), {
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
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${path} expected ${expected.join("/")}, got ${response.status}: ${text}`);
  }
  return payload;
}

async function login(code) {
  return (await request("POST", "/api/auth/wechat/login", { code })).data;
}

async function authorizePhone(auth, label) {
  const payload = await request(
    "POST",
    "/api/auth/wechat/phone",
    { code: `${prefix}-${label}` },
    auth.token
  );
  auth.user = payload.data.user;
  auth.roles = payload.data.roles;
  return auth;
}

function startAt(hours) {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function databaseStartAt(hours) {
  return startAt(hours).slice(0, 19).replace("T", " ");
}

async function createCatalog(admin) {
  const store = (
    await request(
      "POST",
      "/api/admin/stores",
      { name: `${prefix}-store`, city: "北京", district: "朝阳", address: `${prefix}-address` },
      admin.token,
      201
    )
  ).data;
  const script = (
    await request(
      "POST",
      "/api/admin/scripts",
      {
        name: `${prefix}-script`,
        typeTags: ["D45"],
        playerCount: 4,
        summaryNoSpoiler: `${prefix} isolated local smoke`,
        defaultSeatTemplate: [],
        status: "active"
      },
      admin.token,
      201
    )
  ).data;
  return { store, script };
}

async function createSession(owner, catalog, label, hours = 24, joinPolicy = "direct") {
  return (
    await request(
      "POST",
      "/api/sessions",
      {
        storeId: catalog.store.id,
        scriptId: catalog.script.id,
        startAt: databaseStartAt(hours),
        joinPolicy,
        depositAmount: 0,
        note: `${prefix}-${label}`
      },
      owner.token,
      201
    )
  ).data;
}

async function createSeat(owner, sessionId, label) {
  return (
    await request(
      "POST",
      `/api/sessions/${sessionId}/seats`,
      { name: label, seatType: "normal", roleName: label, basePrice: 0, adjustment: 0 },
      owner.token,
      201
    )
  ).data;
}

async function createNpcRole(owner, sessionId, label) {
  return (
    await request(
      "POST",
      `/api/sessions/${sessionId}/npc-roles`,
      { name: label, description: `${prefix}-${label}` },
      owner.token,
      201
    )
  ).data;
}

function notificationsOfType(inbox, type, sessionId) {
  return inbox.data.items.filter(
    (item) => item.type === type && Number(item.session_id) === Number(sessionId)
  );
}

async function main() {
  assert(
    process.env.WECHAT_SUBSCRIBE_MESSAGE_ENABLED === "false",
    "D45 smoke requires WECHAT_SUBSCRIBE_MESSAGE_ENABLED=false; live WeChat messaging is forbidden"
  );

  const admin = await authorizePhone(await login("dev-admin-openid"), "admin-phone");
  const organizer = await authorizePhone(await login(`${prefix}-organizer`), "organizer-phone");
  const player = await authorizePhone(await login(`${prefix}-player`), "player-phone");
  const npc = await authorizePhone(await login(`${prefix}-npc`), "npc-phone");
  const rejectedPlayer = await authorizePhone(
    await login(`${prefix}-rejected-player`),
    "rejected-player-phone"
  );
  assert(admin.roles.includes("system_admin"), "fixture admin must be system_admin");

  const catalog = await createCatalog(admin);
  const future = await createSession(organizer, catalog, "future");
  const seat = await createSeat(organizer, future.id, `${prefix}-seat`);
  const playerNpcRole = await createNpcRole(organizer, future.id, `${prefix}-player-npc`);
  const npcRole = await createNpcRole(organizer, future.id, `${prefix}-npc-role`);
  await request("POST", `/api/sessions/${future.id}/publish`, {}, organizer.token);
  await request("POST", `/api/session-seats/${seat.id}/claim`, { note: prefix }, player.token);
  await request("POST", `/api/session-npc-roles/${playerNpcRole.id}/claim`, { note: prefix }, player.token);
  await request("POST", `/api/session-npc-roles/${npcRole.id}/claim`, { note: prefix }, npc.token);

  const validNewTime = startAt(48);
  await request(
    "POST",
    `/api/sessions/${future.id}/reschedule`,
    { startAt: validNewTime, membersConfirmed: true },
    player.token,
    403
  );
  await request(
    "POST",
    `/api/sessions/${future.id}/reschedule`,
    { startAt: "not-a-date", membersConfirmed: true },
    organizer.token,
    400
  );
  await request(
    "POST",
    `/api/sessions/${future.id}/reschedule`,
    { startAt: startAt(-2), membersConfirmed: true },
    organizer.token,
    400
  );
  await request(
    "POST",
    `/api/sessions/${future.id}/reschedule`,
    { startAt: future.start_at, membersConfirmed: true },
    organizer.token,
    400
  );
  await request(
    "POST",
    `/api/sessions/${future.id}/reschedule`,
    { startAt: validNewTime },
    organizer.token,
    409
  );

  const rescheduled = await request(
    "POST",
    `/api/sessions/${future.id}/reschedule`,
    { startAt: validNewTime, membersConfirmed: true },
    organizer.token
  );
  assert(rescheduled.data.notification_delivery.recipients === 2, "seat + NPC users must dedupe");
  assert(rescheduled.data.notification_delivery.sent === 0, "disabled messaging must send nothing");
  assert(rescheduled.data.notification_delivery.skipped === 2, "disabled messaging must be skipped");
  const futureDetail = await request("GET", `/api/sessions/${future.id}`, undefined, organizer.token);
  assert(
    new Date(futureDetail.data.start_at).getTime() === new Date(validNewTime).setMilliseconds(0),
    "successful reschedule must persist the new session time"
  );

  const started = await createSession(organizer, catalog, "started", -2);
  await request(
    "POST",
    `/api/sessions/${started.id}/reschedule`,
    { startAt: startAt(72), membersConfirmed: true },
    organizer.token,
    409
  );

  const review = await createSession(organizer, catalog, "review", 30, "review_required");
  const approveSeat = await createSeat(organizer, review.id, `${prefix}-approve-seat`);
  const rejectSeat = await createSeat(organizer, review.id, `${prefix}-reject-seat`);
  await request("POST", `/api/sessions/${review.id}/publish`, {}, organizer.token);
  const approveSignup = await request(
    "POST",
    "/api/signups",
    { seatId: approveSeat.id, contactText: prefix, note: "approve" },
    player.token,
    201
  );
  const rejectSignup = await request(
    "POST",
    "/api/signups",
    { seatId: rejectSeat.id, contactText: prefix, note: "reject" },
    rejectedPlayer.token,
    201
  );
  await request("PATCH", `/api/signups/${approveSignup.data.id}/approve`, {}, organizer.token);
  await request("PATCH", `/api/signups/${rejectSignup.data.id}/reject`, {}, organizer.token);
  await request(
    "PATCH",
    `/api/signups/${rejectSignup.data.id}/reject`,
    {},
    organizer.token,
    [400, 409]
  );

  const playerInbox = await request("GET", "/api/users/me/notifications", undefined, player.token);
  const npcInbox = await request("GET", "/api/users/me/notifications", undefined, npc.token);
  const organizerInbox = await request(
    "GET",
    "/api/users/me/notifications",
    undefined,
    organizer.token
  );
  const rejectedInbox = await request(
    "GET",
    "/api/users/me/notifications",
    undefined,
    rejectedPlayer.token
  );
  const playerRescheduleNotifications = notificationsOfType(
    playerInbox,
    "session_rescheduled",
    future.id
  );
  const npcRescheduleNotifications = notificationsOfType(
    npcInbox,
    "session_rescheduled",
    future.id
  );
  assert(
    playerRescheduleNotifications.length === 1,
    "deduped player must receive exactly one reschedule inbox notification"
  );
  assert(
    npcRescheduleNotifications.length === 1,
    "bound NPC user must receive one reschedule inbox notification"
  );
  const playerRescheduleId = Number(playerRescheduleNotifications[0].id);
  const npcRescheduleId = Number(npcRescheduleNotifications[0].id);
  assert(
    playerRescheduleId !== npcRescheduleId,
    "player and NPC fixtures must have distinguishable notification identities"
  );
  assert(
    !playerInbox.data.items.some((item) => Number(item.id) === npcRescheduleId),
    "player inbox must exclude the NPC-only reschedule notification"
  );
  assert(
    !npcInbox.data.items.some((item) => Number(item.id) === playerRescheduleId),
    "NPC inbox must exclude the player-only reschedule notification"
  );
  assert(
    notificationsOfType(organizerInbox, "session_rescheduled", future.id).length === 0 &&
      !organizerInbox.data.items.some(
        (item) => Number(item.id) === playerRescheduleId || Number(item.id) === npcRescheduleId
      ),
    "organizer inbox must exclude member-only reschedule notifications"
  );
  assert(
    notificationsOfType(playerInbox, "signup_reviewed", review.id).some(
      (item) => item.payload.result === "approved"
    ),
    "approved signup result must persist"
  );
  assert(
    notificationsOfType(rejectedInbox, "signup_reviewed", review.id).some(
      (item) => item.payload.result === "rejected"
    ),
    "rejected signup result must persist"
  );

  const notification = playerRescheduleNotifications[0];
  await request(
    "POST",
    `/api/users/me/notifications/${notification.id}/read`,
    {},
    organizer.token,
    404
  );
  const firstRead = await request(
    "POST",
    `/api/users/me/notifications/${notification.id}/read`,
    {},
    player.token
  );
  const secondRead = await request(
    "POST",
    `/api/users/me/notifications/${notification.id}/read`,
    {},
    player.token
  );
  assert(firstRead.data.read_at, "owner read must set read_at");
  assert(firstRead.data.read_at === secondRead.data.read_at, "repeated read must be idempotent");

  console.log(`D45 session reschedule notifications smoke passed (${prefix})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
