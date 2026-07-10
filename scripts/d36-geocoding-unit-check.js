import assert from "node:assert/strict";

import {
  geocodeStoreLocation,
  storeGeocodeQuery
} from "../apps/api/src/modules/location/geocoding.js";

function jsonResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    }
  };
}

{
  const query = storeGeocodeQuery({
    city: "北京",
    district: "朝阳区",
    address: "阜通东大街6号"
  });
  assert.equal(query.address, "北京朝阳区阜通东大街6号");
}

{
  const calls = [];
  const result = await geocodeStoreLocation(
    {
      city: "北京",
      district: "朝阳区",
      address: "阜通东大街6号"
    },
    {
      tencentKey: "tencent-test-key",
      amapKey: "amap-test-key",
      async fetchImpl(url) {
        calls.push(String(url));
        return jsonResponse({
          status: 0,
          result: {
            location: { lat: 39.98941, lng: 116.480881 },
            reliability: 9,
            level: 10
          }
        });
      }
    }
  );

  assert.equal(result.provider, "tencent");
  assert.equal(result.latitude, 39.98941);
  assert.equal(result.longitude, 116.480881);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /apis\.map\.qq\.com\/ws\/geocoder\/v1/);
}

{
  const calls = [];
  const result = await geocodeStoreLocation(
    {
      city: "北京",
      district: "朝阳区",
      address: "阜通东大街6号"
    },
    {
      tencentKey: "tencent-test-key",
      amapKey: "amap-test-key",
      async fetchImpl(url) {
        calls.push(String(url));
        if (calls.length === 1) {
          return jsonResponse({
            status: 0,
            result: {
              location: { lat: 39.1, lng: 116.1 },
              reliability: 4,
              level: 4
            }
          });
        }
        return jsonResponse({
          status: "1",
          geocodes: [{ location: "116.480881,39.989410", level: "门牌号" }]
        });
      }
    }
  );

  assert.equal(result.provider, "amap");
  assert.equal(result.latitude, 39.98941);
  assert.equal(result.longitude, 116.480881);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /apis\.map\.qq\.com\/ws\/geocoder\/v1/);
  assert.match(calls[1], /restapi\.amap\.com\/v3\/geocode\/geo/);
}

{
  await assert.rejects(
    () =>
      geocodeStoreLocation(
        { city: "北京", address: "阜通东大街6号" },
        {
          tencentKey: "",
          amapKey: "",
          async fetchImpl() {
            throw new Error("should not call providers without keys");
          }
        }
      ),
    (error) => error.code === "LOCATION_GEOCODE_FAILED"
  );
}

console.log("D36 geocoding unit checks passed");
