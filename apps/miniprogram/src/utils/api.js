const TOKEN_KEY = "pinche_token";
const USER_KEY = "pinche_user";
const ROLES_KEY = "pinche_roles";

export function getApiBaseUrl() {
  const app = getApp();
  return app.globalData.apiBaseUrl;
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
  setToken(auth.token);
  const app = getApp();
  app.globalData.user = auth.user || null;
  app.globalData.roles = auth.roles || [];
  uni.setStorageSync(USER_KEY, auth.user || null);
  uni.setStorageSync(ROLES_KEY, auth.roles || []);
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

export function clearAuth() {
  const app = getApp();
  app.globalData.token = "";
  app.globalData.user = null;
  app.globalData.roles = [];
  uni.removeStorageSync(TOKEN_KEY);
  uni.removeStorageSync(USER_KEY);
  uni.removeStorageSync(ROLES_KEY);
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

export function request(options) {
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
          reject(response);
          return;
        }
        resolve(response);
      },
      fail(error) {
        reject({
          statusCode: 0,
          errMsg: error?.errMsg || "request failed",
          originalError: error
        });
      }
    });
  });
}
