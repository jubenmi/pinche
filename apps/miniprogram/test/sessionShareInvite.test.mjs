import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  historicalClaimRequest,
  historicalRoleClaimable,
  inviteQuery,
  inviteTokenState
} from "../src/utils/sessionShareInvite.js";

test("historical invitations use the dedicated query and seat-claim endpoint", () => {
  const query = inviteQuery({ mode: "historical", token: "history-token" });
  const request = historicalClaimRequest({
    sessionId: 42,
    inviteToken: "history-token",
    role: { boardType: "seat", seatId: 8 }
  });

  assert.equal(query, "?historicalInviteToken=history-token");
  assert.deepEqual(request, {
    url: "/api/sessions/42/historical-claims",
    method: "POST",
    data: { inviteToken: "history-token", seatId: 8 }
  });
  for (const forbiddenPath of ["/api/signups", "/session-seats/", "/session-npc-roles/"]) {
    assert.doesNotMatch(query, new RegExp(forbiddenPath));
    assert.doesNotMatch(JSON.stringify(request), new RegExp(forbiddenPath));
  }
});

test("historical NPC claims use the same dedicated endpoint with one NPC target", () => {
  const request = historicalClaimRequest({
    sessionId: 42,
    inviteToken: "history-token",
    role: { boardType: "npc", id: 9 }
  });

  assert.deepEqual(request, {
    url: "/api/sessions/42/historical-claims",
    method: "POST",
    data: { inviteToken: "history-token", npcRoleId: 9 }
  });
  for (const forbiddenPath of ["/api/signups", "/session-seats/", "/session-npc-roles/"]) {
    assert.doesNotMatch(JSON.stringify(request), new RegExp(forbiddenPath));
  }
});

test("normal invitations retain the ordinary invite-token query", () => {
  assert.equal(
    inviteQuery({ mode: "normal", token: "future-token" }),
    "?inviteToken=future-token"
  );
});

test("invitation queries encode special characters", () => {
  assert.equal(
    inviteQuery({ mode: "historical", token: "history +/?" }),
    "?historicalInviteToken=history%20%2B%2F%3F"
  );
});

test("invite token state detects dual keys and empty historical capabilities by presence", () => {
  assert.deepEqual(
    inviteTokenState({ inviteToken: "", historicalInviteToken: "history-token" }),
    {
      inviteToken: "",
      historicalInviteToken: "history-token",
      historicalCapabilitySupplied: true,
      invalid: true
    }
  );
  assert.deepEqual(
    inviteTokenState({ historicalInviteToken: "" }),
    {
      inviteToken: "",
      historicalInviteToken: "",
      historicalCapabilitySupplied: true,
      invalid: true
    }
  );
  assert.deepEqual(
    inviteTokenState({ historicalInviteToken: "   " }),
    {
      inviteToken: "",
      historicalInviteToken: "",
      historicalCapabilitySupplied: true,
      invalid: true
    }
  );
  assert.deepEqual(
    inviteTokenState({ inviteToken: "future-token" }),
    {
      inviteToken: "future-token",
      historicalInviteToken: "",
      historicalCapabilitySupplied: false,
      invalid: false
    }
  );
});

test("historical claims reject malformed local role data", () => {
  const input = { sessionId: 42, inviteToken: "history-token" };

  assert.throws(
    () => historicalClaimRequest({ ...input, role: { boardType: "seat" } }),
    TypeError
  );
  assert.throws(
    () => historicalClaimRequest({ ...input, role: { boardType: "npc" } }),
    TypeError
  );
  assert.throws(
    () => historicalClaimRequest({ ...input, role: { boardType: "seat", seatId: 8, npcRoleId: 9 } }),
    TypeError
  );
  assert.throws(
    () => historicalClaimRequest({
      ...input,
      role: { boardType: "npc", id: 9, npcRoleId: 10 }
    }),
    TypeError
  );
});

test("historical role claimability ignores ordinary NPC join settings", () => {
  assert.equal(
    historicalRoleClaimable({
      hasHistoricalToken: true,
      occupied: false,
      viewerHasRole: false,
      viewerIsOrganizer: false,
      npcJoinEnabled: false
    }),
    true
  );
});

test("historical roles are read-only without every dedicated claim precondition", () => {
  const base = {
    hasHistoricalToken: true,
    occupied: false,
    viewerHasRole: false,
    viewerIsOrganizer: false
  };

  assert.equal(historicalRoleClaimable({ ...base, viewerIsOrganizer: true }), false);
  assert.equal(historicalRoleClaimable({ ...base, viewerHasRole: true }), false);
  assert.equal(historicalRoleClaimable({ ...base, hasHistoricalToken: false }), false);
  assert.equal(historicalRoleClaimable({ ...base, occupied: true }), false);
});

test("historical share cards consume sanitized NPC occupancy and redirect members independently of entry", async () => {
  const source = await readFile(
    new URL("../src/pages/session/share.vue", import.meta.url),
    "utf8"
  );

  assert.match(source, /role\.is_bound/);
  assert.match(source, /role\.has_pending_signup/);

  const redirectStart = source.indexOf("    redirectHistoricalMemberIfNeeded() {");
  const redirectEnd = source.indexOf("\n    },", redirectStart);
  assert.notEqual(redirectStart, -1);
  const redirectHelper = source.slice(redirectStart, redirectEnd);
  assert.match(redirectHelper, /this\.isHistorical/);
  assert.match(redirectHelper, /this\.viewerIsOrganizer/);
  assert.doesNotMatch(redirectHelper, /this\.isAlbumEntry/);
});

