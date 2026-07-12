import { dataOf, request } from "./api";

export const TEMPLATE_IDS = {
  organizer_signup_created: import.meta.env.VITE_SUBSCRIBE_TEMPLATE_SIGNUP_CREATED || "",
  player_signup_reviewed: import.meta.env.VITE_SUBSCRIBE_TEMPLATE_SIGNUP_REVIEWED || "",
  member_session_rescheduled:
    import.meta.env.VITE_SUBSCRIBE_TEMPLATE_SESSION_RESCHEDULED || ""
};

function normalizeSubscribeResult(templateId, result = {}) {
  if (!templateId) {
    return "disabled";
  }
  return result[templateId] || result.errMsg || "unknown";
}

async function recordSubscriptionResult(scene, templateId, status, rawResult = {}) {
  try {
    const response = await request({
      url: "/api/subscriptions/request-result",
      method: "POST",
      data: {
        scene,
        templateId,
        accepted: status === "accept" || status === "acceptWithAudio" || status === "acceptWithAlert",
        rawResult: {
          scene,
          status,
          ...rawResult
        }
      }
    });
    return dataOf(response);
  } catch (error) {
    return null;
  }
}

export async function requestBusinessSubscription(scene) {
  const templateId = TEMPLATE_IDS[scene] || "";
  if (!templateId) {
    await recordSubscriptionResult(scene, "", "disabled", { reason: "template_missing" });
    return { scene, templateId, status: "disabled" };
  }

  const requestSubscribeMessage =
    typeof wx !== "undefined" && typeof wx.requestSubscribeMessage === "function"
      ? wx.requestSubscribeMessage
      : null;
  if (!requestSubscribeMessage) {
    await recordSubscriptionResult(scene, templateId, "unavailable", {
      reason: "requestSubscribeMessage_unavailable"
    });
    return { scene, templateId, status: "unavailable" };
  }

  try {
    const result = await new Promise((resolve, reject) => {
      requestSubscribeMessage({
        tmplIds: [templateId],
        success: resolve,
        fail: reject
      });
    });
    const status = normalizeSubscribeResult(templateId, result);
    await recordSubscriptionResult(scene, templateId, status, result);
    return { scene, templateId, status, rawResult: result };
  } catch (error) {
    const status = error?.errMsg || "fail";
    await recordSubscriptionResult(scene, templateId, status, {
      errMsg: error?.errMsg || "",
      errCode: error?.errCode || ""
    });
    return { scene, templateId, status, error };
  }
}

export function requestSignupCreatedSubscription() {
  return requestBusinessSubscription("organizer_signup_created");
}

export function requestSignupReviewedSubscription() {
  return requestBusinessSubscription("player_signup_reviewed");
}

export function requestSessionRescheduledSubscription() {
  return requestBusinessSubscription("member_session_rescheduled");
}
