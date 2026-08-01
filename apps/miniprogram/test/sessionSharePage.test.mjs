import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { parse as parseSfc } from "@vue/compiler-sfc";
import {
  isBusinessDateTimeReached,
  isHistoricalSession,
  parseBusinessDateTime
} from "@pinche/shared";
import * as shareInviteHelpers from "../src/utils/sessionShareInvite.js";

import {
  buildSessionSharePayload,
  resolveSessionShareMode,
  sessionSharePresentation
} from "../src/utils/sessionShare.js";

const sharePagePath = new URL("../src/pages/session/share.vue", import.meta.url);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function loadSharePageComponent(overrides = {}) {
  const source = fs.readFileSync(sharePagePath, "utf8");
  const { descriptor, errors } = parseSfc(source, { filename: sharePagePath.pathname });
  assert.deepEqual(errors, []);
  const script = descriptor.script?.content || "";
  const executable = script
    .replace(/^import[\s\S]*?;\s*$/gm, "")
    .replace(/export default\s*\{/, "return {");
  const noop = () => {};
  const runtimeDate = overrides.Date || globalThis.Date;
  const dependencies = {
    formatBeijingDateTime: (value) => String(value || ""),
    isBusinessDateTimeReached: (value, now = runtimeDate.now()) =>
      isBusinessDateTimeReached(value, now),
    parseBusinessDateTime,
    isHistoricalSession,
    AuthIdentityBar: {},
    RoleSeatBoard: {},
    FeedbackHost: {},
    AUTH_CHANGE_EVENT: "auth-change",
    dataOf: (response) => response?.data,
    ensureLoggedIn: async () => null,
    getCurrentUser: () => ({ user: null }),
    getToken: () => "",
    request: async () => {
      throw new Error("unexpected request");
    },
    CREATE_FLOW_KEY: "test-create-flow",
    clearCreateFlow: noop,
    displayTags: () => "",
    flowToQuery: () => "",
    isCrossCast: () => false,
    isRoleSelected: () => false,
    isSameRole: (left, right) => Number(left?.id) === Number(right?.id),
    mergeSelectedRoles: () => [],
    queryToFlow: () => ({}),
    readCreateFlow: () => ({}),
    roleGenderSymbol: () => "",
    roleOptionsFromFlow: () => [],
    writeCreateFlow: (flow) => flow,
    showWechatShareMenus: noop,
    buildSessionSharePayload,
    resolveSessionShareMode,
    sessionSharePresentation,
    ...shareInviteHelpers,
    captureRoleSelectionOperation: shareInviteHelpers.beginRoleSelectionOperation,
    releaseRoleSelectionOperation: shareInviteHelpers.finishRoleSelectionOperation,
    rebaseCapturedRoleSelectionOperation: shareInviteHelpers.rebaseRoleSelectionOperation,
    capturedRoleSelectionOperationIsCurrent:
      shareInviteHelpers.roleSelectionOperationIsCurrent,
    isConfirmedSessionMember: () => false,
    requestSubscriptionAfterConfirmedJoin: noop,
    requestSessionRescheduledSubscription: noop,
    requestSignupReviewedSubscription: noop,
    showModal: async () => ({ confirm: false }),
    showToast: noop,
    uni: {
      hideShareMenu: ({ complete } = {}) => complete?.(),
      setNavigationBarTitle: noop
    },
    setTimeout,
    clearTimeout,
    Date: runtimeDate,
    ...overrides
  };
  return Function(
    ...Object.keys(dependencies),
    `"use strict";\n${executable}`
  )(...Object.values(dependencies));
}

function createSharePageVm(component, overrides = {}) {
  const vm = {
    ...component.data(),
    pageActive: true,
    ...overrides
  };
  for (const [name, method] of Object.entries(component.methods || {})) {
    vm[name] = method.bind(vm);
  }
  for (const [name, getter] of Object.entries(component.computed || {})) {
    Object.defineProperty(vm, name, {
      configurable: true,
      enumerable: true,
      get: getter.bind(vm)
    });
  }
  return vm;
}

function sessionResponse(overrides = {}) {
  return {
    id: 42,
    access_scope: "member",
    status: "recruiting",
    has_started: false,
    start_at: new Date(Date.now() + 1_000).toISOString(),
    script_name_snapshot: "年轮",
    store_name_snapshot: "推理社",
    seats: [],
    session_npc_roles: [],
    ...overrides
  };
}

test("pre-start page hides sharing at the boundary and only shares the refreshed post-start mode", async () => {
  let nowMs = globalThis.Date.parse("2026-07-24T12:00:00.000Z");
  const firstLoad = deferred();
  const boundaryLoad = deferred();
  const scheduled = [];
  const hiddenMenus = [];
  const shownMenus = [];
  let getCount = 0;
  const component = loadSharePageComponent({
    request: async ({ method = "GET" }) => {
      if (method === "POST") {
        return { data: { token: "member-token" } };
      }
      getCount += 1;
      return getCount === 1 ? firstLoad.promise : boundaryLoad.promise;
    },
    showWechatShareMenus: (options) => shownMenus.push(options),
    uni: {
      hideShareMenu: (options = {}) => {
        hiddenMenus.push(options.menus);
        options.complete?.();
      },
      setNavigationBarTitle() {}
    },
    setTimeout: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimeout() {},
    Date: {
      now: () => nowMs,
      parse: globalThis.Date.parse
    }
  });
  const vm = createSharePageVm(component, {
    sessionId: "42",
    currentUserId: "7"
  });

  const initialRefresh = vm.refreshPublishedShareState();
  const concurrentOnShow = component.onShow.call(vm);
  assert.equal(getCount, 1, "onShow must share the in-flight authoritative refresh");

  firstLoad.resolve({
    data: sessionResponse({
      start_at: new globalThis.Date(nowMs + 1_000).toISOString()
    })
  });
  await Promise.all([initialRefresh, concurrentOnShow]);
  assert.equal(vm.shareMode, "join");
  assert.equal(vm.shareReady, true);
  assert.equal(scheduled.length, 1);

  nowMs += 1_000;
  const boundaryRefresh = scheduled[0].callback();
  assert.equal(vm.shareReady, false);
  assert.equal(component.onShareAppMessage.call(vm), undefined);
  assert.deepEqual(hiddenMenus.at(-1), ["shareAppMessage", "shareTimeline"]);

  boundaryLoad.resolve({
    data: sessionResponse({
      has_started: true,
      start_at: new globalThis.Date(nowMs - 1_000).toISOString()
    })
  });
  await boundaryRefresh;

  assert.equal(vm.shareMode, "claim");
  assert.equal(vm.shareReady, true);
  assert.match(component.onShareAppMessage.call(vm).path, /source=claim$/);
  assert.equal(shownMenus.length, 2);
});

test("a token request crossing the start boundary queues a fresh GET before sharing", async () => {
  let nowMs = globalThis.Date.parse("2026-07-24T12:00:00.000Z");
  const tokenResponse = deferred();
  const postBoundaryLoad = deferred();
  const scheduled = [];
  const hiddenMenus = [];
  const shownMenus = [];
  let getCount = 0;
  const component = loadSharePageComponent({
    request: async ({ method = "GET" }) => {
      if (method === "POST") {
        return tokenResponse.promise;
      }
      getCount += 1;
      if (getCount === 1) {
        return {
          data: sessionResponse({
            start_at: new globalThis.Date(nowMs + 500).toISOString()
          })
        };
      }
      return postBoundaryLoad.promise;
    },
    showWechatShareMenus: (options) => shownMenus.push(options),
    uni: {
      hideShareMenu: (options = {}) => {
        hiddenMenus.push(options.menus);
        options.complete?.();
      },
      setNavigationBarTitle() {}
    },
    setTimeout: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimeout() {},
    Date: {
      now: () => nowMs,
      parse: globalThis.Date.parse
    }
  });
  const vm = createSharePageVm(component, {
    sessionId: "42",
    currentUserId: "7"
  });

  const initialRefresh = vm.refreshPublishedShareState();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(scheduled.length, 1, "boundary must be armed before the token request settles");
  assert.equal(scheduled[0].delay, 500, "sub-second boundaries must not be delayed");

  nowMs += 500;
  scheduled[0].callback();
  tokenResponse.resolve({ data: { token: "pre-boundary-token" } });
  await initialRefresh;
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(getCount, 2, "boundary reached in flight must queue a new authoritative GET");
  assert.equal(vm.shareReady, false);
  assert.equal(component.onShareAppMessage.call(vm), undefined);
  assert.deepEqual(hiddenMenus.at(-1), ["shareAppMessage", "shareTimeline"]);

  const queuedRefresh = vm.shareRefreshPromise;
  postBoundaryLoad.resolve({
    data: sessionResponse({
      has_started: true,
      start_at: new globalThis.Date(nowMs - 1).toISOString()
    })
  });
  await queuedRefresh;

  assert.equal(vm.shareMode, "claim");
  assert.equal(vm.shareReady, true);
  assert.equal(shownMenus.length, 1);
});

test("far-future start boundaries use a safe timer chunk and rearm later", async () => {
  const nowMs = globalThis.Date.parse("2026-07-24T12:00:00.000Z");
  const scheduled = [];
  const component = loadSharePageComponent({
    request: async ({ method = "GET" }) => {
      if (method === "POST") {
        return { data: { token: "member-token" } };
      }
      return {
        data: sessionResponse({
          start_at: new globalThis.Date(nowMs + 3_000_000_000).toISOString()
        })
      };
    },
    setTimeout: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimeout() {},
    Date: {
      now: () => nowMs,
      parse: globalThis.Date.parse
    }
  });
  const vm = createSharePageVm(component, {
    sessionId: "42",
    currentUserId: "7"
  });

  await vm.refreshPublishedShareState();

  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 2_147_000_000);
  scheduled[0].callback();
  assert.equal(scheduled.length, 2, "timer chunks must rearm until the real boundary");
  assert.equal(scheduled[1].delay, 2_147_000_000);
});

