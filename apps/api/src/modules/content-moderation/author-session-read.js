import { isAuthorPrivateTextDto } from "./author-dto.js";
import { mergeAuthorTextProjection } from "./author-text-read.js";
import {
  textCreationTargetSubjectId,
  textSessionNpcRoleTargetSubjectId
} from "./text-request-identity.js";

function positiveId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function appendAuthorSessionCreation(sessions, projection) {
  const current = Array.isArray(sessions) ? sessions : [];
  if (
    !isAuthorPrivateTextDto(projection) ||
    projection.published_id !== null ||
    projection.content?.is_draft !== true
  ) return current;
  return [...current, projection];
}

export async function mergeAuthorSessionView(connection, {
  reader,
  userId,
  session
} = {}) {
  const authorId = positiveId(userId);
  const sessionId = positiveId(session?.id);
  if (
    authorId === null ||
    sessionId === null ||
    typeof reader?.find !== "function"
  ) return session;

  const merged = await mergeAuthorSessionUpdate(connection, {
    reader,
    userId: authorId,
    session
  });
  const roles = await mergeAuthorNpcRoleView(connection, {
    reader,
    userId: authorId,
    sessionId,
    roles: merged?.session_npc_roles
  });
  return {
    ...merged,
    session_npc_roles: roles
  };
}

export async function mergeAuthorSessionUpdate(connection, { reader, userId, session } = {}) {
  const authorId = positiveId(userId);
  const sessionId = positiveId(session?.id);
  if (authorId === null || sessionId === null || typeof reader?.find !== "function") return session;
  const sessionProjection = await reader.find(connection, {
    userId: authorId,
    action: "update_session",
    targetSubjectId: String(sessionId)
  });
  return mergeAuthorTextProjection(session, sessionProjection);
}

export async function mergeAuthorNpcRoleView(
  connection,
  { reader, userId, sessionId, roles: inputRoles } = {}
) {
  const authorId = positiveId(userId);
  const normalizedSessionId = positiveId(sessionId);
  if (
    authorId === null ||
    normalizedSessionId === null ||
    typeof reader?.find !== "function"
  ) return Array.isArray(inputRoles) ? inputRoles : [];
  const roles = [];
  for (const role of Array.isArray(inputRoles) ? inputRoles : []) {
    const roleId = positiveId(role?.id);
    if (roleId === null) {
      roles.push(role);
      continue;
    }
    const roleProjection = await reader.find(connection, {
      userId: authorId,
      action: "update_session_npc_role",
      targetSubjectId: String(roleId)
    });
    roles.push(mergeAuthorTextProjection(role, roleProjection));
  }
  const newRoleProjection = await reader.find(connection, {
    userId: authorId,
    action: "create_session_npc_role",
    targetSubjectId: textSessionNpcRoleTargetSubjectId(normalizedSessionId)
  });
  if (isAuthorPrivateTextDto(newRoleProjection)) roles.push(newRoleProjection);
  return roles;
}

export async function appendAuthorSessionCreationForUser(
  connection,
  { reader, userId, sessions } = {}
) {
  const authorId = positiveId(userId);
  if (authorId === null || typeof reader?.find !== "function") return sessions;
  const projection = await reader.find(connection, {
    userId: authorId,
    action: "create_session",
    targetSubjectId: textCreationTargetSubjectId({
      action: "create_session",
      actorUserId: authorId
    })
  });
  return appendAuthorSessionCreation(sessions, projection);
}
