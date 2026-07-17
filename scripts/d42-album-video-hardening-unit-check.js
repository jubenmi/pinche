import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// These imports intentionally point at the helpers introduced by later D42
// implementation tasks. Dynamic imports let every future contract report RED
// independently while the modules do not exist yet.
const TEST_SCOPES = new Set(["api-media", "api-lifecycle", "api-creation", "mini", "admin"]);
const requestedScopeArgument = process.argv.find((argument) => argument.startsWith("--scope="));
const requestedScope = requestedScopeArgument?.slice("--scope=".length) || null;
if (requestedScope && !TEST_SCOPES.has(requestedScope)) {
  console.error(`Unknown D42 unit scope: ${requestedScope}`);
  process.exit(2);
}

const tests = [];
let currentTestScope = "api-media";
function test(name, run) {
  tests.push({ scope: currentTestScope, name, run });
}

const apiMediaHelpers = () => import("../apps/api/src/modules/album-video/media.js");
const apiCosHelpers = () => import("../apps/api/src/storage/cos.js");
const apiLifecycleHelpers = () => import("../apps/api/src/modules/album-video/lifecycle.js");
const apiCoreService = () => import("../apps/api/src/modules/core/service.js");
const apiMigrationHelpers = () => import("../apps/api/src/modules/album-video/migration.js");
const apiMigrationRunner = () => import("../apps/api/src/db/migrate.js");
const miniProgramHelpers = () => import("../apps/miniprogram/src/utils/albumVideo.js");
const adminHelpers = () => import("../apps/admin-web/src/albumMedia.js");

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MP4_HEADER = Buffer.from("000000186674797069736f6d", "hex");
const VIDEO_BYTES = Buffer.concat([MP4_HEADER, Buffer.from("album-video-payload")]);
const COS_CONFIG = {
  secretId: "d42-secret-id",
  secretKey: "d42-secret-key",
  bucket: "d42-bucket",
  region: "ap-nanjing"
};

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

