# Album Preview Viewer Redesign Requirements

## Goal

Stabilize the mini-program session album full-screen preview so fast left/right swipes do not produce black screens, stuck unloaded images, index jumps, or repeated flicker. The first implementation phase must use TDesign ImageViewer according to its original assumptions before considering a custom progressive viewer.

## Functional Requirements

1. The album preview must preserve the current filtered photo order and allow left/right swiping only within that filtered set.
2. The preview counter must reflect the filtered set size, not collapse to `1/1`.
3. The TDesign ImageViewer baseline must pass a stable final image URL array to `images` when the preview opens.
4. The TDesign ImageViewer baseline must treat `initialIndex` as an open-time value only; it must not update `initialIndex` during swipes.
5. The TDesign ImageViewer baseline must not mutate `images` while the viewer is open.
6. The TDesign ImageViewer baseline may prewarm current `index - 2` through `index + 2`, but prewarming must not change the viewer's `images` prop.
7. Complete album media URLs used by ImageViewer must be directly loadable by WeChat `<image>` without an Authorization header.
8. Direct-load media URLs must remain permission-scoped, short-lived, and bound to existing album visibility rules.
9. `thumbnail` images must remain the existing 640px JPEG quality-75 derivative.
10. `preview` images must remain the existing display JPEG derivative: longest edge 2048px, quality 85, metadata stripped.
11. The system must not expose or depend on upload-original image files; the album's full-screen image is the processed `preview` display image.
12. If thumbnail-first progressive loading remains required after the TDesign baseline is verified, it must be implemented in a custom viewer rather than by dynamically changing TDesign ImageViewer `images`.

## Non-Goals

- Do not redesign album filters, tagging, deletion, upload, download, privacy, share, or bulk-selection behavior.
- Do not load every album image into local storage before opening preview.
- Do not patch TDesign ImageViewer internals.
- Do not introduce a new original-image storage or serving path.
- Do not loosen complete-album membership or per-photo privacy checks.
- Do not replace `uv-waterfall`.

## Acceptance Criteria

1. `scripts/check-miniprogram.js` fails if `handlePreviewImageViewerChange` mutates `previewImageUrls` or `previewInitialIndex`.
2. `scripts/check-miniprogram.js` fails if album preview reintroduces `syncPreviewImageUrlAtIndex`-style mutation during the TDesign baseline.
3. Full album API responses include direct-load `preview_load_url` and `thumbnail_load_url` for each visible photo.
4. Direct-load media URLs are rejected when the token is expired, malformed, for the wrong photo, or outside the current user's visible album scope.
5. The mini-program TDesign baseline opens the viewer with a stable `previewImageUrls` array generated from `preview_load_url`.
6. Fast swiping across at least 20 photos in WeChat DevTools does not jump back to the initially opened photo.
7. Fast swiping does not create permanent black pages; failed image loads show a recoverable image error state and still allow further swiping.
8. `node scripts/check-miniprogram.js` exits successfully.
9. `npm --workspace apps/miniprogram run build:mp-weixin` exits successfully.

