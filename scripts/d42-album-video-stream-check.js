import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import {
  finalizeLocalAlbumVideoUpload,
  parseMultipartAlbumVideoStream,
  uploadTempAlbumVideoToCos
} from "../apps/api/src/modules/album-video/multipart-stream.js";
import { putCosObject } from "../apps/api/src/storage/cos.js";

const MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d
]);

function chunksOf(buffer, size) {
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += size) {
    chunks.push(buffer.subarray(offset, Math.min(offset + size, buffer.length)));
  }
  return chunks;
}

function multipart(boundary, payload, options = {}) {
  const filename = options.filename ?? "video.mp4";
  const contentType = options.contentType === undefined ? "video/mp4" : options.contentType;
  const mimeHeader = contentType ? `Content-Type: ${contentType}\r\n` : "";
  const closing = options.truncated ? "" : `\r\n--${boundary}--\r\n`;
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${filename}"\r\n${mimeHeader}\r\n`
    ),
    payload,
    Buffer.from(closing)
  ]);
}

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "d42-multipart-stream-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function assertDirectoryEmpty(dir) {
  assert.deepEqual(await readdir(dir), []);
}

await withTempDir(async (tempDir) => {
  const boundary = "d42-boundary-abcdef";
  const rawBoundary = Buffer.from(`raw--${boundary}-inside`);
  const invalidDelimiter = Buffer.from(`\r\n--${boundary}Xstill-video`);
  const payload = Buffer.concat([
    MP4_HEADER,
    Buffer.alloc(2 * 1024 * 1024, 0x5a),
    rawBoundary,
    invalidDelimiter,
    Buffer.alloc(1024 * 1024, 0x33)
  ]);
  let maxPendingBytes = 0;
  const result = await parseMultipartAlbumVideoStream({
    request: Readable.from(chunksOf(multipart(boundary, payload), 997)),
    contentType: `multipart/form-data; boundary=${boundary}`,
    tempDir,
    onProgress(value) {
      maxPendingBytes = Math.max(maxPendingBytes, value.pendingBytes);
    }
  });
  assert.equal(result.byteSize, payload.length);
  assert.equal(result.contentType, "video/mp4");
  assert.equal(result.filename, "video.mp4");
  assert.deepEqual(await readFile(result.tempPath), payload);
  assert.ok(maxPendingBytes <= Buffer.byteLength(`\r\n--${boundary}`) + 2);
  await result.cleanup();
  await assertDirectoryEmpty(tempDir);
});
console.log("PASS multipart stream preserves multi-MB boundary-like video bytes with bounded tail state");

await withTempDir(async (tempDir) => {
  const boundary = "d42-cleanup-boundary";
  const cases = [
    {
      name: "truncated",
      body: multipart(boundary, MP4_HEADER, { truncated: true }),
      options: {}
    },
    {
      name: "bad header",
      body: multipart(boundary, Buffer.from("not-an-mp4")),
      options: {}
    },
    {
      name: "spoofed MIME",
      body: multipart(boundary, MP4_HEADER, { contentType: "text/plain" }),
      options: {}
    },
    {
      name: "spoofed extension",
      body: multipart(boundary, MP4_HEADER, { filename: "video.txt" }),
      options: {}
    },
    {
      name: "extra part",
      body: Buffer.concat([
        multipart(boundary, MP4_HEADER, { truncated: true }),
        Buffer.from(
          `\r\n--${boundary}\r\nContent-Disposition: form-data; name="extra"\r\n\r\nvalue\r\n--${boundary}--\r\n`
        )
      ]),
      options: {}
    },
    {
      name: "non-video part",
      body: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="video.mp4"\r\nContent-Type: video/mp4\r\n\r\n`
        ),
        MP4_HEADER,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ]),
      options: {}
    },
    {
      name: "oversize",
      body: multipart(boundary, Buffer.concat([MP4_HEADER, Buffer.alloc(2048)])),
      options: { maxFileBytes: 1024, maxRequestBytes: 4096 }
    },
    {
      name: "oversize part header",
      body: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="video.mp4"\r\nX-Padding: ${"x".repeat(2048)}\r\n\r\n`
        ),
        MP4_HEADER,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ]),
      options: { maxHeaderBytes: 1024 }
    }
  ];
  for (const testCase of cases) {
    await assert.rejects(
      parseMultipartAlbumVideoStream({
        request: Readable.from(chunksOf(testCase.body, 31)),
        contentType: `multipart/form-data; boundary=${boundary}`,
        tempDir,
        ...testCase.options
      }),
      undefined,
      testCase.name
    );
    await assertDirectoryEmpty(tempDir);
  }
});
console.log("PASS multipart stream rejects spoofing/extra parts and cleans every failed temp file");

await withTempDir(async (tempDir) => {
  const tempPath = path.join(tempDir, "pending.tmp");
  const destinationPath = path.join(tempDir, "video.mp4");
  await writeFile(tempPath, MP4_HEADER);
  await writeFile(destinationPath, Buffer.from("original"));
  await assert.rejects(
    finalizeLocalAlbumVideoUpload({ tempPath, destinationPath }),
    (error) => error.code === "EEXIST"
  );
  assert.equal((await readFile(destinationPath)).toString(), "original");
  assert.deepEqual(await readdir(tempDir), ["video.mp4"]);
});
console.log("PASS local multipart finalization is atomic no-overwrite and cleans collision temp files");

await withTempDir(async (tempDir) => {
  const tempPath = path.join(tempDir, "pending.tmp");
  await writeFile(tempPath, MP4_HEADER);
  let observed = null;
  await uploadTempAlbumVideoToCos({
    tempPath,
    key: "uploads/session-album/videos/source/video.mp4",
    byteSize: MP4_HEADER.length,
    contentType: "video/mp4",
    config: { bucket: "test", region: "test", secretId: "id", secretKey: "key" },
    putObject: async (options) => {
      observed = options;
      assert.ok(options.body instanceof Readable);
      const bytes = [];
      for await (const chunk of options.body) bytes.push(Buffer.from(chunk));
      assert.deepEqual(Buffer.concat(bytes), MP4_HEADER);
    },
    createStream: createReadStream
  });
  assert.equal(observed.contentLength, MP4_HEADER.length);
  assert.equal(observed.forbidOverwrite, true);
  await assertDirectoryEmpty(tempDir);
});
console.log("PASS COS multipart finalization streams exact length with no-overwrite and cleans temp files");

await withTempDir(async (tempDir) => {
  const tempPath = path.join(tempDir, "stream-body.tmp");
  await writeFile(tempPath, MP4_HEADER);
  const calls = [];
  const request = (options, onResponse) => {
    const chunks = [];
    const pending = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
      final(callback) {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.headers = {};
        response.destroy = () => {};
        onResponse(response);
        queueMicrotask(() => response.emit("end"));
        callback();
      }
    });
    calls.push({ options, chunks });
    return pending;
  };
  await putCosObject({
    key: "uploads/session-album/videos/source/video.mp4",
    body: createReadStream(tempPath),
    contentLength: MP4_HEADER.length,
    contentType: "video/mp4",
    forbidOverwrite: true,
    config: { bucket: "test", region: "test", secretId: "id", secretKey: "key" },
    request
  });
  assert.deepEqual(Buffer.concat(calls[0].chunks), MP4_HEADER);
  assert.equal(calls[0].options.headers["content-length"], String(MP4_HEADER.length));
  assert.equal(calls[0].options.headers["x-cos-forbid-overwrite"], "true");
});
console.log("PASS COS request pipes Readable bodies with an explicit signed content length");

console.log("D42 album video stream checks passed: 5/5");
