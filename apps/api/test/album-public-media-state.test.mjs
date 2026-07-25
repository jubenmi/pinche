import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { forbidden } from "../src/http/errors.js";
import {
  PUBLIC_MEDIA_STATE_BATCH_LIMIT,
  emitPublicMediaStateTelemetry,
  normalizePublicMediaStateIds,
  readPublicAlbumMediaState,
} from "../src/modules/core/public-album-media-state.js";
import {
  publicShareSnapshotDigest,
  readPublicSessionAlbumMediaState,
} from "../src/modules/core/service.js";
import {
  attachPublicSessionAlbumMediaStateUrls,
  createApp,
} from "../src/server.js";

const legacySource = await readFile(
  new URL("../src/legacy-app.js", import.meta.url),
  "utf8",
);

const claims = {
  version: 2,
  shareId: 50,
  sessionId: 10,
  sharerUserId: 100,
  seatId: 1000,
  exp: 2_000_000_000,
};

function media(id, overrides = {}) {
  return {
    id,
    session_id: 10,
    uploader_user_id: 100,
    status: "active",
    moderation_status: "approved",
    media_type: "image",
    processing_status: "ready",
    tag_version: 0,
    created_at: `2026-07-26T00:00:0${id}.000Z`,
    image_width: 1200,
    image_height: 800,
    image_content_type: "image/jpeg",
    ...overrides,
  };
}

function mediaStateConnection(options = {}) {
  const queryKinds = [];
  const state = { roleLabel: options.roleLabel || "沈清商" };
  const share = {
    id: 50,
    session_id: 10,
    sharer_user_id: 100,
    seat_id: 1000,
    media_ids: [1, 2, 3],
    implicit_untagged_media: [],
    cover_media_ids: [],
    expires_at: "2099-01-01T00:00:00.000Z",
    revoked_at: null,
  };
  share.snapshot_digest = publicShareSnapshotDigest({
    sessionId: share.session_id,
    sharerUserId: share.sharer_user_id,
    seatId: share.seat_id,
    mediaIds: share.media_ids,
    coverMediaIds: share.cover_media_ids,
  });
  const photos = [media(1), media(3)];
  const items = share.media_ids.map((mediaId, ordinal) => ({
    ordinal,
    media_id: mediaId,
  }));

  const connection = {
    async query(sql, values = []) {
      if (sql.includes("FROM session_album_public_shares")) {
        queryKinds.push("share");
        return [options.revoked || options.expired ? [] : [share]];
      }
      if (sql.includes("FROM session_album_public_share_items")) {
        queryKinds.push("items");
        return [items];
      }
      if (sql.includes("FROM sessions session")) {
        queryKinds.push("session");
        return [[{
          id: 10,
          status: "completed",
          script_name_snapshot: "雾都夜行",
          store_name_snapshot: "测试店",
          start_at: "2026-07-26T12:00:00.000Z",
        }]];
      }
      if (sql.includes("FROM session_seats") && sql.includes("confirmed_user_id")) {
        queryKinds.push("seat");
        return [[{
          id: 1000,
          name: "旧角色",
          role_name: state.roleLabel,
          confirmed_user_id: 100,
          status: "confirmed",
        }]];
      }
      if (sql.includes("FROM session_album_photos photo")) {
        queryKinds.push("visibility:media");
        const requested = new Set(values.slice(1).map(Number));
        return [photos.filter((photo) => requested.has(Number(photo.id)))];
      }
      if (sql.includes("FROM session_album_media_tags tag")) {
        queryKinds.push("visibility:tags");
        const requested = new Set(values.slice(1).map(Number));
        return [[
          {
            media_id: 1,
            kind: "role",
            seat_id: 1000,
            session_npc_role_id: null,
            canonical_label: state.roleLabel,
            privacy_user_id: 100,
          },
          {
            media_id: 3,
            kind: "npc_role",
            seat_id: null,
            session_npc_role_id: 900,
            canonical_label: "阿离",
            privacy_user_id: 200,
          },
          {
            media_id: 3,
            kind: "other",
            seat_id: null,
            session_npc_role_id: null,
            canonical_label: null,
            privacy_user_id: null,
          },
        ].filter((row) => requested.has(row.media_id))];
      }
      if (sql.includes("FROM session_album_privacy")) {
        queryKinds.push("visibility:privacy");
        return [[]];
      }
      throw new Error(`Unexpected media-state query: ${sql}`);
    },
  };
  return { connection, queryKinds, state };
}

