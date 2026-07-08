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

  if (response.status !== expectedStatus) {
    throw new Error(`${method} ${path} expected ${expectedStatus}, got ${response.status}: ${text}`);
  }
  return payload;
}

async function login(code) {
  const payload = await request("POST", "/api/auth/wechat/login", { code });
  return payload.data;
}

async function authorizePhone(auth, label) {
  const payload = await request(
    "POST",
    "/api/auth/wechat/phone",
    { code: `${label}-${suffix}` },
    auth.token
  );
  auth.user = payload.data.user;
  auth.roles = payload.data.roles;
  return auth;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function startAt(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function fakeVideoSourceUrl(sessionId, userId, serial = 1) {
  return `/uploads/session-album/videos/source/admin-video-${sessionId}-${userId}-${
    suffix + serial
  }-aaaaaaaaaaaaaaaa.mp4`;
}

async function createSeat(sessionId, seat, token) {
  return request(
    "POST",
    `/api/sessions/${sessionId}/seats`,
    {
      name: seat.name,
      seatType: seat.seatType,
      roleName: seat.roleName,
      basePrice: seat.basePrice,
      adjustment: seat.adjustment
    },
    token,
    201
  );
}

async function createPublishedSession(admin) {
  const seats = [
    {
      name: "短视频A",
      seatType: "normal",
      roleName: "短视频A",
      basePrice: 58000,
      adjustment: 0
    },
    {
      name: "短视频B",
      seatType: "normal",
      roleName: "短视频B",
      basePrice: 58000,
      adjustment: 0
    }
  ];
  const store = await request(
    "POST",
    "/api/admin/stores",
    {
      name: `D32短视频测试店-${suffix}`,
      city: "北京",
      district: "朝阳",
      address: "D32测试地址"
    },
    admin.token,
    201
  );
  const script = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `D32短视频测试本-${suffix}`,
      typeTags: ["欢乐", "沉浸"],
      playerCount: 2,
      summaryNoSpoiler: "D32 admin album video smoke",
      defaultSeatTemplate: seats
    },
    admin.token,
    201
  );
  const session = await request(
    "POST",
    "/api/sessions",
    {
      storeId: store.data.id,
      scriptId: script.data.id,
      startAt: startAt(-1),
      joinPolicy: "review_required",
      depositAmount: 5000,
      note: "D32 smoke session"
    },
    admin.token,
    201
  );
  const createdSeats = [];
  for (const seat of seats) {
    const createdSeat = await createSeat(session.data.id, seat, admin.token);
    createdSeats.push(createdSeat.data);
  }
  await request("POST", `/api/sessions/${session.data.id}/publish`, {}, admin.token);
  return { session: session.data, seats: createdSeats };
}

async function approveSeat(sessionId, seatId, player, owner) {
  const signup = await request(
    "POST",
    "/api/signups",
    {
      seatId,
      contactText: `d32-${seatId}-${suffix}`,
      note: "D32 video public share smoke"
    },
    player.token,
    201
  );
  await request("PATCH", `/api/signups/${signup.data.id}/approve`, {}, owner.token);
  const detail = await request("GET", `/api/sessions/${sessionId}`);
  return detail.data.seats.find((seat) => Number(seat.id) === Number(seatId));
}

async function insertProcessingVideo({ sessionId, userId, sourceUrl }) {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3307),
    database: process.env.MYSQL_DATABASE || "pinche",
    user: process.env.MYSQL_USER || "pinche",
    password: process.env.MYSQL_PASSWORD || "pinche_dev_password"
  });
  try {
    const [result] = await connection.query(
      `
        INSERT INTO session_album_photos
          (
            session_id,
            uploader_user_id,
            media_type,
            photo_url,
            source_url,
            duration_seconds,
            video_width,
            video_height,
            video_byte_size,
            video_content_type,
            processing_status,
            status
          )
        VALUES (?, ?, 'video', NULL, ?, 12, 1280, 720, 1200000, 'video/mp4', 'processing', 'active')
      `,
      [sessionId, userId, sourceUrl]
    );
    return result.insertId;
  } finally {
    await connection.end();
  }
}

async function postCiCallback(body) {
  return request(
    "POST",
    "/api/cos/ci/session-album-video-callback",
    body,
    undefined,
    200
  );
}

