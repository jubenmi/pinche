App({
  globalData: {
    apiBaseUrl: "http://localhost:3018",
    token: ""
  },

  setToken(token) {
    this.globalData.token = token || "";
  },

  request(options) {
    const headers = Object.assign({}, options.header || {});
    if (this.globalData.token) {
      headers.Authorization = "Bearer " + this.globalData.token;
    }

    return new Promise((resolve, reject) => {
      wx.request({
        url: this.globalData.apiBaseUrl + options.url,
        method: options.method || "GET",
        data: options.data || {},
        header: headers,
        success: resolve,
        fail: reject
      });
    });
  }
});