async function withTempVideoBytes(bytes, run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "d42-album-video-"));
  const filePath = path.join(directory, "fixture.mp4");
  await writeFile(filePath, bytes);
  try {
    await run(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function withTempVideo(run) {
  return withTempVideoBytes(VIDEO_BYTES, run);
}

function createFakeHttpsRequest({
  statusCode = 200,
  headers = {},
  body = Buffer.alloc(0),
  requestError = null,
  respond = true,
  responseAborted = false
} = {}) {
  const calls = [];
  const request = (options, onResponse) => {
    const call = { options, writes: [] };
    calls.push(call);
    const pendingRequest = new EventEmitter();
    pendingRequest.write = (chunk) => call.writes.push(Buffer.from(chunk));
    pendingRequest.destroy = () => { call.requestDestroyed = true; };
    pendingRequest.end = () => {
      queueMicrotask(() => {
        if (requestError) {
          pendingRequest.emit("error", requestError);
          return;
        }
        if (!respond) return;
        const response = new EventEmitter();
        response.statusCode = statusCode;
        response.headers = headers;
        response.destroy = (error) => {
          call.responseDestroyed = true;
          if (error) response.emit("error", error);
        };
        onResponse(response);
        if (responseAborted) {
          response.emit("aborted");
          return;
        }
        if (body.length > 0) response.emit("data", body);
        response.emit("end");
      });
    };
    return pendingRequest;
  };
  return { calls, request };
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

test("parameterized MP4 content types normalize to the base media type", async () => {
  const {
    validateAlbumVideoObject,
    validateCosAlbumVideoHeaders,
    validateMultipartAlbumVideo
  } = await apiMediaHelpers();
  assert.deepEqual(
    validateAlbumVideoObject({
      byteSize: VIDEO_BYTES.length,
      contentType: "Video/MP4; charset=binary",
      headerBytes: MP4_HEADER
    }),
    { byteSize: VIDEO_BYTES.length, contentType: "video/mp4" }
  );
  assert.deepEqual(
    validateMultipartAlbumVideo({
      bytes: VIDEO_BYTES,
      byteSize: VIDEO_BYTES.length,
      contentType: "video/mp4; codecs=avc1",
      filename: "clip.mp4"
    }),
    { byteSize: VIDEO_BYTES.length, contentType: "video/mp4" }
  );
  assert.deepEqual(
    validateCosAlbumVideoHeaders({ contentType: "video/mp4; charset=binary" }),
    { contentType: "video/mp4" }
  );
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

test("object inspection uses an MP4 source path when authoritative MIME is absent", async () => {
  const { inspectSessionAlbumVideoObject } = await apiMediaHelpers();
  const calls = [];
  const result = await inspectSessionAlbumVideoObject({
    sourceUrl: "sessions/8/video/source.MP4?signature=d42",
    storageAdapter: {
      getMetadata: async () => ({ byteSize: VIDEO_BYTES.length }),
      readRange: async (sourceUrl, start, end) => {
        calls.push([sourceUrl, start, end]);
        return VIDEO_BYTES.subarray(start, end + 1);
      }
    }
  });
  assert.deepEqual(calls, [["sessions/8/video/source.MP4?signature=d42", 0, 11]]);
  assert.deepEqual(result, { byteSize: VIDEO_BYTES.length, contentType: "video/mp4" });
});

test("object inspection rejects absent MIME on a non-MP4 path before reading a range", async () => {
  const { inspectSessionAlbumVideoObject } = await apiMediaHelpers();
  let rangeCalls = 0;
  await assert.rejects(
    inspectSessionAlbumVideoObject({
      sourceUrl: "sessions/8/video/source.bin",
      storageAdapter: {
        getMetadata: async () => ({ byteSize: VIDEO_BYTES.length }),
        readRange: async () => { rangeCalls += 1; }
      }
    }),
    hasStatus(400)
  );
  assert.equal(rangeCalls, 0);
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

for (const { name, metadata, expectedStatus } of [
  {
    name: "empty authoritative metadata",
    metadata: { byteSize: 0, contentType: "video/mp4" },
    expectedStatus: 400
  },
  {
    name: "oversized authoritative metadata",
    metadata: { byteSize: MAX_VIDEO_BYTES + 1, contentType: "video/mp4" },
    expectedStatus: 413
  },
  {
    name: "non-MP4 authoritative metadata",
    metadata: { byteSize: VIDEO_BYTES.length, contentType: "image/jpeg" },
    expectedStatus: 400
  }
]) {
  test(`object inspection rejects ${name} before reading a byte range`, async () => {
    const { inspectSessionAlbumVideoObject } = await apiMediaHelpers();
    let rangeCalls = 0;
    await assert.rejects(
      inspectSessionAlbumVideoObject({
        sourceUrl: "sessions/10/video/source.mp4",
        storageAdapter: {
          getMetadata: async () => metadata,
          readRange: async () => {
            rangeCalls += 1;
            return MP4_HEADER;
          }
        }
      }),
      hasStatus(expectedStatus)
    );
    assert.equal(rangeCalls, 0);
  });
}

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

test("local empty video responses stay bounded and reject byte ranges", async () => {
  const { createLocalAlbumVideoResponse } = await apiMediaHelpers();
  await withTempVideoBytes(Buffer.alloc(0), async (filePath) => {
    const head = await createLocalAlbumVideoResponse({ filePath, method: "HEAD" });
    assert.equal(head.statusCode, 200);
    assert.equal(Number(head.headers["content-length"]), 0);
    assert.equal(head.body, null);

    const get = await createLocalAlbumVideoResponse({ filePath, method: "GET" });
    assert.equal(get.statusCode, 200);
    assert.deepEqual(await streamedResponseBytes(get.body), Buffer.alloc(0));

    const ranged = await createLocalAlbumVideoResponse({
      filePath,
      method: "GET",
      range: "bytes=0-0"
    });
    assert.equal(ranged.statusCode, 416);
    assert.equal(ranged.headers["content-range"], "bytes */0");
    assert.equal(ranged.body, null);
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

test("COS metadata helper issues a signed HEAD without a request body", async () => {
  const { headCosObject } = await apiCosHelpers();
  const fake = createFakeHttpsRequest({
    headers: { "content-length": String(VIDEO_BYTES.length), "content-type": "video/mp4" }
  });
  const result = await headCosObject({
    key: "uploads/session-album/videos/source/fixture.mp4",
    config: COS_CONFIG,
    request: fake.request
  });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].options.method, "HEAD");
  assert.equal(fake.calls[0].writes.length, 0);
  assert.equal(fake.calls[0].options.headers.authorization.includes("q-header-list=date;host"), true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["content-type"], "video/mp4");
  assert.equal(result.body.length, 0);
});

test("COS range helper signs and sends exactly the requested Range header", async () => {
  const { readCosObjectRange } = await apiCosHelpers();
  const fake = createFakeHttpsRequest({
    statusCode: 206,
    headers: { "content-range": `bytes 0-11/${VIDEO_BYTES.length}` },
    body: VIDEO_BYTES.subarray(0, 12)
  });
  const result = await readCosObjectRange({
    key: "uploads/session-album/videos/source/fixture.mp4",
    start: 0,
    end: 11,
    config: COS_CONFIG,
    request: fake.request
  });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].options.method, "GET");
  assert.equal(fake.calls[0].options.headers.range, "bytes=0-11");
  assert.equal(
    fake.calls[0].options.headers.authorization.includes("q-header-list=date;host;range"),
    true
  );
  assert.deepEqual(result, VIDEO_BYTES.subarray(0, 12));
});

test("COS range helper rejects ignored and oversized range responses without buffering them", async () => {
  const { readCosObjectRange } = await apiCosHelpers();
  for (const response of [
    { statusCode: 200, body: VIDEO_BYTES },
    {
      statusCode: 206,
      headers: { "content-range": `bytes 0-${VIDEO_BYTES.length - 1}/${VIDEO_BYTES.length}` },
      body: VIDEO_BYTES
    },
    {
      statusCode: 206,
      headers: {
        "content-range": `bytes 0-11/${VIDEO_BYTES.length}`,
        "content-length": "13"
      }
    }
  ]) {
    const fake = createFakeHttpsRequest(response);
    await assert.rejects(
      readCosObjectRange({
        key: "uploads/session-album/videos/source/fixture.mp4",
        start: 0,
        end: 11,
        config: COS_CONFIG,
        request: fake.request
      }),
      (error) => error?.statusCode === 502 && error?.code === "COS_RESPONSE_TOO_LARGE"
    );
  }
});

test("COS metadata and range helpers classify storage and network failures", async () => {
  const { headCosObject, readCosObjectRange } = await apiCosHelpers();
  const missing = createFakeHttpsRequest({ statusCode: 404, body: Buffer.from("missing") });
  await assert.rejects(
    headCosObject({ key: "missing.mp4", config: COS_CONFIG, request: missing.request }),
    (error) => error?.statusCode === 404 && error?.code === "COS_OBJECT_NOT_FOUND"
  );

  const unavailable = createFakeHttpsRequest({ statusCode: 503, body: Buffer.from("unavailable") });
  await assert.rejects(
    readCosObjectRange({ key: "video.mp4", config: COS_CONFIG, request: unavailable.request }),
    (error) => error?.statusCode === 502 && error?.code === "COS_UPSTREAM_ERROR"
  );

  const networkError = Object.assign(new Error("network unavailable"), { code: "ECONNRESET" });
  const network = createFakeHttpsRequest({ requestError: networkError });
  await assert.rejects(
    headCosObject({ key: "video.mp4", config: COS_CONFIG, request: network.request }),
    (error) =>
      error !== networkError &&
      error?.statusCode === 502 &&
      error?.code === "COS_NETWORK_ERROR" &&
      error?.isCosStorageError === true
  );
});

test("COS helpers cap declared and streamed error response bodies", async () => {
  const { headCosObject } = await apiCosHelpers();
  const declared = createFakeHttpsRequest({
    statusCode: 404,
    headers: { "content-length": String(64 * 1024 + 1) }
  });
  await assert.rejects(
    headCosObject({ key: "missing.mp4", config: COS_CONFIG, request: declared.request }),
    (error) => error?.statusCode === 404 && error?.code === "COS_OBJECT_NOT_FOUND"
  );
  assert.equal(declared.calls[0].responseDestroyed, true);

  const streamed = createFakeHttpsRequest({
    statusCode: 503,
    body: Buffer.alloc(64 * 1024 + 1)
  });
  await assert.rejects(
    headCosObject({ key: "unavailable.mp4", config: COS_CONFIG, request: streamed.request }),
    (error) => error?.statusCode === 502 && error?.code === "COS_UPSTREAM_ERROR"
  );
  assert.equal(streamed.calls[0].responseDestroyed, true);

  const invalidLength = createFakeHttpsRequest({
    statusCode: 503,
    headers: { "content-length": "not-a-number" }
  });
  await assert.rejects(
    headCosObject({ key: "invalid.mp4", config: COS_CONFIG, request: invalidLength.request }),
    (error) => error?.statusCode === 502 && error?.code === "COS_UPSTREAM_ERROR"
  );
  assert.equal(invalidLength.calls[0].responseDestroyed, true);
});

test("COS range helper rejects inconsistent Content-Range totals", async () => {
  const { readCosObjectRange } = await apiCosHelpers();
  for (const { contentRange, body } of [
    { contentRange: "bytes 0-11/8", body: VIDEO_BYTES.subarray(0, 12) },
    { contentRange: `bytes 0-7/${VIDEO_BYTES.length}`, body: VIDEO_BYTES.subarray(0, 8) }
  ]) {
    const fake = createFakeHttpsRequest({
      statusCode: 206,
      headers: { "content-range": contentRange },
      body
    });
    await assert.rejects(
      readCosObjectRange({
        key: "video.mp4",
        start: 0,
        end: 11,
        config: COS_CONFIG,
        request: fake.request
      }),
      (error) => error?.statusCode === 502 && error?.code === "COS_INVALID_RANGE_RESPONSE"
    );
  }
});

test("COS HEAD and Range inspection use the short default timeout", async () => {
  const { headCosObject, readCosObjectRange } = await apiCosHelpers();
  for (const inspect of [
    (options) => headCosObject({ key: "slow.mp4", ...options }),
    (options) => readCosObjectRange({ key: "slow.mp4", start: 0, end: 11, ...options })
  ]) {
    const fake = createFakeHttpsRequest({ respond: false });
    const scheduled = [];
    await assert.rejects(
      inspect({
        config: COS_CONFIG,
        request: fake.request,
        setTimeoutFn: (run, delay) => {
          scheduled.push(delay);
          queueMicrotask(run);
          return 1;
        },
        clearTimeoutFn: () => {}
      }),
      hasStatus(504)
    );
    assert.deepEqual(scheduled, [10_000]);
    assert.equal(fake.calls[0].requestDestroyed, true);
  }
});

test("COS full transfers and deletes use operation-specific configurable timeouts", async () => {
  const { deleteCosObject, getCosObject, putCosObject } = await apiCosHelpers();
  for (const { timeoutMs, expectedTimeout } of [
    { timeoutMs: undefined, expectedTimeout: 5 * 60 * 1000 },
    { timeoutMs: 45_000, expectedTimeout: 45_000 }
  ]) {
    const fake = createFakeHttpsRequest();
    const scheduled = [];
    const result = await putCosObject({
      key: "uploads/session-album/videos/source/full.mp4",
      body: VIDEO_BYTES,
      contentType: "video/mp4",
      config: COS_CONFIG,
      request: fake.request,
      timeoutMs,
      setTimeoutFn: (run, delay) => {
        scheduled.push(delay);
        if (delay <= 10_000) queueMicrotask(run);
        return 1;
      },
      clearTimeoutFn: () => {}
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(scheduled, [expectedTimeout]);
    assert.deepEqual(fake.calls[0].writes, [VIDEO_BYTES]);
    assert.equal(fake.calls[0].requestDestroyed, undefined);
  }

  for (const { operation, expectedTimeout } of [
    {
      operation: (options) => getCosObject({ key: "uploads/session-album/display/full.jpg", ...options }),
      expectedTimeout: 5 * 60 * 1000
    },
    {
      operation: (options) => deleteCosObject({ key: "uploads/session-album/display/full.jpg", ...options }),
      expectedTimeout: 30_000
    }
  ]) {
    const fake = createFakeHttpsRequest();
    const scheduled = [];
    const result = await operation({
      config: COS_CONFIG,
      request: fake.request,
      setTimeoutFn: (_run, delay) => {
        scheduled.push(delay);
        return 1;
      },
      clearTimeoutFn: () => {}
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(scheduled, [expectedTimeout]);
  }
});

test("COS aborted responses reject with retryable 504", async () => {
  const { headCosObject } = await apiCosHelpers();
  const fake = createFakeHttpsRequest({ responseAborted: true });
  await assert.rejects(
    headCosObject({ key: "aborted.mp4", config: COS_CONFIG, request: fake.request }),
    hasStatus(504)
  );
});

currentTestScope = "api-lifecycle";

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
    findAfterDuplicateOnFreshConnection: async () => null
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
    findAfterDuplicateOnFreshConnection: async () => null
  });
  assert.equal(result, inserted);
  assert.equal(insertCalls, 1);
});

test("idempotent create uses a fresh connection after the source index wins a race", async () => {
  const { createIdempotentAlbumVideo } = await apiLifecycleHelpers();
  const winner = { id: 9, source_url: "video/race.mp4" };
  const calls = [];
  const initialFind = async (sourceUrl) => {
    calls.push(["initial-transaction-find", sourceUrl]);
    return null;
  };
  const freshFind = async (sourceUrl, duplicateError) => {
    calls.push(["fresh-connection-current-read", sourceUrl, duplicateError.constraint]);
    return winner;
  };
  assert.notEqual(initialFind, freshFind);
  const result = await createIdempotentAlbumVideo({
    sourceUrl: winner.source_url,
    findExisting: initialFind,
    insert: async () => {
      calls.push(["insert-transaction-rolled-back-before-recovery"]);
      throw Object.assign(new Error("duplicate source_url"), {
        code: "ER_DUP_ENTRY",
        constraint: "uniq_session_album_video_source_url"
      });
    },
    findAfterDuplicateOnFreshConnection: freshFind
  });
  assert.equal(result, winner);
  assert.deepEqual(calls, [
    ["initial-transaction-find", winner.source_url],
    ["insert-transaction-rolled-back-before-recovery"],
    [
      "fresh-connection-current-read",
      winner.source_url,
      "uniq_session_album_video_source_url"
    ]
  ]);

  const reusedTransactionRead = async () => null;
  await assert.rejects(
    createIdempotentAlbumVideo({
      sourceUrl: "video/reused-transaction.mp4",
      findExisting: reusedTransactionRead,
      insert: async () => winner,
      findAfterDuplicateOnFreshConnection: reusedTransactionRead
    }),
    (error) => error instanceof TypeError && /fresh-connection current read/.test(error.message)
  );
});

test("idempotent create reports a conflict when the duplicate winner is missing", async () => {
  const { createIdempotentAlbumVideo } = await apiLifecycleHelpers();
  await assert.rejects(
    createIdempotentAlbumVideo({
      sourceUrl: "video/missing-winner.mp4",
      findExisting: async () => null,
      insert: async () => {
        throw Object.assign(new Error("duplicate source_url"), {
          code: "ER_DUP_ENTRY",
          sqlMessage:
            "Duplicate entry 'video/missing-winner.mp4' for key 'session_album_photos.uniq_session_album_video_source_url'"
        });
      },
      findAfterDuplicateOnFreshConnection: async () => null
    }),
    (error) =>
      error?.statusCode === 409 && error?.code === "ALBUM_VIDEO_DUPLICATE_WINNER_MISSING"
  );
});

test("idempotent create propagates non-source-index insert errors", async () => {
  const { createIdempotentAlbumVideo } = await apiLifecycleHelpers();
  for (const insertError of [
    Object.assign(new Error("database unavailable"), { code: "ECONNRESET" }),
    Object.assign(new Error("unrelated duplicate"), {
      code: "ER_DUP_ENTRY",
      key: "uniq_session_album_photo_tag"
    })
  ]) {
    let freshConnectionCalls = 0;
    await assert.rejects(
      createIdempotentAlbumVideo({
        sourceUrl: "video/failure.mp4",
        findExisting: async () => null,
        insert: async () => { throw insertError; },
        findAfterDuplicateOnFreshConnection: async () => { freshConnectionCalls += 1; }
      }),
      (error) => error === insertError
    );
    assert.equal(freshConnectionCalls, 0);
  }
});

test("delete cleanup deduplicates object URLs before finalizing", async () => {
  const { cleanupAlbumVideoBeforeDelete } = await apiLifecycleHelpers();
  const deleted = [];
  let finalizeCalls = 0;
  const result = await cleanupAlbumVideoBeforeDelete({
    urls: ["source.mp4", "cover.jpg", "source.mp4", "", null, "cover.jpg"],
    deleteObject: async (url) => { deleted.push(url); },
    finalizeSnapshot: async (expectedUrls) => {
      finalizeCalls += 1;
      assert.equal(Object.isFrozen(expectedUrls), true);
      assert.deepEqual(expectedUrls, ["source.mp4", "cover.jpg"]);
      return { deleted: true };
    }
  });
  assert.deepEqual(deleted, ["source.mp4", "cover.jpg"]);
  assert.equal(finalizeCalls, 1);
  assert.deepEqual(result, { deleted: true });
});

test("delete cleanup treats object 404 as success", async () => {
  const { cleanupAlbumVideoBeforeDelete } = await apiLifecycleHelpers();
  let finalizeCalls = 0;
  await cleanupAlbumVideoBeforeDelete({
    urls: ["already-missing.mp4"],
    deleteObject: async () => { throw Object.assign(new Error("missing"), { statusCode: 404 }); },
    finalizeSnapshot: async (expectedUrls) => {
      finalizeCalls += 1;
      assert.deepEqual(expectedUrls, ["already-missing.mp4"]);
      return { deleted: true };
    }
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
        finalizeSnapshot: async () => {
          finalizeCalls += 1;
          return { deleted: true };
        }
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
    finalizeSnapshot: async (expectedUrls) => {
      finalizeCalls += 1;
      assert.deepEqual(expectedUrls, ["source.mp4", "display.mp4", "cover.jpg"]);
      return { deleted: true };
    }
  };
  await assert.rejects(cleanupAlbumVideoBeforeDelete(options), hasStatus(503));
  assert.equal(finalizeCalls, 0);
  firstAttempt = false;
  await cleanupAlbumVideoBeforeDelete(options);
  assert.deepEqual([...deleted].sort(), ["cover.jpg", "display.mp4", "source.mp4"]);
  assert.equal(finalizeCalls, 1);
});

test("delete cleanup rejects when the locked database snapshot changed", async () => {
  const { cleanupAlbumVideoBeforeDelete } = await apiLifecycleHelpers();
  const deleted = [];
  await assert.rejects(
    cleanupAlbumVideoBeforeDelete({
      urls: ["source-v1.mp4", "cover-v1.jpg", "source-v1.mp4"],
      deleteObject: async (url) => { deleted.push(url); },
      // Service integration must SELECT ... FOR UPDATE, compare these immutable
      // URLs, then delete tags/media atomically only when the snapshot matches.
      finalizeSnapshot: async (expectedUrls) => {
        assert.equal(Object.isFrozen(expectedUrls), true);
        assert.deepEqual(expectedUrls, ["source-v1.mp4", "cover-v1.jpg"]);
        return { deleted: false, reason: "changed" };
      }
    }),
    (error) =>
      error?.statusCode === 409 && error?.code === "ALBUM_VIDEO_DELETE_SNAPSHOT_CHANGED"
  );
  assert.deepEqual(deleted, ["source-v1.mp4", "cover-v1.jpg"]);
  await assert.rejects(
    cleanupAlbumVideoBeforeDelete({
      urls: [],
      deleteObject: async () => {},
      finalizeSnapshot: async () => false
    }),
    (error) =>
      error?.statusCode === 409 && error?.code === "ALBUM_VIDEO_DELETE_SNAPSHOT_CHANGED"
  );
});

test("album video migration preflight passes when source URLs are unique", async () => {
  const {
    assertSessionAlbumVideoSourceUrlsUnique,
    DUPLICATE_SESSION_ALBUM_VIDEO_SOURCE_QUERY
  } = await apiMigrationHelpers();
  const queries = [];
  await assertSessionAlbumVideoSourceUrlsUnique({
    query: async (sql) => {
      queries.push(sql);
      return [[]];
    }
  });
  assert.deepEqual(queries, [DUPLICATE_SESSION_ALBUM_VIDEO_SOURCE_QUERY]);
  assert.match(queries[0], /source_url IS NOT NULL/);
  assert.doesNotMatch(queries[0], /source_url\s*<>\s*''/);
  assert.match(queries[0], /HAVING COUNT\(\*\) > 1/);
  assert.match(queries[0], /INNER JOIN/);
  assert.match(queries[0], /ORDER BY duplicates\.source_url ASC, album\.id ASC/);
  assert.doesNotMatch(queries[0], /GROUP_CONCAT/);
});

test("album video migration preflight stops on empty sources and lists every duplicate id", async () => {
  const { applyMigration } = await apiMigrationRunner();
  const {
    SESSION_ALBUM_VIDEO_HARDENING_MIGRATION,
    SESSION_ALBUM_VIDEO_SOURCE_INDEX
  } = await apiMigrationHelpers();
  const largeGroupIds = Array.from({ length: 1000 }, (_, index) => index * 3 + 1);
  const duplicateRows = [
    { source_url: "", id: 4, duplicate_count: 2 },
    { source_url: "", id: 9, duplicate_count: 2 },
    ...largeGroupIds.map((id) => ({
      source_url: "videos/large.mp4",
      id,
      duplicate_count: largeGroupIds.length
    }))
  ];
  const calls = [];
  const connection = {
    beginTransaction: async () => { calls.push("begin"); },
    query: async (sql, values) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized.includes("FROM information_schema.statistics")) {
        assert.deepEqual(values, [SESSION_ALBUM_VIDEO_SOURCE_INDEX]);
        calls.push("index-inspection");
        return [[]];
      }
      if (normalized.startsWith("SELECT duplicates.source_url,")) {
        calls.push("ordered-duplicate-rows");
        return [duplicateRows];
      }
      calls.push(normalized);
      return [[]];
    },
    commit: async () => { calls.push("commit"); },
    rollback: async () => { calls.push("rollback"); }
  };
  await assert.rejects(
    applyMigration(connection, {
      file: SESSION_ALBUM_VIDEO_HARDENING_MIGRATION,
      sql: `ALTER TABLE session_album_photos
        ADD UNIQUE KEY uniq_session_album_video_source_url (source_url);`
    }),
    (error) => {
      assert.equal(error?.code, "SESSION_ALBUM_VIDEO_DUPLICATE_SOURCE_URL");
      for (const expected of ["source_url=\"\"", "count=2", "ids=[4,9]"]) {
        assert.equal(error.message.includes(expected), true, expected);
      }
      assert.deepEqual(error.duplicates, [
        { sourceUrl: "", count: 2, ids: [4, 9] },
        {
          sourceUrl: "videos/large.mp4",
          count: largeGroupIds.length,
          ids: largeGroupIds
        }
      ]);
      assert.deepEqual(error.details?.duplicates, error.duplicates);
      assert.equal(error.message.includes("[truncated; full IDs in error.details]"), true);
      assert.equal(error.message.length < 2300, true);
      return true;
    }
  );
  assert.deepEqual(calls, [
    "begin",
    "index-inspection",
    "ordered-duplicate-rows",
    "rollback"
  ]);
});

test("migration CLI JSON preserves all structured duplicate details", async () => {
  const { serializeMigrationError } = await apiMigrationRunner();
  const ids = Array.from({ length: 400 }, (_, index) => 1_000_000 + index * 7);
  const error = new Error("duplicate details were capped in the human message");
  error.details = {
    duplicates: [{
      sourceUrl: "videos/cli-details.mp4",
      count: ids.length,
      ids
    }]
  };
  const cliJson = JSON.stringify({ ok: false, error: serializeMigrationError(error) });
  const parsed = JSON.parse(cliJson);
  assert.deepEqual(parsed, {
    ok: false,
    error: {
      code: "MIGRATION_FAILED",
      message: error.message,
      details: error.details
    }
  });
  assert.equal(parsed.error.details.duplicates[0].ids.length, 400);
  assert.deepEqual(parsed.error.details.duplicates[0].ids, ids);
  assert.deepEqual(serializeMigrationError(new Error("legacy shape")), {
    code: "MIGRATION_FAILED",
    message: "legacy shape"
  });
});

test("album video migration runs preflight immediately before its ALTER", async () => {
  const { applyMigration } = await apiMigrationRunner();
  const {
    prepareMigration,
    SESSION_ALBUM_VIDEO_HARDENING_MIGRATION,
    SESSION_ALBUM_VIDEO_SOURCE_INDEX
  } = await apiMigrationHelpers();
  const calls = [];
  const connection = {
    beginTransaction: async () => { calls.push("begin"); },
    query: async (sql, values) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized.includes("FROM information_schema.statistics")) {
        assert.deepEqual(values, [SESSION_ALBUM_VIDEO_SOURCE_INDEX]);
        calls.push("index-inspection");
        return [[]];
      }
      if (normalized.startsWith("SELECT duplicates.source_url,")) {
        calls.push("preflight");
        return [[]];
      }
      if (normalized.startsWith("ALTER TABLE session_album_photos")) {
        calls.push("alter");
      } else if (normalized.startsWith("INSERT INTO schema_migrations")) {
        calls.push(["record", values]);
      }
      return [[]];
    },
    commit: async () => { calls.push("commit"); },
    rollback: async () => { calls.push("rollback"); }
  };

  const sql = await readFile(
    new URL("../apps/api/migrations/0022_session_album_video_hardening.sql", import.meta.url),
    "utf8"
  );
  assert.equal(
    sql,
    "ALTER TABLE session_album_photos\n" +
      "  ADD UNIQUE KEY uniq_session_album_video_source_url (source_url);\n"
  );
  await applyMigration(connection, {
    file: SESSION_ALBUM_VIDEO_HARDENING_MIGRATION,
    sql
  });

  assert.deepEqual(calls, [
    "begin",
    "index-inspection",
    "preflight",
    "alter",
    ["record", [SESSION_ALBUM_VIDEO_HARDENING_MIGRATION]],
    "commit"
  ]);
  assert.deepEqual(
    await prepareMigration(
      { query: async () => { throw new Error("other migrations must not inspect the video index"); } },
      "0022_store_location_data.sql"
    ),
    { skipStatements: false }
  );
});

test("album video migration reconciles an exact existing unique index", async () => {
  const { applyMigration } = await apiMigrationRunner();
  const {
    SESSION_ALBUM_VIDEO_HARDENING_MIGRATION,
    SESSION_ALBUM_VIDEO_SOURCE_INDEX
  } = await apiMigrationHelpers();
  const calls = [];
  const connection = {
    beginTransaction: async () => { calls.push("begin"); },
    query: async (sql, values) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized.includes("FROM information_schema.statistics")) {
        assert.deepEqual(values, [SESSION_ALBUM_VIDEO_SOURCE_INDEX]);
        calls.push("exact-index");
        return [[{ non_unique: 0, column_name: "source_url", seq_in_index: 1 }]];
      }
      if (normalized.startsWith("INSERT INTO schema_migrations")) {
        calls.push(["record", values]);
        return [[]];
      }
      calls.push(normalized);
      return [[]];
    },
    commit: async () => { calls.push("commit"); },
    rollback: async () => { calls.push("rollback"); }
  };
  await applyMigration(connection, {
    file: SESSION_ALBUM_VIDEO_HARDENING_MIGRATION,
    sql: "ALTER TABLE session_album_photos ADD UNIQUE KEY ignored_by_reconciliation (source_url);"
  });
  assert.deepEqual(calls, [
    "begin",
    "exact-index",
    ["record", [SESSION_ALBUM_VIDEO_HARDENING_MIGRATION]],
    "commit"
  ]);
});

test("album video migration rejects wrong uniqueness, columns, order, and prefixes", async () => {
  const { applyMigration } = await apiMigrationRunner();
  const { SESSION_ALBUM_VIDEO_HARDENING_MIGRATION } = await apiMigrationHelpers();
  const wrongShapes = [
    [{ non_unique: 1, column_name: "source_url", seq_in_index: 1 }],
    [{ non_unique: 0, column_name: "display_url", seq_in_index: 1 }],
    [{ non_unique: 0, column_name: "source_url", seq_in_index: 2 }],
    [{ non_unique: 0, column_name: "source_url", seq_in_index: 1, sub_part: 191 }]
  ];
  for (const rows of wrongShapes) {
    const calls = [];
    const connection = {
      beginTransaction: async () => { calls.push("begin"); },
      query: async (sql) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized.includes("FROM information_schema.statistics")) {
          calls.push("wrong-index");
          return [rows];
        }
        calls.push(normalized);
        return [[]];
      },
      commit: async () => { calls.push("commit"); },
      rollback: async () => { calls.push("rollback"); }
    };
    await assert.rejects(
      applyMigration(connection, {
        file: SESSION_ALBUM_VIDEO_HARDENING_MIGRATION,
        sql: "ALTER TABLE session_album_photos ADD UNIQUE KEY wrong (source_url);"
      }),
      (error) => {
        assert.equal(error?.code, "SESSION_ALBUM_VIDEO_SOURCE_INDEX_SHAPE_MISMATCH");
        assert.deepEqual(error.details?.expected, { unique: true, columns: ["source_url"] });
        assert.equal(Array.isArray(error.details?.actual), true);
        return true;
      }
    );
    assert.deepEqual(calls, ["begin", "wrong-index", "rollback"]);
  }
});

