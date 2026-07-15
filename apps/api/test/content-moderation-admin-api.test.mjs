import assert from "node:assert/strict";
import test from "node:test";

import {
  createAdminModerationApi,
  parseAdminModerationDecisionBody,
  parseAdminModerationJobId,
  parseAdminModerationListQuery,
  serializeAdminModerationDetail,
  serializeAdminModerationListItem
} from "../src/modules/content-moderation/admin-api.js";

function moderationRow(overrides = {}) {
  return {
    id: 9,
    subject_type: "user_nickname",
    subject_id: "17",
    subject_version: "profile-v3",
    provider: "wechat_sec_check",
    provider_job_id: "provider-job-private",
    data_id: "data-id-private",
    policy_id: "policy-private",
    status: "review",
    suggestion: "review",
    label: "100",
    sub_label: "porn",
    score: 87,
    response_summary_json: JSON.stringify({ secret: "provider-summary-private" }),
    attempt_count: 2,
    next_retry_at: null,
    lease_token: "lease-token-private",
    lease_expires_at: "2026-07-13T12:00:00.000Z",
    last_error_code: null,
    submitted_at: "2026-07-13T10:00:00.000Z",
    completed_at: null,
    decided_by_admin_user_id: 4,
    decision_reason: "private administrator note",
    created_at: "2026-07-13T09:00:00.000Z",
    updated_at: "2026-07-13T10:00:00.000Z",
    created_by_user_id: 7,
    object_key: "uploads/private-object.jpg",
    source_url: "https://cos.example/private-source.mp4?token=secret",
    display_url: "https://cos.example/private-display.mp4?token=secret",
    cover_url: "https://cos.example/private-cover.jpg?token=secret",
    openid: "openid-private",
    ...overrides
  };
}

function routeHarness({ authorized = true, row = moderationRow() } = {}) {
  const calls = { authorize: 0, list: [], get: [], decide: [], purge: [], preview: [] };
  const api = createAdminModerationApi({
    authorize: async () => {
      calls.authorize += 1;
      if (!authorized) {
        const error = new Error("system_admin role required");
        error.statusCode = 403;
        error.code = "FORBIDDEN";
        throw error;
      }
      return { user: { id: 2 }, roles: ["system_admin"] };
    },
    listJobs: async (filters) => {
      calls.list.push(filters);
      return [row];
    },
    getJob: async (id) => {
      calls.get.push(id);
      return row;
    },
    decide: async (input) => {
      calls.decide.push(input);
      return { id: input.jobId, status: input.action === "retry" ? "pending" : "approved" };
    },
    purge: async (input) => {
      calls.purge.push(input);
      return { id: 91, moderation_job_id: input.jobId, status: "deleting", purge_pending: true };
    },
    buildPreview: async (input) => {
      calls.preview.push(input);
      return {
        previewUrl: "https://cos.example/admin-preview.jpg?signature=short-lived",
        previewExpiresAt: "2026-07-13T10:01:00.000Z"
      };
    },
    applyTextProposal: async () => ({ id: 1, kind: "safe" })
  });
  return { api, calls };
}

test("administrator moderation queue accepts one canonical value for every supported filter", () => {
  const query = new URLSearchParams({
    provider: "wechat_sec_check",
    type: "album_image",
    status: "review",
    label: "100",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
    limit: "25"
  });

  assert.deepEqual(parseAdminModerationListQuery(query), {
    provider: "wechat_sec_check",
    subjectType: "album_image",
    status: "review",
    label: "100",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
    limit: 25
  });
});

test("administrator moderation queue rejects unknown and duplicate query keys", () => {
  for (const query of [
    new URLSearchParams("unexpected=value"),
    new URLSearchParams([
      ["provider", "wechat_sec_check"],
      ["provider", "tencent_ci_video"]
    ])
  ]) {
    assert.throws(
      () => parseAdminModerationListQuery(query),
      { code: "BAD_REQUEST" }
    );
  }
});

test("administrator moderation queue rejects illegal enum, label, date, and limit filters", () => {
  const invalidQueries = [
    "provider=tencent_tms",
    "type=album_audio",
    "provider=tencent_ci_video&type=user_nickname",
    "status=pending",
    "label=%20Porn",
    "label=" + "a".repeat(65),
    "dateFrom=2026-02-29",
    "dateTo=2026-13-01",
    "limit=0",
    "limit=201",
    "limit=01",
    "limit=1e2"
  ];

  for (const value of invalidQueries) {
    assert.throws(
      () => parseAdminModerationListQuery(new URLSearchParams(value)),
      { code: "BAD_REQUEST" },
      value
    );
  }
});

