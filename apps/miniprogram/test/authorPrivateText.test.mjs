import assert from "node:assert/strict";
import test from "node:test";

import {
  authorPrivateCatalogItem,
  authorPrivateProfileUser,
  authorPrivateStatusText,
  isAuthorPrivateText,
  isFormalBusinessEntity
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
