import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { installShutdownHandlers } from "../src/server.js";

const sourceRoot = new URL("../src/", import.meta.url);

test("server is a bounded process entrypoint while legacy routing is explicitly isolated", async () => {
  const [server, legacy] = await Promise.all([
    readFile(new URL("server.js", sourceRoot), "utf8"),
    readFile(new URL("legacy-app.js", sourceRoot), "utf8"),
  ]);

  assert.ok(server.split(/\r?\n/).length <= 80, "server entrypoint must remain bounded");
  assert.match(server, /createApp/);
  assert.match(server, /startServer/);
  assert.match(server, /export \* from "\.\/legacy-app\.js"/);
  assert.doesNotMatch(server, /url\.pathname|withTransaction|readBody/);
  assert.match(legacy, /export async function legacyRoute/);
  assert.doesNotMatch(legacy, /\.listen\(/);
  assert.doesNotMatch(legacy, /errorResponse\(response, 404, "NOT_FOUND"/);
});

test("process shutdown signals close the HTTP server once", () => {
  const runtime = new EventEmitter();
  runtime.exitCode = 0;
  let closes = 0;
  const app = {
    close(callback) {
      closes += 1;
      callback();
    },
  };

  const dispose = installShutdownHandlers(app, { runtime, logger: { error() {} } });
  runtime.emit("SIGTERM");
  runtime.emit("SIGINT");
  dispose();

  assert.equal(closes, 1);
  assert.equal(runtime.listenerCount("SIGTERM"), 0);
  assert.equal(runtime.listenerCount("SIGINT"), 0);
});
