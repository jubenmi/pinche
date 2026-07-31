import {
  FUTURE_CARPOOL,
  HISTORICAL_RECORD,
  normalizeSessionPurpose,
  parseBusinessDateTime
} from "@pinche/shared";
import { AppError } from "../../http/errors.js";
import { parseNpcRoles } from "./npc-role-normalization.js";

const DIRECT_MEMBER_ALIASES = Object.freeze([
  "dmUserId",
  "dm_user_id",
  "npcUserId",
  "npc_user_id"
]);
const NPC_MEMBER_ALIASES = Object.freeze([
  "boundUserId",
  "bound_user_id",
  "userId",
  "user_id"
]);

function hasExplicitNonNullAlias(value, aliases) {
  if (!value || typeof value !== "object") return false;
  return aliases.some((key) => (
    Object.prototype.hasOwnProperty.call(value, key) && value[key] !== null
  ));
}

export function assertHistoricalSessionMemberPrebindAllowed(body = {}, sessionPurpose) {
  if (normalizeSessionPurpose(sessionPurpose) !== HISTORICAL_RECORD) return;

  const hasDirectMember = hasExplicitNonNullAlias(body, DIRECT_MEMBER_ALIASES);
  const rawNpcRoles = ["extraNpcRoles", "extra_npc_roles"].flatMap((key) => (
    Object.prototype.hasOwnProperty.call(body, key) ? parseNpcRoles(body[key]) : []
  ));
  const hasPreboundNpcRole = rawNpcRoles.some((role) => (
    hasExplicitNonNullAlias(role, NPC_MEMBER_ALIASES)
  ));
  if (hasDirectMember || hasPreboundNpcRole) {
    throw new AppError(
      400,
      "HISTORICAL_MEMBER_PREBIND_FORBIDDEN",
      "Historical members must claim a role through a historical invitation"
    );
  }
}

export function normalizeSessionCreationStartAt(startAt, sessionPurpose, now = new Date()) {
  const normalizedPurpose = normalizeSessionPurpose(sessionPurpose);
  if (!normalizedPurpose) {
    throw new AppError(400, "INVALID_SESSION_PURPOSE", "sessionPurpose is invalid");
  }

  const parsedStartAt = parseBusinessDateTime(startAt);
  if (!parsedStartAt) {
    throw new AppError(
      400,
      "INVALID_START_AT",
      "startAt must be a valid business timestamp"
    );
  }

  const date = new Date(Math.floor(parsedStartAt.getTime() / 1000) * 1000);
  const expectedSessionPurpose =
    date.getTime() > now.getTime() ? FUTURE_CARPOOL : HISTORICAL_RECORD;
  if (normalizedPurpose !== expectedSessionPurpose) {
    throw new AppError(
      409,
      "SESSION_PURPOSE_TIME_MISMATCH",
      "startAt no longer matches sessionPurpose",
      { expectedSessionPurpose }
    );
  }

  return {
    date,
    canonical: date.toISOString(),
    sessionPurpose: normalizedPurpose
  };
}
