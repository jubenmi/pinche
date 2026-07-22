import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createOrReuseSessionAlbumPublicShare,
  normalizeImplicitUntaggedMedia,
  publicShareSnapshotDigest,
  selectPublicShareMedia
} from "../src/modules/core/service.js";

const claims = {
  sessionId: 10,
  sharerUserId: 100,
  seatId: 1000,
  mediaIds: [1],
  coverMediaIds: []
};

function media(id, overrides = {}) {
  return {
    id,
    session_id: 10,
    uploader_user_id: 100,
    media_type: "image",
    status: "active",
    moderation_status: "approved",
    processing_status: "ready",
    tag_version: 2,
    created_at: new Date(Date.UTC(2026, 6, 22, 0, 0, id)).toISOString(),
    ...overrides
  };
}

function untaggedShareConnection(photoRows) {
  const shares = [];
  const seat = {
    id: 1000,
    name: "Sharer",
    role_name: "Sharer",
    confirmed_user_id: 100,
    status: "confirmed",
    sharer_nickname: "Sharer",
    sharer_avatar_url: ""
  };
  return {
    shares,
    async query(sql, values = []) {
      if (sql.includes("FROM sessions session")) {
        return [[{ id: 10, organizer_user_id: 100 }]];
      }
      if (sql.includes("FROM session_seats seat") && sql.includes("JOIN users account")) {
        return [[seat]];
      }
      if (sql.includes("FROM session_album_photos photo")) return [photoRows];
      if (sql.includes("FROM session_album_photo_tags tag")) return [[]];
      if (sql.includes("FROM session_album_privacy")) return [[]];
      if (sql.includes("FROM session_album_public_shares") && sql.includes("snapshot_digest")) {
        return [[shares.find((share) => share.snapshot_digest === values[3])].filter(Boolean)];
      }
      if (sql.includes("INSERT INTO session_album_public_shares")) {
        const share = {
          id: shares.length + 1,
          session_id: values[0],
          sharer_user_id: values[1],
          seat_id: values[2],
          media_ids: values[3],
          implicit_untagged_media: values[4],
          snapshot_digest: values[5],
          cover_media_ids: values[6],
          expires_at: values[7],
          revoked_at: null
        };
        shares.push(share);
        return [{ insertId: share.id }];
      }
      if (sql.includes("SELECT * FROM session_album_public_shares WHERE id = ?")) {
        return [[shares.find((share) => Number(share.id) === Number(values[0]))].filter(Boolean)];
      }
      throw new Error(`Unexpected untagged share test query: ${sql}`);
    }
  };
}

function privacy(entries) {
  return new Map(entries.map(([userId, overrides = {}]) => [userId, {
    allow_uploaded_visible: true,
    allow_tagged_visible: true,
    ...overrides
  }]));
}

function sharerSeatTag() {
  return {
    tag_type: "seat",
    seat_id: 1000,
    user_id: 100,
    seat_user_id: 100
  };
}

test("D52 migration adds tag versions and snapshot-local untagged entries", async () => {
  const migrationSql = await readFile(
    new URL("../migrations/0033_album_untagged_share_preview.sql", import.meta.url),
    "utf8"
  );

  assert.match(
    migrationSql,
    /ADD COLUMN tag_version BIGINT UNSIGNED NOT NULL DEFAULT 0/
  );
  assert.match(
    migrationSql,
    /ADD COLUMN implicit_untagged_media JSON NULL/
  );
});

test("snapshot digest is backward compatible and binds implicit tag versions", () => {
  const legacy = publicShareSnapshotDigest(claims);
  assert.equal(
    publicShareSnapshotDigest({ ...claims, implicitUntaggedMedia: [] }),
    legacy
  );
  const versionOne = publicShareSnapshotDigest({
    ...claims,
    implicitUntaggedMedia: [{ media_id: 1, tag_version: 1 }]
  });
  const versionTwo = publicShareSnapshotDigest({
    ...claims,
    implicitUntaggedMedia: [{ media_id: 1, tag_version: 2 }]
  });
  assert.notEqual(versionOne, legacy);
  assert.notEqual(versionTwo, versionOne);
});

