import { config } from "../../config/env.js";
import {
  getWechatAccessTokenProvider,
  requestWithWechatAccessTokenRetry
} from "./access-token.js";

const sessionTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

function boundedFetchOptions(options = {}) {
  return {
    ...options,
    signal: AbortSignal.timeout(config.subscribeMessage.timeoutMs)
  };
}

function skipped(scene, reason) {
  return {
    ok: true,
    skipped: true,
    scene,
    reason
  };
}

function enabledFor(runtimeConfig, templateId, touser) {
  if (!runtimeConfig.subscribeMessage.enabled) {
    return skipped("", "disabled");
  }
  if (!templateId) {
    return skipped("", "template_missing");
  }
  if (!touser) {
    return skipped("", "openid_missing");
  }
  if (!runtimeConfig.wechat.appId || !runtimeConfig.wechat.appSecret) {
    return skipped("", "wechat_config_missing");
  }
  return null;
}

function valueOrFallback(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function truncateCodePoints(value, maxLength) {
  return Array.from(String(value)).slice(0, maxLength).join("");
}

function messageData(payload, resultText = "待审核") {
  return {
    thing1: { value: valueOrFallback(payload.scriptName, "拼车车局").slice(0, 20) },
    thing2: { value: valueOrFallback(payload.seatName, "角色位").slice(0, 20) },
    phrase3: { value: resultText.slice(0, 5) },
    date4: { value: valueOrFallback(payload.startAt, "时间待定").slice(0, 20) },
    thing5: { value: valueOrFallback(payload.actorName, "新申请").slice(0, 20) }
  };
}

export function formatSessionRescheduleTime(value, fallback = "时间待定") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return fallback;
  }
  const parts = Object.fromEntries(
    sessionTimeFormatter.formatToParts(date).map(({ type, value: partValue }) => [type, partValue])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function rescheduleMessageData(payload) {
  return {
    thing1: { value: truncateCodePoints(valueOrFallback(payload.scriptName, "拼车车局"), 20) },
    date2: { value: formatSessionRescheduleTime(payload.oldStartAt, "原时间待定") },
    date3: { value: formatSessionRescheduleTime(payload.newStartAt, "新时间待定") },
    phrase4: { value: "车局已改期" }
  };
}

export async function sendSubscribeMessage(
  { scene, touser, templateId, page, data },
  {
    runtimeConfig = config,
    tokenProvider = null,
    fetchImpl = globalThis.fetch
  } = {}
) {
  const skip = enabledFor(runtimeConfig, templateId, touser);
  if (skip) {
    return { ...skip, scene };
  }

  const result = await requestWithWechatAccessTokenRetry({
    tokenProvider: tokenProvider || getWechatAccessTokenProvider(),
    request: async (accessToken) => {
      const url = new URL("https://api.weixin.qq.com/cgi-bin/message/subscribe/send");
      url.searchParams.set("access_token", accessToken);
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          touser,
          template_id: templateId,
          page,
          miniprogram_state: runtimeConfig.nodeEnv === "production" ? "formal" : "developer",
          lang: "zh_CN",
          data
        })
      });
      return { response, payload: await response.json() };
    }
  });
  const { response, payload } = result;
  if (!response.ok || payload.errcode) {
    return {
      ok: false,
      skipped: false,
      scene,
      error: payload.errmsg || "subscribe message send failed",
      errorCode: payload.errcode || response.status || "WECHAT_API_ERROR"
    };
  }
  return {
    ok: true,
    skipped: false,
    scene,
    msgid: payload.msgid || ""
  };
}

export async function notifySignupCreated(payload = {}) {
  payload = payload || {};
  const templateId = config.subscribeMessage.signupCreatedTemplateId;
  return sendSubscribeMessage({
    scene: "signup_created",
    touser: payload.organizerOpenId,
    templateId,
    page: `/pages/session/manage?id=${payload.sessionId}`,
    data: messageData(payload, "待审核")
  });
}

export async function notifySignupReviewed(payload = {}) {
  payload = payload || {};
  const templateId = config.subscribeMessage.signupReviewedTemplateId;
  return sendSubscribeMessage({
    scene: "signup_reviewed",
    touser: payload.applicantOpenId,
    templateId,
    page: `/pages/session/detail?id=${payload.sessionId}`,
    data: messageData(payload, payload.resultText || "已审核")
  });
}

export async function notifySessionRescheduled(payload = {}) {
  payload = payload || {};
  return sendSubscribeMessage({
    scene: "session_rescheduled",
    touser: payload.recipientOpenId,
    templateId: config.subscribeMessage.sessionRescheduledTemplateId,
    page: `/pages/session/detail?id=${payload.sessionId}`,
    data: rescheduleMessageData(payload)
  });
}