test("an already-reached boundary refreshes lifecycle before minting a token", async () => {
  let nowMs = globalThis.Date.parse("2026-07-24T12:00:00.000Z");
  const requestOrder = [];
  const scheduled = [];
  let getCount = 0;
  const component = loadSharePageComponent({
    request: async ({ method = "GET" }) => {
      requestOrder.push(method);
      if (method === "POST") {
        return { data: { token: "post-boundary-token" } };
      }
      getCount += 1;
      return {
        data: sessionResponse({
          has_started: getCount > 2,
          start_at: new globalThis.Date(nowMs - 1).toISOString()
        })
      };
    },
    Date: {
      now: () => nowMs,
      parse: globalThis.Date.parse
    },
    setTimeout: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimeout() {}
  });
  const vm = createSharePageVm(component, {
    sessionId: "42",
    currentUserId: "7"
  });

  await vm.refreshPublishedShareState();
  await Promise.resolve();

  assert.deepEqual(requestOrder, ["GET"]);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 1_000);
  assert.equal(vm.shareReady, false);

  nowMs += 1_000;
  const firstQueuedRefresh = scheduled[0].callback();
  await firstQueuedRefresh;

  assert.deepEqual(requestOrder, ["GET", "GET"]);
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[1].delay, 2_000);
  assert.equal(vm.shareReady, false);

  nowMs += 2_000;
  const secondQueuedRefresh = scheduled[1].callback();
  await secondQueuedRefresh;

  assert.deepEqual(requestOrder, ["GET", "GET", "GET", "POST"]);
  assert.equal(vm.shareMode, "claim");
  assert.equal(vm.shareReady, true);
});

