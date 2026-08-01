# Historical Session Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Fix the time picker so future dates allow any time, and add a secure historical-record mode for backfilling completed sessions and inviting former players to reclaim roles.

**Architecture:** Persist session_purpose as future_carpool or historical_record instead of deriving creation intent from elapsed time. A shared pure module classifies Beijing wall time; API transaction boundaries enforce creation, publication, recruitment, invitation, and role-claim rules; the mini program renders purpose-specific setup, sharing, status, and copy while reusing the existing post-start album and review ACLs.

**Tech Stack:** Node.js ESM, node:test, MySQL migrations and mysql2 transactions, UniApp/Vue, TDesign Mini Program picker, HMAC capability tokens.

---

## Scope and file map

All commands run from:

    /Users/dirui/Documents/pinche/.worktrees/historical-session-backfill

New focused files:

- packages/shared/src/sessionPurpose.js: cross-runtime purpose constants and time classification.
- packages/shared/test/sessionPurpose.test.mjs: deterministic Beijing-time boundary tests.
- apps/api/migrations/0036_historical_session_backfill.sql: durable purpose column and public-list index.
- apps/api/test/historical-session-migration.test.mjs: migration contract.
- apps/api/src/modules/core/session-purpose.js: HTTP-safe API normalization and mismatch errors.
- apps/api/test/session-purpose.test.mjs: server creation-time normalization.
- apps/api/src/modules/security/signed-payload.js: testable HMAC sign/verify primitive extracted from server.js.
- apps/api/src/modules/core/historical-invite-token.js: purpose-scoped historical token codec.
- apps/api/test/historical-invite-token.test.mjs: tamper, expiry, and namespace isolation.
- apps/api/test/historical-session-service.test.mjs: creation, publish, join guards, and claim transaction.
- apps/api/test/historical-session-routes.test.mjs: route and query-parameter wiring contract.
- apps/miniprogram/src/utils/sessionSetup.js: picker bounds, submit reclassification, safe payload/copy helpers.
- apps/miniprogram/test/sessionSetup.test.mjs: setup regression tests.
- apps/miniprogram/src/utils/sessionShareInvite.js: normal-versus-historical invite queries and claim requests.
- apps/miniprogram/test/sessionShareInvite.test.mjs: proof that historical claims never construct ordinary signup endpoints.
- scripts/historical-session-backfill-check.js: cross-file static contract.
- scripts/historical-session-backfill-smoke.js: live API lifecycle and concurrent-claim smoke.

Existing files modified:

- packages/shared/src/index.js
- apps/api/src/modules/core/service.js
- apps/api/src/server.js
- apps/api/src/modules/content-moderation/text-boundaries.js
- apps/api/src/modules/content-moderation/text-author-projection.js
- apps/api/test/content-moderation-author-text-projection.test.mjs
- apps/api/test/content-moderation-text-boundaries.test.mjs
- apps/api/test/content-moderation-author-text-action-matrix.test.mjs
- apps/api/test/session-reschedule-legacy-patch.test.mjs
- apps/miniprogram/src/utils/createFlow.js
- apps/miniprogram/src/utils/authorPrivateText.js
- apps/miniprogram/src/pages/session/setup.vue
- apps/miniprogram/src/pages/session/share.vue
- apps/miniprogram/src/pages/session/detail.vue
- apps/miniprogram/src/pages/session/manage.vue
- apps/miniprogram/src/pages/session/album.vue
- apps/miniprogram/src/components/SessionCalendar.vue
- apps/miniprogram/src/extensions/session-pseudo-chat/ManagePinnedMessage.vue
- package.json

The API and UI changes are sequential parts of one feature: without the API guards, opening past dates is unsafe; without the UI branch, the secure historical endpoints are unusable.

### Task 1: Add the shared session-purpose model

**Files:**
- Create: packages/shared/src/sessionPurpose.js
- Create: packages/shared/test/sessionPurpose.test.mjs
- Modify: packages/shared/src/index.js

- [ ] **Step 1: Write the failing shared tests**

Create the test with these exact boundary assertions:

~~~js
import assert from "node:assert/strict";
import test from "node:test";
import {
  FUTURE_CARPOOL,
  HISTORICAL_RECORD,
  isHistoricalSession,
  normalizeSessionPurpose,
  sessionPurposeForStartAt
} from "../src/sessionPurpose.js";

const NOW = new Date("2026-07-31T09:00:00.000Z");

test("future dates may use an earlier clock time", () => {
  assert.equal(sessionPurposeForStartAt("2026-08-03 13:00:00", NOW), FUTURE_CARPOOL);
});

test("equal and past instants are historical while one second later is future", () => {
  assert.equal(sessionPurposeForStartAt("2026-07-31 17:00:00", NOW), HISTORICAL_RECORD);
  assert.equal(sessionPurposeForStartAt("2026-07-31 16:59:59", NOW), HISTORICAL_RECORD);
  assert.equal(sessionPurposeForStartAt("2026-07-31 17:00:01", NOW), FUTURE_CARPOOL);
});

test("invalid dates fail closed", () => {
  assert.equal(sessionPurposeForStartAt("2026-02-30 13:00:00", NOW), null);
  assert.equal(sessionPurposeForStartAt("", NOW), null);
});

test("stored purpose is explicit and backward compatible", () => {
  assert.equal(normalizeSessionPurpose(), FUTURE_CARPOOL);
  assert.equal(normalizeSessionPurpose(HISTORICAL_RECORD), HISTORICAL_RECORD);
  assert.equal(normalizeSessionPurpose(""), null);
  assert.equal(normalizeSessionPurpose(null), null);
  assert.equal(normalizeSessionPurpose("unknown"), null);
  assert.equal(isHistoricalSession({ session_purpose: HISTORICAL_RECORD }), true);
  assert.equal(isHistoricalSession({ sessionPurpose: HISTORICAL_RECORD }), true);
  assert.equal(isHistoricalSession({}), false);
});
~~~

- [ ] **Step 2: Run the test and verify RED**

Run:

    node --test packages/shared/test/sessionPurpose.test.mjs

Expected: FAIL with ERR_MODULE_NOT_FOUND for sessionPurpose.js.

- [ ] **Step 3: Implement the shared module and export it**

Create packages/shared/src/sessionPurpose.js:

~~~js
import { parseBusinessDateTime } from "./beijingTime.js";

export const FUTURE_CARPOOL = "future_carpool";
export const HISTORICAL_RECORD = "historical_record";
export const SESSION_PURPOSES = Object.freeze([FUTURE_CARPOOL, HISTORICAL_RECORD]);

export function normalizeSessionPurpose(value = FUTURE_CARPOOL) {
  const normalized = String(value ?? "").trim();
  return SESSION_PURPOSES.includes(normalized) ? normalized : null;
}

