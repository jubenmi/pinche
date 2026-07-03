import crypto from "node:crypto";
import https from "node:https";

const SIGN_ALGORITHM = "sha1";
const DEFAULT_SIGN_EXPIRES_SECONDS = 600;

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
    !/^uploads\/session-album\/display\/[A-Za-z0-9._-]+$/.test(keyText)
  ) {
    throw new Error("invalid COS object key");
  }
  return `/${keyText}`;
}

export function buildCosAuthorization({
  method,
  key,
  headers,
  nowSeconds = Math.floor(Date.now() / 1000),
  expiresInSeconds = DEFAULT_SIGN_EXPIRES_SECONDS,
  config
}) {
  const keyTime = `${nowSeconds};${nowSeconds + expiresInSeconds}`;
  const headerEntries = sortedHeaderEntries(headers);
  const headerList = headerEntries.map(([name]) => name).join(";");
  const httpHeaders = headerEntries.map(([name, value]) => `${name}=${value}`).join("&");
  const uriPathname = `/${String(key || "").split("/").map(encodeURIComponent).join("/")}`;
  const httpString = `${method.toLowerCase()}\n${uriPathname}\n\n${httpHeaders}\n`;
  const stringToSign = `${SIGN_ALGORITHM}\n${keyTime}\n${sha1(httpString)}\n`;
  const signKey = hmacSha1(config.secretKey, keyTime);
  const signature = hmacSha1(signKey, stringToSign);

  return [
    "q-sign-algorithm=sha1",
    `q-ak=${config.secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    "q-url-param-list=",
    `q-signature=${signature}`
  ].join("&");
}

function encodeCosQueryKey(value) {
  return String(value || "")
    .split("/")
    .map(encodeCosComponent)
    .join("/");
}

function cosRequest({
  method,
  key,
  body,
  contentType,
  headers: extraHeaders = {},
  ciProcess,
  config
}) {
  const host = cosHost(config);
  const date = new Date().toUTCString();
  const normalizedExtraHeaders = Object.fromEntries(
    Object.entries(extraHeaders)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([name, value]) => [name.toLowerCase(), String(value)])
  );
  const signedHeaders = { date, host, ...normalizedExtraHeaders };
  const headers = {
    date,
    host,
    ...normalizedExtraHeaders,
    authorization: buildCosAuthorization({
      method,
      key,
      headers: signedHeaders,
      config
    })
  };
  if (contentType) {
    headers["content-type"] = contentType;
  }
  if (body) {
    headers["content-length"] = body.length;
  }

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        method,
        hostname: host,
        path: `/${key}${ciProcess ? `?${encodeCosQueryKey(ciProcess)}` : ""}`,
        headers
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const responseBody = chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks);
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({
              statusCode: response.statusCode,
              headers: response.headers,
              body: responseBody
            });
            return;
          }

          const error = new Error(`COS request failed with status ${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.body = responseBody.toString("utf8");
          reject(error);
        });
      }
    );
    request.on("error", reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

export async function putCosObject({ key, body, contentType, picOperations, config }) {
  return cosRequest({
    method: "PUT",
    key,
    body,
    contentType,
    headers: picOperations ? { "pic-operations": picOperations } : {},
    config
  });
}

export async function getCosObject({ key, ciProcess, config }) {
  return cosRequest({
    method: "GET",
    key,
    ciProcess,
    config
  });
}

export async function deleteCosObject({ key, config }) {
  return cosRequest({
    method: "DELETE",
    key,
    config
  });
}
