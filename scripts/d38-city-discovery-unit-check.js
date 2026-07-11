import assert from "node:assert/strict";

import {
  CITY_DISCOVERY_CACHE_KEY,
  CITY_DISCOVERY_CACHE_TTL_MS,
  discoveryRequestBody,
  getCityDiscoveryLocation,
  locationFailureState,
  readCityDiscoveryCache,
  validDiscoveryCoordinates,
  writeCityDiscoveryCache
} from "../apps/miniprogram/src/utils/cityDiscovery.js";

function memoryStorage(initialValue) {
  const values = new Map();
  if (initialValue !== undefined) {
    values.set(CITY_DISCOVERY_CACHE_KEY, initialValue);
  }
  return {
    getStorageSync(key) {
      return values.get(key);
    },
    setStorageSync(key, value) {
      values.set(key, value);
    },
    removeStorageSync(key) {
      values.delete(key);
    },
    has(key) {
      return values.has(key);
    }
  };
}

assert.equal(CITY_DISCOVERY_CACHE_TTL_MS, 24 * 60 * 60 * 1000);
assert.equal(validDiscoveryCoordinates(39.9042, 116.4074), true);
assert.equal(validDiscoveryCoordinates("39.9042", "116.4074"), true);
assert.equal(validDiscoveryCoordinates(91, 116.4074), false);
assert.equal(validDiscoveryCoordinates(39.9042, 181), false);
assert.equal(validDiscoveryCoordinates("", 116.4074), false);

{
  const now = 1_783_632_000_000;
  const storage = memoryStorage();
  const written = writeCityDiscoveryCache(
    {
      city: " 北京市 ",
      latitude: 39.9042,
      longitude: 116.4074
    },
    { storage, now }
  );
  assert.deepEqual(written, {
    city: "北京市",
    latitude: 39.9042,
    longitude: 116.4074,
    cachedAt: now
  });
  assert.deepEqual(readCityDiscoveryCache({ storage, now: now + 1000 }), written);
}

{
  const now = 1_783_632_000_000;
  const storage = memoryStorage({
    city: "北京市",
    latitude: 39.9042,
    longitude: 116.4074,
    cachedAt: now - CITY_DISCOVERY_CACHE_TTL_MS
  });
  assert.equal(readCityDiscoveryCache({ storage, now }), null);
  assert.equal(storage.has(CITY_DISCOVERY_CACHE_KEY), false);
}

{
  const now = 1_783_632_000_000;
  const storage = memoryStorage({
    city: "北京市",
    latitude: "bad",
    longitude: 116.4074,
    cachedAt: now
  });
  assert.equal(readCityDiscoveryCache({ storage, now }), null);
  assert.equal(storage.has(CITY_DISCOVERY_CACHE_KEY), false);
}

{
  const now = 1_783_632_000_000;
  const storage = memoryStorage({
    city: "北京市",
    latitude: 39.9042,
    longitude: 116.4074,
    cachedAt: now + 1000
  });
  assert.equal(readCityDiscoveryCache({ storage, now }), null);
  assert.equal(storage.has(CITY_DISCOVERY_CACHE_KEY), false);
}

assert.deepEqual(
  discoveryRequestBody({ city: "北京市", latitude: 39.9042, longitude: 116.4074 }),
  {
    city: "北京市",
    latitude: 39.9042,
    longitude: 116.4074,
    limit: 50
  }
);
assert.deepEqual(discoveryRequestBody({ latitude: 39.9042, longitude: 116.4074 }), {
  latitude: 39.9042,
  longitude: 116.4074,
  limit: 50
});
assert.deepEqual(discoveryRequestBody(null), { limit: 5 });

{
  let requestedType = "";
  const result = await getCityDiscoveryLocation({
    api: {
      getLocation(options) {
        requestedType = options.type;
        options.success({ latitude: 39.9042, longitude: 116.4074 });
      }
    }
  });
  assert.equal(requestedType, "gcj02");
  assert.deepEqual(result, { latitude: 39.9042, longitude: 116.4074 });
}

await assert.rejects(
  () => getCityDiscoveryLocation({ api: {} }),
  (error) => error.code === "LOCATION_UNAVAILABLE"
);
await assert.rejects(
  () =>
    getCityDiscoveryLocation({
      api: {
        getLocation(options) {
          options.fail({ errMsg: "getLocation:fail auth deny" });
        }
      }
    }),
  (error) => locationFailureState(error) === "denied"
);

assert.equal(locationFailureState({ errMsg: "getLocation:fail auth deny" }), "denied");
assert.equal(locationFailureState({ errMsg: "getLocation:fail system permission denied" }), "denied");
assert.equal(locationFailureState({ code: "LOCATION_UNAVAILABLE" }), "unavailable");
assert.equal(locationFailureState({ errMsg: "getLocation:fail timeout" }), "unavailable");

console.log("D38 city discovery utility checks passed");
