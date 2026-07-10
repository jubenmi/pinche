import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// These imports intentionally point at the helpers introduced by later D42
// implementation tasks. Dynamic imports let every future contract report RED
// independently while the modules do not exist yet.
const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

const apiMediaHelpers = () => import("../apps/api/src/modules/album-video/media.js");
const apiLifecycleHelpers = () => import("../apps/api/src/modules/album-video/lifecycle.js");
const miniProgramHelpers = () => import("../apps/miniprogram/src/utils/albumVideo.js");
const adminHelpers = () => import("../apps/admin-web/src/albumMedia.js");

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MP4_HEADER = Buffer.from("000000186674797069736f6d", "hex");
const VIDEO_BYTES = Buffer.concat([MP4_HEADER, Buffer.from("album-video-payload")]);

function hasStatus(expected) {
  return (error) => Number(error?.statusCode || error?.status || error?.httpStatus) === expected;
}

async function streamedResponseBytes(body) {
  assert.equal(
    body instanceof Readable || Boolean(body && typeof body[Symbol.asyncIterator] === "function"),
    true,
    "local response body must be a Node Readable or async iterable stream"
  );
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function withTempVideo(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "d42-album-video-"));
  const filePath = path.join(directory, "fixture.mp4");
  await writeFile(filePath, VIDEO_BYTES);
  try {
    await run(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("MP4 validation requires an ISO BMFF ftyp header", async () => {
  const { isMp4FileHeader } = await apiMediaHelpers();
  assert.equal(isMp4FileHeader(MP4_HEADER), true);
  assert.equal(isMp4FileHeader(Buffer.from("not an mp4")), false);
  assert.equal(isMp4FileHeader(Buffer.alloc(7)), false);
});

test("single byte ranges parse exact, open-ended, and suffix ranges", async () => {
  const { parseSingleByteRange } = await apiMediaHelpers();
  assert.deepEqual(parseSingleByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseSingleByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseSingleByteRange("bytes=-10", 100), { start: 90, end: 99 });
});

test("single byte ranges reject malformed, multiple, and unsatisfiable ranges", async () => {
  const { parseSingleByteRange } = await apiMediaHelpers();
  for (const value of ["bytes=abc", "bytes=0-1,4-5", "bytes=100-120"]) {
    assert.throws(() => parseSingleByteRange(value, 100), hasStatus(416), value);
  }
});

test("authoritative video metadata rejects missing and zero byte sizes", async () => {
  const { validateAlbumVideoObject } = await apiMediaHelpers();
  for (const byteSize of [undefined, null, 0]) {
    assert.throws(
      () => validateAlbumVideoObject({ byteSize, contentType: "video/mp4", headerBytes: MP4_HEADER }),
      hasStatus(400),
      String(byteSize)
    );
  }
});

test("authoritative video metadata rejects objects larger than 100MB", async () => {
  const { validateAlbumVideoObject } = await apiMediaHelpers();
  assert.throws(
    () => validateAlbumVideoObject({
      byteSize: MAX_VIDEO_BYTES + 1,
      contentType: "video/mp4",
      headerBytes: MP4_HEADER
    }),
    (error) => [400, 413].includes(Number(error?.statusCode || error?.status || error?.httpStatus))
  );
});

test("authoritative video metadata rejects a non-MP4 content type", async () => {
  const { validateAlbumVideoObject } = await apiMediaHelpers();
  assert.throws(
    () => validateAlbumVideoObject({ byteSize: VIDEO_BYTES.length, contentType: "image/jpeg", headerBytes: MP4_HEADER }),
    hasStatus(400)
  );
});

test("authoritative video metadata rejects an invalid ftyp header", async () => {
  const { validateAlbumVideoObject } = await apiMediaHelpers();
  assert.throws(
    () => validateAlbumVideoObject({
      byteSize: VIDEO_BYTES.length,
      contentType: "video/mp4",
      headerBytes: Buffer.from("not-an-mp4")
    }),
    hasStatus(400)
  );
});

test("authoritative video metadata returns storage facts despite client lies", async () => {
  const { validateAlbumVideoObject } = await apiMediaHelpers();
  const result = validateAlbumVideoObject({
    byteSize: VIDEO_BYTES.length,
    contentType: "video/mp4",
    headerBytes: MP4_HEADER,
    suppliedByteSize: 1,
    suppliedContentType: "image/jpeg"
  });
  assert.equal(result.byteSize, VIDEO_BYTES.length);
  assert.equal(result.contentType, "video/mp4");
});

// Future apps/api/src/modules/album-video/media.js interface:
// inspectSessionAlbumVideoObject({ sourceUrl, storageAdapter, suppliedByteSize,
// suppliedContentType }). storageAdapter exposes getMetadata(sourceUrl) and
// readRange(sourceUrl, start, end), keeping COS HEAD/local stat details outside
// the validator while making the authoritative I/O boundary injectable.
test("COS object inspection performs HEAD before reading only bytes 0-11", async () => {
  const { inspectSessionAlbumVideoObject } = await apiMediaHelpers();
  const calls = [];
  const result = await inspectSessionAlbumVideoObject({
    sourceUrl: "sessions/7/video/source.mp4",
    suppliedByteSize: 1,
    suppliedContentType: "image/jpeg",
    storageAdapter: {
      getMetadata: async (sourceUrl) => {
        calls.push(["HEAD", sourceUrl]);
        return { byteSize: VIDEO_BYTES.length, contentType: "video/mp4" };
      },
      readRange: async (sourceUrl, start, end) => {
        calls.push(["Range", sourceUrl, start, end]);
        return VIDEO_BYTES.subarray(start, end + 1);
      }
    }
  });
  assert.deepEqual(calls, [
    ["HEAD", "sessions/7/video/source.mp4"],
    ["Range", "sessions/7/video/source.mp4", 0, 11]
  ]);
  assert.equal(result.byteSize, VIDEO_BYTES.length);
  assert.equal(result.contentType, "video/mp4");
});

test("local object inspection stats before reading only the first 12 bytes", async () => {
  const { inspectSessionAlbumVideoObject } = await apiMediaHelpers();
  const calls = [];
  const result = await inspectSessionAlbumVideoObject({
    sourceUrl: "sessions/8/video/local.mp4",
    suppliedByteSize: MAX_VIDEO_BYTES,
    suppliedContentType: "application/octet-stream",
    storageAdapter: {
      getMetadata: async (sourceUrl) => {
        calls.push(["stat", sourceUrl]);
        return { byteSize: VIDEO_BYTES.length, contentType: "video/mp4" };
      },
      readRange: async (sourceUrl, start, end) => {
        calls.push(["read", sourceUrl, start, end]);
        return VIDEO_BYTES.subarray(start, end + 1);
      }
    }
  });
  assert.deepEqual(calls, [
    ["stat", "sessions/8/video/local.mp4"],
    ["read", "sessions/8/video/local.mp4", 0, 11]
  ]);
  assert.equal(result.byteSize, VIDEO_BYTES.length);
  assert.equal(result.contentType, "video/mp4");
});

test("object inspection rejects a missing object without attempting a range read", async () => {
  const { inspectSessionAlbumVideoObject } = await apiMediaHelpers();
  let rangeCalls = 0;
  await assert.rejects(
    inspectSessionAlbumVideoObject({
      sourceUrl: "sessions/9/video/missing.mp4",
      storageAdapter: {
        getMetadata: async () => { throw Object.assign(new Error("missing"), { statusCode: 404 }); },
        readRange: async () => { rangeCalls += 1; }
      }
    }),
    hasStatus(404)
  );
  assert.equal(rangeCalls, 0);
});

test("object inspection rejects invalid bytes reported by storage", async () => {
  const { inspectSessionAlbumVideoObject } = await apiMediaHelpers();
  await assert.rejects(
    inspectSessionAlbumVideoObject({
      sourceUrl: "sessions/10/video/invalid.mp4",
      storageAdapter: {
        getMetadata: async () => ({ byteSize: VIDEO_BYTES.length, contentType: "video/mp4" }),
        readRange: async (_sourceUrl, start, end) => Buffer.from("not-an-mp4").subarray(start, end + 1)
      }
    }),
    hasStatus(400)
  );
});

test("local video HEAD rejects a missing file with 404", async () => {
  const { createLocalAlbumVideoResponse } = await apiMediaHelpers();
  await assert.rejects(
    createLocalAlbumVideoResponse({ filePath: path.join(os.tmpdir(), "d42-missing-video.mp4"), method: "HEAD" }),
    hasStatus(404)
  );
});

test("local video GET rejects a missing file with 404", async () => {
  const { createLocalAlbumVideoResponse } = await apiMediaHelpers();
  await assert.rejects(
    createLocalAlbumVideoResponse({ filePath: path.join(os.tmpdir(), "d42-missing-video.mp4"), method: "GET" }),
    hasStatus(404)
  );
});

test("local video HEAD reports playback headers and no body", async () => {
  const { createLocalAlbumVideoResponse } = await apiMediaHelpers();
  await withTempVideo(async (filePath) => {
    const result = await createLocalAlbumVideoResponse({ filePath, method: "HEAD" });
    assert.equal(result.statusCode, 200);
    assert.equal(Number(result.headers["content-length"]), VIDEO_BYTES.length);
    assert.equal(result.headers["content-type"], "video/mp4");
    assert.equal(result.headers["accept-ranges"], "bytes");
    assert.equal(result.body == null, true);
  });
});

test("local video GET streams the exact file bytes", async () => {
  const { createLocalAlbumVideoResponse } = await apiMediaHelpers();
  await withTempVideo(async (filePath) => {
    const result = await createLocalAlbumVideoResponse({ filePath, method: "GET" });
    assert.equal(result.statusCode, 200);
    assert.equal(Number(result.headers["content-length"]), VIDEO_BYTES.length);
    assert.deepEqual(await streamedResponseBytes(result.body), VIDEO_BYTES);
  });
});

test("local video GET serves a valid single range with exact bytes", async () => {
  const { createLocalAlbumVideoResponse } = await apiMediaHelpers();
  await withTempVideo(async (filePath) => {
    const result = await createLocalAlbumVideoResponse({ filePath, method: "GET", range: "bytes=4-11" });
    assert.equal(result.statusCode, 206);
    assert.equal(result.headers["content-range"], `bytes 4-11/${VIDEO_BYTES.length}`);
    assert.equal(Number(result.headers["content-length"]), 8);
    assert.deepEqual(await streamedResponseBytes(result.body), VIDEO_BYTES.subarray(4, 12));
  });
});

test("local video GET returns 416 for invalid and unsatisfiable ranges", async () => {
  const { createLocalAlbumVideoResponse } = await apiMediaHelpers();
  await withTempVideo(async (filePath) => {
    for (const range of ["bytes=bad", `bytes=${VIDEO_BYTES.length}-`]) {
      const result = await createLocalAlbumVideoResponse({ filePath, method: "GET", range });
      assert.equal(result.statusCode, 416, range);
      assert.equal(result.headers["content-range"], `bytes */${VIDEO_BYTES.length}`, range);
    }
  });
});

test("multipart validation accepts only a consistent MP4 upload", async () => {
  const { validateMultipartAlbumVideo } = await apiMediaHelpers();
  const result = validateMultipartAlbumVideo({
    bytes: VIDEO_BYTES,
    byteSize: VIDEO_BYTES.length,
    contentType: "video/mp4",
    filename: "clip.mp4"
  });
  assert.equal(result.byteSize, VIDEO_BYTES.length);
  assert.equal(result.contentType, "video/mp4");
});

test("multipart validation rejects a spoofed MIME type", async () => {
  const { validateMultipartAlbumVideo } = await apiMediaHelpers();
  assert.throws(
    () => validateMultipartAlbumVideo({
      bytes: VIDEO_BYTES,
      byteSize: VIDEO_BYTES.length,
      contentType: "image/jpeg",
      filename: "clip.mp4"
    }),
    hasStatus(400)
  );
});

test("multipart validation rejects a spoofed extension", async () => {
  const { validateMultipartAlbumVideo } = await apiMediaHelpers();
  assert.throws(
    () => validateMultipartAlbumVideo({
      bytes: VIDEO_BYTES,
      byteSize: VIDEO_BYTES.length,
      contentType: "video/mp4",
      filename: "clip.jpg"
    }),
    hasStatus(400)
  );
});

test("multipart validation rejects bytes without an MP4 ftyp header", async () => {
  const { validateMultipartAlbumVideo } = await apiMediaHelpers();
  assert.throws(
    () => validateMultipartAlbumVideo({
      bytes: Buffer.from("not-an-mp4"),
      byteSize: 10,
      contentType: "video/mp4",
      filename: "clip.mp4"
    }),
    hasStatus(400)
  );
});

test("multipart validation rejects an upload larger than 100MB", async () => {
  const { validateMultipartAlbumVideo } = await apiMediaHelpers();
  assert.throws(
    () => validateMultipartAlbumVideo({
      bytes: VIDEO_BYTES,
      byteSize: MAX_VIDEO_BYTES + 1,
      contentType: "video/mp4",
      filename: "clip.mp4"
    }),
    (error) => [400, 413].includes(Number(error?.statusCode || error?.status || error?.httpStatus))
  );
});

test("COS visible upload headers accept an in-limit MP4", async () => {
  const { validateCosAlbumVideoHeaders } = await apiMediaHelpers();
  assert.deepEqual(
    validateCosAlbumVideoHeaders({ contentLength: String(VIDEO_BYTES.length), contentType: "video/mp4" }),
    { byteSize: VIDEO_BYTES.length, contentType: "video/mp4" }
  );
});

test("COS visible upload headers reject a length over 100MB", async () => {
  const { validateCosAlbumVideoHeaders } = await apiMediaHelpers();
  assert.throws(
    () => validateCosAlbumVideoHeaders({ contentLength: String(MAX_VIDEO_BYTES + 1), contentType: "video/mp4" }),
    (error) => [400, 413].includes(Number(error?.statusCode || error?.status || error?.httpStatus))
  );
});

test("COS visible upload headers reject a non-MP4 content type", async () => {
  const { validateCosAlbumVideoHeaders } = await apiMediaHelpers();
  assert.throws(
    () => validateCosAlbumVideoHeaders({
      contentLength: String(VIDEO_BYTES.length),
      contentType: "application/octet-stream"
    }),
    hasStatus(400)
  );
});

test("COS visible content-length alone validates size and defers MIME", async () => {
  const { validateCosAlbumVideoHeaders } = await apiMediaHelpers();
  assert.deepEqual(
    validateCosAlbumVideoHeaders({ contentLength: String(VIDEO_BYTES.length) }),
    { byteSize: VIDEO_BYTES.length }
  );
});

test("COS visible content-length alone rejects an oversized upload", async () => {
  const { validateCosAlbumVideoHeaders } = await apiMediaHelpers();
  assert.throws(
    () => validateCosAlbumVideoHeaders({ contentLength: String(MAX_VIDEO_BYTES + 1) }),
    (error) => [400, 413].includes(Number(error?.statusCode || error?.status || error?.httpStatus))
  );
});

test("COS visible content-type alone validates MIME and defers size", async () => {
  const { validateCosAlbumVideoHeaders } = await apiMediaHelpers();
  assert.deepEqual(
    validateCosAlbumVideoHeaders({ contentType: "video/mp4" }),
    { contentType: "video/mp4" }
  );
});

test("COS visible content-type alone rejects a non-MP4 upload", async () => {
  const { validateCosAlbumVideoHeaders } = await apiMediaHelpers();
  assert.throws(
    () => validateCosAlbumVideoHeaders({ contentType: "application/octet-stream" }),
    hasStatus(400)
  );
});

test("COS authorization with no visible validation headers defers without fabricated facts", async () => {
  const { validateCosAlbumVideoHeaders } = await apiMediaHelpers();
  assert.deepEqual(validateCosAlbumVideoHeaders({}), {});
});

test("idempotent create returns an existing video without inserting", async () => {
  const { createIdempotentAlbumVideo } = await apiLifecycleHelpers();
  let insertCalls = 0;
  const existing = { id: 7, source_url: "video/source.mp4" };
  const result = await createIdempotentAlbumVideo({
    sourceUrl: existing.source_url,
    findExisting: async () => existing,
    insert: async () => {
      insertCalls += 1;
    },
    findAfterDuplicate: async () => null
  });
  assert.equal(result, existing);
  assert.equal(insertCalls, 0);
});

test("idempotent create inserts exactly once when no video exists", async () => {
  const { createIdempotentAlbumVideo } = await apiLifecycleHelpers();
  let insertCalls = 0;
  const inserted = { id: 8, source_url: "video/new.mp4" };
  const result = await createIdempotentAlbumVideo({
    sourceUrl: inserted.source_url,
    findExisting: async () => null,
    insert: async (sourceUrl) => {
      insertCalls += 1;
      assert.equal(sourceUrl, inserted.source_url);
      return inserted;
    },
    findAfterDuplicate: async () => null
  });
  assert.equal(result, inserted);
  assert.equal(insertCalls, 1);
});

test("idempotent create catches duplicate key and returns the concurrent winner", async () => {
  const { createIdempotentAlbumVideo } = await apiLifecycleHelpers();
  const winner = { id: 9, source_url: "video/race.mp4" };
  let requeryCalls = 0;
  const result = await createIdempotentAlbumVideo({
    sourceUrl: winner.source_url,
    findExisting: async () => null,
    insert: async () => {
      const error = new Error("duplicate source_url");
      error.code = "ER_DUP_ENTRY";
      throw error;
    },
    findAfterDuplicate: async (sourceUrl) => {
      requeryCalls += 1;
      assert.equal(sourceUrl, winner.source_url);
      return winner;
    }
  });
  assert.equal(result, winner);
  assert.equal(requeryCalls, 1);
});

test("idempotent create propagates non-duplicate insert errors", async () => {
  const { createIdempotentAlbumVideo } = await apiLifecycleHelpers();
  const networkError = Object.assign(new Error("database unavailable"), { code: "ECONNRESET" });
  let requeryCalls = 0;
  await assert.rejects(
    createIdempotentAlbumVideo({
      sourceUrl: "video/failure.mp4",
      findExisting: async () => null,
      insert: async () => { throw networkError; },
      findAfterDuplicate: async () => { requeryCalls += 1; }
    }),
    (error) => error === networkError
  );
  assert.equal(requeryCalls, 0);
});

test("delete cleanup deduplicates object URLs before finalizing", async () => {
  const { cleanupAlbumVideoBeforeDelete } = await apiLifecycleHelpers();
  const deleted = [];
  let finalizeCalls = 0;
  await cleanupAlbumVideoBeforeDelete({
    urls: ["source.mp4", "cover.jpg", "source.mp4", "", null, "cover.jpg"],
    deleteObject: async (url) => { deleted.push(url); },
    finalize: async () => { finalizeCalls += 1; }
  });
  assert.deepEqual(deleted, ["source.mp4", "cover.jpg"]);
  assert.equal(finalizeCalls, 1);
});

test("delete cleanup treats object 404 as success", async () => {
  const { cleanupAlbumVideoBeforeDelete } = await apiLifecycleHelpers();
  let finalizeCalls = 0;
  await cleanupAlbumVideoBeforeDelete({
    urls: ["already-missing.mp4"],
    deleteObject: async () => { throw Object.assign(new Error("missing"), { statusCode: 404 }); },
    finalize: async () => { finalizeCalls += 1; }
  });
  assert.equal(finalizeCalls, 1);
});

test("delete cleanup keeps the database row on network and 5xx failures", async () => {
  const { cleanupAlbumVideoBeforeDelete } = await apiLifecycleHelpers();
  for (const error of [
    Object.assign(new Error("network"), { code: "ECONNRESET" }),
    Object.assign(new Error("storage failure"), { statusCode: 503 })
  ]) {
    let finalizeCalls = 0;
    await assert.rejects(
      cleanupAlbumVideoBeforeDelete({
        urls: ["source.mp4"],
        deleteObject: async () => { throw error; },
        finalize: async () => { finalizeCalls += 1; }
      }),
      (actual) => actual === error
    );
    assert.equal(finalizeCalls, 0);
  }
});

test("delete cleanup retry finalizes only after every object is cleaned", async () => {
  const { cleanupAlbumVideoBeforeDelete } = await apiLifecycleHelpers();
  const deleted = new Set();
  let firstAttempt = true;
  let finalizeCalls = 0;
  const options = {
    urls: ["source.mp4", "display.mp4", "cover.jpg"],
    deleteObject: async (url) => {
      if (deleted.has(url)) throw Object.assign(new Error("missing"), { statusCode: 404 });
      if (firstAttempt && url === "display.mp4") {
        throw Object.assign(new Error("temporary"), { statusCode: 503 });
      }
      deleted.add(url);
    },
    finalize: async () => { finalizeCalls += 1; }
  };
  await assert.rejects(cleanupAlbumVideoBeforeDelete(options), hasStatus(503));
  assert.equal(finalizeCalls, 0);
  firstAttempt = false;
  await cleanupAlbumVideoBeforeDelete(options);
  assert.deepEqual([...deleted].sort(), ["cover.jpg", "display.mp4", "source.mp4"]);
  assert.equal(finalizeCalls, 1);
});

test("compressed video size converts wx.compressVideo kB to bytes", async () => {
  const { compressVideoSizeBytes } = await miniProgramHelpers();
  assert.equal(compressVideoSizeBytes(1), 1024);
  assert.equal(compressVideoSizeBytes(1.5), 1536);
  assert.equal(compressVideoSizeBytes(20480), 20 * 1024 * 1024);
});

test("compressed video size rejects unknown or non-positive values", async () => {
  const { compressVideoSizeBytes } = await miniProgramHelpers();
  assert.equal(compressVideoSizeBytes(undefined), 0);
  assert.equal(compressVideoSizeBytes("unknown"), 0);
  assert.equal(compressVideoSizeBytes(0), 0);
});

test("mini-program business Authorization is restricted to the API origin", async () => {
  const { shouldAttachApiAuthorization } = await miniProgramHelpers();
  const apiOrigin = "https://api.pinche.test";
  assert.equal(shouldAttachApiAuthorization("/api/session-album/media/7", apiOrigin), true);
  assert.equal(shouldAttachApiAuthorization("https://api.pinche.test/api/media/7", apiOrigin), true);
  assert.equal(shouldAttachApiAuthorization("https://cos.example.com/video.mp4?sign=cos", apiOrigin), false);
  assert.equal(shouldAttachApiAuthorization("https://api.pinche.test.evil.example/video.mp4", apiOrigin), false);
});

test("public timeline denies video preview while member preview remains available", async () => {
  const { canOpenAlbumMediaPreview } = await miniProgramHelpers();
  assert.equal(canOpenAlbumMediaPreview({ timelineMode: true, mediaType: "video", processingStatus: "ready" }), false);
  assert.equal(canOpenAlbumMediaPreview({ timelineMode: true, mediaType: "image", processingStatus: "ready" }), true);
  assert.equal(canOpenAlbumMediaPreview({ timelineMode: false, mediaType: "video", processingStatus: "ready" }), true);
});

test("video URL expiry uses a 30 second safety skew", async () => {
  const { videoUrlExpiresAt, canReuseVideoUrl } = await miniProgramHelpers();
  const receivedAtMs = 1_000_000;
  const expiresAtMs = videoUrlExpiresAt(120, receivedAtMs);
  assert.equal(expiresAtMs, 1_120_000);
  assert.equal(canReuseVideoUrl("signed-url", expiresAtMs, 1_089_999), true);
  assert.equal(canReuseVideoUrl("signed-url", expiresAtMs, 1_090_000), false);
  assert.equal(canReuseVideoUrl("", expiresAtMs, 1_000_000), false);
  assert.equal(canReuseVideoUrl("signed-url", null, 1_000_000), false);
});

test("first viewer video error clears URL and requests one transient auto refresh", async () => {
  const { transitionAlbumVideoViewerFailure } = await miniProgramHelpers();
  const result = transitionAlbumVideoViewerFailure(
    { videoUrl: "expired-url", autoRefreshUsed: false, videoLoadFailed: false },
    "video-error"
  );
  assert.deepEqual(result, {
    videoUrl: "",
    autoRefreshUsed: true,
    videoLoadFailed: false,
    requestVideoUrl: true,
    persistPhotosMutation: false
  });
});

test("second viewer video error becomes a clickable transient failure", async () => {
  const { transitionAlbumVideoViewerFailure } = await miniProgramHelpers();
  const result = transitionAlbumVideoViewerFailure(
    { videoUrl: "failed-refresh", autoRefreshUsed: true, videoLoadFailed: false },
    "video-error"
  );
  assert.deepEqual(result, {
    videoUrl: "",
    autoRefreshUsed: true,
    videoLoadFailed: true,
    requestVideoUrl: false,
    persistPhotosMutation: false
  });
});

test("explicit viewer retry clears transient failure and requests a new URL", async () => {
  const { transitionAlbumVideoViewerFailure } = await miniProgramHelpers();
  const result = transitionAlbumVideoViewerFailure(
    { videoUrl: "", autoRefreshUsed: true, videoLoadFailed: true },
    "retry"
  );
  assert.deepEqual(result, {
    videoUrl: "",
    autoRefreshUsed: false,
    videoLoadFailed: false,
    requestVideoUrl: true,
    persistPhotosMutation: false
  });
});

test("admin business Authorization is restricted to the API origin", async () => {
  const { shouldAttachAdminAuthorization } = await adminHelpers();
  const apiOrigin = "https://admin.pinche.test";
  assert.equal(shouldAttachAdminAuthorization("/api/admin/sessions/8/album", apiOrigin), true);
  assert.equal(shouldAttachAdminAuthorization("https://admin.pinche.test/api/admin/media/8", apiOrigin), true);
  assert.equal(shouldAttachAdminAuthorization("https://cos.example.com/cover.jpg?sign=cos", apiOrigin), false);
  assert.equal(shouldAttachAdminAuthorization("https://admin.pinche.test.evil.example/cover.jpg", apiOrigin), false);
});

test("tag request serial rejects stale response tokens", async () => {
  const { RequestSerial } = await adminHelpers();
  const serial = new RequestSerial();
  const staleToken = serial.next();
  const currentToken = serial.next();
  assert.equal(serial.isCurrent(staleToken), false);
  assert.equal(serial.isCurrent(currentToken), true);
  serial.invalidate();
  assert.equal(serial.isCurrent(currentToken), false);
});

let failed = 0;
for (const { name, run } of tests) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(`  ${error?.code || error?.name || "Error"}: ${error?.message || error}`);
  }
}

if (failed > 0) {
  console.error(`D42 unit RED checks failed: ${failed}/${tests.length}`);
  process.exitCode = 1;
} else {
  console.log(`D42 unit checks passed: ${tests.length}/${tests.length}`);
}
