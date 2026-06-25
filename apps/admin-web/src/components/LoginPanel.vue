<template>
  <main class="login-page">
    <section class="login-panel">
      <div>
        <p class="eyebrow">剧本迷管理后台</p>
        <h1>微信扫码登录</h1>
        <p class="login-copy">使用小程序管理员账号扫描二维码，在手机上确认后进入后台。</p>
      </div>

      <div class="qr-frame">
        <canvas ref="qrCanvas" width="220" height="220" aria-label="Web 后台登录二维码"></canvas>
      </div>

      <p class="status">{{ statusText }}</p>
      <button class="primary" type="button" :disabled="loading" @click="refreshTicket">
        {{ loading ? "生成中" : "刷新二维码" }}
      </button>
    </section>
    <div class="app-build-version">{{ buildVersion }}</div>
  </main>
</template>

<script setup>
import QRCode from "qrcode";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createLoginTicket, pollLoginTicket, setStoredAuth } from "../api";

defineProps({
  buildVersion: {
    type: String,
    required: true
  }
});

const emit = defineEmits(["authenticated"]);
const qrCanvas = ref(null);
const ticket = ref(null);
const status = ref("loading");
const loading = ref(false);
let pollTimer = 0;

const statusText = computed(() => {
  const labels = {
    loading: "正在生成登录二维码",
    pending: "等待小程序扫码确认",
    approved: "登录成功，正在进入后台",
    consumed: "二维码已使用，请刷新",
    expired: "二维码已过期，请刷新",
    failed: "登录失败，请刷新后重试"
  };
  return labels[status.value] || labels.pending;
});

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = 0;
  }
}

async function drawTicketQr(nextTicket) {
  await QRCode.toCanvas(qrCanvas.value, nextTicket.qrText, {
    width: 220,
    margin: 1,
    color: { dark: "#17211f", light: "#ffffff" }
  });
}

async function checkTicket() {
  if (!ticket.value) {
    return;
  }
  try {
    const result = await pollLoginTicket(ticket.value);
    status.value = result.status;
    if (result.status === "approved" && result.token) {
      setStoredAuth(result);
      stopPolling();
      emit("authenticated", result);
    }
    if (["consumed", "expired"].includes(result.status)) {
      stopPolling();
    }
  } catch (error) {
    status.value = "failed";
    stopPolling();
  }
}

async function refreshTicket() {
  loading.value = true;
  status.value = "loading";
  stopPolling();
  try {
    ticket.value = await createLoginTicket();
    await drawTicketQr(ticket.value);
    status.value = "pending";
    pollTimer = window.setInterval(checkTicket, 2000);
  } catch (error) {
    status.value = "failed";
  } finally {
    loading.value = false;
  }
}

onMounted(refreshTicket);
onBeforeUnmount(stopPolling);
</script>
