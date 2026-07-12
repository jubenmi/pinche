import { digestNormalizedText } from "./normalize.js";

// This is intentionally the same stable encoding used when a proposal is
// first persisted. Retry code must recompute it rather than relying only on
// the text hash: a payload can contain non-text business fields that the
// proposal applicator will later use.
export function stableTextProposalJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableTextProposalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableTextProposalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function textProposalPayloadDigest({
  action,
  baseVersion,
  normalizedText,
  normalizedPayload
} = {}) {
  return digestNormalizedText(stableTextProposalJson({
    action: String(action || ""),
    baseVersion: String(baseVersion || ""),
    normalizedText: String(normalizedText || ""),
    payload: normalizedPayload
  }));
}
