import assert from "node:assert/strict";
import crypto from "node:crypto";

const baseUrl = new URL(process.env.BASE_URL || "http://localhost:3018");
const suffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const fixturePrefix = `historical-backfill-${suffix}`;
const fixtureCity = `补录验收城-${suffix}`;
const historicalInviteTtlSeconds = 7 * 24 * 60 * 60;

const seatTemplate = [
  {
    name: "补录角色一",
    seatType: "normal",
    roleName: "补录角色一",
    basePrice: 0,
    adjustment: 0
  },
  {
    name: "补录角色二",
    seatType: "normal",
    roleName: "补录角色二",
    basePrice: 0,
    adjustment: 0
  },
  {
    name: "补录角色三",
    seatType: "normal",
    roleName: "补录角色三",
    basePrice: 0,
    adjustment: 0
  }
];

function assertLocalDevelopmentBaseUrl(url) {
  assert.ok(url instanceof URL, "BASE_URL must be a valid URL");
  assert.ok(
    new Set(["http:", "https:"]).has(url.protocol),
    "historical smoke BASE_URL must use HTTP or HTTPS"
  );
  assert.ok(
    new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(url.hostname),
    "historical smoke BASE_URL must resolve to localhost"
  );
  assert.equal(url.username, "", "historical smoke BASE_URL must not contain credentials");
  assert.equal(url.password, "", "historical smoke BASE_URL must not contain credentials");
}

assertLocalDevelopmentBaseUrl(baseUrl);

function assertDevelopmentHealth(health) {
  assert.equal(health?.ok, true, "local API health must be ready");
  assert.equal(
    health?.config?.nodeEnv,
    "development",
    "historical smoke may only write to a development API"
  );
  assert.equal(
    health?.config?.wechatMockLogin,
    true,
    "historical smoke requires development WeChat mock login"
  );
  assert.equal(
    health?.database?.schemaReady,
    true,
    "historical smoke requires the ready isolated schema"
  );
}

function redactSensitiveText(value, secrets = []) {
  let redacted = String(value || "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }
  return redacted
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /([?&](?:inviteToken|historicalInviteToken)=)[^&\s]+/gi,
      "$1[REDACTED]"
    )
    .replace(
      /("(?:inviteToken|token)"\s*:\s*")[^"]+("?)/gi,
      "$1[REDACTED]$2"
    );
}

function requestSecrets(path, body, token) {
  const secrets = [token, body?.inviteToken, body?.token];
  try {
    const url = new URL(path, baseUrl);
    secrets.push(url.searchParams.get("inviteToken"));
    secrets.push(url.searchParams.get("historicalInviteToken"));
  } catch {
    // The request itself will report an invalid URL without echoing credentials.
  }
  return secrets.filter((value) => typeof value === "string" && value);
}

const redactionProbe = redactSensitiveText(
  "Bearer bearer-probe /x?inviteToken=invite-probe " +
    JSON.stringify({ token: "body-probe" }),
  ["bearer-probe", "invite-probe", "body-probe"]
);
for (const secret of ["bearer-probe", "invite-probe", "body-probe"]) {
  assert.equal(redactionProbe.includes(secret), false, "request errors must redact secrets");
}

async function requestJson(method, path, options = {}) {
  const { body, token, expectedStatus } = options;
  if (expectedStatus === undefined) {
    throw new Error(`${method} request is missing expectedStatus`);
  }
  const expectedStatuses = Array.isArray(expectedStatus)
    ? expectedStatus
    : [expectedStatus];
  assert.ok(
    expectedStatuses.length > 0 &&
      expectedStatuses.every((status) => Number.isInteger(status)),
    `${method} ${path} expectedStatus must contain HTTP status integers`
  );

  const secrets = requestSecrets(path, body, token);
  const safeLabel = redactSensitiveText(`${method} ${path}`, secrets);
  let response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      method,
      signal: AbortSignal.timeout(30_000),
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (error) {
    const causeDetail = [error?.cause?.code, error?.cause?.message]
      .filter(Boolean)
      .join(": ");
    throw new Error(
      `${safeLabel} request failed: ${redactSensitiveText(
        causeDetail || error?.message,
        secrets
      )}`
    );
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(
        `${safeLabel} returned non-JSON ${response.status}: ${redactSensitiveText(
          text.slice(0, 500),
          secrets
        )}`
      );
    }
  }
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `${safeLabel} expected ${expectedStatuses.join("/")}, got ${
        response.status
      }: ${redactSensitiveText(text.slice(0, 1000), secrets)}`
    );
  }
  return { status: response.status, payload };
}

