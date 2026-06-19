# Session Review Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users see created and joined sessions in Mine, then write public star-rated photo records for joined sessions after `start_at` without needing organizer confirmation.

**Architecture:** Keep records attached to the existing `sessions` and `signups` model. Persist review eligibility on `signups.review_eligible_at` when a user becomes confirmed, then allow personal records after `sessions.start_at` even if organizer actions happen later. Add focused API routes, a Mini Program review page, and static regression checks following this repo's existing check-script pattern.

**Tech Stack:** Node.js HTTP API, MySQL migrations, UniApp/Vue Mini Program, existing `uni.uploadFile`, existing static Node check scripts.

---

## File Structure

- Create `apps/api/migrations/0010_session_review_records.sql`: add `signups.review_eligible_at`, `session_reviews`, and `session_review_photos`.
- Modify `apps/api/src/modules/core/service.js`: add review eligibility helpers, joined-session list data, review CRUD, review photo path validation, and preserve eligibility after start.
- Modify `apps/api/src/server.js`: add review photo upload/static serving and review API routes.
- Modify `apps/miniprogram/src/utils/api.js`: add `uploadSessionReviewPhoto(filePath)`.
- Modify `apps/miniprogram/src/pages.json`: register `pages/session/review`.
- Create `apps/miniprogram/src/pages/session/review.vue`: write/edit current user's record.
- Modify `apps/miniprogram/src/pages/mine/index.vue`: show "我发起" and "我参与", add write-record entry.
- Modify `apps/miniprogram/src/pages/session/detail.vue`: show public record wall and current user's write/edit entry.
- Create `scripts/d15-session-review-records-check.js`: static regression check for this feature.
- Modify `package.json`: include D15 check in `npm run check`.

## Task 1: Add A Failing Static Regression Check

**Files:**
- Create: `scripts/d15-session-review-records-check.js`

- [ ] **Step 1: Write the failing check script**

Create `scripts/d15-session-review-records-check.js` with:

```js
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const migration = read("apps/api/migrations/0010_session_review_records.sql");
assert(migration.includes("review_eligible_at"), "migration must add signup review eligibility");
assert(migration.includes("CREATE TABLE IF NOT EXISTS session_reviews"), "migration must create session_reviews");
assert(migration.includes("CREATE TABLE IF NOT EXISTS session_review_photos"), "migration must create session_review_photos");
assert(migration.includes("uniq_session_reviews_user"), "reviews must be unique per session and user");

const service = read("apps/api/src/modules/core/service.js");
assert(service.includes("export async function listSessionReviews"), "service must list public reviews");
assert(service.includes("export async function getMySessionReview"), "service must load current user's review");
assert(service.includes("export async function upsertMySessionReview"), "service must upsert current user's review");
assert(service.includes("review_eligible_at"), "service must persist and read review eligibility");
assert(service.includes("can_review"), "service must return can_review for Mine participation rows");
assert(service.includes("has_review"), "service must return has_review for Mine participation rows");
assert(service.includes("assertSessionReviewPhotoUrls"), "service must validate review photo paths");
assert(service.includes("MAX_SESSION_REVIEW_PHOTOS"), "service must enforce review photo count");

const server = read("apps/api/src/server.js");
assert(server.includes("sessionReviewUploadDir"), "server must define review upload directory");
assert(server.includes("saveUploadedSessionReviewPhoto"), "server must save review photos");
assert(server.includes("/uploads/session-reviews/"), "server must serve review photo uploads");
assert(server.includes("/api/session-reviews/photos"), "server must route review photo upload");
assert(server.includes("/api/sessions/") && server.includes("/reviews"), "server must route public session reviews");
assert(server.includes("/review"), "server must route current user review endpoints");

const api = read("apps/miniprogram/src/utils/api.js");
assert(api.includes("export async function uploadSessionReviewPhoto"), "miniprogram API must upload review photos");
assert(api.includes('name: "photo"'), "review photo upload must use photo field name");

const pagesJson = read("apps/miniprogram/src/pages.json");
assert(pagesJson.includes("pages/session/review"), "pages.json must register review page");

const mine = read("apps/miniprogram/src/pages/mine/index.vue");
assert(mine.includes("我发起"), "Mine page must label created sessions");
assert(mine.includes("我参与"), "Mine page must label joined sessions");
assert(mine.includes("loadMySignups"), "Mine page must load joined sessions");
assert(mine.includes("goReview"), "Mine page must navigate to review page");

const detail = read("apps/miniprogram/src/pages/session/detail.vue");
assert(detail.includes("车友记录"), "detail page must show review records");
assert(detail.includes("loadSessionReviews"), "detail page must load public reviews");
assert(detail.includes("goReview"), "detail page must navigate to review page");

const reviewPage = read("apps/miniprogram/src/pages/session/review.vue");
assert(reviewPage.includes("uploadSessionReviewPhoto"), "review page must upload selected photos");
assert(reviewPage.includes("PUT"), "review page must save review with PUT");
assert(reviewPage.includes("rating"), "review page must collect rating");
assert(reviewPage.includes("photoUrls"), "review page must save photo urls");

console.log("D15 session review records check passed");
```

- [ ] **Step 2: Run the check to verify it fails**

Run:

```bash
node scripts/d15-session-review-records-check.js
```

Expected: FAIL with `ENOENT` for `apps/api/migrations/0010_session_review_records.sql`.

- [ ] **Step 3: Commit the failing guard only**

Run:

```bash
git add scripts/d15-session-review-records-check.js
git commit -m "test: add session review records guard"
```

Expected: commit succeeds. Do not add the script to root `npm run check` yet, so the main check suite remains green until the feature is implemented.

## Task 2: Add Review Tables And Eligibility Persistence

