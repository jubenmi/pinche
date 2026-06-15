import http from "node:http";
import { config, publicConfig } from "./config/env.js";
import { checkDatabaseReadiness } from "./db/mysql.js";
import { AppError, badRequest, forbidden, unauthorized } from "./http/errors.js";
import { updateUserGender, updateUserPhone } from "./modules/auth/users.js";
import {
  approveAdminWebLoginTicket,
  createAdminWebLoginTicket,
  pollAdminWebLoginTicket
} from "./modules/auth/admin-web-login.js";
import {
  loginWithWechatCode,
  verifyBusinessToken
} from "./modules/auth/wechat.js";
import { routeExtensions } from "./modules/extensions/registry.js";
import {
  approveSignup,
  cancelSession,
  claimSessionSeat,
  createCatalogRequest,
  createEntityClaim,
  createScript,
  createSeat,
  createSession,
  createShareEvent,
  createSignup,
  createStore,
  createSubscriptionRequest,
  deleteScript,
  deleteStore,
  getSession,
  getSessionShareStats,
  kickSessionSeat,
  listAdminScripts,
  listAdminStores,
  listActiveScripts,
  listActiveStores,
  listCatalogRequests,
  listMySignups,
  listMySessions,
  listSessionSignups,
  listStoreScripts,
  lockSeat,
  publishSession,
  rejectSignup,
  replaceStoreScripts,
  reviewCatalogRequest,
  updateDeposit,
  updateScript,
  updateSeat,
  updateSession,
  updateStore,
  upsertPerformerProfile
} from "./modules/core/service.js";

