import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTextModerationDescriptor,
  parseTextDraftReplacement,
  redactPhoneNumbers
} from "../src/modules/content-moderation/text-boundaries.js";

function input(action, body, overrides = {}) {
  return {
    action,
    actorUserId: 7,
    openid: "openid-7",
    subjectId: "12",
    baseVersion: "v1",
    idempotencyKey: "request-1",
    body,
    ...overrides
  };
}

test("text boundary descriptors cover every approved D45.5 mutation with only user-authored fields", () => {
  const cases = [
    ["update_nickname", { nickname: "阿青", avatarUrl: "/uploads/avatars/a.png" }, "user_nickname", { nickname: "阿青" }],
    ["create_private_store", { name: "桌游店", city: "上海", contactNote: "电话 138 0013 8000" }, "private_store", { name: "桌游店", city: "上海", contact_note: "电话 [phone]" }],
    ["create_private_script", {
      name: "剧本",
      playerCount: 4,
      typeTags: ["推理", "欢乐"],
      summaryNoSpoiler: "简介",
      defaultSeatTemplate: [{ name: "侦探", description: "角色说明" }]
    }, "private_script", {
      name: "剧本",
      summary: "简介",
      type_tags: "推理 欢乐",
      role_1_name: "侦探",
      role_1_description: "角色说明"
    }],
    ["create_session", {
      storeId: 3,
      scriptId: 4,
      startAt: "2026-07-12 20:00:00",
      dmNameSnapshot: "DM",
      npcNameSnapshot: "NPC",
      note: "拼车说明",
      pinnedMessageText: "集合通知",
      extraNpcRoles: [{ name: "额外 NPC", description: "角色说明" }]
    }, "session_create", {
      dm_name: "DM",
      npc_name: "NPC",
      note: "拼车说明",
      pinned_message: "集合通知",
      extra_npc_1_name: "额外 NPC",
      extra_npc_1_description: "角色说明"
    }],
    ["update_session", { dmNameSnapshot: "DM", note: "更新说明" }, "session_update", { dm_name: "DM", note: "更新说明" }],
    ["create_session_npc_role", { name: "NPC", description: "角色说明" }, "session_npc_role", { name: "NPC", description: "角色说明" }],
    ["update_session_npc_role", { name: "NPC 更新", note: "更新说明" }, "session_npc_role", { name: "NPC 更新", description: "更新说明" }],
    ["upsert_session_review", { content: "体验很好", rating: 5 }, "session_review", { content: "体验很好" }],
    ["create_session_message", { content: "大家晚点到" }, "session_message", { content: "大家晚点到" }],
    ["update_session_pinned_message", { pinnedMessageText: "集合时间改为 20:00" }, "session_pinned_message", { content: "集合时间改为 20:00" }]
  ];

  for (const [action, body, subjectType, fields] of cases) {
    const descriptor = buildTextModerationDescriptor(input(action, body));
    assert.equal(descriptor.subjectType, subjectType);
    assert.deepEqual(descriptor.fields, fields);
    assert.equal(descriptor.payload.actor_user_id, undefined);
    assert.equal(typeof descriptor.payload.body, "object");
  }
});

test("text boundary excludes system text and redacts phone numbers before WeChat submission", () => {
  assert.equal(redactPhoneNumbers("联系 13800138000 或 +86 139-0013-8000"), "联系 [phone] 或 [phone]");
  const descriptor = buildTextModerationDescriptor(input("create_session", {
    storeId: 3,
    scriptId: 4,
    startAt: "2026-07-12 20:00:00",
    note: "联系 13800138000",
    systemMessage: "系统不审核",
    reviewNote: "管理员不审核"
  }));
  assert.deepEqual(descriptor.fields, { note: "联系 [phone]" });
  assert.equal("system_message" in descriptor.fields, false);
  assert.equal("review_note" in descriptor.fields, false);
});

