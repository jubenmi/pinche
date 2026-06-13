export const CREATE_FLOW_KEY = "pinche_create_flow";

export function readCreateFlow() {
  try {
    return uni.getStorageSync(CREATE_FLOW_KEY) || {};
  } catch (error) {
    return {};
  }
}

export function writeCreateFlow(patch) {
  const next = {
    ...readCreateFlow(),
    ...patch
  };
  uni.setStorageSync(CREATE_FLOW_KEY, next);
  return next;
}

export function clearCreateFlow() {
  uni.removeStorageSync(CREATE_FLOW_KEY);
}

export function displayTags(value) {
  const tags = parseJsonArray(value);
  if (tags.length === 0) {
    return "未标注";
  }
  return tags.slice(0, 2).join(" / ");
}

export function firstTag(value) {
  const tags = parseJsonArray(value);
  return tags[0] || "情感";
}

export function parseJsonArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

export function roleOptionsFromScript(script) {
  if (Array.isArray(script?.roleOptions) && script.roleOptions.length > 0) {
    return script.roleOptions.map(compactRole);
  }

  const template = parseJsonArray(script?.default_seat_template_json);
  const roles = template.map((item, index) => {
    const name = item.name || item.roleName || `角色${index + 1}`;
    const note = item.roleName && item.roleName !== name ? item.roleName : roleTypeLabel(item.seatType);
    return {
      id: `${script?.id || "script"}-${index}`,
      name,
      note,
      seatType: item.seatType || item.seat_type || "normal",
      roleGender: inferLegacyRoleGender(item, index)
    };
  });

  if (roles.length > 0) {
    return roles;
  }

  const count = Number(script?.player_count || 6);
  return Array.from({ length: Math.max(count, 1) }, (_, index) => ({
    id: `${script?.id || "script"}-${index}`,
    name: `角色${index + 1}`,
    note: "待定",
    seatType: "normal",
    roleGender: "unlimited"
  }));
}

export function roleOptionsFromFlow(flow) {
  if (Array.isArray(flow?.roleOptions) && flow.roleOptions.length > 0) {
    return flow.roleOptions.map(compactRole);
  }
  return roleOptionsFromScript(flow?.script);
}

export function normalizeRoleName(role) {
  return String(role?.name || role || "").trim();
}

export function normalizeRoleGender(value) {
  const gender = String(value || "unlimited").trim();
  if (["male", "男", "男位"].includes(gender)) {
    return "male";
  }
  if (["female", "女", "女位"].includes(gender)) {
    return "female";
  }
  return "unlimited";
}

export function inferLegacyRoleGender(role, index = 0) {
  const explicit = role?.roleGender || role?.role_gender || role?.gender;
  if (explicit) {
    return normalizeRoleGender(explicit);
  }

  const text = `${role?.name || ""} ${role?.roleName || role?.role_name || ""}`;
  const numberedMatch = text.match(/(?:F4|CP位|CP)[-\s]?([1-4])/i);
  if (numberedMatch) {
    return Number(numberedMatch[1]) % 2 === 1 ? "male" : "female";
  }

  const letterMatch = text.match(/CP位?([ABCD])/i);
  if (letterMatch) {
    return ["A", "C"].includes(letterMatch[1].toUpperCase()) ? "male" : "female";
  }

  if (role?.seatType === "f4" || role?.seat_type === "f4") {
    return index % 2 === 1 ? "male" : "female";
  }

  return "unlimited";
}

export function roleGenderSymbol(roleGender) {
  const gender = normalizeRoleGender(roleGender);
  if (gender === "male") {
    return "♂";
  }
  if (gender === "female") {
    return "♀";
  }
  return "";
}

export function isCrossCast(playerGender, roleGender) {
  const player = String(playerGender || "").trim();
  const role = normalizeRoleGender(roleGender);
  return ["male", "female"].includes(player) && ["male", "female"].includes(role) && player !== role;
}

export function compactRole(role) {
  const name = normalizeRoleName(role);
  return {
    id: role?.id || name,
    name,
    note: role?.note || "",
    seatType: role?.seatType || "normal",
    roleGender: normalizeRoleGender(role?.roleGender || role?.role_gender || role?.gender)
  };
}

export function mergeSelectedRoles(...groups) {
  const merged = [];
  const seen = new Set();
  groups.flat().forEach((role) => {
    const compact = compactRole(role);
    const key = normalizeRoleName(compact);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(compact);
  });
  return merged;
}

export function selectedRolesFromFlow(flow) {
  return mergeSelectedRoles(flow?.selectedRoles || [], flow?.role ? [flow.role] : []);
}

export function isSameRole(left, right) {
  return normalizeRoleName(left) === normalizeRoleName(right);
}

export function isRoleSelected(role, selectedRoles = []) {
  return selectedRoles.some((selectedRole) => isSameRole(role, selectedRole));
}

function serializeRoles(roles) {
  const compact = (roles || []).map(compactRole).filter((role) => role.name);
  return compact.length > 0 ? JSON.stringify(compact) : "";
}

function parseSharedRoles(value) {
  return parseJsonArray(value).map(compactRole).filter((role) => role.name);
}

export function roleTypeLabel(type) {
  const labels = {
    love_companion: "沉浸位",
    f4: "互动位",
    cp: "CP位",
    normal: "普通位"
  };
  return labels[type] || "角色位";
}

export function flowToQuery(flow) {
  const roleOptions = roleOptionsFromFlow(flow);
  const selectedRoles = selectedRolesFromFlow(flow);
  const payload = {
    storeId: flow.store?.id,
    storeName: flow.store?.name,
    storeDistrict: flow.store?.district,
    scriptId: flow.script?.id,
    scriptName: flow.script?.name,
    scriptTags: displayTags(flow.script?.type_tags),
    playerCount: flow.script?.player_count,
    roles: serializeRoles(roleOptions),
    takenRoles: serializeRoles(selectedRoles),
    sessionId: flow.sessionId,
    startAt: flow.startAt,
    startText: flow.startText,
    pinnedMessageText: flow.pinnedMessageText,
    note: flow.note
  };
  const pairs = Object.entries(payload).filter(([, value]) => {
    return value !== undefined && value !== null && value !== "";
  });
  if (pairs.length === 0) {
    return "";
  }
  return (
    "?" +
    pairs
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&")
  );
}

export function queryToFlow(options = {}) {
  const decode = (value) => {
    if (!value) {
      return "";
    }
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return String(value);
    }
  };
  const roleOptions = parseSharedRoles(decode(options.roles));
  const selectedRoles = mergeSelectedRoles(
    parseSharedRoles(decode(options.takenRoles)),
    decode(options.roleName)
      ? [{ name: decode(options.roleName), note: decode(options.roleNote) }]
      : []
  );

  return {
    store: {
      id: decode(options.storeId),
      name: decode(options.storeName),
      district: decode(options.storeDistrict)
    },
    script: {
      id: decode(options.scriptId),
      name: decode(options.scriptName),
      type_tags: JSON.stringify((decode(options.scriptTags) || "").split(" / ").filter(Boolean)),
      player_count: Number(options.playerCount || 0)
    },
    role: null,
    roleOptions,
    selectedRoles,
    sessionId: decode(options.sessionId || options.id),
    startAt: decode(options.startAt),
    startText: decode(options.startText),
    pinnedMessageText: decode(options.pinnedMessageText),
    note: decode(options.note)
  };
}
