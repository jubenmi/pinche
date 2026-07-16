import {
  normalizeNpcRoles,
  normalizePrivateRoleTemplate
} from "../core/npc-role-normalization.js";
import { badRequest } from "../../http/errors.js";

const PHONE_NUMBER = /(?:\+?86[\s-]?)?1[3-9]\d(?:[\s-]?\d){8}/g;
const MAX_SESSION_REVIEW_PHOTOS = 9;
const SESSION_REVIEW_PHOTO_PATH = /^\/uploads\/session-reviews\/[A-Za-z0-9._-]+$/;
const AVATAR_UPLOAD_PATH = /^\/uploads\/avatars\/[A-Za-z0-9._-]+$/;
const PUBLIC_TEXT_RISK_WORDS = [
  "红包",
  "返现",
  "提现",
  "现金奖励",
  "分享奖励",
  "拉人奖励",
  "拉新奖励",
  "抽奖",
  "优先锁座",
  "现实陪伴",
  "线下陪伴",
  "联系方式",
  "手机号",
  "微信号",
  "加微信",
  "牵手",
  "小黑屋",
  "恋陪",
  "爱D"
];
const MESSAGE_TEXT_RISK_WORDS = [
  "红包",
  "返现",
  "提现",
  "现金奖励",
  "分享奖励",
  "拉人奖励",
  "拉新奖励",
  "抽奖",
  "收款码",
  "平台代收"
];
const SESSION_CONTEXT_ACTIONS = new Set([
  "update_session",
  "create_session_npc_role",
  "update_session_npc_role",
  "upsert_session_review",
  "create_session_message",
  "update_session_pinned_message"
]);

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function textValue(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map((item) => String(item)).join(" ").trim();
  return String(value).trim();
}

function addField(target, label, value) {
  const text = textValue(value);
  if (text) target[label] = redactPhoneNumbers(text);
}

function putIfDefined(target, key, value) {
  if (value !== undefined) target[key] = value;
}

function pickDefined(target, body, keys) {
  for (const key of keys) {
    if (own(body, key) && body[key] !== undefined) target[key] = body[key];
  }
}

function requireBodyValue(body, key) {
  const value = body[key];
  if (value === undefined || value === null || value === "") {
    throw badRequest(`${key} is required`);
  }
  return value;
}

function integerValue(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) throw badRequest("Expected integer value");
  return parsed;
}

function positiveIntegerValue(value, label) {
  const parsed = integerValue(value);
  if (parsed <= 0) throw badRequest(`${label} must be a positive integer`);
  return parsed;
}

function nonNegativeIntegerValue(value, label) {
  const parsed = integerValue(value);
  if (parsed < 0) throw badRequest(`${label} cannot be negative`);
  return parsed;
}

function optionalCoordinate(value, label, min, max) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw badRequest(`${label} must be a finite number`);
  if (number < min || number > max) throw badRequest(`${label} must be between ${min} and ${max}`);
  return number;
}

function assertPublicTextSafe(label, value) {
  if (value === undefined || value === null || value === "") return;
  const text = String(value);
  const riskWord = PUBLIC_TEXT_RISK_WORDS.find((word) => text.includes(word));
  if (riskWord || /(^|[^\d])1[3-9]\d{9}($|[^\d])/.test(text)) {
    throw badRequest(`${label} contains public risk text`);
  }
}

function assertMessageTextSafe(label, value) {
  if (value === undefined || value === null || value === "") return;
  const riskWord = MESSAGE_TEXT_RISK_WORDS.find((word) => String(value).includes(word));
  if (riskWord) throw badRequest(`${label} contains transaction risk text`);
}

function normalizeSessionVisibility(value) {
  const visibility = String(value === undefined ? "share_only" : value).trim();
  if (!["public", "share_only"].includes(visibility)) {
    throw badRequest("visibility must be public or share_only");
  }
  return visibility;
}

function normalizeJoinPolicy(value) {
  const policy = String(value || "review_required").trim();
  if (!["direct", "review_required"].includes(policy)) {
    throw badRequest("joinPolicy must be direct or review_required");
  }
  return policy;
}

