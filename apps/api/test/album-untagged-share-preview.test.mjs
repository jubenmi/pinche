import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeImplicitUntaggedMedia,
  publicShareSnapshotDigest
} from "../src/modules/core/service.js";

const claims = {
  sessionId: 10,
  sharerUserId: 100,
  seatId: 1000,
  mediaIds: [1],
  coverMediaIds: []
};

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