test("album video migration recovers after ALTER succeeds but version recording fails", async () => {
  const { applyMigration } = await apiMigrationRunner();
  const { SESSION_ALBUM_VIDEO_HARDENING_MIGRATION } = await apiMigrationHelpers();
  const versionError = new Error("schema_migrations write failed");
  let indexExists = false;
  let failVersionRecord = true;
  const calls = [];
  const connection = {
    beginTransaction: async () => { calls.push("begin"); },
    query: async (sql) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized.includes("FROM information_schema.statistics")) {
        calls.push(indexExists ? "exact-index" : "absent-index");
        return [indexExists
          ? [{ non_unique: 0, column_name: "source_url", seq_in_index: 1 }]
          : []];
      }
      if (normalized.startsWith("SELECT duplicates.source_url,")) {
        calls.push("preflight");
        return [[]];
      }
      if (normalized.startsWith("ALTER TABLE session_album_photos")) {
        calls.push("alter-implicitly-committed");
        indexExists = true;
        return [[]];
      }
      if (normalized.startsWith("INSERT INTO schema_migrations")) {
        calls.push(failVersionRecord ? "record-failed" : "record-succeeded");
        if (failVersionRecord) throw versionError;
        return [[]];
      }
      return [[]];
    },
    commit: async () => { calls.push("commit"); },
    rollback: async () => { calls.push("rollback-does-not-remove-ddl"); }
  };
  const options = {
    file: SESSION_ALBUM_VIDEO_HARDENING_MIGRATION,
    sql: "ALTER TABLE session_album_photos ADD UNIQUE KEY uniq_session_album_video_source_url (source_url);"
  };

  await assert.rejects(applyMigration(connection, options), (error) => error === versionError);
  failVersionRecord = false;
  await applyMigration(connection, options);

  assert.deepEqual(calls, [
    "begin",
    "absent-index",
    "preflight",
    "alter-implicitly-committed",
    "record-failed",
    "rollback-does-not-remove-ddl",
    "begin",
    "exact-index",
    "record-succeeded",
    "commit"
  ]);
});

