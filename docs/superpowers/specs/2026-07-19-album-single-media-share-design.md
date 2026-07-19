# Album Single-Media Sharing Design

Date: 2026-07-19

## Goal

Let an album member share the photo or video currently open in the full-screen viewer. The recipient first sees only that media item and cannot swipe through the rest of the album. A fixed `查看完整相册` action then opens the same session's public read-only album, turning the focused media share into a natural mini-program discovery path.

## Context

The mini-program already supports D48 public album sharing:

- an album member creates a bounded public snapshot;
- the snapshot contains at most 30 media items and at most 3 ready videos;
- every existing listed item, cover, and image response rechecks moderation and privacy eligibility;
- the public album is anonymous and read-only;
- revocation, deletion, moderation withdrawal, and privacy changes dynamically tighten an existing share;
- public ready videos currently expose an approved cover but no anonymous playback URL;
- the full-screen `AlbumImageViewer` currently supports browsing, video playback, close, and eligible image download, but no current-item share action.

The new flow must reuse that public boundary. A hidden client control is not an authorization boundary, and no raw private media URL may be placed in a share path.

## Product Decision

Use one public album snapshot with two presentation modes:

1. The share card opens the existing album route in focused single-media mode.
2. Focused mode renders only the requested image or video and offers `查看完整相册`.
3. The action exits focused mode and renders the complete public snapshot authorized by the same token.

This is intentionally a presentation boundary rather than a second authorization scope. The token authorizes its bounded public snapshot because the recipient is explicitly invited to open that snapshot through `查看完整相册`. `focusMediaId` chooses the initial focused item but never expands the snapshot.

## Alternatives Considered

### Separate single-media and album tokens

A strict single-item token could authorize the media page, while a second token authorizes the album CTA. This adds two-token expiry, revocation, caching, and navigation state without providing a meaningful privacy benefit: the product intentionally grants the recipient access to the public album through the CTA.

### A new single-media share record and page

A separate record and page would isolate future analytics and presentation experiments, but it would duplicate the existing D48 snapshot, public DTO, media getter, privacy, and revocation paths. That scope is not justified for the current feature.

### Direct image or video file sharing

Direct file sharing weakens mini-program attribution, removes the album conversion action, complicates video delivery, and risks exposing a reusable media URL. It does not meet the promotion goal.

## Scope

In scope:

- a share action for the current image or ready video in the private member viewer;
- optional focused-media selection when creating a public album snapshot;
- focused single-media presentation on the existing album route;
- snapshot-bound anonymous playback for a focused ready video;
- an anonymous `查看完整相册` transition to that same public snapshot;
- current-media share title and cover preparation;
- focused error states and regression coverage.

Out of scope:

- direct file sharing or download from the public focused view;
- a new database table, route page, or public media permission model;
- public comments, reactions, sign-up, role claim, or member operations;
- a new analytics pipeline, reward, or share incentive;
- video transcoding, a new player, or direct COS URL exposure;
- changing current full-album or timeline share semantics;
- refactoring unrelated album layout, viewer windowing, upload, tagging, or playback behavior.

## Sender Experience

### Viewer action

The private member `AlbumImageViewer` adds a share action beside the current download and close actions. The action belongs to the currently displayed logical media item.

The page prepares focused share data when the viewer opens and whenever the current index changes. Preparation is cached by media ID. The action has four explicit states:

- `loading`: the target snapshot token or card cover is being prepared;
- `ready`: the native share button is enabled;
- `blocked`: the media is not publicly shareable under the existing D48 rules;
- `failed`: preparation failed transiently and may be retried.

The action must not silently fall back to an ordinary full-album share. A blocked or failed item shows a concise explanation when tapped.

### Share card

The native share button carries the media ID in its dataset. `onShareAppMessage(options)` reads that exact ID and retrieves the matching cached share record. It returns synchronously with:

- a title that identifies the session and whether the item is a photo or video;
- the prepared current image or approved video cover, with the existing safe album or ticket art as fallback;
- a path using the existing album page with `id`, `albumShareToken`, `focusMediaId`, and `source=single_media_share`.

The complete token-bearing path is never logged. A stale cached entry for another media ID cannot be used for the current button.

## Public Focused Experience

The existing album page recognizes focused mode only when all of these are present:

- a valid public album token;
- a positive `focusMediaId`;
- `source=single_media_share`.

It loads the public snapshot through the existing anonymous public-share endpoint and then finds the requested ID in the returned public DTO. It must not select the first item or another item if the requested ID is absent.

When the focused item exists:

