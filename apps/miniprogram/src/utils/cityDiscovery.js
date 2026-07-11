export const CITY_DISCOVERY_CACHE_KEY = "pinche_city_discovery_location";
export const CITY_DISCOVERY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function coordinateNumber(value, min, max) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    return null;
  }
  return number;
}

function normalizedCity(value) {
  const city = String(value || "").trim();
  if (!city || Array.from(city).length > 64) {
    return "";
  }
  return city;
}

function runtimeUni() {
  return typeof uni === "undefined" ? null : uni;
}

function storageApi(options = {}) {
  return options.storage || runtimeUni();
}

export function validDiscoveryCoordinates(latitude, longitude) {
  return (
    coordinateNumber(latitude, -90, 90) !== null &&
    coordinateNumber(longitude, -180, 180) !== null
  );
}

export function clearCityDiscoveryCache(options = {}) {
  const storage = storageApi(options);
  try {
    storage?.removeStorageSync?.(CITY_DISCOVERY_CACHE_KEY);
  } catch (error) {
    // Discovery remains usable without local storage.
  }
}

export function readCityDiscoveryCache(options = {}) {
  const storage = storageApi(options);
  const now = Number(options.now ?? Date.now());
  let cached;
  try {
    cached = storage?.getStorageSync?.(CITY_DISCOVERY_CACHE_KEY);
  } catch (error) {
    return null;
  }

  const city = normalizedCity(cached?.city);
  const latitude = coordinateNumber(cached?.latitude, -90, 90);
  const longitude = coordinateNumber(cached?.longitude, -180, 180);
  const cachedAt = Number(cached?.cachedAt);
  const age = now - cachedAt;
  const valid =
    city &&
    latitude !== null &&
    longitude !== null &&
    Number.isFinite(cachedAt) &&
    age >= 0 &&
    age < CITY_DISCOVERY_CACHE_TTL_MS;
  if (!valid) {
    clearCityDiscoveryCache({ storage });
    return null;
  }

  return { city, latitude, longitude, cachedAt };
}

export function writeCityDiscoveryCache(value = {}, options = {}) {
  const storage = storageApi(options);
  const now = Number(options.now ?? Date.now());
  const city = normalizedCity(value.city);
  const latitude = coordinateNumber(value.latitude, -90, 90);
  const longitude = coordinateNumber(value.longitude, -180, 180);
  if (!city || latitude === null || longitude === null || !Number.isFinite(now)) {
    clearCityDiscoveryCache({ storage });
    return null;
  }

  const cached = { city, latitude, longitude, cachedAt: now };
  try {
    storage?.setStorageSync?.(CITY_DISCOVERY_CACHE_KEY, cached);
  } catch (error) {
    return null;
  }
  return cached;
}

function locationError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause?.errMsg) {
    error.errMsg = cause.errMsg;
  }
  return error;
}

export function locationFailureState(error = {}) {
  if (error.code === "LOCATION_UNAVAILABLE") {
    return "unavailable";
  }
  const message = String(error.errMsg || error.message || "").toLowerCase();
  if (
    message.includes("auth deny") ||
    message.includes("permission denied") ||
    message.includes("authorize no response")
  ) {
    return "denied";
  }
  return "unavailable";
}

export function getCityDiscoveryLocation(options = {}) {
  const api = options.api || runtimeUni();
  if (typeof api?.getLocation !== "function") {
    return Promise.reject(
      locationError("LOCATION_UNAVAILABLE", "Current location is unavailable")
    );
  }

  return new Promise((resolve, reject) => {
    api.getLocation({
      type: "gcj02",
      success(result = {}) {
        if (!validDiscoveryCoordinates(result.latitude, result.longitude)) {
          reject(locationError("LOCATION_UNAVAILABLE", "Location returned invalid coordinates"));
          return;
        }
        resolve({
          latitude: Number(result.latitude),
          longitude: Number(result.longitude)
        });
      },
      fail(error = {}) {
        reject(
          locationError(
            locationFailureState(error) === "denied"
              ? "LOCATION_PERMISSION_DENIED"
              : "LOCATION_UNAVAILABLE",
            error.errMsg || "Current location is unavailable",
            error
          )
        );
      }
    });
  });
}

export function discoveryRequestBody(location) {
  if (!validDiscoveryCoordinates(location?.latitude, location?.longitude)) {
    return { limit: 5 };
  }

  const body = {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    limit: 50
  };
  const city = normalizedCity(location.city);
  if (city) {
    body.city = city;
  }
  return body;
}