function normalizeOptionalBoolean(value, label, trueValues, falseValues) {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (trueValues.includes(normalized)) return true;
  if (falseValues.includes(normalized)) return false;
  throw badRequest(`${label} must be true or false`);
}

function canonicalRoleTemplate(body, playerCount = body.playerCount) {
  const value = body.defaultSeatTemplate ?? body.defaultSeatTemplateJson;
  if (value === undefined) return undefined;
  const roles = normalizePrivateRoleTemplate(value, playerCount);
  for (const role of roles) {
    assertPublicTextSafe("roleName", role.name);
    assertPublicTextSafe("roleDescription", role.description);
  }
  return roles;
}

function persistedNpcRole(role) {
  if (!role) return null;
  const { id: _id, ...persisted } = role;
  return persisted;
}

function canonicalSessionNpcRoles(body) {
  const value = body.extraNpcRoles ?? body.extra_npc_roles;
  if (value === undefined) return undefined;
  return normalizeNpcRoles(value, { source: "session" })
    .map((role) => {
      assertPublicTextSafe("npcRoleName", role.name);
      assertPublicTextSafe("npcRoleDescription", role.description);
      return persistedNpcRole(role);
    });
}

function canonicalStandaloneNpcRole(body) {
  const role = normalizeNpcRoles([body], { source: "session" })[0];
  if (role) {
    assertPublicTextSafe("npcRoleName", role.name);
    assertPublicTextSafe("npcRoleDescription", role.description);
  }
  return persistedNpcRole(role);
}

function canonicalContext(action, value) {
  const context = {};
  const targetSubjectId = String(value?.targetSubjectId || "").trim();
  if (targetSubjectId) context.targetSubjectId = targetSubjectId.slice(0, 128);
  if (!SESSION_CONTEXT_ACTIONS.has(action)) return context;
  const sessionId = Number(value?.sessionId);
  if (Number.isInteger(sessionId) && sessionId > 0) context.sessionId = sessionId;
  return context;
}

function canonicalUpdateNpcRole(body) {
  const result = {};
  pickDefined(result, body, ["name", "source", "status"]);
  if (body.description !== undefined || body.note !== undefined) {
    result.description = body.description ?? body.note;
  }
  if (body.roleGender !== undefined || body.role_gender !== undefined || body.gender !== undefined) {
    const gender = String((body.roleGender ?? body.role_gender ?? body.gender) || "unlimited").trim();
    if (!["male", "female", "unlimited"].includes(gender)) {
      throw badRequest("roleGender must be male, female, or unlimited");
    }
    result.roleGender = gender;
  }
  if (
    body.boundUserId !== undefined || body.bound_user_id !== undefined ||
    body.userId !== undefined || body.user_id !== undefined
  ) {
    const boundUserId = body.boundUserId ?? body.bound_user_id ?? body.userId ?? body.user_id;
    result.boundUserId = boundUserId === null || boundUserId === ""
      ? null
      : positiveIntegerValue(boundUserId, "boundUserId");
  }
  if (body.sortOrder !== undefined || body.sort_order !== undefined) {
    result.sortOrder = nonNegativeIntegerValue(body.sortOrder ?? body.sort_order, "sortOrder");
  }
  if (result.source !== undefined) {
    result.source = String(result.source || "session").trim();
    if (!["script", "session"].includes(result.source)) {
      throw badRequest("npc role source must be script or session");
    }
  }
  if (result.status !== undefined) {
    result.status = String(result.status || "").trim();
    if (!["active", "inactive"].includes(result.status)) {
      throw badRequest("npc role status must be active or inactive");
    }
  }
  assertPublicTextSafe("npcRoleName", result.name);
  assertPublicTextSafe("npcRoleDescription", result.description);
  return result;
}

function canonicalProfileNickname(value) {
  const nickname = String(value || "").trim();
  if (!nickname) return null;
  if (nickname.length > 32) throw badRequest("nickname must be 32 characters or less");
  return nickname;
}

