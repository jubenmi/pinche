function registryError(code, details) {
  const error = new Error(`migration registry failed: ${code}`);
  error.code = code;
  error.details = details;
  return error;
}

function assertFilename(filename) {
  if (!/^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/.test(String(filename || ""))) {
    throw registryError("MIGRATION_HANDLER_FILENAME_INVALID", { filename });
  }
}

export function createMigrationRegistry(initialEntries = []) {
  const handlers = new Map();
  const registry = {
    register(filename, handler = {}) {
      assertFilename(filename);
      if (handlers.has(filename)) {
        throw registryError("MIGRATION_HANDLER_CONFLICT", { filename });
      }
      if (
        handler.before !== undefined && typeof handler.before !== "function" ||
        handler.reconcile !== undefined && typeof handler.reconcile !== "function"
      ) {
        throw registryError("MIGRATION_HANDLER_INVALID", { filename });
      }
      handlers.set(filename, Object.freeze({ ...handler }));
      return registry;
    },
    async prepare(connection, filename) {
      const handler = handlers.get(filename);
      if (!handler) return { skipStatements: false };
      await handler.before?.(connection, filename);
      await handler.reconcile?.(connection, filename);
      return { skipStatements: handler.skipSql === true };
    },
    filenames() {
      return Object.freeze([...handlers.keys()].sort());
    }
  };
  for (const [filename, handler] of initialEntries) registry.register(filename, handler);
  return registry;
}

export function registerMigrationHandler(registry, filename, handler) {
  return registry.register(filename, handler);
}
