import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  const target = path.join(root, file);
  if (!fs.existsSync(target)) {
    throw new Error(`D49 missing required file: ${file}`);
  }
  return fs.readFileSync(target, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const migration = read("apps/api/migrations/0032_session_review_album_photos.sql");
assert(migration.includes("album_photo_id"), "D49 migration must add album_photo_id");
assert(migration.includes("session_album_photos"), "D49 migration must reference session album photos");
assert(migration.includes("ON DELETE CASCADE"), "album photo deletion must remove review references");
assert(/photo_url\s+VARCHAR\(512\)\s+NULL/i.test(migration), "legacy photo_url must become nullable");
assert(/image_asset_id\s+BIGINT UNSIGNED\s+NULL/i.test(migration), "legacy image_asset_id must become nullable");

const service = read("apps/api/src/modules/core/service.js");
assert(service.includes("MAX_SESSION_REVIEW_CONTENT_LENGTH = 900"), "review service must use the 900-character limit");
assert(service.includes("normalizeSessionReviewAlbumPhotoIds"), "service must normalize album photo ids");
assert(service.includes("albumPhotoIds"), "review writes must accept albumPhotoIds");
assert(service.includes("album_photo_id"), "review persistence must store album_photo_id");
assert(service.includes("album_photo_ids"), "my-review reads must return album_photo_ids");
assert(service.includes("getPublicSessionReview"), "service must expose one public review");
assert(service.includes("getSessionReviewAlbumPhoto"), "service must authorize review album-photo reads");

const textBoundaries = read("apps/api/src/modules/content-moderation/text-boundaries.js");
assert(textBoundaries.includes("900"), "moderated review text must use the 900-character limit");
assert(textBoundaries.includes("albumPhotoIds"), "moderation boundary must preserve albumPhotoIds");

const server = read("apps/api/src/server.js");
assert(
  server.includes('"/api/session-reviews/:reviewId"'),
  "server must expose a public single-review route"
);
assert(
  server.includes('"/api/session-reviews/:reviewId/photos/:albumPhotoId/image"'),
  "server must expose controlled review album-photo reads"
);

const reviewPage = read("apps/miniprogram/src/pages/session/review.vue");
assert(reviewPage.includes("maxlength=\"900\""), "review editor must cap text at 900 characters");
assert(reviewPage.includes("从本场相册选择"), "review editor must offer session album selection");
assert(reviewPage.includes("从手机上传"), "review editor must offer phone upload");
assert(reviewPage.includes("已选"), "review editor must show selected photo count");
assert(reviewPage.includes("发布并分享"), "review editor must use the confirmed primary action");
assert(reviewPage.includes("uploadAlbumPhoto"), "phone upload must reuse the session album pipeline");
assert(!reviewPage.includes("uploadSessionReviewPhotos"), "review editor must not use the legacy review-photo uploader");

const reviewPhotoState = read("apps/miniprogram/src/utils/sessionReviewPhotos.js");
assert(reviewPhotoState.includes("MAX_SESSION_REVIEW_PHOTOS = 9"), "photo state must cap selection at nine");
assert(reviewPhotoState.includes("albumPhotoIds"), "photo state must build albumPhotoIds requests");

const pagesJson = read("apps/miniprogram/src/pages.json");
assert(pagesJson.includes("pages/session/review-share"), "pages.json must register the review share page");

const sharePage = read("apps/miniprogram/src/pages/session/review-share.vue");
assert(sharePage.includes('open-type="share"'), "review share page must expose native friend/group sharing");
assert(sharePage.includes("onShareAppMessage"), "review share page must register friend/group sharing");
assert(sharePage.includes("onShareTimeline"), "review share page must register timeline sharing");
assert(sharePage.includes("/pages/session/review-share?id="), "both share channels must target one review id");

console.log("D49 session review experience check passed");

