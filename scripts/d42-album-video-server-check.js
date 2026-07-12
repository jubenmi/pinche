import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { readFile } from "node:fs/promises";

import {
  createSessionAlbumVideoStorageAdapter,
  normalizeError,
  sanitizeCosDirectUploadHeaders,
  serveUploadedSessionAlbumVideoFile,
  validateAlbumVideoCosUploadHeaders
} from "../apps/api/src/server.js";
import {
  inspectSessionAlbumVideoObject
} from "../apps/api/src/modules/album-video/media.js";
import {
  buildCosAuthorization,
  headCosObject,
  putCosObject,
  readCosObjectRange
} from "../apps/api/src/storage/cos.js";

const COS_CONFIG = {
  enabled: true,
  secretId: "d42-secret-id",
  secretKey: "d42-secret-key",
  bucket: "d42-bucket",
  region: "ap-guangzhou"
};
const SOURCE_URL =
  "/uploads/session-album/videos/source/admin-video-42-7-1720000000000-0123456789abcdef.mp4";
const VIDEO_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d,
  0x00, 0x00, 0x00, 0x00,
  0x69, 0x73, 0x6f, 0x6d
]);

const checks = [];
function check(name, run) {
  checks.push({ name, run });
}

function fakeCosRequest(response = {}) {
  const calls = [];
  const request = (options, onResponse) => {
    const pending = new EventEmitter();
    calls.push({ options, chunks: [] });
    pending.write = (chunk) => calls.at(-1).chunks.push(Buffer.from(chunk));
    pending.destroy = () => {};
    pending.end = () => {
      queueMicrotask(() => {
        const incoming = new EventEmitter();
        incoming.statusCode = response.statusCode || 200;
        incoming.headers = response.headers || {};
        incoming.destroy = () => {};
        onResponse(incoming);
        queueMicrotask(() => {
          if (response.body) incoming.emit("data", response.body);
          incoming.emit("end");
        });
      });
    };
    return pending;
  };
  return { calls, request };
}

class MemoryResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 0;
    this.headers = {};
    this.chunks = [];
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
    return this;
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  get body() {
    return Buffer.concat(this.chunks);
  }
}

check("video create route wires an inspector before the service create call", async () => {
  const server = await readFile(new URL("../apps/api/src/server.js", import.meta.url), "utf8");
  const start = server.indexOf("const adminSessionAlbumVideosId");
  const end = server.indexOf("const sessionAlbumPhotoId", start);
  const route = server.slice(start, end);
  const inspectIndex = route.indexOf("inspectSessionAlbumVideoObject");
  const createIndex = route.indexOf("const video = await createSessionAlbumVideo");
  assert.ok(inspectIndex >= 0 && inspectIndex < createIndex);
  assert.match(route, /createSessionAlbumVideo[\s\S]*inspectObject/);
});

check("local inspection opens once, fstats and reads exactly 12 bytes from the same handle", async () => {
  const events = [];
  const handle = {
    stat: async () => {
      events.push("stat");
      return { isFile: () => true, size: VIDEO_BYTES.length };
    },
    read: async (target, offset, length, position) => {
      events.push(`read:${offset}:${length}:${position}`);
      VIDEO_BYTES.copy(target, offset, 0, length);
      return { bytesRead: length, buffer: target };
    },
    close: async () => events.push("close")
  };
  let openCalls = 0;
  const adapter = createSessionAlbumVideoStorageAdapter({
    cosEnabled: false,
    sourceDir: "/tmp/d42-source",
    openFile: async (filePath, flags) => {
      openCalls += 1;
      assert.equal(flags, "r");
      assert.equal(path.basename(filePath), path.basename(SOURCE_URL));
      return handle;
    }
  });
  const result = await inspectSessionAlbumVideoObject({ sourceUrl: SOURCE_URL, storageAdapter: adapter });
  assert.deepEqual(result, { byteSize: VIDEO_BYTES.length, contentType: "video/mp4" });
  assert.equal(openCalls, 1);
  assert.deepEqual(events, ["stat", "read:0:12:0", "close"]);
});

check("COS inspection binds the 12-byte Range read to the authoritative HEAD ETag", async () => {
  const calls = [];
  const adapter = createSessionAlbumVideoStorageAdapter({
    cosEnabled: true,
    cosConfig: COS_CONFIG,
    headObject: async (options) => {
      calls.push({ operation: "HEAD", ...options });
      return {
        headers: {
          "content-length": String(VIDEO_BYTES.length),
          "content-type": "video/mp4",
          etag: '"d42-object-version"'
        }
      };
    },
    readObjectRange: async (options) => {
      calls.push({ operation: "RANGE", ...options });
      return VIDEO_BYTES.subarray(0, 12);
    }
  });
  const result = await inspectSessionAlbumVideoObject({ sourceUrl: SOURCE_URL, storageAdapter: adapter });
  assert.deepEqual(result, { byteSize: VIDEO_BYTES.length, contentType: "video/mp4" });
  assert.equal(calls[0].operation, "HEAD");
  assert.deepEqual(
    {
      operation: calls[1].operation,
      start: calls[1].start,
      end: calls[1].end,
      ifMatch: calls[1].ifMatch,
      expectedByteSize: calls[1].expectedByteSize
    },
    {
      operation: "RANGE",
      start: 0,
      end: 11,
      ifMatch: '"d42-object-version"',
      expectedByteSize: VIDEO_BYTES.length
    }
  );
});

