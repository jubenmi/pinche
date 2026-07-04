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

async function rawRequest(method, path, token, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  });
  const body = Buffer.from(await response.arrayBuffer());
  if (response.status !== expectedStatus) {
    throw new Error(
      `${method} ${path} expected ${expectedStatus}, got ${response.status}: ${body
        .toString("utf8")
        .slice(0, 500)}`
    );
  }
  return {
    headers: response.headers,
    body
  };
}

async function multipartRequest(method, path, parts, token, expectedStatus = 200) {
  const boundary = `----pinche-d23-${suffix}-${Math.random().toString(16).slice(2)}`;
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

function startAt(hoursFromNow = -1) {
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

async function createPublishedSession(admin, owner, label, joinPolicy) {
  const store = await request(
    "POST",
    "/api/admin/stores",
    {
      name: `D23分享相册测试店-${suffix}-${label}`,
      city: "北京",
      district: "朝阳",
      address: "D23测试地址"
    },
    admin.token,
    201
  );
  const script = await request(
    "POST",
    "/api/admin/scripts",
    {
      name: `D23分享相册测试本-${suffix}-${label}`,
      typeTags: ["情感", "沉浸"],
      playerCount: 2,
      summaryNoSpoiler: "D23 album share smoke script",
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
      startAt: startAt(-1),
      joinPolicy,
      npcNameSnapshot: `D23指定NPC-${suffix}-${label}`,
      depositAmount: 5000,
      note: "D23 smoke session"
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

async function uploadAlbumPhoto(sessionId, token, label) {
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

async function createTaggedPhoto(sessionId, uploader, label, tagKeys) {
  const created = await request(
    "POST",
    `/api/sessions/${sessionId}/album/photos`,
    { photoUrl: await uploadAlbumPhoto(sessionId, uploader.token, label) },
    uploader.token,
    201
  );
  if (tagKeys.length > 0) {
    await request(
      "PUT",
      `/api/session-album/photos/${created.data.id}/tags`,
      { tagKeys },
      uploader.token
    );
  }
  return created.data;
}

function albumPhotoIds(album) {
  return new Set((album.data.photos || []).map((photo) => Number(photo.id)));
}

function publicPhoto(album, photoId) {
  return (album.data.photos || []).find((photo) => Number(photo.id) === Number(photoId));
}

async function main() {
  const admin = await login("dev-admin-openid");
  assert(admin.roles.includes("system_admin"), "admin should have system_admin role");

  const owner = await login(`dev-d23-owner-${suffix}`);
  const directPlayer = await login(`dev-d23-direct-player-${suffix}`);
  const reviewPlayer = await login(`dev-d23-review-player-${suffix}`);
  await authorizePhone(owner, "d23-owner-phone");
  await authorizePhone(directPlayer, "d23-direct-player-phone");
  await authorizePhone(reviewPlayer, "d23-review-player-phone");

  const review = await createPublishedSession(admin, owner, "review", "review_required");
  await request(
    "POST",
    `/api/session-seats/${review.seats[0].id}/claim`,
    { note: "review车直接上车应被拒绝" },
    reviewPlayer.token,
    403
  );
  const signup = await request(
    "POST",
    "/api/signups",
    { seatId: review.seats[0].id, note: "review车申请上车" },
    reviewPlayer.token,
    201
  );
  assert(signup.data.status === "pending", "review_required session should create pending signup");
  await request(
    "POST",
    `/api/sessions/${review.session.id}/album/share-token`,
    {},
    reviewPlayer.token,
    403
  );

  const direct = await createPublishedSession(admin, owner, "direct", "direct");
  const joined = await request(
    "POST",
    `/api/session-seats/${direct.seats[0].id}/claim`,
    { note: "direct车直接上车" },
    directPlayer.token
  );
  assert(joined.data.join_result === "joined", "direct session should join immediately");

  const shareTokenPayload = await request(
    "POST",
    `/api/sessions/${direct.session.id}/album/share-token`,
    {},
    directPlayer.token
  );
  assert(shareTokenPayload.data.token, "confirmed direct player should receive album share token");
  assert(
    Number(shareTokenPayload.data.share_subject.seat_id) === Number(direct.seats[0].id),
    "album share token subject should bind the confirmed seat"
  );

  const publicOwnPhoto = await createTaggedPhoto(
    direct.session.id,
    directPlayer,
    "public-own",
    [`seat:${direct.seats[0].id}`]
  );
  const hiddenOtherSeatPhoto = await createTaggedPhoto(
    direct.session.id,
    owner,
    "other-seat",
    [`seat:${direct.seats[1].id}`]
  );
  const hiddenUntaggedPhoto = await createTaggedPhoto(
    direct.session.id,
    owner,
    "untagged",
    []
  );
  const hiddenOtherOnlyPhoto = await createTaggedPhoto(
    direct.session.id,
    owner,
    "other-only",
    ["other:session"]
  );
  const hiddenNpcOnlyPhoto = await createTaggedPhoto(
    direct.session.id,
    owner,
    "npc-only",
    ["npc:session"]
  );

  const publicAlbum = await request(
    "GET",
    `/api/sessions/${direct.session.id}/album/public-share?token=${encodeURIComponent(
      shareTokenPayload.data.token
    )}`
  );
  const publicIds = albumPhotoIds(publicAlbum);
  assert(publicIds.has(Number(publicOwnPhoto.id)), "public album should include sharer seat photo");
  assert(!publicIds.has(Number(hiddenOtherSeatPhoto.id)), "public album should hide other-seat photo");
  assert(!publicIds.has(Number(hiddenUntaggedPhoto.id)), "public album should hide untagged photo");
  assert(!publicIds.has(Number(hiddenOtherOnlyPhoto.id)), "public album should hide other-only photo");
  assert(!publicIds.has(Number(hiddenNpcOnlyPhoto.id)), "public album should hide npc-only photo");

  const publicOwn = publicPhoto(publicAlbum, publicOwnPhoto.id);
  assert(publicOwn?.image_url, "public album photo should include public image URL");
  const publicImage = await rawRequest("GET", publicOwn.image_url);
  assert(
    (publicImage.headers.get("content-type") || "").includes("image/jpeg"),
    "public album image should render without login"
  );

  const memberAlbum = await request(
    "GET",
    `/api/sessions/${direct.session.id}/album`,
    undefined,
    directPlayer.token
  );
  const memberOwn = publicPhoto(memberAlbum, publicOwnPhoto.id);
  const privateQuery = String(memberOwn.image_url || "").split("?")[1] || "";
  await rawRequest(
    "GET",
    `/api/session-album/public-share/photos/${publicOwnPhoto.id}/image?${privateQuery}`,
    undefined,
    403
  );

  const tamperedPublicUrl = publicOwn.image_url.replace(
    `/photos/${publicOwnPhoto.id}/image`,
    `/photos/${hiddenOtherSeatPhoto.id}/image`
  );
  await rawRequest("GET", tamperedPublicUrl, undefined, 403);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        directSessionId: direct.session.id,
        reviewSessionId: review.session.id,
        publicPhotoId: publicOwnPhoto.id,
        publicAlbumPage: `pages/session/album?id=${direct.session.id}&source=wechat_timeline&albumShareToken=${encodeURIComponent(
          shareTokenPayload.data.token
        )}`,
        albumEntrySharePage: `pages/session/share?id=${direct.session.id}&entry=album&source=wechat_share`
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