test("client-ahead boundary reconciliation stops after capped backoff refreshes", async () => {
  let nowMs = globalThis.Date.parse("2026-07-24T12:00:00.000Z");
  const scheduled = [];
  let getCount = 0;
  let postCount = 0;
  const component = loadSharePageComponent({
    request: async ({ method = "GET" }) => {
      if (method === "POST") {
        postCount += 1;
        return { data: { token: "must-not-be-minted" } };
      }
      getCount += 1;
      return {
        data: sessionResponse({
          has_started: getCount > 4,
          start_at: new globalThis.Date(nowMs - 60_000).toISOString()
        })
      };
    },
    setTimeout: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimeout() {},
    Date: {
      now: () => nowMs,
      parse: globalThis.Date.parse
    }
  });
  const vm = createSharePageVm(component, {
    sessionId: "42",
    currentUserId: "7"
  });

  await vm.refreshPublishedShareState();
  for (let index = 0; index < 3; index += 1) {
    assert.equal(scheduled.length, index + 1, "each capped retry should own one timer");
    nowMs += scheduled[index].delay;
    await scheduled[index].callback();
  }

  assert.deepEqual(
    scheduled.map(({ delay }) => delay),
    [1_000, 2_000, 4_000],
    "clock-skew reconciliation should use capped exponential backoff"
  );
  assert.equal(getCount, 4, "the initial GET plus three skew retries are permitted");
  assert.equal(postCount, 0, "a stale pre-start response must never authorize token minting");
  assert.equal(vm.startBoundaryTimer, null, "the retry cap must leave no live timer");
  await Promise.resolve();
  assert.equal(getCount, 4, "no background refresh may continue after the cap");
  assert.equal(vm.showLifecycleRetry, true, "the capped state must expose explicit recovery");

  await vm.retryLifecycleRefresh();

  assert.equal(getCount, 5, "recovery must perform exactly one user-triggered full refresh");
  assert.equal(postCount, 1);
  assert.equal(vm.showLifecycleRetry, false);
  assert.equal(vm.shareReady, true);
  assert.equal(vm.startBoundaryTimer, null);

  const source = fs.readFileSync(sharePagePath, "utf8");
  assert.match(
    source,
    /v-if="showLifecycleRetry"[\s\S]{0,500}@tap="retryLifecycleRefresh"/
  );
});