test("historical submit paths branch before ordinary join settings and gates", async () => {
  const source = await readFile(
    new URL("../src/pages/session/share.vue", import.meta.url),
    "utf8"
  );
  const confirmStart = source.indexOf("    async confirmRole(");
  const confirmEnd = source.indexOf("    async claimSeat(", confirmStart);
  const confirmRole = source.slice(confirmStart, confirmEnd);
  assert.ok(confirmRole.indexOf("this.isHistorical") < confirmRole.indexOf("requirePhone"));

  const npcStart = source.indexOf("    async chooseNpcRole(");
  const npcEnd = source.indexOf("    showShareMenus(", npcStart);
  const chooseNpcRole = source.slice(npcStart, npcEnd);
  assert.ok(chooseNpcRole.indexOf("this.isHistorical") < chooseNpcRole.indexOf("this.npcSelfJoinEnabled"));
  assert.ok(chooseNpcRole.indexOf("this.isHistorical") < chooseNpcRole.indexOf("requirePhone"));

  const historicalClaimStart = source.indexOf("    async claimHistoricalRole(");
  const historicalClaimEnd = source.indexOf("\n    },", historicalClaimStart);
  assert.notEqual(historicalClaimStart, -1);
  const historicalClaim = source.slice(historicalClaimStart, historicalClaimEnd);
  assert.match(historicalClaim, /historicalClaimRequest/);
  assert.doesNotMatch(
    historicalClaim,
    /\/api\/signups|\/session-seats\/|\/session-npc-roles\/|requestSignupReviewedSubscription|requestSessionRescheduledSubscription/
  );
});

test("historical share integration disables unsafe sharing and branches before ordinary seat copy", async () => {
  const source = await readFile(
    new URL("../src/pages/session/share.vue", import.meta.url),
    "utf8"
  );

  const onLoadStart = source.indexOf("  async onLoad(options) {");
  const onLoadEnd = source.indexOf("  onUnload()", onLoadStart);
  const onLoad = source.slice(onLoadStart, onLoadEnd);
  assert.match(onLoad, /inviteTokenState\(options\)/);
  assert.match(onLoad, /if \(this\.sessionId\) \{\s*this\.hideShareMenus\(\);\s*\}/);
  assert.match(onLoad, /this\.hideShareMenus\(\)/);

  const onShareStart = source.indexOf("  onShareAppMessage() {");
  const onShareEnd = source.indexOf("  methods:", onShareStart);
  const onShare = source.slice(onShareStart, onShareEnd);
  assert.doesNotMatch(onShare, /const inviteQuery\s*=/);

  const chooseSeatStart = source.indexOf("    async chooseRole(");
  const chooseSeatEnd = source.indexOf("    handleSharedRoleTap(", chooseSeatStart);
  const chooseSeat = source.slice(chooseSeatStart, chooseSeatEnd);
  assert.ok(chooseSeat.indexOf("this.isHistorical") < chooseSeat.indexOf("targetRole.taken"));

  const menuStart = source.indexOf("    showShareMenus() {");
  const menuEnd = source.indexOf("    seatTypeLabel(", menuStart);
  const menu = source.slice(menuStart, menuEnd);
  assert.match(menu, /this\.canShareCurrentSession/);
  const hideMenuStart = source.indexOf("    hideShareMenus() {");
  const hideMenuEnd = source.indexOf("    showShareMenus() {", hideMenuStart);
  assert.match(
    source.slice(hideMenuStart, hideMenuEnd),
    /"shareAppMessage", "shareTimeline"/
  );

  const claimStart = source.indexOf("    async claimHistoricalRole(");
  const claimEnd = source.indexOf("    async claimSeat(", claimStart);
  const claim = source.slice(claimStart, claimEnd);
  assert.match(claim, /this\.historicalInviteToken = ""/);
  assert.match(claim, /this\.hideShareMenus\(\)/);
  assert.match(claim, /statusCode === 409[\s\S]*loadPublishedSession/);

  assert.match(source, /this\.note = this\.isHistorical\s*\? "历史车局补录"/);
  assert.match(source, /sessionPurpose: session\.session_purpose/);

  const loginStart = source.indexOf("    async ensureSeatSelectionLogin(");
  const loginEnd = source.indexOf("    async loadPublishedSession(", loginStart);
  const login = source.slice(loginStart, loginEnd);
  assert.match(login, /if \(this\.navigatingAlbum\) \{\s*return null;/);

  const loadStart = source.indexOf("    async loadPublishedSession(");
  const loadEnd = source.indexOf("    async prepareJoinInviteToken(", loadStart);
  const load = source.slice(loadStart, loadEnd);
  assert.match(
    load,
    /const historicalRequest = [\s\S]*this\.historicalCapabilitySupplied[\s\S]*this\.historicalInviteToken[\s\S]*this\.isHistorical/
  );
  assert.match(load, /catch \(error\)[\s\S]*if \(historicalRequest\)/);

  assert.match(source, /v-if="isHistorical" class="flow-top historical"/);
  assert.match(source, /\.flow-top\.historical\s*\{[\s\S]*display:\s*block;/);
});
