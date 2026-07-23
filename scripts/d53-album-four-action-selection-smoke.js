import assert from "node:assert/strict";
import mysql from "mysql2/promise";

const baseUrl = process.env.BASE_URL || "http://localhost:3018";
const suffix = Date.now();

async function request(method, path, body, token, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  assert.ok(expected.includes(response.status), `${method} ${path}: ${text}`);
  return payload;
}

async function login(code) {
  return (await request("POST", "/api/auth/wechat/login", { code })).data;
}

async function authorizePhone(auth, label) {
  const response = await request(
    "POST",
    "/api/auth/wechat/phone",
    { code: `${label}-${suffix}` },
    auth.token
  );
  return { ...auth, user: response.data.user, roles: response.data.roles };
}

function startAt() {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

async function database() {
  return mysql.createConnection({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3307),
    database: process.env.MYSQL_DATABASE || "pinche",
    user: process.env.MYSQL_USER || "pinche",
    password: process.env.MYSQL_PASSWORD || "pinche_dev_password"
  });
}

async function createFixture(admin, owner, label) {
  const store = await request("POST", "/api/admin/stores", {
    name: `D53 分享范围店-${suffix}-${label}`,
    city: "北京",
    district: "朝阳",
    address: "D53 测试地址"
  }, admin.token, 201);
  const script = await request("POST", "/api/admin/scripts", {
    name: `D53 分享范围本-${suffix}-${label}`,
    typeTags: ["情感"],
    playerCount: 2,
    summaryNoSpoiler: "D53 album share selection smoke",
    defaultSeatTemplate: []
  }, admin.token, 201);
  const session = await request("POST", "/api/sessions", {
    storeId: store.data.id,
    scriptId: script.data.id,
    startAt: startAt(),
    joinPolicy: "direct",
    depositAmount: 5000
  }, owner.token, 201);
  const seats = [];
  for (const serial of [1, 2]) {
    const seat = await request("POST", `/api/sessions/${session.data.id}/seats`, {
      name: `D53 车友${serial}`,
      seatType: "normal",
      roleName: `D53 车友${serial}`,
      basePrice: 58000,
      adjustment: 0
    }, owner.token, 201);
    seats.push(seat.data);
  }
  await request("POST", `/api/sessions/${session.data.id}/publish`, {}, owner.token);
  return { session: session.data, seats };
}

async function insertAlbumMedia({
  sessionId,
  uploaderUserId,
  tagSeatId,
  tagUserId,
  label,
  mediaType = "image",
  processingStatus = "ready",
  moderationStatus = "approved",
  authorVisibilityVersion = 0,
  createdOffset = 0
}) {
  const connection = await database();
  try {
    const isVideo = mediaType === "video";
    const [insert] = await connection.query(
      isVideo
        ? `INSERT INTO session_album_photos
            (session_id, uploader_user_id, media_type, photo_url, source_url, display_url,
             duration_seconds, video_width, video_height, video_byte_size, video_content_type,
             processing_status, moderation_status, author_visibility_version, status, created_at)
           VALUES (?, ?, 'video', NULL, ?, ?, 12, 1280, 720, 1200000, 'video/mp4', ?, ?, ?, 'active',
             DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND))`
        : `INSERT INTO session_album_photos
            (session_id, uploader_user_id, media_type, photo_url, processing_status,
             moderation_status, author_visibility_version, status, created_at)
           VALUES (?, ?, 'image', ?, ?, ?, ?, 'active', DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND))`,
      isVideo
        ? [
            sessionId,
            uploaderUserId,
            `/uploads/session-album/d53-${suffix}-${label}.mp4`,
            `/uploads/session-album/d53-${suffix}-${label}-display.mp4`,
            processingStatus,
            moderationStatus,
            authorVisibilityVersion,
            createdOffset
          ]
        : [
            sessionId,
            uploaderUserId,
            `/uploads/session-album/d53-${suffix}-${label}.jpg`,
            processingStatus,
            moderationStatus,
            authorVisibilityVersion,
            createdOffset
          ]
    );
    await connection.query(
      `INSERT INTO session_album_photo_tags (photo_id, tag_type, seat_id, user_id, label, sort_order)
       VALUES (?, 'seat', ?, ?, 'D53 车友', 0)`,
      [insert.insertId, tagSeatId, tagUserId]
    );
    return Number(insert.insertId);
  } finally {
    await connection.end();
  }
}

