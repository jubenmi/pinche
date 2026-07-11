import crypto from "node:crypto";
import https from "node:https";

const SIGN_ALGORITHM = "sha1";
const DEFAULT_SIGN_EXPIRES_SECONDS = 600;
const DEFAULT_COS_INSPECTION_TIMEOUT_MS = 10_000;
const DEFAULT_COS_TRANSFER_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_COS_DELETE_TIMEOUT_MS = 30_000;
const DEFAULT_COS_RESPONSE_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_COS_ERROR_RESPONSE_MAX_BYTES = 64 * 1024;

const TRUSTED_COS_ERROR_CODES = new Set([
  "COS_OBJECT_NOT_FOUND",
  "COS_PRECONDITION_FAILED",
  "COS_UPSTREAM_ERROR",
  "COS_NETWORK_ERROR",
  "COS_REQUEST_TIMEOUT",
  "COS_RESPONSE_ABORTED",
  "COS_RESPONSE_TOO_LARGE",
  "COS_INVALID_IMAGE_INFO",
  "COS_INVALID_CONTENT_LENGTH",
  "COS_INVALID_RANGE_RESPONSE"
]);
const trustedCosStorageErrors = new WeakSet();

function cosStorageError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.isCosStorageError = true;
  trustedCosStorageErrors.add(error);
  return error;
}

function cosHttpError(statusCode) {
  let error;
  if (statusCode === 404) {
    error = cosStorageError(404, "COS_OBJECT_NOT_FOUND", "COS object was not found");
  } else if (statusCode === 409 || statusCode === 412) {
    error = cosStorageError(
      412,
      "COS_PRECONDITION_FAILED",
      "COS object version precondition failed"
    );
  } else {
    error = cosStorageError(502, "COS_UPSTREAM_ERROR", "COS storage request failed");
  }
  Object.defineProperty(error, "upstreamStatusCode", {
    configurable: false,
    enumerable: false,
    value: Number(statusCode),
    writable: false
  });
  return error;
}

function cosNetworkError() {
  return cosStorageError(502, "COS_NETWORK_ERROR", "COS storage network request failed");
}

export function isTrustedCosStorageError(error) {
  return Boolean(
    error &&
      trustedCosStorageErrors.has(error) &&
      error.isCosStorageError === true &&
      TRUSTED_COS_ERROR_CODES.has(error.code) &&
      [404, 412, 502, 504].includes(Number(error.statusCode))
  );
}

function hmacSha1(key, value) {
  return crypto.createHmac("sha1", key).update(value).digest("hex");
}