function canonicalProfileAvatarUrl(value) {
  const avatarUrl = String(value || "").trim();
  if (!avatarUrl) return null;
  if (avatarUrl.length > 512) throw badRequest("avatarUrl must be 512 characters or less");
  if (!AVATAR_UPLOAD_PATH.test(avatarUrl)) {
    throw badRequest("avatarUrl must be an uploaded avatar path");
  }
  return avatarUrl;
}

function canonicalProfileGender(value) {
  const gender = String(value || "").trim();
  if (!["male", "female"].includes(gender)) {
    throw badRequest("gender must be male or female");
  }
  return gender;
}

function canonicalProfilePatch(body) {
  const result = {};
  if (own(body, "nickname")) result.nickname = canonicalProfileNickname(body.nickname);
  if (own(body, "avatarUrl")) result.avatarUrl = canonicalProfileAvatarUrl(body.avatarUrl);
  if (own(body, "gender")) result.gender = canonicalProfileGender(body.gender);
  return result;
}

function canonicalReviewPhotoUrls(value) {
  if (!Array.isArray(value)) throw badRequest("photoUrls must be an array");
  if (value.length > MAX_SESSION_REVIEW_PHOTOS) {
    throw badRequest(`photoUrls cannot contain more than ${MAX_SESSION_REVIEW_PHOTOS} photos`);
  }
  return value.map((url) => {
    const path = String(url || "").trim();
    if (!SESSION_REVIEW_PHOTO_PATH.test(path)) {
      throw badRequest("photoUrls must contain uploaded session review photos");
    }
    return path;
  });
}