currentTestScope = "api-creation";

const CREATION_SESSION_ID = 41;
const CREATION_USER_ID = 23;
const CREATION_SOURCE_URL =
  "/uploads/session-album/videos/source/admin-video-41-23-1720000000000-0123456789abcdef.mp4";
const CREATION_USER = {
  user: { id: CREATION_USER_ID },
  roles: ["system_admin"]
};

function creationBody(overrides = {}) {
  return {
    sourceUrl: CREATION_SOURCE_URL,
    durationSeconds: 38,
    videoWidth: 1920,
    videoHeight: 1080,
    ...overrides
  };
}

function creationRow(overrides = {}) {
  return {
    id: 71,
    session_id: CREATION_SESSION_ID,
    uploader_user_id: CREATION_USER_ID,
    media_type: "video",
    source_url: CREATION_SOURCE_URL,
    display_url: CREATION_SOURCE_URL,
    duration_seconds: 38,
    video_width: 1920,
    video_height: 1080,
    video_byte_size: 654321,
    video_content_type: "video/mp4",
    processing_status: "ready",
    moderation_status: "approved_legacy",
    processing_error: null,
    created_at: "2026-07-10T10:00:00.000Z",
    status: "active",
    ...overrides
  };
}

function expectedCreationResponse(row, userId = CREATION_USER_ID) {
  const isMine = Number(row.uploader_user_id) === Number(userId);
  return {
    id: Number(row.id),
    session_id: Number(row.session_id),
    media_type: "video",
    processing_status: row.processing_status,
    moderation_status: row.moderation_status || "approved_legacy",
    moderation_message: null,
    uploader_user_id: Number(row.uploader_user_id),
    is_mine: isMine,
    can_delete: isMine,
    can_tag: true,
    duration_seconds: Number(row.duration_seconds),
    video_width: Number(row.video_width),
    video_height: Number(row.video_height),
    video_byte_size: Number(row.video_byte_size),
    video_content_type: row.video_content_type,
    processing_error: row.processing_error,
    created_at: row.created_at,
    tags: []
  };
}

function normalizedSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

test("video creation validates admin, bound source, duration, and optional dimensions", async () => {
  const { createSessionAlbumVideo } = await apiCoreService();
  const invalidCases = [
    {
      user: { ...CREATION_USER, roles: [] },
      body: creationBody(),
      expectedStatus: 403
    },
    {
      user: CREATION_USER,
      body: creationBody({
        sourceUrl:
          "/uploads/session-album/videos/source/admin-video-41-999-1720000000000-0123456789abcdef.mp4"
      }),
      expectedStatus: 400
    },
    {
      user: CREATION_USER,
      body: creationBody({ durationSeconds: 61 }),
      expectedStatus: 400
    },
    {
      user: CREATION_USER,
      body: creationBody({ videoWidth: 0 }),
      expectedStatus: 400
    },
    {
      user: CREATION_USER,
      body: creationBody({ videoHeight: -1 }),
      expectedStatus: 400
    },
    {
      user: CREATION_USER,
      body: creationBody({ videoWidth: 4_294_967_296 }),
      expectedStatus: 400
    }
  ];
  let dependencyCalls = 0;

  for (const { user, body, expectedStatus } of invalidCases) {
    await assert.rejects(
      createSessionAlbumVideo(user, CREATION_SESSION_ID, body, {
        inspectObject: async () => {
          dependencyCalls += 1;
        },
        withDatabaseConnection: async () => {
          dependencyCalls += 1;
        }
      }),
      hasStatus(expectedStatus)
    );
  }
  assert.equal(dependencyCalls, 0);
});

