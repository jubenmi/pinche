const TOKEN_KEY = "pinche_admin_web_token";
const USER_KEY = "pinche_admin_web_user";
const ROLES_KEY = "pinche_admin_web_roles";
import { shouldAttachAdminAuthorization } from "./albumMedia";
import { buildModerationListFilters } from "./contentModeration";
import { createContentSecuritySettingsClient } from "./contentSecurity";
let cosClient = null;
let cosSdkConstructor = null;
const albumUploadsByKey = new Map();
const albumAuthorizationErrorsByKey = new Map();

function readJsonStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (error) {
    return fallback;
  }
}

export function getStoredAuth() {
  return {
    token: localStorage.getItem(TOKEN_KEY) || "",
    user: readJsonStorage(USER_KEY, null),
    roles: readJsonStorage(ROLES_KEY, [])
  };
}

export function setStoredAuth(auth) {
  localStorage.setItem(TOKEN_KEY, auth.token || "");
  localStorage.setItem(USER_KEY, JSON.stringify(auth.user || null));
  localStorage.setItem(ROLES_KEY, JSON.stringify(auth.roles || []));
}

export function clearStoredAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ROLES_KEY);
}

async function parseResponse(response) {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error?.message || `Request failed: ${response.status}`);
    error.status = response.status;
    error.statusCode = response.status;
    error.code = payload?.error?.code || "REQUEST_FAILED";
    error.details = payload?.error?.details;
    throw error;
  }
  return payload?.data;
}

export async function apiRequest(path, options = {}) {
  const auth = getStoredAuth();
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  return parseResponse(response);
}

const contentSecuritySettingsClient = createContentSecuritySettingsClient(apiRequest);

export function assetUrl(path) {
  if (!path) {
    return "";
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (path.startsWith("/uploads/")) {
    return path;
  }
  return path;
}

export async function fetchAuthorizedMediaObjectUrl(path) {
  const auth = getStoredAuth();
  const headers = shouldAttachAdminAuthorization(path)
    ? (auth.token ? { authorization: `Bearer ${auth.token}` } : {})
    : {};
  let response;
  try {
    response = await fetch(path, { headers });
  } catch (cause) {
    const error = new Error(cause?.message || "Media request failed");
    const hostname = (() => {
      try { return new URL(path, window.location.origin).hostname; } catch { return ""; }
    })();
    error.status = 0;
    error.statusCode = 0;
    error.code = cause instanceof TypeError && hostname.endsWith(".myqcloud.com")
      ? "COS_DOMAIN_NOT_ALLOWED"
      : "MEDIA_NETWORK_ERROR";
    error.cause = cause;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`Media request failed: ${response.status}`);
    error.status = response.status;
    error.statusCode = response.status;
    error.code = [401, 403].includes(response.status)
      ? "MEDIA_URL_EXPIRED"
      : "MEDIA_REQUEST_FAILED";
    error.requestId = response.headers.get("x-cos-request-id") ||
      response.headers.get("x-request-id") || "";
    error.details = error.requestId ? { requestId: error.requestId } : undefined;
    throw error;
  }
  return URL.createObjectURL(await response.blob());
}

async function apiFormDataRequest(path, formData, options = {}) {
  const auth = getStoredAuth();
  const response = await fetch(path, {
    method: options.method || "POST",
    headers: {
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {})
    },
    body: formData
  });
  return parseResponse(response);
}

function fileExtensionFromName(name) {
  const match = String(name || "").match(/\.([A-Za-z0-9]+)$/);
  const extension = match ? match[1].toLowerCase() : "";
  if (extension === "jpg" || extension === "jpeg" || extension === "png" || extension === "mp4") {
    return `.${extension}`;
  }
  return ".jpg";
}

async function requestCosUploadIntent(kind, file, data = {}) {
  return apiRequest("/api/uploads/cos-intent", {
    method: "POST",
    body: {
      kind,
      extension: fileExtensionFromName(file.name),
      ...data
    }
  });
}

async function authorizeCosUpload(options) {
  const albumUpload = albumUploadsByKey.get(String(options.Key || ""));
  return apiRequest("/api/uploads/cos-authorization", {
    method: "POST",
    body: {
      bucket: options.Bucket,
      region: options.Region,
      method: options.Method,
      key: options.Key,
      ...(albumUpload ? { uploadId: albumUpload.uploadId } : {}),
      query: albumUpload ? {} : (options.Query || {}),
      headers: albumUpload
        ? {
            host: `${albumUpload.bucket}.cos.${albumUpload.region}.myqcloud.com`,
            "content-length": String(albumUpload.contentLength),
            "content-type": albumUpload.contentType,
            "pic-operations": albumUpload.picOperations,
            "x-cos-forbid-overwrite": "true"
          }
        : (options.Headers || {})
    }
  });
}

