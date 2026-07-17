export const catalogTabs = new Set(["stores", "scripts", "sessions", "review"]);
export const miniScreens = new Set([
  "home",
  "create",
  "mine",
  "detail",
  "manage",
  "share",
  "review",
  "album"
]);
export const sessionBackedMiniScreens = new Set(["detail", "manage", "share", "review", "album"]);

function normalizedString(value) {
  return String(value || "").trim();
}

function normalizeCatalogTab(value) {
  return catalogTabs.has(value) ? value : "stores";
}

function normalizeMiniScreen(value, sessionId) {
  const screen = miniScreens.has(value) ? value : sessionId ? "detail" : "home";
  if (sessionBackedMiniScreens.has(screen) && !sessionId) {
    return "home";
  }
  return screen;
}

export function parseAdminRouteQuery(search = "") {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const sessionId = normalizedString(params.get("sessionId"));
  const requestedView = params.get("view");
  const activeView =
    requestedView === "catalog" ||
    requestedView === "miniapp" ||
    requestedView === "moderation" ||
    requestedView === "content-security"
      ? requestedView
      : sessionId
        ? "miniapp"
        : "catalog";
  const miniScreen = normalizeMiniScreen(params.get("screen"), sessionId);

  return {
    activeView,
    catalogTab: normalizeCatalogTab(params.get("catalogTab")),
    miniScreen,
    sessionId,
    seatId: normalizedString(params.get("seatId")),
    shareCode: normalizedString(params.get("shareCode")),
    source: normalizedString(params.get("source"))
  };
}

export function buildAdminRouteQuery(route = {}) {
  const params = new URLSearchParams();
  const activeView = ["catalog", "miniapp", "moderation", "content-security"].includes(route.activeView)
    ? route.activeView
    : "catalog";
  params.set("view", activeView);

  if (activeView === "catalog") {
    params.set("catalogTab", normalizeCatalogTab(route.catalogTab));
  } else if (activeView === "miniapp") {
    const sessionId = normalizedString(route.sessionId);
    const miniScreen = normalizeMiniScreen(route.miniScreen, sessionId);
    params.set("screen", miniScreen);
    if (sessionBackedMiniScreens.has(miniScreen) && sessionId) {
      params.set("sessionId", sessionId);
      for (const key of ["seatId", "shareCode", "source"]) {
        const value = normalizedString(route[key]);
        if (value) {
          params.set(key, value);
        }
      }
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function writeAdminRoute(route, options = {}) {
  if (typeof window === "undefined" || !window.history) {
    return;
  }
  const pathname = options.pathname || window.location.pathname;
  const hash = options.hash === undefined ? window.location.hash : options.hash;
  const query = buildAdminRouteQuery(route);
  const nextUrl = `${pathname}${query}${hash || ""}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) {
    return;
  }
  const method = options.replace ? "replaceState" : "pushState";
  window.history[method]({}, "", nextUrl);
}