async function insertEligibleMedia(sessionId, userId, seatId) {
  const insertedIds = [];
  for (let index = 1; index <= 32; index += 1) {
    insertedIds.push(await insertAlbumMedia({
      sessionId,
      uploaderUserId: userId,
      tagSeatId: seatId,
      tagUserId: userId,
      label: `eligible-${index}`,
      createdOffset: index
    }));
  }
  return insertedIds;
}

async function updateMedia(id, fields) {
  const connection = await database();
  try {
    const entries = Object.entries(fields);
    const setters = entries.map(([column]) => `${column} = ?`).join(", ");
    const [result] = await connection.query(
      `UPDATE session_album_photos SET ${setters} WHERE id = ?`,
      [...entries.map(([, value]) => value), id]
    );
    assert.equal(result.affectedRows, 1, `expected media ${id} to update`);
  } finally {
    await connection.end();
  }
}

function publicAlbumPath(sessionId, token) {
  return `/api/sessions/${sessionId}/album/public-share?token=${encodeURIComponent(token)}`;
}

async function assertSelectionInvalid(sessionId, ownerToken, mediaIds, label) {
  const rejected = await request(
    "POST",
    `/api/sessions/${sessionId}/album/share-token`,
    { mediaIds },
    ownerToken,
    409
  );
  assert.equal(
    rejected.error?.code,
    "ALBUM_PUBLIC_SHARE_SELECTION_INVALID",
    `${label} must fail as one selected-share request`
  );
}