check("COS inspection fails safe without ETag and preserves HEAD failures", async () => {
  let rangeCalls = 0;
  const withoutEtag = createSessionAlbumVideoStorageAdapter({
    cosEnabled: true,
    cosConfig: COS_CONFIG,
    headObject: async () => ({
      headers: { "content-length": String(VIDEO_BYTES.length), "content-type": "video/mp4" }
    }),
    readObjectRange: async () => {
      rangeCalls += 1;
      return VIDEO_BYTES.subarray(0, 12);
    }
  });
  await assert.rejects(
    inspectSessionAlbumVideoObject({ sourceUrl: SOURCE_URL, storageAdapter: withoutEtag }),
    (error) => error.statusCode === 502 && error.code === "COS_OBJECT_VERSION_MISSING"
  );
  assert.equal(rangeCalls, 0);

  const missing = Object.assign(new Error("missing"), { statusCode: 404 });
  const missingAdapter = createSessionAlbumVideoStorageAdapter({
    cosEnabled: true,
    cosConfig: COS_CONFIG,
    headObject: async () => { throw missing; },
    readObjectRange: async () => { throw new Error("must not read"); }
  });
  await assert.rejects(
    inspectSessionAlbumVideoObject({ sourceUrl: SOURCE_URL, storageAdapter: missingAdapter }),
    (error) => error === missing
  );
});

check("COS video header validation requires no-overwrite and validates every visible fact", () => {
  assert.deepEqual(
    validateAlbumVideoCosUploadHeaders({ "x-cos-forbid-overwrite": "true" }),
    { "x-cos-forbid-overwrite": "true" }
  );
  assert.deepEqual(
    validateAlbumVideoCosUploadHeaders({
      "X-COS-Forbid-Overwrite": "true",
      "Content-Length": String(VIDEO_BYTES.length),
      "Content-Type": "video/mp4"
    }),
    {
      "x-cos-forbid-overwrite": "true",
      "content-length": String(VIDEO_BYTES.length),
      "content-type": "video/mp4"
    }
  );
  assert.throws(() => validateAlbumVideoCosUploadHeaders({}), /forbid object overwrite/);
  assert.throws(
    () => validateAlbumVideoCosUploadHeaders({
      "x-cos-forbid-overwrite": "true",
      "content-type": "text/plain"
    }),
    /content type must be video\/mp4/
  );
});

check("COS signing headers are kind-whitelisted and force the configured host", () => {
  const headers = sanitizeCosDirectUploadHeaders({
    directUpload: { kind: "adminSessionAlbumVideo" },
    key: "uploads/session-album/videos/source/test.mp4",
    headers: {
      host: "evil.example.com",
      "content-length": String(VIDEO_BYTES.length),
      "content-type": "video/mp4",
      "x-cos-forbid-overwrite": "true"
    },
    cosConfig: COS_CONFIG
  });
  assert.equal(headers.host, "d42-bucket.cos.ap-guangzhou.myqcloud.com");
  const authorization = buildCosAuthorization({
    method: "PUT",
    key: "uploads/session-album/videos/source/test.mp4",
    headers,
    config: COS_CONFIG
  });
  assert.match(authorization, /q-header-list=content-length;content-type;host;x-cos-forbid-overwrite/);
  for (const [name, value] of [
    ["x-cos-acl", "public-read"],
    ["x-cos-storage-class", "ARCHIVE"],
    ["x-cos-meta-owner", "attacker"],
    ["x-cos-server-side-encryption", "AES256"],
    ["content-md5", "unneeded-and-unsigned"]
  ]) {
    assert.throws(
      () => sanitizeCosDirectUploadHeaders({
        directUpload: { kind: "adminSessionAlbumVideo" },
        key: "uploads/session-album/videos/source/test.mp4",
        headers: {
          "content-type": "video/mp4",
          "x-cos-forbid-overwrite": "true",
          [name]: value
        },
        cosConfig: COS_CONFIG
      }),
      /unsupported COS upload header/
    );
  }
});

