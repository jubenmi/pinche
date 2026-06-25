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
    throw new Error(
      `${method} ${path} expected ${expectedStatus}, got ${response.status}: ${text}`
    );
  }

  return payload;
}

async function multipartRequest(method, path, parts, token, expectedStatus = 200) {
  const boundary = `----pinche-d18-${suffix}-${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(
        `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`
      )
    );
    chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n\r\n`));
    chunks.push(part.body);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: Buffer.concat(chunks)
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (response.status !== expectedStatus) {
    throw new Error(
      `${method} ${path} expected ${expectedStatus}, got ${response.status}: ${text}`
    );
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

const seatTemplate = [
  {
    name: "沈青",
    seatType: "normal",
    roleName: "沈青",
    basePrice: 58000,
    adjustment: 0
  },
  {
    name: "阿澈",
    seatType: "normal",
    roleName: "阿澈",
    basePrice: 58000,
    adjustment: 0
  }
];

async function createSeat(sessionId, seat, token) {
  const payload = await request(
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
  return payload.data;
}

async function createPublishedSession(admin, owner, options = {}) {
  const store = await request(
    "POST",
    "/api/admin/stores",
    {
      name: `D18相册测试店-${suffix}-${options.label || "main"}`,
      city: "北京",
      district: "朝阳",
      address: "D18测试地址"
    },
    admin.token,
    201
  );

  const script = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `D18相册测试本-${suffix}-${options.label || "main"}`,
      typeTags: ["情感", "沉浸"],
      playerCount: 2,
      summaryNoSpoiler: "D18 album privacy smoke script",
      defaultSeatTemplate: seatTemplate
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
      startAt: startAt(options.hoursFromNow ?? -1),
      dmNameSnapshot: `D18指定DM-${suffix}`,
      npcNameSnapshot: `D18指定NPC-${suffix}`,
      depositAmount: 5000,
      note: "D18 smoke session"
    },
    owner.token,
    201
  );

  const seats = [];
  for (const seat of seatTemplate) {
    seats.push(await createSeat(session.data.id, seat, owner.token));
  }

  await request("POST", `/api/sessions/${session.data.id}/publish`, {}, owner.token);
  return { session: session.data, seats };
}

async function approveSeat(sessionId, seatId, player, owner) {
  const signup = await request(
    "POST",
    "/api/signups",
    {
      seatId,
      contactText: `d18-${seatId}-${suffix}`,
      note: "相册隐私 smoke 上车"
    },
    player.token,
    201
  );
  await request("PATCH", `/api/signups/${signup.data.id}/approve`, {}, owner.token);
  const detail = await request("GET", `/api/sessions/${sessionId}`);
  return detail.data.seats.find((seat) => Number(seat.id) === Number(seatId));
}

function fakeAlbumPhotoUrl(sessionId, userId, serial = 1) {
  return `/uploads/session-album/display/album-${sessionId}-${userId}-${suffix + serial}-aaaaaaaaaaaaaaaa.jpg`;
}

async function uploadAlbumPhoto(sessionId, token, label = "photo") {
  const onePixelJpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z",
    "base64"
  );
  const uploaded = await multipartRequest(
    "POST",
    `/api/sessions/${sessionId}/album/uploads`,
    [
      {
        name: "photo",
        filename: `${label}.jpg`,
        contentType: "image/jpeg",
        body: onePixelJpeg
      }
    ],
    token,
    201
  );
  return uploaded.data.photoUrl;
}

function hasPhoto(album, photoId) {
  return (album.data.photos || []).some((photo) => Number(photo.id) === Number(photoId));
}

