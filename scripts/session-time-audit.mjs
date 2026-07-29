import { withDatabaseConnection } from "../apps/api/src/db/mysql.js";
import {
  SESSION_TIME_AUDIT_QUERY,
  projectSessionTimeAuditRow
} from "../apps/api/src/modules/core/session-time-audit.js";

function parseLimit(args) {
  const option = args.find((value) => value.startsWith("--limit="));
  if (!option) return 200;
  const raw = option.slice("--limit=".length);
  if (!/^\d+$/.test(raw)) throw new Error("--limit must be an integer from 1 to 1000");
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("--limit must be an integer from 1 to 1000");
  }
  return limit;
}

const unsupported = process.argv.slice(2).find(
  (value) => !value.startsWith("--limit=")
);
if (unsupported) throw new Error(`unsupported option: ${unsupported}`);

const limit = parseLimit(process.argv.slice(2));
await withDatabaseConnection(async (connection) => {
  const [rows] = await connection.query(SESSION_TIME_AUDIT_QUERY, [limit]);
  for (const row of rows) {
    process.stdout.write(`${JSON.stringify(projectSessionTimeAuditRow(row))}\n`);
  }
});