function dataOf(result, label) {
  assert.equal(result.payload?.ok, true, `${label} must return ok true`);
  return result.payload.data;
}

function assertApiError(result, status, code, label) {
  assert.equal(result.status, status, `${label} status`);
  assert.equal(result.payload?.ok, false, `${label} must return ok false`);
  assert.equal(result.payload?.error?.code, code, `${label} error code`);
}

async function login(code, label) {
  const result = await requestJson("POST", "/api/auth/wechat/login", {
    body: { code },
    expectedStatus: 200
  });
  return dataOf(result, `${label} login`);
}

async function authorizePhone(auth, label) {
  const result = await requestJson("POST", "/api/auth/wechat/phone", {
    body: { code: `${fixturePrefix}-${label}-phone` },
    token: auth.token,
    expectedStatus: 200
  });
  auth.user = dataOf(result, `${label} phone`).user;
  auth.roles = result.payload.data.roles;
  return auth;
}

function beijingWallTime(dayOffset, hour) {
  const dateParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return new Date(
    Date.UTC(
      Number(dateParts.year),
      Number(dateParts.month) - 1,
      Number(dateParts.day) + dayOffset,
      hour,
      0,
      0
    )
  )
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function decodeSignedPayload(token, label) {
  const parts = String(token || "").split(".");
  assert.equal(parts.length, 2, `${label} must be a two-part signed payload`);
  try {
    return JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    throw new Error(`${label} payload must be decodable JSON`);
  }
}

function tamperToken(token) {
  const [payload, signature] = String(token).split(".");
  assert.ok(payload && signature, "historical token must be signed before tampering");
  assert.match(signature, /^[a-f0-9]{64}$/, "historical token signature must be hex");
  const last = signature.at(-1);
  const tampered = `${payload}.${signature.slice(0, -1)}${last === "a" ? "b" : "a"}`;
  assert.notEqual(tampered, token, "tampered historical token must differ");
  return tampered;
}

function ids(rows) {
  return new Set((rows || []).map((row) => Number(row.id)));
}

async function createSeat(sessionId, seat, organizer) {
  return dataOf(
    await requestJson("POST", `/api/sessions/${sessionId}/seats`, {
      body: seat,
      token: organizer.token,
      expectedStatus: 201
    }),
    `create seat ${seat.name}`
  );
}

function assertSafeHistoricalSettings(session, label) {
  assert.equal(session.session_purpose, "historical_record", `${label} purpose`);
  assert.equal(session.visibility, "share_only", `${label} visibility`);
  assert.equal(session.join_policy, "review_required", `${label} join policy`);
  assert.equal(Boolean(Number(session.join_phone_required)), false, `${label} phone gate`);
  assert.equal(Boolean(Number(session.npc_join_enabled)), false, `${label} NPC recruitment`);
}

function assertHistoricalGate(result, label) {
  assertApiError(
    result,
    403,
    "HISTORICAL_ROLE_CLAIM_INVITE_REQUIRED",
    label
  );
}

function normalizeHistoricalPreviewKey(key) {
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function historicalPreviewSensitiveKey(key) {
  const normalized = normalizeHistoricalPreviewKey(key);
  if (new Set(["is_bound", "has_pending_signup"]).has(normalized)) {
    return false;
  }
  if (
    new Set([
      "note",
      "join_policy",
      "join_phone_required",
      "npc_join_enabled",
      "cancelled_by_user_id",
      "dm_user_id",
      "npc_user_id",
      "pending_signup_id"
    ]).has(normalized)
  ) {
    return true;
  }
  const segments = normalized.split("_").filter(Boolean);
  if (
    segments.some((segment) =>
      new Set([
        "identity",
        "organizer",
        "member",
        "members",
        "user",
        "users",
        "openid",
        "nickname",
        "avatar",
        "phone",
        "album",
        "media",
        "photo",
        "photos",
        "upload",
        "uploader"
      ]).has(segment)
    )
  ) {
    return true;
  }
  if (
    normalized.includes("open_id") ||
    normalized === "review" ||
    normalized === "reviews" ||
    normalized === "can_review" ||
    normalized.startsWith("review_") ||
    normalized.includes("_review_") ||
    normalized.endsWith("_review") ||
    normalized.startsWith("review_eligible") ||
    normalized.startsWith("confirmed_") ||
    normalized.startsWith("bound_") ||
    normalized.startsWith("pending_signup_")
  ) {
    return true;
  }
  return false;
}

function assertHistoricalPreviewSanitized(preview, privateIdentityStrings = []) {
  assert.equal(
    preview.access_scope,
    "historical_invite_preview",
    "historical token must expose only the dedicated invite preview"
  );
  assert.equal(preview.session_purpose, "historical_record");
  assert.ok(Array.isArray(preview.seats) && preview.seats.length === 3);
  assert.ok(
    Array.isArray(preview.session_npc_roles) && preview.session_npc_roles.length >= 1
  );

  const privateStrings = [...new Set(
    privateIdentityStrings
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
  )];

  const visit = (value, path = "preview") => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") {
      if (typeof value === "string") {
        for (const privateString of privateStrings) {
          assert.equal(
            value.includes(privateString),
            false,
            `${path} must not contain known organizer identity data`
          );
        }
      }
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      assert.equal(
        historicalPreviewSensitiveKey(key),
        false,
        `${path}.${key} must not expose member, album, review, or organizer-only data`
      );
      visit(child, `${path}.${key}`);
    }
  };
  visit(preview);
}