test("onHide invalidates a deferred lifecycle GET and onShow recovers authoritatively", async () => {
  const firstLoad = deferred();
  const hiddenMenus = [];
  const shownMenus = [];
  const activeTimers = new Map();
  let nextTimerId = 0;
  let getCount = 0;
  let postCount = 0;
  const component = loadSharePageComponent({
    request: async ({ method = "GET" }) => {
      if (method === "POST") {
        postCount += 1;
        return { data: { token: "reactivated-token" } };
      }
      getCount += 1;
      if (getCount === 1) {
        return firstLoad.promise;
      }
      return {
        data: sessionResponse({
          start_at: new Date(Date.now() + 60_000).toISOString()
        })
      };
    },
    showWechatShareMenus: (options) => shownMenus.push(options),
    uni: {
      hideShareMenu: (options = {}) => {
        hiddenMenus.push(options.menus);
        options.complete?.();
      },
      setNavigationBarTitle() {}
    },
    setTimeout: (callback, delay) => {
      nextTimerId += 1;
      activeTimers.set(nextTimerId, { callback, delay });
      return nextTimerId;
    },
    clearTimeout: (timerId) => activeTimers.delete(timerId)
  });
  const vm = createSharePageVm(component, {
    sessionId: "42",
    currentUserId: "7"
  });

  const staleRefresh = vm.refreshPublishedShareState();
  await Promise.resolve();
  assert.equal(getCount, 1);

  const hidesBeforeNavigation = hiddenMenus.length;
  component.onHide.call(vm);
  assert.equal(
    hiddenMenus.length,
    hidesBeforeNavigation + 1,
    "hiding the page must immediately fail the platform share menus closed"
  );
  firstLoad.resolve({ data: sessionResponse() });
  await staleRefresh;

  assert.equal(postCount, 0, "the stale GET must not start token preparation");
  assert.equal(activeTimers.size, 0, "the stale GET must not rearm a boundary timer");
  assert.equal(shownMenus.length, 0, "the stale GET must not show a share menu");
  assert.equal(vm.shareReady, false);

  await component.onShow.call(vm);

  assert.equal(getCount, 2, "reactivation must perform a fresh authoritative GET");
  assert.equal(postCount, 1);
  assert.equal(activeTimers.size, 1);
  assert.equal(shownMenus.length, 1);
  assert.equal(vm.shareReady, true);
});

test("onUnload ignores a deferred token response and keeps timers and menus closed", async () => {
  const tokenStarted = deferred();
  const tokenResponse = deferred();
  const hiddenMenus = [];
  const shownMenus = [];
  const activeTimers = new Map();
  let nextTimerId = 0;
  let postCount = 0;
  const component = loadSharePageComponent({
    request: async ({ method = "GET" }) => {
      if (method === "POST") {
        postCount += 1;
        tokenStarted.resolve();
        return tokenResponse.promise;
      }
      return {
        data: sessionResponse({
          start_at: new Date(Date.now() + 60_000).toISOString()
        })
      };
    },
    showWechatShareMenus: (options) => shownMenus.push(options),
    uni: {
      hideShareMenu: (options = {}) => {
        hiddenMenus.push(options.menus);
        options.complete?.();
      },
      setNavigationBarTitle() {}
    },
    setTimeout: (callback, delay) => {
      nextTimerId += 1;
      activeTimers.set(nextTimerId, { callback, delay });
      return nextTimerId;
    },
    clearTimeout: (timerId) => activeTimers.delete(timerId)
  });
  const vm = createSharePageVm(component, {
    sessionId: "42",
    currentUserId: "7"
  });

  const refresh = vm.refreshPublishedShareState();
  await tokenStarted.promise;
  assert.equal(postCount, 1);
  assert.equal(activeTimers.size, 1);

  const hidesBeforeNavigation = hiddenMenus.length;
  component.onUnload.call(vm);
  assert.equal(activeTimers.size, 0);
  assert.equal(hiddenMenus.length, hidesBeforeNavigation + 1);

  tokenResponse.resolve({ data: { token: "stale-token" } });
  await refresh;

  assert.equal(vm.inviteToken, "", "an unloaded page must ignore the token response");
  assert.equal(vm.shareReady, false);
  assert.equal(activeTimers.size, 0);
  assert.equal(shownMenus.length, 0);
});

