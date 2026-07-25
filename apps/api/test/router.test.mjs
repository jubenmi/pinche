import assert from "node:assert/strict";
import test from "node:test";

import { createRouter } from "../src/http/router.js";

function route(overrides = {}) {
  return {
    method: "GET",
    path: "/api/items/:itemId",
    name: "items.show",
    body: { kind: "none" },
    auth: "optional",
    async handler(context) {
      return context.params;
    },
    ...overrides,
  };
}

test("router distinguishes static, parameter, and method matches", async () => {
  const router = createRouter();
  router.register(route({ path: "/api/items/special", name: "items.special" }));
  router.register(route());
  router.register(route({ method: "POST", name: "items.update", body: { kind: "json" } }));

  assert.equal(router.match("GET", "/api/items/special").route.name, "items.special");
  const parameter = router.match("GET", "/api/items/a%20b");
  assert.equal(parameter.route.name, "items.show");
  assert.deepEqual(parameter.params, { itemId: "a b" });
  assert.equal(router.match("POST", "/api/items/7").route.name, "items.update");
  assert.equal(router.match("DELETE", "/api/items/7"), null);
});

test("router rejects duplicate method and path registrations at startup", () => {
  const router = createRouter();
  router.register(route());
  assert.throws(() => router.register(route({ name: "items.duplicate" })), {
    code: "ROUTE_DUPLICATE",
  });
});

test("router validates route name, body policy, auth declaration, and path shape", () => {
  for (const invalid of [
    { name: "" },
    { body: { kind: "unbounded" } },
    { auth: "sometimes" },
    { path: "api/items" },
    { path: "/api/:id/:id" },
  ]) {
    assert.throws(() => createRouter().register(route(invalid)), {
      code: "ROUTE_DEFINITION_INVALID",
    });
  }
});

test("dispatch exposes immutable metadata and returns an explicit handled result", async () => {
  const router = createRouter();
  router.register(route());
  const result = await router.dispatch({
    method: "GET",
    pathname: "/api/items/42",
    context: { marker: "context" },
  });

  assert.equal(result.handled, true);
  assert.deepEqual(result.value, { itemId: "42" });
  assert.equal(result.route.name, "items.show");
  assert.deepEqual(result.route.body, { kind: "none" });
  assert.equal(result.route.auth, "optional");
  assert.equal(Object.isFrozen(result.route), true);
  assert.deepEqual(await router.dispatch({ method: "GET", pathname: "/missing" }), {
    handled: false,
  });
});
