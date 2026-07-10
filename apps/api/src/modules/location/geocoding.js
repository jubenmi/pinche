import { config } from "../../config/env.js";
import { AppError, badRequest } from "../../http/errors.js";

const REQUEST_TIMEOUT_MS = 4000;
const REVERSE_GEOCODE_TIMEOUT_MS = 2500;

class ProviderGeocodeError extends Error {
  constructor(provider, code, message, status) {
    super(message);
    this.name = "ProviderGeocodeError";
    this.provider = provider;
    this.code = code;
    this.status = status;
  }
}

function normalizedText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function providerError(provider, code, message, status) {
  return new ProviderGeocodeError(provider, code, message, status);
}

function coordinateNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    return null;
  }
  return number;
}

function reverseGeocodeInput(input = {}) {
  const latitude = coordinateNumber(input.latitude, -90, 90);
  const longitude = coordinateNumber(input.longitude, -180, 180);
  if (latitude === null || longitude === null) {
    throw badRequest("latitude and longitude must be valid coordinates");
  }
  return { latitude, longitude };
}

function administrativeName(value) {
  if (Array.isArray(value)) {
    return normalizedText(value[0]);
  }
  return normalizedText(value);
}

function uniqueAddressParts(parts) {
  const result = [];
  for (const part of parts.map(normalizedText).filter(Boolean)) {
    if (result.some((item) => item === part || item.includes(part))) {
      continue;
    }
    result.push(part);
  }
  return result;
}

export function storeGeocodeQuery(body = {}) {
  const city = normalizedText(body.city);
  const district = normalizedText(body.district);
  const target =
    normalizedText(body.address) || normalizedText(body.keyword) || normalizedText(body.name);
  if (Array.from(target).length < 2) {
    throw badRequest("address or keyword is required");
  }

  const prefixParts = uniqueAddressParts([city, district]).filter(
    (part) => !target.includes(part)
  );
  return {
    address: [...prefixParts, target].join(""),
    city,
    district,
    target
  };
}

