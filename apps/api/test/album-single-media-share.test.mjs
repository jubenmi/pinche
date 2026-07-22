import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createOrReuseSessionAlbumPublicShare,
  getPublicSessionAlbumVideoForPlayback,
  publicShareSnapshotDigest,
  selectPublicShareMedia
} from "../src/modules/core/service.js";
import * as coreService from "../src/modules/core/service.js";
import {
  createApp,
  createPublicAlbumVideoResponse,
  signSessionAlbumPublicVideoFileToken,
  verifySessionAlbumPublicVideoFileQuery
} from "../src/server.js";

const [serviceSource, serverSource] = await Promise.all([
  readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8"),
  readFile(new URL("../src/server.js", import.meta.url), "utf8")
]);

const claims = { sessionId: 10, sharerUserId: 100, seatId: 1000 };

function openPrivacy(userIds) {
  return new Map(userIds.map((userId) => [userId, {
    allow_uploaded_visible: true,
    allow_tagged_visible: true
  }]));
}

function eligibleMedia(id, overrides = {}) {
  return {
    id,
    session_id: 10,
    uploader_user_id: 100,
    status: "active",
    moderation_status: "approved",
    media_type: "image",
    processing_status: "ready",
    created_at: new Date(Date.UTC(2026, 6, 19, 0, 0, id)).toISOString(),
    ...overrides
  };
}

function sharerSeatTag() {
  return {
    tag_type: "seat",
    seat_id: 1000,
    user_id: 100,
    seat_user_id: 100
  };
}

function tagsFor(candidates) {
  return new Map(candidates.map((media) => [Number(media.id), [sharerSeatTag()]]));
}

test("public media category distinguishes the shared role from safe other content", () => {
  assert.equal(typeof coreService.publicAlbumMediaCategory, "function");
  assert.equal(
    coreService.publicAlbumMediaCategory([sharerSeatTag()], claims),
    "share_subject"
  );
  assert.equal(
    coreService.publicAlbumMediaCategory(
      [{ tag_type: "other", user_id: null }],
      claims
    ),
    "other"
  );
  assert.equal(
    coreService.publicAlbumMediaCategory(
      [{ tag_type: "session_npc_role", user_id: null }],
      claims
    ),
    "other"
  );
});

test("public media response exposes only the safe category and keeps raw tags private", () => {
  assert.equal(typeof coreService.publicAlbumMediaResponse, "function");
  const otherTag = { tag_type: "other", user_id: null, label: "内部标签" };
  const response = coreService.publicAlbumMediaResponse(
    eligibleMedia(41),
    [otherTag],
    claims
  );

  assert.equal(response.public_category, "other");
  assert.deepEqual(response.tags, []);
  assert.equal(JSON.stringify(response).includes(otherTag.label), false);
});

function focusedShareConnection(photoRows, tagRows) {
  const shares = [];
  const session = { id: 10, organizer_user_id: 100 };
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
      if (sql.includes("FROM sessions session")) return [[session]];
      if (sql.includes("FROM session_seats seat") && sql.includes("JOIN users account")) {
        return [[seat]];
      }
      if (sql.includes("FROM session_album_photos photo")) return [photoRows];
      if (sql.includes("FROM session_album_photo_tags tag")) return [tagRows];
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
      throw new Error(`Unexpected focused share test query: ${sql}`);
    }
  };
}

test("selectPublicShareMedia seeds an eligible required image and keeps the 30-media cap", () => {
  const candidates = Array.from({ length: 35 }, (_, index) => eligibleMedia(index + 1));
  const selected = selectPublicShareMedia(
    candidates,
    tagsFor(candidates),
    openPrivacy([100]),
    claims,
    { requiredMediaId: 1 }
  );

  assert.equal(selected[0].id, 1);
  assert.equal(selected.length, 30);
  assert.equal(new Set(selected.map((media) => media.id)).size, 30);
});

