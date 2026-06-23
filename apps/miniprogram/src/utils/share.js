export function showWechatShareMenus(options = {}) {
  if (typeof uni === "undefined" || typeof uni.showShareMenu !== "function") {
    return;
  }

  if (import.meta.env.DEV) {
    return;
  }

  uni.showShareMenu(options);
}