async function loadCosSdk() {
  if (cosSdkConstructor) {
    return cosSdkConstructor;
  }
  const module = await import("cos-js-sdk-v5");
  cosSdkConstructor = module.default || module;
  return cosSdkConstructor;
}

async function getCosClient() {
  if (cosClient) {
    return cosClient;
  }
  const COS = await loadCosSdk();
  cosClient = new COS({
    getAuthorization(options, callback) {
      authorizeCosUpload(options)
        .then((data) => {
          callback(data?.authorization || "");
        })
        .catch((error) => {
          albumAuthorizationErrorsByKey.set(String(options.Key || ""), error);
          callback("");
        });
    }
  });
  return cosClient;
}

async function uploadCosObject(upload, file) {
  const client = await getCosClient();
  return new Promise((resolve, reject) => {
    client.putObject(
      {
        Bucket: upload.bucket,
        Region: upload.region,
        Key: upload.key,
        Body: file,
        ContentType: upload.contentType || file.type || "image/jpeg",
        PicOperations: upload.picOperations,
        onProgress() {}
      },
      (error) => {
        if (error) {
          reject({
            statusCode: 0,
            errMsg: error.error?.Message || error.message || error.errMsg || "COS upload failed",
            originalError: error
          });
          return;
        }
        resolve(upload.uploadPath);
      }
    );
  });
}

function normalizeAlbumCosError(error) {
  const original = error?.originalError || error || {};
  const code = original?.error?.Code || original?.Code || error?.code;
  const message = original?.error?.Message || original?.Message || error?.message ||
    error?.errMsg || "COS upload failed";
  const normalized = new Error(String(message));
  normalized.status = Number(error?.status || error?.statusCode || original?.statusCode || 0);
  normalized.statusCode = normalized.status;
  normalized.code = code || (
    /cors|cross-origin|access-control|blocked by client/i.test(String(message))
      ? "COS_DOMAIN_NOT_ALLOWED"
      : /timeout/i.test(String(message))
        ? "COS_REQUEST_TIMEOUT"
        : "COS_NETWORK_ERROR"
  );
  normalized.details = error?.details;
  normalized.originalError = original;
  return normalized;
}

export async function putAlbumPhotoToCos(upload, file) {
  const client = await getCosClient();
  const key = String(upload.key);
  albumUploadsByKey.set(key, upload);
  albumAuthorizationErrorsByKey.delete(key);
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      let task;
      const finish = (complete, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        complete(value);
      };
      const watchdog = setTimeout(() => {
        task?.abort?.();
        finish(reject, Object.assign(new Error("COS upload timed out"), {
          code: "COS_REQUEST_TIMEOUT", status: 0, statusCode: 0
        }));
      }, 300_000);
      try {
        task = client.putObject({
          Bucket: upload.bucket,
          Region: upload.region,
          Key: upload.key,
          Body: file,
          ContentLength: file.size,
          ContentType: upload.contentType || file.type,
          PicOperations: upload.picOperations,
          Headers: upload.headers || {},
          onProgress() {}
        }, (error) => {
          const authorizationError = albumAuthorizationErrorsByKey.get(key);
          if (authorizationError) finish(reject, authorizationError);
          else if (error) finish(reject, normalizeAlbumCosError(error));
          else finish(resolve, upload.uploadPath);
        });
      } catch (error) {
        finish(reject, normalizeAlbumCosError(error));
      }
    });
  } finally {
    albumUploadsByKey.delete(key);
    albumAuthorizationErrorsByKey.delete(key);
  }
}

export function clearAlbumPhotoAuthorization(key) {
  const cache = cosClient?._authorizationCache || cosClient?.authorizationCache;
  if (cache && typeof cache.delete === "function") cache.delete(String(key));
  albumAuthorizationErrorsByKey.delete(String(key));
}

export function requestAlbumPhotoUploadIntent(sessionId, file, options = {}) {
  return apiRequest("/api/uploads/cos-intent", {
    method: "POST",
    body: {
      kind: options.adminOwner ? "adminSessionAlbumPhoto" : "sessionAlbumPhoto",
      sessionId,
      extension: fileExtensionFromName(file.name),
      contentType: file.type,
      byteSize: file.size
    }
  }).then((data) => data.upload);
}

