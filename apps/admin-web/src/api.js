const TOKEN_KEY = "pinche_admin_web_token";
const USER_KEY = "pinche_admin_web_user";
const ROLES_KEY = "pinche_admin_web_roles";

function readJsonStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (error) {
    return fallback;
  }
}

export function getStoredAuth() {
  return {
    token: localStorage.getItem(TOKEN_KEY) || "",
    user: readJsonStorage(USER_KEY, null),
    roles: readJsonStorage(ROLES_KEY, [])
  };
}

export function setStoredAuth(auth) {
  localStorage.setItem(TOKEN_KEY, auth.token || "");
  localStorage.setItem(USER_KEY, JSON.stringify(auth.user || null));
  localStorage.setItem(ROLES_KEY, JSON.stringify(auth.roles || []));
}

export function clearStoredAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ROLES_KEY);
}

async function parseResponse(response) {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error?.message || `Request failed: ${response.status}`);
    error.status = response.status;
    error.code = payload?.error?.code || "REQUEST_FAILED";
    error.details = payload?.error?.details;
    throw error;
  }
  return payload?.data;
}

export async function apiRequest(path, options = {}) {
  const auth = getStoredAuth();
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  return parseResponse(response);
}

export function createLoginTicket() {
  return apiRequest("/api/admin/web-login/tickets", {
    method: "POST",
    body: { userAgent: navigator.userAgent }
  });
}

export function pollLoginTicket(ticket) {
  return apiRequest(
    `/api/admin/web-login/tickets/${ticket.ticketId}?secret=${encodeURIComponent(
      ticket.ticketSecret
    )}`
  );
}

export function listStores(filters) {
  return apiRequest(`/api/admin/stores?${new URLSearchParams(filters)}`);
}

export function saveStore(store) {
  const method = store.id ? "PATCH" : "POST";
  const path = store.id ? `/api/admin/stores/${store.id}` : "/api/admin/stores";
  return apiRequest(path, { method, body: store });
}

export function deleteStore(id) {
  return apiRequest(`/api/admin/stores/${id}`, { method: "DELETE" });
}

export function listStoreScripts(storeId) {
  return apiRequest(`/api/admin/stores/${storeId}/scripts`);
}

export function saveStoreScripts(storeId, scriptIds) {
  return apiRequest(`/api/admin/stores/${storeId}/scripts`, {
    method: "PUT",
    body: { scriptIds }
  });
}

export function listScripts(filters) {
  return apiRequest(`/api/admin/scripts?${new URLSearchParams(filters)}`);
}

export function saveScript(script) {
  const method = script.id ? "PATCH" : "POST";
  const path = script.id ? `/api/admin/scripts/${script.id}` : "/api/admin/scripts";
  return apiRequest(path, { method, body: script });
}

export function deleteScript(id) {
  return apiRequest(`/api/admin/scripts/${id}`, { method: "DELETE" });
}
