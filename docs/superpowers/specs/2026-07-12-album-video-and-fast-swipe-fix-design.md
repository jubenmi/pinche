# Album Video Playback and Fast Swipe Fix Design

## Goal

Fix two reproducible defects in the mini-program album viewer:

1. A ready video starts playing and then falls into the `视频加载失败，点击重试` state.
2. Rapid image swipes can trigger an unsolicited forward or backward slide.

The fix must preserve the current five-item viewer window and the existing one-time video URL refresh policy.

## Evidence and Root-Cause Boundary

The simulator reproduces the video failure after playback has already started. The viewer receives a native video error, refreshes the temporary playback URL once, and shows the terminal failure state only after the refreshed URL also fails. This establishes that the button, viewer navigation, and initial codec startup work. Before changing playback behavior, implementation must capture the failing media request, including URL origin, status, `Range`, `Content-Range`, `Accept-Ranges`, `Content-Length`, and native error detail. The final production change must address the failing storage or API response boundary instead of adding retries.

The image defect occurs in `AlbumImageViewer.vue`. The viewer uses a five-item native swiper. Reaching an edge schedules a window rebase after `animationfinish`; rebasing increments `swiperGeneration`, mounts a new native swiper, and supplies a non-zero `duration` with a non-zero `current`. Under rapid input, old animation events and the new swiper's initial positioning animation overlap, producing a visible automatic slide.

## Design

### Video playback

Keep the existing state transition: initial error permits one forced URL refresh; a second error produces the explicit retry state. Add diagnostic detail at the page/component boundary only where needed to expose the native error and the failing request response. Use the captured evidence to choose exactly one transport fix:

- Correct COS object metadata or signed-URL behavior if the direct object response is wrong.
- Correct the API media responder if the request is served locally or proxied and its byte-range response is wrong.

The required playback contract is:

- a full request returns a consistent MP4 response;
- a valid byte-range request returns `206`, correct inclusive `Content-Range`, matching `Content-Length`, and `Accept-Ranges: bytes`;
- invalid ranges return `416` with `Content-Range: bytes */<size>`;
- refreshing a URL must not mutate the photo list structure or reset the viewer index.

No extra automatic retry, transcoding pipeline, or player replacement is in scope.

### Fast image swiping

Keep the five-item window. Separate user-visible slide animation from internal window rebasing:

- ordinary user swipes retain the current 220 ms duration;
- a generation created solely for window rebasing mounts with zero-duration positioning;
- events from an obsolete generation remain ignored;
- only the matching generation and logical index may complete a pending rebase;
- internal rebasing must not emit an extra logical `change` event.

After the new generation has reached its target index, subsequent user swipes return to normal duration. This avoids the expensive full-album native swiper while eliminating the visible rebase animation.

## State and Data Flow

For video, `AlbumImageViewer` reports the photo identity and native error detail. `album.vue` owns the URL refresh state and request. Media hydration updates only the matching preview item; the structural order and current logical index remain stable.

For images, native `change` updates the logical index. Native `animationfinish` may request a rebase. The rebase creates a new generation in internal-positioning mode, positions it without animation, then clears internal-positioning mode after the matching new-generation completion signal. Stale generation events are no-ops.

## Error Handling

Video diagnostics must avoid logging authorization tokens or complete signed query strings. User-facing behavior remains the current loading, one automatic refresh, and explicit retry states.

Swiper recovery clamps indices and discards inconsistent pending rebase state. It must never synthesize another slide to recover from a stale event.

## Testing

Add regression coverage before production changes:

- a video transport test that reproduces the captured failing response contract and fails before the fix;
- a viewer sequence test for rapid `change` and `animationfinish` events across a generation boundary, asserting one logical change per user swipe and no animated internal rebase;
- existing D31 viewer sequence, D42 video, mini-program checks, and a production build;
- simulator verification that the recorded video plays through without the failure state and rapid bidirectional swipes do not continue moving after the finger is released.

## Scope

Files should remain limited to the album viewer, its page-owned video URL/error handling, the confirmed media transport boundary, and focused regression checks. Album layout, upload behavior, filters, download behavior, and unrelated media refactors are excluded.
