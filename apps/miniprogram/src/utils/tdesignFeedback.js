let pendingActionSheet = null;

function currentFeedbackContext() {
  if (typeof getCurrentPages !== "function") {
    return null;
  }
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  return page?.$$basePage || page || null;
}

function feedbackInstance(selector) {
  const context = currentFeedbackContext();
  if (!context || typeof context.selectComponent !== "function") {
    return null;
  }
  return context.selectComponent(selector);
}

function callMaybe(fn, value) {
  if (typeof fn === "function") {
    fn(value);
  }
}

function toastTheme(icon) {
  if (icon === "success" || icon === "loading" || icon === "error") {
    return icon;
  }
  return "";
}

export function showToast(options = {}) {
  const normalized = typeof options === "string" ? { title: options } : { ...options };
  const message = normalized.title || normalized.message || "";
  const toast = feedbackInstance("#t-toast");
  if (toast && typeof toast.show === "function") {
    toast.show({
      direction: "row",
      duration: normalized.duration ?? 2000,
      message,
      placement: normalized.placement || "middle",
      theme: toastTheme(normalized.icon)
    });
    const result = { errMsg: "showToast:ok" };
    callMaybe(normalized.success, result);
    callMaybe(normalized.complete, result);
    return;
  }

  if (typeof uni !== "undefined" && typeof uni.showToast === "function") {
    uni.showToast(normalized);
  }
}

export function showModal(options = {}) {
  const modal = feedbackInstance("#t-dialog");
  if (modal && typeof modal.setData === "function") {
    const showCancel = options.showCancel !== false;
    const resolveResult = (result) => {
      callMaybe(options.success, result);
      callMaybe(options.complete, result);
    };
    modal._onConfirm = () => {
      resolveResult({ confirm: true, cancel: false, errMsg: "showModal:ok" });
      return true;
    };
    modal._onCancel = () => {
      resolveResult({ confirm: false, cancel: true, errMsg: "showModal:ok" });
      return true;
    };
    modal.setData({
      buttonLayout: "horizontal",
      cancelBtn: showCancel ? options.cancelText || "取消" : "",
      closeOnOverlayClick: Boolean(options.closeOnOverlayClick),
      confirmBtn: options.confirmText || "确定",
      content: options.content || "",
      showOverlay: true,
      title: options.title || "",
      visible: true
    });
    return;
  }

  if (typeof uni !== "undefined" && typeof uni.showModal === "function") {
    uni.showModal(options);
  } else {
    callMaybe(options.fail, { errMsg: "showModal:fail unavailable" });
  }
}

export function showActionSheet(options = {}) {
  const sheet = feedbackInstance("#t-action-sheet");
  if (sheet && typeof sheet.show === "function") {
    pendingActionSheet = options;
    sheet.show({
      cancelText: options.cancelText || "取消",
      items: (options.itemList || []).map((label) => ({ label })),
      showCancel: options.showCancel !== false,
      theme: "list"
    });
    return;
  }

  if (typeof uni !== "undefined" && typeof uni.showActionSheet === "function") {
    uni.showActionSheet(options);
  } else {
    callMaybe(options.fail, { errMsg: "showActionSheet:fail unavailable" });
  }
}

export function handleActionSheetSelected(detail = {}) {
  if (!pendingActionSheet) {
    return;
  }
  const options = pendingActionSheet;
  pendingActionSheet = null;
  const result = { tapIndex: detail.index, errMsg: "showActionSheet:ok" };
  callMaybe(options.success, result);
  callMaybe(options.complete, result);
}

export function handleActionSheetCancel() {
  if (!pendingActionSheet) {
    return;
  }
  const options = pendingActionSheet;
  pendingActionSheet = null;
  const result = { errMsg: "showActionSheet:fail cancel" };
  callMaybe(options.fail, result);
  callMaybe(options.complete, result);
}

export function handleActionSheetClose() {
  handleActionSheetCancel();
}
