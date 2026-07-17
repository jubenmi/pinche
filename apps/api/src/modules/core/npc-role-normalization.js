import { badRequest } from "../../http/errors.js";

function intValue(value, fallback = 0) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw badRequest("Expected integer value");
  }
  return parsed;
}

function positiveId(value, label = "id") {
  const parsed = intValue(value);
  if (parsed <= 0) {
    throw badRequest(`${label} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeIntValue(value, label) {
  const parsed = intValue(value, 0);
  if (parsed < 0) {
    throw badRequest(`${label} cannot be negative`);
  }
  return parsed;
}

function optionalText(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

export function normalizeRoleGender(value) {
  const roleGender = String(value || "unlimited").trim();
  if (!["male", "female", "unlimited"].includes(roleGender)) {
    throw badRequest("roleGender must be male, female, or unlimited");
  }
  return roleGender;
}

export function parseRoleTemplate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      throw badRequest("defaultSeatTemplate must be a valid JSON array");
    }
  }
  throw badRequest("defaultSeatTemplate must be an array");
}

export function normalizeRoleTemplateItem(role = {}, index = 0) {
  const name = String(
    role.name || role.roleName || role.role_name || `角色${index + 1}`
  ).trim();
  const description = String(
    role.description ||
      role.roleDescription ||
      role.role_description ||
      role.roleName ||
      role.role_name ||
      ""
  ).trim();
  return {
    ...(role.id ? { id: String(role.id) } : {}),
    name: name || `角色${index + 1}`,
    description,
    roleGender: normalizeRoleGender(role.roleGender || role.role_gender)
  };
}

export function defaultPrivateRoleTemplate(playerCount) {
  return Array.from({ length: playerCount }, (_, index) => ({
    name: `角色${index + 1}`,
    description: "",
    roleGender: "unlimited"
  }));
}

export function normalizePrivateRoleTemplate(value, playerCount) {
  const parsed = parseRoleTemplate(value) || defaultPrivateRoleTemplate(playerCount);
  return parsed.map(normalizeRoleTemplateItem);
}

export function parseNpcRoles(value) {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return String(value)
        .split(/\r?\n|[，,]/)
        .map((name) => ({ name }));
    }
  }
  throw badRequest("npcRoles must be an array");
}

export function normalizeNpcRoleSource(value, fallback = "session") {
  const source = String(value || fallback).trim();
  if (!["script", "session"].includes(source)) {
    throw badRequest("npc role source must be script or session");
  }
  return source;
}

export function normalizeNpcRole(role = {}, index = 0, options = {}) {
  const sourceRole = typeof role === "string" ? { name: role } : role || {};
  const name = String(
    sourceRole.name || sourceRole.roleName || sourceRole.role_name || sourceRole.label || ""
  ).trim();
  if (!name) {
    return null;
  }
  const boundUserValue =
    sourceRole.boundUserId ?? sourceRole.bound_user_id ?? sourceRole.userId ?? sourceRole.user_id;
  return {
    ...(sourceRole.id ? { id: Number(sourceRole.id) } : {}),
    ...(sourceRole.scriptNpcRoleId || sourceRole.script_npc_role_id
      ? {
          scriptNpcRoleId: positiveId(
            sourceRole.scriptNpcRoleId || sourceRole.script_npc_role_id,
            "scriptNpcRoleId"
          )
        }
      : {}),
    name,
    description: optionalText(
      sourceRole.description || sourceRole.note || sourceRole.roleDescription || ""
    ),
    roleGender: normalizeRoleGender(
      sourceRole.roleGender || sourceRole.role_gender || sourceRole.gender
    ),
    source: normalizeNpcRoleSource(sourceRole.source, options.source || "session"),
    boundUserId:
      boundUserValue === undefined || boundUserValue === null || boundUserValue === ""
        ? null
        : positiveId(boundUserValue, "boundUserId"),
    sortOrder: nonNegativeIntValue(sourceRole.sortOrder ?? sourceRole.sort_order ?? index, "sortOrder")
  };
}

export function normalizeNpcRoles(value, options = {}) {
  return parseNpcRoles(value)
    .map((role, index) => normalizeNpcRole(role, index, options))
    .filter(Boolean);
}
