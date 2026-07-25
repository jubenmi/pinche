import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert(fs.existsSync(absolutePath), `D57 required file is missing: ${relativePath}`);
  return fs.readFileSync(absolutePath, "utf8");
}

function sourceFiles(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const files = [];
  for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(child));
    } else if (/\.(?:js|mjs|cjs|vue)$/.test(entry.name)) {
      files.push(child);
    }
  }
  return files.sort();
}

function requireText(source, text, message) {
  assert(source.includes(text), message || `D57 contract is missing: ${text}`);
}

function forbidText(source, text, message) {
  assert(!source.includes(text), message || `D57 contract forbids: ${text}`);
}

function forbidInFiles(files, text, label) {
  const offenders = files.filter((file) => read(file).includes(text));
  assert(
    offenders.length === 0,
    `D57 ${label} must not contain ${text}: ${offenders.join(", ")}`
  );
}

function requireOrdered(source, tokens, label) {
  let cursor = -1;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor + 1);
    assert(index >= 0, `D57 ${label} is missing or out of order: ${token}`);
    cursor = index;
  }
}

const paths = Object.freeze({
  migration: "apps/api/migrations/0035_album_tag_public_share_read_model.sql",
  migrationPreparer: "apps/api/src/modules/core/album-tags-migration.js",
  tags: "apps/api/src/modules/core/album-tags.js",
  manifest: "apps/api/src/modules/core/public-album-share-manifest.js",
  mediaState: "apps/api/src/modules/core/public-album-media-state.js",
  server: "apps/api/src/legacy-app.js",
  albumPage: "apps/miniprogram/src/pages/session/album.vue",
  pagination: "apps/miniprogram/src/utils/albumPublicSharePagination.js",
  publicReadState: "apps/miniprogram/src/utils/publicAlbumReadState.js",
  d50Check: "scripts/d50-album-single-media-sharing-check.js",
  d54Check: "scripts/d54-public-album-full-share-pagination-check.js",
});

const migration = read(paths.migration);
for (const token of [
  "CREATE TABLE IF NOT EXISTS session_album_media_tags",
  "CREATE TABLE IF NOT EXISTS session_album_public_share_items",
  "CAST('role' AS BINARY)",
  "CAST('npc_role' AS BINARY)",
  "CAST('other' AS BINARY)",
  "PRIMARY KEY (share_id, ordinal)",
]) {
  requireText(migration, token, `D57 migration must define ${token}`);
}

const apiRuntimeFiles = sourceFiles("apps/api/src").filter(
  (file) => file !== paths.migrationPreparer
);
forbidInFiles(
  apiRuntimeFiles,
  "session_album_photo_tags",
  "production API runtime"
);

const migrationPreparer = read(paths.migrationPreparer);
requireText(migrationPreparer, "ALTER TABLE session_album_photo_tags");
requireText(migrationPreparer, "FOREIGN KEY (photo_id)");
requireText(migrationPreparer, "ON DELETE CASCADE");
assert(
  !/(?:SELECT[\s\S]{0,120}\bFROM|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+session_album_photo_tags/i.test(
    migrationPreparer
  ),
  "D57 legacy tag preparer may coordinate only the old foreign key"
);

const tags = read(paths.tags);
for (const token of [
  '/^(role|npc-role):([1-9]\\d*)$/',
  'kind: "role"',
  'kind: "npc_role"',
  'kind: "other"',
  "seat.role_name",
  "seat.name",
  "npc_role.name",
  'label: "其他"',
  "session_album_media_tags",
]) {
  requireText(tags, token, `D57 canonical tag model is missing ${token}`);
}
for (const forbidden of ["nickname", "open_id", "dm:session", "npc:session", "organizer:session"]) {
  forbidText(tags, forbidden, `D57 tag labels must not depend on ${forbidden}`);
}

const manifest = read(paths.manifest);
for (const token of [
  "session_album_public_share_items",
  "writePublicShareItems",
  "assertManifestMatchesLegacySnapshot",
  "readPublicShareItemPage",
  "ordinal > ?",
]) {
  requireText(manifest, token, `D57 manifest authority is missing ${token}`);
}

const mediaState = read(paths.mediaState);
for (const token of [
  "normalizePublicMediaStateIds",
  "loadShare(connection, claims)",
  "patches",
  "unavailable_ids",
]) {
  requireText(mediaState, token, `D57 media-state service is missing ${token}`);
}

const server = read(paths.server);
requireText(server, "publicSessionAlbumMediaStateId");
requireText(server, "public-share\\/media-state");
requireText(server, "readPublicSessionAlbumMediaState");

const publicReadState = read(paths.publicReadState);
for (const event of ["INITIAL_PAGE", "NEXT_PAGE", "MEDIA_PATCH", "UNLOAD"]) {
  requireText(publicReadState, `event.type === "${event}"`, `D57 reducer is missing ${event}`);
}
requireText(publicReadState, "createPublicAlbumMediaStateController");

const albumPage = read(paths.albumPage);
const pagination = read(paths.pagination);
for (const token of [
  "/album/public-share/media-state",
  "appendPublicAlbumWaterfallPhotos",
  "applyPublicAlbumMediaPatchToWaterfall",
  'type: "INITIAL_PAGE"',
  'type: "NEXT_PAGE"',
  'type: "MEDIA_PATCH"',
  'type: "UNLOAD"',
]) {
  requireText(albumPage, token, `D57 public album page is missing ${token}`);
}
for (const forbidden of [
  "reloadLoadedPublicAlbumPrefix",
  "reloadPublicAlbumSharePrefix",
  "publicShareLoadedPageCount",
  "samePublicAlbumMediaSequence",
  "pageScrollTo",
  "dm:session",
  "npc:session",
  "organizer:session",
]) {
  forbidText(`${albumPage}\n${pagination}`, forbidden);
}
forbidText(
  albumPage,
  "D54 static-gate compatibility; remove/update in Task8",
  "D57 must remove the temporary D54 static-gate compatibility comment"
);

const fixtureFiles = sourceFiles("scripts").filter(
  (file) => file !== "scripts/d57-album-tag-public-share-read-model-check.js"
);
for (const forbidden of [
  "session_album_photo_tags",
  "dm:session",
  "npc:session",
  "organizer:session",
]) {
  forbidInFiles(fixtureFiles, forbidden, "checks and smoke fixtures");
}

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts?.["d57:unit"] ===
    "node --test apps/api/test/album-tag-model.test.mjs apps/api/test/album-public-share-manifest.test.mjs apps/api/test/album-public-media-state.test.mjs apps/miniprogram/test/publicAlbumReadState.test.mjs",
  "D57 focused unit script must remain exact"
);
assert(
  packageJson.scripts?.["d57:check"] ===
    "node scripts/d57-album-tag-public-share-read-model-check.js",
  "D57 static check script must remain exact"
);
requireOrdered(
  packageJson.scripts?.postcheck || "",
  [
    "npm run d54:unit",
    "npm run d54:check",
    "npm run d55:unit",
    "npm run d55:check",
    "npm run d56:unit",
    "npm run d56:check",
    "npm run unified-share:unit",
    "npm run unified-share:check",
    "npm run d57:unit",
    "npm run d57:check",
  ],
  "postcheck lifecycle"
);