test("administrator moderation queue validates date order and applies a bounded default limit", () => {
  assert.throws(
    () => parseAdminModerationListQuery(new URLSearchParams({
      dateFrom: "2026-07-31",
      dateTo: "2026-07-01"
    })),
    { code: "BAD_REQUEST" }
  );

  assert.deepEqual(parseAdminModerationListQuery(new URLSearchParams()), {
    provider: undefined,
    subjectType: undefined,
    status: undefined,
    label: undefined,
    dateFrom: undefined,
    dateTo: undefined,
    limit: 100
  });
});

test("administrator moderation job IDs are positive safe integers", () => {
  assert.equal(parseAdminModerationJobId("42"), 42);
  assert.equal(parseAdminModerationJobId(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);

  for (const value of [
    "0",
    "-1",
    "01",
    "1.5",
    "1e3",
    " 1",
    "9007199254740992",
    0,
    1.5,
    Number.MAX_SAFE_INTEGER + 1
  ]) {
    assert.throws(() => parseAdminModerationJobId(value), { code: "BAD_REQUEST" });
  }
});

test("only rejection accepts one bounded non-empty reason", () => {
  assert.deepEqual(
    parseAdminModerationDecisionBody("reject", { reason: "  需要人工驳回  " }),
    { reason: "需要人工驳回" }
  );
  assert.deepEqual(parseAdminModerationDecisionBody("approve", {}), {});
  assert.deepEqual(parseAdminModerationDecisionBody("retry", {}), {});

  const invalidInputs = [
    ["reject", {}],
    ["reject", { reason: "   " }],
    ["reject", { reason: 7 }],
    ["reject", { reason: "a".repeat(501) }],
    ["reject", { reason: "理由", adminUserId: 1 }],
    ["approve", { reason: "不应记录" }],
    ["retry", { action: "approve" }],
    ["approve", []],
    ["other", {}]
  ];

  for (const [action, body] of invalidInputs) {
    assert.throws(
      () => parseAdminModerationDecisionBody(action, body),
      { code: "BAD_REQUEST" }
    );
  }
});

test("administrator moderation queue uses an explicit DTO and does not expose internal job fields", () => {
  const item = serializeAdminModerationListItem(moderationRow());

  assert.deepEqual(item, {
    id: 9,
    provider: "wechat_sec_check",
    subject_type: "user_nickname",
    subject_id: "17",
    subject_version: "profile-v3",
    status: "review",
    suggestion: "review",
    label: "100",
    sub_label: "porn",
    score: 87,
    attempt_count: 2,
    next_retry_at: null,
    last_error_code: null,
    submitted_at: "2026-07-13T10:00:00.000Z",
    completed_at: null,
    created_at: "2026-07-13T09:00:00.000Z",
    updated_at: "2026-07-13T10:00:00.000Z",
    submitter_user_id: 7,
    media: null
  });

  const serialized = JSON.stringify(item);
  for (const secret of [
    "provider-job-private",
    "data-id-private",
    "provider-summary-private",
    "lease-token-private",
    "private-object.jpg",
    "private-source.mp4",
    "openid-private"
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("administrator text detail only projects reviewed text through its action descriptor", () => {
  const detail = serializeAdminModerationDetail(moderationRow({
    proposal_action: "update_nickname",
    normalized_payload_json: JSON.stringify({
      body: {
        nickname: "阿青",
        avatarUrl: "/uploads/avatars/private.png",
        arbitrary: "private field",
        contactNote: "13800138000"
      },
      context: { targetSubjectId: "private-target" },
      openid: "payload-openid-private"
    })
  }));

  assert.deepEqual(detail.text, {
    action: "update_nickname",
    fields: { nickname: "阿青" }
  });
  assert.equal(detail.media, null);
  const serialized = JSON.stringify(detail);
  for (const secret of [
    "private field",
    "13800138000",
    "private-target",
    "payload-openid-private",
    "provider-job-private",
    "data-id-private",
    "lease-token-private",
    "private-source.mp4"
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("administrator media detail contains only media metadata and caller-provided short preview data", () => {
  const detail = serializeAdminModerationDetail(moderationRow({
    subject_type: "album_video",
    subject_id: "72",
    provider: "tencent_ci_video",
    media_type: "video",
    session_id: 11,
    uploader_user_id: 8,
    processing_status: "ready",
    moderation_status: "review",
    normalized_payload_json: JSON.stringify({ body: { nickname: "must not appear" } })
  }), {
    previewUrl: "https://cos.example/admin-preview.mp4?signature=short-lived",
    previewExpiresAt: "2026-07-13T10:01:00.000Z"
  });

  assert.equal(detail.text, null);
  assert.deepEqual(detail.media, {
    session_id: 11,
    uploader_user_id: 8,
    media_type: "video",
    processing_status: "ready",
    moderation_status: "review",
    preview_url: "https://cos.example/admin-preview.mp4?signature=short-lived",
    preview_expires_at: "2026-07-13T10:01:00.000Z"
  });
  const serialized = JSON.stringify(detail);
  for (const secret of [
    "private-object.jpg",
    "private-source.mp4",
    "private-display.mp4",
    "private-cover.jpg",
    "must not appear",
    "openid-private"
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("administrator moderation routes authorize before listing, viewing, or deciding", async () => {
  const { api, calls } = routeHarness({ authorized: false });
  const requests = [
    { method: "GET", pathname: "/api/admin/content-moderation", searchParams: new URLSearchParams() },
    { method: "GET", pathname: "/api/admin/content-moderation/9", searchParams: new URLSearchParams() },
    { method: "POST", pathname: "/api/admin/content-moderation/9/approve", body: {} },
    { method: "POST", pathname: "/api/admin/content-moderation/9/reject", body: { reason: "违规" } },
    { method: "POST", pathname: "/api/admin/content-moderation/9/retry", body: {} },
    {
      method: "POST",
      pathname: "/api/admin/content-moderation/9/purge",
      body: { reason: "紧急移除", confirmation: "PURGE" }
    }
  ];

  for (const request of requests) {
    await assert.rejects(api(request), { code: "FORBIDDEN" });
  }
  assert.equal(calls.authorize, requests.length);
  assert.deepEqual(calls.list, []);
  assert.deepEqual(calls.get, []);
  assert.deepEqual(calls.decide, []);
  assert.deepEqual(calls.purge, []);
  assert.deepEqual(calls.preview, []);
});

test("administrator moderation routes bind whitelist filters, short preview data, and path actions", async () => {
  const media = moderationRow({
    subject_type: "album_image",
    subject_id: "91",
    media_type: "image",
    session_id: 8,
    uploader_user_id: 7,
    moderation_status: "review",
    object_key: "uploads/session-album/display/private.jpg"
  });
  const { api, calls } = routeHarness({ row: media });

  const listed = await api({
    method: "GET",
    pathname: "/api/admin/content-moderation",
    searchParams: new URLSearchParams({ provider: "wechat_sec_check", type: "album_image", limit: "5" })
  });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(calls.list, [{
    provider: "wechat_sec_check",
    subjectType: "album_image",
    status: undefined,
    label: undefined,
    dateFrom: undefined,
    dateTo: undefined,
    limit: 5
  }]);
  assert.equal(JSON.stringify(listed.data).includes("private.jpg"), false);

  const detail = await api({
    method: "GET",
    pathname: "/api/admin/content-moderation/9",
    searchParams: new URLSearchParams()
  });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.data.media.preview_url, "https://cos.example/admin-preview.jpg?signature=short-lived");
  assert.equal(JSON.stringify(detail.data).includes("private.jpg"), false);
  assert.deepEqual(calls.get, [9]);
  assert.equal(calls.preview.length, 1);

  const decided = await api({
    method: "POST",
    pathname: "/api/admin/content-moderation/9/reject",
    body: { reason: "  人工确认违规  " }
  });
  assert.deepEqual(decided, { statusCode: 200, data: { id: 9, status: "approved" } });
  assert.deepEqual(calls.decide, [{
    admin: { user: { id: 2 }, roles: ["system_admin"] },
    jobId: 9,
    action: "reject",
    reason: "人工确认违规",
    applyTextProposal: calls.decide[0].applyTextProposal
  }]);
  assert.equal(typeof calls.decide[0].applyTextProposal, "function");
});

test("administrator moderation route matching rejects malformed paths and body action spoofing", async () => {
  const { api, calls } = routeHarness();
  assert.equal(await api({
    method: "GET",
    pathname: "/api/admin/content-moderation/9/approve",
    searchParams: new URLSearchParams()
  }), null);
  await assert.rejects(api({
    method: "POST",
    pathname: "/api/admin/content-moderation/9007199254740992/approve",
    body: {}
  }), { code: "BAD_REQUEST" });
  await assert.rejects(api({
    method: "POST",
    pathname: "/api/admin/content-moderation/9/approve",
    body: { action: "reject" }
  }), { code: "BAD_REQUEST" });
  assert.deepEqual(calls.decide, []);
});

test("administrator purge is a separate confirmed asynchronous action", async () => {
  const { api, calls } = routeHarness();
  const result = await api({
    method: "POST",
    pathname: "/api/admin/content-moderation/9/purge",
    body: { reason: "  紧急合规移除  ", confirmation: "PURGE" }
  });
  assert.deepEqual(result, {
    statusCode: 202,
    data: { id: 91, moderation_job_id: 9, status: "deleting", purge_pending: true }
  });
  assert.deepEqual(calls.purge, [{
    admin: { user: { id: 2 }, roles: ["system_admin"] },
    jobId: 9,
    reason: "紧急合规移除",
    confirmation: "PURGE"
  }]);
  assert.deepEqual(calls.decide, []);
});