**Files:**
- Create: `apps/api/migrations/0010_session_review_records.sql`
- Modify: `apps/api/src/modules/core/service.js`

- [ ] **Step 1: Create the migration**

Create `apps/api/migrations/0010_session_review_records.sql`:

```sql
SET @pinche_d15_add_review_eligible_at = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'signups'
        AND column_name = 'review_eligible_at'
    ),
    'ALTER TABLE signups ADD COLUMN review_eligible_at DATETIME NULL AFTER deposit_status',
    'SELECT 1'
  )
);

PREPARE pinche_d15_review_eligible_stmt FROM @pinche_d15_add_review_eligible_at;
EXECUTE pinche_d15_review_eligible_stmt;
DEALLOCATE PREPARE pinche_d15_review_eligible_stmt;

UPDATE signups
SET review_eligible_at = updated_at
WHERE status = 'approved'
  AND review_eligible_at IS NULL;

CREATE TABLE IF NOT EXISTS session_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  seat_id BIGINT UNSIGNED NULL,
  rating TINYINT UNSIGNED NOT NULL,
  content TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_session_reviews_user (session_id, user_id),
  INDEX idx_session_reviews_session_status (session_id, status),
  INDEX idx_session_reviews_user (user_id),
  INDEX idx_session_reviews_seat (seat_id),
  CONSTRAINT fk_session_reviews_session FOREIGN KEY (session_id) REFERENCES sessions(id),
  CONSTRAINT fk_session_reviews_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_session_reviews_seat FOREIGN KEY (seat_id) REFERENCES session_seats(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session_review_photos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  review_id BIGINT UNSIGNED NOT NULL,
  photo_url VARCHAR(512) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_review_photos_review (review_id, sort_order),
  CONSTRAINT fk_session_review_photos_review FOREIGN KEY (review_id) REFERENCES session_reviews(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Run the static guard**

Run:

```bash
node scripts/d15-session-review-records-check.js
```

Expected: FAIL with `service must list public reviews`.

- [ ] **Step 3: Add constants and helpers in `service.js`**

In `apps/api/src/modules/core/service.js`, after `MESSAGE_TEXT_RISK_WORDS`, add:

```js
const MAX_SESSION_REVIEW_PHOTOS = 9;
const SESSION_REVIEW_PHOTO_PREFIX = "/uploads/session-reviews/";

function reviewRating(value) {
  const rating = intValue(value);
  if (rating < 1 || rating > 5) {
    throw badRequest("rating must be between 1 and 5");
  }
  return rating;
}

function reviewContent(value) {
  const content = optionalText(value);
  if (content && content.length > 500) {
    throw badRequest("content must be 500 characters or fewer");
  }
  assertPublicTextSafe("content", content);
  return content;
}

function assertSessionReviewPhotoUrls(photoUrls) {
  const urls = photoUrls === undefined ? [] : photoUrls;
  if (!Array.isArray(urls)) {
    throw badRequest("photoUrls must be an array");
  }
  if (urls.length > MAX_SESSION_REVIEW_PHOTOS) {
    throw badRequest(`photoUrls cannot contain more than ${MAX_SESSION_REVIEW_PHOTOS} photos`);
  }
  return urls.map((url) => {
    const text = String(url || "").trim();
    if (!text.startsWith(SESSION_REVIEW_PHOTO_PREFIX)) {
      throw badRequest("photoUrls must contain uploaded session review photos");
    }
    if (!/^\/uploads\/session-reviews\/[A-Za-z0-9._-]+$/.test(text)) {
      throw badRequest("photoUrls contains an invalid file path");
    }
    return text;
  });
}
```

- [ ] **Step 4: Add eligibility helpers in `service.js`**

After `releaseUserOtherConfirmedSeats`, add:

```js
function reviewWindowSql() {
  return `
    session.start_at <= CURRENT_TIMESTAMP
    AND (
      session.status <> 'cancelled'
      OR session.cancelled_at IS NULL
      OR session.cancelled_at >= session.start_at
    )
  `;
}

async function currentEligibleSignup(connection, sessionId, userId) {
  const [rows] = await connection.query(
    `
      SELECT
        signup.*,
        seat.name AS seat_name,
        seat.role_name AS seat_role_name,
        session.start_at,
        session.status AS session_status,
        session.cancelled_at
      FROM signups signup
      JOIN sessions session ON session.id = signup.session_id
      LEFT JOIN session_seats seat ON seat.id = signup.seat_id
      WHERE signup.session_id = ?
        AND signup.user_id = ?
        AND signup.review_eligible_at IS NOT NULL
        AND ${reviewWindowSql()}
      ORDER BY signup.review_eligible_at DESC, signup.id DESC
      LIMIT 1
    `,
    [sessionId, userId]
  );
  return rows[0] || null;
}

async function markSignupReviewEligible(connection, signupId) {
  await connection.query(
    `
      UPDATE signups
      SET review_eligible_at = COALESCE(review_eligible_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `,
    [signupId]
  );
}

async function clearPreStartReviewEligibilityForSeat(connection, seatId) {
  await connection.query(
    `
      UPDATE signups signup
      JOIN sessions session ON session.id = signup.session_id
      SET signup.review_eligible_at = NULL
      WHERE signup.seat_id = ?
        AND session.start_at > CURRENT_TIMESTAMP
    `,
    [seatId]
  );
}

