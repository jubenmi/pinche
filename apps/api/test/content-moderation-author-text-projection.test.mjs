import assert from "node:assert/strict";
import test from "node:test";

import {
  projectAuthorTextProposal
} from "../src/modules/content-moderation/text-author-projection.js";

const sensitive = {
  openid: "openid-secret",
  phone: "13800138000",
  context: { targetSubjectId: "secret" },
  base_version: "v1",
  idempotency_key: "request-secret",
  provider_result: { label: "100", score: 99 },
  normalized_payload_json: "raw audit payload"
};

test("D46 explicitly projects the ten text actions with correct draft and published identities", () => {
  const cases = [
    ["update_nickname", "7", {
      nickname: "新昵称", avatarUrl: "/uploads/avatars/a.png", gender: "female", ...sensitive
    }, 7, {
      nickname: "新昵称", avatarUrl: "/uploads/avatars/a.png", gender: "female"
    }],
    ["create_private_store", "creation:create_private_store:7", {
      name: "桌游店", city: "上海", district: "徐汇", address: "地址", latitude: 31.2,
      longitude: 121.4, contactNote: "到店联系", ...sensitive
    }, null, {
      is_draft: true, name: "桌游店", city: "上海", district: "徐汇", address: "地址",
      latitude: 31.2, longitude: 121.4, contactNote: "到店联系"
    }],
    ["create_private_script", "creation:create_private_script:7", {
      name: "剧本", typeTags: ["推理"], summaryNoSpoiler: "简介", playerCount: 4,
      defaultSeatTemplate: [{
        name: "侦探", description: "说明", roleGender: "unlimited", sortOrder: 0,
        provider: "must-not-leak"
      }],
      ...sensitive
    }, null, {
      is_draft: true,
      name: "剧本",
      typeTags: ["推理"],
      summaryNoSpoiler: "简介",
      playerCount: 4,
      defaultSeatTemplate: [{
        name: "侦探", description: "说明", roleGender: "unlimited", sortOrder: 0
      }]
    }],
    ["create_session", "creation:create_session:7", {
      storeId: 3, scriptId: 4, startAt: "2026-07-15 20:00:00", dmUserId: 7,
      dmNameSnapshot: "DM", npcUserId: 8, npcNameSnapshot: "NPC", depositAmount: 100,
      visibility: "share_only", note: "说明", pinnedMessageText: "集合", joinPolicy: "direct",
      joinPhoneRequired: false, npcJoinEnabled: true,
      extraNpcRoles: [{ name: "NPC2", description: "说明2", source: "session", boundUserId: null, sortOrder: 1, score: 100 }],
      ...sensitive
    }, null, {
      is_draft: true,
      storeId: 3, scriptId: 4, startAt: "2026-07-15 20:00:00", dmUserId: 7,
      dmNameSnapshot: "DM", npcUserId: 8, npcNameSnapshot: "NPC", depositAmount: 100,
      visibility: "share_only", note: "说明", pinnedMessageText: "集合", joinPolicy: "direct",
      joinPhoneRequired: false, npcJoinEnabled: true,
      extraNpcRoles: [{ name: "NPC2", description: "说明2", source: "session", boundUserId: null, sortOrder: 1 }]
    }],
    ["update_session", "12", {
      startAt: "2026-07-15 21:00:00", dmNameSnapshot: "新 DM", note: "新说明", status: "open", ...sensitive
    }, 12, {
      startAt: "2026-07-15 21:00:00", dmNameSnapshot: "新 DM", note: "新说明", status: "open"
    }],
    ["create_session_npc_role", "session:12", {
      name: "新增 NPC", description: "新增说明", roleGender: "female", source: "session",
      boundUserId: null, sortOrder: 2, ...sensitive
    }, null, {
      is_draft: true, name: "新增 NPC", description: "新增说明", roleGender: "female",
      source: "session", boundUserId: null, sortOrder: 2
    }],
    ["update_session_npc_role", "88", {
      name: "修改 NPC", description: "修改说明", roleGender: "male", status: "active", ...sensitive
    }, 88, {
      name: "修改 NPC", description: "修改说明", roleGender: "male", status: "active"
    }],
    ["upsert_session_review", "12", {
      rating: 5, content: "体验很好", photoUrls: ["/uploads/session-reviews/a.jpg"], ...sensitive
    }, 12, {
      rating: 5, content: "体验很好", photoUrls: ["/uploads/session-reviews/a.jpg"]
    }],
    ["upsert_session_review", "12", {
      rating: 4, content: "相册照片", albumPhotoIds: [31, 32], ...sensitive
    }, 12, {
      rating: 4, content: "相册照片", albumPhotoIds: [31, 32]
    }],
    ["create_session_message", "12", {
      content: "大家晚点到", ...sensitive
    }, null, {
      is_draft: true, content: "大家晚点到"
    }],
    ["update_session_pinned_message", "12", {
      pinnedMessageText: "集合时间改为 20:00", ...sensitive
    }, 12, {
      pinnedMessageText: "集合时间改为 20:00"
    }]
  ];

  for (const [action, targetSubjectId, body, publishedId, content] of cases) {
    assert.deepEqual(projectAuthorTextProposal({ action, targetSubjectId, body }), {
      publishedId,
      content
    }, action);
  }
});

test("D46 author projection clones nested data and strips sensitive fields at every depth", () => {
  const body = {
    name: "剧本",
    playerCount: 2,
    typeTags: ["推理"],
    defaultSeatTemplate: [{
      name: "角色",
      description: "说明",
      openid: "nested-secret",
      provider_result: { score: 100 }
    }],
    ...sensitive
  };
  const projection = projectAuthorTextProposal({
    action: "create_private_script",
    targetSubjectId: "creation:create_private_script:7",
    body
  });

  body.typeTags.push("mutated");
  body.defaultSeatTemplate[0].name = "mutated";
  assert.deepEqual(projection.content.typeTags, ["推理"]);
  assert.equal(projection.content.defaultSeatTemplate[0].name, "角色");
  const serialized = JSON.stringify(projection);
  for (const secret of ["openid", "13800138000", "base_version", "provider_result", "nested-secret"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("D46 author projection rejects disabled actions, malformed bodies, and invalid published targets", () => {
  for (const action of ["arbitrary_action", "__proto__", "constructor"]) {
    assert.throws(
      () => projectAuthorTextProposal({ action, body: {}, targetSubjectId: "1" }),
      { code: "CONTENT_MODERATION_AUTHOR_PROJECTION_INVALID" }
    );
  }
  assert.throws(
    () => projectAuthorTextProposal({ action: "update_nickname", body: [], targetSubjectId: "7" }),
    { code: "CONTENT_MODERATION_AUTHOR_PROJECTION_INVALID" }
  );
  for (const targetSubjectId of ["", "creation:update_session:7", "0", "1.5"]) {
    assert.throws(
      () => projectAuthorTextProposal({ action: "update_session", body: { note: "x" }, targetSubjectId }),
      { code: "CONTENT_MODERATION_AUTHOR_PROJECTION_INVALID" }
    );
  }
});
