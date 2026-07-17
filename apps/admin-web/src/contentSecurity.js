const SETTINGS_PATH = "/api/admin/content-security-settings";
const SETTINGS_KEYS = Object.freeze([
  "blockWhenUnavailable",
  "blockImageWhenUnavailable",
  "blockVideoWhenUnavailable",
  "blockTextWhenUnavailable"
]);
const CAPABILITY_TYPES = Object.freeze(["image", "video", "text"]);

export function contentSecuritySettingsPayload(settings) {
  if (
    !settings ||
    typeof settings !== "object" ||
    SETTINGS_KEYS.some((key) => typeof settings[key] !== "boolean")
  ) {
    throw new TypeError("content security requires four boolean settings");
  }
  return Object.fromEntries(SETTINGS_KEYS.map((key) => [key, settings[key]]));
}

function contentSecurityCapabilities(value) {
  if (
    !value ||
    typeof value !== "object" ||
    CAPABILITY_TYPES.some((type) => typeof value[type]?.available !== "boolean")
  ) {
    throw new TypeError("content security requires three boolean capabilities");
  }
  return Object.fromEntries(
    CAPABILITY_TYPES.map((type) => [type, { available: value[type].available }])
  );
}

export function createContentSecuritySettingsClient(request) {
  if (typeof request !== "function") {
    throw new TypeError("content security request adapter is required");
  }
  return {
    get() {
      return request(SETTINGS_PATH);
    },
    update(settings) {
      return request(SETTINGS_PATH, {
        method: "PUT",
        body: contentSecuritySettingsPayload(settings)
      });
    }
  };
}

export function createContentSecurityState() {
  return {
    loadStatus: "unknown",
    settings: Object.fromEntries(SETTINGS_KEYS.map((key) => [key, false])),
    capabilities: Object.fromEntries(
      CAPABILITY_TYPES.map((type) => [type, { available: false }])
    )
  };
}

export function contentSecurityLoadSucceeded(_previousState, data) {
  return {
    loadStatus: "trusted",
    settings: contentSecuritySettingsPayload(data?.settings),
    capabilities: contentSecurityCapabilities(data?.capabilities)
  };
}

export function contentSecurityLoadFailed(state = createContentSecurityState()) {
  return {
    ...state,
    loadStatus: "failed"
  };
}

export function canSaveContentSecurity(state) {
  return state?.loadStatus === "trusted";
}

export function contentSecurityCapabilityLabel(state, type) {
  if (state?.loadStatus === "failed") {
    return "加载失败";
  }
  if (state?.loadStatus !== "trusted") {
    return "未知";
  }
  return state.capabilities?.[type]?.available ? "已配置（启动时）" : "未配置（启动时）";
}

export function contentSecurityCapabilityClass(state, type) {
  if (state?.loadStatus !== "trusted") {
    return "capability-unknown";
  }
  return state.capabilities?.[type]?.available
    ? "capability-available"
    : "capability-unavailable";
}