export function getAlbumPhotoUploadStatus(uploadId) {
  return apiRequest(`/api/uploads/${encodeURIComponent(uploadId)}/status`);
}

export function finalizeAlbumPhotoUpload(uploadId) {
  return apiRequest(`/api/uploads/${encodeURIComponent(uploadId)}/finalize`, {
    method: "POST",
    body: {}
  });
}

export function reportAlbumMediaEvent(event, fields = {}) {
  apiRequest("/api/telemetry/album-media", {
    method: "POST",
    body: { event, ...fields }
  }).catch(() => {});
}

async function uploadCosBackedFile({ kind, file, fallbackUpload, intentData = {} }) {
  const data = await requestCosUploadIntent(kind, file, intentData);
  const upload = data?.upload || {};
  if (!upload.direct) {
    return fallbackUpload(file);
  }
  try {
    if (file.size > Number(upload.maxBytes || 0)) {
      throw new Error("Photo exceeds COS upload size limit.");
    }
    return await uploadCosObject(upload, file);
  } catch (error) {
    return fallbackUpload(file);
  }
}

export function createLoginTicket() {
  return apiRequest("/api/admin/web-login/tickets", {
    method: "POST",
    body: { userAgent: navigator.userAgent }
  });
}

export function pollLoginTicket(ticket) {
  return apiRequest(
    `/api/admin/web-login/tickets/${ticket.ticketId}?secret=${encodeURIComponent(
      ticket.ticketSecret
    )}`
  );
}

export function listContentModerationJobs(filters = {}) {
  const query = new URLSearchParams(buildModerationListFilters(filters)).toString();
  return apiRequest(`/api/admin/content-moderation?${query}`);
}

export function getContentModerationJob(jobId) {
  return apiRequest(`/api/admin/content-moderation/${encodeURIComponent(jobId)}`);
}

export function approveContentModerationJob(jobId) {
  return apiRequest(`/api/admin/content-moderation/${encodeURIComponent(jobId)}/approve`, {
    method: "POST",
    body: {}
  });
}

export function rejectContentModerationJob(jobId, reason) {
  return apiRequest(`/api/admin/content-moderation/${encodeURIComponent(jobId)}/reject`, {
    method: "POST",
    body: { reason }
  });
}

export function retryContentModerationJob(jobId) {
  return apiRequest(`/api/admin/content-moderation/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    body: {}
  });
}

export function getContentSecuritySettings() {
  return contentSecuritySettingsClient.get();
}

export function updateContentSecuritySettings(settings) {
  return contentSecuritySettingsClient.update(settings);
}

export function listStores(filters) {
  return apiRequest(`/api/admin/stores?${new URLSearchParams(filters)}`);
}

export function saveStore(store) {
  const method = store.id ? "PATCH" : "POST";
  const path = store.id ? `/api/admin/stores/${store.id}` : "/api/admin/stores";
  return apiRequest(path, { method, body: store });
}

export function geocodeStoreLocation(body) {
  return apiRequest("/api/admin/location/geocode", {
    method: "POST",
    body
  });
}

export function deleteStore(storeId) {
  return apiRequest(`/api/admin/stores/${storeId}`, { method: "DELETE" });
}

export function listStoreScripts(storeId) {
  return apiRequest(`/api/admin/stores/${storeId}/scripts`);
}

export function saveStoreScripts(storeId, scriptLinks) {
  const normalizedLinks = scriptLinks || [];
  const hasLinkObjects = normalizedLinks.some((link) => link && typeof link === "object");
  return apiRequest(`/api/admin/stores/${storeId}/scripts`, {
    method: "PUT",
    body: hasLinkObjects ? { scriptLinks: normalizedLinks } : { scriptIds: normalizedLinks }
  });
}

export function listScripts(filters) {
  return apiRequest(`/api/admin/scripts?${new URLSearchParams(filters)}`);
}

export function listCatalogReviewItems(filters) {
  return apiRequest(`/api/admin/catalog-review-items?${new URLSearchParams(filters)}`);
}

export function updateCatalogReviewItem(type, id, body) {
  return apiRequest(`/api/admin/catalog-review-items/${type}/${id}`, {
    method: "PATCH",
    body
  });
}

export function approveCatalogReviewItem(type, id, body) {
  return apiRequest(`/api/admin/catalog-review-items/${type}/${id}/approve`, {
    method: "POST",
    body
  });
}

export function requestCatalogReviewItemNeedsChanges(type, id, body) {
  return apiRequest(`/api/admin/catalog-review-items/${type}/${id}/needs-changes`, {
    method: "POST",
    body
  });
}

export function rejectCatalogReviewItem(type, id, body) {
  return apiRequest(`/api/admin/catalog-review-items/${type}/${id}/reject`, {
    method: "POST",
    body
  });
}

export function mergeCatalogReviewItem(type, id, body) {
  return apiRequest(`/api/admin/catalog-review-items/${type}/${id}/merge`, {
    method: "POST",
    body
  });
}

export function saveScript(script) {
  const method = script.id ? "PATCH" : "POST";
  const path = script.id ? `/api/admin/scripts/${script.id}` : "/api/admin/scripts";
  return apiRequest(path, { method, body: script });
}

export function deleteScript(scriptId) {
  return apiRequest(`/api/admin/scripts/${scriptId}`, { method: "DELETE" });
}

export function listAdminSessions(filters) {
  return apiRequest(`/api/admin/sessions?${new URLSearchParams(filters)}`);
}

export function deleteAdminSession(sessionId) {
  return apiRequest(`/api/admin/sessions/${sessionId}`, {
    method: "DELETE"
  });
}

export function listMySessions(filters) {
  return apiRequest(`/api/users/me/sessions?${new URLSearchParams(filters)}`);
}

function sessionAlbumBasePath(sessionId, options = {}) {
  return options.adminOwner
    ? `/api/admin/sessions/${sessionId}/album`
    : `/api/sessions/${sessionId}/album`;
}

export function getSessionAlbum(sessionId, options = {}) {
  return apiRequest(sessionAlbumBasePath(sessionId, options));
}

export function listSessionAlbumPeople(sessionId, options = {}) {
  return apiRequest(`${sessionAlbumBasePath(sessionId, options)}/people`);
}

export function listSessionNpcRoles(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/npc-roles`);
}