- the viewer receives an array containing only that item, so native swiping cannot expose adjacent media;
- the counter and member-only actions are hidden;
- public download is disabled;
- images use the existing public thumbnail and preview hydration path;
- videos use the existing public cover and viewer playback states plus the new snapshot-bound public playback capability described below;
- a fixed primary action reads `查看完整相册`.

Tapping `查看完整相册` closes focused presentation and shows the already loaded public snapshot on the same page. It does not require login or fetch a broader member album.

Changing `focusMediaId` can only select another item already authorized by the token's bounded snapshot. It cannot retrieve a snapshot-external item because the public list and every media getter continue to enforce snapshot membership.

## Snapshot Selection

Extend the existing endpoint without changing its default behavior:

```http
POST /api/sessions/:sessionId/album/share-token
Content-Type: application/json

{
  "focusMediaId": 123
}
```

`focusMediaId` is optional. When omitted, current full-album sharing remains unchanged.

When supplied, the service:

1. validates it as a positive integer;
2. confirms the caller is an eligible album member with a public share subject;
3. loads the same candidate media, tags, moderation state, and privacy data used by ordinary public sharing;
4. confirms the requested item independently passes the existing public-share eligibility function;
5. places the requested item in the bounded selection;
6. fills the remaining slots using the existing stable priority and ordering rules;
7. enforces at most 30 total items and at most 3 ready videos, counting the requested item toward both limits;
8. computes the snapshot digest from the final normalized ID set and reuses an identical unexpired snapshot where possible.

The response keeps the existing token, subject, owner, count, and cover fields and adds `focus_media_id` so the client can verify it received the requested target.

If the item is absent, deleted, unapproved, unfinished, outside the sharer's public subject/uploader scope, or rejected by any uploader/tagged-user privacy veto, the endpoint returns:

```json
{
  "code": "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE"
}
```

with HTTP 409. Forced inclusion never bypasses the existing public eligibility function.

## Public Video Playback Boundary

The current public album DTO intentionally has no video playback URL, so focused video sharing requires a new anonymous capability. It must remain inside the D48 snapshot and privacy boundary rather than reusing the member-only video endpoint.

The focused page requests a short playback capability with the album share token:

```http
GET /api/session-album/public-share/media/:mediaId/video-url?token=<albumShareToken>
```

The endpoint verifies the share token, active share record, snapshot membership, published moderation state, ready processing state, and current public privacy eligibility. It returns a short-lived application URL, not a COS object URL:

```json
{
  "url": "/api/session-album/public-share/media/123/video-file?token=...",
  "expiresInSeconds": 600
}
```

The signed playback capability binds the share ID, session ID, media ID, share-token digest, purpose, and expiry. The `GET|HEAD` video-file endpoint verifies those claims and repeats active-share, snapshot-membership, moderation, readiness, and privacy checks before serving content.

The application endpoint preserves the existing playback transport contract for both local and COS storage:

- full requests return a consistent MP4 response;
- valid range requests return `206`, correct inclusive `Content-Range`, matching `Content-Length`, and `Accept-Ranges: bytes`;
- invalid ranges return `416` with `Content-Range: bytes */<size>`;
- responses use private no-store caching;
- COS bytes are proxied through the checked application boundary instead of redirecting to an exposed reusable COS URL.

The focused page requests this URL only for the active ready video, caches it through its short expiry, and applies the viewer's existing one automatic refresh plus explicit retry policy. A refreshed URL updates only that media item and does not change the snapshot or focused ID.

## Client State and Race Control

The album page owns focused-share preparation because it owns the session, public token calls, current preview index, and `onShareAppMessage` hook. `AlbumImageViewer` only renders the action state and exposes the native share button for the current item.

The page stores focused share entries by media ID. Each entry includes status, token, focus ID, title, image URL, and any safe user-facing error. Requests also carry a monotonically increasing authority or equivalent identity check.

On a preview change:

1. update `previewCurrentIndex` through the existing viewer flow;
2. look up the new current media ID;
3. reuse a matching ready cache entry or start preparation;
4. update the visible action only if the completed request still belongs to the current media ID;
5. keep late results cached under their own ID without overwriting another item's visible state.

Closing the viewer clears visible focused-share state. It may retain bounded in-page cache entries until page unload, but it must not persist tokens to general storage.

## Component Boundary

`AlbumImageViewer` remains responsible for media presentation and immediate viewer controls. Its focused-share additions are limited to explicit inputs and events, for example:

- a share status and share-enabled flag for the private viewer action;
- a native share button carrying the current media ID;
- an optional counter visibility flag;
- an optional primary action label and event for public focused mode.

