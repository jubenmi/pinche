import COS from "cos-wx-sdk-v5/index.js";
import { showActionSheet, showModal, showToast } from "./tdesignFeedback.js";

const TOKEN_KEY = "pinche_token";
const USER_KEY = "pinche_user";
const ROLES_KEY = "pinche_roles";
const AUTH_BASE_URL_KEY = "pinche_auth_base_url";
export const AUTH_CHANGE_EVENT = "pinche-auth-change";
export const AUTH_PROFILE_REQUEST_EVENT = "pinche-auth-profile-request";
export const AUTH_PROFILE_ACK_EVENT = "pinche-auth-profile-ack";
export const AUTH_PROFILE_RESPONSE_EVENT = "pinche-auth-profile-response";
export const AUTH_PHONE_REQUEST_EVENT = "pinche-auth-phone-request";
export const AUTH_PHONE_ACK_EVENT = "pinche-auth-phone-ack";
export const AUTH_PHONE_RESPONSE_EVENT = "pinche-auth-phone-response";
export const BACKEND_STATUS_CHANGE_EVENT = "pinche-backend-status-change";

const BACKEND_HEALTH_TIMEOUT = 10000;
const MAINTENANCE_USER_MESSAGE = "服务正在上线维护中，请稍后再试。";
let cosClient = null;
const albumUploadIdsByKey = new Map();
const backendStatus = {
  checking: false,
  available: null,
  maintenance: false,
  lastCheckedAt: "",
  lastErrorMessage: ""
};

function notifyAuthChange() {
  if (typeof uni !== "undefined" && typeof uni.$emit === "function") {
    uni.$emit(AUTH_CHANGE_EVENT, getCurrentUser());
  }
}

function copyBackendStatus() {
  return { ...backendStatus };
}

function notifyBackendStatusChange() {
  if (typeof uni !== "undefined" && typeof uni.$emit === "function") {
    uni.$emit(BACKEND_STATUS_CHANGE_EVENT, copyBackendStatus());
  }
}

function friendlyBackendError(error) {
  const message = error?.userMessage || error?.errMsg || error?.message || "";
  if (message.includes("timeout")) {
    return "当前连接超时，服务可能正在上线中。";
  }
  return "当前连接暂不可用。";
}

function redirectToMaintenanceHome() {
  if (typeof uni === "undefined" || typeof uni.reLaunch !== "function") {
    return;
  }
  uni.reLaunch({ url: "/pages/index/index?maintenance=1" });
}

export function goHomeAfterLogout() {
  if (typeof uni === "undefined" || typeof uni.reLaunch !== "function") {
    return;
  }
  uni.reLaunch({ url: "/pages/index/index" });
}

function currentPageRoute() {
  if (typeof getCurrentPages !== "function") {
    return "";
  }
  const pages = getCurrentPages();
  return pages.length > 0 ? pages[pages.length - 1].route || "" : "";
}

export function getApiBaseUrl() {
  const app = getApp();
  return app.globalData.apiBaseUrl;
}

