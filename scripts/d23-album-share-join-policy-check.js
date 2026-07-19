import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function functionBody(source, name) {
  const pattern = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const match = source.match(pattern);
  if (!match || match.index === undefined) {
    return "";
  }
  const start = match.index + match[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
    }
    if (depth === 0) {
      return source.slice(start, index);
    }
  }
  return "";
}

const migration = read("apps/api/migrations/0016_session_join_policy.sql");
for (const token of [
  "information_schema.columns",
  "table_name = 'sessions'",
  "column_name = 'join_policy'",
  "ALTER TABLE sessions ADD COLUMN join_policy VARCHAR(32) NOT NULL DEFAULT ''review_required'' AFTER visibility"
]) {
  assert(migration.includes(token), `D23 migration must safely add join_policy: ${token}`);
}

const service = read("apps/api/src/modules/core/service.js");
for (const token of [
  "function normalizeJoinPolicy",
  "joinPolicy",
  "join_policy",
  "review_required",
  "direct"
]) {
  assert(service.includes(token), `service.js must include D23 join policy token: ${token}`);
}

const normalizeJoinPolicyBody = functionBody(service, "normalizeJoinPolicy");
assert(
  normalizeJoinPolicyBody.includes("review_required") &&
    normalizeJoinPolicyBody.includes("direct") &&
    normalizeJoinPolicyBody.includes("badRequest"),
  "normalizeJoinPolicy must allow direct/review_required and reject invalid values"
);

const createSessionEntryBody = functionBody(service, "createSession");
const createSessionBody = functionBody(service, "createSessionWithConnection");
assert(
  createSessionEntryBody.includes("createSessionWithConnection") &&
    createSessionBody.includes("join_policy") &&
    createSessionBody.includes("normalizeJoinPolicy(body.joinPolicy"),
  "createSession must delegate normalized joinPolicy persistence to its connection-bound helper"
);

const updateSessionEntryBody = functionBody(service, "updateSession");
const updateSessionBody = functionBody(service, "updateSessionWithConnection");
assert(
  updateSessionEntryBody.includes("updateSessionWithConnection") &&
    updateSessionBody.includes("joinPolicy") &&
    updateSessionBody.includes("join_policy"),
  "updateSession must delegate joinPolicy updates to its connection-bound helper"
);

const getSessionBody = functionBody(service, "getSession");
const memberSessionDetailBody = functionBody(service, "memberSessionDetail");
const publicSessionPreviewBody = functionBody(service, "publicSessionPreview");
assert(
  (getSessionBody.includes("join_policy") && getSessionBody.includes("review_required")) ||
    (memberSessionDetailBody.includes("join_policy") &&
      memberSessionDetailBody.includes("review_required") &&
      publicSessionPreviewBody.includes("join_policy") &&
      publicSessionPreviewBody.includes("review_required")),
  "session detail serializers must expose join_policy with review_required fallback"
);

const forbidPlayerDirectClaimBody = functionBody(service, "forbidPlayerDirectClaim");
assert(
  forbidPlayerDirectClaimBody.includes("join_policy") &&
    forbidPlayerDirectClaimBody.includes('"direct"') &&
    forbidPlayerDirectClaimBody.includes("Seat claim requires organizer review"),
  "ordinary player direct claim must be allowed only for direct join_policy sessions"
);

const claimSessionSeatBody = functionBody(service, "claimSessionSeat");
assert(
  claimSessionSeatBody.includes("session.join_policy") ||
    claimSessionSeatBody.includes("session_join_policy") ||
    claimSessionSeatBody.includes("join_policy"),
  "claimSessionSeat must read session join_policy"
);
assert(
  claimSessionSeatBody.includes('join_result: "joined"'),
  "claimSessionSeat must return joined result for direct album-entry flow"
);
assert(
  claimSessionSeatBody.includes("review_eligible_at") &&
    claimSessionSeatBody.includes("status = 'approved'") &&
    claimSessionSeatBody.includes("confirmed_user_id = ?"),
  "direct claim must reuse approved signup and confirmed seat writes"
);

const tasks = read("specs/d23-album-share-join-policy/tasks.md");
assert(
  tasks.includes("- [x] D23.1") && tasks.includes("D23.2 新增车局上车策略数据模型"),
  "D23 tasks file must track D23.1 and D23.2"
);

for (const token of [
  "getSessionAlbumShareSubject",
  "listPublicSessionAlbumShare",
  "getPublicSessionAlbumPhotoForMedia",
  "isAlbumPhotoVisibleInPublicShare"
]) {
  assert(service.includes(token), `service.js must include public album share service: ${token}`);
}

const shareSubjectBody = functionBody(service, "getSessionAlbumShareSubject");
assert(
  shareSubjectBody.includes("requireSessionAlbumMember") &&
    shareSubjectBody.includes("confirmed_user_id") &&
    shareSubjectBody.includes("share_subject"),
  "share-token subject lookup must require album membership and a confirmed seat"
);

const publicShareBody = functionBody(service, "listPublicSessionAlbumShare");
assert(
  publicShareBody.includes("isAlbumPhotoVisibleInPublicShare") &&
    publicShareBody.includes("share_subject") &&
    publicShareBody.includes("photos"),
  "public album share list must filter photos by public share visibility"
);

const publicMediaBody = functionBody(service, "getPublicSessionAlbumPhotoForMedia");
assert(
  publicMediaBody.includes("isAlbumPhotoVisibleInPublicShare") &&
    publicMediaBody.includes("photoId") &&
    publicMediaBody.includes("sessionId"),
  "public album media lookup must re-check the photo belongs to the public share set"
);
for (const token of [
  "createOrReuseSessionAlbumPublicShare",
  "loadSessionAlbumPublicShare",
  "isPublicShareSnapshotMediaId",
  "revokeMySessionAlbumPublicShares"
]) {
  assert(service.includes(token), `D48 must explicitly replace the D23 dynamic share boundary: ${token}`);
}

const server = read("apps/api/src/server.js");
for (const token of [
  "signSessionAlbumShareToken",
  "verifySessionAlbumShareToken",
  "sessionAlbumPublicMediaPath",
  "verifySessionAlbumPublicMediaQuery",
  "/api/session-album/public-share/photos/"
]) {
  assert(server.includes(token), `server.js must include public album share route/token support: ${token}`);
}
assert(
  server.includes("^\\/api\\/sessions\\/(\\d+)\\/album\\/share-token$") &&
    server.includes("request.method === \"POST\" && sessionAlbumShareTokenId"),
  "server.js must expose POST /api/sessions/:id/album/share-token"
);
assert(
  server.includes("^\\/api\\/sessions\\/(\\d+)\\/album\\/public-share$") &&
    server.includes("request.method === \"GET\" && publicSessionAlbumShareId"),
  "server.js must expose GET /api/sessions/:id/album/public-share"
);
for (const token of [
  "version: 2",
  "shareId",
  "payload.version === undefined",
  "/api/session-album/public-shares/",
  "revokeMySessionAlbumPublicShares"
]) {
  assert(server.includes(token), `D23 compatibility must retain old tokens while adding D48: ${token}`);
}

console.log("D23 album share join policy checks passed");
