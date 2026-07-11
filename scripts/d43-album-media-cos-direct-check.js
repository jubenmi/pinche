import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
