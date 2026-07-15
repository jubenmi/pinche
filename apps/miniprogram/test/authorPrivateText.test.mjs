import assert from "node:assert/strict";
import test from "node:test";

import {
  authorPrivateCatalogItem,
  authorPrivateProfileUser,
  authorPrivateSessionItem,
  authorPrivateStatusText,
  isAuthorPrivateText,
  isFormalBusinessEntity,
  normalizeAuthorPrivateSession
} from "../src/utils/authorPrivateText.js";

function dto(overrides = {}) {
  return {
    draft_id: 51,
    content_ref: "text-proposal:51",
    publication_state: "author_only",
    moderation_status: "review",
    moderation_message: "仅自己可见 · 进一步审核",
    published_id: null,
    content: { is_draft: true, name: "待审剧本", playerCount: 6, typeTags: ["推理"] },
    can_edit: false,
    can_delete: true,
    can_resubmit: false,
    ...overrides
  };
}

test("D46 mini program recognizes and formats author-private profile and catalog text", () => {
  const projection = dto();
  assert.equal(isAuthorPrivateText(projection), true);
  assert.equal(authorPrivateStatusText(projection), "仅自己可见 · 进一步审核");
  assert.deepEqual(authorPrivateProfileUser({ id: 7, nickname: "公开昵称" }, dto({
    published_id: 7,
    content: { nickname: "待审昵称" }
  })), {
    id: 7,
    nickname: "待审昵称",
    author_private: dto({
      published_id: 7,
      content: { nickname: "待审昵称" }
    })
  });

  assert.deepEqual(authorPrivateCatalogItem(projection, "script"), {
    id: null,
    draft_id: 51,
    type: "script",
    name: "待审剧本",
    player_count: 6,
    type_tags: ["推理"],
    review_status: "review",
    moderation_message: "仅自己可见 · 进一步审核",
    publication_state: "author_only",
    is_draft: true,
    author_private: projection
  });
  assert.equal(isFormalBusinessEntity(authorPrivateCatalogItem(projection, "script")), false);
  assert.equal(isFormalBusinessEntity({ id: 4, name: "正式剧本" }), true);
});

test("D46 mini program rejects lookalike objects and never promotes a draft id to a business id", () => {
  for (const value of [
    null,
    {},
    { ...dto(), publication_state: "public" },
    { ...dto(), draft_id: 0 },
    { ...dto(), content_ref: "text-proposal:52" },
    { ...dto(), content: null }
  ]) {
    assert.equal(isAuthorPrivateText(value), false);
    assert.equal(authorPrivateCatalogItem(value, "script"), null);
  }
  const item = authorPrivateCatalogItem(dto(), "script");
  assert.equal(item.id, null);
  assert.notEqual(item.id, item.draft_id);
});

test("D46 session and NPC drafts stay display-only and retain no formal id", () => {
  const sessionProjection = dto({
    content: {
      is_draft: true,
      startAt: "2026-07-15 20:00:00",
      note: "待审车局",
      pinnedMessageText: "待审置顶"
    }
  });
  assert.deepEqual(authorPrivateSessionItem(sessionProjection), {
    id: null,
    draft_id: 51,
    start_at: "2026-07-15 20:00:00",
    note: "待审车局",
    pinned_message_text: "待审置顶",
    script_name_snapshot: "待审车局",
    store_name_snapshot: "仅自己可见",
    status: "author_private",
    moderation_message: "仅自己可见 · 进一步审核",
    publication_state: "author_only",
    is_draft: true,
    author_private: sessionProjection
  });

  const npcProjection = dto({
    draft_id: 52,
    content_ref: "text-proposal:52",
    content: { is_draft: true, name: "待审 NPC", description: "说明" }
  });
  const normalized = normalizeAuthorPrivateSession({
    id: 12,
    note: "正式车局",
    session_npc_roles: [npcProjection, {
      id: 88,
      name: "待审修改 NPC",
      author_private: dto({
        draft_id: 53,
        content_ref: "text-proposal:53",
        published_id: 88,
        content: { name: "待审修改 NPC" }
      })
    }]
  });
  assert.equal(normalized.session_npc_roles[0].id, null);
  assert.equal(normalized.session_npc_roles[0].draft_id, 52);
  assert.equal(normalized.session_npc_roles[0].name, "待审 NPC");
  assert.equal(isFormalBusinessEntity(normalized.session_npc_roles[0]), false);
  assert.equal(normalized.session_npc_roles[1].id, 88);
  assert.equal(isFormalBusinessEntity(normalized.session_npc_roles[1]), true);
});
