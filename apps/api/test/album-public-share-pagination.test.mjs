import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as service from "../src/modules/core/service.js";

const serverSource = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

const shareClaims = {
  version: 2,
  shareId: 50,
  sessionId: 10,
  sharerUserId: 100,
  seatId: 1000
};

function publicSharePaginationConnection(mediaIds, options = {}) {
  const unavailableIds = new Set(options.unavailableIds || []);
  const photos = mediaIds.map((id) => ({
    id,
    session_id: 10,
    uploader_user_id: 100,
    status: "active",
    moderation_status: "approved",
    media_type: "image",
    processing_status: "ready",
    photo_url: `/photos/${id}.jpg`,
    image_width: 1200,
    image_height: 800,
    created_at: new Date(Date.UTC(2026, 6, 19, 0, 0, id)).toISOString()
  }));
  const share = {
    id: 50,
    session_id: 10,
    sharer_user_id: 100,
    seat_id: 1000,
    media_ids: mediaIds,
    cover_media_ids: mediaIds.slice(0, 9),
    implicit_untagged_media: [],
    expires_at: "2099-01-01T00:00:00.000Z",
    revoked_at: null
  };
  share.snapshot_digest = service.publicShareSnapshotDigest({
    sessionId: share.session_id,
    sharerUserId: share.sharer_user_id,
    seatId: share.seat_id,
    mediaIds: share.media_ids,
    coverMediaIds: share.cover_media_ids
  });
  const mediaQueries = [];
  const connection = {
    async query(sql, values = []) {
      if (sql.includes("FROM session_album_public_shares")) return [[share]];
      if (sql.includes("FROM sessions session")) {
        return [[{
          id: 10,
          status: "completed",
          organizer_user_id: 100,
          script_name_snapshot: "雾都夜行",
          store_name_snapshot: "测试店",
          start_at: "2026-07-19T12:00:00.000Z"
        }]];
      }
      if (sql.includes("FROM users account")) return [[{ nickname: "Sharer", avatar_url: "" }]];
      if (sql.includes("FROM session_album_photo_tags")) {
        return [values.map((photoId) => ({
          id: Number(photoId),
          photo_id: Number(photoId),
          tag_type: "seat",
          seat_id: 1000,
          user_id: 100,
          seat_user_id: 100,
          sort_order: 0
        }))];
      }
      if (sql.includes("FROM session_album_privacy")) return [[]];
      if (sql.includes("FROM session_album_photos photo")) {
        const requestedIds = values.slice(1).map(Number);
        mediaQueries.push(requestedIds);
        return [photos.filter((photo) =>
          requestedIds.includes(photo.id) && !unavailableIds.has(photo.id)
        )];
      }
      if (sql.includes("FROM session_seats")) {
        return [[{
          id: 1000,
          name: "Sharer",
          role_name: "Sharer",
          confirmed_user_id: 100,
          status: "confirmed"
        }]];
      }
      throw new Error(`Unexpected public-share query: ${sql}`);
    }
  };
  return { connection, mediaQueries };
}

test("public-share page cursors are signed and bound to their share", () => {
  assert.equal(typeof service.encodePublicSharePageCursor, "function");
  assert.equal(typeof service.decodePublicSharePageCursor, "function");

  const cursor = service.encodePublicSharePageCursor(50, 30);
  assert.match(cursor, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(service.decodePublicSharePageCursor(cursor, 50), 30);
  assert.throws(
    () => service.decodePublicSharePageCursor(cursor, 51),
    (error) => error?.statusCode === 400 && error?.message === "Invalid album share cursor"
  );
});

test("public-share listing uses the supplied connection seam", async () => {
  let invoked = false;
  await assert.rejects(
    () => service.listPublicSessionAlbumShare(
      { version: 2, shareId: 50, sessionId: 10, sharerUserId: 100, seatId: 1000 },
      {
        withDatabaseConnection: async (work) => {
          invoked = true;
          return work({ async query() { throw new Error("fixture listing query"); } });
        }
      }
    ),
    /fixture listing query/
  );
  assert.equal(invoked, true);
});

test("public-share snapshot pages are bounded, sequential, and complete", () => {
  assert.equal(typeof service.publicShareSnapshotPage, "function");
  const mediaIds = Array.from({ length: 100 }, (_, index) => index + 1);
  const first = service.publicShareSnapshotPage(mediaIds, 50);
  const second = service.publicShareSnapshotPage(mediaIds, 50, { cursor: first.next_cursor });
  const fourth = service.publicShareSnapshotPage(mediaIds, 50, {
    cursor: service.publicShareSnapshotPage(mediaIds, 50, { cursor: second.next_cursor }).next_cursor
  });

  assert.deepEqual(first.media_ids, mediaIds.slice(0, 30));
  assert.deepEqual(second.media_ids, mediaIds.slice(30, 60));
  assert.deepEqual(fourth.media_ids, mediaIds.slice(90, 100));
  assert.equal(fourth.next_cursor, null);
  assert.equal(fourth.has_more, false);
});

test("public-share listing returns 100 snapshot photos in bounded, non-overlapping pages", async () => {
  const mediaIds = Array.from({ length: 100 }, (_, index) => index + 1);
  const fixture = publicSharePaginationConnection(mediaIds);
  const withDatabaseConnection = async (work) => work(fixture.connection);
  const first = await service.listPublicSessionAlbumShare(shareClaims, {
    withDatabaseConnection
  });
  const second = await service.listPublicSessionAlbumShare(shareClaims, {
    withDatabaseConnection,
    cursor: first.next_cursor
  });
  const third = await service.listPublicSessionAlbumShare(shareClaims, {
    withDatabaseConnection,
    cursor: second.next_cursor
  });
  const fourth = await service.listPublicSessionAlbumShare(shareClaims, {
    withDatabaseConnection,
    cursor: third.next_cursor
  });

  assert.deepEqual(first.photos.map(({ id }) => id), mediaIds.slice(0, 30));
  assert.deepEqual(second.photos.map(({ id }) => id), mediaIds.slice(30, 60));
  assert.deepEqual(third.photos.map(({ id }) => id), mediaIds.slice(60, 90));
  assert.deepEqual(fourth.photos.map(({ id }) => id), mediaIds.slice(90, 100));
  assert.equal(first.visible_count, 100);
  assert.equal(fourth.next_cursor, null);
  assert.equal(fourth.has_more, false);
  assert(fixture.mediaQueries.every((ids) => ids.length <= 30));
});

test("public-share listing fills a page after earlier snapshot photos become unavailable", async () => {
  const mediaIds = Array.from({ length: 40 }, (_, index) => index + 1);
  const fixture = publicSharePaginationConnection(mediaIds, {
    unavailableIds: [1, 2, 3, 4, 5]
  });
  const first = await service.listPublicSessionAlbumShare(shareClaims, {
    withDatabaseConnection: async (work) => work(fixture.connection)
  });

  assert.deepEqual(first.photos.map(({ id }) => id), mediaIds.slice(5, 35));
  assert.equal(first.has_more, true);
  assert(fixture.mediaQueries.every((ids) => ids.length <= 30));
});

test("public-share route forwards cursor and limit to the paged service", () => {
  const route = serverSource.slice(
    serverSource.indexOf("const publicSessionAlbumShareId"),
    serverSource.indexOf("const albumUploadStatusId")
  );
  assert.match(route, /listPublicSessionAlbumShare\(claims, \{/);
  assert.match(route, /cursor:\s*url\.searchParams\.get\("cursor"\)/);
  assert.match(route, /limit:\s*url\.searchParams\.get\("limit"\)/);
});
