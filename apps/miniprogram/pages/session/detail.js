Page({
  onShareAppMessage() {
    return {
      title: "拼车发车",
      path: "/pages/session/detail?id=d1-demo"
    };
  },

  goApply() {
    wx.navigateTo({ url: "/pages/session/apply?id=d1-demo" });
  }
});