export function sessionPurposeForStartAt(startAt, now = new Date()) {
  const start = parseBusinessDateTime(startAt);
  const current = parseBusinessDateTime(now);
  if (!start || !current) return null;
  return start.getTime() > current.getTime() ? FUTURE_CARPOOL : HISTORICAL_RECORD;
}

export function sessionPurposeOf(session = {}) {
  return normalizeSessionPurpose(session.session_purpose ?? session.sessionPurpose);
}

export function isHistoricalSession(session = {}) {
  return sessionPurposeOf(session) === HISTORICAL_RECORD;
}
~~~

Append this export to packages/shared/src/index.js:

~~~js
export * from "./sessionPurpose.js";
~~~

- [ ] **Step 4: Run the shared test and existing time tests**

Run:

    node --test packages/shared/test/sessionPurpose.test.mjs packages/shared/test/beijingTime.test.mjs

Expected: all tests PASS.

- [ ] **Step 5: Commit**

    git add packages/shared/src/sessionPurpose.js packages/shared/src/index.js packages/shared/test/sessionPurpose.test.mjs
    git commit -m "feat(shared): classify session creation purpose"

### Task 2: Add the durable database purpose

**Files:**
- Create: apps/api/migrations/0036_historical_session_backfill.sql
- Create: apps/api/test/historical-session-migration.test.mjs

- [ ] **Step 1: Write the failing migration contract**

~~~js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("historical-session migration adds a safe compatible purpose", async () => {
  const sql = await readFile(
    new URL("../migrations/0036_historical_session_backfill.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /session_purpose VARCHAR\(32\) NOT NULL DEFAULT 'future_carpool'/);
  assert.match(sql, /idx_sessions_public_purpose_status_start/);
  assert.doesNotMatch(sql, /UPDATE\s+sessions/i);
});
~~~

- [ ] **Step 2: Run the test and verify RED**

Run:

    node --test apps/api/test/historical-session-migration.test.mjs

Expected: FAIL with ENOENT for migration 0033.

- [ ] **Step 3: Add the idempotent migration**

Use the repository information_schema plus PREPARE pattern:

~~~sql
SET @session_purpose_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sessions'
    AND COLUMN_NAME = 'session_purpose'
);
SET @session_purpose_sql = IF(
  @session_purpose_exists = 0,
  'ALTER TABLE sessions ADD COLUMN session_purpose VARCHAR(32) NOT NULL DEFAULT ''future_carpool'' AFTER start_at',
  'SELECT 1'
);
PREPARE session_purpose_statement FROM @session_purpose_sql;
EXECUTE session_purpose_statement;
DEALLOCATE PREPARE session_purpose_statement;

SET @session_purpose_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sessions'
    AND INDEX_NAME = 'idx_sessions_public_purpose_status_start'
);
SET @session_purpose_index_sql = IF(
  @session_purpose_index_exists = 0,
  'ALTER TABLE sessions ADD INDEX idx_sessions_public_purpose_status_start (session_purpose, visibility, status, start_at)',
  'SELECT 1'
);
PREPARE session_purpose_index_statement FROM @session_purpose_index_sql;
EXECUTE session_purpose_index_statement;
DEALLOCATE PREPARE session_purpose_index_statement;
~~~

- [ ] **Step 4: Verify migration contract and API syntax**

Run:

    node --test apps/api/test/historical-session-migration.test.mjs
    npm --workspace apps/api run check

Expected: PASS and API syntax check passed.

- [ ] **Step 5: Commit**

    git add apps/api/migrations/0036_historical_session_backfill.sql apps/api/test/historical-session-migration.test.mjs
    git commit -m "feat(api): persist session purpose"

### Task 3: Enforce purpose and time at creation

**Files:**
- Create: apps/api/src/modules/core/session-purpose.js
- Create: apps/api/test/session-purpose.test.mjs
- Create: apps/api/test/historical-session-service.test.mjs
- Modify: apps/api/src/modules/core/service.js
- Modify: apps/api/src/modules/content-moderation/text-boundaries.js
- Modify: apps/api/src/modules/content-moderation/text-author-projection.js
- Modify: apps/api/src/server.js
- Modify: apps/api/test/content-moderation-author-text-projection.test.mjs
- Modify: apps/api/test/content-moderation-text-boundaries.test.mjs
- Modify: apps/api/test/content-moderation-author-text-action-matrix.test.mjs

- [ ] **Step 1: Write failing API normalizer tests**

Test normalizeSessionCreationStartAt with future, historical, invalid purpose, invalid date, default purpose, Shanghai wall time, and mismatch:

~~~js
import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSessionCreationStartAt
} from "../src/modules/core/session-purpose.js";

const NOW = new Date("2026-07-31T09:00:00.500Z");

test("normalizes Shanghai wall time to MySQL second precision", () => {
  assert.deepEqual(
    normalizeSessionCreationStartAt(
      "2026-08-03 13:00:00",
      "future_carpool",
      NOW
    ),
    {
      date: new Date("2026-08-03T05:00:00.000Z"),
      canonical: "2026-08-03T05:00:00.000Z",
      sessionPurpose: "future_carpool"
    }
  );
});

test("rejects purpose and time mismatches with a stable code", () => {
  assert.throws(
    () => normalizeSessionCreationStartAt("2026-07-30 13:00:00", "future_carpool", NOW),
    { code: "SESSION_PURPOSE_TIME_MISMATCH", statusCode: 409 }
  );
  assert.throws(
    () => normalizeSessionCreationStartAt("2026-08-03 13:00:00", "historical_record", NOW),
    { code: "SESSION_PURPOSE_TIME_MISMATCH", statusCode: 409 }
  );
});

test("rejects invalid purpose and invalid calendar time", () => {
  assert.throws(
    () => normalizeSessionCreationStartAt("2026-08-03 13:00:00", "other", NOW),
    { code: "INVALID_SESSION_PURPOSE", statusCode: 400 }
  );
  assert.throws(
    () => normalizeSessionCreationStartAt("2026-08-03 13:00:00", "", NOW),
    { code: "INVALID_SESSION_PURPOSE", statusCode: 400 }
  );
  assert.throws(
    () => normalizeSessionCreationStartAt("2026-08-03 13:00:00", null, NOW),
    { code: "INVALID_SESSION_PURPOSE", statusCode: 400 }
  );
  assert.throws(
    () => normalizeSessionCreationStartAt("2026-02-30 13:00:00", "historical_record", NOW),
    { code: "INVALID_START_AT", statusCode: 400 }
  );
});
~~~

- [ ] **Step 2: Run and verify RED**