function isLocalApiBaseUrl() {
  const value = getApiBaseUrl();
  const normalizedValue = String(value || "").trim();
  const match = normalizedValue.match(/^https?:\/\/([^/:?#]+)/i);
  const hostname = match?.[1] || "";
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

export function assetUrl(path) {
  if (!path) {
    return "";
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (path.startsWith("/uploads/")) {
    return getApiBaseUrl() + path;
  }
  return path;
}

export function apiUrl(path) {
  if (!path) {
    return "";
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (path.startsWith("/")) {
    return getApiBaseUrl() + path;
  }
  return path;
}

export function getBackendStatus() {
  return copyBackendStatus();
}

export function shouldBlockBusinessRequests() {
  return backendStatus.maintenance === true;
}

export function markBackendMaintenance(error = {}) {
  const wasMaintenance = backendStatus.maintenance;
  backendStatus.checking = false;
  backendStatus.available = false;
  backendStatus.maintenance = true;
  backendStatus.lastCheckedAt = new Date().toISOString();
  backendStatus.lastErrorMessage = friendlyBackendError(error);
  notifyBackendStatusChange();
  if (!wasMaintenance) {
    redirectToMaintenanceHome();
  }
  return copyBackendStatus();
}

export function clearBackendMaintenance() {
  backendStatus.checking = false;
  backendStatus.available = true;
  backendStatus.maintenance = false;
  backendStatus.lastCheckedAt = new Date().toISOString();
  backendStatus.lastErrorMessage = "";
  notifyBackendStatusChange();
  return copyBackendStatus();
}

export function checkBackendHealth(options = {}) {
  backendStatus.checking = true;
  notifyBackendStatusChange();

  return new Promise((resolve) => {
    uni.request({
      url: getApiBaseUrl() + "/health",
      method: "GET",
      data: {},
      header: {},
      timeout: options.timeout || BACKEND_HEALTH_TIMEOUT,
      success(response) {
        const responseData = response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300 && responseData.ok === true) {
          resolve(clearBackendMaintenance());
          return;
        }
        resolve(
          markBackendMaintenance({
            errMsg: `health check failed: ${response.statusCode}`,
            userMessage: "当前连接暂不可用。"
          })
        );
      },
      fail(error) {
        resolve(markBackendMaintenance(error));
      }
    });
  });
}

export function setToken(token) {
  const app = getApp();
  app.globalData.token = token || "";
  app.globalData.authBaseUrl = token ? getApiBaseUrl() : "";
  if (token) {
    uni.setStorageSync(TOKEN_KEY, token);
    uni.setStorageSync(AUTH_BASE_URL_KEY, getApiBaseUrl());
  } else {
    uni.removeStorageSync(TOKEN_KEY);
    uni.removeStorageSync(AUTH_BASE_URL_KEY);
  }
}

export function getToken() {
  const app = getApp();
  if (app.globalData.token) {
    if (app.globalData.authBaseUrl === getApiBaseUrl()) {
      return app.globalData.token;
    }
    clearAuth();
    return "";
  }

  const token = uni.getStorageSync(TOKEN_KEY) || "";
  const authBaseUrl = uni.getStorageSync(AUTH_BASE_URL_KEY) || "";
  if (token && authBaseUrl !== getApiBaseUrl()) {
    clearAuth();
    return "";
  }
  if (token) {
    app.globalData.token = token;
    app.globalData.authBaseUrl = authBaseUrl;
    return app.globalData.token;
  }

  return "";
}

export function setAuth(auth) {
  setToken(auth.token || getToken());
  const app = getApp();
  app.globalData.user = auth.user || null;
  app.globalData.roles = auth.roles || [];
  uni.setStorageSync(USER_KEY, auth.user || null);
  uni.setStorageSync(ROLES_KEY, auth.roles || []);
  notifyAuthChange();
}

export function getCurrentUser() {
  const app = getApp();
  const token = app.globalData.token || uni.getStorageSync(TOKEN_KEY) || "";
  const authBaseUrl = app.globalData.authBaseUrl || uni.getStorageSync(AUTH_BASE_URL_KEY) || "";
  if (token && authBaseUrl !== getApiBaseUrl()) {
    clearAuth();
    return { user: null, roles: [] };
  }

  const user = app.globalData.user || uni.getStorageSync(USER_KEY) || null;
  const storedRoles = uni.getStorageSync(ROLES_KEY) || [];
  const roles =
    Array.isArray(app.globalData.roles) && app.globalData.roles.length > 0
      ? app.globalData.roles
      : storedRoles;
  app.globalData.user = user;
  app.globalData.roles = roles;
  return { user, roles };
}

export function clearCurrentUserAvatarUrl(avatarUrl) {
  const auth = getCurrentUser();
  if (!auth.user?.avatarUrl || auth.user.avatarUrl !== avatarUrl) {
    return auth;
  }

  const nextAuth = {
    token: getToken(),
    user: {
      ...auth.user,
      avatarUrl: null
    },
    roles: auth.roles || []
  };
  setAuth(nextAuth);
  return nextAuth;
}

export function clearAuth() {
  const app = getApp();
  app.globalData.token = "";
  app.globalData.authBaseUrl = "";
  app.globalData.user = null;
  app.globalData.roles = [];
  uni.removeStorageSync(TOKEN_KEY);
  uni.removeStorageSync(AUTH_BASE_URL_KEY);
  uni.removeStorageSync(USER_KEY);
  uni.removeStorageSync(ROLES_KEY);
  notifyAuthChange();
}

function rejectUnauthorizedResponse(response) {
  if (response?.statusCode !== 401) {
    return response;
  }
  clearAuth();
  return {
    ...response,
    userMessage: "登录已过期，请重新登录。"
  };
}

function normalizedApiError({ status = 0, payload = {}, fallbackMessage }) {
  const details = payload?.error || payload || {};
  const error = new Error(details.message || payload.message || fallbackMessage);
  error.status = Number(status || 0);
  error.statusCode = error.status;
  error.code = details.code || payload.code || "API_REQUEST_FAILED";
  error.details = details.details ?? payload.details;
  error.userMessage = error.message;
  return error;
}

function confirmLogin(options = {}) {
  if (options.prompt === false || typeof showModal !== "function") {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    showModal({
      title: options.title || "微信登录",
      content: options.content || "登录后继续使用剧本迷·拼车。",
      confirmText: options.confirmText || "登录",
      cancelText: options.cancelText || "取消",
      success(result) {
        resolve(Boolean(result.confirm));
      },
      fail() {
        resolve(true);
      }
    });
  });
}

function chooseUserGender() {
  return new Promise((resolve) => {
    if (typeof showActionSheet !== "function") {
      showModal({
        title: "请选择你的性别",
        content: "该信息会长期保存到账号资料，可在“我的”页修改。",
        confirmText: "男",
        cancelText: "女",
        success(result) {
          resolve(result.confirm ? "male" : "female");
        },
        fail() {
          resolve("");
        }
      });
      return;
    }

    showActionSheet({
      itemList: ["男", "女"],
      success(result) {
        resolve(result.tapIndex === 0 ? "male" : "female");
      },
      fail() {
        resolve("");
      }
    });
  });
}

async function requestUserGenderWithFallback(options = {}) {
  const gender = await chooseUserGender();
  if (!gender) {
    if (options.showToast !== false) {
      showToast({ title: "请选择性别后继续", icon: "none" });
    }
    return null;
  }

  try {
    return await updateUserGender(gender);
  } catch (error) {
    if (options.showToast !== false) {
      showToast({ title: "性别保存失败", icon: "none" });
    }
    return null;
  }
}

export function requestUserGenderFromProfileModal(auth, options = {}) {
  const canUseProfileModal =
    typeof uni !== "undefined" &&
    typeof uni.$emit === "function" &&
    typeof uni.$on === "function" &&
    typeof uni.$off === "function";

  if (!canUseProfileModal) {
    return requestUserGenderWithFallback(options);
  }

  return new Promise((resolve) => {
    const requestId = `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let acknowledged = false;
    let settled = false;
    let fallbackTimer = null;

    const cleanup = () => {
      uni.$off(AUTH_PROFILE_ACK_EVENT, handleAck);
      uni.$off(AUTH_PROFILE_RESPONSE_EVENT, handleResponse);
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }
    };

    const finish = (nextAuth) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(nextAuth || null);
    };

    const handleAck = (payload = {}) => {
      if (payload.requestId === requestId) {
        acknowledged = true;
      }
    };

    const handleResponse = (payload = {}) => {
      if (payload.requestId === requestId) {
        finish(payload.auth || null);
      }
    };

    uni.$on(AUTH_PROFILE_ACK_EVENT, handleAck);
    uni.$on(AUTH_PROFILE_RESPONSE_EVENT, handleResponse);
    uni.$emit(AUTH_PROFILE_REQUEST_EVENT, {
      requestId,
      required: true,
      auth,
      route: currentPageRoute()
    });

    fallbackTimer = setTimeout(async () => {
      if (settled || acknowledged) {
        return;
      }
      settled = true;
      cleanup();
      resolve(await requestUserGenderWithFallback(options));
    }, 300);
  });
}

export function userGenderLabel(gender) {
  const labels = {
    male: "男",
    female: "女"
  };
  return labels[gender] || "未选择";
}

function fileExtensionFromPath(filePath) {
  const match = String(filePath || "").match(/\.([A-Za-z0-9]+)(?:[?#].*)?$/);
  const extension = match ? match[1].toLowerCase() : "";
  if (extension === "jpg" || extension === "jpeg" || extension === "png" || extension === "mp4") {
    return `.${extension}`;
  }
  return ".jpg";
}

function imageContentTypeFromPath(filePath) {
  return fileExtensionFromPath(filePath) === ".png" ? "image/png" : "image/jpeg";
}

function readFileAsArrayBuffer(filePath) {
  if (typeof uni === "undefined" || typeof uni.getFileSystemManager !== "function") {
    return Promise.reject({
      statusCode: 0,
      errMsg: "file system unavailable",
      userMessage: "头像读取失败，请重新选择头像。"
    });
  }

  return new Promise((resolve, reject) => {
    uni.getFileSystemManager().readFile({
      filePath,
      success(result) {
        resolve(result.data);
      },
      fail(error) {
        reject({
          statusCode: 0,
          errMsg: error?.errMsg || "read file failed",
          userMessage: "头像读取失败，请重新选择头像。",
          originalError: error
        });
      }
    });
  });
}

async function loadCosSdk() {
  return COS;
}

async function getCosClient() {
  if (cosClient) {
    return cosClient;
  }

  const COS = await loadCosSdk();
  cosClient = new COS({
    SimpleUploadMethod: "putObject",
    getAuthorization(options, callback) {
      const albumUpload = albumUploadIdsByKey.get(String(options.Key || ""));
      const uploadId = albumUpload?.uploadId;
      const authorizationHeaders = albumUpload
        ? {
            host: `${albumUpload.bucket}.cos.${albumUpload.region}.myqcloud.com`,
            "content-length": String(albumUpload.contentLength),
            "content-type": albumUpload.contentType,
            "pic-operations": albumUpload.picOperations,
            "x-cos-forbid-overwrite": "true"
          }
        : (options.Headers || {});
      request({
        url: "/api/uploads/cos-authorization",
        method: "POST",
        data: {
          bucket: options.Bucket,
          region: options.Region,
          method: options.Method,
          key: options.Key,
          ...(uploadId ? { uploadId } : {}),
          query: albumUpload ? {} : (options.Query || {}),
          headers: authorizationHeaders
        },
        suppressMaintenance: Boolean(uploadId)
      })
        .then((response) => {
          const data = dataOf(response);
          callback(data?.authorization || "");
        })
        .catch(() => {
          callback("");
        });
    }
  });

  return cosClient;
}

async function requestCosUploadIntent(kind, filePath, data = {}) {
  const response = await request({
    url: "/api/uploads/cos-intent",
    method: "POST",
    data: {
      kind,
      extension: fileExtensionFromPath(filePath),
      ...data
    }
  });
  return dataOf(response)?.upload || { direct: false };
}

function getLocalFileSize(filePath) {
  if (!filePath || typeof uni === "undefined") {
    return Promise.resolve(0);
  }
  return new Promise((resolve) => {
    const finish = (value) => {
      const size = Number(value || 0);
      resolve(Number.isFinite(size) && size > 0 ? size : 0);
    };
    const statFile = () => {
      if (typeof uni.getFileSystemManager !== "function") {
        finish(0);
        return;
      }
      try {
        const fileSystem = uni.getFileSystemManager();
        if (!fileSystem || typeof fileSystem.stat !== "function") {
          finish(0);
          return;
        }
        fileSystem.stat({
          path: filePath,
          success(result) {
            const stats = result.stats || result.stat || result;
            finish(stats?.size);
          },
          fail() {
            finish(0);
          }
        });
      } catch (error) {
        finish(0);
      }
    };
    if (typeof uni.getFileInfo !== "function") {
      statFile();
      return;
    }
    try {
      uni.getFileInfo({
        filePath,
        success(result) {
          const size = Number(result?.size || 0);
          if (Number.isFinite(size) && size > 0) {
            finish(size);
            return;
          }
          statFile();
        },
        fail: statFile
      });
    } catch (error) {
      statFile();
    }
  });
}

async function uploadCosObject(upload, filePath) {
  const client = await getCosClient();
  return new Promise((resolve, reject) => {
    client.putObject(
      {
        Bucket: upload.bucket,
        Region: upload.region,
        Key: upload.key,
        FilePath: filePath,
        ContentLength: upload.contentLength,
        ContentType: upload.contentType,
        Headers: upload.headers || {},
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
  const sdkCode = original?.error?.Code || original?.Code || error?.code;
  const sdkMessage = original?.error?.Message || original?.Message || error?.message || error?.errMsg;
  const text = String(sdkMessage || "COS upload failed");
  const normalized = new Error(text);
  normalized.status = Number(error?.status || error?.statusCode || original?.statusCode || 0);
  normalized.statusCode = normalized.status;
  normalized.code = sdkCode || (
    /url not in domain list|不在以下 request 合法域名列表中/i.test(text)
      ? "COS_DOMAIN_NOT_ALLOWED"
      : /timeout|超时/i.test(text)
        ? "COS_REQUEST_TIMEOUT"
        : "COS_NETWORK_ERROR"
  );
  normalized.details = error?.details;
  normalized.originalError = original;
  return normalized;
}

export async function putSessionAlbumPhotoToCos(upload, filePath) {
  const client = await getCosClient();
  albumUploadIdsByKey.set(String(upload.key), upload);
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
          code: "COS_REQUEST_TIMEOUT",
          status: 0,
          statusCode: 0
        }));
      }, 300_000);
      try {
        task = client.putObject({
          Bucket: upload.bucket,
          Region: upload.region,
          Key: upload.key,
          FilePath: filePath,
          ContentLength: Number(upload.contentLength),
          ContentType: upload.contentType,
          PicOperations: upload.picOperations,
          Headers: { ...(upload.headers || {}), "x-cos-forbid-overwrite": "true" },
          onProgress() {}
        }, (error) => {
          if (error) finish(reject, normalizeAlbumCosError(error));
          else finish(resolve, upload.uploadPath);
        });
      } catch (error) {
        finish(reject, normalizeAlbumCosError(error));
      }
    });
  } finally {
    albumUploadIdsByKey.delete(String(upload.key));
  }
}

export function clearSessionAlbumPhotoAuthorization(key) {
  const cache = cosClient?._authorizationCache || cosClient?.authorizationCache;
  if (cache && typeof cache.delete === "function") cache.delete(String(key));
}

export function createSessionAlbumPhotoUploadIntent(sessionId, facts) {
  return request({
    url: "/api/uploads/cos-intent",
    method: "POST",
    data: {
      kind: facts.adminOwner ? "adminSessionAlbumPhoto" : "sessionAlbumPhoto",
      sessionId,
      extension: facts.extension,
      contentType: facts.contentType,
      byteSize: facts.byteSize
    },
    suppressMaintenance: true
  }).then((response) => dataOf(response)?.upload);
}

export function getSessionAlbumPhotoUploadStatus(uploadId) {
  return request({
    url: `/api/uploads/${encodeURIComponent(uploadId)}/status`,
    suppressMaintenance: true
  }).then(dataOf);
}

export function finalizeSessionAlbumPhotoUpload(uploadId) {
  return request({
    url: `/api/uploads/${encodeURIComponent(uploadId)}/finalize`,
    method: "POST",
    data: {},
    suppressMaintenance: true
  }).then(dataOf);
}

export function reportAlbumMediaEvent(event, fields = {}) {
  request({
    url: "/api/telemetry/album-media",
    method: "POST",
    data: { event, ...fields },
    suppressMaintenance: true
  }).catch(() => {});
}

async function uploadCosBackedFile({ kind, filePath, fallbackUpload, intentData = {} }) {
  const upload = await requestCosUploadIntent(kind, filePath, intentData);
  const localFileSize = await getLocalFileSize(filePath);
  const maxBytes = Number(upload.maxBytes || 0);
  if (localFileSize > 0 && maxBytes > 0 && localFileSize > maxBytes) {
    throw {
      statusCode: 413,
      errMsg: "upload file exceeds maxBytes",
      userMessage: "文件过大，请压缩后重试。"
    };
  }
  if (!upload.direct) {
    return fallbackUpload(filePath);
  }
  if (!localFileSize) {
    return fallbackUpload(filePath);
  }
  try {
    return await uploadCosObject(upload, filePath);
  } catch (error) {
    return fallbackUpload(filePath);
  }
}

function uploadBackendFile({ filePath, url, name, responseField, timeoutMessage, failMessage }) {
  if (shouldBlockBusinessRequests()) {
    return Promise.reject({
      statusCode: 0,
      maintenance: true,
      errMsg: "backend maintenance",
      userMessage: MAINTENANCE_USER_MESSAGE
    });
  }

  const headers = {};
  const token = getToken();
  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: getApiBaseUrl() + url,
      filePath,
      name,
      header: headers,
      success(response) {
        let responseData = response.data || {};
        if (typeof responseData === "string") {
          try {
            responseData = JSON.parse(responseData);
          } catch (error) {
            reject({
              statusCode: response.statusCode,
              errMsg: "invalid upload response",
              originalError: error
            });
            return;
          }
        }

        if (response.statusCode >= 400 || responseData.ok === false) {
          reject(rejectUnauthorizedResponse({
            statusCode: response.statusCode,
            data: responseData
          }));
          return;
        }

        const uploadedUrl = responseData.data?.[responseField] || "";
        if (!uploadedUrl) {
          reject({
            statusCode: response.statusCode,
            errMsg: `missing ${responseField}`
          });
          return;
        }

        resolve(uploadedUrl);
      },
      fail(error) {
        const errMsg = error?.errMsg || "upload failed";
        markBackendMaintenance(error);
        reject({
          statusCode: 0,
          maintenance: true,
          errMsg,
          userMessage: errMsg.includes("timeout")
            ? timeoutMessage
            : failMessage,
          originalError: error
        });
      }
    });
  });
}

function uploadBackendBinaryFile({ bodyBytes, contentType, url, responseField, timeoutMessage, failMessage }) {
  if (shouldBlockBusinessRequests()) {
    return Promise.reject({
      statusCode: 0,
      maintenance: true,
      errMsg: "backend maintenance",
      userMessage: MAINTENANCE_USER_MESSAGE
    });
  }

  const headers = {
    "content-type": contentType
  };
  const token = getToken();
  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  return new Promise((resolve, reject) => {
    uni.request({
      url: getApiBaseUrl() + url,
      method: "POST",
      data: bodyBytes,
      header: headers,
      timeout: 15000,
      success(response) {
        let responseData = response.data || {};
        if (typeof responseData === "string") {
          try {
            responseData = JSON.parse(responseData);
          } catch (error) {
            reject({
              statusCode: response.statusCode,
              errMsg: "invalid upload response",
              originalError: error
            });
            return;
          }
        }

        if (response.statusCode >= 400 || responseData.ok === false) {
          reject(rejectUnauthorizedResponse({
            statusCode: response.statusCode,
            data: responseData
          }));
          return;
        }

        const uploadedUrl = responseData.data?.[responseField] || "";
        if (!uploadedUrl) {
          reject({
            statusCode: response.statusCode,
            errMsg: `missing ${responseField}`
          });
          return;
        }

        resolve(uploadedUrl);
      },
      fail(error) {
        const errMsg = error?.errMsg || "request failed";
        markBackendMaintenance(error);
        reject({
          statusCode: 0,
          maintenance: true,
          errMsg,
          userMessage: errMsg.includes("timeout") ? timeoutMessage : failMessage,
          originalError: error
        });
      }
    });
  });
}

async function fallbackUploadUserAvatar(filePath) {
  return uploadBackendBinaryFile({
    bodyBytes: await readFileAsArrayBuffer(filePath),
    contentType: imageContentTypeFromPath(filePath),
    url: "/api/users/me/avatar",
    responseField: "avatarUrl",
    timeoutMessage: "头像上传超时，请确认本地后端已启动。",
    failMessage: "头像上传失败，请稍后重试。"
  });
}

export async function uploadUserAvatar(filePath) {
  return uploadCosBackedFile({
    kind: "avatar",
    filePath,
    fallbackUpload: fallbackUploadUserAvatar
  });
}

function fallbackUploadSessionReviewPhoto(filePath) {
  return uploadBackendFile({
    filePath,
    url: "/api/session-reviews/photos",
    name: "photo",
    responseField: "photoUrl",
    timeoutMessage: "照片上传超时，请确认本地后端已启动。",
    failMessage: "照片上传失败，请稍后重试。"
  });
}

export async function uploadSessionReviewPhoto(filePath) {
  return uploadCosBackedFile({
    kind: "sessionReviewPhoto",
    filePath,
    fallbackUpload: fallbackUploadSessionReviewPhoto
  });
}

export function uploadSessionAlbumPhotoLocal(sessionId, filePath, options = {}) {
  return uploadBackendFile({
    filePath,
    url: options.adminOwner
      ? `/api/admin/sessions/${sessionId}/album/uploads`
      : `/api/sessions/${sessionId}/album/uploads`,
    name: "photo",
    responseField: "photoUrl",
    timeoutMessage: "相册照片上传超时，请确认本地后端已启动。",
    failMessage: "相册照片上传失败，请稍后重试。"
  });
}

export async function uploadSessionAlbumPhoto(sessionId, filePath) {
  return uploadCosBackedFile({
    kind: "sessionAlbumPhoto",
    filePath,
    intentData: { sessionId },
    fallbackUpload: (path) => uploadSessionAlbumPhotoLocal(sessionId, path)
  });
}

export async function createSessionAlbumPhotoLegacy(sessionId, photoUrl, options = {}) {
  const response = await request({
    url: options.adminOwner
      ? `/api/admin/sessions/${sessionId}/album/photos`
      : `/api/sessions/${sessionId}/album/photos`,
    method: "POST",
    data: { photoUrl },
    suppressMaintenance: true
  });
  return { photo: dataOf(response) };
}

function fallbackUploadSessionAlbumVideo(sessionId, filePath) {
  return uploadBackendFile({
    filePath,
    url: `/api/admin/sessions/${sessionId}/album/videos/uploads`,
    name: "video",
    responseField: "sourceUrl",
    timeoutMessage: "相册视频上传超时，请确认本地后端已启动。",
    failMessage: "相册视频上传失败，请稍后重试。"
  });
}

export async function uploadSessionAlbumVideo(sessionId, filePath) {
  return uploadCosBackedFile({
    kind: "adminSessionAlbumVideo",
    filePath,
    intentData: { sessionId },
    fallbackUpload: (path) => fallbackUploadSessionAlbumVideo(sessionId, path)
  });
}

export async function createSessionAlbumVideo(sessionId, payload) {
  const response = await request({
    url: `/api/admin/sessions/${sessionId}/album/videos`,
    method: "POST",
    data: payload
  });
  return dataOf(response);
}

export async function updateUserProfile(patch) {
  const response = await request({
    url: "/api/users/me",
    method: "PATCH",
    data: patch
  });
  const data = dataOf(response);
  if (!data?.user) {
    return null;
  }

  const current = getCurrentUser();
  const nextAuth = {
    token: getToken(),
    user: data.user,
    roles: data.roles || current.roles || []
  };
  setAuth(nextAuth);
  return nextAuth;
}

export async function updateUserGender(gender) {
  return updateUserProfile({ gender });
}

export async function refreshCurrentAuth() {
  const token = getToken();
  if (!token) {
    return null;
  }

  try {
    const response = await request({ url: "/api/users/me" });
    const data = dataOf(response);
    if (!data?.user) {
      return null;
    }

    const nextAuth = {
      token,
      user: data.user,
      roles: data.roles || []
    };
    setAuth(nextAuth);
    return nextAuth;
  } catch (error) {
    if (error?.statusCode === 401) {
      clearAuth();
    }
    return null;
  }
}

export async function updateUserPhoneFromWechatPhoneCode(code) {
  const response = await request({
    url: "/api/auth/wechat/phone",
    method: "POST",
    data: { code }
  });
  const data = dataOf(response);
  if (!data?.user) {
    return null;
  }

  const current = getCurrentUser();
  const nextAuth = {
    token: getToken(),
    user: data.user,
    roles: data.roles || current.roles || []
  };
  setAuth(nextAuth);
  return nextAuth;
}

export async function ensureUserGender(auth, options = {}) {
  if (options.requireGender !== true || auth?.user?.gender) {
    return auth;
  }

  return requestUserGenderFromProfileModal(auth, options);
}

export function requestUserPhoneFromPhoneModal(auth, options = {}) {
  const canUsePhoneModal =
    typeof uni !== "undefined" &&
    typeof uni.$emit === "function" &&
    typeof uni.$on === "function" &&
    typeof uni.$off === "function";
  const required = options.requirePhone === true;

  if (!canUsePhoneModal) {
    if (required && options.showToast !== false) {
      showToast({ title: "授权手机号后继续", icon: "none" });
    }
    return Promise.resolve(required ? null : auth);
  }

  return new Promise((resolve) => {
    const requestId = `phone-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let acknowledged = false;
    let settled = false;
    let fallbackTimer = null;

    const cleanup = () => {
      uni.$off(AUTH_PHONE_ACK_EVENT, handleAck);
      uni.$off(AUTH_PHONE_RESPONSE_EVENT, handleResponse);
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }
    };

    const finish = (nextAuth) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(nextAuth || null);
    };

    const handleAck = (payload = {}) => {
      if (payload.requestId === requestId) {
        acknowledged = true;
      }
    };

    const handleResponse = (payload = {}) => {
      if (payload.requestId === requestId) {
        finish(payload.auth || null);
      }
    };

    uni.$on(AUTH_PHONE_ACK_EVENT, handleAck);
    uni.$on(AUTH_PHONE_RESPONSE_EVENT, handleResponse);
    uni.$emit(AUTH_PHONE_REQUEST_EVENT, {
      requestId,
      required,
      auth,
      route: currentPageRoute(),
      title: required ? options.phoneRequiredTitle : options.phoneOptionalTitle,
      content: required ? options.phoneRequiredContent : options.phoneOptionalContent
    });

    fallbackTimer = setTimeout(() => {
      if (settled || acknowledged) {
        return;
      }
      settled = true;
      cleanup();
      if (required && options.showToast !== false) {
        showToast({ title: "授权手机号后继续", icon: "none" });
      }
      resolve(required ? null : auth);
    }, 300);
  });
}

export async function ensureUserPhone(auth, options = {}) {
  if (auth?.user?.phoneVerifiedAt) {
    return auth;
  }

  const requirePhone = options.requirePhone === true;
  if (!requirePhone && options.promptPhoneAfterLogin !== true) {
    return auth;
  }

  const nextAuth = await requestUserPhoneFromPhoneModal(auth, options);
  if (nextAuth?.user?.phoneVerifiedAt) {
    return nextAuth;
  }

  return requirePhone ? null : auth;
}

export function loginWithWechat(options = {}) {
  const loginWithCode = (code) => {
    if (!code) {
      const error = new Error("WeChat login code is missing");
      error.userMessage = "微信登录凭证获取失败，请重试";
      return Promise.reject(error);
    }
    return request({
      url: "/api/auth/wechat/login",
      method: "POST",
      data: {
        code
      }
    }).then((response) => {
      const data = dataOf(response);
      if (data) {
        setAuth(data);
      }
      return data;
    });
  };

  return new Promise((resolve, reject) => {
    uni.login({
      provider: "weixin",
      success(loginResult) {
        loginWithCode(resolveWechatLoginCode(loginResult, options)).then(resolve).catch(reject);
      },
      fail(loginError) {
        const fallbackCode = resolveWechatLoginCode({}, options);
        if (!fallbackCode) {
          reject(loginError);
          return;
        }
        loginWithCode(fallbackCode).then(resolve).catch(reject);
      }
    });
  });
}

function resolveWechatLoginCode(loginResult, options = {}) {
  if (options.devCode && isLocalApiBaseUrl()) {
    return options.devCode;
  }
  if (loginResult.code) {
    return loginResult.code;
  }
  return isLocalApiBaseUrl() ? options.devCode || "dev-player-openid" : "";
}

export async function ensureLoggedIn(options = {}) {
  const auth = getCurrentUser();
  const token = getToken();
  if (auth.user && token) {
    const refreshedAuth = await refreshCurrentAuth();
    if (refreshedAuth) {
      const phoneAuth = await ensureUserPhone(refreshedAuth, options);
      if (!phoneAuth) {
        return null;
      }
      return options.requireGender === true ? ensureUserGender(phoneAuth, options) : phoneAuth;
    }
  }
  if (auth.user && !getToken()) {
    clearAuth();
  }

  const confirmed = await confirmLogin(options);
  if (!confirmed) {
    return null;
  }

  try {
    const data = await loginWithWechat(options);
    if (!data) {
      throw new Error("Missing auth data");
    }
    const loggedInAuth = {
      user: data.user || null,
      roles: data.roles || [],
      token: data.token || ""
    };
    const phoneAuth = await ensureUserPhone(loggedInAuth, options);
    if (!phoneAuth) {
      return null;
    }
    return options.requireGender === true ? ensureUserGender(phoneAuth, options) : phoneAuth;
  } catch (error) {
    if (options.showToast !== false) {
      showToast({
        title: error?.userMessage || options.failTitle || "登录失败",
        icon: "none"
      });
    }
    return null;
  }
}

export function dataOf(response) {
  return response.data && response.data.data;
}

export function queryString(params) {
  const pairs = Object.entries(params || {}).filter(([, value]) => {
    return value !== undefined && value !== null && value !== "";
  });
  if (pairs.length === 0) {
    return "";
  }

  return (
    "?" +
    pairs
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&")
  );
}

export function request(options = {}) {
  if (shouldBlockBusinessRequests() && options.allowDuringMaintenance !== true) {
    return Promise.reject({
      statusCode: 0,
      maintenance: true,
      errMsg: "backend maintenance",
      userMessage: MAINTENANCE_USER_MESSAGE
    });
  }

  const headers = Object.assign({}, options.header || {});
  const token = getToken();
  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  return new Promise((resolve, reject) => {
    uni.request({
      url: getApiBaseUrl() + options.url,
      method: options.method || "GET",
      data: options.data || {},
      header: headers,
      timeout: options.timeout || 8000,
      success(response) {
        const responseData = response.data || {};
        if (response.statusCode >= 400 || responseData.ok === false) {
          const authResponse = rejectUnauthorizedResponse(response);
          reject(normalizedApiError({
            status: authResponse.statusCode,
            payload: responseData,
            fallbackMessage: "请求失败"
          }));
          return;
        }
        resolve(response);
      },
      fail(error) {
        const errMsg = error?.errMsg || "request failed";
        if (!options.suppressMaintenance) markBackendMaintenance(error);
        const normalized = normalizedApiError({
          status: 0,
          payload: {},
          fallbackMessage: errMsg.includes("timeout")
            ? "请求超时，请确认本地后端已启动。"
            : "网络请求失败，请稍后重试。"
        });
        normalized.code = errMsg.includes("timeout") ? "API_REQUEST_TIMEOUT" : "API_NETWORK_ERROR";
        normalized.maintenance = !options.suppressMaintenance;
        normalized.originalError = error;
        reject(normalized);
      }
    });
  });
}
