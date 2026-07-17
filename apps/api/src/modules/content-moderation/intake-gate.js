import { AppError } from "../../http/errors.js";

const INTAKE_RULES = Object.freeze({
  text: Object.freeze({
    modeKey: "textIntakeMode",
    providerKey: "wechatTextEnabled"
  }),
  image: Object.freeze({
    modeKey: "imageIntakeMode",
    providerKey: "wechatImageEnabled"
  }),
  video: Object.freeze({
    modeKey: "videoIntakeMode",
    providerKey: "tencentVideoEnabled"
  })
});

function intakeRule(type) {
  const rule = INTAKE_RULES[type];
  if (!rule) throw new TypeError(`Unsupported content moderation intake type: ${type}`);
  return rule;
}

/**
 * Resolve whether a new user submission may enter a D45 moderation flow.
 *
 * Provider flags deliberately do not mean "bypass moderation". In moderated
 * mode they are a readiness prerequisite; disabled providers reject intake so
 * a route can never fall back to an unmoderated business write.
 */
export function resolveContentModerationIntake(moderationConfig, type, fallback = {}) {
  const rule = intakeRule(type);
  const mode = moderationConfig?.[rule.modeKey];
  if (!new Set(["legacy", "closed", "moderated"]).has(mode)) {
    throw new TypeError(`Unsupported content moderation intake mode: ${mode}`);
  }
  if (mode === "closed") {
    return { accepting: false, mode, moderationRequired: false, reason: "closed" };
  }
  if (moderationConfig?.enabled && moderationConfig?.[rule.providerKey]) {
    return { accepting: true, mode: "moderated", moderationRequired: true, reason: "ready" };
  }
  const fallbackBlocking = Boolean(
    fallback.fallbackBlocking || fallback?.types?.[type] || fallback?.[`${type}Blocking`]
  );
  if (fallbackBlocking) {
    return { accepting: false, mode: "closed", moderationRequired: false, reason: "fallback_blocked" };
  }
  return { accepting: true, mode: "legacy", moderationRequired: false, reason: "legacy" };
}

export function assertContentModerationIntake(moderationConfig, type, fallback) {
  const intake = resolveContentModerationIntake(moderationConfig, type, fallback);
  if (intake.accepting) return intake;
  throw new AppError(
    503,
    "CONTENT_MODERATION_INTAKE_CLOSED",
    "New content submissions are temporarily unavailable"
  );
}
