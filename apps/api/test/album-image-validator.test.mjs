import assert from "node:assert/strict";
import test from "node:test";

import { validateStoredAlbumImage } from "../src/modules/album-image/validator.js";

test("validator uses HEAD, ImageInfo, HEAD and accepts PNG source to JPEG output", async () => {
  const calls = [];
  const result = await validateStoredAlbumImage({
    intent: {
      object_key: "uploads/session-album/display/a.jpg",
      source_content_type: "image/png",
      source_byte_size: 3456
    },
    storage: {
      head: async () => {
        calls.push("HEAD");
        return { etag: "etag-1", byteSize: 1234, contentType: "image/jpeg" };
      },
      imageInfo: async ({ etag }) => {
        calls.push(["ImageInfo", etag]);
        return { format: "jpg", width: 1600, height: 1200, byteSize: 1234 };
      },
      getObject: async () => assert.fail("validator must not read object bytes")
    }
  });
  assert.deepEqual(calls, ["HEAD", ["ImageInfo", "etag-1"], "HEAD"]);
  assert.deepEqual(result, {
    validationState: "ready",
    objectPresent: true,
    etag: "etag-1",
    contentType: "image/jpeg",
    byteSize: 1234,
    width: 1600,
    height: 1200,
    canFinalize: true
  });
});

test("changed ETag remains processing", async () => {
  let headCount = 0;
  const result = await validateStoredAlbumImage({
    intent: { object_key: "uploads/session-album/display/a.jpg" },
    storage: {
      head: async () => ({
        etag: `etag-${++headCount}`,
        byteSize: 100,
        contentType: "image/jpeg"
      }),
      imageInfo: async () => ({ format: "jpg", width: 10, height: 10, byteSize: 100 })
    }
  });
  assert.equal(result.validationState, "processing");
  assert.equal(result.canFinalize, false);
  assert.equal(result.etag, "etag-2");
});

for (const code of ["COS_OBJECT_NOT_FOUND", "COS_PRECONDITION_FAILED"]) {
  test(`${code} during ImageInfo remains processing`, async () => {
    const result = await validateStoredAlbumImage({
      intent: { object_key: "a" },
      storage: {
        head: async () => ({ etag: '"same"', byteSize: 100, contentType: "image/jpeg" }),
        imageInfo: async () => { throw Object.assign(new Error(code), { code }); }
      }
    });
    assert.deepEqual(result, {
      validationState: "processing",
      objectPresent: true,
      etag: "same",
      canFinalize: false
    });
  });
}

test("trusted missing first HEAD reports missing", async () => {
  const result = await validateStoredAlbumImage({
    intent: { object_key: "a" },
    storage: {
      head: async () => {
        throw Object.assign(new Error("missing"), { code: "COS_OBJECT_NOT_FOUND" });
      },
      imageInfo: async () => assert.fail("ImageInfo must not run for a missing object")
    }
  });
  assert.deepEqual(result, {
    validationState: "missing",
    objectPresent: false,
    etag: "",
    canFinalize: false
  });
});

for (const invalid of [
  { format: "png", contentType: "image/png", width: 10, height: 10, byteSize: 100 },
  { format: "jpg", contentType: "image/jpeg", width: 0, height: 10, byteSize: 100 },
  { format: "jpg", contentType: "image/jpeg", width: 2049, height: 10, byteSize: 100 },
  { format: "jpg", contentType: "image/jpeg", width: 10, height: 0, byteSize: 100 },
  { format: "jpg", contentType: "image/jpeg", width: 10, height: 2049, byteSize: 100 },
  { format: "jpg", contentType: "image/jpeg", width: 10, height: 10, byteSize: 0 }
]) {
  test(`invalid processed image facts are rejected: ${JSON.stringify(invalid)}`, async () => {
    const storage = {
      head: async () => ({
        etag: "same",
        byteSize: invalid.byteSize,
        contentType: invalid.contentType
      }),
      imageInfo: async () => ({
        format: invalid.format,
        width: invalid.width,
        height: invalid.height,
        byteSize: invalid.byteSize
      })
    };
    const result = await validateStoredAlbumImage({ intent: { object_key: "a" }, storage });
    assert.equal(result.validationState, "invalid");
    assert.equal(result.errorCode, "COS_IMAGE_PROCESSING_INVALID");
  });
}
