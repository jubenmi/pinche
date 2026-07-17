const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
export const D45_SMOKE_MARKER = "d45-session-reschedule-notifications";

export function assertD45SmokeClientSafety(env = {}) {
  const baseUrl = new URL(env.BASE_URL || "http://127.0.0.1:3029");
  if (baseUrl.protocol !== "http:" || !LOOPBACK_HOSTS.has(baseUrl.hostname)) {
    throw new Error(`D45 smoke safety rejected non-local BASE_URL before fetch: ${baseUrl.origin}`);
  }
  if (env.WECHAT_SUBSCRIBE_MESSAGE_ENABLED !== "false") {
    throw new Error("D45 smoke safety requires WECHAT_SUBSCRIBE_MESSAGE_ENABLED=false before fetch");
  }
  return baseUrl;
}

export async function verifyD45SmokePreflight({ env = {}, fetchImpl = fetch } = {}) {
  const baseUrl = assertD45SmokeClientSafety(env);
  const response = await fetchImpl(new URL("/api/testing/d45-smoke-target", baseUrl), {
    method: "GET",
    signal: AbortSignal.timeout(10_000)
  });
  const body = await response.text();
  let payload;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
    throw new Error(`D45 smoke preflight returned non-JSON ${response.status}: ${body.slice(0, 500)}`);
  }
  if (!response.ok) {
    throw new Error(`D45 smoke preflight failed ${response.status}: ${body.slice(0, 500)}`);
  }
  const target = payload?.data;
  if (
    target?.marker !== D45_SMOKE_MARKER ||
    target?.isolated !== true ||
    target?.wechat_mock_login !== true ||
    target?.database !== "pinche_d45_test"
  ) {
    throw new Error(`D45 smoke preflight rejected target identity: ${body.slice(0, 500)}`);
  }
  return { baseUrl, target };
}