async function clearPreStartReviewEligibilityForSession(connection, sessionId) {
  await connection.query(
    `
      UPDATE signups signup
      JOIN sessions session ON session.id = signup.session_id
      SET signup.review_eligible_at = NULL
      WHERE signup.session_id = ?
        AND session.start_at > CURRENT_TIMESTAMP
    `,
    [sessionId]
  );
}
```

- [ ] **Step 5: Persist eligibility when a user gets a confirmed seat**

In `claimSessionSeat`, replace the `INSERT INTO signups ... ON DUPLICATE KEY UPDATE` block with:

```js
    await connection.query(
      `
        INSERT INTO signups
          (session_id, seat_id, user_id, contact_text, note, status, review_eligible_at)
        VALUES (?, ?, ?, ?, ?, 'approved', CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          status = 'approved',
          contact_text = VALUES(contact_text),
          note = VALUES(note),
          review_eligible_at = COALESCE(review_eligible_at, CURRENT_TIMESTAMP)
      `,
      [
        seat.session_id,
        seat.id,
        user.user.id,
        optionalText(body.contactText),
        optionalText(body.note)
      ]
    );
```

In `approveSignup`, after `UPDATE signups SET status = 'approved' WHERE id = ?`, add:

```js
    await markSignupReviewEligible(connection, signupId);
```

- [ ] **Step 6: Preserve eligibility after start and clear it before start**

In `releaseUserOtherConfirmedSeats`, after the existing `UPDATE signups SET status = 'cancelled' ...` query, add:

```js
  for (const confirmedRow of confirmedRows) {
    await clearPreStartReviewEligibilityForSeat(connection, confirmedRow.id);
  }
```

In `kickSessionSeat`, after the existing `UPDATE signups SET status = 'cancelled' ...` query, add:

```js
    await clearPreStartReviewEligibilityForSeat(connection, seatId);
```

In `cancelSession`, after the existing `UPDATE signups SET status = 'cancelled' ...` query, add:

```js
    await clearPreStartReviewEligibilityForSession(connection, sessionId);
```

- [ ] **Step 7: Run syntax checks**

Run:

```bash
node --check apps/api/src/modules/core/service.js
```

Expected: exits 0.

- [ ] **Step 8: Commit migration and eligibility**

Run:

```bash
git add apps/api/migrations/0010_session_review_records.sql apps/api/src/modules/core/service.js
git commit -m "feat: persist session review eligibility"
```

Expected: commit succeeds.

## Task 3: Add Backend Review APIs And Photo Uploads

**Files:**
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`

- [ ] **Step 1: Add review service functions**

At the end of the session/signup service section in `apps/api/src/modules/core/service.js`, before `createShareEvent`, add:

```js
async function reviewPhotos(connection, reviewIds) {
  if (reviewIds.length === 0) {
    return new Map();
  }
  const placeholders = reviewIds.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `
      SELECT review_id, photo_url
      FROM session_review_photos
      WHERE review_id IN (${placeholders})
      ORDER BY review_id, sort_order, id
    `,
    reviewIds
  );
  const photosByReview = new Map();
  for (const row of rows) {
    const list = photosByReview.get(Number(row.review_id)) || [];
    list.push(row.photo_url);
    photosByReview.set(Number(row.review_id), list);
  }
  return photosByReview;
}

export async function listSessionReviews(sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const session = await findById(connection, "sessions", id);
    if (!session) {
      throw notFound("Session not found");
    }
    const [rows] = await connection.query(
      `
        SELECT
          review.*,
          user.nickname AS user_nickname,
          user.avatar_url AS user_avatar_url,
          user.open_id AS user_open_id,
          seat.name AS seat_name,
          seat.role_name AS seat_role_name
        FROM session_reviews review
        JOIN users user ON user.id = review.user_id
        LEFT JOIN session_seats seat ON seat.id = review.seat_id
        WHERE review.session_id = ?
          AND review.status = 'active'
        ORDER BY review.updated_at DESC, review.id DESC
      `,
      [id]
    );
    const photosByReview = await reviewPhotos(connection, rows.map((row) => Number(row.id)));
    return rows.map((row) => ({
      ...row,
      photos: photosByReview.get(Number(row.id)) || []
    }));
  });
}

export async function getMySessionReview(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const eligibleSignup = await currentEligibleSignup(connection, id, user.user.id);
    const [rows] = await connection.query(
      `
        SELECT *
        FROM session_reviews
        WHERE session_id = ?
          AND user_id = ?
          AND status = 'active'
        LIMIT 1
      `,
      [id, user.user.id]
    );
    const review = rows[0] || null;
    const photosByReview = review
      ? await reviewPhotos(connection, [Number(review.id)])
      : new Map();
    return {
      can_review: Boolean(eligibleSignup),
      review: review
        ? {
            ...review,
            photos: photosByReview.get(Number(review.id)) || []
          }
        : null
    };
  });
}

export async function upsertMySessionReview(user, sessionId, body = {}) {
  const id = positiveId(sessionId, "sessionId");
  const rating = reviewRating(body.rating);
  const content = reviewContent(body.content);
  const photoUrls = assertSessionReviewPhotoUrls(body.photoUrls);

  return withTransaction(async (connection) => {
    const eligibleSignup = await currentEligibleSignup(connection, id, user.user.id);
    if (!eligibleSignup) {
      throw forbidden("Only eligible session participants can write a review after start time");
    }

    await connection.query(
      `
        INSERT INTO session_reviews
          (session_id, user_id, seat_id, rating, content, status)
        VALUES (?, ?, ?, ?, ?, 'active')
        ON DUPLICATE KEY UPDATE
          seat_id = VALUES(seat_id),
          rating = VALUES(rating),
          content = VALUES(content),
          status = 'active'
      `,
      [id, user.user.id, eligibleSignup.seat_id || null, rating, content]
    );

    const [reviewRows] = await connection.query(
      `
        SELECT *
        FROM session_reviews
        WHERE session_id = ?
          AND user_id = ?
        LIMIT 1
      `,
      [id, user.user.id]
    );
    const review = reviewRows[0];
    await connection.query("DELETE FROM session_review_photos WHERE review_id = ?", [
      review.id
    ]);
    for (const [index, photoUrl] of photoUrls.entries()) {
      await connection.query(
        `
          INSERT INTO session_review_photos (review_id, photo_url, sort_order)
          VALUES (?, ?, ?)
        `,
        [review.id, photoUrl, index]
      );
    }
    return {
      ...review,
      rating,
      content,
      photos: photoUrls
    };
  });
}
```

