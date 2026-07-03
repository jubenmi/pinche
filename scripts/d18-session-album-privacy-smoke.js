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

async function rawRequest(method, path, body, token, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const buffer = Buffer.from(await response.arrayBuffer());

  if (response.status !== expectedStatus) {
    throw new Error(
      `${method} ${path} expected ${expectedStatus}, got ${response.status}: ${buffer
        .toString("utf8")
        .slice(0, 500)}`
    );
  }

  return {
    status: response.status,
    headers: response.headers,
    body: buffer
  };
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
      defaultSeatTemplate: seatTemplate,
      npcRoles: [
        {
          name: `D18固定NPC-${suffix}-${options.label || "main"}`,
          description: "固定 NPC 角色"
        }
      ]
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
      extraNpcRoles: [
        {
          name: `D18本场NPC-${suffix}-${options.label || "main"}`,
          description: "店家本场额外设计 NPC"
        }
      ],
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

function hasSession(sessionList, sessionId) {
  return (sessionList.data || []).some((session) => Number(session.id) === Number(sessionId));
}

function photoInAlbum(album, photoId) {
  return (album.data.photos || []).find((photo) => Number(photo.id) === Number(photoId));
}

async function main() {
  const admin = await login("dev-admin-openid");
  assert(admin.roles.includes("system_admin"), "admin should have system_admin role");

  const owner = await login(`dev-d18-owner-${suffix}`);
  const playerA = await login(`dev-d18-player-a-${suffix}`);
  const playerB = await login(`dev-d18-player-b-${suffix}`);
  const npcStaff = await login(`dev-d18-npc-staff-${suffix}`);
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
  const sessionNpcRoles = await request(
    "GET",
    `/api/sessions/${session.id}/npc-roles`,
    undefined,
    owner.token
  );
  const fixedNpcRole = (sessionNpcRoles.data.npc_roles || []).find(
    (role) => role.source === "script"
  );
  const extraNpcRole = (sessionNpcRoles.data.npc_roles || []).find(
    (role) => role.source === "session"
  );
  assert(fixedNpcRole, "fixed NPC role should be created for the session");
  assert(extraNpcRole, "extra NPC role should be created for the session");
  const boundExtraNpcRole = await request(
    "PATCH",
    `/api/session-npc-roles/${extraNpcRole.id}`,
    { boundUserId: npcStaff.user.id },
    owner.token
  );
  assert(
    Number(boundExtraNpcRole.data.bound_user_id) === Number(npcStaff.user.id),
    "extra NPC role should bind to a WeChat user"
  );

  const ownerAlbumSessions = await request(
    "GET",
    "/api/users/me/sessions?scope=album&limit=100",
    undefined,
    owner.token
  );
  assert(
    hasSession(ownerAlbumSessions, session.id),
    "album session list should include sessions organized by the current user"
  );
  const playerAlbumSessions = await request(
    "GET",
    "/api/users/me/sessions?scope=album&limit=100",
    undefined,
    playerA.token
  );
  assert(
    hasSession(playerAlbumSessions, session.id),
    "album session list should include sessions where the current user has a confirmed seat"
  );
  const npcStaffAlbumSessions = await request(
    "GET",
    "/api/users/me/sessions?scope=album&limit=100",
    undefined,
    npcStaff.token
  );
  assert(
    hasSession(npcStaffAlbumSessions, session.id),
    "bound NPC role user should see their album session"
  );
  const intruderAlbumSessions = await request(
    "GET",
    "/api/users/me/sessions?scope=album&limit=100",
    undefined,
    intruder.token
  );
  assert(
    !hasSession(intruderAlbumSessions, session.id),
    "album session list should not include sessions outside the current user's membership"
  );

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
    "npc:session",
    "other:session"
  ]) {
    assert(peopleKeys.includes(expectedKey), `album people should include ${expectedKey}`);
  }
  assert(
    peopleKeys.includes(`session-npc:${fixedNpcRole.id}`),
    "fixed NPC role should appear in album people"
  );
  assert(
    peopleKeys.includes(`session-npc:${extraNpcRole.id}`),
    "extra NPC role should appear in album people"
  );

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
  const ownerPhoto = photoInAlbum(ownerAlbum, photoId);
  await rawRequest("GET", ownerPhoto.image_url, undefined, undefined, 401);
  await rawRequest("GET", ownerPhoto.image_url, undefined, playerA.token, 403);
  assert(true, "album media should require login");
  assert(true, "same-session member without photo visibility should not open media");
  const playerInitialAlbum = await request(
    "GET",
    `/api/sessions/${session.id}/album`,
    undefined,
    playerA.token
  );
  assert(!hasPhoto(playerInitialAlbum, photoId), "untagged photo should be hidden from non-uploader");
  await request(
    "GET",
    `/api/sessions/${session.id}/album`,
    undefined,
    intruder.token,
    403
  );
  await rawRequest("GET", ownerPhoto.image_url, undefined, intruder.token, 403);
  await rawRequest("GET", `/api/sessions/${session.id}/album`, undefined, admin.token, 403);
  assert(true, "non-member should not list member-only album");

  const tagged = await request(
    "PUT",
    `/api/session-album/photos/${photoId}/tags`,
    {
      tagKeys: [
        `seat:${seatA.id}`,
        "dm:session",
        "npc:session",
        `session-npc:${extraNpcRole.id}`
      ]
    },
    owner.token
  );
  const taggedKeys = (tagged.data.tags || []).map((tag) => tag.key);
  for (const expectedKey of ["dm:session", "npc:session"]) {
    assert(taggedKeys.includes(expectedKey), `album tags should save ${expectedKey}`);
  }
  assert(
    taggedKeys.includes(`session-npc:${extraNpcRole.id}`),
    "album tags should save session NPC role"
  );

  const playerTaggedAlbum = await request(
    "GET",
    `/api/sessions/${session.id}/album`,
    undefined,
    playerA.token
  );
  assert(hasPhoto(playerTaggedAlbum, photoId), "tagged player should see photo containing them");
  const playerTaggedPhoto = photoInAlbum(playerTaggedAlbum, photoId);
  const playerTaggedMedia = await rawRequest(
    "GET",
    playerTaggedPhoto.image_url,
    undefined,
    playerA.token
  );
  assert(
    (playerTaggedMedia.headers.get("content-type") || "").includes("image/jpeg"),
    "visible same-session member should open media"
  );
  const otherMemberAllowedAlbum = await request(
    "GET",
    `/api/sessions/${session.id}/album`,
    undefined,
    playerB.token
  );
  assert(hasPhoto(otherMemberAllowedAlbum, photoId), "other member should see when uploader and tagged player allow visibility");

  await request(
    "PUT",
    `/api/sessions/${session.id}/album/privacy`,
    { allowUploadedVisible: true, allowTaggedVisible: false },
    playerA.token
  );
  const otherMemberBlockedAlbum = await request(
    "GET",
    `/api/sessions/${session.id}/album`,
    undefined,
    playerB.token
  );
  assert(
    !hasPhoto(otherMemberBlockedAlbum, photoId),
    "other member should not see when tagged player blocks visibility"
  );
  await rawRequest("GET", playerTaggedPhoto.image_url, undefined, playerB.token, 403);
  await rawRequest("GET", `/api/sessions/${session.id}/album`, undefined, admin.token, 403);
  assert(true, "admin must not bypass tagged player privacy");
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

  await request(
    "PUT",
    `/api/sessions/${session.id}/album/privacy`,
    { allowUploadedVisible: false, allowTaggedVisible: true },
    owner.token
  );

  const otherTaggedPhoto = await request(
    "POST",
    `/api/sessions/${session.id}/album/photos`,
    { photoUrl: await uploadAlbumPhoto(session.id, owner.token, "other-tagged") },
    owner.token,
    201
  );
  const otherTaggedPhotoId = otherTaggedPhoto.data.id;
  const otherTagged = await request(
    "PUT",
    `/api/session-album/photos/${otherTaggedPhotoId}/tags`,
    { tagKeys: ["other:session"] },
    owner.token
  );
  const otherTaggedKeys = (otherTagged.data.tags || []).map((tag) => tag.key);
  assert(otherTaggedKeys.includes("other:session"), "album tags should save other:session");

  const npcOnlyPhoto = await request(
    "POST",
    `/api/sessions/${session.id}/album/photos`,
    { photoUrl: await uploadAlbumPhoto(session.id, owner.token, "npc-only") },
    owner.token,
    201
  );
  const npcOnlyPhotoId = npcOnlyPhoto.data.id;
  await request(
    "PUT",
    `/api/session-album/photos/${npcOnlyPhotoId}/tags`,
    { tagKeys: [`session-npc:${extraNpcRole.id}`] },
    owner.token
  );

  const otherMemberSpecialAlbum = await request(
    "GET",
    `/api/sessions/${session.id}/album`,
    undefined,
    playerB.token
  );
  assert(
    hasPhoto(otherMemberSpecialAlbum, otherTaggedPhotoId),
    "other-tagged photo should be visible to all same-session members"
  );
  assert(
    hasPhoto(otherMemberSpecialAlbum, npcOnlyPhotoId),
    "npc-only photo should be visible to all same-session members"
  );

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