function jsonResponse(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function errorResponse(response, statusCode, code, message, details) {
  jsonResponse(response, statusCode, {
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  });
}

function normalizeError(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (error?.code === "ER_DUP_ENTRY") {
    return new AppError(409, "CONFLICT", "Duplicate resource", error.sqlMessage);
  }

  return new AppError(500, "INTERNAL_ERROR", error.message);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const body = Buffer.concat(chunks).toString("utf8");
  if (!body.trim()) {
    return {};
  }

  return JSON.parse(body);
}

function isBodyMethod(method) {
  return ["POST", "PATCH", "PUT"].includes(method);
}

async function bodyFor(request) {
  if (!isBodyMethod(request.method)) {
    return {};
  }

  try {
    return await readJsonBody(request);
  } catch (error) {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

function idMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? Number(match[1]) : null;
}

async function getAuthUser(request) {
  const header = request.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw unauthorized();
  }
  return verifyBusinessToken(match[1]);
}

async function optionalAuthUser(request) {
  try {
    return await getAuthUser(request);
  } catch (error) {
    return null;
  }
}

function requireRole(user, role) {
  if (!user.roles.includes(role)) {
    throw forbidden(`${role} role required`);
  }
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const body = await bodyFor(request);

  if (request.method === "GET" && url.pathname === "/health") {
    const database = await checkDatabaseReadiness();
    jsonResponse(response, database.ok ? 200 : 503, {
      ok: database.ok,
      service: "pinche-api",
      config: publicConfig(),
      database,
      now: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/health/db") {
    const database = await checkDatabaseReadiness();
    jsonResponse(response, database.ok ? 200 : 503, {
      ok: database.ok,
      database: config.mysql.database,
      connected: database.connected,
      schemaReady: database.schemaReady,
      missingTables: database.missingTables,
      ...(database.error ? { error: database.error } : {})
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/wechat/login") {
    const result = await loginWithWechatCode(body.code);
    jsonResponse(response, 200, {
      ok: true,
      data: result
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/web-login/tickets") {
    jsonResponse(response, 201, {
      ok: true,
      data: await createAdminWebLoginTicket({
        userAgent: request.headers["user-agent"] || body.userAgent
      })
    });
    return;
  }

  const adminWebLoginTicketId = url.pathname.match(
    /^\/api\/admin\/web-login\/tickets\/([^/]+)$/
  )?.[1];
  if (request.method === "GET" && adminWebLoginTicketId) {
    jsonResponse(response, 200, {
      ok: true,
      data: await pollAdminWebLoginTicket(
        adminWebLoginTicketId,
        url.searchParams.get("secret")
      )
    });
    return;
  }

  const adminWebLoginApproveId = url.pathname.match(
    /^\/api\/admin\/web-login\/tickets\/([^/]+)\/approve$/
  )?.[1];
  if (request.method === "POST" && adminWebLoginApproveId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await approveAdminWebLoginTicket(user, adminWebLoginApproveId, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/wechat/phone") {
    const user = await getAuthUser(request);
    const phoneEncrypted = body.phoneEncrypted || body.phone;
    if (!phoneEncrypted) {
      throw badRequest("phoneEncrypted is required");
    }
    const updated = await updateUserPhone(user.user.id, phoneEncrypted);
    jsonResponse(response, 200, { ok: true, data: updated });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/users/me") {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, { ok: true, data: user });
    return;
  }

  if (request.method === "PATCH" && url.pathname === "/api/users/me") {
    const user = await getAuthUser(request);
    const updatedUser = await updateUserGender(user.user.id, body.gender);
    jsonResponse(response, 200, {
      ok: true,
      data: {
        user: updatedUser,
        roles: user.roles
      }
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/stores") {
    jsonResponse(response, 200, {
      ok: true,
      data: await listActiveStores(Object.fromEntries(url.searchParams))
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/scripts") {
    jsonResponse(response, 200, {
      ok: true,
      data: await listActiveScripts(Object.fromEntries(url.searchParams))
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/stores") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listAdminStores(Object.fromEntries(url.searchParams))
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/stores") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 201, { ok: true, data: await createStore(user, body) });
    return;
  }

  const adminStoreScriptsId = idMatch(url.pathname, /^\/api\/admin\/stores\/(\d+)\/scripts$/);
  if (request.method === "GET" && adminStoreScriptsId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listStoreScripts(adminStoreScriptsId)
    });
    return;
  }

  if (request.method === "PUT" && adminStoreScriptsId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await replaceStoreScripts(adminStoreScriptsId, body)
    });
    return;
  }

  const adminStoreId = idMatch(url.pathname, /^\/api\/admin\/stores\/(\d+)$/);
  if (request.method === "PATCH" && adminStoreId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, { ok: true, data: await updateStore(adminStoreId, body) });
    return;
  }

  if (request.method === "DELETE" && adminStoreId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, { ok: true, data: await deleteStore(adminStoreId) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/scripts") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 201, { ok: true, data: await createScript(user, body) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/scripts") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listAdminScripts(Object.fromEntries(url.searchParams))
    });
    return;
  }

  const adminScriptId = idMatch(url.pathname, /^\/api\/admin\/scripts\/(\d+)$/);
  if (request.method === "PATCH" && adminScriptId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await updateScript(adminScriptId, body)
    });
    return;
  }

  if (request.method === "DELETE" && adminScriptId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await deleteScript(adminScriptId)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/catalog-requests") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listCatalogRequests(Object.fromEntries(url.searchParams))
    });
    return;
  }

  const adminCatalogRequestId = idMatch(
    url.pathname,
    /^\/api\/admin\/catalog-requests\/(\d+)$/
  );
  if (request.method === "PATCH" && adminCatalogRequestId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await reviewCatalogRequest(user, adminCatalogRequestId, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/catalog-requests") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createCatalogRequest(user, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/performer-profiles") {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await upsertPerformerProfile(user, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/entity-claims") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createEntityClaim(user, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, { ok: true, data: await createSession(user, body) });
    return;
  }

  const sessionId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)$/);
  if (request.method === "GET" && sessionId) {
    jsonResponse(response, 200, { ok: true, data: await getSession(sessionId) });
    return;
  }
  if (request.method === "PATCH" && sessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await updateSession(user, sessionId, body)
    });
    return;
  }

  if (
    await routeExtensions({
      body,
      getAuthUser,
      idMatch,
      jsonResponse,
      request,
      response,
      url
    })
  ) {
    return;
  }

  const cancelSessionId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/cancel$/);
  if (request.method === "PATCH" && cancelSessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await cancelSession(user, cancelSessionId, body)
    });
    return;
  }

  const shareStatsSessionId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/share-stats$/
  );
  if (request.method === "GET" && shareStatsSessionId) {
    jsonResponse(response, 200, {
      ok: true,
      data: await getSessionShareStats(shareStatsSessionId)
    });
    return;
  }

  const publishSessionId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/publish$/);
  if (request.method === "POST" && publishSessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await publishSession(user, publishSessionId)
    });
    return;
  }

  const sessionSeatSessionId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/seats$/
  );
  if (request.method === "POST" && sessionSeatSessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createSeat(user, sessionSeatSessionId, body)
    });
    return;
  }

  const seatId = idMatch(url.pathname, /^\/api\/session-seats\/(\d+)$/);
  if (request.method === "PATCH" && seatId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, { ok: true, data: await updateSeat(user, seatId, body) });
    return;
  }

  const lockSeatId = idMatch(url.pathname, /^\/api\/session-seats\/(\d+)\/lock$/);
  if (request.method === "POST" && lockSeatId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, { ok: true, data: await lockSeat(user, lockSeatId) });
    return;
  }

  const claimSeatId = idMatch(url.pathname, /^\/api\/session-seats\/(\d+)\/claim$/);
  if (request.method === "POST" && claimSeatId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await claimSessionSeat(user, claimSeatId, body)
    });
    return;
  }

  const kickSeatId = idMatch(url.pathname, /^\/api\/session-seats\/(\d+)\/kick$/);
  if (request.method === "PATCH" && kickSeatId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await kickSessionSeat(user, kickSeatId, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/signups") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, { ok: true, data: await createSignup(user, body) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/users/me/signups") {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, { ok: true, data: await listMySignups(user) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/users/me/sessions") {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await listMySessions(user, Object.fromEntries(url.searchParams))
    });
    return;
  }

  const sessionSignupsId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/signups$/);
  if (request.method === "GET" && sessionSignupsId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await listSessionSignups(user, sessionSignupsId)
    });
    return;
  }

  const approveSignupId = idMatch(url.pathname, /^\/api\/signups\/(\d+)\/approve$/);
  if (request.method === "PATCH" && approveSignupId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await approveSignup(user, approveSignupId)
    });
    return;
  }

  const rejectSignupId = idMatch(url.pathname, /^\/api\/signups\/(\d+)\/reject$/);
  if (request.method === "PATCH" && rejectSignupId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await rejectSignup(user, rejectSignupId)
    });
    return;
  }

  const depositSignupId = idMatch(url.pathname, /^\/api\/signups\/(\d+)\/deposit$/);
  if (request.method === "PATCH" && depositSignupId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await updateDeposit(user, depositSignupId, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/share-events/view") {
    jsonResponse(response, 201, {
      ok: true,
      data: await createShareEvent("view", body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/share-events/convert") {
    const user = await optionalAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createShareEvent("convert", {
        ...body,
        viewedUserId: body.viewedUserId || user?.user.id || null
      })
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/subscriptions/request-result") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createSubscriptionRequest(user, body)
    });
    return;
  }

  errorResponse(response, 404, "NOT_FOUND", "Route not found");
}

export function createApp() {
  return http.createServer((request, response) => {
    route(request, response).catch((error) => {
      const normalized = normalizeError(error);
      errorResponse(
        response,
        normalized.statusCode,
        normalized.code,
        normalized.message,
        normalized.details
      );
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createApp();
  server.listen(config.port, () => {
    console.log(
      JSON.stringify({
        ok: true,
        service: "pinche-api",
        port: config.port,
        nodeEnv: config.nodeEnv
      })
    );
  });
}