test("normalizePublicMediaStateIds is strict, stable, deduplicated, and bounded after dedupe", () => {
  assert.equal(PUBLIC_MEDIA_STATE_BATCH_LIMIT, 100);
  assert.deepEqual(normalizePublicMediaStateIds([3, 1, 3]), [3, 1]);
  const oneHundred = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.deepEqual(normalizePublicMediaStateIds([...oneHundred, 100]), oneHundred);
  assert.throws(
    () => normalizePublicMediaStateIds([...oneHundred, 101]),
    /at most 100/i,
  );
  for (const value of [
    null,
    [],
    "1",
    ["1"],
    [0],
    [-1],
    [1.5],
    [Number.MAX_SAFE_INTEGER + 1],
  ]) {
    assert.throws(() => normalizePublicMediaStateIds(value), /media_ids/i);
  }
});

test("readPublicAlbumMediaState rejects manifest outsiders before visibility reads", async () => {
  let visibilityReads = 0;
  await assert.rejects(
    () => readPublicAlbumMediaState({
      connection: {},
      claims,
      mediaIds: [1, 9],
      loadShare: async () => ({
        items: [
          { ordinal: 0, media_id: 1 },
          { ordinal: 1, media_id: 2 },
        ],
      }),
      readVisibleMedia: async () => {
        visibilityReads += 1;
        return [];
      },
    }),
    (error) => error?.statusCode === 403,
  );
  assert.equal(visibilityReads, 0);
});

test("readPublicAlbumMediaState maps missing manifest tombstones to unavailable IDs", async () => {
  const result = await readPublicAlbumMediaState({
    connection: {},
    claims,
    mediaIds: [1, 2],
    loadShare: async () => ({
      items: [
        { ordinal: 0, media_id: 1 },
        { ordinal: 1, media_id: 2 },
      ],
    }),
    readVisibleMedia: async (_connection, _claims, requestedIds) => [
      { id: requestedIds[0], public_tag_labels: ["沈清商"] },
    ],
  });

  assert.deepEqual(result, {
    patches: [{ id: 1, public_tag_labels: ["沈清商"] }],
    unavailable_ids: [2],
  });
});

test("service authorizes items first and returns current role, NPC, and other labels", async () => {
  const fixture = mediaStateConnection();
  const options = {
    withDatabaseConnection: async (work) => work(fixture.connection),
  };

  const first = await readPublicSessionAlbumMediaState(claims, [1, 2, 3], options);
  assert.deepEqual(first.patches.map(({ id }) => id), [1, 3]);
  assert.deepEqual(first.patches[0].public_tag_labels, ["沈清商"]);
  assert.deepEqual(first.patches[1].public_tag_labels, ["阿离", "其他"]);
  assert.deepEqual(first.unavailable_ids, [2]);
  assert.equal("uploader_user_id" in first.patches[0], false);
  assert.equal("tags" in first.patches[0], true);
  assert.deepEqual(first.patches[0].tags, []);
  assert(fixture.queryKinds.indexOf("items") < fixture.queryKinds.indexOf("visibility:media"));

  fixture.state.roleLabel = "顾清河";
  const renamed = await readPublicSessionAlbumMediaState(claims, [1], options);
  assert.deepEqual(renamed.patches[0].public_tag_labels, ["顾清河"]);
});

test("service rejects outsider, revoked, and expired shares without visibility SQL", async () => {
  for (const testCase of [
    { fixture: mediaStateConnection(), mediaIds: [9] },
    { fixture: mediaStateConnection({ revoked: true }), mediaIds: [1] },
    { fixture: mediaStateConnection({ expired: true }), mediaIds: [1] },
  ]) {
    await assert.rejects(
      () => readPublicSessionAlbumMediaState(claims, testCase.mediaIds, {
        withDatabaseConnection: async (work) => work(testCase.fixture.connection),
      }),
      (error) => [400, 403].includes(error?.statusCode),
    );
    assert.equal(
      testCase.fixture.queryKinds.some((kind) => kind.startsWith("visibility:")),
      false,
    );
  }
});

test("public media-state URL attachment strips internal fields and returns expiring image/video URLs", () => {
  const attached = attachPublicSessionAlbumMediaStateUrls({
    patches: [
      {
        ...media(1),
        public_tag_labels: ["沈清商"],
        storage_object_key: "private/image-1.jpg",
        storage_object_etag: "private-etag",
      },
      {
        ...media(3, {
          media_type: "video",
          has_cover: true,
          video_cover_source_url: "/uploads/session-album/videos/display/private.mp4",
          display_url: "/uploads/session-album/videos/display/private.mp4",
        }),
        public_tag_labels: ["阿离", "其他"],
      },
    ],
    unavailable_ids: [2],
  }, claims, "album-token");

  assert.deepEqual(attached.unavailable_ids, [2]);
  assert.match(attached.patches[0].preview_display_url, /public-share\/photos\/1\/image\?token=/);
  assert.match(attached.patches[0].thumbnail_display_url, /variant=thumbnail/);
  assert.match(attached.patches[1].cover_url, /public-share\/media\/3\/cover\?token=/);
  assert.match(attached.patches[1].video_url, /public-share\/media\/3\/video-file\?token=/);
  assert(Number.isFinite(Date.parse(attached.patches[0].media_url_expires_at)));
  assert(Number.isFinite(Date.parse(attached.patches[1].media_url_expires_at)));
  const serialized = JSON.stringify(attached);
  for (const canary of [
    "private/image-1.jpg",
    "private-etag",
    "/uploads/session-album/videos/display/private.mp4",
  ]) {
    assert.equal(serialized.includes(canary), false);
  }
  assert.equal("uploader_user_id" in attached.patches[0], false);
});

