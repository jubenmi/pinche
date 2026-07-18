# Video Upload SQL Fix Design

## Problem

Production video upload completes the direct COS PUT, but `POST /api/admin/sessions/:id/album/videos` returns HTTP 500. The uploaded test object passes the same authoritative HEAD, ETag, content-length, content-type, 12-byte range, and MP4 `ftyp` checks used by the API.

The `session_album_photos` video INSERT declares 18 columns but supplies only 17 SQL value expressions. It also accepts 15 bind parameters while the statement contains only 14 placeholders. MySQL therefore rejects the INSERT and the API normalizes the untrusted database exception to `INTERNAL_ERROR`.

## Approved solution

Add the single missing bind placeholder immediately before the literal `'active'` status. Do not refactor the upload pipeline, moderation behavior, schema, or error normalization.

Add a regression assertion that captures the actual video INSERT and verifies both invariants:

- SQL column count equals SQL value-expression count.
- Placeholder count equals bound-parameter count.

## Verification and cleanup

Run the focused video service and server suites, then the wider D42 video checks. Publish through the repository's guarded CI release path, upload the 2-second test MP4 through the production mini-program, and verify the new video appears. Delete that media through the product UI and confirm the album returns to its original count. Delete the earlier failed test upload directly from COS and verify a subsequent HEAD returns `COS_OBJECT_NOT_FOUND`.

