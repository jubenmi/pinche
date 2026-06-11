export function getApiBaseUrl() {
  const app = getApp();
  return app.globalData.apiBaseUrl;
}

export function setToken(token) {
  const app = getApp();
  app.globalData.token = token || "";
}

export function request(options) {
  const app = getApp();
  const headers = Object.assign({}, options.header || {});
  if (app.globalData.token) {
    headers.Authorization = "Bearer " + app.globalData.token;
  }

  return new Promise((resolve, reject) => {
    uni.request({
      url: getApiBaseUrl() + options.url,
      method: options.method || "GET",
      data: options.data || {},
      header: headers,
      success: resolve,
      fail: reject
    });
  });
}
