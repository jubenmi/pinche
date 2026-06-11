import crypto from "node:crypto";
import https from "node:https";
import { config } from "../../config/env.js";

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

function tokenFor(payload) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify(payload));
  const signature = sign(`${header}.${body}`);
  return `${header}.${body}.${signature}`;
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
    https
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

function rolesForOpenid(openid) {
  const roles = new Set(["player"]);
  if (config.bootstrapAdminOpenids.includes(openid)) {
    roles.add("system_admin");
  }
  return [...roles];
}

export async function loginWithWechatCode(code) {
  if (!code || typeof code !== "string") {
    const error = new Error("code is required");
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  const identity = await exchangeCodeForOpenid(code);
  const roles = rolesForOpenid(identity.openid);
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 60 * 60 * 24 * 7;
  const token = tokenFor({
    sub: identity.openid,
    roles,
    iat: issuedAt,
    exp: expiresAt
  });

  return {
    openid: identity.openid,
    unionid: identity.unionid,
    roles,
    token,
    expiresAt,
    mocked: identity.mocked
  };
}
