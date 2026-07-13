import assert from "node:assert/strict";
import test from "node:test";

import { updateUserProfileWithConnection } from "../src/modules/auth/users.js";
import {
  createPrivateScriptWithConnection,
  createPrivateStoreWithConnection,
  createSessionWithConnection,
  createSessionNpcRoleWithConnection,
  updateSessionWithConnection,
  updateSessionNpcRoleWithConnection,
  upsertMySessionReviewWithConnection
} from "../src/modules/core/service.js";
import {
  createSessionMessageWithConnection,
  updateSessionPinnedMessageWithConnection
} from "@jubenmi/talk/api";

test("covered core writes expose connection-bound variants for the moderation transaction", () => {
  for (const helper of [
    createPrivateStoreWithConnection,
    createPrivateScriptWithConnection,
    createSessionWithConnection,
    updateSessionWithConnection,
    createSessionNpcRoleWithConnection,
    updateSessionNpcRoleWithConnection,
    upsertMySessionReviewWithConnection
  ]) {
    assert.equal(typeof helper, "function");
  }
});

test("pseudo-chat message and pinned-message writes share the moderation transaction", () => {
  assert.equal(typeof createSessionMessageWithConnection, "function");
  assert.equal(typeof updateSessionPinnedMessageWithConnection, "function");
});

test("nickname application can run on the caller transaction instead of opening a second connection", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT \* FROM users/.test(sql)) {
        return [[{
          id: 7,
          open_id: "openid-7",
          nickname: "阿青",
          avatar_url: null,
          gender: "",
          phone_verified_at: null,
          created_at: "2026-07-12",
          updated_at: "2026-07-12"
        }]];
      }
      return [{ affectedRows: 1 }];
    }
  };

  const user = await updateUserProfileWithConnection(connection, 7, { nickname: "阿青" });

  assert.equal(user.nickname, "阿青");
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /UPDATE users/);
  assert.deepEqual(calls[0].params, ["阿青", 7]);
});
