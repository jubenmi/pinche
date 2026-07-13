import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildModerationListFilters,
  formatModerationScore,
  isMediaModeration,
  moderationProviderLabel,
  moderationStatusLabel,
  moderationSubjectTypeLabel,
  moderationDecisionBody
} from "../src/contentModeration.js";
import { buildAdminRouteQuery, parseAdminRouteQuery } from "../src/adminRoute.js";

test("content moderation navigation has an isolated stable route", () => {
  assert.equal(parseAdminRouteQuery("?view=moderation").activeView, "moderation");
  assert.equal(buildAdminRouteQuery({ activeView: "moderation" }), "?view=moderation");
  assert.equal(parseAdminRouteQuery("?view=unknown").activeView, "catalog");
});

test("queue filters send only the strict D45.11 whitelist and omit empty values", () => {
  assert.deepEqual(buildModerationListFilters({
    provider: "wechat_sec_check",
    type: "album_image",
    status: "review",
    label: "100",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
    limit: 200,
    keyword: "must never reach the API",
    arbitrary: "nope"
  }), {
    provider: "wechat_sec_check",
    type: "album_image",
    status: "review",
    label: "100",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
    limit: "200"
  });

  assert.deepEqual(buildModerationListFilters({
    provider: "",
    type: "",
    status: "",
    label: "",
    dateFrom: "",
    dateTo: "",
    limit: "not-a-limit"
  }), { limit: "100" });
});

test("decision body is path-owned and rejects require a bounded visible reason", () => {
  assert.deepEqual(moderationDecisionBody("approve", "ignored"), {});
  assert.deepEqual(moderationDecisionBody("retry", "ignored"), {});
  assert.deepEqual(moderationDecisionBody("reject", "  人工确认违规  "), {
    reason: "人工确认违规"
  });
  assert.throws(() => moderationDecisionBody("reject", "  "), /拒绝原因/);
  assert.throws(() => moderationDecisionBody("reject", "a".repeat(501)), /拒绝原因/);
  assert.throws(() => moderationDecisionBody("other", ""), /操作/);
});

test("moderation display helpers cover the supported queue without leaking media paths", () => {
  assert.equal(moderationProviderLabel("wechat_sec_check"), "微信内容安全");
  assert.equal(moderationProviderLabel("tencent_ci_video"), "腾讯云视频审核");
  assert.equal(moderationStatusLabel("review"), "待人工复核");
  assert.equal(moderationStatusLabel("error"), "审核异常");
  assert.equal(moderationSubjectTypeLabel("album_video"), "相册视频");
  assert.equal(isMediaModeration({ subject_type: "album_image" }), true);
  assert.equal(isMediaModeration({ subject_type: "session_message" }), false);
  assert.equal(formatModerationScore(null), "-");
  assert.equal(formatModerationScore(undefined), "-");
  assert.equal(formatModerationScore(""), "-");
  assert.equal(formatModerationScore(0), "0");
  assert.equal(formatModerationScore("87"), "87");
  assert.equal(formatModerationScore("not-a-score"), "-");
});

test("admin API adapter exposes only the approved moderation routes and exact decision bodies", async () => {
  const source = await readFile(new URL("../src/api.js", import.meta.url), "utf8");

  assert.match(source, /buildModerationListFilters/);
  assert.match(source, /export function listContentModerationJobs/);
  assert.match(source, /`\/api\/admin\/content-moderation\?\$\{query\}`/);
  assert.match(source, /export function getContentModerationJob/);
  assert.match(source, /`\/api\/admin\/content-moderation\/\$\{encodeURIComponent\(jobId\)\}`/);
  assert.match(source, /export function approveContentModerationJob/);
  assert.match(source, /\/approve`, \{\s*method: "POST",\s*body: \{\}/);
  assert.match(source, /export function rejectContentModerationJob/);
  assert.match(source, /\/reject`, \{\s*method: "POST",\s*body: \{ reason \}/);
  assert.match(source, /export function retryContentModerationJob/);
  assert.match(source, /\/retry`, \{\s*method: "POST",\s*body: \{\}/);
});

test("admin workspace keeps the moderation queue isolated and renders only the short detail preview", async () => {
  const [app, workspace] = await Promise.all([
    readFile(new URL("../src/App.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ContentModerationWorkspace.vue", import.meta.url), "utf8")
  ]);

  assert.match(app, /ContentModerationWorkspace/);
  assert.match(app, /activeView === 'moderation'/);
  assert.match(app, /activeView === 'moderation' && canReviewContent/);
  assert.match(app, /内容审核仅限系统管理员使用/);
  assert.match(app, /内容审核/);
  assert.match(workspace, /listContentModerationJobs/);
  assert.match(workspace, /getContentModerationJob/);
  assert.match(workspace, /approveContentModerationJob/);
  assert.match(workspace, /rejectContentModerationJob/);
  assert.match(workspace, /retryContentModerationJob/);
  assert.match(workspace, /moderationDecisionBody\(action/);
  assert.match(workspace, /detail\.media\.preview_url/);
  assert.match(workspace, /preview_expires_at/);
  assert.equal(
    workspace.match(/referrerpolicy="no-referrer"/g)?.length,
    2,
    "both image and video previews must omit the referring admin page URL"
  );
  assert.match(workspace, /aria-label="审核服务商"/);
  assert.match(workspace, /aria-label="审核内容类型"/);
  assert.match(workspace, /aria-label="审核任务状态"/);
  assert.match(workspace, /aria-label="风险标签（精确匹配）"/);
  assert.match(workspace, /statusCode === 404 \|\| statusCode === 409/);
  assert.match(workspace, /await reloadAfterConflict\(\)/);
  assert.doesNotMatch(workspace, /object_key|source_url|display_url|cover_url|provider_job_id|lease_token/);
  assert.doesNotMatch(workspace, /localStorage|assetUrl|fetchAuthorizedMediaObjectUrl/);
  assert.doesNotMatch(workspace, /v-html/);
});
