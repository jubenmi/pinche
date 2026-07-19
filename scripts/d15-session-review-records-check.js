import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const migration = read("apps/api/migrations/0010_session_review_records.sql");
assert(migration.includes("review_eligible_at"), "migration must add signup review eligibility");
assert(migration.includes("CREATE TABLE IF NOT EXISTS session_reviews"), "migration must create session_reviews");
assert(migration.includes("CREATE TABLE IF NOT EXISTS session_review_photos"), "migration must create session_review_photos");
assert(migration.includes("uniq_session_reviews_user"), "reviews must be unique per session and user");

const service = read("apps/api/src/modules/core/service.js");
assert(service.includes("export async function listSessionReviews"), "service must list public reviews");
assert(service.includes("export async function getMySessionReview"), "service must load current user's review");
assert(service.includes("export async function upsertMySessionReview"), "service must upsert current user's review");
assert(service.includes("review_eligible_at"), "service must persist and read review eligibility");
assert(service.includes("can_review"), "service must return can_review for Mine participation rows");
assert(service.includes("has_review"), "service must return has_review for Mine participation rows");
assert(service.includes("assertSessionReviewPhotoUrls"), "service must validate review photo paths");
assert(service.includes("MAX_SESSION_REVIEW_PHOTOS"), "service must enforce review photo count");
assert(service.includes("MAX_SESSION_REVIEW_CONTENT_LENGTH = 900"), "service must allow 900-character reviews");
assert(service.includes("normalizeSessionReviewAlbumPhotoIds"), "service must validate session album photo ids");
assert(service.includes("album_photo_ids"), "service must return referenced session album photo ids");

const server = read("apps/api/src/server.js");
assert(server.includes("sessionReviewUploadDir"), "server must define review upload directory");
assert(server.includes("saveUploadedSessionReviewPhoto"), "server must save review photos");
assert(server.includes("/uploads/session-reviews/"), "server must serve review photo uploads");
assert(server.includes("/api/session-reviews/photos"), "server must route review photo upload");
assert(
  server.includes("sessionReviewsId") && server.includes("listSessionReviews"),
  "server must route public session reviews"
);
assert(
  server.includes("mySessionReviewId") &&
    server.includes("getMySessionReview") &&
    server.includes("upsertMySessionReview"),
  "server must route current user review endpoints"
);

const api = read("apps/miniprogram/src/utils/api.js");
assert(api.includes("export async function uploadSessionReviewPhoto"), "miniprogram API must upload review photos");
assert(api.includes("uploadCosBackedFile"), "review photo upload must use the shared COS-backed upload path");
assert(api.includes('kind: "sessionReviewPhoto"'), "review photo upload must request a session review direct upload intent");
assert(api.includes("fallbackUploadSessionReviewPhoto"), "review photo upload must keep a backend fallback for local storage");
assert(api.includes('name: "photo"'), "review photo fallback upload must use photo field name");

const pagesJson = read("apps/miniprogram/src/pages.json");
assert(pagesJson.includes("pages/session/review"), "pages.json must register review page");

const mine = read("apps/miniprogram/src/pages/mine/index.vue");
const calendar = read("apps/miniprogram/src/components/SessionCalendar.vue");
assert(mine.includes("SessionCalendar"), "Mine page must render the shared calendar component");
assert(mine.includes("loadMySignups"), "Mine page must load joined sessions");
assert(calendar.includes('label: "发起"'), "Mine calendar must label created sessions");
assert(
  calendar.includes("joinedSignups") && calendar.includes("item.isJoined"),
  "Mine calendar must keep joined sessions in the combined calendar"
);
assert(calendar.includes("compactSignupRoleText"), "Mine calendar must identify joined sessions by compact role text");
assert(
  calendar.includes("handleCalendarAction") &&
    calendar.includes("goShare") &&
    calendar.includes("goAlbum") &&
    calendar.includes("/pages/session/share?id=") &&
    calendar.includes("/pages/session/album?id="),
  "Mine calendar must navigate unstarted cards to share page and started cards to album"
);
assert(calendar.includes("mergeCalendarItems"), "Mine calendar must merge created and joined calendar rows");
assert(
  calendar.includes("const itemsBySession = new Map()") &&
    calendar.includes("itemsBySession.set(sessionKey, createCalendarItem({ session: normalizedSession }))") &&
    calendar.includes("existing.signup = signup") &&
    calendar.includes("itemsBySession.set(sessionId, createCalendarItem({ signup }))") &&
    calendar.includes("item.key = item.isAuthorPrivate") &&
    calendar.includes(": `calendar-${item.sessionId}`"),
  "Mine calendar must dedupe created and joined rows by session id"
);
assert(
  calendar.includes("identityTags") &&
    calendar.includes("v-for=\"tag in item.identityTags\"") &&
    calendar.includes(":key=\"tag.key\"") &&
    !calendar.includes('key: "joined", label: "参与"'),
  "Mine calendar must render organizer identity as a row tag without duplicating joined identity"
);
assert(
  !calendar.includes("const organizedItems = sessions.value.map") &&
    !calendar.includes("const joinedItems = signups.value.map") &&
    !calendar.includes("return [...organizedItems, ...joinedItems]"),
  "Mine calendar must not concatenate created and joined rows into duplicate calendar entries"
);

const detail = read("apps/miniprogram/src/pages/session/detail.vue");
assert(detail.includes("车友记录"), "detail page must show review records");
assert(detail.includes("loadSessionReviews"), "detail page must load public reviews");
assert(detail.includes("goReview"), "detail page must navigate to review page");

const reviewPage = read("apps/miniprogram/src/pages/session/review.vue");
assert(reviewPage.includes("uploadSessionReviewPhoto"), "review page must upload selected photos");
assert(reviewPage.includes("PUT"), "review page must save review with PUT");
assert(reviewPage.includes("rating"), "review page must collect rating");
assert(reviewPage.includes("photoUrls"), "review page must save photo urls");

console.log("D15 session review records check passed");
