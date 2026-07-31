import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CREATE_FLOW_KEY,
  clearCreateFlow,
  readCreateFlow,
  writeCreateFlow
} from "../src/utils/createFlow.js";
import * as shareInviteHelpers from "../src/utils/sessionShareInvite.js";
import {
  historicalClaimRequest,
  historicalRoleClaimable,
  inviteQuery,
  inviteTokenState,
  sessionShareReady
} from "../src/utils/sessionShareInvite.js";

async function loadSharePageComponent(dependencies = {}) {
  const source = await readFile(
    new URL("../src/pages/session/share.vue", import.meta.url),
    "utf8"
  );
  const script = source.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "share page script is available");
  const runnable = script
    .replace(/import[\s\S]*?from\s+"[^"]+";\s*/g, "")
    .replace("export default", "return");
  const uni = {
    $on() {},
    $off() {},
    hideShareMenu() {},
    showShareMenu() {},
    removeStorageSync() {},
    setStorageSync() {}
  };
  const defaults = {
    AuthIdentityBar: {},
    RoleSeatBoard: {},
    FeedbackHost: {},
    formatBeijingDateTime: () => "",
    isHistoricalSession: (session) => session?.session_purpose === "historical_record",
    AUTH_CHANGE_EVENT: "test-auth-change",
    dataOf: (value) => value,
    ensureLoggedIn: async () => null,
    getCurrentUser: () => ({ user: null }),
    getToken: () => "",
    request: async () => ({}),
    CREATE_FLOW_KEY,
    clearCreateFlow: () => {},
    displayTags: () => "",
    flowToQuery: () => "",
    isCrossCast: () => false,
    isRoleSelected: () => false,
    isSameRole: (left, right) => left?.id === right?.id,
    mergeSelectedRoles: (...groups) => groups.flat(),
    queryToFlow: () => ({}),
    readCreateFlow: () => ({}),
    roleGenderSymbol: () => "",
    roleOptionsFromFlow: () => [],
    writeCreateFlow: (value) => value,
    showWechatShareMenus: () => {},
    isConfirmedSessionMember: () => false,
    requestSubscriptionAfterConfirmedJoin: async () => {},
    requestSessionRescheduledSubscription: async () => {},
    requestSignupReviewedSubscription: async () => {},
    showModal: async () => ({ confirm: false }),
    showToast: () => {},
    uni,
    ...shareInviteHelpers,
    captureRoleSelectionOperation: shareInviteHelpers.beginRoleSelectionOperation,
    releaseRoleSelectionOperation: shareInviteHelpers.finishRoleSelectionOperation,
    rebaseCapturedRoleSelectionOperation: shareInviteHelpers.rebaseRoleSelectionOperation,
    capturedRoleSelectionOperationIsCurrent:
      shareInviteHelpers.roleSelectionOperationIsCurrent,
    ...dependencies
  };
  return new Function(
    "dependencies",
    `with (dependencies) { ${runnable} }`
  )(defaults);
}

function instantiateSharePage(component) {
  const page = { ...component.data() };
  Object.assign(page, component.methods);
  for (const [name, getter] of Object.entries(component.computed)) {
    Object.defineProperty(page, name, {
      configurable: true,
      get() {
        return getter.call(page);
      }
    });
  }
  return page;
}

function installFutureProjection(page) {
  page.pageActive = true;
  page.pageGeneration = Math.max(page.pageGeneration, 1);
  page.sessionId = "42";
  page.session = {
    id: 42,
    session_purpose: "future_carpool",
    access_scope: "member",
    status: "recruiting",
    join_policy: "direct",
    join_phone_required: false,
    npc_join_enabled: true,
    seats: [],
    session_npc_roles: [
      {
        id: 9,
        name: "主持人",
        status: "active",
        role_gender: "unlimited",
        bound_user_id: 0,
        pending_signup_user_id: 0
      }
    ]
  };
  page.sessionLoadReady = true;
  page.inviteToken = "artificially-restored-ordinary-token";
  page.historicalInviteToken = "";
  page.roleOptions = [
    {
      id: "8",
      seatId: 8,
      name: "玩家位",
      status: "open",
      roleGender: "unlimited",
      confirmedUserId: ""
    }
  ];
  page.currentUserId = 17;
  page.currentUserGender = "male";
  page.currentAuthPrincipal = "user:17";
}

function installCurrentRoleOperation(page, operationId = 1) {
  page.roleSelectionOperationId = operationId;
  page.activeRoleSelectionOperationId = operationId;
  page.roleSelectionSubmitting = true;
  return {
    operationId,
    sessionId: String(page.sessionId),
    principal: page.currentAuthPrincipal,
    snapshot: shareInviteHelpers.pageRequestSnapshot(page)
  };
}

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

test("malformed invite routes destroy capabilities and auth changes cannot request", async () => {
  for (const malformedCase of [
    {
      name: "dual token",
      options: {
        id: "42",
        inviteToken: "future-token",
        historicalInviteToken: "history-token"
      }
    },
    {
      name: "empty historical key",
      options: { id: "42", historicalInviteToken: "" }
    }
  ]) {
    let auth = { user: null };
    let token = "";
    const requests = [];
    const component = await loadSharePageComponent({
      getCurrentUser: () => auth,
      getToken: () => token,
      request: async (input) => {
        requests.push(input);
        throw Object.assign(new Error("unexpected request"), { statusCode: 500 });
      }
    });
    const page = instantiateSharePage(component);

    await component.onLoad.call(page, malformedCase.options);
    auth = { user: { id: 17, gender: "male" } };
    token = "authenticated-token";
    await page.handleAuthChange(auth);
    await page.loadPublishedSession(page.sessionId);

    assert.deepEqual(
      {
        inviteToken: page.inviteToken,
        historicalInviteToken: page.historicalInviteToken,
        malformedInviteLink: page.malformedInviteLink,
        invalidInviteLink: page.invalidInviteLink,
        requestCount: requests.length
      },
      {
        inviteToken: "",
        historicalInviteToken: "",
        malformedInviteLink: true,
        invalidInviteLink: true,
        requestCount: 0
      },
      malformedCase.name
    );
  }
});

test("invalid or malformed historical capabilities never make a role claimable", () => {
  const otherwiseClaimable = {
    hasHistoricalToken: true,
    occupied: false,
    viewerHasRole: false,
    viewerIsOrganizer: false
  };
  assert.equal(
    historicalRoleClaimable({
      ...otherwiseClaimable,
      invalidInviteLink: true
    }),
    false
  );
  assert.equal(
    historicalRoleClaimable({
      ...otherwiseClaimable,
      malformedInviteLink: true
    }),
    false
  );
});

test("malformed invite latches block direct historical claim leaves", async () => {
  for (const malformedCase of [
    {
      name: "dual token",
      options: {
        id: "42",
        inviteToken: "future-token",
        historicalInviteToken: "history-token"
      }
    },
    {
      name: "empty historical key",
      options: { id: "42", historicalInviteToken: "" }
    }
  ]) {
    const requests = [];
    const component = await loadSharePageComponent({
      request: async (input) => {
        requests.push(input);
        throw new Error("unexpected request");
      }
    });
    const page = instantiateSharePage(component);
    await component.onLoad.call(page, malformedCase.options);

    page.session = {
      id: 42,
      session_purpose: "historical_record",
      organizer_user_id: 99
    };
    page.historicalInviteToken = "artificially-restored-token";
    page.currentAuthPrincipal = "user:17";
    page.roleSelectionOperationId = 1;
    page.activeRoleSelectionOperationId = 1;
    page.roleSelectionSubmitting = true;
    const operation = {
      operationId: 1,
      sessionId: "42",
      principal: "user:17",
      snapshot: shareInviteHelpers.pageRequestSnapshot(page)
    };

    assert.equal(
      page.isRoleClaimable({ status: "open" }),
      false,
      `${malformedCase.name} role`
    );
    await page.claimHistoricalRole(
      { boardType: "seat", seatId: 8 },
      operation
    );
    assert.equal(requests.length, 0, `${malformedCase.name} leaf`);
  }
});