test("implicit untagged entries are normalized as a bounded media subset", () => {
  assert.deepEqual(
    normalizeImplicitUntaggedMedia(
      '[{"media_id":1,"tag_version":0}]',
      { subsetOf: [1, 2] }
    ),
    [{ media_id: 1, tag_version: 0 }]
  );
  assert.deepEqual(normalizeImplicitUntaggedMedia(null), []);
  for (const invalid of [
    [{ media_id: 0, tag_version: 0 }],
    [{ media_id: 1, tag_version: -1 }],
    [{ media_id: 1, tag_version: 0 }, { media_id: 1, tag_version: 1 }]
  ]) {
    assert.throws(() => normalizeImplicitUntaggedMedia(invalid, { subsetOf: [1] }));
  }
  assert.throws(() => normalizeImplicitUntaggedMedia(
    [{ media_id: 2, tag_version: 0 }],
    { subsetOf: [1] }
  ));
});

test("owned untagged images require the explicit share option", () => {
  const owned = media(9);
  const tags = new Map([[9, []]]);
  const privacyByUser = privacy([[100]]);

  assert.deepEqual(
    selectPublicShareMedia([owned], tags, privacyByUser, claims),
    []
  );
  assert.deepEqual(
    selectPublicShareMedia([owned], tags, privacyByUser, claims, {
      allowOwnedUntaggedImages: true
    }).map((item) => item.id),
    [9]
  );
});

test("other users, videos and uploader privacy veto stay excluded when untagged", () => {
  const cases = [
    [media(10, { uploader_user_id: 200 }), privacy([[100], [200]])],
    [media(11, { media_type: "video" }), privacy([[100]])],
    [media(12), privacy([[100, { allow_uploaded_visible: false }]])]
  ];

  for (const [candidate, privacyByUser] of cases) {
    assert.deepEqual(
      selectPublicShareMedia(
        [candidate],
        new Map([[candidate.id, []]]),
        privacyByUser,
        claims,
        { allowOwnedUntaggedImages: true }
      ),
      []
    );
  }
});

test("owned untagged images rank after tagged groups but a focused target is seeded", () => {
  const tagged = media(20, { created_at: "2026-07-20T00:00:00.000Z" });
  const untagged = media(21, { created_at: "2026-07-22T00:00:00.000Z" });
  const candidates = [untagged, tagged];
  const tags = new Map([[20, [sharerSeatTag()]], [21, []]]);
  const privacyByUser = privacy([[100]]);

  assert.deepEqual(
    selectPublicShareMedia(candidates, tags, privacyByUser, claims, {
      allowOwnedUntaggedImages: true
    }).map((item) => item.id),
    [20, 21]
  );
  assert.deepEqual(
    selectPublicShareMedia(candidates, tags, privacyByUser, claims, {
      allowOwnedUntaggedImages: true,
      requiredMediaId: 21
    }).map((item) => item.id),
    [21, 20]
  );
});

test("share creation persists and reuses snapshot-local untagged versions", async () => {
  const connection = untaggedShareConnection([media(30, { tag_version: 7 })]);
  const options = {
    includeOwnedUntaggedImages: true,
    withTransaction: async (work) => work(connection)
  };

  const first = await createOrReuseSessionAlbumPublicShare(
    { user: { id: 100 } },
    10,
    options
  );
  const second = await createOrReuseSessionAlbumPublicShare(
    { user: { id: 100 } },
    10,
    options
  );

  assert.equal(connection.shares.length, 1);
  assert.deepEqual(first.media_ids, [30]);
  assert.deepEqual(first.implicit_untagged_media, [
    { media_id: 30, tag_version: 7 }
  ]);
  assert.equal(first.implicit_untagged_count, 1);
  assert.equal(second.share_id, first.share_id);
});