test("public media-state telemetry emits only the approved numeric counters", () => {
  const events = [];
  emitPublicMediaStateTelemetry({
    sessionId: 10,
    shareId: 50,
    requestedCount: 3,
    patchCount: 2,
    unavailableCount: 1,
    durationMs: 12.5,
    token: "TOKEN_CANARY",
    labels: ["LABEL_CANARY"],
    url: "URL_CANARY",
  }, (line) => events.push(JSON.parse(line)));

  assert.deepEqual(events, [{
    event: "public_media_state_refresh",
    sessionId: 10,
    shareId: 50,
    requestedCount: 3,
    patchCount: 2,
    unavailableCount: 1,
    durationMs: 12.5,
  }]);
});

test("POST media-state verifies token/session, returns safe patches, and emits safe telemetry", async () => {
  const telemetry = [];
  const reads = [];
  const app = createApp({
    publicMediaState: {
      verifyShareToken(token) {
        assert.equal(token, "album-token");
        return claims;
      },
      async read(claimsArg, mediaIds) {
        reads.push({ claims: claimsArg, mediaIds });
        if (mediaIds.includes(9)) {
          throw forbidden("Album share media is unavailable");
        }
        return {
          patches: [{
            ...media(1),
            public_tag_labels: ["沈清商"],
          }],
          unavailable_ids: [2],
        };
      },
      emit(fields) {
        telemetry.push(fields);
      },
    },
  });
  try {
    await new Promise((resolve, reject) => app.listen(0, "127.0.0.1", (error) => {
      if (error) reject(error);
      else resolve();
    }));
    const { port } = app.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/sessions/10/album/public-share/media-state?token=album-token`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ media_ids: [1, 2, 1] }),
      },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(reads, [{ claims, mediaIds: [1, 2] }]);
    assert.deepEqual(payload.data.unavailable_ids, [2]);
    assert.match(payload.data.patches[0].preview_display_url, /token=/);
    assert.equal("uploader_user_id" in payload.data.patches[0], false);
    assert.equal(telemetry.length, 1);
    assert.equal(telemetry[0].requestedCount, 2);
    assert.deepEqual(Object.keys(telemetry[0]).sort(), [
      "durationMs",
      "patchCount",
      "requestedCount",
      "sessionId",
      "shareId",
      "unavailableCount",
    ]);

    const wrongSession = await fetch(
      `http://127.0.0.1:${port}/api/sessions/11/album/public-share/media-state?token=album-token`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ media_ids: [1] }),
      },
    );
    assert.equal(wrongSession.status, 403);
    assert.equal(reads.length, 1);

    const unavailable = await fetch(
      `http://127.0.0.1:${port}/api/sessions/10/album/public-share/media-state?token=album-token`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ media_ids: [9, 9] }),
      },
    );
    assert.equal(unavailable.status, 403);
    assert.equal(reads.length, 2);
    assert.equal(telemetry.length, 3);
    assert.deepEqual(telemetry.slice(1), [
      {
        sessionId: 11,
        shareId: 50,
        requestedCount: 0,
        patchCount: 0,
        unavailableCount: 0,
        durationMs: telemetry[1].durationMs,
      },
      {
        sessionId: 10,
        shareId: 50,
        requestedCount: 1,
        patchCount: 0,
        unavailableCount: 0,
        durationMs: telemetry[2].durationMs,
      },
    ]);

    const nullBody = await fetch(
      `http://127.0.0.1:${port}/api/sessions/10/album/public-share/media-state?token=album-token`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      },
    );
    assert.equal(nullBody.status, 400);
    assert.equal(reads.length, 2);
    assert.deepEqual(telemetry[3], {
      sessionId: 10,
      shareId: 50,
      requestedCount: 0,
      patchCount: 0,
      unavailableCount: 0,
      durationMs: telemetry[3].durationMs,
    });
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }

  const route = legacySource.slice(
    legacySource.indexOf("const publicSessionAlbumMediaStateId"),
    legacySource.indexOf("const publicSessionAlbumShareId"),
  );
  assert.match(route, /assertPublicResponseSafe/);
  assert.match(route, /body\.media_ids/);
});