test("public invite-preview NPC cards honor stripped bound and pending occupancy flags", () => {
  const component = loadSharePageComponent();
  const vm = createSharePageVm(component, {
    session: sessionResponse({
      access_scope: "invite_preview",
      session_npc_roles: [
        {
          id: 1,
          name: "店员",
          status: "active",
          is_bound: true,
          has_pending_signup: false
        },
        {
          id: 2,
          name: "侦探",
          status: "active",
          is_bound: false,
          has_pending_signup: true
        },
        {
          id: 3,
          name: "管家",
          status: "active",
          is_bound: false,
          has_pending_signup: false
        }
      ]
    }),
    currentUserId: ""
  });

  assert.deepEqual(
    vm.npcRoleCards.map(({ id, stateKind, claimable }) => ({ id, stateKind, claimable })),
    [
      { id: 1, stateKind: "taken", claimable: false },
      { id: 2, stateKind: "taken", claimable: false },
      { id: 3, stateKind: "available", claimable: true }
    ]
  );
});

test("published role actionability follows server lifecycle despite fast or slow device clocks", () => {
  const deviceNow = globalThis.Date.parse("2026-07-24T12:00:00.000Z");
  const component = loadSharePageComponent({
    Date: {
      now: () => deviceNow,
      parse: globalThis.Date.parse
    }
  });
  const openRole = {
    id: "1",
    seatId: 1,
    name: "侦探",
    status: "open",
    roleGender: "unlimited",
    confirmedUserId: ""
  };
  const slowDeviceVm = createSharePageVm(component, {
    sessionId: "42",
    sessionLoaded: true,
    session: sessionResponse({
      status: "locked",
      has_started: true,
      start_at: new globalThis.Date(deviceNow + 60_000).toISOString()
    }),
    roleOptions: [openRole]
  });
  const fastDeviceVm = createSharePageVm(component, {
    sessionId: "42",
    sessionLoaded: true,
    session: sessionResponse({
      status: "locked",
      has_started: false,
      start_at: new globalThis.Date(deviceNow - 60_000).toISOString()
    }),
    roleOptions: [openRole]
  });

  assert.equal(slowDeviceVm.isSessionStarted(), true);
  assert.equal(slowDeviceVm.roleCards[0].claimable, true);
  assert.equal(slowDeviceVm.roleCards[0].stateKind, "available");
  assert.equal(fastDeviceVm.isSessionStarted(), false);
  assert.equal(fastDeviceVm.roleCards[0].claimable, false);
  assert.equal(fastDeviceVm.roleCards[0].stateKind, "unavailable");
});