const specPaths = Object.freeze({
  d48: [
    "specs/d48-album-sharing-role-claim-separation/requirements.md",
    "specs/d48-album-sharing-role-claim-separation/design.md",
  ],
  d50: [
    "specs/d50-album-single-media-sharing/requirements.md",
    "specs/d50-album-single-media-sharing/design.md",
  ],
  d52: [
    "specs/d52-untagged-owned-image-sharing/requirements.md",
    "specs/d52-untagged-owned-image-sharing/design.md",
  ],
  d54: [
    "specs/d54-public-album-full-share-pagination/requirements.md",
    "specs/d54-public-album-full-share-pagination/design.md",
  ],
});
for (const [name, files] of Object.entries(specPaths)) {
  for (const file of files) {
    requireText(read(file), "D57", `${name.toUpperCase()} supersession is missing in ${file}`);
  }
}
for (const file of specPaths.d48) {
  const source = read(file);
  requireText(source, "canonical", `D48 must defer canonical tag references to D57: ${file}`);
  requireText(source, "role", `D48 must retain role tag semantics: ${file}`);
  requireText(source, "npc_role", `D48 must retain NPC role tag semantics: ${file}`);
}
for (const file of specPaths.d50) {
  const source = read(file);
  requireText(source, "session_album_public_share_items", `D50 must authorize from manifest items: ${file}`);
}
for (const file of specPaths.d52) {
  const source = read(file);
  requireText(source, "隐式资格", `D52 implicit untagged eligibility must remain explicit: ${file}`);
}
for (const file of specPaths.d54) {
  const source = read(file);
  requireText(source, "MEDIA_PATCH", `D54 must defer refresh patches to D57: ${file}`);
  requireText(source, "session_album_public_share_items", `D54 must defer runtime order to D57 items: ${file}`);
}

const d50Check = read(paths.d50Check);
requireOrdered(
  d50Check,
  [
    'type: "INITIAL_PAGE"',
    "await this.publicAlbumMediaStateRefresh?.refresh().catch(() => null);",
    "this.isCurrentPublicAlbumRequest(publicRequest)",
    "const focusedSnapshot = focusedPublicSnapshotProjection(this.photos, this.focusMediaId);",
  ],
  "D50 focused public hydration gate"
);
forbidText(
  d50Check,
  "this.photos = (data.photos || []).map((photo) => this.normalizePhotoMedia(photo));",
  "D50 gate must not restore the superseded direct public list assignment"
);

const d54Check = read(paths.d54Check);
requireText(d54Check, paths.publicReadState, "D54 gate must read reducer-owned page state");
requireText(d54Check, "pageError", "D54 gate must assert reducer-owned retry state");
forbidText(
  d54Check,
  '"继续加载失败，可重试"\n]) {',
  "D54 gate must not require retry copy from album.vue"
);

console.log("D57 album tag and public share read-model checks passed");