async function main() {
  const admin = await login("dev-admin-openid");
  assert(admin.roles.includes("system_admin"), "admin should have system_admin role");
  await authorizePhone(admin, "d32-admin-phone");
  const member = await login(`dev-d32-video-member-${suffix}`);
  await authorizePhone(member, "d32-member-phone");
  const { session, seats } = await createPublishedSession(admin);
  const memberSeat = await approveSeat(session.id, seats[0].id, member, admin);
  assert(memberSeat?.status === "confirmed", "member should have a confirmed seat");

  await request(
    "POST",
    `/api/admin/sessions/${session.id}/album/videos`,
    {
      sourceUrl: fakeVideoSourceUrl(session.id, member.user.id),
      durationSeconds: 12,
      videoWidth: 1280,
      videoHeight: 720,
      videoByteSize: 1200000,
      videoContentType: "video/mp4"
    },
    member.token,
    403
  );

  const fallbackVideo = await request(
    "POST",
    `/api/admin/sessions/${session.id}/album/videos`,
    {
      sourceUrl: fakeVideoSourceUrl(session.id, admin.user.id, 2),
      durationSeconds: 12,
      videoWidth: 1280,
      videoHeight: 720,
      videoByteSize: 1200000,
      videoContentType: "video/mp4"
    },
    admin.token,
    201
  );
  assert(
    fallbackVideo.data.processing_status === "ready",
    "created video should become ready immediately from the locally compressed source MP4"
  );
  assert(fallbackVideo.data.video_url, "created ready video should include video-url path");

  const sourceUrl = fakeVideoSourceUrl(session.id, admin.user.id, 3);
  const processingVideoId = await insertProcessingVideo({
    sessionId: session.id,
    userId: admin.user.id,
    sourceUrl
  });
  const sourceObject = sourceUrl.slice(1);
  const displayObject = sourceObject.replace("/source/", "/display/");

  const transcode = await postCiCallback({
    JobsDetail: {
      Code: "Success",
      State: "Success",
      JobId: `d32-transcode-${suffix}`,
      Tag: "Transcode",
      Input: { Object: sourceObject },
      Operation: { Output: { Object: displayObject } }
    }
  });
  assert(
    transcode.data.processing_status === "ready",
    "transcode callback should make video ready when cover uses signed URL snapshot"
  );
  assert(transcode.data.id === processingVideoId, "transcode callback should update the same media row");
  assert(transcode.data.display_url === `/${displayObject}`, "display URL should be stored");
  assert(!transcode.data.cover_url, "cover object should not be stored for URL snapshot mode");

  const album = await request("GET", `/api/sessions/${session.id}/album`, undefined, admin.token);
  const readyVideo = album.data.media.find((item) => Number(item.id) === Number(processingVideoId));
  assert(readyVideo?.processing_status === "ready", "ready video should appear in album media");
  assert(readyVideo.video_url, "ready video should include video-url path");
  assert(readyVideo.cover_url, "ready video should include signed snapshot cover URL");
  assert(readyVideo.cover_url.includes("ci-process=snapshot"), "cover URL should use CI snapshot params");
  assert(readyVideo.cover_url.includes("time=1"), "cover URL should request the 1-second frame");
  assert(readyVideo.cover_url.includes("format=jpg"), "cover URL should request jpg format");

  const signed = await request("GET", readyVideo.video_url, undefined, admin.token);
  assert(signed.data.url, "ready video should return a playback URL");

  await request(
    "PUT",
    `/api/session-album/photos/${processingVideoId}/tags`,
    { tagKeys: [`seat:${memberSeat.id}`] },
    admin.token
  );
  const memberAlbum = await request("GET", `/api/sessions/${session.id}/album`, undefined, member.token);
  const memberVideo = memberAlbum.data.media.find(
    (item) => Number(item.id) === Number(processingVideoId)
  );
  assert(memberVideo?.media_type === "video", "non-admin member should see tagged ready video");
  assert(memberVideo.video_url, "non-admin member should receive video-url path");
  const memberSigned = await request("GET", memberVideo.video_url, undefined, member.token);
  assert(memberSigned.data.url, "non-admin member should receive a playback URL");

  const shareToken = await request(
    "POST",
    `/api/sessions/${session.id}/album/share-token`,
    {},
    member.token
  );
  const publicAlbum = await request(
    "GET",
    `/api/sessions/${session.id}/album/public-share?token=${encodeURIComponent(
      shareToken.data.token
    )}`
  );
  const publicVideo = publicAlbum.data.media.find(
    (item) => Number(item.id) === Number(processingVideoId)
  );
  assert(publicVideo?.media_type === "video", "public share should include tagged ready video");
  assert(publicVideo.cover_url, "public share video should expose cover URL");
  assert(
    publicVideo.cover_url.includes("ci-process=snapshot"),
    "public share cover should use signed snapshot URL"
  );
  assert(!publicVideo.video_url, "public share video should not expose playback URL");

  console.log("D32 admin album video smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