Run:

    node --test apps/api/test/session-purpose.test.mjs

Expected: FAIL with ERR_MODULE_NOT_FOUND.

- [ ] **Step 3: Implement API-safe normalization**

Create apps/api/src/modules/core/session-purpose.js using parseBusinessDateTime, normalizeSessionPurpose, and AppError. Export `normalizeSessionCreationStartAt(startAt, sessionPurpose, now = new Date())`; `now` is a Date in production and tests. It must truncate the selected start to whole seconds, default only an omitted/undefined purpose to future_carpool, and throw these exact public errors:

~~~js
new AppError(400, "INVALID_SESSION_PURPOSE", "sessionPurpose is invalid")
new AppError(400, "INVALID_START_AT", "startAt must be a valid business timestamp")
new AppError(409, "SESSION_PURPOSE_TIME_MISMATCH", "startAt no longer matches sessionPurpose", {
  expectedSessionPurpose
})
~~~

- [ ] **Step 4: Verify the normalizer is GREEN**

Run:

    node --test apps/api/test/session-purpose.test.mjs

Expected: PASS.

- [ ] **Step 5: Add failing creation and moderation assertions**

Extend the content-moderation projection fixtures so create_session contains:

~~~js
sessionPurpose: "historical_record"
~~~

and assert it survives descriptor payload, author-private projection, and approved proposal application. Add a fake-connection test in apps/api/test/historical-session-service.test.mjs asserting historical creation binds:

~~~js
assert.equal(insert.values.includes("historical_record"), true);
assert.equal(insert.values.includes("share_only"), true);
assert.equal(insert.values.includes("review_required"), true);
assert.equal(insert.values.includes(0), true);
~~~

The same test must assert a future session keeps requested public visibility and recruitment settings. Add historical cases proving `dmUserId`/`dm_user_id`, `npcUserId`/`npc_user_id`, and `extraNpcRoles`/`extra_npc_roles` entries containing non-null `boundUserId`, `bound_user_id`, `userId`, or `user_id` are rejected with `HISTORICAL_MEMBER_PREBIND_FORBIDDEN` before the session INSERT; an unbound extra NPC role remains valid.

- [ ] **Step 6: Run the creation tests and verify RED**

Run:

    node --test apps/api/test/historical-session-service.test.mjs apps/api/test/content-moderation-author-text-projection.test.mjs apps/api/test/content-moderation-text-boundaries.test.mjs apps/api/test/content-moderation-author-text-action-matrix.test.mjs

Expected: failures show sessionPurpose is dropped and INSERT lacks session_purpose.

- [ ] **Step 7: Wire purpose into creation**

In createSessionWithConnection:

- call normalizeSessionCreationStartAt before INSERT;
- insert both start_at and session_purpose;
- bind the normalized Date, never the raw startAt string;
- force historical visibility to share_only, join policy to review_required, join phone required to 0, and NPC self-join to 0;
- reject historical dmUserId/dm_user_id, npcUserId/npc_user_id, and pre-bound extra NPC roles with `new AppError(400, "HISTORICAL_MEMBER_PREBIND_FORBIDDEN", "Historical members must claim a role through a historical invitation")` before INSERT;
- retain normal requested settings for future_carpool.

Add sessionPurpose to create_session payload allowlists in text-boundaries.js and text-author-projection.js. Add session_purpose to sessionTextSnapshot in server.js so moderation stale checks include the immutable purpose.

- [ ] **Step 8: Run creation, moderation, and syntax tests**

Run:

    node --test apps/api/test/session-purpose.test.mjs apps/api/test/historical-session-service.test.mjs apps/api/test/content-moderation-author-text-projection.test.mjs apps/api/test/content-moderation-text-boundaries.test.mjs apps/api/test/content-moderation-author-text-action-matrix.test.mjs
    npm --workspace apps/api run check

Expected: all PASS.

- [ ] **Step 9: Commit**

    git add apps/api/src/modules/core/session-purpose.js apps/api/src/modules/core/service.js apps/api/src/modules/content-moderation/text-boundaries.js apps/api/src/modules/content-moderation/text-author-projection.js apps/api/src/server.js apps/api/test/session-purpose.test.mjs apps/api/test/historical-session-service.test.mjs apps/api/test/content-moderation-author-text-projection.test.mjs apps/api/test/content-moderation-text-boundaries.test.mjs apps/api/test/content-moderation-author-text-action-matrix.test.mjs
    git commit -m "feat(api): validate historical session creation"

### Task 4: Publish historical records atomically

**Files:**
- Modify: apps/api/src/modules/core/service.js
- Modify: apps/api/src/server.js
- Modify: apps/api/test/historical-session-service.test.mjs

- [ ] **Step 1: Add failing publish transaction tests**

Expose publishSessionWithConnection and cover:

- historical publish without creatorSeatId performs no mutation and returns 400;
- creatorSeatId from another session performs no mutation;
- an occupied or non-open creatorSeatId from the same session performs no mutation;
- an UPDATE result with affectedRows other than 1 aborts before signup/session mutation and rolls the transaction back;
- successful history publish binds the organizer, upserts an approved seat signup with review_eligible_at, and sets session status to locked;
- normal publish still sets recruiting and rejects creatorSeatId;
- a non-draft session cannot be published twice.

Assert lock order from recorded normalized SQL:

~~~js
assert.match(calls[0].sql, /FROM sessions .* FOR UPDATE$/);
assert.match(calls[1].sql, /FROM session_seats .* ORDER BY id FOR UPDATE$/);
~~~

- [ ] **Step 2: Run the service test and verify RED**

Run:

    node --test apps/api/test/historical-session-service.test.mjs

Expected: FAIL because publishSessionWithConnection is not exported and history follows recruiting.

- [ ] **Step 3: Implement the publish branch**

Export `publishSessionWithConnection(connection, user, sessionId, body = {})` as the connection-bound implementation. It must lock the session first and the session seats second, validate that the selected seat belongs to this session and is open with no confirmed user before the first mutation, require the seat UPDATE result to have `affectedRows === 1`, and execute the historical mutations below in that same connection. A zero-row UPDATE throws 409 before the signup/session writes so the wrapper rolls the transaction back. Keep `publishSession` as this exact transaction wrapper:

~~~js
export async function publishSession(user, sessionId, body = {}) {
  return withTransaction((connection) =>
    publishSessionWithConnection(connection, user, sessionId, body)
  );
}
~~~

The historical branch must execute these mutations in the same transaction:

~~~sql
UPDATE session_seats
SET status = 'confirmed', confirmed_user_id = ?
WHERE id = ? AND session_id = ? AND status = 'open' AND confirmed_user_id IS NULL;

INSERT INTO signups
  (session_id, seat_id, session_npc_role_id, signup_type, user_id, note, status, review_eligible_at)
