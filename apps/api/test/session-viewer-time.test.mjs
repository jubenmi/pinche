import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { getSessionForViewer } from "../src/modules/core/service.js";
import { notFound } from "../src/http/errors.js";

const source = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
const availability = source.match(/(?:async )?function publicSessionAvailable\([\s\S]*?\n\}/)[0];
for (const started of [false, true]) {
  test(`public preview uses database start state (${started ? "started" : "future"}) despite app clock skew`, async (t) => {
    t.mock.method(Date, "now", () => Date.parse(started ? "2026-09-07T11:00:00Z" : "2026-09-07T12:00:00Z"));
    const session = { id: 10, visibility: "public", status: "recruiting", session_purpose: "future_carpool", session_started: started ? 1 : 0, start_at: new Date("2026-09-07T11:30:00Z") };
    const connection = { async query() { return [[{ start_in_future: started ? 0 : 1 }]]; } };
    const context = vm.createContext({
      Date, positiveId: Number, withTransaction: (work) => work(connection),
      requireLockedSession: async () => session, notFound,
      publicSessionPreview: async (_connection, value) => ({ ...value, access_scope: "public_preview" })
    });
    vm.runInContext(`${availability}\n${getSessionForViewer.toString()}`, context);
    if (started) await assert.rejects(context.getSessionForViewer(10), { statusCode: 404 });
    else assert.equal((await context.getSessionForViewer(10)).access_scope, "public_preview");
  });
}

for (const projection of ["memberSessionDetail", "publicSessionPreview"]) {
  for (const started of [false, true]) {
    test(`${projection} returns the database start state when app time disagrees (${started})`, async (t) => {
      t.mock.method(Date, "now", () => Date.parse(started ? "2026-09-07T11:00:00Z" : "2026-09-07T12:00:00Z"));
      const session = {
        id: 10, visibility: "public", status: "recruiting", session_purpose: "future_carpool",
        session_started: started ? 1 : 0, start_at: new Date("2026-09-07T11:30:00Z")
      };
      const helper = source.match(/export function sessionHasStarted\([\s\S]*?\n\}/)[0].replace("export ", "");
      const projectionSource = source.match(new RegExp(`async function ${projection}\\([\\s\\S]*?\\n\\}`))[0];
      const context = vm.createContext({
        Date,
        cleanupSessionExclusiveRoleSelections: async () => {},
        lockedMembershipUsers: async () => new Map(),
        seatsFromLockedMembership: () => [], sessionNpcRolesFromLockedMembership: () => [],
        activeSessionAlbumPhotoCount: async () => 0, publicSeatResponse: (seat) => seat,
        publicSessionNpcRoleResponse: (role) => role
      });
      vm.runInContext(`${helper}\n${projectionSource}`, context);
      const options = { locksHeld: true, membershipRows: { seats: [], npcRoles: [] } };
      const result = projection === "memberSessionDetail"
        ? await context[projection]({}, session, options)
        : await context[projection]({}, session, "public_preview", options);
      assert.equal(result.has_started, started);
      assert.equal(Object.hasOwn(result, "session_started"), false, "internal SQL projection stays private");
    });
  }
}
