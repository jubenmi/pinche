import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../..");

function loadDotEnv() {
  const envPath = path.join(repoRoot, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

function booleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function integerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function listEnv(name) {
  const raw = process.env[name] ?? "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: integerEnv("PORT", 3018),
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:3018",
  mysql: {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: integerEnv("MYSQL_PORT", 3307),
    database: process.env.MYSQL_DATABASE || "pinche",
    user: process.env.MYSQL_USER || "pinche",
    password: process.env.MYSQL_PASSWORD || "pinche_dev_password"
  },
  redis: {
    enabled: booleanEnv("REDIS_ENABLED", false),
    url: process.env.REDIS_URL || "redis://127.0.0.1:6379"
  },
  cos: {
    enabled: booleanEnv("COS_ENABLED", false),
    secretId: process.env.COS_SECRET_ID || "",
    secretKey: process.env.COS_SECRET_KEY || "",
    bucket: process.env.COS_BUCKET || "",
    region: process.env.COS_REGION || ""
  },
  wechat: {
    mockLogin: booleanEnv("WECHAT_MOCK_LOGIN", true),
    appId: process.env.WECHAT_APP_ID || "wx-placeholder",
    appSecret: process.env.WECHAT_APP_SECRET || ""
  },
  sessionSecret:
    process.env.SESSION_SECRET ||
    "local-development-session-secret-change-before-production",
  bootstrapAdminOpenids: listEnv("BOOTSTRAP_ADMIN_OPENIDS"),
  bootstrapAdminUnionids: listEnv("BOOTSTRAP_ADMIN_UNIONIDS")
};

export function publicConfig() {
  return {
    nodeEnv: config.nodeEnv,
    port: config.port,
    redisEnabled: config.redis.enabled,
    wechatMockLogin: config.wechat.mockLogin
  };
}