- [ ] **Step 2: Extend `listMySignups` with session context**

Replace `listMySignups` in `apps/api/src/modules/core/service.js` with:

```js
export async function listMySignups(user) {
  return withDatabaseConnection(async (connection) => {
    const [rows] = await connection.query(
      `
        SELECT
          signup.*,
          session.script_name_snapshot,
          session.store_name_snapshot,
          session.start_at,
          session.status AS session_status,
          session.cancelled_at,
          seat.name AS seat_name,
          seat.role_name AS seat_role_name,
          seat.status AS seat_status,
          EXISTS (
            SELECT 1
            FROM session_reviews review
            WHERE review.session_id = signup.session_id
              AND review.user_id = signup.user_id
              AND review.status = 'active'
          ) AS has_review,
          (
            signup.review_eligible_at IS NOT NULL
            AND ${reviewWindowSql()}
          ) AS can_review
        FROM signups signup
        JOIN sessions session ON session.id = signup.session_id
        LEFT JOIN session_seats seat ON seat.id = signup.seat_id
        WHERE signup.user_id = ?
        ORDER BY session.start_at DESC, signup.id DESC
      `,
      [user.user.id]
    );
    return rows.map((row) => ({
      ...row,
      can_review: Boolean(row.can_review),
      has_review: Boolean(row.has_review)
    }));
  });
}
```

- [ ] **Step 3: Export and import review functions**

In `apps/api/src/server.js`, add these imports from `./modules/core/service.js`:

```js
  getMySessionReview,
  listSessionReviews,
  upsertMySessionReview,
```

- [ ] **Step 4: Add review photo upload helpers in `server.js`**

After `avatarUploadDir`, add:

```js
const sessionReviewUploadDir = path.join(apiRoot, "uploads", "session-reviews");
const SESSION_REVIEW_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const SESSION_REVIEW_MULTIPART_MAX_BYTES = SESSION_REVIEW_UPLOAD_MAX_BYTES + 64 * 1024;
```

After `saveUploadedAvatar`, add:

```js
async function saveUploadedSessionReviewPhoto(request, userId) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    throw badRequest("review photo upload must be multipart/form-data");
  }

  const body = await readRawBody(request, SESSION_REVIEW_MULTIPART_MAX_BYTES);
  const { extension, file } = parseMultipartImageUpload(contentType, body, {
    fieldName: "photo",
    maxBytes: SESSION_REVIEW_UPLOAD_MAX_BYTES,
    label: "review photo"
  });
  await fs.mkdir(sessionReviewUploadDir, { recursive: true });
  const photoFilename = `review-${userId}-${Date.now()}-${crypto
    .randomBytes(8)
    .toString("hex")}${extension}`;
  await fs.writeFile(path.join(sessionReviewUploadDir, photoFilename), file);
  return `/uploads/session-reviews/${photoFilename}`;
}
```

Keep the existing `parseMultipartAvatarUpload` name for D14 compatibility. Add a generic helper above it, then replace the body of `parseMultipartAvatarUpload` with a wrapper call.

```js
function parseMultipartImageUpload(contentType, body, options = {}) {
  const fieldName = options.fieldName || "avatar";
  const maxBytes = options.maxBytes || AVATAR_UPLOAD_MAX_BYTES;
  const label = options.label || fieldName;
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] ||
    contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) {
    throw badRequest("multipart boundary is required");
  }

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  for (const rawPart of splitBuffer(body, boundaryBuffer)) {
    let part = rawPart;
    if (part.length >= 2 && part[0] === 13 && part[1] === 10) {
      part = part.subarray(2);
    }
    if (part.length === 0 || part.subarray(0, 2).toString() === "--") {
      continue;
    }

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) {
      continue;
    }

    const headersText = part.subarray(0, headerEnd).toString("utf8");
    const disposition = headersText.match(/^content-disposition:\s*(.+)$/im)?.[1] || "";
    if (!disposition.includes(`name="${fieldName}"`) || !/filename="/.test(disposition)) {
      continue;
    }

    const mimeType = headersText.match(/^content-type:\s*([^\r\n;]+)/im)?.[1]?.trim() || "";
    const file = trimMultipartPayload(part.subarray(headerEnd + 4));
    if (file.length === 0) {
      throw badRequest(`${label} file is required`);
    }
    if (file.length > maxBytes) {
      throw badRequest(`${label} file is too large`);
    }

    const extension = avatarExtensionFromBytes(file) || avatarMimeTypes[mimeType];
    if (!extension) {
      throw badRequest(`${label} must be a JPEG or PNG image`);
    }

    return { extension, file, mimeType };
  }

  throw badRequest(`${label} file is required`);
}
```

Replace `parseMultipartAvatarUpload` with:

```js
function parseMultipartAvatarUpload(contentType, body) {
  return parseMultipartImageUpload(contentType, body, {
    fieldName: "avatar",
    maxBytes: AVATAR_UPLOAD_MAX_BYTES,
    label: "avatar"
  });
}
```

Keep `saveUploadedAvatar` calling `parseMultipartAvatarUpload(contentType, body)`:

```js
  const { extension, file } = parseMultipartAvatarUpload(contentType, body);
```