check("server only preserves trusted sanitized COS 404/502/504 errors", async () => {
  const missing = fakeCosRequest({ statusCode: 404, body: Buffer.from("secret upstream body") });
  const missingError = await headCosObject({
    key: "uploads/session-album/videos/source/missing.mp4",
    config: COS_CONFIG,
    request: missing.request
  }).then(() => null, (error) => error);
  const normalizedMissing = normalizeError(missingError);
  assert.equal(normalizedMissing.statusCode, 404);
  assert.equal(normalizedMissing.code, "COS_OBJECT_NOT_FOUND");
  assert.doesNotMatch(normalizedMissing.message, /secret|upstream body/i);
  assert.equal(normalizedMissing.details, undefined);

  const precondition = fakeCosRequest({ statusCode: 412, body: Buffer.from("etag mismatch") });
  const preconditionError = await headCosObject({
    key: "uploads/session-album/videos/source/changed.mp4",
    config: COS_CONFIG,
    request: precondition.request
  }).then(() => null, (error) => error);
  const normalizedPrecondition = normalizeError(preconditionError);
  assert.equal(normalizedPrecondition.statusCode, 412);
  assert.equal(normalizedPrecondition.code, "COS_PRECONDITION_FAILED");

  const networkError = await headCosObject({
    key: "uploads/session-album/videos/source/network.mp4",
    config: COS_CONFIG,
    request: () => { throw new Error("connect ECONNREFUSED secret-host"); }
  }).then(() => null, (error) => error);
  const normalizedNetwork = normalizeError(networkError);
  assert.equal(normalizedNetwork.statusCode, 502);
  assert.equal(normalizedNetwork.code, "COS_NETWORK_ERROR");
  assert.doesNotMatch(normalizedNetwork.message, /secret-host/);

  const timeoutRequest = () => {
    const pending = new EventEmitter();
    pending.destroy = () => {};
    pending.end = () => {};
    return pending;
  };
  const timeoutError = await headCosObject({
    key: "uploads/session-album/videos/source/timeout.mp4",
    config: COS_CONFIG,
    request: timeoutRequest,
    setTimeoutFn(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearTimeoutFn() {}
  }).then(() => null, (error) => error);
  const normalizedTimeout = normalizeError(timeoutError);
  assert.equal(normalizedTimeout.statusCode, 504);
  assert.equal(normalizedTimeout.code, "COS_REQUEST_TIMEOUT");

  const forged = normalizeError(Object.assign(new Error("leak me"), {
    statusCode: 404,
    code: "COS_OBJECT_NOT_FOUND",
    isCosStorageError: true
  }));
  assert.equal(forged.statusCode, 500);
  assert.equal(forged.code, "INTERNAL_ERROR");
});

check("server-side COS fallback signs and sends the exact no-overwrite header", async () => {
  const fake = fakeCosRequest();
  await putCosObject({
    key: "uploads/session-album/videos/source/test.mp4",
    body: VIDEO_BYTES,
    contentType: "video/mp4",
    forbidOverwrite: true,
    config: COS_CONFIG,
    request: fake.request
  });
  assert.equal(fake.calls.length, 1);
  const headers = fake.calls[0].options.headers;
  assert.equal(headers["x-cos-forbid-overwrite"], "true");
  assert.match(headers.authorization, /q-header-list=[^&]*x-cos-forbid-overwrite/);
});

check("COS range helper signs the HEAD ETag as an If-Match precondition", async () => {
  const fake = fakeCosRequest({
    statusCode: 206,
    headers: {
      "content-length": "12",
      "content-range": `bytes 0-11/${VIDEO_BYTES.length}`
    },
    body: VIDEO_BYTES.subarray(0, 12)
  });
  await readCosObjectRange({
    key: "uploads/session-album/videos/source/test.mp4",
    start: 0,
    end: 11,
    ifMatch: '"d42-object-version"',
    expectedByteSize: VIDEO_BYTES.length,
    config: COS_CONFIG,
    request: fake.request
  });
  const headers = fake.calls[0].options.headers;
  assert.equal(headers["if-match"], '"d42-object-version"');
  assert.equal(headers.range, "bytes=0-11");
  assert.match(headers.authorization, /q-header-list=[^&]*if-match/);
});

check("local server playback returns real HEAD, 200, 206, 416 and 404 responses", async () => {
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), "d42-video-server-"));
  try {
    await writeFile(path.join(sourceDir, path.basename(SOURCE_URL)), VIDEO_BYTES);
    const media = { source_url: SOURCE_URL };

    const head = new MemoryResponse();
    await serveUploadedSessionAlbumVideoFile(media, head, {
      method: "HEAD",
      cosEnabled: false,
      sourceDir
    });
    assert.equal(head.statusCode, 200);
    assert.equal(head.headers["content-length"], VIDEO_BYTES.length);
    assert.equal(head.headers["accept-ranges"], "bytes");
    assert.equal(head.headers["cache-control"], "private, no-store");
    assert.equal(head.body.length, 0);

    const get = new MemoryResponse();
    await serveUploadedSessionAlbumVideoFile(media, get, {
      method: "GET",
      cosEnabled: false,
      sourceDir
    });
    assert.equal(get.statusCode, 200);
    assert.deepEqual(get.body, VIDEO_BYTES);

    const ranged = new MemoryResponse();
    await serveUploadedSessionAlbumVideoFile(media, ranged, {
      method: "GET",
      range: "bytes=4-11",
      cosEnabled: false,
      sourceDir
    });
    assert.equal(ranged.statusCode, 206);
    assert.equal(ranged.headers["content-range"], `bytes 4-11/${VIDEO_BYTES.length}`);
    assert.deepEqual(ranged.body, VIDEO_BYTES.subarray(4, 12));

    const invalid = new MemoryResponse();
    await serveUploadedSessionAlbumVideoFile(media, invalid, {
      method: "GET",
      range: "bytes=999-1000",
      cosEnabled: false,
      sourceDir
    });
    assert.equal(invalid.statusCode, 416);
    assert.equal(invalid.headers["content-range"], `bytes */${VIDEO_BYTES.length}`);

    await assert.rejects(
      serveUploadedSessionAlbumVideoFile(
        { source_url: SOURCE_URL.replace(".mp4", "-missing.mp4") },
        new MemoryResponse(),
        { method: "GET", cosEnabled: false, sourceDir }
      ),
      (error) => error.statusCode === 404
    );
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
  }
});