async function fetchJson(url, fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    const payload = await response.json();
    if (!response.ok) {
      throw providerError("http", "HTTP_ERROR", `HTTP ${response.status}`, response.status);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function confidenceNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function geocodeWithTencent(query, options = {}) {
  const key = options.tencentKey ?? config.map.tencentKey;
  if (!key) {
    throw providerError("tencent", "PROVIDER_KEY_MISSING", "Tencent map key is not configured");
  }

  const params = new URLSearchParams({
    address: query.address,
    key,
    output: "json"
  });
  if (query.city) {
    params.set("region", query.city);
  }

  const payload = await fetchJson(
    `https://apis.map.qq.com/ws/geocoder/v1/?${params.toString()}`,
    options.fetchImpl || fetch
  ).catch((error) => {
    if (error instanceof ProviderGeocodeError) {
      throw error;
    }
    throw providerError("tencent", "PROVIDER_REQUEST_FAILED", error.message);
  });

  if (Number(payload?.status) !== 0) {
    throw providerError(
      "tencent",
      "PROVIDER_STATUS_ERROR",
      payload?.message || "Tencent geocode failed",
      Number(payload?.status)
    );
  }

  const location = payload.result?.location || {};
  const latitude = coordinateNumber(location.lat, -90, 90);
  const longitude = coordinateNumber(location.lng, -180, 180);
  if (latitude === null || longitude === null) {
    throw providerError("tencent", "PROVIDER_EMPTY_RESULT", "Tencent geocode returned no coordinate");
  }

  const reliability = confidenceNumber(payload.result?.reliability);
  const level = confidenceNumber(payload.result?.level);
  if (reliability !== null && reliability < 7) {
    throw providerError("tencent", "PROVIDER_LOW_CONFIDENCE", "Tencent geocode reliability is low");
  }
  if (level !== null && level < 7) {
    throw providerError("tencent", "PROVIDER_LOW_LEVEL", "Tencent geocode level is low");
  }

  return {
    provider: "tencent",
    latitude,
    longitude,
    confidence: {
      reliability,
      level
    },
    query: query.address
  };
}

export async function geocodeWithAmap(query, options = {}) {
  const key = options.amapKey ?? config.map.amapKey;
  if (!key) {
    throw providerError("amap", "PROVIDER_KEY_MISSING", "AMap key is not configured");
  }

  const params = new URLSearchParams({
    address: query.address,
    key,
    output: "json"
  });
  if (query.city) {
    params.set("city", query.city);
  }

  const payload = await fetchJson(
    `https://restapi.amap.com/v3/geocode/geo?${params.toString()}`,
    options.fetchImpl || fetch
  ).catch((error) => {
    if (error instanceof ProviderGeocodeError) {
      throw error;
    }
    throw providerError("amap", "PROVIDER_REQUEST_FAILED", error.message);
  });

  if (String(payload?.status) !== "1") {
    throw providerError(
      "amap",
      "PROVIDER_STATUS_ERROR",
      payload?.info || "AMap geocode failed",
      payload?.infocode
    );
  }

  const first = Array.isArray(payload.geocodes) ? payload.geocodes[0] : null;
  const [longitudeText, latitudeText] = String(first?.location || "").split(",");
  const latitude = coordinateNumber(latitudeText, -90, 90);
  const longitude = coordinateNumber(longitudeText, -180, 180);
  if (latitude === null || longitude === null) {
    throw providerError("amap", "PROVIDER_EMPTY_RESULT", "AMap geocode returned no coordinate");
  }

  return {
    provider: "amap",
    latitude,
    longitude,
    confidence: {
      level: first?.level || null
    },
    query: query.address
  };
}

export async function reverseGeocodeWithTencent(location, options = {}) {
  const key = options.tencentKey ?? config.map.tencentKey;
  if (!key) {
    throw providerError("tencent", "PROVIDER_KEY_MISSING", "Tencent map key is not configured");
  }

  const params = new URLSearchParams({
    location: `${location.latitude},${location.longitude}`,
    get_poi: "0",
    key,
    output: "json"
  });
  const payload = await fetchJson(
    `https://apis.map.qq.com/ws/geocoder/v1/?${params.toString()}`,
    options.fetchImpl || fetch,
    options.timeoutMs ?? REVERSE_GEOCODE_TIMEOUT_MS
  ).catch((error) => {
    if (error instanceof ProviderGeocodeError) {
      throw error;
    }
    throw providerError("tencent", "PROVIDER_REQUEST_FAILED", error.message);
  });

  if (Number(payload?.status) !== 0) {
    throw providerError(
      "tencent",
      "PROVIDER_STATUS_ERROR",
      payload?.message || "Tencent reverse geocode failed",
      Number(payload?.status)
    );
  }

  const component = payload.result?.address_component || {};
  const province = administrativeName(component.province);
  const city = administrativeName(component.city) || province;
  if (!city) {
    throw providerError(
      "tencent",
      "PROVIDER_EMPTY_RESULT",
      "Tencent reverse geocode returned no city"
    );
  }

  return {
    provider: "tencent",
    city,
    province: province || city,
    latitude: location.latitude,
    longitude: location.longitude
  };
}

export async function reverseGeocodeWithAmap(location, options = {}) {
  const key = options.amapKey ?? config.map.amapKey;
  if (!key) {
    throw providerError("amap", "PROVIDER_KEY_MISSING", "AMap key is not configured");
  }

  const params = new URLSearchParams({
    location: `${location.longitude},${location.latitude}`,
    key,
    output: "json"
  });
  const payload = await fetchJson(
    `https://restapi.amap.com/v3/geocode/regeo?${params.toString()}`,
    options.fetchImpl || fetch,
    options.timeoutMs ?? REVERSE_GEOCODE_TIMEOUT_MS
  ).catch((error) => {
    if (error instanceof ProviderGeocodeError) {
      throw error;
    }
    throw providerError("amap", "PROVIDER_REQUEST_FAILED", error.message);
  });

  if (String(payload?.status) !== "1") {
    throw providerError(
      "amap",
      "PROVIDER_STATUS_ERROR",
      payload?.info || "AMap reverse geocode failed",
      payload?.infocode
    );
  }

  const component = payload.regeocode?.addressComponent || {};
  const province = administrativeName(component.province);
  const city = administrativeName(component.city) || province;
  if (!city) {
    throw providerError(
      "amap",
      "PROVIDER_EMPTY_RESULT",
      "AMap reverse geocode returned no city"
    );
  }

  return {
    provider: "amap",
    city,
    province: province || city,
    latitude: location.latitude,
    longitude: location.longitude
  };
}

function publicFailure(error, provider) {
  return {
    provider: error.provider || provider,
    code: error.code || "PROVIDER_FAILED",
    status: error.status ?? null,
    message: error.message || "provider failed"
  };
}

export async function geocodeStoreLocation(body = {}, options = {}) {
  const query = storeGeocodeQuery(body);
  const failures = [];

  try {
    return await geocodeWithTencent(query, options);
  } catch (error) {
    failures.push(publicFailure(error, "tencent"));
  }

  try {
    return await geocodeWithAmap(query, options);
  } catch (error) {
    failures.push(publicFailure(error, "amap"));
  }

  throw new AppError(
    502,
    "LOCATION_GEOCODE_FAILED",
    "Address geocoding failed",
    { failures }
  );
}

export async function reverseGeocodeCity(input = {}, options = {}) {
  const location = reverseGeocodeInput(input);
  const failures = [];

  try {
    return await reverseGeocodeWithTencent(location, options);
  } catch (error) {
    failures.push(publicFailure(error, "tencent"));
  }

  try {
    return await reverseGeocodeWithAmap(location, options);
  } catch (error) {
    failures.push(publicFailure(error, "amap"));
  }

  throw new AppError(
    502,
    "LOCATION_REVERSE_GEOCODE_FAILED",
    "Location reverse geocoding failed",
    { failures }
  );
}
