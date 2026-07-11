function cleanEtag(value) {
  return String(value || "").replace(/^\"|\"$/g, "");
}

function processing(etag = "") {
  return {
    validationState: "processing",
    objectPresent: true,
    etag,
    canFinalize: false
  };
}

export async function validateStoredAlbumImage({ intent, storage }) {
  let before;
  try {
    before = await storage.head(intent.object_key);
  } catch (error) {
    if (error?.code === "COS_OBJECT_NOT_FOUND") {
      return {
        validationState: "missing",
        objectPresent: false,
        etag: "",
        canFinalize: false
      };
    }
    throw error;
  }

  const beforeEtag = cleanEtag(before.etag);
  let info;
  try {
    info = await storage.imageInfo({ key: intent.object_key, etag: beforeEtag });
  } catch (error) {
    if (["COS_OBJECT_NOT_FOUND", "COS_PRECONDITION_FAILED"].includes(error?.code)) {
      return processing(beforeEtag);
    }
    throw error;
  }

  const after = await storage.head(intent.object_key);
  const afterEtag = cleanEtag(after.etag);
  if (!beforeEtag || beforeEtag !== afterEtag) return processing(afterEtag);

  const format = String(info.format || "").toLowerCase();
  const contentType = String(after.contentType || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const byteSize = Number(after.byteSize || 0);
  const width = Number(info.width || 0);
  const height = Number(info.height || 0);
  if (
    !["jpg", "jpeg"].includes(format) ||
    contentType !== "image/jpeg" ||
    !Number.isSafeInteger(byteSize) || byteSize <= 0 ||
    !Number.isSafeInteger(width) || width <= 0 || width > 2048 ||
    !Number.isSafeInteger(height) || height <= 0 || height > 2048
  ) {
    return {
      validationState: "invalid",
      objectPresent: true,
      etag: afterEtag,
      canFinalize: false,
      errorCode: "COS_IMAGE_PROCESSING_INVALID"
    };
  }

  return {
    validationState: "ready",
    objectPresent: true,
    etag: afterEtag,
    contentType,
    byteSize,
    width,
    height,
    canFinalize: true
  };
}
