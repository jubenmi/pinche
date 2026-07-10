import assert from "node:assert/strict";

import { reverseGeocodeCity } from "../apps/api/src/modules/location/geocoding.js";

function jsonResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    }
  };
}

{
  const calls = [];
  const result = await reverseGeocodeCity(
    { latitude: 39.9042, longitude: 116.4074 },
    {
      tencentKey: "tencent-test-key",
      amapKey: "amap-test-key",
      async fetchImpl(url) {
        calls.push(String(url));
        return jsonResponse({
          status: 0,
          result: {
            address_component: {
              province: "北京市",
              city: "北京市"
            }
          }
        });
      }
    }
  );

  assert.equal(result.provider, "tencent");
  assert.equal(result.city, "北京市");
  assert.equal(result.province, "北京市");
  assert.equal(result.latitude, 39.9042);
  assert.equal(result.longitude, 116.4074);
  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0]);
  assert.equal(requestUrl.hostname, "apis.map.qq.com");
  assert.equal(requestUrl.searchParams.get("location"), "39.9042,116.4074");
  assert.equal(requestUrl.searchParams.get("get_poi"), "0");
}

{
  const calls = [];
  const result = await reverseGeocodeCity(
    { latitude: 31.2304, longitude: 121.4737 },
    {
      tencentKey: "tencent-test-key",
      amapKey: "amap-test-key",
      async fetchImpl(url) {
        calls.push(String(url));
        if (calls.length === 1) {
          return jsonResponse({ status: 347, message: "quota exceeded" });
        }
        return jsonResponse({
          status: "1",
          regeocode: {
            addressComponent: {
              province: "上海市",
              city: []
            }
          }
        });
      }
    }
  );

  assert.equal(result.provider, "amap");
  assert.equal(result.city, "上海市");
  assert.equal(result.province, "上海市");
  assert.equal(calls.length, 2);
  const amapUrl = new URL(calls[1]);
  assert.equal(amapUrl.hostname, "restapi.amap.com");
  assert.equal(amapUrl.pathname, "/v3/geocode/regeo");
  assert.equal(amapUrl.searchParams.get("location"), "121.4737,31.2304");
}

await assert.rejects(
  () => reverseGeocodeCity({ latitude: 91, longitude: 116.4074 }),
  (error) => error.statusCode === 400 && error.code === "BAD_REQUEST"
);
await assert.rejects(
  () => reverseGeocodeCity({ latitude: 39.9042 }),
  (error) => error.statusCode === 400 && error.code === "BAD_REQUEST"
);
await assert.rejects(
  () =>
    reverseGeocodeCity(
      { latitude: 39.9042, longitude: 116.4074 },
      {
        tencentKey: "",
        amapKey: "",
        async fetchImpl() {
          throw new Error("providers should not run without keys");
        }
      }
    ),
  (error) =>
    error.statusCode === 502 &&
    error.code === "LOCATION_REVERSE_GEOCODE_FAILED" &&
    error.details?.failures?.length === 2
);

{
  const calls = [];
  const startedAt = Date.now();
  await assert.rejects(
    () =>
      reverseGeocodeCity(
        { latitude: 39.9042, longitude: 116.4074 },
        {
          tencentKey: "tencent-test-key",
          amapKey: "amap-test-key",
          timeoutMs: 10,
          async fetchImpl(url, options = {}) {
            calls.push(String(url));
            return new Promise((resolve, reject) => {
              options.signal?.addEventListener(
                "abort",
                () => reject(new Error("provider timeout")),
                { once: true }
              );
            });
          }
        }
      ),
    (error) => error.code === "LOCATION_REVERSE_GEOCODE_FAILED"
  );
  assert.equal(calls.length, 2);
  assert(Date.now() - startedAt < 500, "provider-specific timeout should bound both fallbacks");
}

console.log("D38 reverse geocoding unit checks passed");
