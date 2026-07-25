import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { config } from "../src/config/env.js";
import * as service from "../src/modules/core/service.js";
import {
  decodePublicShareOrdinalCursor,
  encodePublicShareOrdinalCursor,
} from "../src/modules/core/public-album-share-manifest.js";
import { attachPublicSessionAlbumMediaUrls } from "../src/server.js";

const serverSource = await readFile(new URL("../src/legacy-app.js", import.meta.url), "utf8");

const shareClaims = {
  version: 2,
  shareId: 50,
  sessionId: 10,
  sharerUserId: 100,
  seatId: 1000
};

function legacyOffsetCursor(shareId, offset) {
  const payload = Buffer.from(JSON.stringify({ share_id: shareId, offset }))
    .toString("base64url");
  const signature = crypto
    .createHmac("sha256", config.sessionSecret)
    .update(`album-share-page:${payload}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

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
    media_ids: options.legacyMediaIds || mediaIds,
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
  const manifestItems = mediaIds.map((mediaId, ordinal) => ({
    ordinal,
    media_id: mediaId,
  }));
  const connection = {
    async query(sql, values = []) {
      if (sql.includes("FROM session_album_public_shares")) return [[share]];
      if (sql.includes("FROM session_album_public_share_items")) {
        if (sql.includes("ordinal > ?")) {
          const afterOrdinal = values[1];
          const limit = values[2];
          return [manifestItems
            .filter((item) => item.ordinal > afterOrdinal)
            .slice(0, limit)];
        }
        return [manifestItems];
      }
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
      if (sql.includes("FROM session_album_media_tags tag")) {
        return [values.slice(1).map((photoId) => ({
          id: Number(photoId),
          media_id: Number(photoId),
          kind: "role",
          seat_id: 1000,
          session_npc_role_id: null,
          canonical_label: "Sharer",
          privacy_user_id: 100,
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
  return { connection, mediaQueries, share };
}

test("public-share ordinal cursors are signed and bound to their share", () => {
  const cursor = encodePublicShareOrdinalCursor(50, 29);
  assert.match(cursor, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(
    decodePublicShareOrdinalCursor(cursor, 50, { maxOrdinal: 99 }),
    29,
  );
  assert.throws(
    () => decodePublicShareOrdinalCursor(cursor, 51, { maxOrdinal: 99 }),
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

test("public-share listing returns 100 snapshot photos in bounded, non-overlapping pages", async () => {
  const mediaIds = Array.from({ length: 100 }, (_, index) => index + 1);
  const fixture = publicSharePaginationConnection(mediaIds);
  const withDatabaseConnection = async (work) => work(fixture.connection);
  const events = [];
  const first = await service.listPublicSessionAlbumShare(shareClaims, {
    withDatabaseConnection,
    emitManifestEvent: (event, fields) => events.push({ event, ...fields }),
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
  assert.deepEqual(events, [{
    event: "public_share_manifest_page",
    sessionId: 10,
    shareId: 50,
    requestedLimit: 30,
    returnedCount: 30,
    scannedCount: 30,
    resultCode: "SUCCESS",
    durationMs: events[0].durationMs,
  }]);
  const attached = attachPublicSessionAlbumMediaUrls(first, shareClaims, "album-token");
  assert.equal(attached.visible_count, 100);
  assert.equal(attached.photos.length, 30);
  assert.equal(fourth.next_cursor, null);
  assert.equal(fourth.has_more, false);
  assert(fixture.mediaQueries.every((ids) => ids.length <= 30));
});

test("public-share listing accepts a valid legacy offset cursor but only emits ordinal cursors", async () => {
  const mediaIds = Array.from({ length: 40 }, (_, index) => index + 1);
  const fixture = publicSharePaginationConnection(mediaIds);
  const page = await service.listPublicSessionAlbumShare(shareClaims, {
    withDatabaseConnection: async (work) => work(fixture.connection),
    cursor: legacyOffsetCursor(50, 10),
    limit: 5,
  });

  assert.deepEqual(page.photos.map(({ id }) => id), [11, 12, 13, 14, 15]);
  const payload = JSON.parse(
    Buffer.from(page.next_cursor.split(".")[0], "base64url").toString("utf8"),
  );
  assert.deepEqual(payload, { share_id: 50, after_ordinal: 14 });
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
  assert.equal(
    decodePublicShareOrdinalCursor(first.next_cursor, 50, { maxOrdinal: 39 }),
    34,
  );
  assert(fixture.mediaQueries.every((ids) => ids.length <= 30));
});

test("public-share listing fails closed when normalized items differ from legacy JSON", async () => {
  const fixture = publicSharePaginationConnection([1, 2, 3], {
    legacyMediaIds: [1, 3, 2],
  });
  const events = [];

  await assert.rejects(
    () => service.listPublicSessionAlbumShare(shareClaims, {
      withDatabaseConnection: async (work) => work(fixture.connection),
      emitManifestEvent: (event, fields) => events.push({ event, ...fields }),
    }),
    (error) => error?.statusCode === 403,
  );
  assert.deepEqual(fixture.mediaQueries, []);
  assert.deepEqual(events.map(({ event, resultCode }) => ({ event, resultCode })), [
    {
      event: "public_share_manifest_mismatch",
      resultCode: "MANIFEST_MISMATCH",
    },
    {
      event: "public_share_manifest_page",
      resultCode: "MANIFEST_MISMATCH",
    },
  ]);
});

test("public-share listing audits malformed legacy JSON as a manifest mismatch", async () => {
  const fixture = publicSharePaginationConnection([1, 2, 3]);
  fixture.share.media_ids = "{";
  const events = [];

  await assert.rejects(
    () => service.listPublicSessionAlbumShare(shareClaims, {
      withDatabaseConnection: async (work) => work(fixture.connection),
      emitManifestEvent: (event, fields) => events.push({ event, ...fields }),
    }),
    (error) => error?.statusCode === 403,
  );
  assert.deepEqual(fixture.mediaQueries, []);
  assert.deepEqual(events.map(({ event, resultCode }) => ({ event, resultCode })), [
    {
      event: "public_share_manifest_mismatch",
      resultCode: "MANIFEST_MISMATCH",
    },
    {
      event: "public_share_manifest_page",
      resultCode: "MANIFEST_MISMATCH",
    },
  ]);
});

test("public-share listing rejects a signed ordinal beyond this manifest", async () => {
  const fixture = publicSharePaginationConnection([1, 2, 3]);
  const cursor = encodePublicShareOrdinalCursor(50, 9);

  await assert.rejects(
    () => service.listPublicSessionAlbumShare(shareClaims, {
      withDatabaseConnection: async (work) => work(fixture.connection),
      cursor,
    }),
    (error) => error?.statusCode === 400,
  );
  assert.deepEqual(fixture.mediaQueries, []);
});

test("public-share route forwards cursor and limit to the paged service", () => {
  const route = serverSource.slice(
    serverSource.indexOf("const publicSessionAlbumShareId"),
    serverSource.indexOf("const albumUploadStatusId")
  );
  assert.match(route, /publicShareManifest\.list \|\| listPublicSessionAlbumShare/);
  assert.match(route, /\)\(claims, \{/);
  assert.match(route, /cursor:\s*url\.searchParams\.get\("cursor"\)/);
  assert.match(route, /limit:\s*url\.searchParams\.get\("limit"\)/);
  assert.match(route, /emitManifestEvent/);
});