test("malformed invite latches block reconstructed ordinary seat and NPC actions", async () => {
  for (const malformedCase of [
    {
      name: "dual token",
      options: {
        id: "42",
        inviteToken: "ordinary-token",
        historicalInviteToken: "history-token"
      }
    },
    {
      name: "ordinary token with empty historical key",
      options: {
        id: "42",
        inviteToken: "ordinary-token",
        historicalInviteToken: ""
      }
    }
  ]) {
    const auth = {
      token: "authenticated-token",
      user: { id: 17, gender: "male" }
    };
    const requests = [];
    let authCallCount = 0;
    const component = await loadSharePageComponent({
      ensureLoggedIn: async () => {
        authCallCount += 1;
        return auth;
      },
      getCurrentUser: () => auth,
      getToken: () => auth.token,
      request: async (input) => {
        requests.push(input);
        throw new Error("unexpected ordinary request");
      }
    });

    const seatPage = instantiateSharePage(component);
    await component.onLoad.call(seatPage, malformedCase.options);
    installFutureProjection(seatPage);
    await seatPage.claimSeat(
      { boardType: "seat", seatId: 8 },
      installCurrentRoleOperation(seatPage)
    );
    const seatRequestCount = requests.length;
    requests.length = 0;

    const seatChooserPage = instantiateSharePage(component);
    await component.onLoad.call(seatChooserPage, malformedCase.options);
    installFutureProjection(seatChooserPage);
    authCallCount = 0;
    await seatChooserPage.chooseRole({
      boardType: "seat",
      id: "8",
      seatId: 8
    });
    const seatChooserRequestCount = requests.length;
    const seatChooserAuthCallCount = authCallCount;
    requests.length = 0;

    const npcPage = instantiateSharePage(component);
    await component.onLoad.call(npcPage, malformedCase.options);
    installFutureProjection(npcPage);
    await npcPage.chooseNpcRole({ boardType: "npc", id: 9 });
    assert.deepEqual(
      {
        seatRequestCount,
        seatChooserRequestCount,
        seatChooserAuthCallCount,
        npcRequestCount: requests.length
      },
      {
        seatRequestCount: 0,
        seatChooserRequestCount: 0,
        seatChooserAuthCallCount: 0,
        npcRequestCount: 0
      },
      malformedCase.name
    );
  }
});

test("valid future seat and NPC actions retain their ordinary endpoints", async () => {
  const auth = {
    token: "authenticated-token",
    user: { id: 17, gender: "male" }
  };

  const seatRequests = [];
  const seatComponent = await loadSharePageComponent({
    ensureLoggedIn: async () => auth,
    getCurrentUser: () => auth,
    getToken: () => auth.token,
    request: async (input) => {
      seatRequests.push(input);
      throw new Error("stop after endpoint capture");
    }
  });
  const seatPage = instantiateSharePage(seatComponent);
  installFutureProjection(seatPage);
  seatPage.invalidInviteLink = false;
  seatPage.malformedInviteLink = false;
  await seatPage.claimSeat(
    { boardType: "seat", seatId: 8 },
    installCurrentRoleOperation(seatPage)
  );
  assert.deepEqual(
    seatRequests.map((input) => input.url),
    ["/api/session-seats/8/claim"]
  );
  seatRequests.length = 0;
  const seatChooserPage = instantiateSharePage(seatComponent);
  installFutureProjection(seatChooserPage);
  seatChooserPage.invalidInviteLink = false;
  seatChooserPage.malformedInviteLink = false;
  await seatChooserPage.chooseRole({
    boardType: "seat",
    id: "8",
    seatId: 8
  });
  assert.deepEqual(
    seatRequests.map((input) => input.url),
    ["/api/session-seats/8/claim"]
  );

  const npcRequests = [];
  const npcComponent = await loadSharePageComponent({
    ensureLoggedIn: async () => auth,
    getCurrentUser: () => auth,
    getToken: () => auth.token,
    request: async (input) => {
      npcRequests.push(input);
      throw new Error("stop after endpoint capture");
    }
  });
  const npcPage = instantiateSharePage(npcComponent);
  installFutureProjection(npcPage);
  npcPage.invalidInviteLink = false;
  npcPage.malformedInviteLink = false;
  await npcPage.chooseNpcRole({ boardType: "npc", id: 9 });
  assert.deepEqual(
    npcRequests.map((input) => input.url),
    ["/api/session-npc-roles/9/claim"]
  );
});

test("ordinary NPC submission rechecks invite safety after awaited confirmations", async () => {
  const auth = {
    token: "authenticated-token",
    user: { id: 17, gender: "male" }
  };
  for (const transition of [
    {
      name: "invalid invite",
      apply(page) {
        page.invalidInviteLink = true;
      }
    },
    {
      name: "malformed invite",
      apply(page) {
        page.malformedInviteLink = true;
      }
    },
    {
      name: "historical projection",
      apply(page) {
        page.session = {
          ...page.session,
          session_purpose: "historical_record"
        };
      }
    }
  ]) {
    const requests = [];
    const component = await loadSharePageComponent({
      ensureLoggedIn: async () => auth,
      getCurrentUser: () => auth,
      getToken: () => auth.token,
      request: async (input) => {
        requests.push(input);
        throw new Error("unexpected ordinary NPC request");
      }
    });
    const page = instantiateSharePage(component);
    installFutureProjection(page);
    page.invalidInviteLink = false;
    page.malformedInviteLink = false;
    page.confirmCrossCastRole = async () => {
      transition.apply(page);
      return true;
    };

    await page.chooseNpcRole({ boardType: "npc", id: 9 });
    assert.equal(requests.length, 0, transition.name);
  }
});

