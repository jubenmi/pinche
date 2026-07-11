const SOURCE_URL_UNIQUE_INDEX = "uniq_session_album_video_source_url";

function identifiesSourceUrlUniqueIndex(value) {
  const text = String(value || "");
  if (text === SOURCE_URL_UNIQUE_INDEX) {
    return true;
  }
  return new RegExp(
    `(?:^|[.'\u0060])${SOURCE_URL_UNIQUE_INDEX}(?:['\u0060]|$)`
  ).test(text);
}

function isSourceUrlDuplicateKeyError(error) {
  return error?.code === "ER_DUP_ENTRY" && [
    error?.constraint,
    error?.key,
    error?.sqlMessage
  ].some(identifiesSourceUrlUniqueIndex);
}

function duplicateWinnerMissingError(sourceUrl) {
  const error = new Error(
    `Album video source_url conflict was reported but no existing video was found: ${sourceUrl}`
  );
  error.code = "ALBUM_VIDEO_DUPLICATE_WINNER_MISSING";
  error.statusCode = 409;
  return error;
}

export async function createIdempotentAlbumVideo({
  sourceUrl,
  findExisting,
  insert,
  findAfterDuplicateOnFreshConnection
}) {
  if (
    typeof findAfterDuplicateOnFreshConnection !== "function" ||
    findAfterDuplicateOnFreshConnection === findExisting
  ) {
    throw new TypeError(
      "findAfterDuplicateOnFreshConnection must be a distinct fresh-connection current read"
    );
  }

  const existing = await findExisting(sourceUrl);
  if (existing) {
    return existing;
  }

  try {
    return await insert(sourceUrl);
  } catch (error) {
    if (!isSourceUrlDuplicateKeyError(error)) {
      throw error;
    }

    // The insert adapter must reject only after rolling back its transaction;
    // this callback then opens a new connection/current read so MySQL
    // REPEATABLE READ cannot hide the concurrent winner.
    const winner = await findAfterDuplicateOnFreshConnection(sourceUrl, error);
    if (!winner) {
      throw duplicateWinnerMissingError(sourceUrl);
    }
    return winner;
  }
}

function deleteSnapshotChangedError(result) {
  const reason = result && typeof result === "object" ? result.reason : null;
  const error = new Error(
    reason
      ? `Album video changed during object cleanup: ${reason}`
      : "Album video changed during object cleanup"
  );
  error.code = "ALBUM_VIDEO_DELETE_SNAPSHOT_CHANGED";
  error.statusCode = 409;
  error.details = { finalizeResult: result ?? null };
  return error;
}

function isObjectMissingError(error) {
  return Number(error?.statusCode || error?.status || error?.httpStatus) === 404;
}

export async function cleanupAlbumVideoBeforeDelete({
  urls,
  deleteObject,
  finalizeSnapshot,
  finalize
}) {
  const uniqueUrls = [];
  const seen = new Set();
  for (const url of urls || []) {
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    uniqueUrls.push(url);
  }

  const expectedUrls = Object.freeze([...uniqueUrls]);
  for (const url of expectedUrls) {
    try {
      await deleteObject(url);
    } catch (error) {
      if (!isObjectMissingError(error)) {
        throw error;
      }
    }
  }

  const finalizeWithSnapshot = finalizeSnapshot || finalize;
  const result = await finalizeWithSnapshot(expectedUrls);
  if (!result || typeof result !== "object" || result.deleted !== true) {
    throw deleteSnapshotChangedError(result);
  }
  return result;
}
