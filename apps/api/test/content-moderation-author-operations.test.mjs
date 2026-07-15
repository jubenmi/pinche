import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertContentModerationConfig,
  buildContentModerationConfig
} from "../src/config/env.js";
import { serializeAdminModerationDetail } from "../src/modules/content-moderation/admin-api.js";
import { getAuthorPrivateRetentionStats } from "../src/modules/content-moderation/repository.js";
import {
  createContentModerationTelemetry,
  emitAuthorPrivateRetentionSnapshot
} from "../src/modules/content-moderation/telemetry.js";

const ACTIONS = [
  "update_nickname",
  "create_private_store",
  "create_private_script",
  "create_session",
  "update_session",
  "create_session_npc_role",
  "update_session_npc_role",
  "upsert_session_review",
  "create_session_message",
  "update_session_pinned_message"
];

test("D46 author-private gates default closed and accept only an explicit action subset", () => {
  const defaults = buildContentModerationConfig({ NODE_ENV: "production" });
  assert.equal(defaults.authorPrivateTextEnabled, false);
  assert.deepEqual(defaults.authorPrivateTextActions, []);
  assert.equal(defaults.authorPrivateImageEnabled, false);
  assert.equal(defaults.authorPrivateVideoEnabled, false);
  assert.equal(defaults.authorPreviewTtlSeconds, 60);

  const configured = buildContentModerationConfig({
    NODE_ENV: "production",
    CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ENABLED: "true",
    CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ACTIONS: `${ACTIONS[0]}, ${ACTIONS[4]}`,
    CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED: "true",
    CONTENT_MODERATION_AUTHOR_PRIVATE_VIDEO_ENABLED: "true",
    CONTENT_MODERATION_AUTHOR_PREVIEW_TTL_SECONDS: "30"
  });
  assert.equal(configured.authorPrivateTextEnabled, true);
  assert.deepEqual(configured.authorPrivateTextActions, [ACTIONS[0], ACTIONS[4]]);
  assert.equal(configured.authorPrivateImageEnabled, true);
  assert.equal(configured.authorPrivateVideoEnabled, true);
  assert.equal(configured.authorPreviewTtlSeconds, 30);
});

test("D46 invalid, duplicate, empty-item actions and invalid TTL fail without echoing values", () => {
  for (const actions of [
    "unknown_action",
    `${ACTIONS[0]},${ACTIONS[0]}`,
    `${ACTIONS[0]},,${ACTIONS[1]}`
  ]) {
    assert.throws(
      () => buildContentModerationConfig({
        CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ACTIONS: actions
      }),
      (error) => (
        error?.code === "CONTENT_MODERATION_CONFIGURATION_ERROR" &&
        !String(error.message).includes(actions)
      )
    );
  }
  for (const ttl of ["0", "61", "1.5", "secret-ttl-value"]) {
    assert.throws(
      () => buildContentModerationConfig({
        CONTENT_MODERATION_AUTHOR_PREVIEW_TTL_SECONDS: ttl
      }),
      (error) => (
        error?.code === "CONTENT_MODERATION_CONFIGURATION_ERROR" &&
        !String(error.message).includes(ttl)
      )
    );
  }
});

test("D46 production media gates require private COS while an empty text action set stays closed", () => {
  const emptyText = buildContentModerationConfig({
    NODE_ENV: "production",
    CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ENABLED: "true"
  });
  assert.deepEqual(emptyText.authorPrivateTextActions, []);
  assert.doesNotThrow(() => assertContentModerationConfig(emptyText, { nodeEnv: "production" }));

  for (const gate of [
    "CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED",
    "CONTENT_MODERATION_AUTHOR_PRIVATE_VIDEO_ENABLED"
  ]) {
    const config = buildContentModerationConfig({ NODE_ENV: "production", [gate]: "true" });
    assert.throws(
      () => assertContentModerationConfig(config, { nodeEnv: "production" }),
      (error) => (
        error?.code === "CONTENT_MODERATION_CONFIGURATION_ERROR" &&
        String(error.message).includes("COS_ENABLED")
      )
    );
  }
});

test("D46 telemetry supports every author operation and strips identities and private content", () => {
  const records = [];
  const telemetry = createContentModerationTelemetry({
    now: () => new Date("2026-07-15T09:00:00.000Z"),
    sink: (line) => records.push(JSON.parse(line))
  });
  const events = [
    "author_private_created",
    "author_private_read",
    "author_private_cancelled",
    "author_private_superseded",
    "author_private_rejected",
    "author_private_purged",
    "author_private_access_denied",
    "author_private_public_leak"
  ];
  for (const event of events) {
    telemetry.emit(event, {
      subjectType: "album_image",
      outcome: "rejected",
      routeKind: "session_public_share",
      reasonCode: event === "author_private_public_leak" ? "draft_id" : "policy_denied",
      priority: event === "author_private_public_leak" ? "high" : undefined,
      authorId: 7,
      content: "不能记录的作者正文",
      objectKey: "uploads/session-album/display/private.jpg",
      signedUrl: "https://cos.invalid/private?signature=secret"
    });
  }
  assert.deepEqual(records.map((record) => record.event), events);
  assert.equal(records.at(-1).priority, "high");
  assert.equal(records.at(-1).routeKind, "session_public_share");
  assert.equal(records.at(-1).reasonCode, "draft_id");
  const serialized = JSON.stringify(records);
  for (const privateValue of ["作者正文", "private.jpg", "signature=secret", '"authorId"', '"7"']) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }
});