VALUES (?, ?, NULL, 'seat', ?, '车头创建历史补录时选择角色', 'approved', CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  status = 'approved',
  review_eligible_at = COALESCE(review_eligible_at, CURRENT_TIMESTAMP),
  user_hidden_at = NULL;

UPDATE sessions
SET status = 'locked', visibility = 'share_only',
    join_policy = 'review_required', join_phone_required = 0,
    npc_join_enabled = 0
WHERE id = ?;
~~~

Pass body through the publish route:

~~~js
data: await publishSession(user, publishSessionId, body)
~~~

- [ ] **Step 4: Run service and legacy publish checks**

Run:

    node --test apps/api/test/historical-session-service.test.mjs
    npm --workspace apps/api run check

Expected: PASS.

- [ ] **Step 5: Commit**

    git add apps/api/src/modules/core/service.js apps/api/src/server.js apps/api/test/historical-session-service.test.mjs
    git commit -m "feat(api): finalize historical sessions atomically"

### Task 5: Close lifecycle and ordinary recruitment bypasses

**Files:**
- Modify: apps/api/src/modules/core/service.js
- Modify: apps/api/test/historical-session-service.test.mjs
- Modify: apps/api/test/session-reschedule-legacy-patch.test.mjs

- [ ] **Step 1: Write failing guard tests**

Add tests that a historical session is rejected before mutation by:

- createSignup;
- claimSessionSeat;
- claimSessionNpcRole;
- approveSignup;
- createSessionNpcRoleWithConnection with each non-null alias: boundUserId, bound_user_id, userId, and user_id;
- updateSessionNpcRoleWithConnection with each non-null alias: boundUserId, bound_user_id, userId, and user_id;
- generic session PATCH with non-null dmUserId/dm_user_id or npcUserId/npc_user_id;
- normal join-invite issuance.

The ordinary join/signup/seat/NPC/invite cases must assert status 403 and code `HISTORICAL_ROLE_CLAIM_INVITE_REQUIRED`, proving the purpose guard ran before started/locked and target-specific exceptions. The generic owner-management prebinding cases assert 400 and `HISTORICAL_MEMBER_PREBIND_FORBIDDEN`.

Extend the PATCH tests:

~~~js
for (const field of ["sessionPurpose", "session_purpose"]) {
  test("legacy PATCH rejects immutable " + field, () => {
    assert.throws(
      () =>
        assertSessionPatchLifecycle(
          { session_purpose: "future_carpool", status: "recruiting" },
          { [field]: "historical_record" }
        ),
      { statusCode: 400 }
    );
  });
}
~~~

Also assert unknown status, draft to locked, and cancelled transitions fail; normal recruiting to locked remains valid.

- [ ] **Step 2: Run and verify RED**

Run:

    node --test apps/api/test/historical-session-service.test.mjs apps/api/test/session-reschedule-legacy-patch.test.mjs

Expected: failures show historical rows reach existing started/locked exceptions.

- [ ] **Step 3: Add purpose-first guards**

Every recruitment SELECT must include session.session_purpose. Before evaluating status exceptions, reject historical_record with:

~~~js
throw new AppError(
  403,
  "HISTORICAL_ROLE_CLAIM_INVITE_REQUIRED",
  "Historical sessions require a historical role-claim invitation"
);
~~~

Add assertSessionPatchLifecycle(currentSession, body):

- reject startAt/start_at;
- reject sessionPurpose/session_purpose;
- allow omitted or unchanged status;
- allow only future_carpool recruiting to locked through generic PATCH;
- reject recruitment-setting changes for historical_record;
- allow historical dm/npc user fields only when the requested value is null (unbinding), and reject every non-null camelCase or snake_case value;
- remove unrestricted status from updateAllowed unless the validated transition supplied it.

For createSessionNpcRoleWithConnection, normalize all four user-ID aliases, allow an unbound historical NPC role, and reject any non-null result supplied through the generic create endpoint. For updateSessionNpcRoleWithConnection, allow historical unbinding but reject a non-null result from any alias; historical binding belongs exclusively to the dedicated claim transaction.

Reuse `HISTORICAL_MEMBER_PREBIND_FORBIDDEN` for the generic session PATCH and NPC-role create/update guards so every organizer-side prebinding bypass has one stable 400 response.

- [ ] **Step 4: Run guards plus reschedule regression**

Run:

    node --test apps/api/test/historical-session-service.test.mjs apps/api/test/session-reschedule-legacy-patch.test.mjs apps/api/test/session-reschedule-service.test.mjs

Expected: PASS.

- [ ] **Step 5: Commit**

    git add apps/api/src/modules/core/service.js apps/api/test/historical-session-service.test.mjs apps/api/test/session-reschedule-legacy-patch.test.mjs
    git commit -m "fix(api): isolate historical sessions from recruitment"

### Task 6: Add a purpose-scoped historical invitation token

**Files:**
- Create: apps/api/src/modules/security/signed-payload.js
- Create: apps/api/src/modules/core/historical-invite-token.js
- Create: apps/api/test/historical-invite-token.test.mjs
- Modify: apps/api/src/server.js

- [ ] **Step 1: Write failing codec tests**

Tests must use a fixed secret and fixed clock and assert:

~~~js
const codec = createHistoricalInviteTokenCodec({
  secret: "test-secret",
  nowSeconds: () => 1_000
});
const token = codec.sign({ sessionId: 42, inviterUserId: 7, exp: 1_100 });
assert.deepEqual(codec.verify(token), {
  purpose: "historical_session_claim",
  sessionPurpose: "historical_record",
  sessionId: 42,
  inviterUserId: 7,
  exp: 1_100
});
assert.throws(() => codec.verify(token + "a"), { statusCode: 403 });
~~~

Add expiry, malformed payload, wrong purpose, wrong sessionPurpose, and a proof that verification under the ordinary session-join namespace fails.

- [ ] **Step 2: Run and verify RED**

Run:

    node --test apps/api/test/historical-invite-token.test.mjs

Expected: FAIL with missing modules.

- [ ] **Step 3: Extract generic HMAC functions**

Move signedPayloadSignature, tokenPositiveInteger, signSignedPayload, and verifySignedPayload from server.js into signed-payload.js. Keep server.js wrappers with the same call signatures so every existing album, media, and ordinary join token callsite remains unchanged.

The generic verify function must retain timingSafeEqual, base64url JSON decoding, positive exp validation, and injected nowSeconds.

- [ ] **Step 4: Implement the historical codec**

The codec must hard-code:

~~~js
const NAMESPACE = "historical-session-claim";
const PURPOSE = "historical_session_claim";
const SESSION_PURPOSE = "historical_record";
~~~

The codec's trusted server caller provides sessionId and inviterUserId after database authorization, and the server computes exp. HTTP clients may never supply sessionId, inviterUserId, exp, purpose, namespace, or sessionPurpose for signing.

- [ ] **Step 5: Run token tests and server import tests**

Run:

    node --test apps/api/test/historical-invite-token.test.mjs apps/api/test/content-moderation-text-server-wiring.test.mjs apps/api/test/album-image-signed-urls.test.mjs apps/api/test/album-image-response-urls.test.mjs apps/api/test/album-share-selection.test.mjs apps/api/test/album-single-media-share.test.mjs apps/api/test/content-moderation-author-media-preview.test.mjs apps/api/test/content-moderation-author-leak-gates.test.mjs
    npm --workspace apps/api run check

Expected: PASS.

- [ ] **Step 6: Commit**

    git add apps/api/src/modules/security/signed-payload.js apps/api/src/modules/core/historical-invite-token.js apps/api/src/server.js apps/api/test/historical-invite-token.test.mjs
    git commit -m "feat(api): sign historical role-claim invitations"

### Task 7: Implement the historical role-claim transaction and routes

**Files:**
- Modify: apps/api/src/modules/core/service.js
- Modify: apps/api/src/server.js
- Modify: apps/api/test/historical-session-service.test.mjs
- Create: apps/api/test/historical-session-routes.test.mjs

- [ ] **Step 1: Add failing claim transaction tests**

Cover exact XOR validation for seatId and npcRoleId, locked historical state, cancelled state, token/path mismatch, inviter no longer organizer, cross-session targets, occupied targets, existing other role, idempotent same-role replay, and success. Add a removed-member fixture with `block_rejoin = 1` and assert 403 with zero UPDATE/INSERT calls. Separately test invitation issuance: only the actual organizer of a locked, non-cancelled historical record is accepted; a system admin who is not that organizer, a member, a draft, a future session, and a cancelled session are rejected.

For a successful seat claim assert:

~~~js
assert.equal(result.claim_result, "historical_claimed");
assert.equal(result.claim_type, "seat");
assert.equal(
  calls.some((call) => /review_eligible_at/.test(call.sql) && call.values.includes(user.user.id)),
  true
);
~~~

For NPC, assert bound_user_id is set and the approved signup uses signup_type session_npc_role.

- [ ] **Step 2: Run and verify RED**

Run:

    node --test apps/api/test/historical-session-service.test.mjs

Expected: FAIL because historical claim functions do not exist.

- [ ] **Step 3: Implement connection-bound and transactional APIs**

Export these three APIs with the listed signatures:

- `assertHistoricalSessionInviteAllowed(user, sessionId)` validates `historical_record + locked + non-cancelled + exact organizer ownership` without an administrator override and returns `{ sessionId, organizerUserId }` from the database row.
- `claimHistoricalSessionRoleWithConnection(connection, user, sessionId, body, inviteClaims)` owns the lock, validation, idempotency, and mutation sequence.
- `claimHistoricalSessionRole(user, sessionId, body, inviteClaims)` is the `withTransaction` wrapper around the connection-bound function.

Lock in this order: target session; all session seats ordered by id; all session NPC roles ordered by id; current user's active signup rows. Validate token session, purpose, session purpose, status, current inviter ownership, and exactly one target before any UPDATE. After validating the locked session and token, call the existing `assertUserCanJoinSession(connection, sessionId, user.user.id)` so a removed user with `block_rejoin = 1` cannot reuse an old group invitation.

Use approved signup plus CURRENT_TIMESTAMP review eligibility. Do not require phone, create pending applications, or send signup-review notifications.

- [ ] **Step 4: Add failing route contracts**

historical-session-routes.test.mjs must read server.js and assert:

- POST /api/sessions/:id/historical-invite-token authenticates and signs a seven-day token;
- token signing uses only the path session ID, the organizer ID returned by `assertHistoricalSessionInviteAllowed`, and a server-computed expiry; request-body sessionId/inviterUserId/exp fields are never read;
- POST /api/sessions/:id/historical-claims authenticates, verifies body.inviteToken, and calls claimHistoricalSessionRole;
- GET session supports historicalInviteToken separately from inviteToken;
- providing both query tokens is a 400 path;
- ordinary join tokens cannot preview historical records.

- [ ] **Step 5: Wire routes and historical preview**

Use historicalInviteToken as the dedicated query parameter. Extend getSessionForViewer with historicalInviteClaims. Return historical_invite_preview only when claims and database purpose are historical_record, IDs match, and status is locked. Reuse the existing invite-preview projection for role selection, and never expose album media, reviews, member-private data, or organizer-only settings through this preview. Keep ordinary invite_preview restricted to future_carpool.

The token issuance route must call assertHistoricalSessionInviteAllowed before signing, use the returned database organizer ID, and compute exp on the server. The claims route must verify the token before calling the transaction.

- [ ] **Step 6: Run route, service, and security tests**

Run:

    node --test apps/api/test/historical-session-service.test.mjs apps/api/test/historical-session-routes.test.mjs apps/api/test/historical-invite-token.test.mjs
    npm --workspace apps/api run check

Expected: PASS.

- [ ] **Step 7: Commit**

    git add apps/api/src/modules/core/service.js apps/api/src/server.js apps/api/test/historical-session-service.test.mjs apps/api/test/historical-session-routes.test.mjs
    git commit -m "feat(api): claim historical session roles by invitation"

### Task 8: Make public discovery explicitly future-only

**Files:**
- Modify: apps/api/src/modules/core/service.js
- Modify: apps/api/test/historical-session-service.test.mjs

- [ ] **Step 1: Add failing SQL contract assertions**

Assert publicSessionAvailable, listDiscoverableSessions, and listPublicUpcomingSessions require future_carpool in addition to future time, recruiting status, and public visibility.

- [ ] **Step 2: Run and verify RED**

Run:

    node --test apps/api/test/historical-session-service.test.mjs

Expected: FAIL because discovery SQL lacks session_purpose.

- [ ] **Step 3: Add explicit purpose filters**

Add:

~~~sql
session.session_purpose = 'future_carpool'
~~~

to both public list WHERE clauses, and require the same purpose in publicSessionAvailable.

- [ ] **Step 4: Run service tests**

Run:

    node --test apps/api/test/historical-session-service.test.mjs

Expected: PASS.

- [ ] **Step 5: Commit**

    git add apps/api/src/modules/core/service.js apps/api/test/historical-session-service.test.mjs
    git commit -m "fix(api): keep historical records out of discovery"

### Task 9: Fix setup time selection and branch creation UI

**Files:**
- Create: apps/miniprogram/src/utils/sessionSetup.js
- Create: apps/miniprogram/test/sessionSetup.test.mjs
- Create: scripts/historical-session-backfill-check.js
- Modify: apps/miniprogram/src/utils/createFlow.js
- Modify: apps/miniprogram/src/utils/authorPrivateText.js
- Modify: apps/miniprogram/src/pages/session/setup.vue

- [ ] **Step 1: Write failing setup helper tests**

Cover:

~~~js
assert.equal(TIME_PICKER_START, "2000-01-01 00:00:00");
assert.equal(TIME_PICKER_END, "2000-01-01 23:59:59");
assert.equal(
  selectedSessionPurpose("2026-08-03", "13:00", new Date("2026-07-31T09:00:00Z")),
  "future_carpool"
);
assert.equal(
  selectedSessionPurpose("2026-07-31", "13:00", new Date("2026-07-31T09:00:00Z")),
  "historical_record"
);
assert.equal(
  submitPurposeChanged(
    "future_carpool",
    "2026-07-31 17:00:00",
    new Date("2026-07-31T09:00:01Z")
  ),
  true
);
~~~

Also assert historical safe settings use share_only/review_required with both ordinary self-join switches off, `historicalPinnedMessage("")` returns an empty string, and `HISTORICAL_PINNED_PLACEHOLDER` contains 补录 but not 集合.

Add deterministic draft-recovery tests for `seatInitializationKey`, `missingSeatPayloads`, and `historicalDraftFingerprint`: an existing matching seat is not recreated, duplicate desired roles are reconciled as a multiset, and changing store/script/start/purpose/ordered roles/selected creator role changes the fingerprint.

- [ ] **Step 2: Run and verify RED**

Run:

    node --test apps/miniprogram/test/sessionSetup.test.mjs

Expected: FAIL with missing helper.

- [ ] **Step 3: Implement sessionSetup.js**

Export TIME_PICKER_START, TIME_PICKER_END, HISTORICAL_PINNED_PLACEHOLDER, selectedSessionPurpose, submitPurposeChanged, historicalCreateSettings, historicalPinnedMessage, seatInitializationKey, missingSeatPayloads, and historicalDraftFingerprint. Use shared sessionPurposeForStartAt and return null for invalid selections. `historicalPinnedMessage` trims user input but returns `""` for a blank note; it must not synthesize a default pinned message. Seat reconciliation compares normalized payload keys as a multiset so retrying cannot duplicate a seat that was already created.

- [ ] **Step 4: Run helper tests and verify GREEN**

Run:

    node --test apps/miniprogram/test/sessionSetup.test.mjs

Expected: PASS.

- [ ] **Step 5: Add the failing setup component contract**

Create scripts/historical-session-backfill-check.js with this initial executable contract; later tasks extend the same file:

~~~js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const setup = readFileSync(
  new URL("../apps/miniprogram/src/pages/session/setup.vue", import.meta.url),
  "utf8"
);

assert.doesNotMatch(setup, /:start=["']today["']/);
for (const marker of [
  "TIME_PICKER_START",
  "TIME_PICKER_END",
  "当前为历史补录",
  "创建历史补录",
  "sessionPurpose",
  "creatorSeatId",
  "pendingHistoricalDraft"
]) {
  assert.ok(setup.includes(marker), `setup.vue missing ${marker}`);
}

console.log("historical session backfill static contract passed");
~~~

Run:

    node scripts/historical-session-backfill-check.js

Expected before implementation: FAIL because :start="today" exists and the historical markers are absent.

- [ ] **Step 6: Update setup.vue and createFlow**

Implement these exact behaviors:

- remove date picker :start today;
- bind time picker start/end to the anchor constants;
- recompute sessionPurpose after date/time changes;
- show the approved historical notice;
- hide recruitment settings for historical mode;
- label free text 补录说明, use a neutral historical placeholder, and skip the pinned-message PATCH when the note is blank;
- persist sessionPurpose through createFlow storage and query round-trips;
- on submit reclassify against a fresh Date; if future became historical, update the notice and return before network mutation;
- POST sessionPurpose and historical safe settings;
- use the optional 补录说明 or a neutral 历史车局补录 session note for history, never the existing future “剧本迷·拼车” default;
- resolve selectedSeat before publish;
- history publish sends creatorSeatId and skips ordinary seat claim;
- future publish and organizer claim remain unchanged;
- map SESSION_PURPOSE_TIME_MISMATCH to a second-click confirmation message.

For historical creation recovery:

- immediately after the session POST succeeds, persist `pendingHistoricalDraft` in createFlow with sessionId, the deterministic fingerprint, the exact setup snapshot, and the selected role's normalized key plus duplicate occurrence before creating the first seat;
- on retry or page reload, if the pending fingerprint matches, GET that session and reuse it instead of POSTing another session;
- reconcile returned seats with desired seat payloads through `missingSeatPayloads`, create only the missing multiset entries, then reload seats and resolve creatorSeatId as the stored occurrence among ID-sorted seats with that normalized key;
- if the recovered session is already locked, clear the pending marker and redirect to its historical share page; if it is still draft, continue initialization and publish; if it is missing/cancelled, clear the stale marker and require a fresh click;
- if current inputs differ from the pending fingerprint, do not create a second draft; show a `继续上次补录` recovery action that restores the saved setup snapshot before retrying;
- retain the pending marker and show `补录草稿已保留，点击重试继续初始化` on any seat/publish failure, and clear it only after successful historical publish.

Include session_purpose in authorPrivateSessionItem so moderated historical drafts retain their purpose on the calendar.

- [ ] **Step 7: Run helper tests and build**

Run:

    node --test apps/miniprogram/test/sessionSetup.test.mjs
    node scripts/historical-session-backfill-check.js
    npm run build:mp-weixin

Expected: helper tests and static contract PASS, followed by DONE Build complete.

- [ ] **Step 8: Commit**

    git add apps/miniprogram/src/utils/sessionSetup.js apps/miniprogram/test/sessionSetup.test.mjs apps/miniprogram/src/utils/createFlow.js apps/miniprogram/src/utils/authorPrivateText.js apps/miniprogram/src/pages/session/setup.vue scripts/historical-session-backfill-check.js
    git commit -m "feat(miniprogram): create historical session records"

### Task 10: Use dedicated historical sharing and claims

**Files:**
- Create: apps/miniprogram/src/utils/sessionShareInvite.js
- Create: apps/miniprogram/test/sessionShareInvite.test.mjs
- Modify: apps/miniprogram/src/pages/session/share.vue

- [ ] **Step 1: Write failing invite adapter tests**

The adapter test must prove:

~~~js
assert.equal(
  inviteQuery({ mode: "historical", token: "history-token" }),
  "?historicalInviteToken=history-token"
);
assert.deepEqual(
  historicalClaimRequest({
    sessionId: 42,
    inviteToken: "history-token",
    role: { boardType: "seat", seatId: 8 }
  }),
  {
    url: "/api/sessions/42/historical-claims",
    method: "POST",
    data: { inviteToken: "history-token", seatId: 8 }
  }
);
~~~

Add the NPC variant and assert neither historical result contains /api/signups, /session-seats/, or /session-npc-roles/.

Also test `historicalRoleClaimable({ hasHistoricalToken, occupied, viewerHasRole, viewerIsOrganizer })`: an unoccupied NPC is claimable with a dedicated token even when an unrelated `npcJoinEnabled: false` property is present; an organizer, an already-assigned viewer, a missing token, or an occupied role is never claimable.

- [ ] **Step 2: Run and verify RED**

Run:

    node --test apps/miniprogram/test/sessionShareInvite.test.mjs

Expected: FAIL with missing adapter.

- [ ] **Step 3: Implement adapter and run GREEN**

Implement normal query as inviteToken and historical query as historicalInviteToken. Require exactly one target identifier and throw TypeError for malformed local role data. Export `historicalRoleClaimable` using only the dedicated-token, occupancy, existing-role, and organizer inputs; it must not read npc_join_enabled or the ordinary started/locked exception.

Run:

    node --test apps/miniprogram/test/sessionShareInvite.test.mjs

Expected: PASS.

- [ ] **Step 4: Branch share.vue by persisted purpose**

Implement:

- page title 补认当时角色, intro 邀请当时同车玩家补认角色, and status 历史补录;
- a separate historicalInviteToken data field and URL query;
- organizer token endpoint historical-invite-token for history, existing join-invite-token for normal;
- history share-card title and path containing only historicalInviteToken;
- historical seat and NPC availability is evaluated before ordinary rules and depends only on a valid dedicated token, an unoccupied target, and a viewer who is neither organizer nor already assigned; specifically, historical NPC补认 ignores the deliberately disabled npc_join_enabled setting;
- historical claim request through the adapter;
- no phone gate, signup-review subscription, ordinary claim, or pending-review copy for history;
- success 已补认角色; 409 角色刚被其他人补认; 403 补认邀请已失效;
- the organizer remains on the invitation page and mints the dedicated token, but every role card is read-only because the organizer already owns a role; an already-approved non-organizer member redirects to the existing album; an unaffiliated invitee remains on the role-claim page.

- [ ] **Step 5: Run unit tests and build**

Run:

    node --test apps/miniprogram/test/sessionShareInvite.test.mjs apps/miniprogram/test/sessionMembership.test.mjs
    npm run build:mp-weixin

Expected: PASS and build complete.

- [ ] **Step 6: Commit**

    git add apps/miniprogram/src/utils/sessionShareInvite.js apps/miniprogram/test/sessionShareInvite.test.mjs apps/miniprogram/src/pages/session/share.vue
    git commit -m "feat(miniprogram): invite players to historical records"

### Task 11: Align historical status and actions across user surfaces

**Files:**
- Modify: apps/api/src/modules/core/service.js
- Modify: apps/miniprogram/src/pages/session/detail.vue
- Modify: apps/miniprogram/src/pages/session/manage.vue
- Modify: apps/miniprogram/src/pages/session/album.vue
- Modify: apps/miniprogram/src/components/SessionCalendar.vue
- Modify: apps/miniprogram/src/extensions/session-pseudo-chat/ManagePinnedMessage.vue

- [ ] **Step 1: Add failing static assertions**

In scripts/historical-session-backfill-check.js, assert detail.vue, manage.vue, album.vue, and SessionCalendar.vue import or call isHistoricalSession before status/post-start/recruitment branches, and assert these user-facing strings exist:

~~~js
"历史补录"
"邀请同车成员补认"
"待补认"
"已补认"
~~~

Assert historical detail does not expose direct open-type share, calls hideShareMenu, suppresses reschedule/apply statistics, and branches seat/NPC summaries before ordinary status text. Assert manage skips loading signups and every seat/NPC/removal/cancellation helper branches on purpose before ordinary recruitment wording. Also assert the member album API response includes session_purpose and organizer_user_id, the album toolbar does not label history as 招募 or offer invite generation to non-organizer members, and the pinned-message component does not describe historical notes as 集合信息.

- [ ] **Step 2: Run and verify RED**

Run:

    node scripts/historical-session-backfill-check.js

Expected: FAIL on missing display branches.

- [ ] **Step 3: Update detail.vue**

- cancelled history uses 已取消补录; otherwise status uses 历史补录 before mapping locked/post-start state;
- summary says this is a historical material record;
- album remains primary;
- the organizer gets an 邀请同车成员补认 entry to share.vue; already-approved non-organizer members keep the album as their primary action and cannot mint a token;
- direct detail sharing is hidden for historical sessions;
- after loading a historical record call `uni.hideShareMenu()` so the top-right menu cannot emit the ordinary tokenless detail share, and restore the normal share menu for future sessions;
- hide 改期提醒 and 浏览/申请 recruitment statistics for historical records;
- open seats say 待补认 and occupied seats 已补认;
- branch seatBoardSummary plus every NPC summary/status pill to 待补认/已补认 before the ordinary open/pending/locked wording;
- canApplySeat and canApplyNpcRole return false for historical records so the locked/started exception cannot leak.

- [ ] **Step 4: Update manage.vue**

- cancelled history uses 已取消补录; otherwise the status pill uses 历史补录 instead of locked/post-start wording;
- add an 邀请同车成员补认 navigation button;
- hide signup reminder, recruitment settings, and signup review section;
- skip the /signups request;
- show 待补认 and 已补认 statistics instead of 空位, 待审, and 已锁车;
- branch seatSummary, NPC summary/status pills, individual seat state, member-removal copy, and the cancellation area before ordinary wording; history consistently uses 待补认、已补认、补认成员 and 取消补录, never 玩家上车、招募、待审 or 已锁车.

Pass the persisted purpose into ManagePinnedMessage. In historical mode its title is 补录说明, its helper text describes supplementary context for the completed session, and its placeholder contains no 集合、房间号、临时变更 or other future-recruitment language. Future sessions keep the existing text unchanged.

- [ ] **Step 5: Update album.vue**

- preserve session_purpose and organizer_user_id in albumSessionSummary and derive historical organizer mode from the persisted purpose plus current user ID;
- add session_purpose and organizer_user_id to the authenticated member-album response in service.js so album mode does not depend on an extra fallback request;
- keep the organizer/member album, upload, download, tagging, media visibility, and review ACL behavior unchanged;
- for a historical organizer replace the toolbar 招募 label with 邀请补认 and navigate to the existing share page; hide that toolbar action from historical non-organizer members, while future sessions retain existing member invitation behavior;
- never construct or request a normal join token from the album page.

- [ ] **Step 6: Update SessionCalendar.vue**

- preserve sessionPurpose on each item;
- add a 历史补录 identity tag;
- evaluate cancellation first, then historical purpose, then ordinary post-start status;
- use 已取消补录 for cancelled history and 历史补录 for active history;
- use 打开相册，补上当时的照片 or 回看这场记录 for album CTA;
- keep historical card navigation pointed at the existing album.

- [ ] **Step 7: Run static check and build**

Run:

    node scripts/historical-session-backfill-check.js
    npm run build:mp-weixin

Expected: PASS and build complete.

- [ ] **Step 8: Commit**

    git add apps/api/src/modules/core/service.js apps/miniprogram/src/pages/session/detail.vue apps/miniprogram/src/pages/session/manage.vue apps/miniprogram/src/pages/session/album.vue apps/miniprogram/src/components/SessionCalendar.vue apps/miniprogram/src/extensions/session-pseudo-chat/ManagePinnedMessage.vue scripts/historical-session-backfill-check.js
    git commit -m "feat(miniprogram): label historical session records"

### Task 12: Add live lifecycle smoke and complete verification

**Files:**
- Create: scripts/historical-session-backfill-smoke.js
- Modify: scripts/historical-session-backfill-check.js
- Modify: package.json

- [ ] **Step 1: Implement the live smoke**

Use unique Date.now fixtures and the existing development login/phone endpoints. The smoke must:

1. create an active store and three-player-role script, and include one valid active unbound extra NPC role in the historical session;
2. create a historical_record with a past Beijing wall time while intentionally sending public/recruitment settings;
3. assert the response is share_only with safe join settings;
4. create all three seats and publish with creatorSeatId;
5. assert the session is locked and history-labeled, the authenticated album response has can_upload true, and the creator review endpoint reports immediate eligibility;
6. assert discovery and public upcoming exclude the session;
7. assert ordinary signup, a valid open-seat claim, a valid active-NPC-role claim, and join-invite-token each fail with status 403 and `HISTORICAL_ROLE_CLAIM_INVITE_REQUIRED` rather than a missing-target error;
8. request historical-invite-token while sending forged body sessionId/inviterUserId/exp values, decode its payload, and assert it instead contains the path session ID, actual organizer ID, server-bounded seven-day expiry, fixed purpose, and fixed sessionPurpose; a tampered token must return 403;
9. load historical preview and assert it contains only the invite role-selection projection, with no confirmed_user_id, bound_user_id, member identity, album/media, review, or organizer-only setting fields;
10. claim one seat through historical-claims and assert approved membership, album access, and review eligibility;
11. concurrently submit two fresh users for the same third seat with Promise.allSettled and assert exactly one success;
12. create a future_carpool for 8 August at 13:00-style earlier clock time, publish it normally, obtain its normal join token, and assert ordinary claim still succeeds;
13. assert the future token cannot preview history, the historical token cannot preview future, and a history GET containing both token query parameters returns 400. Expired-token behavior remains covered deterministically by the fixed-clock codec unit test.

Every request helper must require an expected status and redact bearer tokens from thrown errors.

- [ ] **Step 2: Add root scripts**

Add:

~~~json
"historical-session-backfill:unit": "node --test packages/shared/test/sessionPurpose.test.mjs apps/api/test/session-purpose.test.mjs apps/api/test/historical-session-migration.test.mjs apps/api/test/historical-invite-token.test.mjs apps/api/test/historical-session-service.test.mjs apps/api/test/historical-session-routes.test.mjs apps/miniprogram/test/sessionSetup.test.mjs apps/miniprogram/test/sessionShareInvite.test.mjs",
"historical-session-backfill:check": "node scripts/historical-session-backfill-check.js",
"historical-session-backfill:verify": "npm run historical-session-backfill:unit && npm run historical-session-backfill:check && npm --workspace apps/api run check && npm run build:mp-weixin",
"historical-session-backfill:smoke": "node scripts/historical-session-backfill-smoke.js"
~~~

- [ ] **Step 3: Run focused verification**

Run:

    npm run historical-session-backfill:verify

Expected: all node:test cases pass, static contract passes, API syntax passes, and mini program build completes.

- [ ] **Step 4: Run adjacent regressions**

Run:

    node --test apps/api/test/session-reschedule.test.mjs apps/api/test/session-reschedule-service.test.mjs apps/api/test/session-reschedule-legacy-patch.test.mjs apps/api/test/content-moderation-author-text-projection.test.mjs apps/api/test/content-moderation-text-boundaries.test.mjs apps/api/test/album-image-signed-urls.test.mjs apps/api/test/album-image-response-urls.test.mjs apps/api/test/album-share-selection.test.mjs apps/api/test/album-single-media-share.test.mjs apps/api/test/content-moderation-author-media-preview.test.mjs apps/api/test/content-moderation-author-leak-gates.test.mjs apps/miniprogram/test/sessionMembership.test.mjs

Expected: all PASS.

- [ ] **Step 5: Run the live smoke when the local API stack is available**

Run:

    npm run historical-session-backfill:smoke

Expected: final JSON includes ok true, one concurrent historical claim success, one conflict, and one successful ordinary future claim.

- [ ] **Step 6: Inspect the final diff**

Run:

    git status --short
    git diff --check
    git diff --stat b38c79a0..HEAD

Expected: only files in this plan are changed, no whitespace errors, and no generated dist files are tracked.

- [ ] **Step 7: Commit final verification assets**

    git add scripts/historical-session-backfill-smoke.js scripts/historical-session-backfill-check.js package.json
    git commit -m "test: verify historical session backfill"

## Final acceptance checklist

- The 8 August 13:00 regression is covered independently of the current clock hour.
- Past and same-day earlier times deliberately enter historical mode rather than being blocked.
- A normal future_carpool remains a normal session after its start time; purpose never changes with time.
- History creation is visibly confirmed, share_only, non-discoverable, and non-recruitable.
- Creator membership and review eligibility are atomic with historical publication.
- Historical invite tokens cannot be substituted for normal join tokens or vice versa.
- Only a dedicated token can claim an unoccupied historical seat or NPC role.
- Every ordinary recruitment and direct-binding bypass is denied by the server.
- Removed users blocked from rejoining cannot reuse an old historical token.
- A partially initialized historical draft is resumed and reconciled instead of creating a duplicate record.
- Calendar, detail, manage, and share use consistent historical language.
- Existing post-start album privacy and moderation rules are unchanged.
