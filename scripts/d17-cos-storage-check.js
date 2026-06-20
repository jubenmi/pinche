import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildCosAuthorization,
  cosObjectKeyFromUploadPath,
  cosStorageEnabled,
  cosUploadPathForKey
} from "../apps/api/src/storage/cos.js";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("scripts/d17-cos-storage-check.js"),
  "root check should run d17 COS storage check"
);

const envSource = read("apps/api/src/config/env.js");
for (const token of [
  "cos:",
  "COS_ENABLED",
  "COS_SECRET_ID",
  "COS_SECRET_KEY",
  "COS_BUCKET",
  "COS_REGION"
]) {
  assert(envSource.includes(token), `API env config must include ${token}`);
}

const envExample = read(".env.example");
const prodEnvExample = read(".env.production.example");
for (const token of ["COS_ENABLED", "COS_BUCKET=pinche-app-1251022382", "COS_REGION=ap-nanjing"]) {
  assert(envExample.includes(token), `.env.example must document ${token}`);
  assert(prodEnvExample.includes(token), `.env.production.example must document ${token}`);
}
assert(
  !envExample.includes("COS_SECRET_KEY=replace-with-production"),
  "dev env example must not fake a COS secret"
);

const cosConfig = {
  enabled: true,
  secretId: "test-secret-id",
  secretKey: "test-secret-key",
  bucket: "pinche-app-1251022382",
  region: "ap-nanjing"
};

assert.equal(cosStorageEnabled(cosConfig), true, "complete COS config should enable COS storage");
assert.equal(
  cosStorageEnabled({ ...cosConfig, secretKey: "" }),
  false,
  "COS storage must stay disabled without a secret key"
);

assert.equal(
  cosObjectKeyFromUploadPath("/uploads/avatars/user-1-abc.jpg", "/uploads/avatars/"),
  "uploads/avatars/user-1-abc.jpg",
  "avatar upload paths should map to COS object keys"
);
assert.equal(
  cosUploadPathForKey("uploads/session-reviews/review-1-abc.png"),
  "/uploads/session-reviews/review-1-abc.png",
  "COS object keys should map back to existing upload paths"
);
assert.throws(
  () => cosObjectKeyFromUploadPath("/uploads/avatars/../secret.jpg", "/uploads/avatars/"),
  /invalid upload object name/,
  "COS object mapping must reject path traversal"
);

const authorization = buildCosAuthorization({
  method: "PUT",
  key: "uploads/avatars/user-1-abc.jpg",
  headers: {
    date: "Tue, 01 Jan 2030 00:00:00 GMT",
    host: "pinche-app-1251022382.cos.ap-nanjing.myqcloud.com"
  },
  nowSeconds: 1893456000,
  expiresInSeconds: 600,
  config: cosConfig
});
assert.equal(
  authorization,
  "q-sign-algorithm=sha1&q-ak=test-secret-id&q-sign-time=1893456000;1893456600&q-key-time=1893456000;1893456600&q-header-list=date;host&q-url-param-list=&q-signature=908b49d7389e5fa332962c9833bedec7d92da846",
  "COS Authorization must match the Tencent XML API signature algorithm"
);

const server = read("apps/api/src/server.js");
assert(server.includes("putCosObject"), "server must upload avatar and review photo bytes to COS");
assert(server.includes("getCosObject"), "server must serve uploaded files from COS when enabled");
assert(
  server.includes("cosStorageEnabled(config.cos)"),
  "server must keep local upload fallback when COS is disabled"
);
assert(
  server.includes("COS_STORAGE_ERROR"),
  "server must surface non-404 COS read failures as upstream storage errors"
);

console.log("D17 COS storage check passed");
