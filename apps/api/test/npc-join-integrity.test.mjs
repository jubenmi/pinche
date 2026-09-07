import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { claimSessionNpcRole, createSessionNpcRoleWithConnection } from "../src/modules/core/service.js";
import { badRequest, conflict, forbidden, notFound } from "../src/http/errors.js";

test("creating a lower-sorted NPC returns the inserted role, not the last old role", async () => {
  const roles = [
    { id: 1, session_id: 10, name: "A", sort_order: 0 },
    { id: 2, session_id: 10, name: "B", sort_order: 1 }
  ];
  const connection = { async query(sql, values = []) {
    const query = sql.replace(/\s+/g, " ").trim();
    if (query === "SELECT * FROM sessions WHERE id = ? FOR UPDATE") return [[{ id: 10, organizer_user_id: 7 }]];
    if (query.startsWith("INSERT INTO session_npc_roles")) {
      roles.push({ id: 3, session_id: 10, name: values[2], sort_order: values[7] });
      return [{ insertId: 3 }];
    }
    if (query.includes("FROM session_npc_roles role")) {
      return [query.includes("WHERE role.id = ?")
        ? roles.filter((role) => role.id === values[0])
        : [...roles].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)];
    }
    throw new Error(`Unexpected SQL: ${query}`);
  } };
  const role = await createSessionNpcRoleWithConnection(connection, { user: { id: 7 }, roles: [] }, 10, { name: "C" });
  assert.equal(role.id, 3);
  assert.equal(role.name, "C");
});

for (const joinPolicy of ["direct", "review_required"]) {
  test(`NPC ${joinPolicy} honors the session rejoin block before any mutation`, async () => {
    let writes = 0;
    let checks = 0;
    const role = { id: 2, session_id: 10, status: "active", session_status: "recruiting", npc_join_enabled: 1, join_phone_required: 0, join_policy: joinPolicy };
    const connection = { async query(sql) {
      if (sql.includes("FROM session_npc_roles")) return [[role]];
      if (/^\s*(INSERT|UPDATE|DELETE)/.test(sql)) writes += 1;
      return [[]];
    } };
    const context = vm.createContext({
      positiveId: Number, withTransaction: (work) => work(connection),
      isAdmin: () => false, requireJoinPhoneIfNeeded() {},
      findLockedSession: async () => ({ id: 10 }), assertOrdinaryHistoricalRoleClaimAllowed() {},
      lockSessionMembershipRows: async () => ({}), sessionMembershipTarget: () => role,
      badRequest, conflict, forbidden, notFound,
      assertUserCanJoinSession: async (_connection, sessionId, userId) => {
        checks += 1;
        assert.equal(sessionId, 10);
        assert.equal(userId, 7);
        throw forbidden("You cannot rejoin this session");
      },
      releaseUserOtherConfirmedSeats: async () => { writes += 1; },
      releaseUserOtherSessionNpcRoles: async () => { writes += 1; },
      cancelUserOtherPendingSignups: async () => { writes += 1; },
      optionalText: (value) => value || null,
      sessionNpcRoleById: async () => role, findById: async () => ({ id: 1 })
    });
    vm.runInContext(claimSessionNpcRole.toString(), context);
    await assert.rejects(context.claimSessionNpcRole({ user: { id: 7 }, roles: [] }, 2), { statusCode: 403 });
    assert.equal(checks, 1);
    assert.equal(writes, 0);
  });
}
