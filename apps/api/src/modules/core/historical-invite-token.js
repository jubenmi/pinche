import { forbidden } from "../../http/errors.js";
import {
  signSignedPayload,
  tokenPositiveInteger,
  verifySignedPayload
} from "../security/signed-payload.js";

const NAMESPACE = "historical-session-claim";
const PURPOSE = "historical_session_claim";
const SESSION_PURPOSE = "historical_record";
const TOKEN_LABEL = "historical invite token";

function invalidHistoricalInviteToken() {
  return forbidden(`${TOKEN_LABEL} is invalid`);
}

function normalizeHistoricalInviteClaims(payload) {
  if (
    payload?.purpose !== PURPOSE ||
    payload?.sessionPurpose !== SESSION_PURPOSE
  ) {
    throw invalidHistoricalInviteToken();
  }
  return {
    purpose: PURPOSE,
    sessionPurpose: SESSION_PURPOSE,
    sessionId: tokenPositiveInteger(payload.sessionId, "sessionId"),
    inviterUserId: tokenPositiveInteger(payload.inviterUserId, "inviterUserId"),
    exp: tokenPositiveInteger(payload.exp, "exp")
  };
}

export function createHistoricalInviteTokenCodec({ secret, nowSeconds } = {}) {
  return {
    sign(input) {
      try {
        const { sessionId, inviterUserId, exp } = input || {};
        const claims = normalizeHistoricalInviteClaims({
          purpose: PURPOSE,
          sessionPurpose: SESSION_PURPOSE,
          sessionId,
          inviterUserId,
          exp
        });
        return signSignedPayload({ secret, namespace: NAMESPACE, payload: claims });
      } catch (error) {
        throw invalidHistoricalInviteToken();
      }
    },

    verify(token) {
      try {
        const payload = verifySignedPayload({
          secret,
          namespace: NAMESPACE,
          token,
          label: TOKEN_LABEL,
          nowSeconds
        });
        return normalizeHistoricalInviteClaims(payload);
      } catch (error) {
        throw invalidHistoricalInviteToken();
      }
    }
  };
}