The component does not call album APIs, choose tokens, compute share paths, or decide public eligibility. The album page remains the policy and navigation owner.

## Failure Behavior

### Sender

- Loading never exposes a share button with an older item's token.
- A 409 eligibility response becomes `blocked`, not a generic network failure.
- A transient network or cover preparation error becomes `failed` and can be retried for the same item.
- If cover preparation fails but a safe fallback exists, the token may still become ready using that fallback.
- Share preparation failure does not close the viewer or affect image/video playback.

### Recipient

- A missing or invalid `focusMediaId` shows `该内容已不可查看`; it never auto-selects another item.
- If the target has disappeared but the snapshot remains valid and contains other visible media, `查看完整相册` remains available.
- If the token is expired, revoked, malformed, or the entire share is unavailable, the full-album action is hidden.
- A media load failure uses the existing image failure or video retry state and never substitutes another item.
- A public video capability failure shows the existing video failure state and never falls back to a member-only endpoint or direct object URL.
- No error response includes private tags, uploader identity, object keys, signed URL query values, or another media item.

## Privacy and Security Invariants

1. The focused item must belong to the token's normalized snapshot IDs.
2. Snapshot creation, public DTO generation, cover generation, image access, and video access continue to use the same D48 moderation and privacy gate.
3. Any uploader or resolved tagged user can veto public visibility under the existing privacy rules.
4. Revocation, deletion, moderation withdrawal, or later privacy changes invalidate the affected public media immediately.
5. `focusMediaId` is presentation input, not trusted authorization data.
6. Public focused mode never exposes member-only download, upload, tagging, deletion, privacy, role-claim, or sign-up actions.
7. Share card covers use approved derived media or the existing safe fallback, never a private object URL.
8. Public video URL issuance and every application video-file request recheck the active snapshot and current public eligibility.

## Testing

Implementation follows test-first red-green-refactor cycles.

### Service and API

- a requested eligible image is present in the resulting snapshot;
- a requested eligible video is present and consumes one of the three video slots;
- stable fill order, 30-item limit, and three-video limit remain intact;
- an ineligible, deleted, unapproved, unfinished, privacy-vetoed, or cross-session ID returns 409;
- the response `focus_media_id` matches the request;
- identical focused selections reuse an unexpired matching snapshot;
- a public token cannot read a snapshot-external `focusMediaId` or media URL;
- a public ready video receives a short snapshot-bound playback capability, while an image, unfinished video, cross-session video, or snapshot-external video is rejected;
- public video full, `HEAD`, valid-range, and invalid-range responses satisfy the playback transport contract without exposing a COS URL;
- privacy changes, moderation withdrawal, deletion, expiry, and revocation close access immediately.

### Mini-program behavior

- opening an eligible image or ready video begins focused share preparation;
- the share button is enabled only for a matching ready cache entry;
- rapid viewer changes and out-of-order responses cannot share the wrong media;
- the share handler uses the dataset media ID rather than an unrelated live index;
- image and video cards use the correct title, path, and safe cover fallback;
- focused public mode supplies only one item to the viewer, hides the counter and member controls, and disables download;
- `查看完整相册` exits focused mode into the same public snapshot without login;
- an absent target does not auto-select a replacement;
- an invalid whole-share token hides the album CTA.

### Regression and acceptance

- existing full-album friend/group sharing and timeline sharing remain unchanged;
- existing D48 snapshot, privacy veto, revocation, public DTO, and cover tests remain green;
- the prior public DTO assertion is updated narrowly: ready video rows still contain no direct playback URL, while the new capability endpoint supplies playback only after a separate checked request;
- existing member album download, private video playback, viewer windowing, and fast-swipe regression tests remain green;
- run focused checks, the complete `npm run check`, and the WeChat mini-program production build;
- in WeChat DevTools, verify one image and one ready video from private viewer share action through recipient focus view and `查看完整相册` transition.

## Acceptance Criteria

1. A member can share the image or ready video currently open in the album viewer when it is publicly eligible.
2. The recipient initially sees only that item and cannot swipe to other media.
3. The recipient can tap `查看完整相册` to open the same session's bounded public read-only album.
4. The current item is guaranteed to be in that snapshot without bypassing moderation or privacy rules.
5. A focused ready video plays anonymously through a snapshot-bound, range-correct application capability without exposing a direct object URL.
6. Rapid sender-side swiping cannot produce a card for the wrong item.
7. Invalid or withdrawn focused content does not fall back to another media item.
8. Existing full-album sharing and member album behavior do not regress.
