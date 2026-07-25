const BODY_KINDS = new Set(["none", "json", "raw", "stream"]);
const AUTH_KINDS = new Set(["none", "optional", "required", "system_admin"]);
const PARAMETER = /^:([A-Za-z][A-Za-z0-9_]*)$/;

function routeError(code, message) {
  return Object.assign(new TypeError(message), { code });
}

function escaped(segment) {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compilePath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || (path.length > 1 && path.endsWith("/"))) {
    throw routeError("ROUTE_DEFINITION_INVALID", "route path must be an absolute canonical path");
  }
  const names = [];
  let staticSegments = 0;
  const segments = path === "/" ? [] : path.slice(1).split("/");
  const pattern = segments.map((segment) => {
    const parameter = PARAMETER.exec(segment);
    if (!parameter) {
      if (!segment || segment.includes(":")) {
        throw routeError("ROUTE_DEFINITION_INVALID", "route path contains an invalid segment");
      }
      staticSegments += 1;
      return escaped(segment);
    }
    const name = parameter[1];
    if (names.includes(name)) {
      throw routeError("ROUTE_DEFINITION_INVALID", "route parameter names must be unique");
    }
    names.push(name);
    return "([^/]+)";
  }).join("/");
  return {
    names,
    pattern: new RegExp(path === "/" ? "^/$" : `^/${pattern}$`),
    score: staticSegments * 100 + segments.length,
  };
}

function normalizedDefinition(definition) {
  const method = String(definition?.method || "").toUpperCase();
  const name = String(definition?.name || "");
  const path = definition?.path;
  const auth = definition?.auth || "none";
  const body = Object.freeze({ kind: "none", ...(definition?.body || {}) });
  if (!/^[A-Z]+$/.test(method) || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(name)) {
    throw routeError("ROUTE_DEFINITION_INVALID", "route method and name are required");
  }
  if (!BODY_KINDS.has(body.kind) || !AUTH_KINDS.has(auth)) {
    throw routeError("ROUTE_DEFINITION_INVALID", "route body or auth declaration is invalid");
  }
  if (typeof definition?.handler !== "function") {
    throw routeError("ROUTE_DEFINITION_INVALID", "route handler is required");
  }
  if (body.maxBytes !== undefined && (!Number.isSafeInteger(body.maxBytes) || body.maxBytes < 0)) {
    throw routeError("ROUTE_DEFINITION_INVALID", "route body maxBytes is invalid");
  }
  const compiled = compilePath(path);
  return Object.freeze({
    method,
    path,
    name,
    auth,
    body,
    handler: definition.handler,
    _names: Object.freeze(compiled.names),
    _pattern: compiled.pattern,
    _score: compiled.score,
  });
}

function publicRoute(route) {
  return Object.freeze({
    method: route.method,
    path: route.path,
    name: route.name,
    auth: route.auth,
    body: route.body,
    handler: route.handler,
  });
}

export function createRouter() {
  const routes = [];
  const keys = new Set();

  function register(definition) {
    const route = normalizedDefinition(definition);
    const key = `${route.method} ${route.path}`;
    if (keys.has(key)) {
      throw routeError("ROUTE_DUPLICATE", `duplicate route: ${key}`);
    }
    keys.add(key);
    routes.push(route);
    routes.sort((left, right) => right._score - left._score);
    return publicRoute(route);
  }

  function match(method, pathname) {
    const normalizedMethod = String(method || "").toUpperCase();
    for (const route of routes) {
      if (route.method !== normalizedMethod) continue;
      const matched = route._pattern.exec(pathname);
      if (!matched) continue;
      let values;
      try {
        values = matched.slice(1).map(decodeURIComponent);
      } catch {
        return null;
      }
      return {
        route: publicRoute(route),
        params: Object.freeze(Object.fromEntries(route._names.map((name, index) => [name, values[index]]))),
      };
    }
    return null;
  }

  async function dispatch({ method, pathname, context = {} }) {
    const matched = match(method, pathname);
    if (!matched) return { handled: false };
    const value = await matched.route.handler({ ...context, params: matched.params, route: matched.route });
    return { handled: true, route: matched.route, params: matched.params, value };
  }

  function mount(router) {
    if (!router || !Array.isArray(router.definitions)) {
      throw routeError("ROUTE_DEFINITION_INVALID", "mounted router is invalid");
    }
    for (const definition of router.definitions) register(definition);
    return api;
  }

  const api = Object.freeze({
    register,
    match,
    dispatch,
    mount,
    get definitions() {
      return Object.freeze(routes.map(publicRoute));
    },
  });
  return api;
}