test("video creation requires an explicit authoritative object inspector", async () => {
  const { createSessionAlbumVideo } = await apiCoreService();
  await assert.rejects(
    createSessionAlbumVideo(CREATION_USER, CREATION_SESSION_ID, creationBody()),
    (error) => error instanceof TypeError && /options\.inspectObject/.test(error.message)
  );
});

test("video creation rejects inspection failure before opening an insert transaction", async () => {
  const { createSessionAlbumVideo } = await apiCoreService();
  const inspectionError = Object.assign(new Error("object missing"), { statusCode: 404 });
  const events = [];
  let transactionCalls = 0;

  await assert.rejects(
    createSessionAlbumVideo(CREATION_USER, CREATION_SESSION_ID, creationBody(), {
      withDatabaseConnection: async (work) => {
        events.push("authorization-connection");
        return work({ kind: "authorization" });
      },
      withTransaction: async () => {
        transactionCalls += 1;
      },
      authorizeSessionAlbumVideoCreate: async () => {
        events.push("authorized");
      },
      inspectObject: async (sourceUrl) => {
        events.push(`inspect:${sourceUrl}`);
        throw inspectionError;
      }
    }),
    (error) => error === inspectionError
  );

  assert.deepEqual(events, [
    "authorization-connection",
    "authorized",
    `inspect:${CREATION_SOURCE_URL}`
  ]);
  assert.equal(transactionCalls, 0);
});

test("video creation ignores client metadata claims and stores inspected facts", async () => {
  const { createSessionAlbumVideo } = await apiCoreService();
  const cases = [
    {
      body: creationBody({ videoByteSize: 1, videoContentType: "image/jpeg" }),
      expectedWidth: 1920
    },
    {
      body: creationBody({
        videoByteSize: undefined,
        videoContentType: undefined,
        videoWidth: 4_294_967_295
      }),
      expectedWidth: 4_294_967_295
    }
  ];

  for (const { body, expectedWidth } of cases) {
    const insertedValues = [];
    const row = creationRow({ video_width: expectedWidth });
    const readConnection = {
      query: async () => {
        throw new Error("pre-inspection authorization adapter must not query in this test");
      }
    };
    const transactionConnection = {
      query: async (sql, values) => {
        const text = normalizedSql(sql);
        if (text.includes("FROM session_album_photos photo")) {
          assert.match(text, /source_url = \?/);
          assert.match(text, /media_type = 'video'/);
          assert.match(text, /status = 'active'/);
          assert.deepEqual(values, [CREATION_SESSION_ID, CREATION_SOURCE_URL]);
          return [[]];
        }
        if (text.startsWith("INSERT INTO session_album_photos")) {
          insertedValues.push(...values);
          return [{ insertId: row.id }];
        }
        if (text === "SELECT * FROM session_album_photos WHERE id = ?") {
          return [[row]];
        }
        throw new Error(`Unexpected creation SQL: ${text}`);
      }
    };

    const result = await createSessionAlbumVideo(CREATION_USER, CREATION_SESSION_ID, body, {
      readyOnCreate: true,
      inspectObject: async () => ({ byteSize: 654321, contentType: "video/mp4" }),
      authorizeSessionAlbumVideoCreate: async () => {},
      withDatabaseConnection: async (work) => work(readConnection),
      withTransaction: async (work) => work(transactionConnection)
    });

    assert.deepEqual(insertedValues, [
      CREATION_SESSION_ID,
      CREATION_USER_ID,
      CREATION_SOURCE_URL,
      CREATION_SOURCE_URL,
      null,
      38,
      expectedWidth,
      1080,
      654321,
      "video/mp4",
      null,
      "ready",
      "approved_legacy",
      `local:${CREATION_SOURCE_URL}:654321`
    ]);
    assert.deepEqual(result, expectedCreationResponse(row));
  }
});