async function main() {
  const health = await requestJson("GET", "/health", { expectedStatus: 200 });
  assertDevelopmentHealth(health.payload);

  const admin = await authorizePhone(await login("dev-admin-openid", "admin"), "admin");
  const organizer = await authorizePhone(
    await login(`dev-${fixturePrefix}-organizer`, "organizer"),
    "organizer"
  );
  const bypassPlayer = await authorizePhone(
    await login(`dev-${fixturePrefix}-bypass`, "bypass"),
    "bypass"
  );
  const invitedPlayer = await authorizePhone(
    await login(`dev-${fixturePrefix}-invited`, "invited"),
    "invited"
  );
  const racePlayerA = await authorizePhone(
    await login(`dev-${fixturePrefix}-race-a`, "race-a"),
    "race-a"
  );
  const racePlayerB = await authorizePhone(
    await login(`dev-${fixturePrefix}-race-b`, "race-b"),
    "race-b"
  );
  const futurePlayer = await authorizePhone(
    await login(`dev-${fixturePrefix}-future`, "future"),
    "future"
  );
  assert.ok(admin.roles.includes("system_admin"), "smoke requires the development admin");

  // 1. Use unique, active catalog fixtures with three player roles.
  const store = dataOf(
    await requestJson("POST", "/api/admin/stores", {
      body: {
        name: `${fixturePrefix}-store`,
        city: fixtureCity,
        district: "验收区",
        address: `${fixturePrefix}-address`,
        status: "active"
      },
      token: admin.token,
      expectedStatus: 201
    }),
    "create active store"
  );
  const script = dataOf(
    await requestJson("POST", "/api/admin/scripts", {
      body: {
        name: `${fixturePrefix}-script`,
        typeTags: ["历史补录验收"],
        playerCount: 3,
        summaryNoSpoiler: "historical backfill lifecycle smoke",
        defaultSeatTemplate: seatTemplate,
        status: "active"
      },
      token: admin.token,
      expectedStatus: 201
    }),
    "create three-player-role script"
  );
  assert.equal(store.status, "active");
  assert.equal(script.status, "active");
  assert.equal(Number(script.player_count), 3);

  // 2-3. Create a past Beijing historical record while forging public recruitment settings.
  const historicalStartAt = beijingWallTime(-1, 13);
  const historicalCreationKey = `hs_${crypto.randomBytes(32).toString("hex")}`;
  const historicalSession = dataOf(
    await requestJson("POST", "/api/sessions", {
      body: {
        storeId: store.id,
        scriptId: script.id,
        startAt: historicalStartAt,
        sessionPurpose: "historical_record",
        historicalCreationKey,
        visibility: "public",
        joinPolicy: "direct",
        joinPhoneRequired: true,
        npcJoinEnabled: true,
        depositAmount: 0,
        note: `${fixturePrefix}-historical-note`,
        extraNpcRoles: [
          {
            name: `${fixturePrefix}-extra-npc`,
            description: "valid active unbound historical NPC role",
            roleGender: "unlimited",
            sortOrder: 0
          }
        ]
      },
      token: organizer.token,
      expectedStatus: 201
    }),
    "create historical session"
  );
  assertSafeHistoricalSettings(historicalSession, "historical create response");
  assert.equal(historicalSession.status, "draft");

  // 4-5. Create all seats, publish with the creator seat, then verify locked member surfaces.
  const historicalSeats = [];
  for (const seat of seatTemplate) {
    historicalSeats.push(await createSeat(historicalSession.id, seat, organizer));
  }
  const publishedHistory = dataOf(
    await requestJson("POST", `/api/sessions/${historicalSession.id}/publish`, {
      body: { creatorSeatId: historicalSeats[0].id },
      token: organizer.token,
      expectedStatus: 200
    }),
    "publish historical session"
  );
  assertSafeHistoricalSettings(publishedHistory, "historical publish response");
  assert.equal(publishedHistory.status, "locked");

  const historicalDetail = dataOf(
    await requestJson("GET", `/api/sessions/${historicalSession.id}`, {
      token: organizer.token,
      expectedStatus: 200
    }),
    "historical member detail"
  );
  assertSafeHistoricalSettings(historicalDetail, "historical member detail");
  assert.equal(historicalDetail.status, "locked");
  assert.equal(historicalDetail.access_scope, "member");
  assert.equal(historicalDetail.seats.length, 3);
  assert.equal(
    Number(historicalDetail.seats[0].confirmed_user_id),
    Number(organizer.user.id)
  );
  for (const seat of historicalDetail.seats.slice(1)) {
    assert.equal(seat.status, "open", "ordinary bypass targets must be valid open seats");
    assert.equal(seat.confirmed_user_id, null, "ordinary bypass targets must be unoccupied");
  }
  const extraNpcRole = historicalDetail.session_npc_roles.find(
    (role) => role.name === `${fixturePrefix}-extra-npc`
  );
  assert.ok(extraNpcRole, "historical detail must contain the extra NPC role");
  assert.equal(extraNpcRole.status, "active");
  assert.equal(extraNpcRole.bound_user_id, null);

  const organizerAlbum = dataOf(
    await requestJson("GET", `/api/sessions/${historicalSession.id}/album`, {
      token: organizer.token,
      expectedStatus: 200
    }),
    "historical organizer album"
  );
  assert.equal(organizerAlbum.can_upload, true);
  assert.equal(organizerAlbum.session_purpose, "historical_record");
  const organizerReview = dataOf(
    await requestJson("GET", `/api/sessions/${historicalSession.id}/review`, {
      token: organizer.token,
      expectedStatus: 200
    }),
    "historical organizer review state"
  );
  assert.equal(organizerReview.can_review, true);

  // 6. Historical records must not enter discovery or public upcoming lists.
  const discovery = dataOf(
    await requestJson("POST", "/api/sessions/discovery", {
      body: { city: fixtureCity, limit: 50 },
      token: bypassPlayer.token,
      expectedStatus: 200
    }),
    "historical discovery exclusion"
  );
  assert.equal(ids(discovery.sessions).has(Number(historicalSession.id)), false);
  const publicUpcoming = dataOf(
    await requestJson("GET", "/api/sessions/public/upcoming?limit=20", {
      expectedStatus: 200
    }),
    "historical public upcoming exclusion"
  );
  assert.equal(ids(publicUpcoming.sessions).has(Number(historicalSession.id)), false);

  // 7. Every ordinary recruitment path must fail with the dedicated historical error.
  assertHistoricalGate(
    await requestJson("POST", "/api/signups", {
      body: {
        seatId: historicalSeats[1].id,
        contactText: `${fixturePrefix}-ordinary-signup`,
        note: "ordinary signup must be rejected"
      },
      token: bypassPlayer.token,
      expectedStatus: 403
    }),
    "historical ordinary signup"
  );
  assertHistoricalGate(
    await requestJson("POST", `/api/session-seats/${historicalSeats[1].id}/claim`, {
      body: { note: "ordinary seat claim must be rejected" },
      token: bypassPlayer.token,
      expectedStatus: 403
    }),
    "historical ordinary seat claim"
  );
  assertHistoricalGate(
    await requestJson("POST", `/api/session-npc-roles/${extraNpcRole.id}/claim`, {
      body: { note: "ordinary NPC claim must be rejected" },
      token: bypassPlayer.token,
      expectedStatus: 403
    }),
    "historical ordinary NPC claim"
  );
  assertHistoricalGate(
    await requestJson(
      "POST",
      `/api/sessions/${historicalSession.id}/join-invite-token`,
      {
        body: {},
        token: organizer.token,
        expectedStatus: 403
      }
    ),
    "historical ordinary join token"
  );

  // 8. Historical claims are server-owned, seven-day bounded, and tamper evident.
  const issuedAtLowerBound = Math.floor(Date.now() / 1000);
  const historicalInvitation = dataOf(
    await requestJson(
      "POST",
      `/api/sessions/${historicalSession.id}/historical-invite-token`,
      {
        body: {
          sessionId: Number(historicalSession.id) + 99_999,
          inviterUserId: bypassPlayer.user.id,
          exp: 1
        },
        token: organizer.token,
        expectedStatus: 201
      }
    ),
    "issue historical invitation"
  );
  const issuedAtUpperBound = Math.floor(Date.now() / 1000);
  const historicalClaims = decodeSignedPayload(
    historicalInvitation.token,
    "historical invite token"
  );
  assert.equal(Number(historicalClaims.sessionId), Number(historicalSession.id));
  assert.equal(Number(historicalClaims.inviterUserId), Number(organizer.user.id));
  assert.equal(historicalClaims.purpose, "historical_session_claim");
  assert.equal(historicalClaims.sessionPurpose, "historical_record");
  assert.ok(
    Number(historicalClaims.exp) >= issuedAtLowerBound + historicalInviteTtlSeconds &&
      Number(historicalClaims.exp) <= issuedAtUpperBound + historicalInviteTtlSeconds,
    "historical invite expiry must be bounded by the server to seven days"
  );
  assert.equal(
    new Date(historicalInvitation.expires_at).getTime(),
    Number(historicalClaims.exp) * 1000
  );
  const tamperedHistoricalPreview = await requestJson(
    "GET",
    `/api/sessions/${historicalSession.id}?historicalInviteToken=${encodeURIComponent(
      tamperToken(historicalInvitation.token)
    )}`,
    { expectedStatus: 403 }
  );
  assertApiError(tamperedHistoricalPreview, 403, "FORBIDDEN", "tampered historical token");

  // 9. The unauthenticated historical preview is a sanitized role-selection projection.
  const historicalPreview = dataOf(
    await requestJson(
      "GET",
      `/api/sessions/${historicalSession.id}?historicalInviteToken=${encodeURIComponent(
        historicalInvitation.token
      )}`,
      { expectedStatus: 200 }
    ),
    "historical invitation preview"
  );
  const organizerIdentityStrings = [
    organizer.openid,
    organizer.user?.openid,
    organizer.user?.open_id,
    organizer.user?.nickname,
    organizer.user?.avatarUrl,
    organizer.user?.avatar_url,
    organizer.user?.phone
  ];
  assertHistoricalPreviewSanitized(historicalPreview, organizerIdentityStrings);

  // Before claiming, the invite grants neither album membership nor review eligibility.
  const preclaimAlbum = await requestJson(
    "GET",
    `/api/sessions/${historicalSession.id}/album`,
    {
      token: invitedPlayer.token,
      expectedStatus: 403
    }
  );
  assertApiError(preclaimAlbum, 403, "FORBIDDEN", "preclaim historical album");
  const preclaimReview = dataOf(
    await requestJson("GET", `/api/sessions/${historicalSession.id}/review`, {
      token: invitedPlayer.token,
      expectedStatus: 200
    }),
    "preclaim historical review eligibility"
  );
  assert.equal(preclaimReview.can_review, false);
  assert.equal(preclaimReview.review, null);

  // 10. A dedicated claim creates approved membership plus album and review access.
  const dedicatedClaim = dataOf(
    await requestJson(
      "POST",
      `/api/sessions/${historicalSession.id}/historical-claims`,
      {
        body: {
          inviteToken: historicalInvitation.token,
          seatId: historicalSeats[1].id
        },
        token: invitedPlayer.token,
        expectedStatus: 200
      }
    ),
    "dedicated historical seat claim"
  );
  assert.equal(dedicatedClaim.claim_result, "historical_claimed");
  assert.equal(dedicatedClaim.claim_type, "seat");
  const invitedMemberships = dataOf(
    await requestJson("GET", "/api/users/me/signups", {
      token: invitedPlayer.token,
      expectedStatus: 200
    }),
    "invited historical memberships"
  );
  const invitedMembership = invitedMemberships.find(
    (signup) => Number(signup.session_id) === Number(historicalSession.id)
  );
  assert.ok(invitedMembership, "historical claimant must receive membership");
  assert.equal(invitedMembership.status, "approved");
  assert.equal(Number(invitedMembership.seat_id), Number(historicalSeats[1].id));
  const invitedAlbum = dataOf(
    await requestJson("GET", `/api/sessions/${historicalSession.id}/album`, {
      token: invitedPlayer.token,
      expectedStatus: 200
    }),
    "invited historical album"
  );
  assert.equal(invitedAlbum.can_upload, true);
  const invitedReview = dataOf(
    await requestJson("GET", `/api/sessions/${historicalSession.id}/review`, {
      token: invitedPlayer.token,
      expectedStatus: 200
    }),
    "invited historical review state"
  );
  assert.equal(invitedReview.can_review, true);

  // 11. Concurrent claims for the third seat must yield exactly one success and one conflict.
  const raceAttempts = [
    { label: "race A", player: racePlayerA },
    { label: "race B", player: racePlayerB }
  ];
  const concurrentClaims = await Promise.allSettled(
    raceAttempts.map(({ player }) =>
      requestJson("POST", `/api/sessions/${historicalSession.id}/historical-claims`, {
        body: {
          inviteToken: historicalInvitation.token,
          seatId: historicalSeats[2].id
        },
        token: player.token,
        expectedStatus: [200, 409]
      })
    )
  );
  assert.equal(
    concurrentClaims.every((result) => result.status === "fulfilled"),
    true,
    "both concurrent requests must complete with an explicitly expected status"
  );
  const raceOutcomes = concurrentClaims.map((result, index) => ({
    ...raceAttempts[index],
    response: result.value
  }));
  const concurrentHistoricalClaimSuccesses = raceOutcomes.filter(
    ({ response }) => response.status === 200
  ).length;
  const concurrentHistoricalClaimConflicts = raceOutcomes.filter(
    ({ response }) => response.status === 409
  ).length;
  assert.equal(concurrentHistoricalClaimSuccesses, 1);
  assert.equal(concurrentHistoricalClaimConflicts, 1);
  const winnerRace = raceOutcomes.find(({ response }) => response.status === 200);
  const loserRace = raceOutcomes.find(({ response }) => response.status === 409);
  assert.ok(winnerRace && loserRace, "race must identify one winner and one loser");
  const winnerClaim = dataOf(winnerRace.response, `${winnerRace.label} historical claim`);
  assert.equal(winnerClaim.claim_result, "historical_claimed");
  assert.equal(winnerClaim.claim_type, "seat");
  assert.equal(Number(winnerClaim.seat?.id), Number(historicalSeats[2].id));
  assertApiError(
    loserRace.response,
    409,
    "CONFLICT",
    `${loserRace.label} historical conflict`
  );

  const postRaceDetail = dataOf(
    await requestJson("GET", `/api/sessions/${historicalSession.id}`, {
      token: organizer.token,
      expectedStatus: 200
    }),
    "post-race organizer detail"
  );
  const racedSeat = postRaceDetail.seats.find(
    (seat) => Number(seat.id) === Number(historicalSeats[2].id)
  );
  assert.equal(racedSeat?.status, "confirmed");
  assert.equal(Number(racedSeat?.confirmed_user_id), Number(winnerRace.player.user.id));

  for (const outcome of raceOutcomes) {
    const memberships = dataOf(
      await requestJson("GET", "/api/users/me/signups", {
        token: outcome.player.token,
        expectedStatus: 200
      }),
      `${outcome.label} historical memberships`
    );
    const membership = memberships.find(
      (signup) => Number(signup.session_id) === Number(historicalSession.id)
    );
    if (outcome === winnerRace) {
      const winnerMembership = membership;
      assert.ok(winnerMembership, "race winner must receive historical membership");
      assert.equal(winnerMembership.status, "approved");
      assert.equal(Number(winnerMembership.seat_id), Number(historicalSeats[2].id));
      assert.equal(winnerMembership.can_review, true);
    } else {
      const loserMembership = membership;
      assert.equal(loserMembership, undefined, "race loser must have no active signup");
      const loserReview = dataOf(
        await requestJson("GET", `/api/sessions/${historicalSession.id}/review`, {
          token: outcome.player.token,
          expectedStatus: 200
        }),
        "race loser review eligibility"
      );
      assert.equal(loserReview.can_review, false);
      assert.equal(loserReview.review, null);
    }
  }

  // 12. An 8-August-style (+7 days), 13:00:00 Beijing wall time stays ordinary.
  const futureStartAt = beijingWallTime(7, 13);
  assert.match(futureStartAt, / 13:00:00$/);
  const futureSession = dataOf(
    await requestJson("POST", "/api/sessions", {
      body: {
        storeId: store.id,
        scriptId: script.id,
        startAt: futureStartAt,
        sessionPurpose: "future_carpool",
        visibility: "share_only",
        joinPolicy: "direct",
        joinPhoneRequired: true,
        npcJoinEnabled: false,
        depositAmount: 0,
        note: `${fixturePrefix}-future-note`
      },
      token: organizer.token,
      expectedStatus: 201
    }),
    "create future 13:00 carpool"
  );
  assert.equal(futureSession.session_purpose, "future_carpool");
  assert.equal(futureSession.join_policy, "direct");
  const futureSeat = await createSeat(futureSession.id, seatTemplate[0], organizer);
  const publishedFuture = dataOf(
    await requestJson("POST", `/api/sessions/${futureSession.id}/publish`, {
      body: {},
      token: organizer.token,
      expectedStatus: 200
    }),
    "publish future carpool"
  );
  assert.equal(publishedFuture.status, "recruiting");
  assert.equal(publishedFuture.session_purpose, "future_carpool");
  const futureInvitation = dataOf(
    await requestJson("POST", `/api/sessions/${futureSession.id}/join-invite-token`, {
      body: {},
      token: organizer.token,
      expectedStatus: 201
    }),
    "issue ordinary future invitation"
  );
  const futurePreview = dataOf(
    await requestJson(
      "GET",
      `/api/sessions/${futureSession.id}?inviteToken=${encodeURIComponent(
        futureInvitation.token
      )}`,
      { expectedStatus: 200 }
    ),
    "ordinary future invitation preview"
  );
  assert.equal(futurePreview.access_scope, "invite_preview");
  const ordinaryFutureClaim = dataOf(
    await requestJson("POST", `/api/session-seats/${futureSeat.id}/claim`, {
      body: { note: "ordinary future claim remains available" },
      token: futurePlayer.token,
      expectedStatus: 200
    }),
    "ordinary future claim"
  );
  assert.equal(ordinaryFutureClaim.join_result, "joined");
  const ordinaryFutureClaimSuccesses = 1;

  // 13. Ordinary and historical invitation tokens are never substitutable.
  const historicalTokenInOrdinaryNamespace = await requestJson(
    "GET",
    `/api/sessions/${historicalSession.id}?inviteToken=${encodeURIComponent(
      historicalInvitation.token
    )}`,
    { expectedStatus: 403 }
  );
  assertApiError(
    historicalTokenInOrdinaryNamespace,
    403,
    "FORBIDDEN",
    "historical token in ordinary namespace"
  );
  const futureTokenInHistoricalNamespace = await requestJson(
    "GET",
    `/api/sessions/${futureSession.id}?historicalInviteToken=${encodeURIComponent(
      futureInvitation.token
    )}`,
    { expectedStatus: 403 }
  );
  assertApiError(
    futureTokenInHistoricalNamespace,
    403,
    "FORBIDDEN",
    "future token in historical namespace"
  );
  const futureTokenOnHistory = await requestJson(
    "GET",
    `/api/sessions/${historicalSession.id}?inviteToken=${encodeURIComponent(
      futureInvitation.token
    )}`,
    { expectedStatus: 403 }
  );
  assertApiError(futureTokenOnHistory, 403, "FORBIDDEN", "future token on history");
  const historicalTokenOnFuture = await requestJson(
    "GET",
    `/api/sessions/${futureSession.id}?historicalInviteToken=${encodeURIComponent(
      historicalInvitation.token
    )}`,
    { expectedStatus: 403 }
  );
  assertApiError(historicalTokenOnFuture, 403, "FORBIDDEN", "historical token on future");
  const dualTokenPreview = await requestJson(
    "GET",
    `/api/sessions/${historicalSession.id}?inviteToken=${encodeURIComponent(
      futureInvitation.token
    )}&historicalInviteToken=${encodeURIComponent(historicalInvitation.token)}`,
    { expectedStatus: 400 }
  );
  assertApiError(dualTokenPreview, 400, "BAD_REQUEST", "dual invitation token preview");

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixture: fixturePrefix,
        historical_session_id: Number(historicalSession.id),
        future_session_id: Number(futureSession.id),
        concurrent_historical_claim_successes: concurrentHistoricalClaimSuccesses,
        concurrent_historical_claim_conflicts: concurrentHistoricalClaimConflicts,
        ordinary_future_claim_successes: ordinaryFutureClaimSuccesses
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(redactSensitiveText(error?.stack || error?.message || error));
  process.exitCode = 1;
});
