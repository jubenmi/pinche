import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createAuthorTextProjectionReader,
  mergeAuthorTextProjection
} from "../src/modules/content-moderation/author-text-read.js";

function proposal(overrides = {}) {
  return {
    id: 51,
    created_by_user_id: 7,
    action: "update_nickname",
    target_subject_id: "7",
    author_visibility_version: 1,
    proposal_status: "pending",
    job_status: "review",
    normalized_payload_json: JSON.stringify({
      body: { nickname: "待审昵称", phone: "must-not-leak" },
      context: { targetSubjectId: "7" },
      actor_user_id: 7
    }),
    ...overrides
  };
}

test("D46 author text reader returns only an enabled exact author/action/target projection", async () => {
  const calls = [];
  const reader = createAuthorTextProjectionReader({
    config: {
      authorPrivateTextEnabled: true,
      authorPrivateTextActions: ["update_nickname", "create_private_store"]
    },
    repository: {
      findLatestAuthorTextProposal: async (_connection, input) => {
        calls.push(input);
        return proposal();
      }
    }
  });

  const dto = await reader.find({}, {
    userId: 7,
    action: "update_nickname",
    targetSubjectId: "7"
  });
  assert.deepEqual(calls, [{
    userId: 7,
    action: "update_nickname",
    targetSubjectId: "7"
  }]);
  assert.equal(dto.publication_state, "author_only");
  assert.equal(dto.published_id, 7);
  assert.deepEqual(dto.content, { nickname: "待审昵称" });
  assert.equal(JSON.stringify(dto).includes("must-not-leak"), false);

  assert.deepEqual(mergeAuthorTextProjection({ id: 7, nickname: "公开昵称" }, dto), {
    id: 7,
    nickname: "待审昵称",
    author_private: dto
  });
});

test("D46 reader closes for disabled actions, mismatched rows, and terminal private states", async () => {
  let row = proposal();
  let calls = 0;
  const reader = createAuthorTextProjectionReader({
    config: {
      authorPrivateTextEnabled: true,
      authorPrivateTextActions: ["update_nickname"]
    },
    repository: {
      findLatestAuthorTextProposal: async () => {
        calls += 1;
        return row;
      }
    }
  });

  assert.equal(await reader.find({}, {
    userId: 7,
    action: "create_private_store",
    targetSubjectId: "creation:create_private_store:7"
  }), null);
  assert.equal(calls, 0);

  for (const overrides of [
    { created_by_user_id: 8 },
    { action: "update_session" },
    { target_subject_id: "8" },
    { author_visibility_version: 0 },
    { proposal_status: "cancelled", job_status: "cancelled" },
    { proposal_status: "superseded", job_status: "rejected" },
    { proposal_status: "stale", job_status: "rejected" },
    { normalized_payload_json: "not-json" }
  ]) {
    row = proposal(overrides);
    assert.equal(await reader.find({}, {
      userId: 7,
      action: "update_nickname",
      targetSubjectId: "7"
    }), null);
  }
});

test("D46 profile and catalog reads merge only authenticated author projections", async () => {
  const [server, core] = await Promise.all([
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8")
  ]);
  const profileStart = server.indexOf('request.method === "GET" && url.pathname === "/api/users/me"');
  const profileEnd = server.indexOf('request.method === "PATCH" && url.pathname === "/api/users/me"', profileStart);
  const profile = server.slice(profileStart, profileEnd);
  assert.match(profile, /authorTextProjectionReader\.find/);
  assert.match(profile, /mergeAuthorTextProjection/);
  assert.match(profile, /private, no-store/);

  for (const functionName of ["listActiveStores", "listActiveScripts"]) {
    const start = core.indexOf(`export async function ${functionName}`);
    const end = core.indexOf("\nexport async function ", start + 1);
    const body = core.slice(start, end);
    assert.match(body, /user\?\.user\?\.id/);
    assert.match(body, /authorTextReader\.find/);
    assert.match(body, /create_private_(?:store|script)/);
  }
});