async function main() {
  const admin = await authorizePhone(await login("dev-admin-openid"), "d53-admin");
  const organizer = await authorizePhone(
    await login(`dev-d53-organizer-${suffix}`),
    "d53-organizer"
  );
  const owner = await authorizePhone(await login(`dev-d53-owner-${suffix}`), "d53-owner");
  const privateUploader = await authorizePhone(
    await login(`dev-d53-private-${suffix}`),
    "d53-private"
  );
  const fixture = await createFixture(admin, organizer, "primary");
  const [ownerSeat, privateSeat] = fixture.seats;
  assert.equal(
    (await request("POST", `/api/session-seats/${ownerSeat.id}/claim`, { note: "D53 owner" }, owner.token)).data.join_result,
    "joined"
  );
  assert.equal(
    (await request("POST", `/api/session-seats/${privateSeat.id}/claim`, { note: "D53 private uploader" }, privateUploader.token)).data.join_result,
    "joined"
  );

  const mediaIds = await insertEligibleMedia(fixture.session.id, owner.user.id, ownerSeat.id);
  const crossFixture = await createFixture(admin, organizer, "cross-session");
  const crossSessionMediaId = await insertAlbumMedia({
    sessionId: crossFixture.session.id,
    uploaderUserId: owner.user.id,
    tagSeatId: crossFixture.seats[0].id,
    tagUserId: owner.user.id,
    label: "cross-session"
  });
  const authorPrivateMediaId = await insertAlbumMedia({
    sessionId: fixture.session.id,
    uploaderUserId: owner.user.id,
    tagSeatId: ownerSeat.id,
    tagUserId: owner.user.id,
    label: "author-private",
    moderationStatus: "rejected",
    authorVisibilityVersion: 1
  });
  const unreviewedMediaId = await insertAlbumMedia({
    sessionId: fixture.session.id,
    uploaderUserId: owner.user.id,
    tagSeatId: ownerSeat.id,
    tagUserId: owner.user.id,
    label: "unreviewed",
    moderationStatus: "pending"
  });
  const processingVideoId = await insertAlbumMedia({
    sessionId: fixture.session.id,
    uploaderUserId: owner.user.id,
    tagSeatId: ownerSeat.id,
    tagUserId: owner.user.id,
    label: "processing-video",
    mediaType: "video",
    processingStatus: "processing"
  });
  const privacyBlockedMediaId = await insertAlbumMedia({
    sessionId: fixture.session.id,
    uploaderUserId: privateUploader.user.id,
    tagSeatId: ownerSeat.id,
    tagUserId: owner.user.id,
    label: "privacy-blocked"
  });
  await request(
    "PUT",
    `/api/sessions/${fixture.session.id}/album/privacy`,
    { allowUploadedVisible: false, allowTaggedVisible: true },
    privateUploader.token
  );

  const all = await request(
    "POST",
    `/api/sessions/${fixture.session.id}/album/share-token`,
    { scope: "all" },
    owner.token
  );
  assert.equal(all.data.visible_count, 32, "all scope must retain every current eligible medium");
  assert.ok(all.data.share_id);

  const selectedIds = mediaIds.slice(0, 31);
  const selected = await request(
    "POST",
    `/api/sessions/${fixture.session.id}/album/share-token`,
    { mediaIds: selectedIds.slice().reverse() },
    owner.token
  );
  assert.equal(selected.data.visible_count, 31, "selected scope must permit more than 30 IDs");
  const publicSelected = await request("GET", publicAlbumPath(fixture.session.id, selected.data.token));
  assert.deepEqual(
    new Set(publicSelected.data.photos.map((photo) => Number(photo.id))),
    new Set(selectedIds),
    "selected snapshot must expose exactly the requested eligible set"
  );

  await assertSelectionInvalid(fixture.session.id, owner.token, [], "empty selection");
  await assertSelectionInvalid(
    fixture.session.id,
    owner.token,
    [mediaIds[0], mediaIds[0]],
    "duplicate selection"
  );
  for (const [label, unavailableId] of [
    ["cross-session medium", crossSessionMediaId],
    ["author-private medium", authorPrivateMediaId],
    ["unreviewed medium", unreviewedMediaId],
    ["processing video", processingVideoId],
    ["privacy-blocked medium", privacyBlockedMediaId]
  ]) {
    await assertSelectionInvalid(fixture.session.id, owner.token, [mediaIds[0], unavailableId], label);
  }

  await updateMedia(mediaIds.at(-1), { moderation_status: "pending" });
  const allAfterModerationChange = await request(
    "POST",
    `/api/sessions/${fixture.session.id}/album/share-token`,
    { scope: "all" },
    owner.token
  );
  assert.equal(
    allAfterModerationChange.data.visible_count,
    31,
    "all scope must recompute eligibility at the time it is submitted"
  );
  const currentEligibleIntersection = await request(
    "GET",
    publicAlbumPath(fixture.session.id, all.data.token)
  );
  assert.equal(
    currentEligibleIntersection.data.visible_count,
    31,
    "public reads must return the snapshot intersected with current eligibility"
  );

  await request(
    "PUT",
    `/api/sessions/${fixture.session.id}/album/privacy`,
    { allowUploadedVisible: false, allowTaggedVisible: true },
    owner.token
  );
  const privacyIntersection = await request(
    "GET",
    publicAlbumPath(fixture.session.id, selected.data.token)
  );
  assert.equal(
    privacyIntersection.data.visible_count,
    0,
    "a later privacy veto must hide media already fixed in a snapshot"
  );
  await request(
    "PUT",
    `/api/sessions/${fixture.session.id}/album/privacy`,
    { allowUploadedVisible: true, allowTaggedVisible: true },
    owner.token
  );

  await request(
    "POST",
    `/api/session-seats/${privateSeat.id}/claim`,
    { note: "album token must not claim a role" },
    all.data.token,
    [401, 403]
  );
  const invitation = await request(
    "POST",
    `/api/sessions/${fixture.session.id}/join-invite-token`,
    {},
    owner.token,
    201
  );
  await request("GET", publicAlbumPath(fixture.session.id, invitation.data.token), undefined, undefined, 403);

  const revoked = await request(
    "DELETE",
    `/api/sessions/${fixture.session.id}/album/public-shares`,
    undefined,
    owner.token
  );
  assert.ok(revoked.data.revoked_count >= 1, "D53 cleanup must revoke created public shares");
  await request("GET", publicAlbumPath(fixture.session.id, selected.data.token), undefined, undefined, 403);

  console.log(JSON.stringify({
    ok: true,
    sessionId: fixture.session.id,
    eligibleMedia: mediaIds.length,
    selectedMedia: selectedIds.length
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
