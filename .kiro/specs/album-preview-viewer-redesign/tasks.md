# Album Preview Viewer Redesign Tasks

## Source of Truth

Requirements: `.kiro/specs/album-preview-viewer-redesign/requirements.md`

Design: `.kiro/specs/album-preview-viewer-redesign/design.md`

Related design note: `docs/superpowers/specs/2026-07-07-album-preview-viewer-redesign.md`

## Tasks

- [ ] 1. Spec and preflight
  - [ ] 1.1 Review `.kiro/specs/album-preview-viewer-redesign/requirements.md` and `.kiro/specs/album-preview-viewer-redesign/design.md`.
  - [ ] 1.2 Inspect current dirty working-tree changes and preserve unrelated edits.
  - [ ] 1.3 Confirm current TDesign ImageViewer source has the stock `visible,initialIndex,images` observer and no local patch.
  - [ ] 1.4 Confirm current album media rules: `preview` is 2048px JPEG quality 85, `thumbnail` is 640px JPEG quality 75.

- [ ] 2. Add failing static checks for stable TDesign usage
  - [ ] 2.1 Update `scripts/check-miniprogram.js` to fail when `handlePreviewImageViewerChange` mutates `previewImageUrls`.
  - [ ] 2.2 Update `scripts/check-miniprogram.js` to fail when `handlePreviewImageViewerChange` mutates `previewInitialIndex`.
  - [ ] 2.3 Update `scripts/check-miniprogram.js` to fail when album preview includes dynamic `syncPreviewImageUrlAtIndex`-style TDesign `images` mutation in the baseline path.
  - [ ] 2.4 Run `node scripts/check-miniprogram.js` and confirm it fails against the current dynamic hydration implementation.

- [ ] 3. Add direct-load album media URLs on the backend
  - [ ] 3.1 Add a signed complete-album media token helper in `apps/api/src/server.js`.
  - [ ] 3.2 Bind token payload to purpose, `photoId`, `sessionId`, `userId`, allowed variant, and expiry.
  - [ ] 3.3 Add direct-load media path generation for `preview_load_url` and `thumbnail_load_url`.
  - [ ] 3.4 Return `preview_load_url` and `thumbnail_load_url` from complete album list responses only after existing album visibility checks have passed.
  - [ ] 3.5 Add media endpoint validation that accepts the direct-load token without Authorization.
  - [ ] 3.6 Preserve existing authenticated media URLs for compatibility during migration.

- [ ] 4. Add backend verification
  - [ ] 4.1 Extend backend smoke or static checks to require `preview_load_url` and `thumbnail_load_url` in complete album responses.
  - [ ] 4.2 Verify expired or malformed direct-load media tokens return 403.
  - [ ] 4.3 Verify a token for one photo cannot access another photo.
  - [ ] 4.4 Verify `variant=thumbnail` continues to use the 640px thumbnail rule.
  - [ ] 4.5 Verify `variant=preview` continues to use the processed display image.

- [ ] 5. Convert mini-program album preview to TDesign stable baseline
  - [ ] 5.1 Normalize album photo media in `apps/miniprogram/src/pages/session/album.vue` to keep `preview_load_url` and `thumbnail_load_url`.
  - [ ] 5.2 Build `previewImageUrls` once from `preview_load_url` in `openPhotoPreview`.
  - [ ] 5.3 Keep `previewInitialIndex` open-only and remove swipe-time assignments.
  - [ ] 5.4 Remove `syncPreviewImageUrlAtIndex` and other open-viewer `images` mutation paths from the TDesign baseline.
  - [ ] 5.5 Rename or replace `hydratePreviewWindow` with `prewarmPreviewUrls` so prewarming does not mutate `previewImageUrls`.
  - [ ] 5.6 Keep `handlePreviewImageViewerChange` limited to updating `previewCurrentIndex` and calling `prewarmPreviewUrls`.

- [ ] 6. Add mini-program verification
  - [ ] 6.1 Run `node scripts/check-miniprogram.js` and confirm the stable TDesign checks pass.
  - [ ] 6.2 Run `npm --workspace apps/miniprogram run build:mp-weixin`.
  - [ ] 6.3 Run the mini-program in WeChat DevTools.
  - [ ] 6.4 Open an album with at least 20 filtered photos.
  - [ ] 6.5 Fast swipe across at least 20 photos and confirm the viewer does not jump back to the originally opened image.
  - [ ] 6.6 Confirm the counter stays on the filtered set size and does not collapse to `1/1`.

- [ ] 7. Decision checkpoint after TDesign baseline
  - [ ] 7.1 Record whether fast swiping is stable with direct-load `preview_load_url`.
  - [ ] 7.2 If stable and UX is acceptable, stop here and do not build a custom viewer.
  - [ ] 7.3 If thumbnail-first UX is still required, proceed to Task 8.
  - [ ] 7.4 If TDesign still jumps with stable direct-load URLs, investigate TDesign/plugin behavior before replacing it.

- [ ] 8. Optional custom progressive viewer
  - [ ] 8.1 Create `apps/miniprogram/src/components/AlbumProgressiveImageViewer.vue`.
  - [ ] 8.2 Render native `swiper` with windowed current plus two neighbors on each side.
  - [ ] 8.3 Render thumbnail and preview layers per item.
  - [ ] 8.4 Keep thumbnail visible until preview load succeeds.
  - [ ] 8.5 Fade preview over thumbnail without changing swiper current.
  - [ ] 8.6 Handle preview failure by keeping thumbnail and showing a light retry/error indicator.
  - [ ] 8.7 Replace album page `t-image-viewer` only after the TDesign baseline checkpoint approves this path.

- [ ] 9. Final verification
  - [ ] 9.1 Run `node scripts/check-miniprogram.js`.
  - [ ] 9.2 Run `npm --workspace apps/miniprogram run build:mp-weixin`.
  - [ ] 9.3 Run WeChat DevTools `auto` for the mini-program project.
  - [ ] 9.4 Update this task file with completed checkboxes and the selected outcome: TDesign baseline only, or custom progressive viewer.