- [ ] **Step 5: Add static serving for review photos**

After `serveUploadedAvatar`, add:

```js
async function serveUploadedSessionReviewPhoto(url, response) {
  const requestedName = decodeURIComponent(
    url.pathname.slice("/uploads/session-reviews/".length)
  );
  const photoFilename = path.basename(requestedName);
  if (!photoFilename || photoFilename !== requestedName || !/^[A-Za-z0-9._-]+$/.test(photoFilename)) {
    throw notFound();
  }

  const filePath = path.join(sessionReviewUploadDir, photoFilename);
  let file;
  try {
    file = await fs.readFile(filePath);
  } catch (error) {
    throw notFound();
  }

  response.writeHead(200, {
    "cache-control": "public, max-age=31536000, immutable",
    "content-length": file.length,
    "content-type": avatarContentType(photoFilename)
  });
  response.end(file);
}
```

At the start of `route`, after the avatar static route, add:

```js
  if (request.method === "GET" && url.pathname.startsWith("/uploads/session-reviews/")) {
    await serveUploadedSessionReviewPhoto(url, response);
    return;
  }
```

- [ ] **Step 6: Add review routes**

In `route`, before `bodyFor(request)` tries to parse JSON multipart uploads, add:

```js
  if (request.method === "POST" && url.pathname === "/api/session-reviews/photos") {
    const user = await getAuthUser(request);
    const photoUrl = await saveUploadedSessionReviewPhoto(request, user.user.id);
    jsonResponse(response, 201, {
      ok: true,
      data: { photoUrl }
    });
    return;
  }
```

After the `GET /api/sessions/:id` and `PATCH /api/sessions/:id` routes, add:

```js
  const sessionReviewsId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/reviews$/);
  if (request.method === "GET" && sessionReviewsId) {
    jsonResponse(response, 200, {
      ok: true,
      data: await listSessionReviews(sessionReviewsId)
    });
    return;
  }

  const mySessionReviewId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/review$/);
  if (request.method === "GET" && mySessionReviewId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await getMySessionReview(user, mySessionReviewId)
    });
    return;
  }
  if (request.method === "PUT" && mySessionReviewId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await upsertMySessionReview(user, mySessionReviewId, body)
    });
    return;
  }
```

- [ ] **Step 7: Run checks for backend files**

Run:

```bash
node --check apps/api/src/server.js
node --check apps/api/src/modules/core/service.js
node scripts/d15-session-review-records-check.js
```

Expected: first two commands pass; D15 fails with `miniprogram API must upload review photos`.

- [ ] **Step 8: Commit backend review APIs**

Run:

```bash
git add apps/api/src/server.js apps/api/src/modules/core/service.js
git commit -m "feat: add session review APIs"
```

Expected: commit succeeds.

## Task 4: Add Mini Program API Helper And Review Page

**Files:**
- Modify: `apps/miniprogram/src/utils/api.js`
- Modify: `apps/miniprogram/src/pages.json`
- Create: `apps/miniprogram/src/pages/session/review.vue`

- [ ] **Step 1: Add `uploadSessionReviewPhoto`**

In `apps/miniprogram/src/utils/api.js`, after `uploadUserAvatar`, add:

```js
export async function uploadSessionReviewPhoto(filePath) {
  if (shouldBlockBusinessRequests()) {
    return Promise.reject({
      statusCode: 0,
      maintenance: true,
      errMsg: "backend maintenance",
      userMessage: MAINTENANCE_USER_MESSAGE
    });
  }

  const headers = {};
  const token = getToken();
  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: getApiBaseUrl() + "/api/session-reviews/photos",
      filePath,
      name: "photo",
      header: headers,
      success(response) {
        let responseData = response.data || {};
        if (typeof responseData === "string") {
          try {
            responseData = JSON.parse(responseData);
          } catch (error) {
            reject({
              statusCode: response.statusCode,
              errMsg: "invalid upload response",
              originalError: error
            });
            return;
          }
        }

        if (response.statusCode >= 400 || responseData.ok === false) {
          reject({
            statusCode: response.statusCode,
            data: responseData
          });
          return;
        }

        const photoUrl = responseData.data?.photoUrl || "";
        if (!photoUrl) {
          reject({
            statusCode: response.statusCode,
            errMsg: "missing photoUrl"
          });
          return;
        }

        resolve(photoUrl);
      },
      fail(error) {
        const errMsg = error?.errMsg || "upload failed";
        markBackendMaintenance(error);
        reject({
          statusCode: 0,
          maintenance: true,
          errMsg,
          userMessage: errMsg.includes("timeout")
            ? "照片上传超时，请确认本地后端已启动。"
            : "照片上传失败，请稍后重试。",
          originalError: error
        });
      }
    });
  });
}
```

- [ ] **Step 2: Register the review page**

In `apps/miniprogram/src/pages.json`, add this page object after `pages/session/detail`:

```json
    {
      "path": "pages/session/review",
      "style": {
        "navigationBarTitleText": "写记录"
      }
    },
```

- [ ] **Step 3: Create `review.vue`**

Create `apps/miniprogram/src/pages/session/review.vue`:

```vue
<template>
  <view class="page review-page">
    <AuthIdentityBar />

    <view class="section">
      <view class="title">写记录</view>
      <view class="text">到发车时间后，你可以留下自己的星级、文字和照片。</view>
      <view v-if="statusText" class="notice">{{ statusText }}</view>
    </view>

    <view class="section">
      <view class="section-title">星级</view>
      <view class="rating-row">
        <button
          v-for="value in [1, 2, 3, 4, 5]"
          :key="value"
          class="rating-button"
          :class="{ active: rating >= value }"
          @tap="rating = value"
        >
          ★
        </button>
      </view>
    </view>

    <view class="section">
      <view class="section-title">文字记录</view>
      <textarea
        v-model="content"
        class="textarea"
        maxlength="500"
        placeholder="写一点这车的体验"
        placeholder-class="placeholder"
      />
      <view class="counter">{{ content.length }}/500</view>
    </view>

    <view class="section">
      <view class="section-head">
        <view class="section-title">照片</view>
        <button class="photo-add" :disabled="photos.length >= 9 || saving" @tap="choosePhotos">
          添加
        </button>
      </view>
      <view class="photo-grid">
        <view v-for="(photo, index) in photos" :key="photo" class="photo-cell">
          <image class="photo-image" :src="assetUrl(photo)" mode="aspectFill" />
          <button class="photo-remove" :disabled="saving" @tap="removePhoto(index)">移除</button>
        </view>
      </view>
    </view>

    <view class="bottom-action">
      <button class="button" :disabled="saving || !canSave" @tap="saveReview">
        {{ saving ? "保存中..." : "保存记录" }}
      </button>
    </view>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import {
  assetUrl,
  dataOf,
  ensureLoggedIn,
  request,
  uploadSessionReviewPhoto
} from "../../utils/api";

export default {
  components: { AuthIdentityBar },
  data() {
    return {
      sessionId: "",
      canReview: false,
      rating: 5,
      content: "",
      photos: [],
      statusText: "",
      saving: false
    };
  },
  computed: {
    canSave() {
      return this.canReview && this.rating >= 1 && this.rating <= 5;
    }
  },
  async onLoad(options) {
    this.sessionId = options.id || "";
    const auth = await ensureLoggedIn({
      content: "登录后可以写自己的车局记录。"
    });
    if (!auth) {
      this.statusText = "登录后可继续写记录。";
      return;
    }
    await this.loadMyReview();
  },
  methods: {
    assetUrl,
    async loadMyReview() {
      if (!this.sessionId) {
        this.statusText = "请从车详情或我的车局进入记录页。";
        return;
      }
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/review` });
        const data = dataOf(response) || {};
        this.canReview = Boolean(data.can_review);
        if (!this.canReview) {
          this.statusText = "到发车时间后，已上车玩家可以写记录。";
        } else {
          this.statusText = "";
        }
        if (data.review) {
          this.rating = Number(data.review.rating || 5);
          this.content = data.review.content || "";
          this.photos = data.review.photos || [];
        }
      } catch (error) {
        this.statusText = "记录加载失败，请稍后重试。";
      }
    },
    choosePhotos() {
      if (this.photos.length >= 9) {
        uni.showToast({ title: "最多上传9张照片", icon: "none" });
        return;
      }
      uni.chooseImage({
        count: 9 - this.photos.length,
        sizeType: ["compressed"],
        sourceType: ["album", "camera"],
        success: async (result) => {
          await this.uploadChosenPhotos(result.tempFilePaths || []);
        }
      });
    },
    async uploadChosenPhotos(paths) {
      if (paths.length === 0) {
        return;
      }
      this.saving = true;
      this.statusText = "正在上传照片...";
      try {
        for (const filePath of paths) {
          const photoUrl = await uploadSessionReviewPhoto(filePath);
          this.photos.push(photoUrl);
        }
        this.statusText = "";
      } catch (error) {
        this.statusText = error?.userMessage || "照片上传失败，请稍后重试。";
      } finally {
        this.saving = false;
      }
    },
    removePhoto(index) {
      this.photos.splice(index, 1);
    },
    async saveReview() {
      if (!this.canSave || this.saving) {
        return;
      }
      this.saving = true;
      this.statusText = "正在保存记录...";
      try {
        await request({
          url: `/api/sessions/${this.sessionId}/review`,
          method: "PUT",
          data: {
            rating: this.rating,
            content: this.content.trim(),
            photoUrls: this.photos
          }
        });
        uni.showToast({ title: "记录已保存", icon: "none" });
        setTimeout(() => {
          uni.navigateBack();
        }, 350);
      } catch (error) {
        if (error?.statusCode === 403) {
          this.statusText = "只有已上车玩家可以写记录。";
        } else if (error?.statusCode === 400) {
          this.statusText = "请检查星级、文字和照片后再保存。";
        } else {
          this.statusText = "记录保存失败，请稍后重试。";
        }
      } finally {
        this.saving = false;
      }
    }
  }
};
</script>

<style scoped>
.review-page {
  padding-bottom: 150rpx;
}

.section-title {
  margin-bottom: 18rpx;
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
}

.notice {
  margin-top: 14rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  background: #eef7f4;
  color: #1f7a68;
  font-size: 24rpx;
  line-height: 1.5;
}

.rating-row {
  display: flex;
  gap: 12rpx;
}

.rating-button {
  width: 76rpx;
  height: 76rpx;
  margin: 0;
  padding: 0;
  border-radius: 8rpx;
  background: #f8fafc;
  color: #cbd5e1;
  font-size: 42rpx;
  line-height: 76rpx;
}

.rating-button.active {
  background: #fff7ed;
  color: #d97706;
}

.textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 220rpx;
  padding: 20rpx;
  border: 1rpx solid #e2e8f0;
  border-radius: 8rpx;
  color: #1f2933;
  font-size: 26rpx;
  line-height: 1.55;
  background: #ffffff;
}

.placeholder {
  color: #94a3b8;
}

.counter {
  margin-top: 10rpx;
  color: #94a3b8;
  font-size: 22rpx;
  text-align: right;
}

.photo-add {
  width: 112rpx;
  height: 56rpx;
  margin: 0;
  border-radius: 8rpx;
  background: #1f7a68;
  color: #ffffff;
  font-size: 24rpx;
  line-height: 56rpx;
}

