import assert from "node:assert/strict";
import test from "node:test";

import { isModerationPublished } from "@pinche/shared";
import {
  AUTHOR_VISIBILITY_SCOPES,
  resolveAuthorVisibility
} from "../src/modules/content-moderation/author-visibility.js";
import {
  AUTHOR_PRIVATE_TEXT_ACTIONS,
  createAuthorPrivateTextDto
} from "../src/modules/content-moderation/author-dto.js";

const HIDDEN = Object.freeze({
  scope: "hidden",
  canPreview: false,
  canEdit: false,
  canDelete: false,
  canResubmit: false
});

function visibility(overrides = {}) {
  return resolveAuthorVisibility({
    viewerUserId: 7,
    authorUserId: 7,
    moderationStatus: "pending",
    authorVisibilityVersion: 1,
    recordStatus: "active",
    contentKind: "text",
    ...overrides
  });
}

test("D46 public moderation helper remains strict and independent", () => {
  assert.equal(isModerationPublished("approved"), true);
  assert.equal(isModerationPublished("approved_legacy"), true);
  for (const status of ["pending", "processing", "review", "rejected", "error", "cancelled"] ) {
    assert.equal(isModerationPublished(status), false);
  }
  assert.deepEqual(AUTHOR_VISIBILITY_SCOPES, Object.freeze({
    public: "public",
    authorOnly: "author_only",
    hidden: "hidden"
  }));
});

test("D46 only the persisted author receives unapproved visibility", () => {
  assert.deepEqual(visibility(), {
    scope: "author_only",
    canPreview: true,
    canEdit: false,
    canDelete: true,
    canResubmit: false
  });

  for (const viewer of [
    { label: "organizer", id: 8 },
    { label: "member", id: 9 },
    { label: "tagged", id: 10 },
    { label: "system_admin_normal_api", id: 11 },
    { label: "anonymous", id: null }
  ]) {
    assert.deepEqual(
      visibility({ viewerUserId: viewer.id }),
      HIDDEN,
      viewer.label
    );
  }
  assert.deepEqual(visibility({ viewerUserId: "7", authorUserId: "7" }), {
    scope: "author_only",
    canPreview: true,
    canEdit: false,
    canDelete: true,
    canResubmit: false
  });
});

test("D46 policy version and active record status are mandatory", () => {
  for (const authorVisibilityVersion of [0, "0", "1", null, undefined, 2]) {
    assert.deepEqual(visibility({ authorVisibilityVersion }), HIDDEN);
  }
  for (const recordStatus of ["inactive", "deleting", "deleted", "purged", null]) {
    assert.deepEqual(visibility({ recordStatus }), HIDDEN);
  }
});

test("D46 approved content stays public while private terminal states stay hidden", () => {
  for (const moderationStatus of ["approved", "approved_legacy"]) {
    assert.deepEqual(visibility({ viewerUserId: 99, moderationStatus }), {
      scope: "public",
      canPreview: true,
      canEdit: false,
      canDelete: false,
      canResubmit: false
    });
  }
  for (const moderationStatus of ["cancelled", "superseded", "stale", "unknown", ""]) {
    assert.deepEqual(visibility({ moderationStatus }), HIDDEN);
  }
});

test("D46 rejected text can be edited and resubmitted while rejected media must be replaced", () => {
  assert.deepEqual(visibility({ moderationStatus: "rejected", contentKind: "text" }), {
    scope: "author_only",
    canPreview: true,
    canEdit: true,
    canDelete: true,
    canResubmit: true
  });
  for (const contentKind of ["image", "video"]) {
    assert.deepEqual(visibility({ moderationStatus: "rejected", contentKind }), {
      scope: "author_only",
      canPreview: true,
      canEdit: false,
      canDelete: true,
      canResubmit: false
    });
  }
});

test("D46 text DTO exposes only the approved author-private contract", () => {
  const content = { nickname: "新的昵称" };
  const dto = createAuthorPrivateTextDto({
    draftId: 41,
    action: "update_nickname",
    moderationStatus: "review",
    publishedId: 7,
    content,
    visibility: visibility({ moderationStatus: "review" })
  });

  assert.deepEqual(dto, {
    draft_id: 41,
    content_ref: "text-proposal:41",
    publication_state: "author_only",
    moderation_status: "review",
    moderation_message: "仅自己可见 · 进一步审核",
    published_id: 7,
    content: { nickname: "新的昵称" },
    can_edit: false,
    can_delete: true,
    can_resubmit: false
  });
  assert.notEqual(dto.content, content);
  assert.equal("action" in dto, false);
  assert.equal("canPreview" in dto, false);
});

test("D46 text DTO uses only three safe author messages", () => {
  const messages = new Map();
  for (const moderationStatus of ["pending", "processing", "error", "review", "rejected"]) {
    const dto = createAuthorPrivateTextDto({
      draftId: 42,
      action: "create_session_message",
      moderationStatus,
      publishedId: null,
      content: { content: "仅本人测试" },
      visibility: visibility({ moderationStatus })
    });
    messages.set(moderationStatus, dto.moderation_message);
  }
  assert.deepEqual(messages, new Map([
    ["pending", "仅自己可见 · 审核中"],
    ["processing", "仅自己可见 · 审核中"],
    ["error", "仅自己可见 · 审核中"],
    ["review", "仅自己可见 · 进一步审核"],
    ["rejected", "仅自己可见 · 未通过"]
  ]));
});

test("D46 text DTO rejects unknown actions, statuses, top-level fields, and sensitive nested fields", () => {
  assert.equal(AUTHOR_PRIVATE_TEXT_ACTIONS.length, 10);
  assert.equal(Object.isFrozen(AUTHOR_PRIVATE_TEXT_ACTIONS), true);
  const baseline = {
    draftId: 43,
    action: "update_nickname",
    moderationStatus: "pending",
    publishedId: 7,
    content: { nickname: "安全昵称" },
    visibility: visibility()
  };
  for (const input of [
    { ...baseline, action: "arbitrary_action" },
    { ...baseline, moderationStatus: "approved" },
    { ...baseline, provider: "wechat_sec_check" },
    { ...baseline, content: { nickname: "安全昵称", openid: "secret" } },
    { ...baseline, content: { nested: { base_version: "v1" } } },
    { ...baseline, content: { score: 99 } },
    { ...baseline, visibility: { ...visibility(), scope: "public" } }
  ]) {
    assert.throws(
      () => createAuthorPrivateTextDto(input),
      { code: "CONTENT_MODERATION_AUTHOR_DTO_INVALID" }
    );
  }
});
