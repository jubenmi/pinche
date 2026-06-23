const TOKEN_KEY = "pinche_token";
const USER_KEY = "pinche_user";
const ROLES_KEY = "pinche_roles";
export const AUTH_CHANGE_EVENT = "pinche-auth-change";
export const AUTH_PROFILE_REQUEST_EVENT = "pinche-auth-profile-request";
export const AUTH_PROFILE_ACK_EVENT = "pinche-auth-profile-ack";
export const AUTH_PROFILE_RESPONSE_EVENT = "pinche-auth-profile-response";
export const AUTH_PHONE_REQUEST_EVENT = "pinche-auth-phone-request";
export const AUTH_PHONE_ACK_EVENT = "pinche-auth-phone-ack";
export const AUTH_PHONE_RESPONSE_EVENT = "pinche-auth-phone-response";
export const BACKEND_STATUS_CHANGE_EVENT = "pinche-backend-status-change";

const BACKEND_HEALTH_TIMEOUT = 3000;
const MAINTENANCE_USER_MESSAGE = "服务正在上线维护中，请稍后再试。";
let cosClient = null;
let cosSdkConstructor = null;
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
  if (token) {
    uni.setStorageSync(TOKEN_KEY, token);
  } else {
    uni.removeStorageSync(TOKEN_KEY);
  }
}

export function getToken() {
  const app = getApp();
  if (app.globalData.token) {
    return app.globalData.token;
  }

  const token = uni.getStorageSync(TOKEN_KEY) || "";
  app.globalData.token = token;
  return token;
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
  app.globalData.user = null;
  app.globalData.roles = [];
  uni.removeStorageSync(TOKEN_KEY);
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

function confirmLogin(options = {}) {
  if (options.prompt === false || typeof uni.showModal !== "function") {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    uni.showModal({
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
    if (typeof uni.showActionSheet !== "function") {
      uni.showModal({
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

    uni.showActionSheet({
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
      uni.showToast({ title: "请选择性别后继续", icon: "none" });
    }
    return null;
  }

  try {
    return await updateUserGender(gender);
  } catch (error) {
    if (options.showToast !== false) {
      uni.showToast({ title: "性别保存失败", icon: "none" });
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
  if (extension === "jpg" || extension === "jpeg" || extension === "png") {
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
  if (cosSdkConstructor) {
    return cosSdkConstructor;
  }

  const module = await import("cos-wx-sdk-v5/index.js");
  cosSdkConstructor = module.default || module;
  return cosSdkConstructor;
}

async function getCosClient() {
  if (cosClient) {
    return cosClient;
  }

  const COS = await loadCosSdk();
  cosClient = new COS({
    SimpleUploadMethod: "putObject",
    getAuthorization(options, callback) {
      request({
        url: "/api/uploads/cos-authorization",
        method: "POST",
        data: {
          bucket: options.Bucket,
          region: options.Region,
          method: options.Method,
          key: options.Key,
          query: options.Query || {},
          headers: options.Headers || {}
        }
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

async function uploadCosObject(upload, filePath) {
  const client = await getCosClient();
  return new Promise((resolve, reject) => {
    client.putObject(
      {
        Bucket: upload.bucket,
        Region: upload.region,
        Key: upload.key,
        FilePath: filePath,
        ContentType: upload.contentType,
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

async function uploadCosBackedFile({ kind, filePath, fallbackUpload, intentData = {} }) {
  const upload = await requestCosUploadIntent(kind, filePath, intentData);
  if (!upload.direct) {
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

function fallbackUploadSessionAlbumPhoto(sessionId, filePath) {
  return uploadBackendFile({
    filePath,
    url: `/api/sessions/${sessionId}/album/uploads`,
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
    fallbackUpload: (path) => fallbackUploadSessionAlbumPhoto(sessionId, path)
  });
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
      uni.showToast({ title: "授权手机号后继续", icon: "none" });
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
        uni.showToast({ title: "授权手机号后继续", icon: "none" });
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
  return new Promise((resolve, reject) => {
    uni.login({
      provider: "weixin",
      success(loginResult) {
        request({
          url: "/api/auth/wechat/login",
          method: "POST",
          data: {
            code: loginResult.code || options.devCode || "dev-player-openid"
          }
        })
          .then((response) => {
            const data = dataOf(response);
            if (data) {
              setAuth(data);
            }
            resolve(data);
          })
          .catch(reject);
      },
      fail: reject
    });
  });
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
      uni.showToast({
        title: options.failTitle || "登录失败",
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
          reject(rejectUnauthorizedResponse(response));
          return;
        }
        resolve(response);
      },
      fail(error) {
        const errMsg = error?.errMsg || "request failed";
        markBackendMaintenance(error);
        reject({
          statusCode: 0,
          maintenance: true,
          errMsg,
          userMessage: errMsg.includes("timeout")
            ? "请求超时，请确认本地后端已启动。"
            : "网络请求失败，请稍后重试。",
          originalError: error
        });
      }
    });
  });
}
