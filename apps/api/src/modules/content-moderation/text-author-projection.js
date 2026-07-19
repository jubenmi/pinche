function projectionError(reason) {
  const error = new TypeError(`invalid author text projection: ${reason}`);
  error.code = "CONTENT_MODERATION_AUTHOR_PROJECTION_INVALID";
  return error;
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireBody(body) {
  if (!isPlainRecord(body)) throw projectionError("body");
  return body;
}

function cloneScalar(value, field) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw projectionError(field);
}

function pickScalars(body, fields) {
  const projected = {};
  for (const field of fields) {
    if (body[field] !== undefined) projected[field] = cloneScalar(body[field], field);
  }
  return projected;
}

function stringArray(value, field) {
  if (!Array.isArray(value)) throw projectionError(field);
  return value.map((entry) => {
    if (typeof entry !== "string") throw projectionError(field);
    return entry;
  });
}

function positiveIntegerArray(value, field) {
  if (!Array.isArray(value)) throw projectionError(field);
  return value.map((entry) => {
    if (!Number.isSafeInteger(entry) || entry <= 0) throw projectionError(field);
    return entry;
  });
}

const ROLE_FIELDS = Object.freeze([
  "name",
  "description",
  "roleGender",
  "source",
  "boundUserId",
  "sortOrder",
  "status"
]);

function projectRoles(value, field) {
  if (!Array.isArray(value)) throw projectionError(field);
  return value.map((role) => pickScalars(requireBody(role), ROLE_FIELDS));
}

function projectNickname(body) {
  return pickScalars(body, ["nickname", "avatarUrl", "gender"]);
}

function projectPrivateStore(body) {
  return pickScalars(body, [
    "name", "city", "district", "address", "latitude", "longitude", "contactNote"
  ]);
}

function projectPrivateScript(body) {
  const projected = pickScalars(body, ["name", "summaryNoSpoiler", "playerCount"]);
  if (body.typeTags !== undefined) projected.typeTags = stringArray(body.typeTags, "typeTags");
  if (body.defaultSeatTemplate !== undefined) {
    projected.defaultSeatTemplate = projectRoles(body.defaultSeatTemplate, "defaultSeatTemplate");
  }
  return projected;
}

function projectSessionCreate(body) {
  const projected = pickScalars(body, [
    "storeId", "scriptId", "startAt", "dmUserId", "dmNameSnapshot", "npcUserId",
    "npcNameSnapshot", "depositAmount", "visibility", "note", "pinnedMessageText",
    "joinPolicy", "joinPhoneRequired", "npcJoinEnabled"
  ]);
  if (body.extraNpcRoles !== undefined) {
    projected.extraNpcRoles = projectRoles(body.extraNpcRoles, "extraNpcRoles");
  }
  return projected;
}

function projectSessionUpdate(body) {
  return pickScalars(body, [
    "startAt", "dmUserId", "dmNameSnapshot", "npcUserId", "npcNameSnapshot",
    "depositAmount", "visibility", "note", "status", "joinPolicy",
    "joinPhoneRequired", "npcJoinEnabled"
  ]);
}

function projectNpcRole(body) {
  return pickScalars(body, ROLE_FIELDS);
}

function projectReview(body) {
  const projected = pickScalars(body, ["rating", "content"]);
  if (body.photoUrls !== undefined) projected.photoUrls = stringArray(body.photoUrls, "photoUrls");
  if (body.albumPhotoIds !== undefined) {
    projected.albumPhotoIds = positiveIntegerArray(body.albumPhotoIds, "albumPhotoIds");
  }
  return projected;
}

function projectMessage(body) {
  return pickScalars(body, ["content"]);
}

function projectPinnedMessage(body) {
  return pickScalars(body, ["pinnedMessageText"]);
}

const PROJECTORS = Object.freeze({
  update_nickname: Object.freeze({ createsDraft: false, project: projectNickname }),
  create_private_store: Object.freeze({ createsDraft: true, project: projectPrivateStore }),
  create_private_script: Object.freeze({ createsDraft: true, project: projectPrivateScript }),
  create_session: Object.freeze({ createsDraft: true, project: projectSessionCreate }),
  update_session: Object.freeze({ createsDraft: false, project: projectSessionUpdate }),
  create_session_npc_role: Object.freeze({ createsDraft: true, project: projectNpcRole }),
  update_session_npc_role: Object.freeze({ createsDraft: false, project: projectNpcRole }),
  upsert_session_review: Object.freeze({ createsDraft: false, project: projectReview }),
  create_session_message: Object.freeze({ createsDraft: true, project: projectMessage }),
  update_session_pinned_message: Object.freeze({ createsDraft: false, project: projectPinnedMessage })
});

function publishedId(targetSubjectId) {
  const target = String(targetSubjectId || "");
  if (!/^[1-9]\d*$/.test(target)) throw projectionError("published target");
  const parsed = Number(target);
  if (!Number.isSafeInteger(parsed)) throw projectionError("published target");
  return parsed;
}

export function projectAuthorTextProposal({ action, targetSubjectId, body } = {}) {
  const normalizedAction = String(action || "");
  const definition = Object.prototype.hasOwnProperty.call(PROJECTORS, normalizedAction)
    ? PROJECTORS[normalizedAction]
    : null;
  if (!definition) throw projectionError("action");
  const projected = definition.project(requireBody(body));
  if (definition.createsDraft) {
    const target = String(targetSubjectId || "");
    if (!target || target.length > 128) throw projectionError("draft target");
    return {
      publishedId: null,
      content: { is_draft: true, ...projected }
    };
  }
  return {
    publishedId: publishedId(targetSubjectId),
    content: projected
  };
}
