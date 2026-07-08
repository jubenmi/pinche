export function getAdminRuntimeConfig(globalObject = globalThis) {
  const config = globalObject?.__PINCH_ADMIN_CONFIG__;
  return config && typeof config === "object" ? config : {};
}

export function getTencentMapKey(globalObject = globalThis) {
  const runtimeConfig = getAdminRuntimeConfig(globalObject);
  return String(runtimeConfig.TENCENT_MAP_KEY || "").trim();
}
