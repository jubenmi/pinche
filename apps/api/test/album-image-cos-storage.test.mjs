import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  getCosImageInfo,
  isTrustedCosStorageError,
  listCosObjects,
  parseCosListObjectsResponse,
  putCosObject
} from "../src/storage/cos.js";

const config = {
  secretId: "id",
  secretKey: "secret",
  bucket: "pinche-app-1251022382",
  region: "ap-nanjing"
};

function createSequencedRequest(responses) {
  const calls = [];
  const request = (options, onResponse) => {
    const call = { options, writes: [] };
    calls.push(call);
    const pending = new EventEmitter();
    pending.write = (chunk) => call.writes.push(Buffer.from(chunk));
    pending.destroy = () => {};
    pending.end = () => queueMicrotask(() => {
      const fixture = responses[calls.length - 1];
      const response = new EventEmitter();
      response.statusCode = fixture.statusCode;
      response.headers = fixture.headers || {};
      response.destroy = () => {};
      onResponse(response);
      if (fixture.body) response.emit("data", Buffer.from(fixture.body));
      response.emit("end");
    });
    return pending;
  };
  return { calls, request };
}

test("ImageInfo uses a signed valueless query and conditional header", async () => {
  const fake = createSequencedRequest([{
    statusCode: 200,
    headers: { etag: '"stored-etag"', "content-length": "62" },
    body: JSON.stringify({ format: "JPEG", width: 1200, height: 800, size: 12345 })
  }]);

  const info = await getCosImageInfo({
    key: "uploads/session-album/display/photo.jpg",
    etag: '"expected-etag"',
    config,
    request: fake.request
  });

  assert.deepEqual(info, {
    format: "jpeg",
    width: 1200,
    height: 800,
    byteSize: 12345,
    etag: "stored-etag"
  });
  assert.equal(fake.calls[0].options.method, "GET");
  assert.equal(
    fake.calls[0].options.path,
    "/uploads/session-album/display/photo.jpg?imageInfo"
  );
  assert.equal(fake.calls[0].options.headers["if-match"], '"expected-etag"');
  assert.match(fake.calls[0].options.headers.authorization, /q-header-list=[^&]*if-match/);
  assert.match(fake.calls[0].options.headers.authorization, /q-url-param-list=imageinfo/);
});

test("unsupported conditional ImageInfo retries once without If-Match", async () => {
  const validBody = JSON.stringify({ format: "jpg", width: 1, height: 2, size: 3 });
  const fake = createSequencedRequest([
    { statusCode: 405, headers: { "content-length": "0" } },
    { statusCode: 200, headers: { "content-length": String(Buffer.byteLength(validBody)) }, body: validBody }
  ]);

  const info = await getCosImageInfo({
    key: "uploads/session-album/display/photo.jpg",
    etag: "etag",
    config,
    request: fake.request
  });

  assert.equal(info.width, 1);
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[0].options.headers["if-match"], "etag");
  assert.equal(fake.calls[1].options.headers["if-match"], undefined);
  assert.equal(fake.calls[1].options.path.endsWith("?imageInfo"), true);
});

test("COS List Objects decodes a bounded session-album page and advances with NextMarker", async () => {
  const body = [
    "<ListBucketResult>",
    "<IsTruncated>true</IsTruncated>",
    "<NextMarker>uploads%2Fsession-album%2Fdisplay%2Fb.jpg</NextMarker>",
    "<Contents><Key>uploads%2Fsession-album%2Fdisplay%2Fa.jpg</Key><LastModified>2026-07-10T00:00:00.000Z</LastModified><Size>12</Size></Contents>",
    "<Contents><Key>uploads%2Fsession-album%2Fdisplay%2Fb.jpg</Key><LastModified>2026-07-11T00:00:00.000Z</LastModified><Size>13</Size></Contents>",
    "</ListBucketResult>"
  ].join("");
  const fake = createSequencedRequest([{
    statusCode: 200,
    headers: { "content-length": String(Buffer.byteLength(body)) },
    body
  }]);

  const listed = await listCosObjects({
    prefix: "uploads/session-album/",
    marker: "uploads/session-album/display/a.jpg",
    maxKeys: 2,
    config,
    request: fake.request
  });

  assert.deepEqual(listed, {
    objects: [
      {
        key: "uploads/session-album/display/a.jpg",
        lastModified: "2026-07-10T00:00:00.000Z",
        byteSize: 12
      },
      {
        key: "uploads/session-album/display/b.jpg",
        lastModified: "2026-07-11T00:00:00.000Z",
        byteSize: 13
      }
    ],
    nextMarker: "uploads/session-album/display/b.jpg"
  });
  assert.equal(fake.calls[0].options.path.includes("prefix=uploads%2Fsession-album%2F"), true);
  assert.equal(fake.calls[0].options.path.includes("marker=uploads%2Fsession-album%2Fdisplay%2Fa.jpg"), true);
  assert.equal(fake.calls[0].options.path.includes("max-keys=2"), true);
  assert.match(fake.calls[0].options.headers.authorization, /q-url-param-list=encoding-type;marker;max-keys;prefix/);
});

test("COS List Objects rejects malformed pages and keys that escape the requested prefix", () => {
  assert.throws(() => parseCosListObjectsResponse(Buffer.from("<not-xml>"), {
    prefix: "uploads/session-album/"
  }), { code: "COS_INVALID_LIST_RESPONSE" });
  assert.throws(() => parseCosListObjectsResponse(Buffer.from([
    "<ListBucketResult><IsTruncated>false</IsTruncated>",
    "<Contents><Key>uploads%2Favatars%2Fnot-album.jpg</Key><LastModified>2026-07-10T00:00:00.000Z</LastModified><Size>1</Size></Contents>",
    "</ListBucketResult>"
  ].join("")), {
    prefix: "uploads/session-album/"
  }), { code: "COS_INVALID_LIST_RESPONSE" });
});

for (const statusCode of [409, 412]) {
  test(`COS ${statusCode} maps to a trusted overwrite conflict`, async () => {
    const fake = createSequencedRequest([{ statusCode, headers: { "content-length": "0" } }]);
    await assert.rejects(
      putCosObject({ key: "key", body: Buffer.alloc(0), config, request: fake.request }),
      (error) => {
        assert.equal(error.code, "COS_PRECONDITION_FAILED");
        assert.equal(error.statusCode, 412);
        assert.equal(error.upstreamStatusCode, statusCode);
        assert.equal(Object.keys(error).includes("upstreamStatusCode"), false);
        assert.equal(isTrustedCosStorageError(error), true);
        return true;
      }
    );
  });
}