test("selectPublicShareMedia includes a required ready video and counts it toward the three-video cap", () => {
  const candidates = [
    eligibleMedia(100, { media_type: "video", created_at: "2026-07-19T00:00:00.000Z" }),
    ...Array.from({ length: 5 }, (_, index) => eligibleMedia(index + 1, {
      media_type: "video",
      created_at: new Date(Date.UTC(2026, 6, 19, 0, 1, index + 1)).toISOString()
    })),
    ...Array.from({ length: 30 }, (_, index) => eligibleMedia(index + 200, {
      created_at: new Date(Date.UTC(2026, 6, 18, 0, 0, index + 1)).toISOString()
    }))
  ];
  const selected = selectPublicShareMedia(
    candidates,
    tagsFor(candidates),
    openPrivacy([100]),
    claims,
    { requiredMediaId: 100 }
  );

  assert.equal(selected.some((media) => media.id === 100), true);
  assert.equal(selected.filter((media) => media.media_type === "video").length, 3);
});

test("selectPublicShareMedia does not include absent or noneligible required media", () => {
  const candidates = [
    ...Array.from({ length: 4 }, (_, index) => eligibleMedia(index + 1)),
    eligibleMedia(99, { moderation_status: "pending" })
  ];
  const tags = tagsFor(candidates);
  const privacy = openPrivacy([100]);

  for (const requiredMediaId of [999, 99]) {
    const selected = selectPublicShareMedia(candidates, tags, privacy, claims, { requiredMediaId });
    assert.equal(selected.some((media) => media.id === requiredMediaId), false);
  }
});

test("selectPublicShareMedia without options preserves D48 ranking order", () => {
  const candidates = [
    eligibleMedia(1, { created_at: "2026-07-19T00:00:01.000Z" }),
    eligibleMedia(2, { created_at: "2026-07-19T00:00:03.000Z" }),
    eligibleMedia(3, {
      uploader_user_id: 200,
      created_at: "2026-07-19T00:00:04.000Z"
    }),
    eligibleMedia(4, { created_at: "2026-07-19T00:00:02.000Z" })
  ];
  const tags = new Map([
    [1, [sharerSeatTag()]],
    [2, [sharerSeatTag()]],
    [3, [sharerSeatTag()]],
    [4, [{ tag_type: "other", user_id: null }]]
  ]);

  assert.deepEqual(
    selectPublicShareMedia(candidates, tags, openPrivacy([100, 200]), claims)
      .map((media) => media.id),
    [2, 1, 3, 4]
  );
});

test("createOrReuseSessionAlbumPublicShare persists and reuses an eligible focused snapshot", async () => {
  const photos = [
    eligibleMedia(1, { created_at: "2026-07-19T00:00:01.000Z" }),
    eligibleMedia(2, { created_at: "2026-07-19T00:00:02.000Z" })
  ];
  const connection = focusedShareConnection(
    photos,
    photos.map((photo) => ({ photo_id: photo.id, ...sharerSeatTag() }))
  );
  const options = {
    focusMediaId: 1,
    withTransaction: async (work) => work(connection)
  };

  const first = await createOrReuseSessionAlbumPublicShare({ user: { id: 100 } }, 10, options);
  const second = await createOrReuseSessionAlbumPublicShare({ user: { id: 100 } }, 10, options);

  assert.equal(first.focus_media_id, 1);
  assert.deepEqual(first.media_ids, [1, 2]);
  assert.equal(connection.shares.length, 1);
  assert.equal(second.share_id, first.share_id);
  assert.equal(second.focus_media_id, 1);
});