export function createSessionNpcRole(sessionId, body) {
  return apiRequest(`/api/sessions/${sessionId}/npc-roles`, {
    method: "POST",
    body
  });
}

export function updateSessionNpcRole(npcRoleId, body) {
  return apiRequest(`/api/session-npc-roles/${npcRoleId}`, {
    method: "PATCH",
    body
  });
}

export async function uploadSessionAlbumPhotoLocal(sessionId, file, options = {}) {
  const formData = new FormData();
  formData.append("photo", file);
  const data = await apiFormDataRequest(
    `${sessionAlbumBasePath(sessionId, options)}/uploads`,
    formData
  );
  return data.photoUrl;
}

async function fallbackUploadSessionAlbumVideo(sessionId, file) {
  const formData = new FormData();
  formData.append("video", file);
  const data = await apiFormDataRequest(
    `/api/admin/sessions/${sessionId}/album/videos/uploads`,
    formData
  );
  return data.sourceUrl;
}

async function fallbackUploadSessionReviewPhoto(file) {
  const formData = new FormData();
  formData.append("photo", file);
  const data = await apiFormDataRequest("/api/session-reviews/photos", formData);
  return data.photoUrl;
}

export async function uploadSessionAlbumPhoto(sessionId, file, options = {}) {
  const kind = options.adminOwner ? "adminSessionAlbumPhoto" : "sessionAlbumPhoto";
  const photoUrl = await uploadCosBackedFile({
    kind,
    file,
    intentData: { sessionId },
    fallbackUpload: (nextFile) => uploadSessionAlbumPhotoLocal(sessionId, nextFile, options)
  });
  return { photoUrl };
}

export async function uploadSessionAlbumVideo(sessionId, file) {
  const sourceUrl = await uploadCosBackedFile({
    kind: "adminSessionAlbumVideo",
    file,
    intentData: { sessionId },
    fallbackUpload: (nextFile) => fallbackUploadSessionAlbumVideo(sessionId, nextFile)
  });
  return { sourceUrl };
}

export function createSessionAlbumPhoto(sessionId, photoUrl, options = {}) {
  return apiRequest(`${sessionAlbumBasePath(sessionId, options)}/photos`, {
    method: "POST",
    body: { photoUrl }
  });
}

export function createSessionAlbumVideo(sessionId, payload) {
  return apiRequest(`/api/admin/sessions/${sessionId}/album/videos`, {
    method: "POST",
    body: payload
  });
}

export function getSessionAlbumVideoUrl(mediaId) {
  return apiRequest(`/api/session-album/media/${mediaId}/video-url`);
}

