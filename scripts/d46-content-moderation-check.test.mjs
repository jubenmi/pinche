import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertDirectCosIntakeBranches,
  assertDirectCosIntentIntakeBranches,
  assertOnlyApprovedMiniProgramModerationCopy,
  sourceSection
} from "./d46-content-moderation-check-lib.js";

const server = await readFile(new URL("../apps/api/src/server.js", import.meta.url), "utf8");
const directCosAuthorization = sourceSection(
  server,
  "async function authorizeCosDirectUpload({ body, user })",
  "\nasync function saveUploadedObject"
);
const directCosIntent = sourceSection(
  server,
  "async function createCosDirectUploadIntent({ kind, extension, user, userId, sessionId })",
  "\nfunction normalizeCosHeaders"
);

test("D46 moderation-copy checker rejects arbitrary review wording but ignores comments and identifiers", () => {
  assert.throws(
    () => assertOnlyApprovedMiniProgramModerationCopy(
      "apps/miniprogram/src/pages/session/album.vue",
      "<view>图片仍在审核</view>"
    ),
    /unapproved mini-program moderation copy/
  );
  assert.throws(
    () => assertOnlyApprovedMiniProgramModerationCopy(
      "apps/miniprogram/src/pages/session/album.vue",
      'const copy = "\\u56fe\\u7247\\u4ecd\\u5728\\u5ba1\\u6838";'
    ),
    /unapproved mini-program moderation copy/
  );
  assert.doesNotThrow(() => assertOnlyApprovedMiniProgramModerationCopy(
    "apps/miniprogram/src/pages/session/album.vue",
    'const pattern = /"图片仍在审核"/;'
  ));
  assert.doesNotThrow(() => assertOnlyApprovedMiniProgramModerationCopy(
    "apps/miniprogram/src/pages/session/album.vue",
    'function matcher() { return /"图片仍在审核"/; }'
  ));
  assert.doesNotThrow(() => assertOnlyApprovedMiniProgramModerationCopy(
    "apps/miniprogram/src/pages/session/album.vue",
    'const matcher = () => /"图片仍在审核"/;'
  ));
  assert.doesNotThrow(() => assertOnlyApprovedMiniProgramModerationCopy(
    "apps/miniprogram/src/pages/session/album.vue",
    "<template><!-- <view>图片仍在审核</view> --><view>正常</view></template>"
  ));
  assert.throws(
    () => assertOnlyApprovedMiniProgramModerationCopy(
      "apps/miniprogram/src/pages/session/album.vue",
      'const copy = "\\u{56fe}\\u{7247}\\u{4ecd}\\u{5728}\\u{5ba1}\\u{6838}";'
    ),
    /unapproved mini-program moderation copy/
  );
  assert.throws(
    () => assertOnlyApprovedMiniProgramModerationCopy(
      "apps/miniprogram/src/pages/session/album.vue",
      "<template><view>&#22270;&#29255;&#20173;&#22312;&#23457;&#26680;</view></template>"
    ),
    /unapproved mini-program moderation copy/
  );
  for (const wording of [
    "内容安全服务不可用，请稍后重试",
    "当前暂无法提交内容，请稍后再试"
  ]) {
    assert.throws(
      () => assertOnlyApprovedMiniProgramModerationCopy(
        "apps/miniprogram/src/pages/session/review.vue",
        `this.statusText = "${wording}";`
      ),
      /unapproved mini-program moderation copy/
    );
  }
  for (const wording of ["图片仍在审核", "照片未通过审核", "视频待审核"]) {
    assert.throws(
      () => assertOnlyApprovedMiniProgramModerationCopy(
        "apps/miniprogram/src/pages/session/album.vue",
        `throw albumMediaError("MEDIA_NOT_PUBLISHED", "${wording}");`
      ),
      /unapproved mini-program moderation copy/
    );
  }
  assert.doesNotThrow(() => assertOnlyApprovedMiniProgramModerationCopy(
    "apps/miniprogram/src/pages/session/album.vue",
    "// const developmentCopy = \"图片仍在审核\";\nconst 图片仍在审核 = true;"
  ));
});

test("D46 COS direct checker fails when a local album image or video branch loses its intake gate", () => {
  assert.doesNotThrow(() => assertDirectCosIntakeBranches(directCosAuthorization));
  for (const [kind, endMarker, intake] of [
    ["sessionAlbumPhoto", '  if (directUpload.kind === "adminSessionAlbumPhoto") {', "image"],
    ["adminSessionAlbumPhoto", '  if (directUpload.kind === "adminSessionAlbumVideo") {', "image"],
    [
      "adminSessionAlbumVideo",
      '  if (directUpload.kind === "avatar" || directUpload.kind === "sessionReviewPhoto") {',
      "video"
    ]
  ]) {
    const startMarker = `if (directUpload.kind === "${kind}") {`;
    const branch = sourceSection(directCosAuthorization, startMarker, endMarker);
    const missingGate = directCosAuthorization.replace(
      branch,
      branch.replace(`resolveContentSecurityIntake("${intake}")`, "resolveMissingIntake()")
    );
    assert.throws(() => assertDirectCosIntakeBranches(missingGate));
  }
});

test("D46 COS intent checker fails when an avatar, review, or video branch loses its local intake gate", () => {
  assert.doesNotThrow(() => assertDirectCosIntentIntakeBranches(directCosIntent));
  for (const [kind, endMarker, intake] of [
    ["adminSessionAlbumVideo", "\n  const sourceExtension = normalizeUploadExtension(extension);", "video"],
    ["avatar", '\n  if (kind === "sessionReviewPhoto") {', "image"],
    ["sessionReviewPhoto", '\n  if (kind === "sessionAlbumPhoto" || kind === "adminSessionAlbumPhoto") {', "image"]
  ]) {
    const branch = sourceSection(directCosIntent, `if (kind === "${kind}") {`, endMarker);
    const missingGate = directCosIntent.replace(
      branch,
      branch.replace(`resolveContentSecurityIntake("${intake}")`, "resolveMissingIntake()")
    );
    assert.throws(() => assertDirectCosIntentIntakeBranches(missingGate));
    const commentedGate = directCosIntent.replace(
      branch,
      branch.replace(
        `await resolveContentSecurityIntake("${intake}")`,
        `// await resolveContentSecurityIntake("${intake}")`
      )
    );
    assert.throws(() => assertDirectCosIntentIntakeBranches(commentedGate));
    const stringGate = directCosIntent.replace(
      branch,
      branch.replace(
        `await resolveContentSecurityIntake("${intake}")`,
        `const fakeGate = 'await resolveContentSecurityIntake("${intake}")'`
      )
    );
    assert.throws(() => assertDirectCosIntentIntakeBranches(stringGate));
  }
});
