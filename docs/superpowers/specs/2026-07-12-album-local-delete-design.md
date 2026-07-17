# Album Local Delete Design

## Goal

Remove a successfully deleted album photo or video from the current client state without reloading the album page or resetting its scroll position and filters.

## Behavior

After `DELETE /api/session-album/photos/:id` succeeds, the album page removes only the deleted media from local state. It does not call `loadAlbum()`.

- Remove the media from `photos`, `previewPhotos`, waterfall inputs, selected IDs, and visible-media caches.
- If the deleted media is the item currently open in the image viewer, close the viewer. If another media is open, keep the viewer and preserve the logical current item.
- Rebuild only the waterfall data so the displayed cards and derived filter/role counters update.
- Preserve active album and role filters, scroll position, already loaded media URLs, and unrelated cards.
- If the delete request fails, leave all local media state untouched and keep the existing failure message.

## Boundaries

The server remains authoritative for deletion, COS cleanup, and authorization. The client performs no optimistic removal and changes local state only after the HTTP request returns success.

This applies to both image and video cards. It does not change upload, tagging, bulk download, privacy, or sharing behavior.

## State Transition

`deletePhoto` will call a dedicated local removal helper after the successful request. The helper uses the deleted ID to prune all associated collections and caches, decides whether the active preview must close, then refreshes the waterfall. It leaves `statusText` clear and lets existing computed counters derive from the reduced `photos` list.

## Testing

Add a focused album-page regression check that proves:

- the successful delete path does not call `loadAlbum()`;
- the deleted ID is absent from photos, previews, selection, and media caches;
- a deleted active preview closes while another active preview remains open;
- failed deletion does not invoke the local removal helper.