test("share page wires malformed invite defenses through load, role, and claim paths", async () => {
  const source = await readFile(
    new URL("../src/pages/session/share.vue", import.meta.url),
    "utf8"
  );
  const onLoadStart = source.indexOf("  async onLoad(options) {");
  const onLoadEnd = source.indexOf("  onUnload()", onLoadStart);
  const onLoad = source.slice(onLoadStart, onLoadEnd);
  assert.match(
    onLoad,
    /if \(tokenState\.invalid\) \{\s*this\.inviteToken = "";\s*this\.historicalInviteToken = "";\s*this\.malformedInviteLink = true;\s*this\.invalidInviteLink = true;/
  );

  const authStart = source.indexOf("    handleAuthChange(auth");
  const authEnd = source.indexOf("\n    },", authStart);
  const auth = source.slice(authStart, authEnd);
  assert.ok(
    auth.indexOf("if (this.malformedInviteLink)") >= 0 &&
      auth.indexOf("if (this.malformedInviteLink)") <
        auth.indexOf("this.clearIdentityBoundProjection()")
  );

  const reloadStart = source.indexOf("    async reloadSessionAfterAuth() {");
  const reloadEnd = source.indexOf("\n    },", reloadStart);
  const reload = source.slice(reloadStart, reloadEnd);
  assert.ok(
    reload.indexOf("this.malformedInviteLink") >= 0 &&
      reload.indexOf("this.malformedInviteLink") <
        reload.indexOf("drainLatestAuthRefresh")
  );

  const loadStart = source.indexOf("    async loadPublishedSession(");
  const loadEnd = source.indexOf("    async prepareJoinInviteToken(", loadStart);
  const load = source.slice(loadStart, loadEnd);
  assert.ok(
    load.indexOf("if (this.malformedInviteLink)") >= 0 &&
      load.indexOf("if (this.malformedInviteLink)") <
        load.indexOf("await request")
  );

  let claimabilityOffset = 0;
  let claimabilityCallCount = 0;
  while (true) {
    const start = source.indexOf("historicalRoleClaimable({", claimabilityOffset);
    if (start < 0) {
      break;
    }
    const call = source.slice(start, source.indexOf("})", start) + 2);
    assert.match(call, /invalidInviteLink: this\.invalidInviteLink/);
    assert.match(call, /malformedInviteLink: this\.malformedInviteLink/);
    claimabilityCallCount += 1;
    claimabilityOffset = start + 1;
  }
  assert.equal(claimabilityCallCount, 3);

  const claimStart = source.indexOf("    async claimHistoricalRole(");
  const claimEnd = source.indexOf("    async claimSeat(", claimStart);
  const claim = source.slice(claimStart, claimEnd);
  const invalidGuard = claim.indexOf("this.invalidInviteLink");
  const malformedGuard = claim.indexOf("this.malformedInviteLink");
  const requestStart = claim.indexOf("await request(historicalClaimRequest");
  assert.ok(invalidGuard >= 0 && invalidGuard < requestStart);
  assert.ok(malformedGuard >= 0 && malformedGuard < requestStart);

  const seatStart = source.indexOf("    async claimSeat(");
  const seatEnd = source.indexOf("    async chooseNpcRole(", seatStart);
  const seat = source.slice(seatStart, seatEnd);
  assert.match(
    seat,
    /if \(\s*!this\.roleSelectionOperationIsCurrent\(operation\) \|\|\s*this\.invalidInviteLink \|\|\s*this\.malformedInviteLink \|\|\s*this\.isHistorical\s*\) \{\s*return;/
  );
  assert.ok(seat.indexOf("this.invalidInviteLink") < seat.indexOf("await request"));

  const chooseSeatStart = source.indexOf("    async chooseRole(");
  const chooseSeatEnd = source.indexOf("    handleSharedRoleTap(", chooseSeatStart);
  const chooseSeat = source.slice(chooseSeatStart, chooseSeatEnd);
  assert.match(
    chooseSeat,
    /async chooseRole\(role\) \{\s*if \(this\.invalidInviteLink \|\| this\.malformedInviteLink\) \{\s*return;\s*\}\s*if \(this\.isHistorical\)/
  );
  assert.ok(
    chooseSeat.indexOf("this.invalidInviteLink") <
      chooseSeat.indexOf("this.beginRoleSelectionOperation()")
  );

  const npcStart = source.indexOf("    async chooseNpcRole(");
  const npcEnd = source.indexOf("    hideShareMenus(", npcStart);
  const npc = source.slice(npcStart, npcEnd);
  assert.match(
    npc,
    /async chooseNpcRole\(npcRole\) \{\s*if \(this\.invalidInviteLink \|\| this\.malformedInviteLink\) \{\s*return;\s*\}\s*if \(this\.isHistorical\) \{\s*return this\.chooseHistoricalRole\(npcRole\);/
  );
  assert.ok(
    npc.indexOf("this.invalidInviteLink") <
      npc.indexOf("this.beginRoleSelectionOperation()")
  );
  const npcLastLogin = npc.lastIndexOf("await this.ensureSeatSelectionLogin");
  const npcRequest = npc.indexOf("const response = await request", npcLastLogin);
  assert.ok(npcLastLogin >= 0 && npcRequest > npcLastLogin);
  for (const guard of [
    "this.invalidInviteLink",
    "this.malformedInviteLink",
    "this.isHistorical"
  ]) {
    const guardIndex = npc.indexOf(guard, npcLastLogin);
    assert.ok(guardIndex > npcLastLogin && guardIndex < npcRequest, guard);
  }
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

test("persisted sessions cannot share before their load resolves", () => {
  assert.equal(
    sessionShareReady({ sessionId: 42, sessionLoadReady: false }),
    false
  );
});

test("local future flow remains shareable without a persisted session", () => {
  assert.equal(
    sessionShareReady({ sessionId: "", sessionLoadReady: false }),
    true
  );
});

test("loaded public and invite previews are shareable", () => {
  assert.equal(
    sessionShareReady({
      sessionId: 42,
      sessionLoadReady: true,
      isHistorical: false,
      accessScope: "public_preview"
    }),
    true
  );
  assert.equal(
    sessionShareReady({
      sessionId: 42,
      sessionLoadReady: true,
      isHistorical: false,
      accessScope: "invite_preview"
    }),
    true
  );
});

test("every loaded ordinary member view requires an invite token to share", () => {
  const base = {
    sessionId: 42,
    sessionLoadReady: true,
    isHistorical: false,
    accessScope: "member"
  };
  assert.equal(sessionShareReady(base), false);
  assert.equal(sessionShareReady({ ...base, inviteToken: "future-token" }), true);
});

test("loaded historical sessions require a dedicated token to share", () => {
  const base = { sessionId: 42, sessionLoadReady: true, isHistorical: true };
  assert.equal(sessionShareReady(base), false);
  assert.equal(sessionShareReady({ ...base, historicalInviteToken: "history-token" }), true);
});

test("organizer reload and mint recover historical sharing while malformed links stay disabled", () => {
  assert.equal(typeof shareInviteHelpers.historicalInviteRecoveryAllowed, "function");

  const organizerToken = "fresh-history-token";
  const recoveredAfterLoad = shareInviteHelpers.historicalInviteRecoveryAllowed({
    sessionLoaded: true,
    historicalInviteToken: organizerToken
  });
  const recoveredAfterMint = shareInviteHelpers.historicalInviteRecoveryAllowed({
    organizerTokenMinted: true,
    historicalInviteToken: organizerToken
  });
  assert.equal(recoveredAfterLoad, true);
  assert.equal(recoveredAfterMint, true);
  assert.equal(
    sessionShareReady({
      sessionId: 42,
      sessionLoadReady: true,
      invalidInviteLink: !recoveredAfterMint,
      isHistorical: true,
      historicalInviteToken: organizerToken
    }),
    true
  );

  const malformedRecovered = shareInviteHelpers.historicalInviteRecoveryAllowed({
    malformedInviteLink: true,
    sessionLoaded: true,
    organizerTokenMinted: true,
    historicalInviteToken: organizerToken
  });
  assert.equal(malformedRecovered, false);
  assert.equal(
    sessionShareReady({
      sessionId: 42,
      sessionLoadReady: true,
      invalidInviteLink: !malformedRecovered,
      isHistorical: true,
      historicalInviteToken: organizerToken
    }),
    false
  );
});

test("persisted future auth refresh drops identity A and reruns against identity B", async () => {
  assert.equal(typeof shareInviteHelpers.pageRequestSnapshot, "function");
  assert.equal(typeof shareInviteHelpers.pageRequestIsCurrent, "function");
  assert.equal(typeof shareInviteHelpers.runLatestAuthRefresh, "function");

  let state = {
    pageActive: true,
    pageGeneration: 7,
    authRevision: 1,
    sessionPurpose: "future_carpool"
  };
  let releaseIdentityA;
  const identityA = new Promise((resolve) => {
    releaseIdentityA = resolve;
  });
  const requestedRevisions = [];
  const appliedRevisions = [];
  const refresh = shareInviteHelpers.runLatestAuthRefresh({
    capture: () => shareInviteHelpers.pageRequestSnapshot(state),
    isCurrent: (snapshot) => shareInviteHelpers.pageRequestIsCurrent(state, snapshot),
    refresh: async (snapshot) => {
      requestedRevisions.push(snapshot.authRevision);
      if (snapshot.authRevision === 1) {
        await identityA;
      }
      if (shareInviteHelpers.pageRequestIsCurrent(state, snapshot)) {
        appliedRevisions.push(snapshot.authRevision);
      }
      return snapshot.authRevision;
    }
  });

  await Promise.resolve();
  state = { ...state, authRevision: 2 };
  releaseIdentityA();

  assert.equal(await refresh, 2);
  assert.deepEqual(requestedRevisions, [1, 2]);
  assert.deepEqual(appliedRevisions, [2]);
});

test("auth refresh drain services a revision arriving while the old promise closes", async () => {
  assert.equal(typeof shareInviteHelpers.drainLatestAuthRefresh, "function");
  let state = {
    pageActive: true,
    pageGeneration: 7,
    authRevision: 1,
    sessionId: 42
  };
  let activePromise = null;
  let releaseRevisionOne;
  const revisionOneGate = new Promise((resolve) => {
    releaseRevisionOne = resolve;
  });
  const requestedRevisions = [];
  const options = {
    capture: () => ({
      ...shareInviteHelpers.pageRequestSnapshot(state),
      sessionId: state.sessionId
    }),
    getActive: () => activePromise,
    setActive: (promise) => {
      activePromise = promise;
    },
    refresh: async (snapshot) => {
      requestedRevisions.push(snapshot.authRevision);
      if (snapshot.authRevision === 1) {
        await revisionOneGate;
      }
      return snapshot.authRevision;
    }
  };

  const firstCaller = shareInviteHelpers.drainLatestAuthRefresh(options);
  await Promise.resolve();
  releaseRevisionOne();
  state = { ...state, authRevision: 2 };
  const closingWindowCaller = shareInviteHelpers.drainLatestAuthRefresh(options);

  assert.equal(await firstCaller, 2);
  assert.equal(await closingWindowCaller, 2);
  assert.deepEqual(requestedRevisions, [1, 2]);
  assert.equal(activePromise, null);
});

test("page generation invalidates responses and delayed menu callbacks after unload", () => {
  assert.equal(typeof shareInviteHelpers.pageRequestSnapshot, "function");
  assert.equal(typeof shareInviteHelpers.pageRequestIsCurrent, "function");

  const active = { pageActive: true, pageGeneration: 3, authRevision: 4 };
  const requestSnapshot = shareInviteHelpers.pageRequestSnapshot(active);
  assert.equal(shareInviteHelpers.pageRequestIsCurrent(active, requestSnapshot), true);
  assert.equal(
    shareInviteHelpers.pageRequestIsCurrent(
      { ...active, pageActive: false, pageGeneration: 4 },
      requestSnapshot
    ),
    false
  );
  assert.equal(
    shareInviteHelpers.pageRequestIsCurrent(
      { ...active, authRevision: 5 },
      requestSnapshot
    ),
    false
  );
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
  assert.match(
    onLoad,
    /if \(tokenState\.invalid\) \{[\s\S]*?this\.malformedInviteLink = true;\s*this\.invalidInviteLink = true;/
  );

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
  assert.match(load, /historicalInviteRecoveryAllowed\(\{[\s\S]*sessionLoaded: true/);

  const prepareStart = source.indexOf("    async prepareJoinInviteToken(");
  const prepareEnd = source.indexOf("\n    },", prepareStart);
  const prepare = source.slice(prepareStart, prepareEnd);
  assert.match(
    prepare,
    /historicalInviteRecoveryAllowed\(\{[\s\S]*organizerTokenMinted: true/
  );

  assert.match(source, /v-if="isHistorical" class="flow-top historical"/);
  assert.match(source, /\.flow-top\.historical\s*\{[\s\S]*display:\s*block;/);
});

test("persisted share page remains disabled until a successful session GET", async () => {
  const source = await readFile(
    new URL("../src/pages/session/share.vue", import.meta.url),
    "utf8"
  );

  assert.match(source, /sessionLoadReady:\s*false/);
  assert.match(source, /canShareCurrentSession\(\) \{[\s\S]*sessionShareReady\(/);

  const onShareStart = source.indexOf("  onShareAppMessage() {");
  const onShareEnd = source.indexOf("  methods:", onShareStart);
  assert.match(
    source.slice(onShareStart, onShareEnd),
    /if \(!this\.canShareCurrentSession\) \{\s*return undefined;/
  );

  const loadStart = source.indexOf("    async loadPublishedSession(");
  const loadEnd = source.indexOf("    async prepareJoinInviteToken(", loadStart);
  const load = source.slice(loadStart, loadEnd);
  assert.match(
    load,
    /this\.sessionLoadReady = false;\s*this\.hideShareMenus\(\);/
  );
  assert.match(
    load,
    /writeCreateFlow\(\{[\s\S]*?\}\);[\s\S]*?catch \(error\)[\s\S]*?this\.sessionLoadReady = true;/
  );
  const catchStart = load.lastIndexOf("      } catch (error) {");
  assert.notEqual(catchStart, -1);
  assert.doesNotMatch(load.slice(catchStart), /sessionLoadReady = true/);
  assert.match(load.slice(catchStart), /this\.sessionLoadReady = false/);
});

test("share page enforces ordinary tokens, historical identity refresh, and a pre-await latch", async () => {
  const source = await readFile(
    new URL("../src/pages/session/share.vue", import.meta.url),
    "utf8"
  );

  assert.match(
    source,
    /accessScope: this\.session\.access_scope/
  );
  const shareReadyStart = source.indexOf("    canShareCurrentSession() {");
  const shareReadyEnd = source.indexOf("    pageTitle()", shareReadyStart);
  const shareReady = source.slice(shareReadyStart, shareReadyEnd);
  assert.match(shareReady, /accessScope: this\.session\.access_scope/);
  assert.match(shareReady, /inviteToken: this\.inviteToken/);

  const roleNameStart = source.indexOf("    roleName() {");
  const roleNameEnd = source.indexOf("    availableCount()", roleNameStart);
  const roleName = source.slice(roleNameStart, roleNameEnd);
  assert.match(roleName, /if \(this\.isHistorical\) \{\s*return "待补认";/);
  assert.ok(roleName.indexOf("this.isHistorical") < roleName.indexOf("this.selectedRoles[0]"));

  assert.match(source, /AUTH_CHANGE_EVENT, this\.handleAuthChange/);
  assert.match(source, /authRefreshPromise:\s*null/);
  const authRefreshStart = source.indexOf("    async reloadSessionAfterAuth() {");
  const authRefreshEnd = source.indexOf("\n    },", authRefreshStart);
  assert.notEqual(authRefreshStart, -1);
  const authRefresh = source.slice(authRefreshStart, authRefreshEnd);
  assert.match(authRefresh, /this\.authRefreshPromise/);
  assert.match(authRefresh, /this\.loadPublishedSession\(this\.sessionId\)/);
  assert.match(authRefresh, /this\.prepareJoinInviteToken\(\)/);
  const authHandlerStart = source.indexOf("    handleAuthChange(auth");
  const authHandlerEnd = source.indexOf("\n    },", authHandlerStart);
  const authHandler = source.slice(authHandlerStart, authHandlerEnd);
  assert.match(authHandler, /this\.refreshCurrentUserGender\(currentAuth\)/);
  assert.match(authHandler, /this\.reloadSessionAfterAuth\(\)/);
  assert.doesNotMatch(authHandler, /historicalSession|this\.isHistorical/);

  const historicalChoiceStart = source.indexOf("    async chooseHistoricalRole(");
  const historicalChoiceEnd = source.indexOf("\n    },", historicalChoiceStart);
  assert.notEqual(historicalChoiceStart, -1);
  const historicalChoice = source.slice(historicalChoiceStart, historicalChoiceEnd);
  assert.ok(
    historicalChoice.indexOf("this.beginRoleSelectionOperation(") <
      historicalChoice.indexOf("await this.ensureSeatSelectionLogin")
  );
  assert.match(
    historicalChoice,
    /finally \{\s*this\.finishRoleSelectionOperation\(operationEntry\.operationId\);/
  );

  for (const methodName of ["chooseRole", "chooseNpcRole"]) {
    const start = source.indexOf(`    async ${methodName}(`);
    const end = source.indexOf("\n    },", start);
    const method = source.slice(start, end);
    assert.ok(method.indexOf("this.isHistorical") < method.indexOf("await this.ensureSeatSelectionLogin"));
    assert.match(method, /this\.chooseHistoricalRole\(/);
    assert.ok(
      method.indexOf("this.beginRoleSelectionOperation(") <
        method.indexOf("await this.ensureSeatSelectionLogin")
    );
  }
});

test("share page gates async identity work and menu callbacks by page generation", async () => {
  const source = await readFile(
    new URL("../src/pages/session/share.vue", import.meta.url),
    "utf8"
  );

  assert.match(source, /pageActive:\s*false/);
  assert.match(source, /pageGeneration:\s*0/);
  assert.match(source, /authRevision:\s*0/);

  const onLoadStart = source.indexOf("  async onLoad(options) {");
  const onLoadEnd = source.indexOf("  onUnload()", onLoadStart);
  const onLoad = source.slice(onLoadStart, onLoadEnd);
  assert.match(onLoad, /this\.pageActive = true/);
  assert.match(onLoad, /this\.pageGeneration \+= 1/);
  assert.match(
    onLoad,
    /await this\.loadPublishedSession\(this\.sessionId\)[\s\S]*if \(!loaded \|\| !this\.pageActive \|\| this\.navigatingAlbum\) \{\s*return;/
  );
  assert.match(
    onLoad,
    /await this\.prepareJoinInviteToken\(\)[\s\S]*if \(!inviteReady \|\| !this\.pageActive \|\| this\.navigatingAlbum\) \{\s*return;/
  );

  const unloadStart = source.indexOf("  onUnload() {");
  const unloadEnd = source.indexOf("  onShareAppMessage()", unloadStart);
  const unload = source.slice(unloadStart, unloadEnd);
  assert.match(unload, /this\.pageActive = false/);
  assert.match(unload, /this\.pageGeneration \+= 1/);

  const authHandlerStart = source.indexOf("    handleAuthChange(auth");
  const authHandlerEnd = source.indexOf("\n    },", authHandlerStart);
  const authHandler = source.slice(authHandlerStart, authHandlerEnd);
  assert.match(authHandler, /this\.authRevision \+= 1/);
  assert.match(authHandler, /this\.reloadSessionAfterAuth\(\)/);
  assert.doesNotMatch(authHandler, /historicalSession|this\.isHistorical/);

  const clearProjectionStart = source.indexOf("    clearIdentityBoundProjection() {");
  const clearProjectionEnd = source.indexOf("\n    },", clearProjectionStart);
  const clearProjection = source.slice(clearProjectionStart, clearProjectionEnd);
  assert.match(
    clearProjection,
    /const sessionPurpose = this\.session\.session_purpose \|\| "";[\s\S]*this\.session = \{\s*session_purpose: sessionPurpose\s*\}/
  );
  assert.match(clearProjection, /this\.roleOptions = \[\]/);
  assert.match(clearProjection, /this\.sessionLoadReady = false/);

  const authRefreshStart = source.indexOf("    async reloadSessionAfterAuth() {");
  const authRefreshEnd = source.indexOf("\n    },", authRefreshStart);
  const authRefresh = source.slice(authRefreshStart, authRefreshEnd);
  assert.match(authRefresh, /drainLatestAuthRefresh/);
  assert.match(authRefresh, /pageRequestSnapshot/);
  assert.match(authRefresh, /pageRequestIsCurrent/);

  const loadStart = source.indexOf("    async loadPublishedSession(");
  const loadEnd = source.indexOf("    async prepareJoinInviteToken(", loadStart);
  const load = source.slice(loadStart, loadEnd);
  assert.match(load, /const requestSnapshot = pageRequestSnapshot\(this\)/);
  const loadRequestEnd = load.indexOf("const response = await request");
  const firstSessionWrite = load.indexOf("this.session = session");
  const loadFreshnessCheck = load.indexOf(
    "pageRequestIsCurrent(this, requestSnapshot)",
    loadRequestEnd
  );
  assert.ok(loadRequestEnd < loadFreshnessCheck && loadFreshnessCheck < firstSessionWrite);

  const tokenStart = source.indexOf("    async prepareJoinInviteToken(");
  const tokenEnd = source.indexOf("    redirectHistoricalMemberIfNeeded()", tokenStart);
  const token = source.slice(tokenStart, tokenEnd);
  assert.match(token, /const requestSnapshot = pageRequestSnapshot\(this\)/);
  assert.match(token, /pageRequestIsCurrent\(this, requestSnapshot\)/);

  const loginStart = source.indexOf("    async ensureSeatSelectionLogin(");
  const loginEnd = source.indexOf("    async loadPublishedSession(", loginStart);
  const login = source.slice(loginStart, loginEnd);
  assert.ok(login.indexOf("const pageGeneration") < login.indexOf("await ensureLoggedIn"));
  assert.match(
    login,
    /await ensureLoggedIn[\s\S]*!this\.pageActive \|\| this\.pageGeneration !== pageGeneration/
  );

  const claimStart = source.indexOf("    async claimHistoricalRole(");
  const claimEnd = source.indexOf("    async claimSeat(", claimStart);
  const claim = source.slice(claimStart, claimEnd);
  assert.match(claim, /async claimHistoricalRole\(role, operation\)/);
  const claimRequestEnd = claim.indexOf("await request(historicalClaimRequest");
  const claimFreshnessCheck = claim.indexOf(
    "this.roleSelectionOperationIsCurrent(operation)",
    claimRequestEnd
  );
  const firstClaimWrite = claim.indexOf("this.pendingRole = null");
  assert.ok(claimRequestEnd < claimFreshnessCheck && claimFreshnessCheck < firstClaimWrite);

  const menuStart = source.indexOf("    showShareMenus() {");
  const menuEnd = source.indexOf("    seatTypeLabel(", menuStart);
  const menu = source.slice(menuStart, menuEnd);
  const activeChecks = menu.match(/!this\.pageActive \|\| this\.navigatingAlbum/g) || [];
  assert.equal(activeChecks.length, 2);
});

test("same-user auth refresh keeps its principal while guest and account switches change it", async () => {
  assert.equal(typeof shareInviteHelpers.authPrincipalOf, "function");
  assert.equal(
    shareInviteHelpers.authPrincipalOf({ user: { id: 17, gender: "male" }, token: "old" }),
    shareInviteHelpers.authPrincipalOf({ user: { id: 17, gender: "female" }, token: "new" })
  );
  assert.notEqual(
    shareInviteHelpers.authPrincipalOf({ user: null, token: "" }),
    shareInviteHelpers.authPrincipalOf({ user: { id: 17 }, token: "token-a" })
  );
  assert.notEqual(
    shareInviteHelpers.authPrincipalOf({ user: { id: 17 }, token: "token-a" }),
    shareInviteHelpers.authPrincipalOf({ user: { id: 18 }, token: "token-b" })
  );
  assert.equal(
    shareInviteHelpers.authPrincipalOf({ user: { id: 17 } }, false),
    "guest"
  );
  assert.equal(
    shareInviteHelpers.authPrincipalOf({ user: { id: 17 }, token: "" }),
    "guest"
  );
  assert.equal(
    shareInviteHelpers.authPrincipalOf({ user: { id: 17 } }, true),
    "user:17"
  );

  const source = await readFile(
    new URL("../src/pages/session/share.vue", import.meta.url),
    "utf8"
  );
  assert.match(source, /currentAuthPrincipal:\s*"guest"/);
  const onLoadStart = source.indexOf("  async onLoad(options) {");
  const onLoadEnd = source.indexOf("  onUnload()", onLoadStart);
  const onLoad = source.slice(onLoadStart, onLoadEnd);
  assert.match(onLoad, /this\.currentAuthPrincipal = authPrincipalOf\(currentAuth, getToken\(\)\)/);

  const handlerStart = source.indexOf("    handleAuthChange(auth");
  const handlerEnd = source.indexOf("\n    },", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  assert.match(handler, /const nextPrincipal = authPrincipalOf\(currentAuth, getToken\(\)\)/);
  assert.match(handler, /this\.refreshCurrentUserGender\(currentAuth\)/);
  const samePrincipalReturn = handler.indexOf("nextPrincipal === this.currentAuthPrincipal");
  assert.ok(samePrincipalReturn >= 0);
  assert.ok(samePrincipalReturn < handler.indexOf("this.authRevision += 1"));
  assert.ok(samePrincipalReturn < handler.indexOf("this.clearIdentityBoundProjection()"));

  const genderStart = source.indexOf("    refreshCurrentUserGender(auth");
  const genderEnd = source.indexOf("\n    },", genderStart);
  const gender = source.slice(genderStart, genderEnd);
  assert.match(gender, /hasExplicitAuth \? auth : getCurrentUser\(\)/);

  const loginStart = source.indexOf("    async ensureSeatSelectionLogin(");
  const loginEnd = source.indexOf("    async loadPublishedSession(", loginStart);
  const login = source.slice(loginStart, loginEnd);
  assert.match(login, /const returnedPrincipal = authPrincipalOf\(auth\);/);
  assert.match(login, /authPrincipalOf\(auth\) !==\s*authPrincipalOf\(latestAuth, latestAuthenticated\)/);

  const rebaseStart = source.indexOf("    rebaseRoleSelectionOperation(");
  const rebaseEnd = source.indexOf("\n    },", rebaseStart);
  const rebase = source.slice(rebaseStart, rebaseEnd);
  assert.match(rebase, /returnedPrincipal: authPrincipalOf\(auth\)/);
});

test("identity switch replaces cached ticket data with a neutral reload state", async () => {
  assert.equal(typeof shareInviteHelpers.identitySafeCreateFlow, "function");
  const staleFlow = {
    store: { id: 1, name: "A店" },
    script: { id: 2, name: "A剧本" },
    role: { id: 3, name: "A角色" },
    roleOptions: [{ id: 3, name: "A角色" }],
    selectedRoles: [{ id: 3, name: "A角色" }],
    sessionId: 42,
    sessionPurpose: "historical_record",
    startAt: "2026-01-01 10:00:00",
    startText: "A时间",
    note: "A文案"
  };
  Object.assign(staleFlow, {
    pendingHistoricalDraft: { roleId: 9 },
    pinnedMessageText: "A群公告",
    joinPolicy: "direct",
    joinPhoneRequired: false,
    npcJoinEnabled: false,
    cityVisible: false
  });
  const storage = new Map();
  const originalUni = globalThis.uni;
  globalThis.uni = {
    getStorageSync(key) {
      return storage.get(key);
    },
    setStorageSync(key, value) {
      storage.set(key, value);
    },
    removeStorageSync(key) {
      storage.delete(key);
    }
  };
  let neutralFlow;
  try {
    writeCreateFlow(staleFlow);
    clearCreateFlow();
    writeCreateFlow(shareInviteHelpers.identitySafeCreateFlow({
      sessionId: staleFlow.sessionId,
      sessionPurpose: staleFlow.sessionPurpose
    }));
    neutralFlow = readCreateFlow();
  } finally {
    globalThis.uni = originalUni;
  }
  assert.deepEqual(neutralFlow, {
    store: null,
    script: null,
    role: null,
    roleOptions: [],
    selectedRoles: [],
    sessionId: 42,
    sessionPurpose: "historical_record",
    startAt: "",
    startText: "",
    note: "",
    pendingHistoricalDraft: null,
    pinnedMessageText: "",
    joinPolicy: "review_required",
    joinPhoneRequired: true,
    npcJoinEnabled: true,
    cityVisible: true
  });

  const source = await readFile(
    new URL("../src/pages/session/share.vue", import.meta.url),
    "utf8"
  );
  const clearStart = source.indexOf("    clearIdentityBoundProjection() {");
  const clearEnd = source.indexOf("\n    },", clearStart);
  const clear = source.slice(clearStart, clearEnd);
  for (const reset of [
    "this.store = null",
    "this.script = null",
    "this.role = null",
    "this.roleOptions = []",
    "this.selectedRoles = []",
    "this.pendingRole = null",
    "this.confirmedCrossCastRoleKey = \"\"",
    "this.startText = \"\"",
    "this.note = \"\""
  ]) {
    assert.match(clear, new RegExp(reset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(
    clear,
    /try \{\s*clearCreateFlow\(\);\s*\} catch \(error\)[\s\S]*?try \{\s*uni\.setStorageSync\(\s*CREATE_FLOW_KEY,\s*identitySafeCreateFlow\(/
  );
  assert.doesNotMatch(clear, /this\.inviteToken\s*=|this\.historicalInviteToken\s*=/);

  const loadStart = source.indexOf("    async loadPublishedSession(");
  const loadEnd = source.indexOf("    async prepareJoinInviteToken(", loadStart);
  const loadCatch = source.slice(source.indexOf("      } catch (error) {", loadStart), loadEnd);
  assert.match(loadCatch, /this\.statusText = "车局加载失败，请稍后重试"/);
});

test("identity-safe cache fallback overwrites known sensitive fields when remove fails", () => {
  const staleFlow = {
    store: { id: 1, name: "A店" },
    script: { id: 2, name: "A剧本" },
    role: { id: 3, name: "A角色" },
    roleOptions: [{ id: 3, name: "A角色" }],
    selectedRoles: [{ id: 3, name: "A角色" }],
    sessionId: 42,
    sessionPurpose: "historical_record",
    startAt: "2026-01-01 10:00:00",
    startText: "A时间",
    note: "A文案",
    pendingHistoricalDraft: { roleId: 9 },
    pinnedMessageText: "A群公告",
    joinPolicy: "direct",
    joinPhoneRequired: false,
    npcJoinEnabled: false,
    cityVisible: false,
    identityScopedExtra: { privateNote: "A身份私有数据" }
  };
  const storage = new Map();
  const originalUni = globalThis.uni;
  let removeShouldFail = false;
  globalThis.uni = {
    getStorageSync(key) {
      return storage.get(key);
    },
    setStorageSync(key, value) {
      storage.set(key, value);
    },
    removeStorageSync(key) {
      if (removeShouldFail) {
        removeShouldFail = false;
        throw new Error("remove failed once");
      }
      storage.delete(key);
    }
  };
  let recoveredFlow;
  try {
    writeCreateFlow(staleFlow);
    removeShouldFail = true;
    try {
      clearCreateFlow();
    } catch (error) {
      // The page continues to the neutral write.
    }
    try {
      globalThis.uni.setStorageSync(
        CREATE_FLOW_KEY,
        shareInviteHelpers.identitySafeCreateFlow({
          sessionId: staleFlow.sessionId,
          sessionPurpose: staleFlow.sessionPurpose
        })
      );
    } catch (error) {
      assert.fail(`neutral write unexpectedly failed: ${error.message}`);
    }
    recoveredFlow = readCreateFlow();
  } finally {
    globalThis.uni = originalUni;
  }

  assert.deepEqual(recoveredFlow, {
    store: null,
    script: null,
    role: null,
    roleOptions: [],
    selectedRoles: [],
    sessionId: 42,
    sessionPurpose: "historical_record",
    startAt: "",
    startText: "",
    note: "",
    pendingHistoricalDraft: null,
    pinnedMessageText: "",
    joinPolicy: "review_required",
    joinPhoneRequired: true,
    npcJoinEnabled: true,
    cityVisible: true
  });
});

test("role-selection login transaction allows one guest login and rejects identity drift", () => {
  for (const helperName of [
    "beginRoleSelectionOperation",
    "rebaseRoleSelectionOperation",
    "roleSelectionOperationIsCurrent",
    "finishRoleSelectionOperation"
  ]) {
    assert.equal(typeof shareInviteHelpers[helperName], "function", `${helperName} is exported`);
  }

  const guestEntry = {
    pageActive: true,
    pageGeneration: 3,
    authRevision: 4,
    sessionId: 42,
    currentAuthPrincipal: "guest",
    roleSelectionOperationId: 0,
    activeRoleSelectionOperationId: 0,
    roleSelectionSubmitting: false
  };
  const guestOperation = shareInviteHelpers.beginRoleSelectionOperation(guestEntry);
  assert.equal(guestOperation.originPrincipal, "guest");
  assert.equal(guestOperation.sessionId, "42");

  const guestToAState = {
    ...guestEntry,
    authRevision: 5,
    currentAuthPrincipal: "user:17",
    roleSelectionOperationId: guestOperation.operationId,
    activeRoleSelectionOperationId: guestOperation.operationId,
    roleSelectionSubmitting: true
  };
  const guestToA = shareInviteHelpers.rebaseRoleSelectionOperation({
    operation: guestOperation,
    state: guestToAState,
    returnedPrincipal: "user:17",
    actualPrincipal: "user:17"
  });
  assert.ok(guestToA, "guest -> A is allowed after exactly one auth revision");
  assert.equal(
    shareInviteHelpers.roleSelectionOperationIsCurrent(guestToAState, guestToA),
    true
  );

  const userEntry = {
    ...guestEntry,
    currentAuthPrincipal: "user:17"
  };
  const userOperation = shareInviteHelpers.beginRoleSelectionOperation(userEntry);
  const userOwnedState = {
    ...userEntry,
    roleSelectionOperationId: userOperation.operationId,
    activeRoleSelectionOperationId: userOperation.operationId,
    roleSelectionSubmitting: true
  };
  assert.ok(shareInviteHelpers.rebaseRoleSelectionOperation({
    operation: userOperation,
    state: userOwnedState,
    returnedPrincipal: "user:17",
    actualPrincipal: "user:17"
  }), "same A profile/token refresh remains allowed");
  assert.equal(shareInviteHelpers.rebaseRoleSelectionOperation({
    operation: userOperation,
    state: {
      ...userOwnedState,
      authRevision: userEntry.authRevision + 1,
      currentAuthPrincipal: "user:18"
    },
    returnedPrincipal: "user:18",
    actualPrincipal: "user:18"
  }), null, "A -> B is rejected");
  assert.equal(shareInviteHelpers.rebaseRoleSelectionOperation({
    operation: userOperation,
    state: {
      ...userOwnedState,
      authRevision: userEntry.authRevision + 1,
      currentAuthPrincipal: "guest"
    },
    returnedPrincipal: "guest",
    actualPrincipal: "guest"
  }), null, "A -> guest is rejected");
  assert.equal(shareInviteHelpers.rebaseRoleSelectionOperation({
    operation: guestOperation,
    state: {
      ...guestToAState,
      authRevision: guestEntry.authRevision + 2,
      currentAuthPrincipal: "user:18"
    },
    returnedPrincipal: "user:18",
    actualPrincipal: "user:18"
  }), null, "guest -> A -> B is rejected");
});

test("role-selection owner latches before await and only its own finally can release it", () => {
  const idle = {
    pageActive: true,
    pageGeneration: 1,
    authRevision: 0,
    sessionId: 42,
    currentAuthPrincipal: "guest",
    roleSelectionOperationId: 0,
    activeRoleSelectionOperationId: 0,
    roleSelectionSubmitting: false
  };
  const first = shareInviteHelpers.beginRoleSelectionOperation(idle);
  const firstOwned = {
    ...idle,
    roleSelectionOperationId: first.operationId,
    activeRoleSelectionOperationId: first.operationId,
    roleSelectionSubmitting: true
  };
  assert.equal(
    shareInviteHelpers.beginRoleSelectionOperation(firstOwned),
    null,
    "a second click cannot acquire an owner before the first await resolves"
  );

  const newerOwner = {
    ...firstOwned,
    roleSelectionOperationId: first.operationId + 1,
    activeRoleSelectionOperationId: first.operationId + 1
  };
  assert.deepEqual(
    shareInviteHelpers.finishRoleSelectionOperation(newerOwner, first.operationId),
    {
      activeRoleSelectionOperationId: first.operationId + 1,
      roleSelectionSubmitting: true
    },
    "an old finally cannot unlock a newer owner"
  );
  assert.equal(
    shareInviteHelpers.roleSelectionOperationIsCurrent(firstOwned, {
      ...first,
      snapshot: undefined
    }),
    false,
    "leaf work without an explicit snapshot is stale"
  );
  assert.equal(
    shareInviteHelpers.roleSelectionOperationIsCurrent(firstOwned, {
      ...first,
      snapshot: shareInviteHelpers.pageRequestSnapshot(firstOwned)
    }),
    false,
    "an entry snapshot cannot bypass the authenticated rebase"
  );
});

test("role-selection page methods carry owner and snapshot through every persisted leaf", async () => {
  const source = await readFile(
    new URL("../src/pages/session/share.vue", import.meta.url),
    "utf8"
  );

  for (const methodName of ["chooseHistoricalRole", "chooseRole", "chooseNpcRole"]) {
    const start = source.indexOf(`    async ${methodName}(`);
    const end = source.indexOf("\n    },", start);
    const method = source.slice(start, end);
    assert.ok(
      method.indexOf("this.beginRoleSelectionOperation(") <
        method.indexOf("await this.ensureSeatSelectionLogin"),
      `${methodName} acquires its owner before login awaits`
    );
    assert.match(method, /this\.finishRoleSelectionOperation\(operationEntry\.operationId\)/);
  }

  const historicalStart = source.indexOf("    async chooseHistoricalRole(");
  const historicalEnd = source.indexOf("    async chooseRole(", historicalStart);
  const historical = source.slice(historicalStart, historicalEnd);
  assert.doesNotMatch(historical, /\|\| role/);
  const afterCrossCast = historical.slice(
    historical.indexOf("await this.confirmCrossCastRole(targetRole)")
  );
  assert.match(
    afterCrossCast,
    /const confirmedRoleCards = selectedBoardType === "npc"\s*\? this\.npcRoleCards\s*: this\.roleCards;/
  );
  assert.match(
    afterCrossCast,
    /if \(!confirmedTargetRole \|\| !confirmedTargetRole\.claimable\) \{\s*return;/
  );

  const seatStart = source.indexOf("    async chooseRole(");
  const seatEnd = source.indexOf("    handleSharedRoleTap(", seatStart);
  const seat = source.slice(seatStart, seatEnd);
  assert.doesNotMatch(seat, /\.find\([\s\S]*\) \|\| role/);

  const npcStart = source.indexOf("    async chooseNpcRole(");
  const npcEnd = source.indexOf("    hideShareMenus(", npcStart);
  const npc = source.slice(npcStart, npcEnd);
  assert.doesNotMatch(npc, /\|\| npcRole/);

  for (const methodName of ["claimHistoricalRole", "claimSeat"]) {
    const start = source.indexOf(`    async ${methodName}(`);
    const end = source.indexOf("\n    },", start);
    const method = source.slice(start, end);
    assert.doesNotMatch(method.split("\n", 1)[0], /= pageRequestSnapshot/);
    assert.ok(
      method.indexOf("this.roleSelectionOperationIsCurrent(operation)") <
        method.indexOf("await request"),
      `${methodName} rejects missing/stale operation before POST`
    );
  }

  const confirmStart = source.indexOf("    async confirmRole(");
  const confirmEnd = source.indexOf("    async claimHistoricalRole(", confirmStart);
  const confirm = source.slice(confirmStart, confirmEnd);
  assert.doesNotMatch(confirm, /options\.operationSnapshot \|\| pageRequestSnapshot/);
});

test("identity reload clears only its placeholder and preserves historical conflict copy", async () => {
  const source = await readFile(
    new URL("../src/pages/session/share.vue", import.meta.url),
    "utf8"
  );
  const loadStart = source.indexOf("    async loadPublishedSession(");
  const loadEnd = source.indexOf("    async prepareJoinInviteToken(", loadStart);
  const load = source.slice(loadStart, loadEnd);
  assert.match(
    load,
    /if \(this\.statusText === "正在重新加载车局…"\) \{\s*this\.statusText = "";/
  );
  assert.ok(
    load.indexOf("this.statusText = \"\";") <
      load.indexOf("this.session.join_policy === \"direct\"")
  );
  assert.match(
    load,
    /try \{\s*writeCreateFlow\(\{[\s\S]*?\}\);\s*\} catch \(error\) \{[\s\S]*?\}\s*this\.sessionLoadReady = true;/
  );

  const claimStart = source.indexOf("    async claimHistoricalRole(");
  const claimEnd = source.indexOf("    async claimSeat(", claimStart);
  const claim = source.slice(claimStart, claimEnd);
  const conflictStart = claim.indexOf("if (error?.statusCode === 409)");
  const conflictEnd = claim.indexOf("} else if", conflictStart);
  const conflict = claim.slice(conflictStart, conflictEnd);
  assert.match(
    conflict,
    /statusCode === 409[\s\S]*const loaded = await this\.loadPublishedSession[\s\S]*!this\.roleSelectionOperationIsCurrent\(operation\)[\s\S]*if \(!loaded\) \{\s*return;[\s\S]*this\.statusText = conflictText[\s\S]*showToast/
  );
  assert.ok(
    conflict.indexOf("this.roleSelectionOperationIsCurrent(operation)") <
      conflict.indexOf("if (!loaded)")
  );
});

test("seat, NPC, and historical actions stop after stale modal or request continuations", async () => {
  const source = await readFile(
    new URL("../src/pages/session/share.vue", import.meta.url),
    "utf8"
  );

  const chooseStart = source.indexOf("    async chooseRole(");
  const chooseEnd = source.indexOf("    handleSharedRoleTap(", chooseStart);
  const choose = source.slice(chooseStart, chooseEnd);
  assert.match(
    choose,
    /await this\.confirmSwitchRole\(targetRole\)[\s\S]*roleSelectionOperationIsCurrent\(operation\)/
  );
  assert.match(
    choose,
    /await this\.confirmCrossCastRole\(targetRole\)[\s\S]*roleSelectionOperationIsCurrent\(operation\)/
  );
  assert.match(choose, /this\.confirmRole\(targetRole, \{[\s\S]*operation/);

  const confirmRoleStart = source.indexOf("    async confirmRole(");
  const confirmRoleEnd = source.indexOf("    async claimHistoricalRole(", confirmRoleStart);
  const confirmRole = source.slice(confirmRoleStart, confirmRoleEnd);
  assert.match(
    confirmRole,
    /const confirmed = await this\.confirmCrossCastRole\(targetRole\);\s*if \(!this\.roleSelectionOperationIsCurrent\(operation\)\) \{\s*return;\s*\}\s*if \(!confirmed\) \{[\s\S]*this\.pendingRole = null;/
  );

  const historicalChoiceStart = source.indexOf("    async chooseHistoricalRole(");
  const historicalChoiceEnd = source.indexOf("\n    },", historicalChoiceStart);
  const historicalChoice = source.slice(historicalChoiceStart, historicalChoiceEnd);
  assert.match(
    historicalChoice,
    /await this\.confirmCrossCastRole\(targetRole\)[\s\S]*roleSelectionOperationIsCurrent\(operation\)[\s\S]*claimHistoricalRole\(confirmedTargetRole, operation\)/
  );

  const seatStart = source.indexOf("    async claimSeat(");
  const seatEnd = source.indexOf("    async chooseNpcRole(", seatStart);
  const seat = source.slice(seatStart, seatEnd);
  for (const awaitedCall of [
    "const claimResponse = await request(",
    "await requestSubscriptionAfterConfirmedJoin(",
    "await this.loadPublishedSession(this.sessionId)",
    "await request({\n          url: \"/api/signups\"",
    "await requestSignupReviewedSubscription()"
  ]) {
    const awaited = seat.indexOf(awaitedCall);
    assert.ok(awaited >= 0, `missing guarded seat await: ${awaitedCall}`);
    assert.ok(
      seat.indexOf("this.roleSelectionOperationIsCurrent(operation)", awaited) > awaited,
      `missing freshness check after seat await: ${awaitedCall}`
    );
  }
  const seatCatch = seat.slice(seat.indexOf("      } catch (error) {"));
  assert.match(seatCatch, /if \(!this\.roleSelectionOperationIsCurrent\(operation\)\) \{\s*return;/);

  const npcStart = source.indexOf("    async chooseNpcRole(");
  const npcEnd = source.indexOf("    hideShareMenus(", npcStart);
  const npc = source.slice(npcStart, npcEnd);
  for (const awaitedCall of [
    "await this.confirmSwitchRole(targetRole)",
    "await this.confirmCrossCastRole(targetRole)",
    "await this.ensureSeatSelectionLogin({",
    "const response = await request({",
    "await requestSubscriptionAfterConfirmedJoin(",
    "await this.loadPublishedSession(this.sessionId)",
    "await requestSignupReviewedSubscription()"
  ]) {
    const awaited = npc.indexOf(awaitedCall);
    assert.ok(awaited >= 0, `missing guarded NPC await: ${awaitedCall}`);
    assert.ok(
      npc.indexOf("this.roleSelectionOperationIsCurrent(operation)", awaited) > awaited,
      `missing freshness check after NPC await: ${awaitedCall}`
    );
  }
  const npcCatch = npc.slice(npc.indexOf("      } catch (error) {"));
  assert.match(npcCatch, /if \(!this\.roleSelectionOperationIsCurrent\(operation\)\) \{\s*return;/);

  const claimStart = source.indexOf("    async claimHistoricalRole(");
  const claimEnd = source.indexOf("    async claimSeat(", claimStart);
  const historicalClaim = source.slice(claimStart, claimEnd);
  assert.match(
    historicalClaim,
    /statusCode === 409[\s\S]*const loaded = await this\.loadPublishedSession\(this\.sessionId\)[\s\S]*!this\.roleSelectionOperationIsCurrent\(operation\)[\s\S]*if \(!loaded\)[\s\S]*this\.statusText = conflictText[\s\S]*showToast/
  );
});
