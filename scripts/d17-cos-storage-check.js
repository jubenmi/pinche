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
const miniprogramPackageJson = JSON.parse(read("apps/miniprogram/package.json"));
assert(
  miniprogramPackageJson.dependencies["cos-wx-sdk-v5"],
  "miniprogram must install the Tencent COS WeChat SDK"
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
assert(!envExample.includes("COS_SECRET_KEY=replace-with-production"), "dev env example must not fake a COS secret");

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
assert.equal(
  cosUploadPathForKey("uploads/session-album/display/album-1-2-3-aaaaaaaaaaaaaaaa.jpg"),
  "/uploads/session-album/display/album-1-2-3-aaaaaaaaaaaaaaaa.jpg",
  "album display object keys should map back to upload paths"
);
assert.throws(
  () => cosUploadPathForKey("uploads/session-album/album-1-2-3-aaaaaaaaaaaaaaaa.png"),
  /invalid COS object key/,
  "new album objects should use the display JPG prefix"
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

const avatarWebpPicOperations = JSON.stringify({
  is_pic_info: 1,
  rules: [
    {
      bucket: "pinche-app-1251022382",
      fileid: "/uploads/avatars/user-1-abc.webp",
      rule: "imageMogr2/auto-orient/thumbnail/512x512>/format/webp/quality/80"
    }
  ]
});
const avatarWebpAuthorization = buildCosAuthorization({
  method: "PUT",
  key: "uploads/avatars/user-1-abc-source.jpg",
  headers: {
    date: "Tue, 01 Jan 2030 00:00:00 GMT",
    host: "pinche-app-1251022382.cos.ap-nanjing.myqcloud.com",
    "pic-operations": avatarWebpPicOperations
  },
  nowSeconds: 1893456000,
  expiresInSeconds: 600,
  config: cosConfig
});
assert.equal(
  avatarWebpAuthorization,
  "q-sign-algorithm=sha1&q-ak=test-secret-id&q-sign-time=1893456000;1893456600&q-key-time=1893456000;1893456600&q-header-list=date;host;pic-operations&q-url-param-list=&q-signature=93d4d07fbf0de56c46f1387a0402d67eb8d767b1",
  "COS Authorization must sign Pic-Operations for CI avatar WebP processing"
);

const cosStorage = read("apps/api/src/storage/cos.js");
assert(cosStorage.includes("picOperations"), "COS storage must accept Pic-Operations");
assert(cosStorage.includes('"pic-operations"'), "COS storage must send signed Pic-Operations header");

const server = read("apps/api/src/server.js");
assert(server.includes("putCosObject"), "server must upload avatar and review photo bytes to COS");
assert(server.includes("getCosObject"), "server must serve uploaded files from COS when enabled");
assert(server.includes("cosStorageEnabled(config.cos)"), "server must keep local upload fallback when COS is disabled");
assert(server.includes("/api/uploads/cos-intent"), "server must issue direct COS upload intents");
assert(server.includes("/api/uploads/cos-authorization"), "server must sign direct COS SDK upload requests");
assert(server.includes("createCosDirectUploadIntent"), "server must create direct COS object keys");
assert(server.includes("authorizeCosDirectUpload"), "server must validate and sign direct COS uploads");
assert(server.includes("AVATAR_WEBP_RULE"), "server must define the avatar WebP CI rule");
assert(server.includes(".webp"), "avatar uploads must generate WebP object names when COS is enabled");
assert(
  server.includes("picOperations") && server.includes("imageMogr2/auto-orient/thumbnail/512x512>/format/webp/quality/80"),
  "server must request upload-time CI WebP processing for COS avatars"
);
assert(
  server.includes("SESSION_ALBUM_DISPLAY_JPG_RULE") &&
    server.includes("imageMogr2/auto-orient/thumbnail/2048x2048>/format/jpg/quality/85/strip"),
  "server must request upload-time CI JPG processing for album display photos"
);
assert(
  server.includes("bucket: config.cos.bucket"),
  "avatar upload-time CI processing must include the target COS bucket"
);

const imagePolicy = read("docs/image-processing-policy.md");
assert(imagePolicy.includes("头像") && imagePolicy.includes("WebP"), "image policy must document avatar WebP storage");
assert(imagePolicy.includes("512x512") && imagePolicy.includes("quality/80"), "image policy must document avatar WebP limits");
assert(imagePolicy.includes("普通照片") && imagePolicy.includes("压缩 JPG"), "image policy must document normal photo JPG storage");
assert(imagePolicy.includes("会员照片") && imagePolicy.includes("原图"), "image policy must document member original photo storage");
assert(imagePolicy.includes("小程序直传 COS"), "image policy must document direct COS upload");

const miniprogramApi = read("apps/miniprogram/src/utils/api.js");
assert(
  miniprogramApi.includes('import COS from "cos-wx-sdk-v5/index.js"'),
  "miniprogram API must statically import the COS SDK source entry"
);
assert(
  !miniprogramApi.includes('import("cos-wx-sdk-v5/index.js")'),
  "miniprogram API must not dynamically import the COS SDK source entry"
);
assert(
  !miniprogramApi.includes('require("cos-wx-sdk-v5/index.js")'),
  "miniprogram API must not leave a runtime COS SDK require"
);
assert(miniprogramApi.includes("getCosClient"), "miniprogram API must create a COS SDK client");
assert(miniprogramApi.includes("/api/uploads/cos-intent"), "miniprogram API must request direct upload intents");
assert(miniprogramApi.includes("/api/uploads/cos-authorization"), "miniprogram API must request backend COS signatures");
assert(miniprogramApi.includes(".putObject("), "miniprogram API must upload files directly to COS with putObject");
assert(miniprogramApi.includes("PicOperations"), "avatar direct uploads must pass CI PicOperations to COS");
const cosBackedUploadBody = miniprogramApi.match(
  /async function uploadCosBackedFile\(\{[\s\S]*?recovery\s*=\s*null[\s\S]*?\}\) \{[\s\S]*?\n\}/
)?.[0] || "";
assert(
  cosBackedUploadBody.includes("try {") &&
    cosBackedUploadBody.includes("await uploadCosObject(upload, filePath)") &&
    cosBackedUploadBody.includes("catch (error)") &&
    cosBackedUploadBody.includes("return fallbackUpload(filePath, recovery);"),
  "COS direct upload failures must fall back to backend upload before profile saves fail"
);

console.log("D17 COS storage check passed");
