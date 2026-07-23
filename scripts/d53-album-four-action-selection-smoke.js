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
  assert.equal(response.status, expectedStatus, `${method} ${path}: ${text}`);
  return payload;
}

async function login(code) {
  return (await request("POST", "/api/auth/wechat/login", { code })).data;
}

async function authorizePhone(auth, label) {
  const response = await request("POST", "/api/auth/wechat/phone", { code: `${label}-${suffix}` }, auth.token);
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

async function createFixture(admin, owner) {
  const store = await request("POST", "/api/admin/stores", {
    name: `D53 分享范围店-${suffix}`, city: "北京", district: "朝阳", address: "D53 测试地址"
  }, admin.token, 201);
  const script = await request("POST", "/api/admin/scripts", {
    name: `D53 分享范围本-${suffix}`,
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
  const seat = await request("POST", `/api/sessions/${session.data.id}/seats`, {
    name: "D53 车友", seatType: "normal", roleName: "D53 车友", basePrice: 58000, adjustment: 0
  }, owner.token, 201);
  await request("POST", `/api/sessions/${session.data.id}/publish`, {}, owner.token);
  return { session: session.data, seat: seat.data };
}

async function insertEligibleMedia(sessionId, userId, seatId) {
  const connection = await database();
  try {
    const insertedIds = [];
    for (let index = 1; index <= 32; index += 1) {
      const [insert] = await connection.query(
        `INSERT INTO session_album_photos
          (session_id, uploader_user_id, media_type, photo_url, processing_status, status, moderation_status, created_at)
         VALUES (?, ?, 'image', ?, 'ready', 'active', 'approved', DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND))`,
        [sessionId, userId, `/uploads/session-album/d53-${suffix}-${index}.jpg`, index]
      );
      insertedIds.push(insert.insertId);
      await connection.query(
        `INSERT INTO session_album_photo_tags (photo_id, tag_type, seat_id, user_id, label, sort_order)
         VALUES (?, 'seat', ?, ?, 'D53 车友', 0)`,
        [insert.insertId, seatId, userId]
      );
    }
    return insertedIds;
  } finally {
    await connection.end();
  }
}

async function main() {
  const admin = await authorizePhone(await login("dev-admin-openid"), "d53-admin");
  const owner = await authorizePhone(await login(`dev-d53-owner-${suffix}`), "d53-owner");
  const fixture = await createFixture(admin, owner);
  const claim = await request("POST", `/api/session-seats/${fixture.seat.id}/claim`, { note: "D53 scope smoke" }, owner.token);
  assert.equal(claim.data.join_result, "joined");
  const mediaIds = await insertEligibleMedia(fixture.session.id, owner.user.id, fixture.seat.id);

  const all = await request("POST", `/api/sessions/${fixture.session.id}/album/share-token`, { scope: "all" }, owner.token);
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
  const publicSelected = await request(
    "GET",
    `/api/sessions/${fixture.session.id}/album/public-share?token=${encodeURIComponent(selected.data.token)}`
  );
  assert.deepEqual(
    new Set(publicSelected.data.photos.map((photo) => Number(photo.id))),
    new Set(selectedIds),
    "selected snapshot must expose exactly the requested eligible set"
  );

  for (const body of [
    { mediaIds: [] },
    { mediaIds: [mediaIds[0], mediaIds[0]] },
    { mediaIds: [mediaIds[0], 999999999] },
    { scope: "all", mediaIds: [mediaIds[0]] }
  ]) {
    const rejected = await request(
      "POST",
      `/api/sessions/${fixture.session.id}/album/share-token`,
      body,
      owner.token,
      409
    );
    assert.equal(rejected.error?.code, "ALBUM_PUBLIC_SHARE_SELECTION_INVALID");
  }

  const invitation = await request("POST", `/api/sessions/${fixture.session.id}/join-invite-token`, {}, owner.token, 201);
  await request(
    "GET",
    `/api/sessions/${fixture.session.id}/album/public-share?token=${encodeURIComponent(invitation.data.token)}`,
    undefined,
    undefined,
    403
  );
  console.log(JSON.stringify({ ok: true, sessionId: fixture.session.id, eligibleMedia: mediaIds.length }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
