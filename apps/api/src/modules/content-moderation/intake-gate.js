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
export function resolveContentModerationIntake(moderationConfig, type) {
  const rule = intakeRule(type);
  const mode = moderationConfig?.[rule.modeKey];
  if (!new Set(["legacy", "closed", "moderated"]).has(mode)) {
    throw new TypeError(`Unsupported content moderation intake mode: ${mode}`);
  }
  if (mode === "legacy") {
    return { accepting: true, mode, moderationRequired: false, reason: "legacy" };
  }
  if (mode === "closed") {
    return { accepting: false, mode, moderationRequired: false, reason: "closed" };
  }
  if (!moderationConfig?.enabled) {
    return { accepting: false, mode, moderationRequired: true, reason: "moderation_disabled" };
  }
  if (!moderationConfig?.[rule.providerKey]) {
    return { accepting: false, mode, moderationRequired: true, reason: "provider_disabled" };
  }
  return { accepting: true, mode, moderationRequired: true, reason: "ready" };
}

export function assertContentModerationIntake(moderationConfig, type) {
  const intake = resolveContentModerationIntake(moderationConfig, type);
  if (intake.accepting) return intake;
  throw new AppError(
    503,
    "CONTENT_MODERATION_INTAKE_CLOSED",
    "New content submissions are temporarily unavailable"
  );
}
