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
  server.includes("publicSessionReviewId") && server.includes("getPublicSessionReview"),
  "server must expose a public single-review route"
);
assert(
  server.includes("publicSessionReviewPhotoMatch") && server.includes("getSessionReviewAlbumPhoto"),
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
assert(reviewPage.includes('class="rating-star"'), "review editor must render visible native star controls");
assert(!reviewPage.includes('name="star-filled"'), "review editor must not depend on the unavailable star-filled icon glyph");
assert(reviewPage.includes("url: apiUrl(url)"), "legacy review photos must resolve against the API origin");
assert(reviewPage.includes("return apiUrl(path)"), "album review photos must resolve against the API origin");
const reviewThumbnailLoadIndex = reviewPage.indexOf("photo?.thumbnail_load_url");
const reviewThumbnailDisplayIndex = reviewPage.indexOf("photo?.thumbnail_display_url");
assert(
  reviewThumbnailLoadIndex >= 0 && reviewThumbnailLoadIndex < reviewThumbnailDisplayIndex,
  "review album images must prefer the header-free load URL over the authenticated display URL"
);

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
assert(sharePage.includes('class="rating-star"'), "review share page must render visible native stars");
assert(!sharePage.includes('name="star-filled"'), "review share page must not depend on the unavailable star-filled icon glyph");
assert(sharePage.includes(':src="reviewPhotoUrl(photo)"'), "shared review photos must use the review photo URL resolver");
assert(sharePage.includes("return apiUrl(photo)"), "shared review photos must resolve against the API origin");

const detailPage = read("apps/miniprogram/src/pages/session/detail.vue");
assert(detailPage.includes(':src="apiUrl(photo)"'), "session detail review photos must resolve against the API origin");

console.log("D49 session review experience check passed");
