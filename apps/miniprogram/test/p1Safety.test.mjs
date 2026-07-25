import assert from "node:assert/strict";
import test from "node:test";

async function optionalImport(path) {
  try {
    return await import(path);
  } catch (error) {
    return {};
  }
}

test("creation keys are stable, bounded and non-empty", async () => {
  const createFlow = await optionalImport("../src/utils/createFlow.js");
  assert.equal(typeof createFlow.createSessionCreationKey, "function");
  const first = createFlow.createSessionCreationKey(123456, 0.25);
  const second = createFlow.createSessionCreationKey(123456, 0.25);
  assert.equal(first, second);
  assert.match(first, /^session-/);
  assert.ok(first.length <= 128);
});

test("only authentication failures permanently hide chat", async () => {
  const safety = await optionalImport("../src/utils/p1Safety.js");
  assert.equal(typeof safety.isChatAccessDeniedError, "function");
  assert.equal(safety.isChatAccessDeniedError({ statusCode: 401 }), true);
  assert.equal(safety.isChatAccessDeniedError({ statusCode: 403 }), true);
  assert.equal(safety.isChatAccessDeniedError({ statusCode: 500 }), false);
  assert.equal(safety.isChatAccessDeniedError(null), false);
});

test("privacy cannot be saved before a successful load", async () => {
  const safety = await optionalImport("../src/utils/p1Safety.js");
  assert.equal(typeof safety.canSaveAlbumPrivacy, "function");
  assert.equal(
    safety.canSaveAlbumPrivacy({ loaded: false, saving: false, sessionId: 7 }),
    false
  );
  assert.equal(
    safety.canSaveAlbumPrivacy({ loaded: true, saving: false, sessionId: 7 }),
    true
  );
  assert.equal(
    safety.canSaveAlbumPrivacy({ loaded: true, saving: true, sessionId: 7 }),
    false
  );
  assert.equal(
    safety.canSaveAlbumPrivacy({ loaded: true, saving: false, sessionId: "" }),
    false
  );
});

test("album loading, failure and true empty states are distinct", async () => {
  const safety = await optionalImport("../src/utils/p1Safety.js");
  assert.equal(typeof safety.albumListPresentation, "function");
  assert.equal(
    safety.albumListPresentation({ loading: true, failed: false, count: 0 }),
    "loading"
  );
  assert.equal(
    safety.albumListPresentation({ loading: false, failed: true, count: 0 }),
    "error"
  );
  assert.equal(
    safety.albumListPresentation({ loading: false, failed: false, count: 0 }),
    "empty"
  );
  assert.equal(
    safety.albumListPresentation({ loading: false, failed: false, count: 3 }),
    "content"
  );
});

test("public album access requires both session and share token", async () => {
  const safety = await optionalImport("../src/utils/p1Safety.js");
  assert.equal(typeof safety.hasPublicAlbumAccessCredentials, "function");
  assert.equal(safety.hasPublicAlbumAccessCredentials("12", "share-token"), true);
  assert.equal(safety.hasPublicAlbumAccessCredentials("", "share-token"), false);
  assert.equal(safety.hasPublicAlbumAccessCredentials("12", ""), false);
  assert.equal(safety.hasPublicAlbumAccessCredentials(null, null), false);
});

test("only forbidden public album responses are unrecoverable", async () => {
  const safety = await optionalImport("../src/utils/p1Safety.js");
  assert.equal(typeof safety.isUnavailablePublicAlbumError, "function");
  assert.equal(safety.isUnavailablePublicAlbumError({ statusCode: 403 }), true);
  assert.equal(safety.isUnavailablePublicAlbumError({ statusCode: 500 }), false);
  assert.equal(safety.isUnavailablePublicAlbumError({ statusCode: 0 }), false);
  assert.equal(safety.isUnavailablePublicAlbumError(null), false);
});

test("NPC bindings do not count as other onboard players", async () => {
  const membership = await optionalImport("../src/utils/sessionMembership.js");
  assert.equal(typeof membership.otherOnboardSeatMemberCount, "function");
  assert.equal(
    membership.otherOnboardSeatMemberCount({
      organizer_user_id: 7,
      seats: [],
      session_npc_roles: [{ status: "active", bound_user_id: 8 }]
    }),
    0
  );
  assert.equal(
    membership.otherOnboardSeatMemberCount({
      organizer_user_id: 7,
      seats: [
        { status: "confirmed", confirmed_user_id: 7 },
        { status: "locked", confirmed_user_id: 8 },
        { status: "confirmed", confirmed_user_id: 8 }
      ]
    }),
    1
  );
});