async function main() {
  const admin = await login("dev-admin-openid");
  assert(admin.roles.includes("system_admin"), "admin should have system_admin role");

  const owner = await login(`dev-d18-owner-${suffix}`);
  const playerA = await login(`dev-d18-player-a-${suffix}`);
  const playerB = await login(`dev-d18-player-b-${suffix}`);
  const intruder = await login(`dev-d18-intruder-${suffix}`);
  await authorizePhone(owner, "d18-owner-phone");
  await authorizePhone(playerA, "d18-player-a-phone");
  await authorizePhone(playerB, "d18-player-b-phone");

  const future = await createPublishedSession(admin, owner, {
    label: "future",
    hoursFromNow: 24
  });
  await request(
    "GET",
    `/api/sessions/${future.session.id}/album`,
    undefined,
    owner.token,
    403
  );

  const { session, seats } = await createPublishedSession(admin, owner, {
    label: "started",
    hoursFromNow: -1
  });
  const seatA = await approveSeat(session.id, seats[0].id, playerA, owner);
  await approveSeat(session.id, seats[1].id, playerB, owner);

  const people = await request(
    "GET",
    `/api/sessions/${session.id}/album/people`,
    undefined,
    owner.token
  );
  const peopleKeys = (people.data.people || []).map((person) => person.key);
  for (const expectedKey of [
    ...seats.map((seat) => `seat:${seat.id}`),
    "dm:session",
    "npc:session"
  ]) {
    assert(peopleKeys.includes(expectedKey), `album people should include ${expectedKey}`);
  }

  await request(
    "POST",
    `/api/sessions/${session.id}/album/photos`,
    { photoUrl: fakeAlbumPhotoUrl(session.id, intruder.user.id) },
    intruder.token,
    403
  );

  const created = await request(
    "POST",
    `/api/sessions/${session.id}/album/photos`,
    { photoUrl: await uploadAlbumPhoto(session.id, owner.token, "owner-album") },
    owner.token,
    201
  );
  const photoId = created.data.id;

  const ownerAlbum = await request("GET", `/api/sessions/${session.id}/album`, undefined, owner.token);
  assert(hasPhoto(ownerAlbum, photoId), "uploader should see untagged own photo");
  const playerInitialAlbum = await request(
    "GET",
    `/api/sessions/${session.id}/album`,
    undefined,
    playerA.token
  );
  assert(!hasPhoto(playerInitialAlbum, photoId), "untagged photo should be hidden from non-uploader");

  const tagged = await request(
    "PUT",
    `/api/session-album/photos/${photoId}/tags`,
    {
      tagKeys: [
        `seat:${seatA.id}`,
        "dm:session",
        "npc:session"
      ]
    },
    owner.token
  );
  const taggedKeys = (tagged.data.tags || []).map((tag) => tag.key);
  for (const expectedKey of ["dm:session", "npc:session"]) {
    assert(taggedKeys.includes(expectedKey), `album tags should save ${expectedKey}`);
  }

  const playerTaggedAlbum = await request(
    "GET",
    `/api/sessions/${session.id}/album`,
    undefined,
    playerA.token
  );
  assert(hasPhoto(playerTaggedAlbum, photoId), "tagged player should see photo containing them");
  const intruderAllowedAlbum = await request(
    "GET",
    `/api/sessions/${session.id}/album`,
    undefined,
    intruder.token
  );
  assert(hasPhoto(intruderAllowedAlbum, photoId), "outsider should see when uploader and tagged player allow visibility");
  const adminAllowedAlbum = await request(
    "GET",
    `/api/sessions/${session.id}/album`,
    undefined,
    admin.token
  );
  assert(hasPhoto(adminAllowedAlbum, photoId), "admin should only see through normal visibility when allowed");

  await request(
    "PUT",
    `/api/sessions/${session.id}/album/privacy`,
    { allowUploadedVisible: true, allowTaggedVisible: false },
    playerA.token
  );
  const intruderBlockedAlbum = await request(
    "GET",
    `/api/sessions/${session.id}/album`,
    undefined,
    intruder.token
  );
  assert(!hasPhoto(intruderBlockedAlbum, photoId), "outsider should not see when tagged player blocks visibility");
  const adminBlockedAlbum = await request(
    "GET",
    `/api/sessions/${session.id}/album`,
    undefined,
    admin.token
  );
  assert(!hasPhoto(adminBlockedAlbum, photoId), "admin must not bypass tagged player privacy");
  const playerStillVisibleAlbum = await request(
    "GET",
    `/api/sessions/${session.id}/album`,
    undefined,
    playerA.token
  );
  assert(hasPhoto(playerStillVisibleAlbum, photoId), "tagged player should still see their own tagged photo");
  const ownerStillVisibleAlbum = await request(
    "GET",
    `/api/sessions/${session.id}/album`,
    undefined,
    owner.token
  );
  assert(hasPhoto(ownerStillVisibleAlbum, photoId), "uploader should still see own photo after tagged privacy block");

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        sessionId: session.id,
        photoId
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message
      },
      null,
      2
    )
  );
  process.exit(1);
});
