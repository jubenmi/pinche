# Album Preview Viewer Redesign Design

## Current Context

The album page is a uni-app Vue mini-program page at `apps/miniprogram/src/pages/session/album.vue`. It currently uses `t-image-viewer` from `tdesign-miniprogram`.

TDesign ImageViewer resets its internal loaded indexes and swiper current whenever `visible`, `initialIndex`, or `images` changes. This means the plugin expects a stable image URL array and an open-time `initialIndex`. Recent dynamic URL hydration conflicted with those assumptions by changing `images` and `initialIndex` while the user was swiping.

The backend currently stores album display media as processed JPEGs under `uploads/session-album/display/*.jpg`. The display image is produced with longest edge 2048px, JPEG quality 85, metadata stripped. The thumbnail variant is generated from that display image as 640px JPEG quality 75. The system does not retain or serve an upload-original image.

## Architecture

Use a two-phase architecture:

1. **TDesign stable baseline:** keep TDesign ImageViewer, but feed it only stable direct-load preview URLs. This validates the plugin under correct usage conditions.
2. **Optional progressive viewer:** only if thumbnail-first UX remains necessary, add a custom `AlbumProgressiveImageViewer` with per-item thumbnail and preview layers.

The first phase is required before the second. If TDesign is stable under direct-load preview URLs, the original bug is confirmed to be caused by violating plugin assumptions rather than by TDesign's swipe logic.

## Backend Media URL Design

Add direct-load media tokens for complete album media. Unlike the current Authorization-header path, these URLs must be consumable by WeChat `<image>`.

Example routes:

```http
GET /api/session-album/photos/:photoId/image?token=<media_token>&variant=preview
GET /api/session-album/photos/:photoId/image?token=<media_token>&variant=thumbnail
```

The token must bind:

- purpose: `session-album-media`
- `photoId`
- `sessionId`
- current `userId`
- allowed variant or variants
- expiry timestamp

The album list endpoint signs the media token only after checking the same visibility rules already used by the album list:

- authenticated user
- session album is open
- user is a valid album member
- photo is active
- photo is visible to the user under privacy and tag rules

The media endpoint validates only the token and variant; it must not require Authorization for the direct-load route. Invalid, expired, or mismatched tokens return 403.

The existing authenticated media path may remain for download or backward compatibility during migration.

## API Response Shape

Visible photos returned by complete-album endpoints should include:

```json
{
  "id": 123,
  "preview_url": "/api/session-album/photos/123/image?expires=...",
  "thumbnail_url": "/api/session-album/photos/123/image?expires=...&variant=thumbnail",
  "preview_load_url": "/api/session-album/photos/123/image?token=...&variant=preview",
  "thumbnail_load_url": "/api/session-album/photos/123/image?token=...&variant=thumbnail",
  "image_width": 1365,
  "image_height": 2048
}
```

`preview_load_url` is the canonical ImageViewer URL in the TDesign baseline. `thumbnail_load_url` is reserved for gallery thumbnails, prewarming, or the optional progressive viewer.

## Mini-Program TDesign Baseline

### State Contract

Keep these album page states:

- `previewOverlayVisible`
- `previewPhotos`
- `previewImageUrls`
- `previewInitialIndex`
- `previewCurrentIndex`

Their meanings must be narrowed:

- `previewImageUrls` is generated once when opening the viewer.
- `previewInitialIndex` is generated once when opening the viewer.
- `previewCurrentIndex` changes on swipe and is used only for prewarming or index-dependent app behavior.
- No method mutates `previewImageUrls` while `previewOverlayVisible` is true.
- No method mutates `previewInitialIndex` from `handlePreviewImageViewerChange`.

### Open Flow

`openPhotoPreview(photo)`:

1. Build `previewPhotos` from `previewContextPhotosForPhoto(photo)`.
2. Find `currentIndex` from the clicked photo id.
3. Build `previewImageUrls` from `photo.preview_load_url`.
4. If a photo lacks `preview_load_url`, use a non-transparent direct-load fallback asset so TDesign has a concrete image source.
5. Set `previewInitialIndex = currentIndex`.
6. Set `previewCurrentIndex = currentIndex`.
7. Set `previewOverlayVisible = true`.
8. Call `prewarmPreviewUrls(currentIndex)`.

### Swipe Flow

`handlePreviewImageViewerChange(event)`:

1. Read `event.detail.index`.
2. Set `previewCurrentIndex`.
3. Call `prewarmPreviewUrls(nextIndex)`.
4. Do not update `previewInitialIndex`.
5. Do not update `previewImageUrls`.

### Prewarming

`prewarmPreviewUrls(index)`:

1. Select photos from `index - 2` to `index + 2`.
2. For each selected photo, prewarm `preview_load_url` with `uni.getImageInfo` or an equivalent hidden image preload.
3. Store prewarm status separately from ImageViewer input state.
4. Ignore prewarm failures for the open viewer. The viewer keeps its stable URL array.
5. If token expiry is detected, mark the album media URLs stale and refresh them after close or before the next open, not by replacing the open viewer's `images`.

## Optional Progressive Viewer

If the TDesign baseline is stable but UX still needs thumbnail-first rendering, create a custom component such as `apps/miniprogram/src/components/AlbumProgressiveImageViewer.vue`.

The component uses native `swiper` and receives stable `photos` rather than an `images` string array:

```js
{
  visible: Boolean,
  photos: Array<{
    id,
    thumbnail_load_url,
    preview_load_url,
    image_width,
    image_height
  }>,
  initialIndex: Number
}
```

Each visible item renders two images:

1. thumbnail layer loads first and prevents black pages.
2. preview layer loads concurrently and fades in over the thumbnail.
3. preview failure leaves thumbnail visible with a light failure indicator.
4. thumbnail failure shows a non-transparent fallback state.

The component should window DOM to current plus two on each side. This keeps rendering bounded without relying on TDesign lazy behavior.

## Risk Controls

- Keep TDesign ImageViewer unpatched.
- Keep `previewImageUrls` stable while the viewer is open.
- Keep `initialIndex` open-only.
- Add static checks before implementation to catch regressions to dynamic `images` mutation.
- Verify plugin stability in DevTools before building the optional progressive viewer.