test("NPC canonicalization mirrors every persisted role spelling, string form, and fallback", () => {
  const script = buildTextModerationDescriptor(input("create_private_script", {
    name: "剧本",
    playerCount: 4,
    defaultSeatTemplate: [{ roleName: "剧本角色", roleDescription: "剧本说明" }]
  }));
  assert.deepEqual(script.fields, {
    name: "剧本",
    role_1_name: "剧本角色",
    role_1_description: "剧本说明"
  });

  const fallback = buildTextModerationDescriptor(input("create_private_script", {
    name: "剧本",
    playerCount: 4,
    defaultSeatTemplate: [{ description: "无名角色说明" }]
  }));
  assert.deepEqual(fallback.fields, {
    name: "剧本",
    role_1_name: "角色1",
    role_1_description: "无名角色说明"
  });

  const session = buildTextModerationDescriptor(input("create_session", {
    storeId: 3,
    scriptId: 4,
    startAt: "2026-07-12 20:00:00",
    extraNpcRoles: JSON.stringify([
      { roleName: "JSON NPC", note: "JSON 说明" },
      { label: "标签 NPC", description: "标签说明" }
    ])
  }));
  assert.deepEqual(session.fields, {
    extra_npc_1_name: "JSON NPC",
    extra_npc_1_description: "JSON 说明",
    extra_npc_2_name: "标签 NPC",
    extra_npc_2_description: "标签说明"
  });

  const commaSeparated = buildTextModerationDescriptor(input("create_session", {
    storeId: 3,
    scriptId: 4,
    startAt: "2026-07-12 20:00:00",
    extra_npc_roles: "甲,乙"
  }));
  assert.deepEqual(commaSeparated.fields, {
    extra_npc_1_name: "甲",
    extra_npc_2_name: "乙"
  });

  const standalone = buildTextModerationDescriptor(input("create_session_npc_role", {
    roleName: "独立 NPC",
    roleDescription: "独立说明"
  }));
  assert.deepEqual(standalone.fields, {
    name: "独立 NPC",
    description: "独立说明"
  });
});

test("text proposal payload is action-whitelisted and never keeps unrelated profile or request data", () => {
  const nickname = buildTextModerationDescriptor(input("update_nickname", {
    nickname: "阿青",
    avatarUrl: "/uploads/avatars/avatar-7.png",
    gender: "female",
    phone: "13800138000",
    adminNote: "不要保存",
    signedUrl: "https://private.example/signed"
  }));
  assert.deepEqual(nickname.payload, {
    body: {
      nickname: "阿青",
      avatarUrl: "/uploads/avatars/avatar-7.png",
      gender: "female"
    },
    context: {}
  });

  assert.throws(
    () => buildTextModerationDescriptor(input("update_nickname", {
      nickname: "阿青",
      avatarUrl: "https://private.example/signed?token=secret"
    })),
    { code: "BAD_REQUEST" }
  );

  const session = buildTextModerationDescriptor(input("create_session", {
    storeId: 3,
    scriptId: 4,
    startAt: "2026-07-12 20:00:00",
    note: "拼车说明",
    extraNpcRoles: [{ label: "NPC", note: "角色说明", signedUrl: "https://private.example/x" }],
    phone: "13800138000",
    reviewNote: "管理员备注",
    sourceUrl: "https://private.example/source.mp4"
  }));
  assert.deepEqual(session.payload, {
    body: {
      storeId: 3,
      scriptId: 4,
      startAt: "2026-07-12 20:00:00",
      note: "拼车说明",
      extraNpcRoles: [{
        name: "NPC",
        description: "角色说明",
        roleGender: "unlimited",
        source: "session",
        boundUserId: null,
        sortOrder: 0
      }]
    },
    context: {}
  });
  assert.equal(JSON.stringify(session.payload).includes("private.example"), false);
  assert.equal(JSON.stringify(session.payload).includes("13800138000"), false);
  assert.equal(JSON.stringify(session.payload).includes("管理员备注"), false);
});