check("COS video redirect does not bind playback authorization to the first byte range", async () => {
  const media = {
    source_url: SOURCE_URL,
    display_url: "",
    video_content_type: "video/mp4"
  };
  const redirects = [];
  for (const range of ["bytes=0-1023", "bytes=1024-2047"]) {
    const response = new MemoryResponse();
    await serveUploadedSessionAlbumVideoFile(media, response, {
      cosEnabled: true,
      method: "GET",
      range
    });
    assert.equal(response.statusCode, 302);
    redirects.push(new URL(response.headers.location));
  }
  for (const redirect of redirects) {
    assert.equal(redirect.searchParams.get("q-header-list"), "host");
  }
  assert.equal(redirects[0].pathname, redirects[1].pathname);
});

check("COS video HEAD stays on the authenticated API URL before GET playback", async () => {
  const response = new MemoryResponse();
  const headCalls = [];
  await serveUploadedSessionAlbumVideoFile({ source_url: SOURCE_URL }, response, {
    cosEnabled: true,
    method: "HEAD",
    headObject: async (options) => {
      headCalls.push(options);
      return {
        headers: {
          "content-length": String(VIDEO_BYTES.length),
          "content-type": "video/mp4"
        }
      };
    }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.location, undefined);
  assert.equal(response.headers["content-length"], VIDEO_BYTES.length);
  assert.equal(response.headers["content-type"], "video/mp4");
  assert.equal(response.headers["accept-ranges"], "bytes");
  assert.equal(response.body.length, 0);
  assert.equal(headCalls.length, 1);
});

check("production video fallback is streamed and immutable", async () => {
  const server = await readFile(new URL("../apps/api/src/server.js", import.meta.url), "utf8");
  assert.match(server, /headers:\s*\{\s*"x-cos-forbid-overwrite":\s*"true"\s*\}/);
  const fallback = server.slice(
    server.indexOf("async function saveUploadedSessionAlbumVideo"),
    server.indexOf("function sessionAlbumMediaSignature")
  );
  const multipartStream = await readFile(
    new URL("../apps/api/src/modules/album-video/multipart-stream.js", import.meta.url),
    "utf8"
  );
  assert.match(fallback, /uploadTempAlbumVideoToCos/);
  assert.match(fallback, /parseMultipartAlbumVideoStream/);
  assert.doesNotMatch(fallback, /readRawBody|Buffer\.concat/);
  assert.match(multipartStream, /forbidOverwrite:\s*true/);
});

check("server never emits local snapshot URLs", async () => {
  const server = await readFile(new URL("../apps/api/src/server.js", import.meta.url), "utf8");
  const snapshots = server.slice(
    server.indexOf("function signedAlbumVideoSnapshotUrl"),
    server.indexOf("function stripAlbumVideoInternalFields")
  );
  assert.doesNotMatch(snapshots, /sessionAlbum(?:Public)?Video(?:Cover|File)Path/);
  assert.equal((snapshots.match(/if \(!isCosUploadStorageEnabled\(\)\)/g) || []).length, 2);
});

let passed = 0;
for (const { name, run } of checks) {
  try {
    await run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

if (passed !== checks.length) {
  console.error(`D42 api-server checks failed: ${passed}/${checks.length}`);
  process.exitCode = 1;
} else {
  console.log(`D42 api-server checks passed: ${passed}/${checks.length}`);
}