test("createOrReuseSessionAlbumPublicShare rejects a focus ID excluded by eligibility filtering", async () => {
  const eligible = eligibleMedia(1);
  const unavailable = eligibleMedia(2, { moderation_status: "pending" });
  const connection = focusedShareConnection(
    [eligible, unavailable],
    [
      { photo_id: eligible.id, ...sharerSeatTag() },
      { photo_id: unavailable.id, ...sharerSeatTag() }
    ]
  );

  await assert.rejects(
    () => createOrReuseSessionAlbumPublicShare({ user: { id: 100 } }, 10, {
      focusMediaId: unavailable.id,
      withTransaction: async (work) => work(connection)
    }),
    (error) => error.statusCode === 409 && error.code === "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE"
  );
  assert.equal(connection.shares.length, 0);
});

test("focused album shares validate the focus ID and expose it through the share-token route", () => {
  assert.match(serviceSource, /function normalizePublicShareFocusMediaId\(value\)/);
  assert.match(serviceSource, /ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE/);
  assert.match(
    serviceSource,
    /selectPublicShareMedia\(photoRows, tagsMap, privacyByUser, claims, \{\s*requiredMediaId: focusMediaId,\s*allowOwnedUntaggedImages: includeOwnedUntaggedImages,\s*selectedMediaIds:/
  );
  assert.match(serviceSource, /focus_media_id: focusMediaId \|\| null/);

  const shareTokenRoute = serverSource.slice(
    serverSource.indexOf("const sessionAlbumShareTokenId"),
    serverSource.indexOf("const sessionAlbumPublicSharesId")
  );
  assert.match(serverSource, /const body = await bodyFor\(request\)/);
  assert.match(shareTokenRoute, /focusMediaId: body\?\.focusMediaId/);
  assert.match(shareTokenRoute, /focus_media_id: share\.focus_media_id/);
});

test("createOrReuseSessionAlbumPublicShare rejects invalid supplied focus IDs as unavailable", async () => {
  const user = { user: { id: 100 } };
  for (const focusMediaId of [0, null, "1", 1.5]) {
    await assert.rejects(
      () => createOrReuseSessionAlbumPublicShare(user, 10, {
        focusMediaId,
        withTransaction: async () => assert.fail("invalid focus ID must not open a transaction")
      }),
      (error) => error.statusCode === 409 && error.code === "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE"
    );
  }
});

function publicVideoPlaybackConnection(media, options = {}) {
  const share = {
    id: 50,
    session_id: 10,
    sharer_user_id: 100,
    seat_id: 1000,
    media_ids: options.mediaIds || [77],
    cover_media_ids: [],
    expires_at: "2099-01-01T00:00:00.000Z",
    revoked_at: options.revoked ? "2026-07-19T00:00:00.000Z" : null
  };
  share.snapshot_digest = publicShareSnapshotDigest({
    sessionId: share.session_id,
    sharerUserId: share.sharer_user_id,
    seatId: share.seat_id,
    mediaIds: share.media_ids,
    coverMediaIds: share.cover_media_ids
  });
  const tags = options.tags || [{ photo_id: 77, ...sharerSeatTag() }];
  const privacy = options.privacy || [];
  return {
    async query(sql) {
      if (sql.includes("SELECT * FROM session_album_photos WHERE id = ?")) {
        return [[media]].filter(Boolean);
      }
      if (sql.includes("FROM session_album_public_shares")) {
        return [options.revoked ? [] : [share]];
      }
      if (sql.includes("FROM sessions session")) {
        return [[{ id: 10, status: "completed" }]];
      }
      if (sql.includes("FROM session_seats") && sql.includes("confirmed_user_id")) {
        return [[{ id: 1000, confirmed_user_id: 100, status: "confirmed" }]];
      }
      if (sql.includes("FROM session_album_photo_tags")) return [tags];
      if (sql.includes("FROM session_album_privacy")) return [privacy];
      throw new Error(`Unexpected public video playback test query: ${sql}`);
    }
  };
}

const publicVideoClaims = {
  version: 2,
  shareId: 50,
  sessionId: 10,
  sharerUserId: 100,
  seatId: 1000
};

test("getPublicSessionAlbumVideoForPlayback only returns an active published ready snapshot video", async () => {
  const media = eligibleMedia(77, {
    media_type: "video",
    display_url: "/uploads/session-album/videos/display/public-77.mp4"
  });
  const result = await getPublicSessionAlbumVideoForPlayback(publicVideoClaims, 77, {
    withConnection: async (work) => work(publicVideoPlaybackConnection(media))
  });

  assert.equal(result.id, 77);
  assert.equal(result.media_type, "video");
});

test("getPublicSessionAlbumVideoForPlayback fails closed for disallowed public playback states", async () => {
  const cases = [
    ["image", eligibleMedia(77, { display_url: "/uploads/session-album/videos/display/public-77.mp4" }), {}],
    ["processing", eligibleMedia(77, {
      media_type: "video",
      processing_status: "processing",
      display_url: "/uploads/session-album/videos/display/public-77.mp4"
    }), {}],
    ["missing display URL", eligibleMedia(77, { media_type: "video", display_url: "" }), {}],
    ["cross-session", eligibleMedia(77, {
      media_type: "video",
      session_id: 11,
      display_url: "/uploads/session-album/videos/display/public-77.mp4"
    }), {}],
    ["snapshot external", eligibleMedia(77, {
      media_type: "video",
      display_url: "/uploads/session-album/videos/display/public-77.mp4"
    }), { mediaIds: [78] }],
    ["revoked", eligibleMedia(77, {
      media_type: "video",
      display_url: "/uploads/session-album/videos/display/public-77.mp4"
    }), { revoked: true }],
    ["privacy veto", eligibleMedia(77, {
      media_type: "video",
      display_url: "/uploads/session-album/videos/display/public-77.mp4"
    }), {
      privacy: [{
        session_id: 10,
        user_id: 100,
        allow_uploaded_visible: false,
        allow_tagged_visible: true
      }]
    }]
  ];

  for (const [name, media, options] of cases) {
    await assert.rejects(
      () => getPublicSessionAlbumVideoForPlayback(publicVideoClaims, 77, {
        withConnection: async (work) => work(publicVideoPlaybackConnection(media, options))
      }),
      undefined,
      name
    );
  }
});

test("public video capability binds the v2 share, media, digest, purpose, and expiry", () => {
  const token = signSessionAlbumPublicVideoFileToken({
    ...publicVideoClaims,
    mediaId: 77,
    shareTokenDigest: "a".repeat(64),
    exp: Math.floor(Date.now() / 1000) + 60
  });
  const verified = verifySessionAlbumPublicVideoFileQuery(
    77,
    new URLSearchParams({ token })
  );

  assert.deepEqual(verified, {
    ...publicVideoClaims,
    mediaId: 77,
    shareTokenDigest: "a".repeat(64),
    exp: verified.exp
  });
  assert.match(token, /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
});

test("public video capability rejects tampered media, wrong purpose, and expiry", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = signSessionAlbumPublicVideoFileToken({
    ...publicVideoClaims,
    mediaId: 77,
    shareTokenDigest: "b".repeat(64),
    exp: now + 60
  });
  const [payload, signature] = token.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({
    ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    mediaId: 78
  })).toString("base64url");

  assert.throws(
    () => verifySessionAlbumPublicVideoFileQuery(78, new URLSearchParams({
      token: `${tamperedPayload}.${signature}`
    }))
  );
  assert.throws(
    () => verifySessionAlbumPublicVideoFileQuery(78, new URLSearchParams({ token }))
  );
  const expired = signSessionAlbumPublicVideoFileToken({
    ...publicVideoClaims,
    mediaId: 77,
    shareTokenDigest: "b".repeat(64),
    exp: now - 1
  });
  assert.throws(
    () => verifySessionAlbumPublicVideoFileQuery(77, new URLSearchParams({ token: expired }))
  );
});

test("public video routes use the album token then a reauthorized application capability", () => {
  const routes = serverSource.slice(
    serverSource.indexOf("const publicSessionAlbumVideoUrlId"),
    serverSource.indexOf("const sessionAlbumMediaPhotoId")
  );
  assert.ok(routes.includes("public-share\\/media\\/(\\d+)\\/video-url"));
  assert.ok(routes.includes("public-share\\/media\\/(\\d+)\\/video-file"));
  assert.match(routes, /verifySessionAlbumShareToken/);
  assert.match(routes, /getPublicSessionAlbumVideoForPlayback/);
  assert.match(serverSource, /session-album-public-video-file/);
  assert.match(routes, /servePublicSessionAlbumVideoFile/);
});

async function responseBody(response) {
  const chunks = [];
  for await (const chunk of response.body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("createPublicAlbumVideoResponse preserves local HEAD, full, single-range, suffix-range, and 416 semantics", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "d50-public-video-"));
  const filePath = path.join(directory, "public.mp4");
  const bytes = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4, 5, 6]);
  await writeFile(filePath, bytes);
  try {
    const head = await createPublicAlbumVideoResponse({
      media: { display_url: "/uploads/session-album/videos/display/public.mp4" },
      method: "HEAD",
      cosEnabled: false,
      localFilePath: filePath
    });
    assert.equal(head.statusCode, 200);
    assert.equal(head.body, null);
    assert.deepEqual(head.headers, {
      "content-type": "video/mp4",
      "accept-ranges": "bytes",
      "content-length": bytes.length,
      "cache-control": "private, no-store"
    });

    const full = await createPublicAlbumVideoResponse({
      media: { display_url: "/uploads/session-album/videos/display/public.mp4" },
      method: "GET",
      cosEnabled: false,
      localFilePath: filePath
    });
    assert.equal(full.statusCode, 200);
    assert.deepEqual(await responseBody(full), bytes);

    const exact = await createPublicAlbumVideoResponse({
      media: { display_url: "/uploads/session-album/videos/display/public.mp4" },
      method: "GET",
      range: "bytes=4-8",
      cosEnabled: false,
      localFilePath: filePath
    });
    assert.equal(exact.statusCode, 206);
    assert.equal(exact.headers["content-range"], `bytes 4-8/${bytes.length}`);
    assert.deepEqual(await responseBody(exact), bytes.subarray(4, 9));

    const suffix = await createPublicAlbumVideoResponse({
      media: { display_url: "/uploads/session-album/videos/display/public.mp4" },
      method: "GET",
      range: "bytes=-3",
      cosEnabled: false,
      localFilePath: filePath
    });
    assert.equal(suffix.statusCode, 206);
    assert.deepEqual(await responseBody(suffix), bytes.subarray(-3));

    const unsatisfiable = await createPublicAlbumVideoResponse({
      media: { display_url: "/uploads/session-album/videos/display/public.mp4" },
      method: "GET",
      range: "bytes=999-",
      cosEnabled: false,
      localFilePath: filePath
    });
    assert.equal(unsatisfiable.statusCode, 416);
    assert.equal(unsatisfiable.body, null);
    assert.equal(unsatisfiable.headers["content-range"], `bytes */${bytes.length}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("createPublicAlbumVideoResponse proxies COS ranges with an authoritative ETag and bounded full reads", async () => {
  const bytes = Buffer.concat([
    Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]),
    Buffer.alloc(2 * 1024 * 1024 + 3, 0x5a)
  ]);
  const reads = [];
  const options = {
    media: { display_url: "/uploads/session-album/videos/display/public.mp4" },
    method: "GET",
    cosEnabled: true,
    cosConfig: {},
    headObject: async () => ({
      headers: {
        "content-length": String(bytes.length),
        "content-type": "video/mp4",
        etag: '"d50-public-version"'
      }
    }),
    readObjectRange: async (request) => {
      reads.push(request);
      return bytes.subarray(request.start, request.end + 1);
    }
  };

  const exact = await createPublicAlbumVideoResponse({ ...options, range: "bytes=5-10" });
  assert.equal(exact.statusCode, 206);
  assert.equal(exact.headers.location, undefined);
  assert.equal(exact.headers["content-range"], `bytes 5-10/${bytes.length}`);
  assert.deepEqual(await responseBody(exact), bytes.subarray(5, 11));
  assert.deepEqual(reads, [{
    key: "uploads/session-album/videos/display/public.mp4",
    start: 5,
    end: 10,
    ifMatch: '"d50-public-version"',
    expectedByteSize: bytes.length,
    config: {}
  }]);

  reads.length = 0;
  const full = await createPublicAlbumVideoResponse(options);
  assert.equal(full.statusCode, 200);
  assert.equal(full.headers.location, undefined);
  assert.deepEqual(await responseBody(full), bytes);
  assert.equal(reads.length, 3);
  assert.ok(reads.every((request) => request.end - request.start + 1 <= 1024 * 1024));
  assert.ok(reads.every((request) => request.ifMatch === '"d50-public-version"'));

  const unsatisfiable = await createPublicAlbumVideoResponse({ ...options, range: "bytes=999999999-" });
  assert.equal(unsatisfiable.statusCode, 416);
  assert.equal(unsatisfiable.body, null);
  assert.equal(unsatisfiable.headers["content-range"], `bytes */${bytes.length}`);
});

test("createPublicAlbumVideoResponse streams a large 206 range in ordered one-mebibyte COS reads", async () => {
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 19, 0x5a);
  const reads = [];
  const response = await createPublicAlbumVideoResponse({
    media: { display_url: "/uploads/session-album/videos/display/large-public.mp4" },
    method: "GET",
    range: `bytes=0-${bytes.length - 1}`,
    cosEnabled: true,
    cosConfig: {},
    headObject: async () => ({
      headers: {
        "content-length": String(bytes.length),
        "content-type": "video/mp4",
        etag: '"d50-large-range"'
      }
    }),
    readObjectRange: async (request) => {
      reads.push(request);
      return bytes.subarray(request.start, request.end + 1);
    }
  });

  assert.equal(response.statusCode, 206);
  assert.equal(response.headers["content-range"], `bytes 0-${bytes.length - 1}/${bytes.length}`);
  assert.equal(response.headers["content-length"], bytes.length);
  assert.deepEqual(await responseBody(response), bytes);
  assert.equal(reads.length, 3);
  assert.ok(reads.every((request) => request.end - request.start + 1 <= 1024 * 1024));
  assert.deepEqual(
    reads.map(({ start, end }) => [start, end]),
    [[0, 1024 * 1024 - 1], [1024 * 1024, 2 * 1024 * 1024 - 1], [2 * 1024 * 1024, bytes.length - 1]]
  );
});

test("createPublicAlbumVideoResponse rejects malformed COS HEAD metadata as an upstream error", async () => {
  await assert.rejects(
    createPublicAlbumVideoResponse({
      media: { display_url: "/uploads/session-album/videos/display/bad-head.mp4" },
      cosEnabled: true,
      cosConfig: {},
      headObject: async () => ({
        headers: {
          "content-length": "not-a-size",
          "content-type": "text/plain",
          etag: '"d50-bad-head"'
        }
      })
    }),
    (error) => error.statusCode === 502 && error.code === "COS_VIDEO_METADATA_MISSING"
  );
});

test("createPublicAlbumVideoResponse aborts an in-flight COS read and starts no later chunks", async () => {
  const bytes = Buffer.alloc(2 * 1024 * 1024, 0x5a);
  const reads = [];
  let releaseFirstRead;
  const controller = new AbortController();
  const response = await createPublicAlbumVideoResponse({
    media: { display_url: "/uploads/session-album/videos/display/cancel-public.mp4" },
    cosEnabled: true,
    cosConfig: {},
    signal: controller.signal,
    headObject: async () => ({
      headers: {
        "content-length": String(bytes.length),
        "content-type": "video/mp4",
        etag: '"d50-cancel"'
      }
    }),
    readObjectRange: ({ start, end, signal }) => new Promise((resolve, reject) => {
      reads.push({ start, end });
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      if (reads.length === 1) {
        releaseFirstRead = () => resolve(bytes.subarray(start, end + 1));
      } else {
        resolve(bytes.subarray(start, end + 1));
      }
    })
  });
  const body = responseBody(response);
  for (let attempt = 0; attempt < 20 && reads.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(reads.length, 1);
  controller.abort(new DOMException("client disconnected", "AbortError"));
  releaseFirstRead();
  await assert.rejects(body, (error) => error?.name === "AbortError");
  assert.equal(reads.length, 1);
});

test("createPublicAlbumVideoResponse aborts a pending COS HEAD before any range read", async () => {
  const controller = new AbortController();
  let releaseHead;
  let rangeReads = 0;
  const pending = createPublicAlbumVideoResponse({
    media: { display_url: "/uploads/session-album/videos/display/head-cancel.mp4" },
    cosEnabled: true,
    cosConfig: {},
    signal: controller.signal,
    headObject: ({ signal }) => new Promise((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      releaseHead = () => resolve({
        headers: {
          "content-length": "20",
          "content-type": "video/mp4",
          etag: '"d50-head-cancel"'
        }
      });
    }),
    readObjectRange: async () => {
      rangeReads += 1;
      return Buffer.alloc(0);
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 1));
  controller.abort(new DOMException("client disconnected", "AbortError"));
  releaseHead();
  await assert.rejects(pending, (error) => error?.name === "AbortError");
  assert.equal(rangeReads, 0);
});

test("the public video routes issue then reauthorize a real application capability", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "d50-public-route-"));
  const filePath = path.join(directory, "public-route.mp4");
  const bytes = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4, 5, 6]);
  await writeFile(filePath, bytes);
  let getterCalls = 0;
  const app = createApp({
    publicVideo: {
      verifyShareToken(token) {
        assert.equal(token, "album-token");
        return publicVideoClaims;
      },
      async getVideo(claimsArg, mediaId) {
        getterCalls += 1;
        assert.equal(claimsArg.version, 2);
        assert.equal(claimsArg.shareId, publicVideoClaims.shareId);
        assert.equal(claimsArg.sessionId, publicVideoClaims.sessionId);
        assert.equal(mediaId, 77);
        return {
          id: 77,
          display_url: "/uploads/session-album/videos/display/public-route.mp4"
        };
      },
      responseOptions: { cosEnabled: false, localFilePath: filePath }
    }
  });
  try {
    await new Promise((resolve, reject) => app.listen(0, "127.0.0.1", (error) => {
      if (error) reject(error);
      else resolve();
    }));
    const address = app.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const signed = await fetch(`${baseUrl}/api/session-album/public-share/media/77/video-url?token=album-token`);
    assert.equal(signed.status, 200);
    const signedPayload = await signed.json();
    assert.match(signedPayload.data.url, /^\/api\/session-album\/public-share\/media\/77\/video-file\?token=/);
    assert.doesNotMatch(signedPayload.data.url, /cos\.|q-signature|https?:/);
    assert.equal(getterCalls, 1);

    const ranged = await fetch(`${baseUrl}${signedPayload.data.url}`, {
      headers: { range: "bytes=4-8" }
    });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("content-range"), `bytes 4-8/${bytes.length}`);
    assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), bytes.subarray(4, 9));
    assert.equal(getterCalls, 2);

    const head = await fetch(`${baseUrl}${signedPayload.data.url}`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(getterCalls, 3);

    const unsatisfiable = await fetch(`${baseUrl}${signedPayload.data.url}`, {
      headers: { range: "bytes=999-" }
    });
    assert.equal(unsatisfiable.status, 416);
    assert.equal(await unsatisfiable.text(), "");
    assert.equal(getterCalls, 4);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
