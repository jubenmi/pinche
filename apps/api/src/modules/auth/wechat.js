import crypto from "node:crypto";
import https from "node:https";
import { config } from "../../config/env.js";
import { createDatabaseConnection } from "../../db/mysql.js";
import { unauthorized } from "../../http/errors.js";
import {
  getUserWithRolesById,
  upsertWechatUser
} from "./users.js";

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function sign(payload) {
  return base64Url(
    crypto.createHmac("sha256", config.sessionSecret).update(payload).digest()
  );
}

function decodeBase64Url(value) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Buffer.from(
    padded.replaceAll("-", "+").replaceAll("_", "/"),
    "base64"
  ).toString("utf8");
}

function tokenFor(payload) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify(payload));
  const signature = sign(`${header}.${body}`);
  return `${header}.${body}.${signature}`;
}

export function issueBusinessToken(user, roles, identity = {}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 60 * 60 * 24 * 7;
  const token = tokenFor({
    sub: user.id,
    openid: identity.openid || user.openid || user.open_id,
    unionid: identity.unionid || user.unionid || user.union_id || undefined,
    roles,
    iat: issuedAt,
    exp: expiresAt
  });

  return { token, expiresAt };
}

function mockOpenidFromCode(code) {
  if (code.startsWith("dev-")) {
    return code;
  }

  const hash = crypto.createHash("sha256").update(code).digest("hex").slice(0, 16);
  return `mock_openid_${hash}`;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = https
      .get(url, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
    request.setTimeout(5000, () => {
      request.destroy();
      const error = new Error("WeChat login service timed out");
      error.code = "WECHAT_UPSTREAM_TIMEOUT";
      reject(error);
    });
  });
}

async function exchangeCodeForOpenid(code) {
  if (config.wechat.mockLogin) {
    return {
      openid: mockOpenidFromCode(code),
      unionid: null,
      sessionKey: null,
      mocked: true
    };
  }

  if (!config.wechat.appId || !config.wechat.appSecret) {
    const error = new Error("WECHAT_APP_ID and WECHAT_APP_SECRET are required");
    error.code = "WECHAT_CONFIG_MISSING";
    throw error;
  }

  const params = new URLSearchParams({
    appid: config.wechat.appId,
    secret: config.wechat.appSecret,
    js_code: code,
    grant_type: "authorization_code"
  });
  const response = await getJson(
    `https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`
  );

  if (!response.openid) {
    const error = new Error(response.errmsg || "WeChat login failed");
    error.code = "WECHAT_LOGIN_FAILED";
    error.details = response;
    throw error;
  }

  return {
    openid: response.openid,
    unionid: response.unionid || null,
    sessionKey: response.session_key || null,
    mocked: false
  };
}

export async function loginWithWechatCode(code) {
  if (!code || typeof code !== "string") {
    const error = new Error("code is required");
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  const identity = {
    ...(await exchangeCodeForOpenid(code)),
    appId: config.wechat.appId
  };
  const connection = await createDatabaseConnection();
  let user;
  let roles;

  try {
    await connection.beginTransaction();
    const result = await upsertWechatUser(
      connection,
      identity,
      config.bootstrapAdminOpenids,
      config.bootstrapAdminUnionids
    );
    await connection.commit();
    user = result.user;
    roles = result.roles;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }

  const issued = issueBusinessToken(user, roles, {
    openid: identity.openid,
    unionid: identity.unionid
  });

  return {
    user,
    openid: identity.openid,
    unionid: identity.unionid,
    roles,
    token: issued.token,
    expiresAt: issued.expiresAt,
    mocked: identity.mocked
  };
}

export async function verifyBusinessToken(token) {
  if (!token || typeof token !== "string") {
    throw unauthorized();
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw unauthorized("Invalid token");
  }

  const [header, body, signature] = parts;
  if (sign(`${header}.${body}`) !== signature) {
    throw unauthorized("Invalid token signature");
  }

  let payload;
  try {
    payload = JSON.parse(decodeBase64Url(body));
  } catch (error) {
    throw unauthorized("Invalid token payload");
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) {
    throw unauthorized("Token expired");
  }

  const result = await getUserWithRolesById(payload.sub);
  if (!result) {
    throw unauthorized("User no longer exists");
  }

  return result;
}
