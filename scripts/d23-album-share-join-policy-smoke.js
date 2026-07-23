import crypto from "node:crypto";

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

function legacyAlbumShareToken({ sessionId, sharerUserId, seatId }) {
  const payloadText = Buffer.from(JSON.stringify({
    sessionId,
    sharerUserId,
    seatId,
    exp: Math.floor(Date.now() / 1000) + 10 * 60
  })).toString("base64url");
  const sessionSecret = process.env.SESSION_SECRET ||
    "local-docker-session-secret-change-before-production";
  const signature = crypto
    .createHmac("sha256", sessionSecret)
    .update(`session-album-share:${payloadText}`)
    .digest("hex");
  return `${payloadText}.${signature}`;
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

  const publicOwnPhoto = await createTaggedPhoto(
    direct.session.id,
    directPlayer,
    "public-own",
    [`seat:${direct.seats[0].id}`]
  );
  const publicScenePhoto = await createTaggedPhoto(
    direct.session.id,
    directPlayer,
    "public-scene",
    ["other:session"]
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

  const shareTokenPayload = await request(
    "POST",
    `/api/sessions/${direct.session.id}/album/share-token`,
    {},
    directPlayer.token
  );
  assert(shareTokenPayload.data.token, "confirmed direct player should receive album share token");
  assert(
    shareTokenPayload.data.focus_media_id === null,
    "empty-body album sharing should preserve the legacy no-focus response"
  );
  assert(shareTokenPayload.data.share_id, "D48 album share token should bind a snapshot share id");
  assert(
    Number(shareTokenPayload.data.share_subject.seat_id) === Number(direct.seats[0].id),
    "album share token subject should bind the confirmed seat"
  );

  const focusedShareTokenPayload = await request(
    "POST",
    `/api/sessions/${direct.session.id}/album/share-token`,
    { focusMediaId: Number(publicScenePhoto.id) },
    directPlayer.token
  );
  assert(
    Number(focusedShareTokenPayload.data.focus_media_id) === Number(publicScenePhoto.id),
    "numeric focusMediaId should be returned by the share-token route"
  );
  const focusedPublicAlbum = await request(
    "GET",
    `/api/sessions/${direct.session.id}/album/public-share?token=${encodeURIComponent(
      focusedShareTokenPayload.data.token
    )}`
  );
  assert(
    albumPhotoIds(focusedPublicAlbum).has(Number(publicScenePhoto.id)),
    "the focused share snapshot should persist the eligible requested media"
  );
  const unavailableFocusedShare = await request(
    "POST",
    `/api/sessions/${direct.session.id}/album/share-token`,
    { focusMediaId: Number(hiddenOtherSeatPhoto.id) },
    directPlayer.token,
    409
  );
  assert(
    unavailableFocusedShare.error?.code === "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE",
    "an ineligible focused media ID should fail closed with the D50 error code"
  );
  const signedClaims = JSON.parse(
    Buffer.from(shareTokenPayload.data.token.split(".")[0], "base64url").toString("utf8")
  );
  assert(signedClaims.version === 2, "new album share tokens should use version 2 claims");
  assert(
    Number(signedClaims.shareId) === Number(shareTokenPayload.data.share_id),
    "new album share token should bind the persisted snapshot"
  );

  const latePublicPhoto = await createTaggedPhoto(
    direct.session.id,
    directPlayer,
    "late-public",
    [`seat:${direct.seats[0].id}`]
  );

  const publicAlbum = await request(
    "GET",
    `/api/sessions/${direct.session.id}/album/public-share?token=${encodeURIComponent(
      shareTokenPayload.data.token
    )}`
  );
  const legacyToken = legacyAlbumShareToken({
    sessionId: direct.session.id,
    sharerUserId: directPlayer.user.id,
    seatId: direct.seats[0].id
  });
  const legacyPublicAlbum = await request(
    "GET",
    `/api/sessions/${direct.session.id}/album/public-share?token=${encodeURIComponent(legacyToken)}`
  );
  assert(
    albumPhotoIds(legacyPublicAlbum).has(Number(latePublicPhoto.id)),
    "a pre-D48 stateless token should remain read-only compatible with the stricter live filter"
  );
  const joinInvite = await request(
    "POST",
    `/api/sessions/${direct.session.id}/join-invite-token`,
    {},
    directPlayer.token,
    201
  );
  await request(
    "GET",
    `/api/sessions/${direct.session.id}/album/public-share?token=${encodeURIComponent(
      joinInvite.data.token
    )}`,
    undefined,
    undefined,
    403
  );
  const publicIds = albumPhotoIds(publicAlbum);
  assert(publicIds.has(Number(publicOwnPhoto.id)), "public album should include sharer seat photo");
  assert(publicIds.has(Number(publicScenePhoto.id)), "public album should include a tagged sharer-uploaded scene");
  assert(!publicIds.has(Number(latePublicPhoto.id)), "an old public snapshot should exclude later media");
  assert(!publicIds.has(Number(hiddenOtherSeatPhoto.id)), "public album should hide other-seat photo");
  assert(!publicIds.has(Number(hiddenUntaggedPhoto.id)), "public album should hide untagged photo");
  assert(!publicIds.has(Number(hiddenOtherOnlyPhoto.id)), "public album should hide other-only photo");
  assert(!publicIds.has(Number(hiddenNpcOnlyPhoto.id)), "public album should hide npc-only photo");
  assert(!("start_at" in publicAlbum.data), "public album should not expose the precise session time");
  assert(publicAlbum.data.played_on, "public album should expose only the Beijing play date");
  assert(publicAlbum.data.share_owner?.nickname, "public album should expose a safe share owner");
  assert(
    (publicAlbum.data.photos || []).every(
      (photo) => Array.isArray(photo.tags) && photo.tags.length === 0 &&
        !("uploader_user_id" in photo) && !("storage_object_key" in photo)
    ),
    "public album media DTO should remove people and storage internals"
  );

  assert(!("cover_url" in shareTokenPayload.data), "share-token DTO must omit server cover URLs");
  assert(
    !("timeline_cover_url" in shareTokenPayload.data),
    "share-token DTO must omit server timeline cover URLs"
  );
  assert(
    publicAlbum.data.cover_recipe?.version === "client-canvas-v1",
    "public album must expose a client Canvas cover recipe"
  );
  assert(
    (publicAlbum.data.cover_recipe?.images || []).every((image) => (
      /^\/api\/session-album\/public-share\/photos\/\d+\/image\?token=/.test(
        image.thumbnail_url
      ) &&
      image.thumbnail_url.includes("variant=thumbnail") &&
      Number.isFinite(image.width) && Number.isFinite(image.height)
    )),
    "public album cover recipes must expose only signed thumbnails and safe dimensions"
  );
  const recipeThumbnailUrls = (publicAlbum.data.cover_recipe?.images || [])
    .map((image) => image.thumbnail_url);

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

  await request(
    "PUT",
    `/api/sessions/${direct.session.id}/album/privacy`,
    { allowUploadedVisible: false, allowTaggedVisible: true },
    directPlayer.token
  );
  const hiddenByPrivacy = await request(
    "GET",
    `/api/sessions/${direct.session.id}/album/public-share?token=${encodeURIComponent(
      shareTokenPayload.data.token
    )}`
  );
  assert(
    hiddenByPrivacy.data.visible_count === 0,
    "the sharer's own uploader privacy veto should dynamically hide old snapshot media"
  );
  await rawRequest("GET", publicOwn.image_url, undefined, 403);
  assert(
    (hiddenByPrivacy.data.cover_recipe?.images || []).length === 0,
    "privacy removal must empty the client Canvas cover recipe"
  );
  for (const thumbnailUrl of recipeThumbnailUrls) {
    await rawRequest("GET", thumbnailUrl, undefined, 403);
  }
  await request(
    "PUT",
    `/api/sessions/${direct.session.id}/album/privacy`,
    { allowUploadedVisible: true, allowTaggedVisible: true },
    directPlayer.token
  );

  await request(
    "DELETE",
    `/api/sessions/${direct.session.id}/album/public-shares`,
    undefined,
    directPlayer.token
  );
  await request(
    "GET",
    `/api/sessions/${direct.session.id}/album/public-share?token=${encodeURIComponent(
      shareTokenPayload.data.token
    )}`,
    undefined,
    undefined,
    403
  );
  await rawRequest("GET", publicOwn.image_url, undefined, 403);
  for (const thumbnailUrl of recipeThumbnailUrls) {
    await rawRequest("GET", thumbnailUrl, undefined, 403);
  }
  const renewedShare = await request(
    "POST",
    `/api/sessions/${direct.session.id}/album/share-token`,
    {},
    directPlayer.token
  );
  assert(
    Number(renewedShare.data.share_id) !== Number(shareTokenPayload.data.share_id),
    "sharing after revocation should create a new share id"
  );
  assert(!("cover_url" in renewedShare.data), "renewed share must omit server cover URLs");
  assert(
    !("timeline_cover_url" in renewedShare.data),
    "renewed share must omit server timeline cover URLs"
  );
  const renewedPublicAlbum = await request(
    "GET",
    `/api/sessions/${direct.session.id}/album/public-share?token=${encodeURIComponent(
      renewedShare.data.token
    )}`
  );
  assert(
    renewedPublicAlbum.data.cover_recipe?.version === "client-canvas-v1",
    "renewed public album must expose a client Canvas cover recipe"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        directSessionId: direct.session.id,
        reviewSessionId: review.session.id,
        publicPhotoId: publicOwnPhoto.id,
        publicAlbumPage: `pages/session/album?id=${direct.session.id}&source=wechat_timeline&albumShareToken=${encodeURIComponent(
          renewedShare.data.token
        )}`,
        friendAlbumPage: `pages/session/album?id=${direct.session.id}&source=wechat_share&albumShareToken=${encodeURIComponent(
          renewedShare.data.token
        )}`
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
