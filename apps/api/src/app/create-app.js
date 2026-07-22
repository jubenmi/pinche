import http from "node:http";

import { readBody } from "../http/body.js";
import { notFound } from "../http/errors.js";
import { createRequestContext } from "../http/request-context.js";
import { logRequest } from "../http/request-log.js";
import { applyDefaultSecurityHeaders, errorResponse, jsonResponse } from "../http/response.js";
import { createRouter } from "../http/router.js";
import {
  legacyRoute as defaultLegacyRoute,
  normalizeError as defaultNormalizeError,
  recordLegacyRouteError,
  routeLegacyExtensions as defaultExtensionRoute,
} from "../legacy-app.js";
import { createDependencies } from "./create-dependencies.js";

function registerFoundationRoutes(router) {
  router.register({
    method: "GET",
    path: "/health",
    name: "health.service",
    body: { kind: "none" },
    auth: "none",
    async handler({ response, dependencies }) {
      const database = await dependencies.checkDatabaseReadiness();
      jsonResponse(response, database.ok ? 200 : 503, {
        ok: database.ok,
        service: "pinche-api",
        capabilities: dependencies.publicConfig(),
        database: {
          connected: database.connected === true,
          schemaReady: database.schemaReady === true,
        },
        now: dependencies.clock.date().toISOString(),
      });
    },
  });
  router.register({
    method: "GET",
    path: "/health/db",
    name: "health.database",
    body: { kind: "none" },
    auth: "none",
    async handler({ response, dependencies }) {
      const database = await dependencies.checkDatabaseReadiness();
      jsonResponse(response, database.ok ? 200 : 503, {
        ok: database.ok,
        connected: database.connected === true,
        schemaReady: database.schemaReady === true,
      });
    },
  });
  router.register({
    method: "POST",
    path: "/api/d51/body-boundary-probe",
    name: "d51.body-boundary-probe",
    body: { kind: "json" },
    auth: "none",
    handler() {
      throw notFound();
    },
  });
}

function createApplicationRouter(moduleRouters = []) {
  const router = createRouter();
  registerFoundationRoutes(router);
  for (const moduleRouter of moduleRouters) router.mount(moduleRouter);
  return router;
}

export function createApp(options = {}) {
  const dependencies = createDependencies({
    ...(options.dependencies || {}),
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.checkDatabaseReadiness ? { checkDatabaseReadiness: options.checkDatabaseReadiness } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.rateLimiter ? { rateLimiter: options.rateLimiter } : {}),
  });
  const router = createApplicationRouter(options.moduleRouters);
  const extensionRoute = options.extensionRoute || defaultExtensionRoute;
  const legacyRoute = options.legacyRoute || defaultLegacyRoute;
  const normalizeError = options.normalizeError || defaultNormalizeError;

  const server = http.createServer((request, response) => {
    const requestContext = createRequestContext(request);
    response.setHeader("x-request-id", requestContext.requestId);
    applyDefaultSecurityHeaders(response);
    let logged = false;
    const logOnce = () => {
      if (logged) return;
      logged = true;
      logRequest({ request, response, context: requestContext, logger: dependencies.logger });
    };
    response.once("finish", logOnce);
    response.once("close", logOnce);

    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const legacyOptions = {
      ...options,
      auth: dependencies.auth,
      checkDatabaseReadiness: dependencies.checkDatabaseReadiness,
      rateLimiter: dependencies.rateLimiter,
      requestContext,
    };
    const context = { request, response, url, dependencies, options: legacyOptions, requestContext };

    (async () => {
      const matched = router.match(request.method, url.pathname);
      if (matched) {
        const body = await readBody(request, matched.route.body);
        await matched.route.handler({ ...context, body, params: matched.params, route: matched.route });
        return;
      }
      if (await extensionRoute(context)) return;
      if (await legacyRoute(context)) return;
      if (response.writableEnded || response.headersSent || response.destroyed) return;
      errorResponse(response, 404, "NOT_FOUND", "Route not found");
    })().catch((error) => {
      recordLegacyRouteError(error);
      const normalized = normalizeError(error);
      if (response.destroyed || response.writableEnded) return;
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (normalized.retryAfter) response.setHeader("retry-after", String(normalized.retryAfter));
      if (normalized.code === "PAYLOAD_TOO_LARGE") response.setHeader("connection", "close");
      errorResponse(
        response,
        normalized.statusCode,
        normalized.code,
        normalized.message,
        normalized.details,
      );
    });
  });

  const timeouts = {
    headersTimeoutMs: 15_000,
    requestTimeoutMs: 30_000,
    keepAliveTimeoutMs: 5_000,
    ...options.timeouts,
  };
  server.headersTimeout = timeouts.headersTimeoutMs;
  server.requestTimeout = timeouts.requestTimeoutMs;
  server.keepAliveTimeout = timeouts.keepAliveTimeoutMs;
  server.setTimeout(timeouts.requestTimeoutMs, (socket) => socket.destroy());
  return server;
}
