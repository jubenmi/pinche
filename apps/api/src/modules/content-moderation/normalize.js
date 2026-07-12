import crypto from "node:crypto";

const DECISION_BY_SUGGESTION = Object.freeze({
  pass: "pass",
  review: "review",
  block: "block"
});

function firstValue(source, names) {
  for (const name of names) {
    if (source?.[name] !== undefined && source[name] !== null && source[name] !== "") {
      return source[name];
    }
  }
  return undefined;
}

function cleanString(value, maxLength) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLength);
}

export function normalizeProviderResult(payload) {
  const source = payload && typeof payload === "object"
    ? (payload.JobsDetail && typeof payload.JobsDetail === "object" ? payload.JobsDetail : payload)
    : {};
  const suggestion = cleanString(firstValue(source, ["Suggestion", "suggestion"]), 32);
  const decision = DECISION_BY_SUGGESTION[suggestion.toLowerCase()] || "error";
  const numericScore = Number(firstValue(source, ["Score", "score"]));

  return {
    decision,
    suggestion,
    label: cleanString(firstValue(source, ["Label", "label"]), 64),
    subLabel: cleanString(firstValue(source, ["SubLabel", "subLabel", "sublabel"]), 128),
    score: Number.isFinite(numericScore) ? Math.max(0, Math.min(100, Math.round(numericScore))) : null,
    providerJobId: cleanString(firstValue(source, ["JobId", "jobId", "TaskId", "taskId"]), 128),
    dataId: cleanString(firstValue(source, ["DataId", "dataId"]), 128)
  };
}

function normalizeFieldValue(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

export function normalizeTextFields(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new TypeError("text fields must be an object");
  }
  const normalized = [];
  for (const label of Object.keys(fields).sort()) {
    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(label)) {
      throw new TypeError(`invalid text field label: ${label}`);
    }
    const value = normalizeFieldValue(fields[label]);
    if (value) normalized.push(`[${label}]${value}`);
  }
  if (normalized.length === 0) {
    throw new TypeError("at least one non-empty text field is required");
  }
  return normalized.join("\n");
}

export function digestNormalizedText(normalizedText) {
  return crypto.createHash("sha256").update(String(normalizedText), "utf8").digest("hex");
}

export function createResponseSummary(result, { maxBytes = 4096 } = {}) {
  const summary = {
    decision: cleanString(result?.decision, 16),
    suggestion: cleanString(result?.suggestion, 32),
    label: cleanString(result?.label, 64),
    subLabel: cleanString(result?.subLabel, 128),
    score: Number.isFinite(Number(result?.score)) ? Number(result.score) : null,
    providerJobId: cleanString(result?.providerJobId, 128),
    dataId: cleanString(result?.dataId, 128)
  };
  const encoded = JSON.stringify(summary);
  if (Buffer.byteLength(encoded, "utf8") <= maxBytes) return summary;

  return {
    decision: summary.decision,
    suggestion: summary.suggestion,
    label: summary.label,
    score: summary.score
  };
}

