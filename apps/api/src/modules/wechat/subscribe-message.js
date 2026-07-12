import { config } from "../../config/env.js";

let cachedToken = {
  accessToken: "",
  expiresAt: 0
};

function skipped(scene, reason) {
  return {
    ok: true,
    skipped: true,
    scene,
    reason
  };
}

function enabledFor(templateId, touser) {
  if (!config.subscribeMessage.enabled) {
    return skipped("", "disabled");
  }
  if (!templateId) {
    return skipped("", "template_missing");
  }
  if (!touser) {
    return skipped("", "openid_missing");
  }
  if (!config.wechat.appId || !config.wechat.appSecret) {
    return skipped("", "wechat_config_missing");
  }
  return null;
}

async function fetchAccessToken() {
  if (cachedToken.accessToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", config.wechat.appId);
  url.searchParams.set("secret", config.wechat.appSecret);

  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.errcode || !payload.access_token) {
    const error = new Error(payload.errmsg || "WeChat access token request failed");
    error.details = payload;
    throw error;
  }

  cachedToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(Number(payload.expires_in || 7200) - 120, 60) * 1000
  };
  return cachedToken.accessToken;
}

function valueOrFallback(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
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

function rescheduleDate(value, fallback) {
  return valueOrFallback(value, fallback).replace("T", " ").slice(0, 19);
}

function rescheduleMessageData(payload) {
  return {
    thing1: { value: valueOrFallback(payload.scriptName, "拼车车局").slice(0, 20) },
    date2: { value: rescheduleDate(payload.oldStartAt, "原时间待定") },
    date3: { value: rescheduleDate(payload.newStartAt, "新时间待定") },
    phrase4: { value: "车局已改期" }
  };
}

async function sendSubscribeMessage({ scene, touser, templateId, page, data }) {
  const skip = enabledFor(templateId, touser);
  if (skip) {
    return { ...skip, scene };
  }

  const accessToken = await fetchAccessToken();
  const url = new URL("https://api.weixin.qq.com/cgi-bin/message/subscribe/send");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      touser,
      template_id: templateId,
      page,
      miniprogram_state: config.nodeEnv === "production" ? "formal" : "developer",
      lang: "zh_CN",
      data
    })
  });
  const payload = await response.json();
  if (!response.ok || payload.errcode) {
    return {
      ok: false,
      skipped: false,
      scene,
      error: payload.errmsg || "subscribe message send failed",
      details: payload
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