test("a hidden direct seat claim defers all result effects until onShow reconciliation", async () => {
  const claimStarted = deferred();
  const claimResponse = deferred();
  const subscriptions = [];
  const redirects = [];
  const toasts = [];
  let getCount = 0;
  const component = loadSharePageComponent({
    request: async ({ url, method = "GET" }) => {
      if (url.includes("/claim") && method === "POST") {
        claimStarted.resolve();
        return claimResponse.promise;
      }
      if (method === "GET") {
        getCount += 1;
        return {
          data: sessionResponse({
            has_started: true,
            start_at: new Date(Date.now() - 1_000).toISOString()
          })
        };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    },
    requestSubscriptionAfterConfirmedJoin: (...args) => subscriptions.push(args),
    showToast: (options) => toasts.push(options),
    uni: {
      hideShareMenu: ({ complete } = {}) => complete?.(),
      redirectTo: (options) => redirects.push(options),
      setNavigationBarTitle() {}
    }
  });
  const role = {
    id: "5",
    seatId: 5,
    name: "侦探",
    status: "open",
    roleGender: "unlimited"
  };
  const vm = createSharePageVm(component, {
    sessionId: "42",
    currentUserId: "7",
    inviteToken: "existing-token",
    sessionLoaded: true,
    session: sessionResponse({
      join_policy: "direct",
      has_started: true,
      active_album_photo_count: 1
    }),
    pendingRole: role,
    statusText: "before-claim"
  });

  const action = vm.claimSeat(role);
  await claimStarted.promise;
  component.onHide.call(vm);
  claimResponse.resolve({ data: { join_result: "joined" } });
  await action;

  assert.equal(subscriptions.length, 0);
  assert.equal(redirects.length, 0);
  assert.equal(toasts.length, 0);
  assert.equal(getCount, 0);
  assert.equal(vm.statusText, "before-claim");
  assert.equal(vm.pendingRole, role);

  await component.onShow.call(vm);
  assert.equal(getCount, 1, "the next visible generation must reconcile the server mutation");
  assert.equal(vm.sessionLoaded, true);
});

test("an unloaded NPC claim cannot subscribe, refresh, navigate, or update result UI", async () => {
  const claimStarted = deferred();
  const claimResponse = deferred();
  const subscriptions = [];
  const redirects = [];
  const toasts = [];
  let getCount = 0;
  const component = loadSharePageComponent({
    ensureLoggedIn: async () => ({
      token: "auth-token",
      user: { id: 7, gender: "male" }
    }),
    getCurrentUser: () => ({ user: { id: 7, gender: "male" } }),
    getToken: () => "auth-token",
    request: async ({ url, method = "GET" }) => {
      if (url.includes("/api/session-npc-roles/") && method === "POST") {
        claimStarted.resolve();
        return claimResponse.promise;
      }
      if (method === "GET") {
        getCount += 1;
        return { data: sessionResponse({ has_started: true }) };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    },
    requestSubscriptionAfterConfirmedJoin: (...args) => subscriptions.push(args),
    showToast: (options) => toasts.push(options),
    uni: {
      hideShareMenu: ({ complete } = {}) => complete?.(),
      redirectTo: (options) => redirects.push(options),
      setNavigationBarTitle() {}
    }
  });
  const vm = createSharePageVm(component, {
    sessionId: "42",
    currentUserId: "7",
    currentAuthPrincipal: "user:7",
    sessionLoaded: true,
    session: sessionResponse({
      join_policy: "direct",
      has_started: true,
      active_album_photo_count: 1,
      session_npc_roles: [
        {
          id: 9,
          name: "管家",
          role_gender: "unlimited",
          status: "active",
          bound_user_id: null,
          pending_signup_user_id: null
        }
      ]
    }),
    statusText: "before-npc-claim"
  });
  const npcRole = vm.npcRoleCards[0];

  const action = vm.chooseNpcRole(npcRole);
  await claimStarted.promise;
  assert.equal(vm.roleSelectionSubmitting, true);
  component.onUnload.call(vm);
  assert.equal(
    vm.roleSelectionSubmitting,
    false,
    "unload must immediately release local action state"
  );
  claimResponse.resolve({ data: { join_result: "npc_joined" } });
  await action;

  assert.equal(subscriptions.length, 0);
  assert.equal(redirects.length, 0);
  assert.equal(toasts.length, 0);
  assert.equal(getCount, 0);
  assert.equal(vm.statusText, "before-npc-claim");
});

test("top-right sharing stays hidden after a published-session load failure", async () => {
  const hiddenMenus = [];
  const shownMenus = [];
  const scheduled = [];
  let loadAttempts = 0;
  const component = loadSharePageComponent({
    request: async ({ method = "GET" }) => {
      if (method === "POST") {
        return { data: { token: "retried-token" } };
      }
      loadAttempts += 1;
      if (loadAttempts === 1) {
        throw new Error("load failed");
      }
      return { data: sessionResponse() };
    },
    showWechatShareMenus: (options) => shownMenus.push(options),
    uni: {
      hideShareMenu: (options = {}) => {
        hiddenMenus.push(options.menus);
        options.complete?.();
      },
      setNavigationBarTitle() {}
    },
    setTimeout: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimeout() {}
  });
  const vm = createSharePageVm(component, { sessionId: "42" });

  await vm.refreshPublishedShareState();

  assert.equal(vm.shareReady, false);
  assert.equal(shownMenus.length, 0);
  assert.deepEqual(hiddenMenus.at(-1), ["shareAppMessage", "shareTimeline"]);

  await vm.retryLoadSession();
  assert.equal(vm.shareReady, true);
  assert.equal(shownMenus.length, 1);
  assert.equal(scheduled.length, 1, "successful retry must restore the start-boundary refresh");
});

test("top-right sharing stays hidden on token failure and reappears after token retry succeeds", async () => {
  const hiddenMenus = [];
  const shownMenus = [];
  let tokenAttempts = 0;
  const component = loadSharePageComponent({
    request: async ({ method = "GET" }) => {
      if (method !== "POST") {
        return {
          data: sessionResponse({
            has_started: true,
            start_at: new Date(Date.now() - 1_000).toISOString()
          })
        };
      }
      tokenAttempts += 1;
      if (tokenAttempts === 1) {
        throw new Error("token failed");
      }
      return { data: { token: "retried-token" } };
    },
    showWechatShareMenus: (options) => shownMenus.push(options),
    uni: {
      hideShareMenu: (options = {}) => {
        hiddenMenus.push(options.menus);
        options.complete?.();
      },
      setNavigationBarTitle() {}
    },
    setTimeout: () => 1,
    clearTimeout() {}
  });
  const vm = createSharePageVm(component, {
    sessionId: "42",
    currentUserId: "7"
  });

  await vm.refreshPublishedShareState();
  assert.equal(vm.shareReady, false);
  assert.equal(vm.invitePrepareError, true);
  assert.equal(shownMenus.length, 0);
  assert.deepEqual(hiddenMenus.at(-1), ["shareAppMessage", "shareTimeline"]);

  await vm.retryPrepareInvite();
  assert.equal(vm.shareReady, true);
  assert.equal(vm.invitePrepareError, false);
  assert.equal(shownMenus.length, 1);
});

test("top-right sharing appears for a loaded public preview with a valid route token", async () => {
  const hiddenMenus = [];
  const shownMenus = [];
  const component = loadSharePageComponent({
    request: async () => ({
      data: sessionResponse({
        access_scope: "invite_preview",
        has_started: true,
        start_at: new Date(Date.now() - 1_000).toISOString()
      })
    }),
    showWechatShareMenus: (options) => shownMenus.push(options),
    uni: {
      hideShareMenu: (options = {}) => {
        hiddenMenus.push(options.menus);
        options.complete?.();
      },
      setNavigationBarTitle() {}
    }
  });
  const vm = createSharePageVm(component, {
    sessionId: "42",
    inviteToken: "route-token"
  });

  await vm.refreshPublishedShareState();

  assert.equal(vm.shareReady, true);
  assert.equal(shownMenus.length, 1);
  assert.deepEqual(hiddenMenus.at(-1), ["shareTimeline"]);
});

test("a stale hideShareMenu completion cannot re-enable sharing after readiness changes", () => {
  const completions = [];
  const shownMenus = [];
  const component = loadSharePageComponent({
    showWechatShareMenus: (options) => shownMenus.push(options),
    uni: {
      hideShareMenu: (options = {}) => {
        if (typeof options.complete === "function") {
          completions.push(options.complete);
        }
      },
      setNavigationBarTitle() {}
    }
  });
  const vm = createSharePageVm(component, {
    sessionId: "42",
    sessionLoaded: true,
    session: sessionResponse({
      has_started: true,
      start_at: new Date(Date.now() - 1_000).toISOString()
    }),
    inviteToken: "first-token"
  });

  vm.showShareMenus();
  assert.equal(completions.length, 1);

  vm.inviteToken = "";
  vm.showShareMenus();
  vm.inviteToken = "replacement-token";
  vm.showShareMenus();
  assert.equal(completions.length, 2);

  completions[0]();
  assert.equal(
    shownMenus.length,
    0,
    "an obsolete completion must remain invalid even after readiness returns"
  );
  completions[1]();
  assert.equal(shownMenus.length, 1);
});

test("onUnload invalidates a delayed ready-menu completion", () => {
  const completions = [];
  const hiddenMenus = [];
  const shownMenus = [];
  const component = loadSharePageComponent({
    showWechatShareMenus: (options) => shownMenus.push(options),
    uni: {
      hideShareMenu: (options = {}) => {
        hiddenMenus.push(options.menus);
        if (typeof options.complete === "function") {
          completions.push(options.complete);
        }
      },
      setNavigationBarTitle() {}
    }
  });
  const vm = createSharePageVm(component, {
    sessionId: "42",
    sessionLoaded: true,
    session: sessionResponse({
      has_started: true,
      start_at: new Date(Date.now() - 1_000).toISOString()
    }),
    inviteToken: "ready-token"
  });

  vm.showShareMenus();
  assert.equal(completions.length, 1);

  const hidesBeforeNavigation = hiddenMenus.length;
  component.onUnload.call(vm);
  assert.equal(hiddenMenus.length, hidesBeforeNavigation + 1);
  completions[0]();

  assert.equal(shownMenus.length, 0);
  assert.equal(vm.shareReady, false);
});

test("the native open-type share button is absent until shareReady is true", () => {
  const source = fs.readFileSync(sharePagePath, "utf8");
  const { descriptor, errors } = parseSfc(source, { filename: sharePagePath.pathname });
  assert.deepEqual(errors, []);
  const template = descriptor.template?.content || "";
  const nativeShareButton =
    template.match(/<button\b[^>]*\bopen-type=["']share["'][^>]*>/)?.[0] || "";

  assert.match(
    nativeShareButton,
    /\bv-else-if=["']shareReady["']/,
    "the native share surface must only be rendered in the ready branch"
  );
  assert.doesNotMatch(nativeShareButton, /:disabled=["']!shareReady["']/);
  assert.match(
    template,
    /<view\b(?=[^>]*\bv-else\b)(?=[^>]*\bwechat-action-preparing\b)(?![^>]*\bopen-type=)[^>]*>[\s\S]*?分享准备中/,
    "the not-ready branch must be a non-interactive preparation control"
  );
});

test("cancelled sessions render a permanent unshareable state without preparing a token", async () => {
  let tokenRequests = 0;
  const hiddenMenus = [];
  const component = loadSharePageComponent({
    request: async ({ method = "GET" }) => {
      if (method === "POST") {
        tokenRequests += 1;
        return { data: { token: "must-not-be-minted" } };
      }
      return {
        data: sessionResponse({
          status: "cancelled",
          has_started: false
        })
      };
    },
    uni: {
      hideShareMenu: (options = {}) => {
        hiddenMenus.push(options.menus);
        options.complete?.();
      },
      setNavigationBarTitle() {}
    },
    setTimeout: () => 1,
    clearTimeout() {}
  });
  const vm = createSharePageVm(component, {
    sessionId: "42",
    currentUserId: "7"
  });

  await vm.refreshPublishedShareState();

  assert.equal(tokenRequests, 0);
  assert.equal(vm.shareUnavailableText, "车局已取消，无法分享");
  assert.equal(vm.shareReady, false);
  assert.equal(vm.invitePrepareError, false);
  assert.notEqual(vm.statusText, "分享准备失败，请重试。");
  assert.deepEqual(hiddenMenus.at(-1), ["shareAppMessage", "shareTimeline"]);

  const source = fs.readFileSync(sharePagePath, "utf8");
  assert.match(
    source,
    /v-if="shareUnavailableText"[\s\S]*\{\{\s*shareUnavailableText\s*\}\}/
  );
});

test("a cancellation conflict between session GET and token POST becomes permanent", async () => {
  const hiddenMenus = [];
  let getCount = 0;
  let tokenRequests = 0;
  const component = loadSharePageComponent({
    request: async ({ method = "GET" }) => {
      if (method === "POST") {
        tokenRequests += 1;
        const error = new Error("Cancelled sessions cannot create join invitation tokens");
        error.statusCode = 409;
        throw error;
      }
      getCount += 1;
      return {
        data: sessionResponse({
          status: "recruiting",
          has_started: false
        })
      };
    },
    uni: {
      hideShareMenu: (options = {}) => {
        hiddenMenus.push(options.menus);
        options.complete?.();
      },
      setNavigationBarTitle() {}
    },
    setTimeout: () => 1,
    clearTimeout() {}
  });
  const vm = createSharePageVm(component, {
    sessionId: "42",
    currentUserId: "7"
  });

  await vm.refreshPublishedShareState();

  assert.equal(getCount, 1);
  assert.equal(tokenRequests, 1);
  assert.equal(vm.session.status, "cancelled");
  assert.equal(vm.shareUnavailableText, "车局已取消，无法分享");
  assert.equal(vm.shareReady, false);
  assert.equal(vm.invitePrepareError, false);
  assert.equal(vm.showInviteRetry, false);
  assert.equal(vm.statusText, "车局已取消，无法分享");
  assert.deepEqual(hiddenMenus.at(-1), ["shareAppMessage", "shareTimeline"]);
});
