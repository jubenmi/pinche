import { pathToFileURL } from "node:url";

import { createApp } from "./app/create-app.js";
import { config } from "./config/env.js";

export { createApp } from "./app/create-app.js";
export * from "./legacy-app.js";

export function startServer({ app = createApp(), runtimeConfig = config, logger = console } = {}) {
  const listenOptions = process.env.D46_SMOKE_ISOLATED === "1"
    ? { port: runtimeConfig.port, host: "127.0.0.1" }
    : { port: runtimeConfig.port };
  app.listen(listenOptions, () => {
    logger.log(JSON.stringify({
      ok: true,
      service: "pinche-api",
      port: runtimeConfig.port,
      nodeEnv: runtimeConfig.nodeEnv,
    }));
  });
  return app;
}

export function installShutdownHandlers(app, { runtime = process, logger = console } = {}) {
  let closing = false;
  const listeners = new Map(["SIGTERM", "SIGINT"].map((signal) => [signal, () => {
    if (closing) return;
    closing = true;
    app.close((error) => {
      if (!error) return;
      runtime.exitCode = 1;
      logger.error(JSON.stringify({ ok: false, service: "pinche-api", event: "shutdown_failed" }));
    });
  }]));
  for (const [signal, listener] of listeners) runtime.once(signal, listener);
  return () => {
    for (const [signal, listener] of listeners) runtime.removeListener(signal, listener);
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  installShutdownHandlers(startServer());
}