test("video creation returns an existing source only after locked current reauthorization", async () => {
  const { createSessionAlbumVideo } = await apiCoreService();
  const existing = creationRow({ id: 72, uploader_user_id: 999 });
  const session = { id: CREATION_SESSION_ID, organizer_user_id: 999 };
  let transactionCalls = 0;
  let inspectCalls = 0;
  const nonlockingSql = [];
  const lockedSql = [];
  const events = [];

  const queryAuthorization = async (sql, values, { locked }) => {
    const text = normalizedSql(sql);
    (locked ? lockedSql : nonlockingSql).push(text);
    if (text.includes("FROM sessions session")) {
      assert.deepEqual(values, [CREATION_SESSION_ID]);
      return [[session]];
    }
    if (text.includes("FROM session_seats")) {
      assert.deepEqual(values, [CREATION_SESSION_ID, CREATION_USER_ID]);
      return [[{ id: 801 }]];
    }
    if (text.includes("FROM session_album_photos photo")) {
      assert.equal(locked, true, "existing source lookup must be a locked current read");
      assert.deepEqual(values, [CREATION_SESSION_ID, CREATION_SOURCE_URL]);
      return [[existing]];
    }
    throw new Error(`Unexpected authorization SQL: ${text}`);
  };

  const result = await createSessionAlbumVideo(
    CREATION_USER,
    CREATION_SESSION_ID,
    creationBody(),
    {
      inspectObject: async () => {
        inspectCalls += 1;
        return { byteSize: 654321, contentType: "video/mp4" };
      },
      withDatabaseConnection: async (work) => work({
        query: (sql, values) => queryAuthorization(sql, values, { locked: false })
      }),
      withTransaction: async (work) => {
        transactionCalls += 1;
        const value = await work({
          query: (sql, values) => queryAuthorization(sql, values, { locked: true })
        });
        events.push("existing-transaction-commit");
        return value;
      }
    }
  );
  events.push("service-returned-existing");

  assert.equal(inspectCalls, 1);
  assert.equal(transactionCalls, 1);
  assert.equal(nonlockingSql.every((sql) => !/FOR UPDATE/i.test(sql)), true);
  assert.equal(lockedSql.length, 3);
  assert.equal(lockedSql.every((sql) => /FOR UPDATE/i.test(sql)), true);
  assert.deepEqual(events, ["existing-transaction-commit", "service-returned-existing"]);
  assert.deepEqual(result, expectedCreationResponse(existing));
});

test("membership revoked during inspection blocks the existing fast path", async () => {
  const { createSessionAlbumVideo } = await apiCoreService();
  const revokedError = Object.assign(new Error("membership revoked"), { statusCode: 403 });
  const events = [];
  let revoked = false;
  let sourceLookupCalls = 0;

  await assert.rejects(
    createSessionAlbumVideo(CREATION_USER, CREATION_SESSION_ID, creationBody(), {
      inspectObject: async () => {
        events.push("inspect-and-revoke");
        revoked = true;
        return { byteSize: 654321, contentType: "video/mp4" };
      },
      authorizeSessionAlbumVideoCreate: async (_connection, _sessionId, _user, options) => {
        if (options?.forUpdate) {
          events.push("locked-current-reauthorize");
          if (revoked) throw revokedError;
        } else {
          events.push("initial-nonlocking-authorize");
        }
      },
      withDatabaseConnection: async (work) => work({ kind: "read" }),
      withTransaction: async (work) => {
        events.push("transaction-begin");
        try {
          const value = await work({
            kind: "transaction",
            query: async () => {
              sourceLookupCalls += 1;
              return [[creationRow({ id: 720 })]];
            }
          });
          events.push("transaction-commit");
          return value;
        } catch (error) {
          events.push("transaction-rollback");
          throw error;
        }
      }
    }),
    (error) => error === revokedError
  );

  assert.equal(sourceLookupCalls, 0);
  assert.deepEqual(events, [
    "initial-nonlocking-authorize",
    "inspect-and-revoke",
    "transaction-begin",
    "locked-current-reauthorize",
    "transaction-rollback"
  ]);
});

test("source duplicate recovery rolls back before locked authorization and winner read in a fresh transaction", async () => {
  const { createSessionAlbumVideo } = await apiCoreService();
  const winner = creationRow({ id: 73 });
  const events = [];
  let transactionNumber = 0;
  let winnerQueryCalls = 0;

  const result = await createSessionAlbumVideo(
    CREATION_USER,
    CREATION_SESSION_ID,
    creationBody(),
    {
      inspectObject: async () => {
        events.push("inspect");
        return { byteSize: 654321, contentType: "video/mp4" };
      },
      authorizeSessionAlbumVideoCreate: async (connection, _sessionId, _user, options) => {
        if (connection.kind === "read") {
          assert.notEqual(options?.forUpdate, true);
          events.push("authorize-nonlocking");
          return;
        }
        assert.equal(options?.forUpdate, true);
        events.push(`authorize-locked:${connection.kind}`);
      },
      withDatabaseConnection: async (work) => {
        events.push("preauth-connection-open");
        try {
          return await work({
            kind: "read",
            query: async () => {
              throw new Error("winner recovery must not use a non-transaction connection");
            }
          });
        } finally {
          events.push("preauth-connection-close");
        }
      },
      withTransaction: async (work) => {
        transactionNumber += 1;
        const currentTransaction = transactionNumber;
        events.push(`transaction-${currentTransaction}-begin`);
        try {
          const value = await work({
            kind: `transaction-${currentTransaction}`,
            query: async (sql) => {
              const text = normalizedSql(sql);
              if (text.includes("FROM session_album_photos photo")) {
                assert.match(text, /FOR UPDATE/i);
                if (currentTransaction === 1) {
                  events.push("initial-locked-source-read");
                  return [[]];
                }
                assert.equal(currentTransaction, 3);
                winnerQueryCalls += 1;
                events.push("fresh-locked-winner-read");
                return [[winner]];
              }
              assert.equal(currentTransaction, 2);
              assert.match(text, /^INSERT INTO session_album_photos/);
              events.push("insert-duplicate");
              throw Object.assign(new Error("duplicate source"), {
                code: "ER_DUP_ENTRY",
                constraint: "uniq_session_album_video_source_url"
              });
            }
          });
          events.push(`transaction-${currentTransaction}-commit`);
          return value;
        } catch (error) {
          events.push(`transaction-${currentTransaction}-rollback-complete`);
          throw error;
        }
      }
    }
  );

  assert.deepEqual(result, expectedCreationResponse(winner));
  assert.equal(transactionNumber, 3);
  assert.equal(winnerQueryCalls, 1);
  assert.ok(
    events.indexOf("transaction-2-rollback-complete") <
      events.indexOf("authorize-locked:transaction-3") &&
      events.indexOf("authorize-locked:transaction-3") <
        events.indexOf("fresh-locked-winner-read") &&
      events.indexOf("fresh-locked-winner-read") <
        events.indexOf("transaction-3-commit"),
    `fresh transaction order is invalid: ${events.join(", ")}`
  );
});

