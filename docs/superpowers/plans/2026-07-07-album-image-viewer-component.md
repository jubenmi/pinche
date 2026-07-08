# Album Image Viewer Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated mini program album image viewer component that shows thumbnails first, fades in preview images, supports stable swiping, and delegates confirmed downloads back to the album page.

**Architecture:** `AlbumImageViewer.vue` owns full-screen viewing behavior and emits `close`, `change`, and `download` events. `album.vue` keeps album business rules, including filtered photo context and confirmed download handling. Static checks enforce the component boundary and prevent reintroducing TDesign dynamic-image logic.

**Tech Stack:** UniApp Vue single-file components, WeChat mini program `<swiper>` and `<image>`, Node.js static verification script.

---

### Task 1: Spec Three-Piece

**Files:**
- Create: `specs/d31-album-image-viewer/requirements.md`
- Create: `specs/d31-album-image-viewer/design.md`
- Create: `specs/d31-album-image-viewer/tasks.md`

- [x] **Step 1: Write Chinese requirements, design, and tasks**

Create the three files under `specs/d31-album-image-viewer/` with the approved scope: independent component, thumbnail placeholder, preview fade-in, basic viewer operations, confirmed download, share album download disabled, and rollback guidance.

- [x] **Step 2: Mark D31.1 complete in tasks**

Ensure `specs/d31-album-image-viewer/tasks.md` marks D31.1 as complete and leaves implementation tasks unchecked.

### Task 2: Static Check Red Test

**Files:**
- Modify: `scripts/check-miniprogram.js`
- Read: `apps/miniprogram/src/pages/session/album.vue`

- [ ] **Step 1: Add failing D31 static checks**

Update `scripts/check-miniprogram.js` so it expects:

```js
const albumImageViewerPath = path.join(
  miniprogramSrcRoot,
  "components",
  "AlbumImageViewer.vue"
);
const albumImageViewerSource = fs.existsSync(albumImageViewerPath)
  ? fs.readFileSync(albumImageViewerPath, "utf8")
  : "";
if (!albumImageViewerSource) {
  fail("AlbumImageViewer component must exist for D31 preview");
}
```

Also check the component boundary strings:

```js
for (const requiredText of [
  "thumbnail_load_url",
  "preview_load_url",
  "previewLoadedById",
  "previewFailedById",
  "thumbnailFailedById",
  "$emit(\"download\""
]) {
  if (!albumImageViewerSource.includes(requiredText)) {
    fail(`AlbumImageViewer must implement D31 viewer behavior: ${requiredText}`);
  }
}
for (const forbiddenText of ["getToken", "downloadSinglePhoto", "saveImageToPhotosAlbum"]) {
  if (albumImageViewerSource.includes(forbiddenText)) {
    fail(`AlbumImageViewer must not own album download business: ${forbiddenText}`);
  }
}
```

Check album page integration:

```js
for (const requiredText of [
  'import AlbumImageViewer from "../../components/AlbumImageViewer.vue"',
  "components: { AuthIdentityBar, RoleSeatBoard, FeedbackHost, AlbumImageViewer }",
  "<AlbumImageViewer",
  ':allow-download="!timelineMode"',
  '@download="handlePreviewDownload"',
  "handlePreviewDownload(event)",
  "this.downloadSinglePhoto(photo)"
]) {
  if (!albumSource.includes(requiredText)) {
    fail(`Album page must integrate AlbumImageViewer for D31: ${requiredText}`);
  }
}
```

Remove or replace old checks that require the inline `.photo-preview-mask` swiper.

- [ ] **Step 2: Run static check and verify it fails**

Run: `node scripts/check-miniprogram.js`

Expected: FAIL with a message mentioning `AlbumImageViewer component must exist for D31 preview` or another D31 missing integration string.

- [ ] **Step 3: Mark D31.2 progress in tasks**

Update `specs/d31-album-image-viewer/tasks.md` to record that the red static check has been added and observed failing.

### Task 3: Component Implementation

**Files:**
- Create: `apps/miniprogram/src/components/AlbumImageViewer.vue`

- [ ] **Step 1: Create component template**

Implement a full-screen wrapper with `<swiper>`, thumbnail `<image>`, preview `<image>`, fallback view, top counter, download button, and close button.

- [ ] **Step 2: Create component script**

Implement props, internal state, URL fallback helpers, load/error handlers, swipe change, close, touch close, and guarded download emission.

- [ ] **Step 3: Create component styles**

Add fixed full-screen black background, full-height swiper, layered images, preview fade-in, topbar safe-area padding, compact icon buttons, loading spinner, and failure text.

- [ ] **Step 4: Run static check**

Run: `node scripts/check-miniprogram.js`

Expected: still FAIL until album page integration is complete; no failure should complain that `AlbumImageViewer.vue` is missing.

- [ ] **Step 5: Update D31.3 in tasks**

Mark completed component subtasks in `specs/d31-album-image-viewer/tasks.md`.

### Task 4: Album Page Integration

**Files:**
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [ ] **Step 1: Import and register component**

Add:

```js
import AlbumImageViewer from "../../components/AlbumImageViewer.vue";
```

Register it in the component map.

- [ ] **Step 2: Replace inline preview template**

Replace the inline `.photo-preview-mask` block with:

```vue
<AlbumImageViewer
  :visible="previewOverlayVisible"
  :photos="previewPhotos"
  :initial-index="previewInitialIndex"
  :allow-download="!timelineMode"
  @close="closePhotoPreview"
  @change="handlePreviewChange"
  @download="handlePreviewDownload"
/>
```

- [ ] **Step 3: Adjust preview state and methods**

Add `previewInitialIndex: 0`. In `openPhotoPreview(photo)`, set `previewInitialIndex = currentIndex`. Replace old inline preview event handlers with:

```js
handlePreviewChange(event) {
  const index = Number(event?.detail?.index || 0);
  this.previewCurrentIndex = index;
},
handlePreviewDownload(event) {
  if (this.timelineMode) {
    return;
  }
  const photo = event?.detail?.photo;
  if (!photo) {
    return;
  }
  this.downloadSinglePhoto(photo);
}
```

Keep `downloadSinglePhoto(photo)` unchanged so confirmation remains in place.

- [ ] **Step 4: Remove obsolete inline preview state and CSS**

Remove touch state and methods owned by the old inline preview layer. Remove `.photo-preview-*` styles that are no longer referenced from `album.vue`.

- [ ] **Step 5: Run static check**

Run: `node scripts/check-miniprogram.js`

Expected: PASS if D31 integration and existing checks are satisfied.

- [ ] **Step 6: Update D31.4 in tasks**

Mark completed integration subtasks in `specs/d31-album-image-viewer/tasks.md`.

### Task 5: Verification

**Files:**
- Modify: `specs/d31-album-image-viewer/tasks.md`

- [ ] **Step 1: Run miniprogram static check**

Run: `node scripts/check-miniprogram.js`

Expected: PASS.

- [ ] **Step 2: Run mini program build**

Run: `npm run build:mp-weixin`

Expected: build completes successfully, or record a clear failure reason in `tasks.md`.

- [ ] **Step 3: Update verification record**

Record command results under `specs/d31-album-image-viewer/tasks.md` 验证记录 and mark verified tasks complete only when the command output supports it.