function canonicalBody(action, body) {
  const result = {};
  switch (action) {
    case "update_nickname":
      return canonicalProfilePatch(body);
    case "create_private_store": {
      requireBodyValue(body, "name");
      requireBodyValue(body, "city");
      pickDefined(result, body, [
        "name", "city", "district", "address", "latitude", "longitude", "contactNote"
      ]);
      if (body.latitude !== undefined) {
        result.latitude = optionalCoordinate(body.latitude, "latitude", -90, 90);
      }
      if (body.longitude !== undefined) {
        result.longitude = optionalCoordinate(body.longitude, "longitude", -180, 180);
      }
      for (const key of ["name", "city", "district", "address", "contactNote"]) {
        assertPublicTextSafe(key, result[key]);
      }
      return result;
    }
    case "create_private_script": {
      requireBodyValue(body, "name");
      const playerCount = positiveIntegerValue(requireBodyValue(body, "playerCount"), "playerCount");
      pickDefined(result, body, ["name", "typeTags", "summaryNoSpoiler"]);
      result.playerCount = playerCount;
      assertPublicTextSafe("name", result.name);
      assertPublicTextSafe(
        "typeTags",
        Array.isArray(result.typeTags) ? result.typeTags.join(" ") : result.typeTags
      );
      assertPublicTextSafe("summaryNoSpoiler", result.summaryNoSpoiler);
      const template = canonicalRoleTemplate(body, playerCount);
      if (template !== undefined) result.defaultSeatTemplate = template;
      return result;
    }
    case "create_session": {
      requireBodyValue(body, "storeId");
      requireBodyValue(body, "scriptId");
      requireBodyValue(body, "startAt");
      pickDefined(result, body, [
        "storeId", "scriptId", "startAt", "dmUserId", "dmNameSnapshot", "npcUserId",
        "npcNameSnapshot", "depositAmount", "visibility", "note", "pinnedMessageText"
      ]);
      if (body.depositAmount !== undefined) result.depositAmount = integerValue(body.depositAmount);
      if (body.visibility !== undefined) result.visibility = normalizeSessionVisibility(body.visibility);
      assertPublicTextSafe("dmNameSnapshot", result.dmNameSnapshot);
      assertPublicTextSafe("npcNameSnapshot", result.npcNameSnapshot);
      if (body.joinPolicy !== undefined || body.join_policy !== undefined) {
        result.joinPolicy = normalizeJoinPolicy(body.joinPolicy ?? body.join_policy);
      }
      if (body.joinPhoneRequired !== undefined || body.join_phone_required !== undefined) {
        result.joinPhoneRequired = normalizeOptionalBoolean(
          body.joinPhoneRequired ?? body.join_phone_required,
          "joinPhoneRequired",
          ["1", "true", "required", "enabled"],
          ["0", "false", "optional", "disabled"]
        );
      }
      if (body.npcJoinEnabled !== undefined || body.npc_join_enabled !== undefined) {
        result.npcJoinEnabled = normalizeOptionalBoolean(
          body.npcJoinEnabled ?? body.npc_join_enabled,
          "npcJoinEnabled",
          ["1", "true", "enabled"],
          ["0", "false", "disabled"]
        );
      }
      const roles = canonicalSessionNpcRoles(body);
      if (roles !== undefined) result.extraNpcRoles = roles;
      return result;
    }
    case "update_session":
      pickDefined(result, body, [
        "startAt", "dmUserId", "dmNameSnapshot", "npcUserId", "npcNameSnapshot",
        "depositAmount", "visibility", "note", "status"
      ]);
      if (body.visibility !== undefined) result.visibility = normalizeSessionVisibility(body.visibility);
      assertPublicTextSafe("dmNameSnapshot", result.dmNameSnapshot);
      assertPublicTextSafe("npcNameSnapshot", result.npcNameSnapshot);
      if (body.joinPolicy !== undefined || body.join_policy !== undefined) {
        result.joinPolicy = normalizeJoinPolicy(body.joinPolicy ?? body.join_policy);
      }
      if (body.joinPhoneRequired !== undefined || body.join_phone_required !== undefined) {
        result.joinPhoneRequired = normalizeOptionalBoolean(
          body.joinPhoneRequired ?? body.join_phone_required,
          "joinPhoneRequired",
          ["1", "true", "required", "enabled"],
          ["0", "false", "optional", "disabled"]
        );
      }
      if (body.npcJoinEnabled !== undefined || body.npc_join_enabled !== undefined) {
        result.npcJoinEnabled = normalizeOptionalBoolean(
          body.npcJoinEnabled ?? body.npc_join_enabled,
          "npcJoinEnabled",
          ["1", "true", "enabled"],
          ["0", "false", "disabled"]
        );
      }
      return result;
    case "create_session_npc_role": {
      const role = canonicalStandaloneNpcRole(body);
      return role || result;
    }
    case "update_session_npc_role":
      return canonicalUpdateNpcRole(body);
    case "upsert_session_review": {
      const rating = integerValue(body.rating);
      if (rating < 1 || rating > 5) throw badRequest("rating must be between 1 and 5");
      const content = body.content === undefined || body.content === null ? null : String(body.content);
      if (content && content.length > 500) throw badRequest("content must be 500 characters or fewer");
      assertPublicTextSafe("content", content);
      pickDefined(result, body, ["rating", "content"]);
      result.rating = rating;
      if (body.content !== undefined) result.content = content;
      if (body.photoUrls !== undefined) {
        result.photoUrls = canonicalReviewPhotoUrls(body.photoUrls);
      }
      return result;
    }
    case "create_session_message": {
      const content = String(requireBodyValue(body, "content")).trim();
      if (!content) throw badRequest("content is required");
      if (content.length > 500) throw badRequest("content must be 500 characters or fewer");
      assertMessageTextSafe("content", content);
      result.content = content;
      return result;
    }
    case "update_session_pinned_message":
      if (body.pinnedMessageText !== undefined || body.content !== undefined) {
        const pinnedMessageText = body.pinnedMessageText === undefined
          ? body.content
          : body.pinnedMessageText;
        const content = String(pinnedMessageText || "").trim();
        if (content.length > 300) throw badRequest("pinnedMessageText must be 300 characters or fewer");
        assertMessageTextSafe("pinnedMessageText", content);
        result.pinnedMessageText = content;
      }
      return result;
    default:
      throw new TypeError(`unsupported text moderation action: ${action}`);
  }
}

function addRoleTemplateFields(target, roles) {
  for (const [index, role] of (roles || []).entries()) {
    const label = `role_${index + 1}`;
    addField(target, `${label}_name`, role.name);
    addField(target, `${label}_description`, role.description);
  }
}