test("membership revoked after duplicate rollback blocks fresh winner recovery", async () => {
  const { createSessionAlbumVideo } = await apiCoreService();
  const revokedError = Object.assign(new Error("membership revoked before recovery"), {
    statusCode: 403
  });
  const events = [];
  let transactionNumber = 0;
  let revoked = false;
  let winnerQueryCalls = 0;

  await assert.rejects(
    createSessionAlbumVideo(CREATION_USER, CREATION_SESSION_ID, creationBody(), {
      inspectObject: async () => ({ byteSize: 654321, contentType: "video/mp4" }),
      authorizeSessionAlbumVideoCreate: async (connection, _sessionId, _user, options) => {
        if (connection.kind === "read") return;
        assert.equal(options?.forUpdate, true);
        events.push(`authorize:${connection.kind}`);
        if (revoked) throw revokedError;
      },
      withDatabaseConnection: async (work) => work({
        kind: "read",
        query: async () => {
          throw new Error("revoked recovery must not use a non-transaction winner read");
        }
      }),
      withTransaction: async (work) => {
        transactionNumber += 1;
        const currentTransaction = transactionNumber;
        events.push(`transaction-${currentTransaction}-begin`);
        try {
          const value = await work({
            kind: `transaction-${currentTransaction}`,
            query: async (sql) => {
              const text = normalizedSql(sql);
              if (text.includes("FROM session_album_photos photo")) {
                if (currentTransaction === 1) return [[]];
                winnerQueryCalls += 1;
                return [[creationRow({ id: 730 })]];
              }
              assert.equal(currentTransaction, 2);
              throw Object.assign(new Error("duplicate source"), {
                code: "ER_DUP_ENTRY",
                constraint: "uniq_session_album_video_source_url"
              });
            }
          });
          events.push(`transaction-${currentTransaction}-commit`);
          return value;
        } catch (error) {
          events.push(`transaction-${currentTransaction}-rollback-complete`);
          if (currentTransaction === 2) revoked = true;
          throw error;
        }
      }
    }),
    (error) => error === revokedError
  );

  assert.equal(transactionNumber, 3);
  assert.equal(winnerQueryCalls, 0);
  assert.deepEqual(events.slice(-4), [
    "transaction-2-rollback-complete",
    "transaction-3-begin",
    "authorize:transaction-3",
    "transaction-3-rollback-complete"
  ]);
});

test("video creation propagates duplicates from unrelated indexes", async () => {
  const { createSessionAlbumVideo } = await apiCoreService();
  const unrelatedDuplicate = Object.assign(new Error("duplicate tag"), {
    code: "ER_DUP_ENTRY",
    key: "uniq_session_album_photo_tag"
  });
  let connectionCalls = 0;
  let transactionCalls = 0;

  await assert.rejects(
    createSessionAlbumVideo(CREATION_USER, CREATION_SESSION_ID, creationBody(), {
      inspectObject: async () => ({ byteSize: 654321, contentType: "video/mp4" }),
      authorizeSessionAlbumVideoCreate: async () => {},
      withDatabaseConnection: async (work) => {
        connectionCalls += 1;
        return work({
          query: async () => {
            throw new Error("unrelated duplicate must not open a fresh recovery read");
          }
        });
      },
      withTransaction: async (work) => {
        transactionCalls += 1;
        return work({
          query: async (sql) => {
            const text = normalizedSql(sql);
            if (text.includes("FROM session_album_photos photo")) return [[]];
            if (text.startsWith("INSERT INTO session_album_photos")) throw unrelatedDuplicate;
            throw new Error(`Unexpected duplicate test SQL: ${text}`);
          }
        });
      }
    }),
    (error) => error === unrelatedDuplicate
  );

  assert.equal(connectionCalls, 1, "unrelated duplicate must not open a recovery connection");
  assert.equal(transactionCalls, 2);
});

test("video creation authorizes before inspection and locks authorization in lookup and insert transactions", async () => {
  const { createSessionAlbumVideo } = await apiCoreService();
  const events = [];
  let transactionDepth = 0;
  let transactionNumber = 0;
  const row = creationRow({ id: 74, processing_status: "processing", display_url: null });

  await createSessionAlbumVideo(CREATION_USER, CREATION_SESSION_ID, creationBody(), {
    inspectObject: async () => {
      assert.equal(transactionDepth, 0, "object inspection must not hold a write transaction");
      events.push("inspect-outside-transaction");
      return { byteSize: 654321, contentType: "video/mp4" };
    },
    authorizeSessionAlbumVideoCreate: async (connection, sessionId, user, options) => {
      assert.equal(sessionId, CREATION_SESSION_ID);
      assert.equal(user, CREATION_USER);
      if (connection.kind === "read") {
        assert.notEqual(options?.forUpdate, true);
        events.push("authorize:read-nonlocking");
      } else {
        assert.equal(options?.forUpdate, true);
        events.push("authorize:transaction-locked");
      }
    },
    withDatabaseConnection: async (work) => work({
      kind: "read"
    }),
    withTransaction: async (work) => {
      transactionNumber += 1;
      const currentTransaction = transactionNumber;
      transactionDepth += 1;
      events.push(`transaction-${currentTransaction}-begin`);
      try {
        return await work({
          kind: "transaction",
          query: async (sql) => {
            const text = normalizedSql(sql);
            if (text.includes("FROM session_album_photos photo")) {
              assert.equal(currentTransaction, 1);
              assert.match(text, /FOR UPDATE/i);
              events.push("locked-active-source-read");
              return [[]];
            }
            if (text.startsWith("INSERT INTO session_album_photos")) {
              assert.equal(currentTransaction, 2);
              events.push("insert");
              return [{ insertId: row.id }];
            }
            return [[row]];
          }
        });
      } finally {
        events.push(`transaction-${currentTransaction}-end`);
        transactionDepth -= 1;
      }
    }
  });

  assert.deepEqual(events, [
    "authorize:read-nonlocking",
    "inspect-outside-transaction",
    "transaction-1-begin",
    "authorize:transaction-locked",
    "locked-active-source-read",
    "transaction-1-end",
    "transaction-2-begin",
    "authorize:transaction-locked",
    "insert",
    "transaction-2-end"
  ]);
});

currentTestScope = "mini";

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

currentTestScope = "admin";

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

const selectedTests = requestedScope
  ? tests.filter((item) => item.scope === requestedScope)
  : tests;
let failed = 0;
for (const { name, run } of selectedTests) {
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
  const label = requestedScope ? ` ${requestedScope}` : " unit RED";
  console.error(`D42${label} checks failed: ${failed}/${selectedTests.length}`);
  process.exitCode = 1;
} else {
  const label = requestedScope ? ` ${requestedScope}` : " unit";
  console.log(`D42${label} checks passed: ${selectedTests.length}/${selectedTests.length}`);
}