test("D46 retained media metrics include count bytes and long-lived count without deleting anything", () => {
  const emitted = [];
  emitAuthorPrivateRetentionSnapshot({
    telemetry: { emit: (event, fields) => emitted.push({ event, fields }) },
    stats: {
      retained_object_count: 12,
      retained_bytes: 4096,
      long_lived_count: 2
    },
    thresholds: {
      objectCount: 10,
      bytes: 8192,
      longLivedCount: 1
    }
  });
  assert.deepEqual(emitted.map(({ event }) => event), [
    "author_private_retained_object_count",
    "author_private_retained_bytes",
    "author_private_long_lived_count",
    "author_private_retention_alert",
    "author_private_retention_alert"
  ]);
  assert.deepEqual(emitted.slice(-2).map(({ fields }) => fields.reasonCode), [
    "object_count",
    "long_lived_count"
  ]);
  assert.ok(emitted.slice(-2).every(({ fields }) => fields.priority === "high"));
  assert.equal(JSON.stringify(emitted).includes("delete"), false);
});

test("D46 retention repository aggregates only active rejected policy-version-one media", async () => {
  let captured;
  const connection = {
    async query(sql, values) {
      captured = { sql, values };
      return [[{
        retained_object_count: "4",
        retained_bytes: "1048576",
        long_lived_count: "1"
      }]];
    }
  };
  const stats = await getAuthorPrivateRetentionStats(connection, { longLivedDays: 30 });
  assert.deepEqual(stats, {
    retained_object_count: 4,
    retained_bytes: 1048576,
    long_lived_count: 1
  });
  assert.match(captured.sql, /author_visibility_version = 1/);
  assert.match(captured.sql, /status = 'active'/);
  assert.match(captured.sql, /moderation_status = 'rejected'/);
  assert.match(captured.sql, /image_byte_size/);
  assert.match(captured.sql, /video_byte_size/);
  assert.match(captured.sql, /DATE_SUB\(CURRENT_TIMESTAMP, INTERVAL \? DAY\)/);
  assert.deepEqual(captured.values, [30]);
});

test("D46 admin detail exposes only the retained boolean and the workspace renders it", async () => {
  const detail = serializeAdminModerationDetail({
    id: 44,
    provider: "wechat_sec_check",
    subject_type: "album_image",
    subject_id: "9",
    subject_version: "etag-secret",
    status: "rejected",
    media_id: 9,
    media_type: "image",
    media_record_status: "active",
    moderation_status: "rejected",
    author_visibility_version: 1,
    object_key: "uploads/session-album/display/private.jpg",
    source_url: "/private-source",
    display_url: "/private-display",
    cover_url: "/private-cover"
  });
  assert.equal(detail.author_private_retained, true);
  const serialized = JSON.stringify(detail);
  for (const forbidden of ["object_key", "private.jpg", "private-source", "private-display", "private-cover"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  const workspace = await readFile(
    new URL("../../admin-web/src/components/ContentModerationWorkspace.vue", import.meta.url),
    "utf8"
  );
  assert.match(workspace, /detail\.author_private_retained/);
  assert.match(workspace, /作者私有保留/);
  assert.doesNotMatch(workspace, /author.*preview_url|object_key|source_url|display_url|cover_url/i);
});

test("D46 production examples and runbook keep author gates separate from D45 intake", async () => {
  const [envExample, productionEnv, compose, runbook, retryWorker] = await Promise.all([
    readFile(new URL("../../../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../../../.env.production.example", import.meta.url), "utf8"),
    readFile(new URL("../../../docker-compose.prod.example.yml", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/runbooks/hybrid-content-moderation-release.md", import.meta.url), "utf8"),
    readFile(new URL("../src/jobs/content-moderation-retry.js", import.meta.url), "utf8")
  ]);
  for (const source of [envExample, productionEnv, compose, runbook]) {
    for (const name of [
      "CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ENABLED",
      "CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ACTIONS",
      "CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED",
      "CONTENT_MODERATION_AUTHOR_PRIVATE_VIDEO_ENABLED",
      "CONTENT_MODERATION_AUTHOR_PREVIEW_TTL_SECONDS"
    ]) {
      assert.equal(source.includes(name), true, name);
    }
  }
  assert.match(runbook, /D45 intake.*独立|独立.*D45 intake/i);
  assert.match(runbook, /purge/i);
  assert.match(runbook, /回滚/);
  assert.match(runbook, /不得.*自动删除/);
  assert.match(retryWorker, /getAuthorPrivateRetentionStats/);
  assert.match(retryWorker, /emitAuthorPrivateRetentionSnapshot/);
});