.photo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12rpx;
}

.photo-cell {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 8rpx;
  background: #f1f5f9;
}

.photo-image {
  width: 100%;
  height: 100%;
}

.photo-remove {
  position: absolute;
  right: 8rpx;
  bottom: 8rpx;
  width: 76rpx;
  height: 42rpx;
  margin: 0;
  padding: 0;
  border-radius: 6rpx;
  background: rgba(15, 23, 42, 0.72);
  color: #ffffff;
  font-size: 20rpx;
  line-height: 42rpx;
}
</style>
```

- [ ] **Step 4: Run Mini Program syntax checks**

Run:

```bash
node --check scripts/d15-session-review-records-check.js
npm --workspace apps/api run check
```

Expected: API check passes; D15 fails with `Mine page must label created sessions`.

- [ ] **Step 5: Commit Mini Program review page**

Run:

```bash
git add apps/miniprogram/src/utils/api.js apps/miniprogram/src/pages.json apps/miniprogram/src/pages/session/review.vue
git commit -m "feat: add session review editor"
```

Expected: commit succeeds.

## Task 5: Wire Mine And Detail UI

**Files:**
- Modify: `apps/miniprogram/src/pages/mine/index.vue`
- Modify: `apps/miniprogram/src/pages/session/detail.vue`

- [ ] **Step 1: Update Mine page state and loading**

In `apps/miniprogram/src/pages/mine/index.vue`, add state:

```js
const signups = ref([]);
const signupStatusText = ref("");
```

In `hydrateAuth`, clear `signups` and `signupStatusText` whenever auth is cleared. When logged in, call both:

```js
    loadMySessions();
    loadMySignups();
```

Add:

```js
async function loadMySignups() {
  signupStatusText.value = "正在加载我参与的车...";
  try {
    const response = await request({ url: "/api/users/me/signups" });
    signups.value = dataOf(response) || [];
    signupStatusText.value = "";
  } catch (error) {
    signupStatusText.value = "我参与的车加载失败，请稍后重试。";
  }
}

function goReview(id) {
  uni.navigateTo({ url: `/pages/session/review?id=${id}` });
}
```

- [ ] **Step 2: Rename the created-session section**

Change the section title from `我的发车` to `我发起` and empty text to `还没有发起过车。`.

- [ ] **Step 3: Add the joined-session template**

After the created-session section in `apps/miniprogram/src/pages/mine/index.vue`, add:

```vue
    <view v-if="hasLogin" class="section">
      <view class="section-title">我参与</view>
      <view v-if="signupStatusText" class="notice">{{ signupStatusText }}</view>
      <view v-if="signups.length === 0 && !signupStatusText" class="empty">还没有参与过车。</view>
      <view v-for="signup in signups" :key="signup.id" class="item">
        <view class="item-main">
          <view class="item-title">{{ signup.script_name_snapshot }}</view>
          <view class="item-sub">{{ signup.store_name_snapshot }} / {{ signup.start_at }}</view>
          <view class="item-sub">
            {{ signupStatusLabel(signup.status) }} · {{ signup.seat_name || "座位" }}
            <text v-if="signup.seat_role_name"> · {{ signup.seat_role_name }}</text>
          </view>
        </view>
        <view class="item-actions">
          <button
            v-if="signup.can_review"
            class="mini-button"
            @tap="goReview(signup.session_id)"
          >
            {{ signup.has_review ? "编辑记录" : "写记录" }}
          </button>
          <button class="mini-button muted" @tap="goDetail(signup.session_id)">详情</button>
        </view>
      </view>
    </view>
```

Add:

```js
function signupStatusLabel(status) {
  const labels = {
    pending: "待审核",
    approved: "已上车",
    rejected: "已拒绝",
    cancelled: "已取消"
  };
  return labels[status] || status || "未知";
}
```

- [ ] **Step 4: Add Detail page review state**

In `apps/miniprogram/src/pages/session/detail.vue`, add data fields:

```js
      reviews: [],
      myReviewState: { can_review: false, review: null },
      reviewStatusText: "",
```

In `onLoad`, after `this.loadSession();`, call:

```js
    this.loadSessionReviews();
    this.loadMyReviewState();
```

In `onShow`, after `this.hydrateUser();`, call:

```js
    if (this.sessionId) {
      this.loadSessionReviews();
      this.loadMyReviewState();
    }
```

- [ ] **Step 5: Add Detail page review methods**

In `methods`, add:

```js
    async loadSessionReviews() {
      if (!this.sessionId || this.sessionId === "d1-demo") {
        return;
      }
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/reviews` });
        this.reviews = dataOf(response) || [];
        this.reviewStatusText = "";
      } catch (error) {
        this.reviewStatusText = "车友记录加载失败，请稍后重试。";
      }
    },
    async loadMyReviewState() {
      if (!this.currentUserId || !this.sessionId || this.sessionId === "d1-demo") {
        this.myReviewState = { can_review: false, review: null };
        return;
      }
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/review` });
        this.myReviewState = dataOf(response) || { can_review: false, review: null };
      } catch (error) {
        this.myReviewState = { can_review: false, review: null };
      }
    },
    goReview() {
      const id = this.sessionId || "d1-demo";
      uni.navigateTo({ url: `/pages/session/review?id=${id}` });
    },
    starText(rating) {
      const value = Math.max(0, Math.min(5, Number(rating || 0)));
      return "★★★★★".slice(0, value) + "☆☆☆☆☆".slice(0, 5 - value);
    },
    reviewAuthorName(review) {
      return review.user_nickname || review.user_open_id || "车友";
    },