function addNpcRoleFields(target, roles) {
  for (const [index, role] of (roles || []).entries()) {
    const label = `extra_npc_${index + 1}`;
    addField(target, `${label}_name`, role.name);
    addField(target, `${label}_description`, role.description);
  }
}

function actionDefinition(action, body) {
  const fields = {};
  switch (action) {
    case "update_nickname":
      addField(fields, "nickname", body.nickname);
      return { subjectType: "user_nickname", fields };
    case "create_private_store":
      addField(fields, "name", body.name);
      addField(fields, "city", body.city);
      addField(fields, "district", body.district);
      addField(fields, "address", body.address);
      addField(fields, "contact_note", body.contactNote);
      return { subjectType: "private_store", fields };
    case "create_private_script":
      addField(fields, "name", body.name);
      addField(fields, "type_tags", body.typeTags);
      addField(fields, "summary", body.summaryNoSpoiler);
      addRoleTemplateFields(fields, body.defaultSeatTemplate);
      return { subjectType: "private_script", fields };
    case "create_session":
      addField(fields, "dm_name", body.dmNameSnapshot);
      addField(fields, "npc_name", body.npcNameSnapshot);
      addField(fields, "note", body.note);
      addField(fields, "pinned_message", body.pinnedMessageText);
      addNpcRoleFields(fields, body.extraNpcRoles);
      return { subjectType: "session_create", fields };
    case "update_session":
      addField(fields, "dm_name", body.dmNameSnapshot);
      addField(fields, "npc_name", body.npcNameSnapshot);
      addField(fields, "note", body.note);
      return { subjectType: "session_update", fields };
    case "create_session_npc_role":
    case "update_session_npc_role":
      addField(fields, "name", body.name);
      addField(fields, "description", body.description);
      return { subjectType: "session_npc_role", fields };
    case "upsert_session_review":
      addField(fields, "content", body.content);
      return { subjectType: "session_review", fields };
    case "create_session_message":
      addField(fields, "content", body.content);
      return { subjectType: "session_message", fields };
    case "update_session_pinned_message":
      addField(fields, "content", body.pinnedMessageText);
      return { subjectType: "session_pinned_message", fields };
    default:
      throw new TypeError(`unsupported text moderation action: ${action}`);
  }
}

export function redactPhoneNumbers(value) {
  return String(value ?? "").replace(PHONE_NUMBER, "[phone]");
}

export function parseTextDraftReplacement(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const snake = own(body, "replaces_draft_id");
  const camel = own(body, "replacesDraftId");
  if (snake && camel) throw badRequest("Only one replacement draft id is allowed");
  if (!snake && !camel) return null;
  const value = snake ? body.replaces_draft_id : body.replacesDraftId;
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^[1-9]\d*$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw badRequest("replaces_draft_id must be a positive integer");
  }
  return parsed;
}

export function buildTextProposalPayload(action, input = {}) {
  const rawBody = input?.body && typeof input.body === "object" && !Array.isArray(input.body)
    ? input.body
    : input && typeof input === "object" && !Array.isArray(input)
      ? input
      : {};
  const rawContext = input?.context && typeof input.context === "object" && !Array.isArray(input.context)
    ? input.context
    : {};
  return {
    body: canonicalBody(String(action || "").trim(), rawBody),
    context: canonicalContext(String(action || "").trim(), rawContext)
  };
}

export function buildTextModerationDescriptor(input = {}) {
  const action = String(input.action || "").trim();
  const payload = buildTextProposalPayload(action, {
    body: input.body,
    context: input.context
  });
  const definition = actionDefinition(action, payload.body);
  if (Object.keys(definition.fields).length === 0) return null;
  return {
    action,
    subjectType: definition.subjectType,
    subjectId: String(input.subjectId || ""),
    actorUserId: Number(input.actorUserId),
    openid: String(input.openid || "").trim(),
    baseVersion: String(input.baseVersion || ""),
    idempotencyKey: String(input.idempotencyKey || ""),
    idempotencyExplicit: input.idempotencyExplicit === true,
    replacesDraftId: input.replacesDraftId === null || input.replacesDraftId === undefined
      ? null
      : Number(input.replacesDraftId),
    fields: definition.fields,
    payload
  };
}
