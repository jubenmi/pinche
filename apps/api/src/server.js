import http from "node:http";
import { config, publicConfig } from "./config/env.js";
import { checkDatabaseConnection } from "./db/mysql.js";
import { loginWithWechatCode } from "./modules/auth/wechat.js";

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

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    jsonResponse(response, 200, {
      ok: true,
      service: "pinche-api",
      config: publicConfig(),
      now: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/health/db") {
    const connected = await checkDatabaseConnection();
    jsonResponse(response, connected ? 200 : 503, {
      ok: connected,
      database: config.mysql.database
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/wechat/login") {
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      errorResponse(response, 400, "INVALID_JSON", "Request body must be valid JSON");
      return;
    }

    try {
      const result = await loginWithWechatCode(body.code);
      jsonResponse(response, 200, {
        ok: true,
        data: result
      });
    } catch (error) {
      const statusCode = error.code === "VALIDATION_ERROR" ? 400 : 500;
      errorResponse(
        response,
        statusCode,
        error.code || "LOGIN_FAILED",
        error.message
      );
    }
    return;
  }

  errorResponse(response, 404, "NOT_FOUND", "Route not found");
}

export function createApp() {
  return http.createServer((request, response) => {
    route(request, response).catch((error) => {
      errorResponse(response, 500, "INTERNAL_ERROR", error.message);
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
