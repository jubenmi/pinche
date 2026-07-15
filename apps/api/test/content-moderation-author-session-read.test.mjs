import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  appendAuthorSessionCreation,
  mergeAuthorSessionView
} from "../src/modules/content-moderation/author-session-read.js";

function dto({ id, publishedId = null, content }) {
  return {
    draft_id: id,
    content_ref: `text-proposal:${id}`,
    publication_state: "author_only",
    moderation_status: "review",
    moderation_message: "仅自己可见 · 进一步审核",
    published_id: publishedId,
    content,
    can_edit: false,
    can_delete: true,
    can_resubmit: false
  };
}

test("D46 session author view overlays only exact update targets and appends an unusable NPC draft", async () => {
  const calls = [];
  const sessionProjection = dto({ id: 61, publishedId: 12, content: { note: "作者待审说明" } });
  const npcProjection = dto({ id: 62, publishedId: 88, content: { name: "作者待审 NPC" } });
  const newNpcProjection = dto({
    id: 63,
    content: { is_draft: true, name: "新增待审 NPC", description: "待审说明" }
  });
  const reader = {
    find: async (_connection, input) => {
      calls.push(input);
      if (input.action === "update_session") return sessionProjection;
      if (input.action === "update_session_npc_role") return npcProjection;
      if (input.action === "create_session_npc_role") return newNpcProjection;
      return null;
    }
  };

  const result = await mergeAuthorSessionView({}, {
    reader,
    userId: 7,
    session: {
      id: 12,
      note: "公开说明",
      session_npc_roles: [{ id: 88, name: "公开 NPC" }]
    }
  });

  assert.equal(result.note, "作者待审说明");
  assert.equal(result.author_private, sessionProjection);
  assert.equal(result.session_npc_roles[0].name, "作者待审 NPC");
  assert.equal(result.session_npc_roles[0].author_private, npcProjection);
  assert.deepEqual(result.session_npc_roles[1], newNpcProjection);
  assert.deepEqual(calls, [
    { userId: 7, action: "update_session", targetSubjectId: "12" },
    { userId: 7, action: "update_session_npc_role", targetSubjectId: "88" },
    { userId: 7, action: "create_session_npc_role", targetSubjectId: "session:12" }
  ]);
});

test("D46 my-session creation draft never becomes a formal session", () => {
  const creation = dto({
    id: 64,
    content: { is_draft: true, storeId: 3, scriptId: 4, note: "待审车局" }
  });
  assert.deepEqual(appendAuthorSessionCreation([{ id: 12, note: "正式车局" }], creation), [
    { id: 12, note: "正式车局" },
    creation
  ]);
  assert.deepEqual(appendAuthorSessionCreation([{ id: 12 }], null), [{ id: 12 }]);
  assert.equal(creation.published_id, null);
});

test("D46 server wires author session projections only into authenticated owner/member reads", async () => {
  const [server, core] = await Promise.all([
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8")
  ]);
  for (const functionName of ["getSessionForViewer", "listMySessions", "listSessionNpcRoles"]) {
    const start = core.indexOf(`export async function ${functionName}`);
    const end = core.indexOf("\nexport async function ", start + 1);
    const body = core.slice(start, end);
    assert.match(body, /authorTextReader/);
  }
  for (const publicFunction of ["listDiscoverableSessions", "listPublicUpcomingSessions"]) {
    const start = core.indexOf(`export async function ${publicFunction}`);
    const end = core.indexOf("\nexport async function ", start + 1);
    assert.doesNotMatch(core.slice(start, end), /authorTextReader|mergeAuthorSessionView/);
  }
  assert.match(server, /listMySessions\([\s\S]*authorTextReader: authorTextProjectionReader/);
  assert.match(server, /getSessionForViewer\([\s\S]*authorTextReader: authorTextProjectionReader/);
  assert.match(server, /listSessionNpcRoles\([\s\S]*authorTextReader: authorTextProjectionReader/);
});
