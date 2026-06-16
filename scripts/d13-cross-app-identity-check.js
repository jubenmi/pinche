import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("scripts/d13-cross-app-identity-check.js"),
  "root check should run d13 cross-app identity check"
);

const envExample = read(".env.example");
const prodEnvExample = read(".env.production.example");
for (const [label, source] of [
  [".env.example", envExample],
  [".env.production.example", prodEnvExample]
]) {
  assert(
    source.includes("BOOTSTRAP_ADMIN_OPENIDS="),
    `${label} must preserve BOOTSTRAP_ADMIN_OPENIDS`
  );
  assert(
    source.includes("BOOTSTRAP_ADMIN_UNIONIDS="),
    `${label} must document BOOTSTRAP_ADMIN_UNIONIDS`
  );
}

const envConfig = read("apps/api/src/config/env.js");
assert(
  envConfig.includes('bootstrapAdminOpenids: listEnv("BOOTSTRAP_ADMIN_OPENIDS")'),
  "API config must preserve bootstrapAdminOpenids"
);
assert(
  envConfig.includes('bootstrapAdminUnionids: listEnv("BOOTSTRAP_ADMIN_UNIONIDS")'),
  "API config must expose bootstrapAdminUnionids"
);

const migrationPath = "apps/api/migrations/0009_wechat_identities.sql";
assert(exists(migrationPath), "0009 migration must create wechat_identities");
const migration = exists(migrationPath) ? read(migrationPath) : "";
for (const token of [
  "CREATE TABLE IF NOT EXISTS wechat_identities",
  "user_id BIGINT UNSIGNED NOT NULL",
  "app_id VARCHAR(128) NOT NULL",
  "open_id VARCHAR(128) NOT NULL",
  "union_id VARCHAR(128) NULL",
  "UNIQUE KEY uniq_wechat_identity_app_open (app_id, open_id)",
  "INDEX idx_wechat_identities_union_id (union_id)",
  "FOREIGN KEY (user_id) REFERENCES users(id)"
]) {
  assert(migration.includes(token), `wechat identities migration must include: ${token}`);
}

const usersModule = read("apps/api/src/modules/auth/users.js");
assert(
  usersModule.includes("bootstrapAdminUnionids"),
  "upsertWechatUser must accept bootstrapAdminUnionids"
);
assert(
  usersModule.includes("wechat_identities"),
  "WeChat login must upsert wechat_identities"
);
assert(
  usersModule.includes("WHERE wechat_identities.app_id = ?") &&
    usersModule.includes("AND wechat_identities.open_id = ?"),
  "WeChat login must first look up identities by app_id and open_id"
);
assert(
  usersModule.includes("SELECT * FROM users WHERE union_id = ? ORDER BY id LIMIT 1"),
  "WeChat login must reuse an existing user by unionid when no app openid match exists"
);
assert(
  usersModule.includes("identity.appId"),
  "WeChat identity upsert must record appId"
);
assert(
  usersModule.includes("user_id = VALUES(user_id)") &&
    usersModule.includes("union_id = COALESCE(VALUES(union_id), union_id)"),
  "WeChat identity upsert must keep app/openid linked to the selected business user"
);
assert(
  usersModule.includes("bootstrapAdminOpenids.includes(normalizedIdentity.openid)") &&
    usersModule.includes("bootstrapAdminUnionids.includes(normalizedIdentity.unionid)"),
  "admin bootstrap must check both openid and unionid"
);

const wechatModule = read("apps/api/src/modules/auth/wechat.js");
assert(
  wechatModule.includes("appId: config.wechat.appId"),
  "login identity must carry appId from config.wechat.appId"
);
assert(
  wechatModule.includes("config.bootstrapAdminUnionids"),
  "login flow must pass bootstrapAdminUnionids to upsertWechatUser"
);
assert(
  wechatModule.includes("unionid: identity.unionid || user.unionid"),
  "business token must include unionid when available"
);
assert(
  wechatModule.includes("unionid: identity.unionid,"),
  "login response must keep returning unionid"
);

const mysql = read("apps/api/src/db/mysql.js");
assert(
  mysql.includes('"wechat_identities"'),
  "database readiness should include wechat_identities"
);

console.log("d13 cross-app identity checks passed");
