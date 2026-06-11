const app = getApp();

Page({
  data: {
    statusText: "未登录"
  },

  login() {
    wx.login({
      success: (loginResult) => {
        app
          .request({
            url: "/api/auth/wechat/login",
            method: "POST",
            data: {
              code: loginResult.code || "dev-admin-openid"
            }
          })
          .then((response) => {
            const data = response.data && response.data.data;
            if (!data) {
              this.setData({ statusText: "登录失败" });
              return;
            }

            app.setToken(data.token);
            this.setData({
              statusText: data.openid + " / " + data.roles.join(", ")
            });
          })
          .catch(() => {
            this.setData({ statusText: "登录失败" });
          });
      }
    });
  },

  goAdmin() {
    wx.navigateTo({ url: "/pages/admin/catalog" });
  }
});