export function updateSessionAlbumPhotoTags(photoId, tagKeys) {
  return apiRequest(`/api/session-album/photos/${photoId}/tags`, {
    method: "PUT",
    body: { tagKeys }
  });
}

export function deleteSessionAlbumPhoto(photoId) {
  return apiRequest(`/api/session-album/photos/${photoId}`, {
    method: "DELETE"
  });
}

export function getMySessionAlbumPrivacy(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/album/privacy`);
}

export function updateMySessionAlbumPrivacy(sessionId, privacy) {
  return apiRequest(`/api/sessions/${sessionId}/album/privacy`, {
    method: "PUT",
    body: privacy
  });
}

export function listActiveStores(filters) {
  return apiRequest(`/api/stores?${new URLSearchParams(filters)}`);
}

export function listActiveScripts(filters) {
  return apiRequest(`/api/scripts?${new URLSearchParams(filters)}`);
}

export function createUserSession(body) {
  return apiRequest("/api/sessions", {
    method: "POST",
    body
  });
}

export function createSessionSeat(sessionId, body) {
  return apiRequest(`/api/sessions/${sessionId}/seats`, {
    method: "POST",
    body
  });
}

export function publishSession(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/publish`, {
    method: "POST"
  });
}

export function getSession(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}`);
}

export function updateSession(sessionId, body) {
  return apiRequest(`/api/sessions/${sessionId}`, {
    method: "PATCH",
    body
  });
}

export function getSessionShareStats(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/share-stats`);
}

export function trackShareView(body) {
  return apiRequest("/api/share-events/view", {
    method: "POST",
    body
  });
}

export function getSessionChat(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/chat`);
}

export function sendSessionMessage(sessionId, content) {
  return apiRequest(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    body: { content }
  });
}

export function pinSessionChatMessage(sessionId, pinnedMessageText) {
  return apiRequest(`/api/sessions/${sessionId}/chat/pin`, {
    method: "PATCH",
    body: { pinnedMessageText }
  });
}

export function claimSessionSeat(seatId, body = {}) {
  return apiRequest(`/api/session-seats/${seatId}/claim`, {
    method: "POST",
    body
  });
}

export function lockSessionSeat(seatId) {
  return apiRequest(`/api/session-seats/${seatId}/lock`, {
    method: "POST"
  });
}

export function kickSessionSeat(seatId, body = {}) {
  return apiRequest(`/api/session-seats/${seatId}/kick`, {
    method: "PATCH",
    body
  });
}

export function createSignup(body) {
  return apiRequest("/api/signups", {
    method: "POST",
    body
  });
}

export function listMySignups() {
  return apiRequest("/api/users/me/signups");
}

export function hideMySignup(signupId) {
  return apiRequest(`/api/signups/${signupId}/hide`, {
    method: "PATCH"
  });
}

export function relinkSessionMembership(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/relink`, {
    method: "PATCH"
  });
}

export function listSessionSignups(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/signups`);
}

export function approveSignup(signupId) {
  return apiRequest(`/api/signups/${signupId}/approve`, {
    method: "PATCH"
  });
}

export function rejectSignup(signupId) {
  return apiRequest(`/api/signups/${signupId}/reject`, {
    method: "PATCH"
  });
}

export function updateSignupDeposit(signupId, depositStatus) {
  return apiRequest(`/api/signups/${signupId}/deposit`, {
    method: "PATCH",
    body: { depositStatus }
  });
}

export function cancelSession(sessionId, reason) {
  return apiRequest(`/api/sessions/${sessionId}/cancel`, {
    method: "PATCH",
    body: { reason }
  });
}

export function transferSessionOrganizer(sessionId, targetUserId) {
  return apiRequest(`/api/sessions/${sessionId}/organizer/transfer`, {
    method: "PATCH",
    body: { targetUserId }
  });
}

export function leaveSessionOrganizer(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/organizer/leave`, {
    method: "PATCH"
  });
}

export function listSessionReviews(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/reviews`);
}

export function getMySessionReview(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/review`);
}

export function saveMySessionReview(sessionId, body) {
  return apiRequest(`/api/sessions/${sessionId}/review`, {
    method: "PUT",
    body
  });
}

export async function uploadSessionReviewPhoto(file) {
  return uploadCosBackedFile({
    kind: "sessionReviewPhoto",
    file,
    fallbackUpload: (nextFile) => fallbackUploadSessionReviewPhoto(nextFile)
  });
}