function sha1(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function encodeCosComponent(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sortedHeaderEntries(headers = {}) {
  return Object.entries(headers)
    .map(([key, value]) => [encodeCosComponent(key).toLowerCase(), encodeCosComponent(value)])
    .sort(([left], [right]) => left.localeCompare(right));
}

export function cosQueryEntries(urlParams = []) {
  const raw = Array.isArray(urlParams)
    ? urlParams.map(({ name, value = null }) => ({ name: String(name), value }))
    : Object.entries(urlParams).map(([name, value]) => ({ name, value }));
  return raw
    .filter(({ value }) => value !== undefined)
    .sort((left, right) =>
      encodeCosComponent(left.name).toLowerCase()
        .localeCompare(encodeCosComponent(right.name).toLowerCase())
    );
}

function encodeCosQueryKey(value) {
  return String(value || "")
    .split("/")
    .map(encodeCosComponent)
    .join("/");
}

export function renderCosRequestQuery(urlParams) {
  return cosQueryEntries(urlParams).map(({ name, value }) =>
    value === null
      ? encodeCosQueryKey(name)
      : `${encodeCosComponent(name)}=${encodeCosComponent(value)}`
  ).join("&");
}

export function renderCosCanonicalQuery(urlParams) {
  return cosQueryEntries(urlParams).map(({ name, value }) =>
    `${encodeCosComponent(name).toLowerCase()}=${
      value === null ? "" : encodeCosComponent(value)
    }`
  ).join("&");
}

export function encodeCosObjectPath(key) {
  return String(key || "").split("/").map(encodeCosComponent).join("/");
}

export function cosStorageEnabled(cosConfig = {}) {
  return Boolean(
    cosConfig.enabled &&
      cosConfig.secretId &&
      cosConfig.secretKey &&
      cosConfig.bucket &&
      cosConfig.region
  );
}

export function cosHost(cosConfig) {
  return `${cosConfig.bucket}.cos.${cosConfig.region}.myqcloud.com`;
}

export function cosObjectKeyFromUploadPath(uploadPath, expectedPrefix) {
  const pathText = String(uploadPath || "");
  if (!pathText.startsWith(expectedPrefix)) {
    throw new Error("invalid upload object prefix");
  }

  const objectName = decodeURIComponent(pathText.slice(expectedPrefix.length));
  if (!objectName || objectName !== objectName.trim() || objectName.includes("/")) {
    throw new Error("invalid upload object name");
  }
  if (objectName !== objectName.split(/[\\/]/).pop() || !/^[A-Za-z0-9._-]+$/.test(objectName)) {
    throw new Error("invalid upload object name");
  }

  return `${expectedPrefix.replace(/^\/|\/$/g, "")}/${objectName}`;
}

export function cosUploadPathForKey(key) {
  const keyText = String(key || "");
  if (
    !/^uploads\/(avatars|session-reviews)\/[A-Za-z0-9._-]+$/.test(keyText) &&
    !/^uploads\/session-album\/display\/[A-Za-z0-9._-]+$/.test(keyText) &&
    !/^uploads\/session-album\/videos\/(source|display|cover)\/[A-Za-z0-9._-]+$/.test(keyText)
  ) {
    throw new Error("invalid COS object key");
  }
  return `/${keyText}`;
}

export function buildCosAuthorization({
  method,
  key,
  headers,
  urlParams,
  nowSeconds = Math.floor(Date.now() / 1000),
  expiresInSeconds = DEFAULT_SIGN_EXPIRES_SECONDS,
  config
}) {
  const keyTime = `${nowSeconds};${nowSeconds + expiresInSeconds}`;
  const headerEntries = sortedHeaderEntries(headers);
  const urlParamEntries = cosQueryEntries(urlParams);
  const headerList = headerEntries.map(([name]) => name).join(";");
  const urlParamList = urlParamEntries
    .map(({ name }) => encodeCosComponent(name).toLowerCase())
    .join(";");
  const httpHeaders = headerEntries.map(([name, value]) => `${name}=${value}`).join("&");
  const httpParameters = renderCosCanonicalQuery(urlParamEntries);
  const uriPathname = `/${encodeCosObjectPath(key)}`;
  const httpString = `${method.toLowerCase()}\n${uriPathname}\n${httpParameters}\n${httpHeaders}\n`;
  const stringToSign = `${SIGN_ALGORITHM}\n${keyTime}\n${sha1(httpString)}\n`;
  const signKey = hmacSha1(config.secretKey, keyTime);
  const signature = hmacSha1(signKey, stringToSign);

  return [
    "q-sign-algorithm=sha1",
    `q-ak=${config.secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    `q-url-param-list=${urlParamList}`,
    `q-signature=${signature}`
  ].join("&");
}

function cosRequest({
  method,
  key,
  body,
  contentType,
  contentLength,
  headers: extraHeaders = {},
  ciProcess,
  urlParams,
  collectBody = true,
  maxResponseBytes = DEFAULT_COS_RESPONSE_MAX_BYTES,
  maxErrorResponseBytes = DEFAULT_COS_ERROR_RESPONSE_MAX_BYTES,
  timeoutMs = DEFAULT_COS_TRANSFER_TIMEOUT_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  request = https.request,
  config
}) {
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 0) {
    throw new TypeError("invalid COS response byte limit");
  }
  if (!Number.isSafeInteger(maxErrorResponseBytes) || maxErrorResponseBytes < 0) {
    throw new TypeError("invalid COS error response byte limit");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("invalid COS request timeout");
  }

  const host = cosHost(config);
  const queryEntries = cosQueryEntries(
    urlParams === undefined && ciProcess
      ? [{ name: ciProcess, value: null }]
      : (urlParams || [])
  );
  const date = new Date().toUTCString();
  const hasBody = body !== undefined && body !== null;
  const streamBody = hasBody && typeof body?.pipe === "function";
  let normalizedContentLength = contentLength;
  if (hasBody && !streamBody) {
    const actualLength = Buffer.isBuffer(body)
      ? body.length
      : Buffer.byteLength(String(body));
    if (normalizedContentLength === undefined) normalizedContentLength = actualLength;
    if (normalizedContentLength !== actualLength) {
      throw new TypeError("COS request body length does not match contentLength");
    }
  }
  if (streamBody && normalizedContentLength === undefined) {
    throw new TypeError("streaming COS request body requires contentLength");
  }
  if (
    normalizedContentLength !== undefined &&
    (!Number.isSafeInteger(normalizedContentLength) || normalizedContentLength < 0)
  ) {
    throw new TypeError("invalid COS request contentLength");
  }
  const normalizedExtraHeaders = Object.fromEntries(
    Object.entries(extraHeaders)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([name, value]) => [name.toLowerCase(), String(value)])
  );
  if (contentType) normalizedExtraHeaders["content-type"] = String(contentType);
  if (normalizedContentLength !== undefined) {
    normalizedExtraHeaders["content-length"] = String(normalizedContentLength);
  }
  const signedHeaders = { date, host, ...normalizedExtraHeaders };
  const headers = {
    date,
    host,
    ...normalizedExtraHeaders,
    authorization: buildCosAuthorization({
      method,
      key,
      headers: signedHeaders,
      urlParams: queryEntries,
      config
    })
  };

  return new Promise((resolve, reject) => {
    let pendingRequest = null;
    let activeResponse = null;
    let timeoutHandle;
    let settled = false;

    const clearRequestTimeout = () => {
      if (timeoutHandle !== undefined) {
        try {
          clearTimeoutFn(timeoutHandle);
        } catch {
          // Timeout cleanup must not prevent the request promise from settling.
        }
        timeoutHandle = undefined;
      }
    };
    const settle = (complete, value) => {
      if (settled) return false;
      settled = true;
      clearRequestTimeout();
      complete(value);
      return true;
    };
    const resolveOnce = (value) => settle(resolve, value);
    const rejectOnce = (error) => settle(reject, error);
    const gatewayError = (statusCode, code, message) =>
      cosStorageError(statusCode, code, message);
    const abortTransport = () => {
      activeResponse?.destroy?.();
      pendingRequest?.destroy?.();
      if (streamBody) body.destroy?.();
    };
    const rejectOversizedResponse = (response, byteLimit) => {
      const successfulResponse = response.statusCode >= 200 && response.statusCode < 300;
      const error = successfulResponse
        ? gatewayError(
            502,
            "COS_RESPONSE_TOO_LARGE",
            `COS response exceeded ${byteLimit} bytes`
          )
        : cosHttpError(response.statusCode);
      rejectOnce(error);
      abortTransport();
    };

    timeoutHandle = setTimeoutFn(() => {
      const error = gatewayError(504, "COS_REQUEST_TIMEOUT", "COS request timed out");
      rejectOnce(error);
      abortTransport();
    }, timeoutMs);

    try {
      pendingRequest = request(
        {
          method,
          hostname: host,
          path: `/${key}${
            queryEntries.length > 0 ? `?${renderCosRequestQuery(queryEntries)}` : ""
          }`,
          headers
        },
        (response) => {
          if (settled) {
            response.destroy?.();
            return;
          }
          activeResponse = response;
          const successfulResponse = response.statusCode >= 200 && response.statusCode < 300;
          const responseByteLimit = successfulResponse
            ? maxResponseBytes
            : maxErrorResponseBytes;
          const chunks = [];
          let responseByteSize = 0;

          response.on("data", (chunk) => {
            if (settled) return;
            const chunkBuffer = Buffer.from(chunk);
            responseByteSize += chunkBuffer.length;
            if (!collectBody && successfulResponse && responseByteSize > 0) {
              rejectOversizedResponse(response, 0);
              return;
            }
            if (responseByteSize > responseByteLimit) {
              rejectOversizedResponse(response, responseByteLimit);
              return;
            }
            if (collectBody || !successfulResponse) chunks.push(chunkBuffer);
          });
          response.on("aborted", () => {
            const error = gatewayError(504, "COS_RESPONSE_ABORTED", "COS response aborted");
            rejectOnce(error);
            abortTransport();
          });
          response.on("error", () => rejectOnce(cosNetworkError()));
          response.on("end", () => {
            if (settled) return;
            const responseBody = chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks);
            if (successfulResponse) {
              resolveOnce({
                statusCode: response.statusCode,
                headers: response.headers,
                body: responseBody
              });
              return;
            }

            void responseBody;
            rejectOnce(cosHttpError(response.statusCode));
          });

          const rawContentLength = response.headers["content-length"];
          if (rawContentLength !== undefined && (collectBody || !successfulResponse)) {
            const text = String(rawContentLength);
            const declaredByteSize = /^\d+$/.test(text) ? Number(text) : NaN;
            if (!Number.isSafeInteger(declaredByteSize) || declaredByteSize < 0) {
              const error = successfulResponse
                ? gatewayError(
                    502,
                    "COS_INVALID_CONTENT_LENGTH",
                    "COS response returned an invalid Content-Length"
                  )
                : cosHttpError(response.statusCode);
              rejectOnce(error);
              abortTransport();
              return;
            }
            if (declaredByteSize > responseByteLimit) {
              rejectOversizedResponse(response, responseByteLimit);
            }
          }
        }
      );
      pendingRequest.on("error", () => rejectOnce(cosNetworkError()));
      if (streamBody) {
        body.once("error", () => {
          rejectOnce(cosNetworkError());
          abortTransport();
        });
        body.pipe(pendingRequest);
      } else {
        if (hasBody) pendingRequest.write(body);
        pendingRequest.end();
      }
    } catch {
      rejectOnce(cosNetworkError());
      abortTransport();
    }
  });
}

export async function putCosObject({
  key,
  body,
  contentType,
  contentLength,
  picOperations,
  headers = {},
  forbidOverwrite = false,
  config,
  request,
  timeoutMs = DEFAULT_COS_TRANSFER_TIMEOUT_MS,
  setTimeoutFn,
  clearTimeoutFn
}) {
  const putHeaders = {
    ...headers,
    ...(picOperations ? { "pic-operations": picOperations } : {}),
    ...(forbidOverwrite ? { "x-cos-forbid-overwrite": "true" } : {})
  };
  return cosRequest({
    method: "PUT",
    key,
    body,
    contentType,
    contentLength,
    headers: putHeaders,
    request,
    timeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
    config
  });
}

export async function getCosObject({
  key,
  ciProcess,
  config,
  request,
  timeoutMs = DEFAULT_COS_TRANSFER_TIMEOUT_MS,
  setTimeoutFn,
  clearTimeoutFn
}) {
  return cosRequest({
    method: "GET",
    key,
    ciProcess,
    request,
    timeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
    config
  });
}

export async function headCosObject({
  key,
  config,
  request,
  timeoutMs = DEFAULT_COS_INSPECTION_TIMEOUT_MS,
  setTimeoutFn,
  clearTimeoutFn
}) {
  return cosRequest({
    method: "HEAD",
    key,
    collectBody: false,
    timeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
    request,
    config
  });
}

export async function getCosImageInfo({
  key,
  etag,
  config,
  request = https.request,
  timeoutMs = DEFAULT_COS_INSPECTION_TIMEOUT_MS,
  setTimeoutFn,
  clearTimeoutFn
}) {
  const read = (headers) => cosRequest({
    method: "GET",
    key,
    headers,
    urlParams: [{ name: "imageInfo", value: null }],
    maxResponseBytes: 64 * 1024,
    timeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
    request,
    config
  });

  let response;
  try {
    response = await read(etag ? { "if-match": etag } : {});
  } catch (error) {
    if (!etag || ![400, 405, 501].includes(Number(error.upstreamStatusCode))) throw error;
    response = await read({});
  }

  let parsed;
  try {
    parsed = JSON.parse(response.body.toString("utf8"));
  } catch {
    throw cosStorageError(
      502,
      "COS_INVALID_IMAGE_INFO",
      "COS imageInfo response was invalid JSON"
    );
  }
  return {
    format: String(parsed.format || "").toLowerCase(),
    width: Number(parsed.width || 0),
    height: Number(parsed.height || 0),
    byteSize: Number(parsed.size || 0),
    etag: String(response.headers.etag || etag || "").replace(/^\"|\"$/g, "")
  };
}

export async function readCosObjectRange({
  key,
  start = 0,
  end = 11,
  ifMatch,
  expectedByteSize,
  config,
  request,
  timeoutMs = DEFAULT_COS_INSPECTION_TIMEOUT_MS,
  setTimeoutFn,
  clearTimeoutFn
}) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    (expectedByteSize !== undefined &&
      (!Number.isSafeInteger(expectedByteSize) || expectedByteSize <= 0))
  ) {
    throw new TypeError("invalid COS object byte range");
  }
  const response = await cosRequest({
    method: "GET",
    key,
    headers: {
      range: `bytes=${start}-${end}`,
      ...(ifMatch ? { "if-match": ifMatch } : {})
    },
    maxResponseBytes: end - start + 1,
    timeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
    request,
    config
  });
  if (response.statusCode !== 206) {
    throw cosStorageError(
      502,
      "COS_INVALID_RANGE_RESPONSE",
      "COS range response was invalid"
    );
  }

  const contentRange = String(response.headers["content-range"] || "");
  const rangeMatch = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(contentRange);
  const actualStart = Number(rangeMatch?.[1]);
  const actualEnd = Number(rangeMatch?.[2]);
  const completeLength = rangeMatch?.[3] === "*" ? null : Number(rangeMatch?.[3]);
  const expectedEnd = Number.isSafeInteger(completeLength)
    ? Math.min(end, completeLength - 1)
    : actualEnd;
  if (
    !rangeMatch ||
    actualStart !== start ||
    !Number.isSafeInteger(actualEnd) ||
    actualEnd < actualStart ||
    actualEnd > end ||
    (expectedByteSize !== undefined && completeLength !== expectedByteSize) ||
    (completeLength !== null &&
      (!Number.isSafeInteger(completeLength) ||
        completeLength <= actualStart ||
        actualEnd >= completeLength ||
        actualEnd !== expectedEnd)) ||
    response.body.length !== actualEnd - actualStart + 1
  ) {
    throw cosStorageError(
      502,
      "COS_INVALID_RANGE_RESPONSE",
      "COS range response was invalid"
    );
  }
  return response.body;
}

export async function deleteCosObject({
  key,
  config,
  request,
  timeoutMs = DEFAULT_COS_DELETE_TIMEOUT_MS,
  setTimeoutFn,
  clearTimeoutFn
}) {
  return cosRequest({
    method: "DELETE",
    key,
    request,
    timeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
    config
  });
}
