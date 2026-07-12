import crypto from "node:crypto";

import { notFound } from "../../http/errors.js";

export function stableTextSnapshotJson(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableTextSnapshotJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableTextSnapshotJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function createTextBaseline(snapshot) {
  const digest = crypto.createHash("sha256")
    .update(stableTextSnapshotJson(snapshot), "utf8")
    .digest("hex");
  return `v1:${digest}`;
}

export function requireInitialTextModerationTarget(row, label) {
  if (!row) throw notFound(`${label} not found`);
  return row;
}
