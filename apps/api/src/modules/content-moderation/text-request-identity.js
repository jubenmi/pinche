import crypto from "node:crypto";

import { digestNormalizedText } from "./normalize.js";

function stableTextRequestJson(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableTextRequestJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableTextRequestJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function boundedIdempotencyKey(value) {
  return String(value ?? "").trim().slice(0, 128);
}

export function explicitTextIdempotencyKey(request, body) {
  const fromHeader = boundedIdempotencyKey(
    request?.headers?.["idempotency-key"] ?? request?.headers?.["Idempotency-Key"]
  );
  if (fromHeader) return fromHeader;
  return boundedIdempotencyKey(body?.idempotencyKey ?? body?.idempotency_key);
}

export function createTextMutationIdentity({
  request,
  rawBody,
  action,
  actorUserId,
  subjectId,
  baseVersion,
  payload
} = {}) {
  const explicitKey = explicitTextIdempotencyKey(request, rawBody);
  if (explicitKey) {
    return { idempotencyKey: explicitKey, explicit: true };
  }
  return {
    idempotencyKey: crypto.createHash("sha256").update(stableTextRequestJson({
      action: String(action || ""),
      actor_user_id: Number(actorUserId),
      subject_id: String(subjectId || ""),
      base_version: String(baseVersion || ""),
      payload
    }), "utf8").digest("hex"),
    explicit: false
  };
}

export function textOperationSubjectId({
  action,
  actorUserId,
  idempotencyKey
} = {}) {
  return `text-op:${crypto.createHash("sha256").update(stableTextRequestJson({
    action: String(action || ""),
    actor_user_id: Number(actorUserId),
    idempotency_key: String(idempotencyKey || "")
  }), "utf8").digest("hex")}`;
}

export function textCreationTargetSubjectId({ action, actorUserId } = {}) {
  return `creation:${String(action || "").trim()}:${Number(actorUserId)}`;
}

export function textSessionNpcRoleTargetSubjectId(sessionId) {
  return `session:${Number(sessionId)}`;
}

export function textMutationSubjectVersion({ normalizedText } = {}) {
  return digestNormalizedText(String(normalizedText || ""));
}
