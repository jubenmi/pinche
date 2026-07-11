import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { executeAlbumCosUpload } from "../packages/shared/src/albumMedia.js";
import { attachSessionAlbumMediaUrls } from "../apps/api/src/server.js";
import { createAlbumMediaRefreshController } from "../apps/miniprogram/src/utils/albumMediaUrls.js";

const scope = process.argv.find((argument) => argument.startsWith("--scope="))?.split("=")[1] || "all";

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

if (["all", "operations"].includes(scope)) {
  const [productionCors, developmentCors, compose, liveContract] = await Promise.all([
    text("deploy/cos/cors.production.xml"),
    text("deploy/cos/cors.development.xml"),
    text("docker-compose.prod.example.yml"),
    text("scripts/d43-cos-live-contract-check.js")
  ]);
  assert.match(productionCors, /<AllowedOrigin>https:\/\/admin\.pinche\.jubenmi\.com<\/AllowedOrigin>/);
  for (const method of ["GET", "HEAD", "PUT"]) {
    assert.match(productionCors, new RegExp(`<AllowedMethod>${method}</AllowedMethod>`));
  }
  for (const header of [
    "authorization",
    "content-type",
    "content-length",
    "pic-operations",
    "x-cos-forbid-overwrite"
  ]) {
    assert.match(productionCors, new RegExp(`<AllowedHeader>${header}</AllowedHeader>`));
    assert.match(developmentCors, new RegExp(`<AllowedHeader>${header}</AllowedHeader>`));
  }
  assert.doesNotMatch(productionCors, /<AllowedOrigin>\*<\/AllowedOrigin>/);
  assert.doesNotMatch(developmentCors, /<AllowedOrigin>\*<\/AllowedOrigin>/);
  assert.match(developmentCors, /<AllowedOrigin>http:\/\/localhost:5173<\/AllowedOrigin>/);
  assert.match(developmentCors, /<AllowedOrigin>http:\/\/127\.0\.0\.1:5173<\/AllowedOrigin>/);
  assert.match(compose, /album-image-cleanup:[\s\S]*job:album-image-cleanup/);
  assert.equal((compose.match(/PINCHE_API_IMAGE/g) || []).length >= 3, true);
  assert.match(liveContract, /D43_COS_CONTRACT/);
  assert.match(liveContract, /forbidOverwrite:\s*true/);
  assert.match(liveContract, /getCosImageInfo/);
  assert.match(liveContract, /finally/);
  console.log("D43 operations contract passed");
}

if (scope === "all") {
  const [server, uploadService, miniAlbum, adminWorkspace, sharedProtocol, miniAdapter, adminAdapter] =
    await Promise.all([
      text("apps/api/src/server.js"),
      text("apps/api/src/modules/album-image/upload-service.js"),
      text("apps/miniprogram/src/pages/session/album.vue"),
      text("apps/admin-web/src/components/SessionAlbumWorkspace.vue"),
      text("packages/shared/src/albumMedia.js"),
      text("apps/miniprogram/src/utils/albumPhotoUpload.js"),
      text("apps/admin-web/src/albumMedia.js")
    ]);
  assert.match(server, /directUploadRequired/);
  assert.match(server, /\^\\\/api\\\/uploads\\\/\(\[0-9a-f-\]\{36\}\)\\\/status\$/);
  assert.match(server, /\^\\\/api\\\/uploads\\\/\(\[0-9a-f-\]\{36\}\)\\\/finalize\$/);
  const finalizeStart = uploadService.indexOf("async function finalize(");
  const finalizeEnd = uploadService.indexOf("async function finalizeLegacy", finalizeStart);
  assert.doesNotMatch(uploadService.slice(finalizeStart, finalizeEnd), /getCosObject\(/);
  assert.match(miniAlbum, /thumbnail_display_url/);
  assert.match(miniAlbum, /preview_display_url/);
  assert.match(miniAlbum, /download_url/);
  assert.match(adminWorkspace, /uploadAdminAlbumPhoto/);
  assert.match(adminWorkspace, /visibilitychange/);
  assert.match(sharedProtocol, /putAttempts < 3/);
  assert.match(sharedProtocol, /COS_UPLOAD_CONFLICT_UNRESOLVED/);
  assert.match(miniAdapter, /uploadMode === "api-local"/);
  assert.match(miniAdapter, /fallbackAllowed === true/);
  assert.match(adminAdapter, /uploadMode === "api-local"/);
  assert.match(adminAdapter, /fallbackAllowed === true/);

  let putAttempts = 0;
  await assert.rejects(executeAlbumCosUpload({
    putObject: async () => {
      putAttempts += 1;
      throw Object.assign(new Error("network"), { code: "COS_NETWORK_ERROR" });
    },
    getStatus: async () => ({ validationState: "missing", canFinalize: false }),
    finalize: async () => ({ photo: { id: 1 } }),
    refreshAuthorization: async () => {},
    sleep: async () => {},
    random: () => 0
  }));
  assert.equal(putAttempts, 3);

  let authRefreshes = 0;
  let signatureAttempts = 0;
  await executeAlbumCosUpload({
    putObject: async () => {
      signatureAttempts += 1;
      if (signatureAttempts === 1) {
        throw Object.assign(new Error("signature"), { code: "SignatureDoesNotMatch" });
      }
    },
    getStatus: async () => ({ validationState: "ready", canFinalize: true }),
    finalize: async () => ({ photo: { id: 1 } }),
    refreshAuthorization: async () => { authRefreshes += 1; },
    sleep: async () => {}
  });
  assert.equal(authRefreshes, 1);

  let reloads = 0;
  let album = {
    photos: [
      { id: 1, media_url_expires_at: "1970-01-01T00:20:00.000Z" },
      { id: 2, media_url_expires_at: "1970-01-01T00:20:00.000Z" }
    ]
  };
  const refresh = createAlbumMediaRefreshController({
    readAlbum: () => album,
    writeAlbum: (next) => { album = next; },
    reloadAlbum: async () => { reloads += 1; return album; },
    setTimer: () => 1,
    clearTimer: () => {},
    now: () => 1_200_000
  });
  await Promise.all([refresh.checkNow(), refresh.checkNow(), refresh.checkNow()]);
  assert.equal(reloads, 1);

  const attached = attachSessionAlbumMediaUrls({
    session_id: 8,
    photos: [{
      id: 7,
      media_type: "image",
      storage_object_key: null,
      storage_object_etag: "private"
    }]
  }, 9, {
    directMediaUrls: true,
    nowSeconds: 1000,
    cosConfig: {},
    emit: () => {}
  });
  assert.equal(attached.photos[0].media_url_expires_at, null);
  assert.match(attached.photos[0].preview_display_url, /^\/api\/session-album\/photos\/7\/image/);
  assert.equal("storage_object_key" in attached.photos[0], false);
  assert.equal("storage_object_etag" in attached.photos[0], false);
  console.log("D43 cross-app contract passed");
}