```

- [ ] **Step 6: Add Detail page review template**

Before the `ChatEntry` loop in `apps/miniprogram/src/pages/session/detail.vue`, add:

```vue
    <view v-if="session.id" class="section">
      <view class="section-head">
        <view class="section-title">车友记录</view>
        <button
          v-if="myReviewState.can_review"
          class="review-edit"
          @click="goReview"
        >
          {{ myReviewState.review ? "编辑记录" : "写记录" }}
        </button>
      </view>
      <view v-if="reviewStatusText" class="notice">{{ reviewStatusText }}</view>
      <view v-if="reviews.length === 0 && !reviewStatusText" class="empty">还没有车友记录。</view>
      <view v-for="review in reviews" :key="review.id" class="review-card">
        <view class="review-head">
          <image class="review-avatar" :src="review.user_avatar_url ? assetUrl(review.user_avatar_url) : '/static/icons/user.png'" mode="aspectFill" />
          <view class="review-main">
            <view class="review-name">{{ reviewAuthorName(review) }}</view>
            <view class="review-meta">{{ review.seat_name || "座位" }} · {{ review.seat_role_name || "角色" }}</view>
          </view>
          <view class="review-stars">{{ starText(review.rating) }}</view>
        </view>
        <view v-if="review.content" class="review-content">{{ review.content }}</view>
        <view v-if="review.photos && review.photos.length" class="review-photos">
          <image
            v-for="photo in review.photos"
            :key="photo"
            class="review-photo"
            :src="assetUrl(photo)"
            mode="aspectFill"
          />
        </view>
      </view>
    </view>
```

Add `assetUrl` to the existing import from `../../utils/api`.

- [ ] **Step 7: Add Detail page styles**

In `apps/miniprogram/src/pages/session/detail.vue`, add styles:

```css
.review-edit {
  width: 132rpx;
  height: 56rpx;
  margin: 0;
  border-radius: 8rpx;
  background: #1f7a68;
  color: #ffffff;
  font-size: 24rpx;
  line-height: 56rpx;
}

.review-card {
  padding: 22rpx 0;
  border-top: 1rpx solid #edf1f5;
}

.review-head {
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.review-avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: #eef2f7;
}

.review-main {
  flex: 1;
  min-width: 0;
}

.review-name {
  color: #1f2933;
  font-size: 26rpx;
  font-weight: 600;
}

.review-meta {
  margin-top: 4rpx;
  color: #64748b;
  font-size: 22rpx;
}

.review-stars {
  color: #d97706;
  font-size: 24rpx;
}

.review-content {
  margin-top: 16rpx;
  color: #334155;
  font-size: 25rpx;
  line-height: 1.55;
}

.review-photos {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10rpx;
  margin-top: 16rpx;
}

.review-photo {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8rpx;
  background: #f1f5f9;
}
```

- [ ] **Step 8: Run D15 check**

Run:

```bash
node scripts/d15-session-review-records-check.js
```

Expected: PASS with `D15 session review records check passed`.

- [ ] **Step 9: Commit Mine and Detail integration**

Run:

```bash
git add apps/miniprogram/src/pages/mine/index.vue apps/miniprogram/src/pages/session/detail.vue
git commit -m "feat: surface session records in miniprogram"
```

Expected: commit succeeds.

## Task 6: Wire Root Check And Final Verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add D15 to root check**

In root `package.json`, append the D15 script to the `check` command:

```json
"check": "npm --workspace apps/api run check && node --check scripts/d2-smoke-test.js && node --check scripts/d3-smoke-test.js && node --check scripts/d4-smoke-test.js && node --check scripts/d5-smoke-test.js && node --check scripts/d6-smoke-test.js && node --check scripts/d7-smoke-test.js && node --check scripts/d8-qa-check.js && node --check scripts/d10-pseudo-chat-check.js && node --check scripts/d10-pseudo-chat-smoke.js && node scripts/check-api-health.js && node scripts/d12-admin-web-check.js && node scripts/d13-cross-app-identity-check.js && node scripts/check-miniprogram.js && node scripts/check-maintenance-mode.js && node scripts/d11-gender-check.js && node scripts/d14-profile-check.js && node scripts/d15-session-review-records-check.js && node scripts/d10-pseudo-chat-check.js"
```

- [ ] **Step 2: Run targeted checks**

Run:

```bash
node scripts/d15-session-review-records-check.js
npm --workspace apps/api run check
node --check apps/api/src/server.js
node --check apps/api/src/modules/core/service.js
```

Expected: all commands pass.

- [ ] **Step 3: Run full check**

Run:

```bash
npm run check
```

Expected: exits 0. If `scripts/check-api-health.js` fails because the local API is not running, start the API with `npm run dev:api`, rerun `npm run check`, and stop the API session after verification.

- [ ] **Step 4: Review current changes**

Run:

```bash
git status --short
git diff --stat
```

Expected: only the files named in this plan are modified or created.

- [ ] **Step 5: Commit root check integration**

Run:

```bash
git add package.json
git commit -m "test: include session review records check"
```

Expected: commit succeeds.

## Self-Review

- Spec coverage: Task 2 covers persistent review eligibility and post-start protection; Task 3 covers public reviews, current-user review state, upsert, photo validation, and joined-session context; Task 4 covers photo upload helper and write/edit page; Task 5 covers Mine and Detail UI; Task 6 covers verification.
- Placeholder scan: no unresolved markers were found. Each task names exact files, commands, expected outcomes, and concrete code snippets.
- Type consistency: API paths are consistent across server, Mini Program helper, Mine, Detail, and Review page: `/api/sessions/:id/reviews`, `/api/sessions/:id/review`, and `/api/session-reviews/photos`. Photo arrays use `photoUrls` in request bodies and `photos` in API responses.