test("review proposals retain only validated local review photo paths", () => {
  const descriptor = buildTextModerationDescriptor(input("upsert_session_review", {
    content: "体验很好",
    rating: 5,
    photoUrls: [" /uploads/session-reviews/review-1.jpg "]
  }));
  assert.deepEqual(descriptor.payload, {
    body: {
      rating: 5,
      content: "体验很好",
      photoUrls: ["/uploads/session-reviews/review-1.jpg"]
    },
    context: {}
  });

  assert.throws(
    () => buildTextModerationDescriptor(input("upsert_session_review", {
      content: "体验很好",
      rating: 5,
      photoUrls: ["https://private.example/signed?token=secret"]
    })),
    { code: "BAD_REQUEST" }
  );

  const albumDescriptor = buildTextModerationDescriptor(input("upsert_session_review", {
    content: "很长也可以写到九百字",
    rating: 4,
    albumPhotoIds: [31, 32]
  }));
  assert.deepEqual(albumDescriptor.payload.body.albumPhotoIds, [31, 32]);
  assert.equal(
    buildTextModerationDescriptor(input("upsert_session_review", {
      content: "字".repeat(900),
      rating: 5,
      albumPhotoIds: []
    })).payload.body.content.length,
    900
  );
  assert.throws(
    () => buildTextModerationDescriptor(input("upsert_session_review", {
      content: "字".repeat(901),
      rating: 5,
      albumPhotoIds: []
    })),
    { code: "BAD_REQUEST" }
  );
  assert.throws(
    () => buildTextModerationDescriptor(input("upsert_session_review", {
      content: "不能混用",
      rating: 5,
      photoUrls: [],
      albumPhotoIds: []
    })),
    { code: "BAD_REQUEST" }
  );
});

test("covered invalid payloads fail before a proposal can be sent to WeChat", () => {
  const invalidCases = [
    ["update_nickname", { nickname: "a".repeat(33) }],
    ["create_private_store", { name: "门店" }],
    ["create_private_script", { name: "剧本", playerCount: 0 }],
    ["create_session", { storeId: 3, scriptId: 4 }],
    ["upsert_session_review", { rating: 6, content: "体验很好" }],
    ["create_session_message", { content: "a".repeat(501) }],
    ["update_session_pinned_message", { pinnedMessageText: "a".repeat(301) }]
  ];

  for (const [action, body] of invalidCases) {
    assert.throws(
      () => buildTextModerationDescriptor(input(action, body)),
      { code: "BAD_REQUEST" },
      action
    );
  }
});

test("text boundary skips mutations that do not carry a covered text field", () => {
  assert.equal(
    buildTextModerationDescriptor(input("update_nickname", { avatarUrl: "/uploads/avatars/a.png" })),
    null
  );
  assert.throws(
    () => buildTextModerationDescriptor(input("unknown", { content: "x" })),
    /unsupported/i
  );
});

test("pinned-message moderation preserves the business default when pinnedMessageText is null", () => {
  const nullPinnedText = buildTextModerationDescriptor(input("update_session_pinned_message", {
    pinnedMessageText: null,
    content: "this must not replace the default pin"
  }));
  assert.equal(nullPinnedText, null);

  const contentFallback = buildTextModerationDescriptor(input("update_session_pinned_message", {
    content: "this is the requested pin"
  }));
  assert.deepEqual(contentFallback.fields, { content: "this is the requested pin" });
});

test("D46 replacement draft id is parsed separately, carried as control data, and never enters audited or provider text", () => {
  assert.equal(parseTextDraftReplacement({ replaces_draft_id: 51 }), 51);
  assert.equal(parseTextDraftReplacement({ replacesDraftId: "52" }), 52);
  assert.equal(parseTextDraftReplacement({}), null);

  for (const body of [
    { replaces_draft_id: 0 },
    { replacesDraftId: -1 },
    { replaces_draft_id: "1.5" },
    { replaces_draft_id: 51, replacesDraftId: 51 }
  ]) {
    assert.throws(() => parseTextDraftReplacement(body), { code: "BAD_REQUEST" });
  }

  const descriptor = buildTextModerationDescriptor(input("update_session", {
    note: "新的拼车说明",
    replaces_draft_id: 51,
    replacesDraftId: undefined
  }, {
    context: { sessionId: 12, targetSubjectId: "12" },
    replacesDraftId: 51
  }));
  assert.equal(descriptor.replacesDraftId, 51);
  assert.equal(JSON.stringify(descriptor.payload).includes("replaces"), false);
  assert.equal(JSON.stringify(descriptor.fields).includes("replaces"), false);
  assert.deepEqual(descriptor.payload.context, {
    targetSubjectId: "12",
    sessionId: 12
  });
});
