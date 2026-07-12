import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  contentModerationErrorText,
  contentModerationStatusText
} from "../src/utils/contentModeration.js";

const PENDING_TEXT = "内容正在审核";
const REVIEW_TEXT = "内容需要进一步审核";
const REJECTED_TEXT = "内容未通过安全审核，如有疑问请联系客服";

function assertSuccessfulUpdateFollowsRequest(source, requestMarker, successMarker) {
  const requestAt = source.indexOf(requestMarker);
  const successAt = source.indexOf(successMarker, requestAt);
  assert.ok(requestAt >= 0, `missing request marker: ${requestMarker}`);
  assert.ok(successAt > requestAt, `success update must follow request: ${successMarker}`);
}

test("content moderation status presentation only exposes the three approved user messages", () => {
  for (const status of ["pending", "processing", "error"]) {
    assert.equal(contentModerationStatusText(status), PENDING_TEXT);
  }
  assert.equal(contentModerationStatusText("review"), REVIEW_TEXT);
  assert.equal(contentModerationStatusText("rejected"), REJECTED_TEXT);
  assert.equal(contentModerationStatusText("approved"), "");
  assert.equal(contentModerationStatusText("approved_legacy"), "");
  assert.equal(contentModerationStatusText("untrusted-status"), "");
});

test("provider failures are reduced to safe user messages without provider details", () => {
  assert.equal(
    contentModerationErrorText({
      code: "CONTENT_MODERATION_REVIEW_PENDING",
      message: "WeChat review label: political-person"
    }),
    REVIEW_TEXT
  );
  assert.equal(
    contentModerationErrorText({
      code: "CONTENT_MODERATION_REJECTED",
      message: "Tencent hit word: unsafe"
    }),
    REJECTED_TEXT
  );
  assert.equal(
    contentModerationErrorText({
      code: "CONTENT_MODERATION_UNAVAILABLE",
      message: "provider temporarily unavailable"
    }),
    PENDING_TEXT
  );
  assert.equal(contentModerationErrorText({ code: "UNRELATED", message: "other" }), "");
});

test("the mini-program renders mapped media statuses and keeps text Review on the failure path", async () => {
  const [api, album, review, detail, manage, chat, pinned] = await Promise.all([
    readFile(new URL("../src/utils/api.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/session/album.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/session/review.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/session/detail.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/session/manage.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/extensions/session-pseudo-chat/ChatEntry.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/extensions/session-pseudo-chat/ManagePinnedMessage.vue", import.meta.url), "utf8")
  ]);
  const [profile, create, script, setup] = await Promise.all([
    readFile(new URL("../src/components/AuthIdentityBar.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/session/create.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/session/script.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/session/setup.vue", import.meta.url), "utf8")
  ]);
  const template = album.slice(0, album.indexOf("<script>"));
  const reviewSaveStart = review.indexOf("async saveReview()");
  const reviewCatchStart = review.indexOf("} catch (error)", reviewSaveStart);
  const reviewFinallyStart = review.indexOf("} finally", reviewCatchStart);
  const reviewCatch = review.slice(reviewCatchStart, reviewFinallyStart);

  assert.match(api, /contentModerationErrorText/);
  assert.match(api, /error\.userMessage\s*=\s*contentModerationErrorText\(error\)\s*\|\|\s*error\.message/);
  assert.match(api, /responseData\.ok === false/);

  assert.equal(
    template.match(/v-if="mediaModerationStatusText\(photo\)"/g)?.length,
    2,
    "both waterfall columns must show the mapped media status"
  );
  assert.match(album, /contentModerationStatusText/);
  assert.match(album, /this\.timelineMode \|\| !photo\?\.is_mine/);
  assert.match(album, /videoStateText\(photo\)[\s\S]*mediaModerationStatusText\(photo\)/);
  assert.doesNotMatch(album, /moderation_message|photo\.(?:provider|provider_job_id|score|suggestion|hit_words)/);

  assert.match(reviewCatch, /const moderationMessage = contentModerationErrorText\(error\);/);
  assert.match(reviewCatch, /if \(moderationMessage\) \{\s*this\.statusText = moderationMessage;\s*return;/);
  assert.doesNotMatch(reviewCatch, /this\.(?:rating|content|photos)\s*=/);

  assert.match(detail, /contentModerationErrorText/);
  assert.match(manage, /contentModerationErrorText/);
  assert.match(chat, /this\.authTools\.contentModerationErrorText\?\.\(error\)/);
  assert.match(pinned, /this\.authTools\.contentModerationErrorText\?\.\(error\)/);
  for (const source of [profile, create, script, setup]) {
    assert.match(source, /error\?\.userMessage|error\.userMessage/);
  }
  assertSuccessfulUpdateFollowsRequest(profile, "const auth = await updateUserProfile(patch);", "this.user = auth.user;");
  assertSuccessfulUpdateFollowsRequest(create, "const response = await request({", "this.stores = [store,");
  assertSuccessfulUpdateFollowsRequest(script, "const response = await request({", "this.scripts = [script,");
  assertSuccessfulUpdateFollowsRequest(setup, "const sessionResponse = await request({", "uni.redirectTo({ url:");
  assertSuccessfulUpdateFollowsRequest(
    chat,
    "const message = await this.api.sendMessage(",
    "this.messages = [...this.messages, message];"
  );
  assertSuccessfulUpdateFollowsRequest(
    pinned,
    "const result = await this.api.updatePinnedMessage(",
    "this.pinnedMessage = result.pinnedMessage || null;"
  );
});
