import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serverSource = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
const serviceSource = await readFile(
  new URL("../src/modules/core/service.js", import.meta.url),
  "utf8"
);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

test("historical invite-token route authenticates and signs server-owned seven-day claims", () => {
  const route = sourceBetween(
    serverSource,
    "const historicalInviteTokenSessionId = idMatch(",
    "const historicalClaimSessionId = idMatch("
  );
  assert.match(route, /request\.method === "POST"/);
  assert.match(route, /await getAuthUser\(request\)/);
  assert.match(
    route,
    /const invitation = await assertHistoricalSessionInviteAllowed\(user, historicalInviteTokenSessionId\)/
  );
  assert.match(
    route,
    /const exp = Math\.floor\(Date\.now\(\) \/ 1000\) \+ HISTORICAL_INVITE_TOKEN_SECONDS/
  );
  assert.match(route, /historicalInviteTokenCodec\.sign\(\{[\s\S]*?sessionId: Number\(historicalInviteTokenSessionId\)[\s\S]*?inviterUserId: Number\(invitation\.organizerUserId\)[\s\S]*?exp[\s\S]*?\}\)/);
  assert.doesNotMatch(route, /body\.(?:sessionId|inviterUserId|exp)/);
  assert.match(serverSource, /const HISTORICAL_INVITE_TOKEN_SECONDS = 7 \* 24 \* 60 \* 60/);
});

test("historical claim route authenticates, verifies the dedicated token, and delegates", () => {
  const route = sourceBetween(
    serverSource,
    "const historicalClaimSessionId = idMatch(",
    "const sessionNpcRolesId = idMatch("
  );
  assert.match(route, /request\.method === "POST"/);
  assert.match(route, /const user = await getAuthUser\(request\)/);
  assert.match(
    route,
    /const historicalInviteClaims = historicalInviteTokenCodec\.verify\(body\.inviteToken\)/
  );
  assert.match(
    route,
    /claimHistoricalSessionRole\([\s\S]*?user,[\s\S]*?historicalClaimSessionId,[\s\S]*?body,[\s\S]*?historicalInviteClaims[\s\S]*?\)/
  );
});

test("GET session keeps ordinary and historical invitation capabilities separate", () => {
  const route = sourceBetween(
    serverSource,
    "const sessionId = idMatch(url.pathname, /^\\/api\\/sessions\\/(\\d+)$/);",
    "if (request.method === \"PATCH\" && sessionId)"
  );
  assert.match(route, /url\.searchParams\.get\("inviteToken"\)/);
  assert.match(route, /url\.searchParams\.get\("historicalInviteToken"\)/);
  assert.match(route, /url\.searchParams\.has\("inviteToken"\)/);
  assert.match(route, /url\.searchParams\.has\("historicalInviteToken"\)/);
  assert.match(route, /if \(hasInviteToken && hasHistoricalInviteToken\) \{[\s\S]*?throw badRequest\(/);
  assert.match(
    route,
    /const historicalInviteClaims = historicalInviteToken[\s\S]*?historicalInviteTokenCodec\.verify\(historicalInviteToken\)[\s\S]*?: null/
  );
  assert.match(
    route,
    /getSessionForViewer\(sessionId, \{[\s\S]*?inviteClaims,[\s\S]*?historicalInviteClaims,[\s\S]*?authorTextReader/
  );
});

test("viewer service restricts ordinary previews to future sessions and historical previews to locked records", () => {
  const viewer = sourceBetween(
    serviceSource,
    "export async function getSessionForViewer(id, options = {})",
    "export async function assertSessionJoinInviteAllowed"
  );
  assert.match(viewer, /const historicalInviteClaims = options\.historicalInviteClaims \|\| null/);
  assert.match(viewer, /currentSession\.session_purpose === "future_carpool"/);
  assert.match(viewer, /currentSession\.session_purpose === "historical_record"/);
  assert.match(viewer, /currentSession\.status === "locked"/);
  assert.match(viewer, /Number\(historicalInviteClaims\.sessionId\) === sessionId/);
  assert.match(
    viewer,
    /Number\(historicalInviteClaims\.inviterUserId\) === Number\(currentSession\.organizer_user_id\)/
  );
  assert.match(viewer, /"historical_invite_preview"/);
});
