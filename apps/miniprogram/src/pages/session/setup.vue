<template>
  <view class="page flow-page">
    <AuthIdentityBar />

    <view class="flow-top">
      <view class="step-label">4 / 5</view>
      <view class="title">开本设置</view>
      <view class="text">确认开本时间和车内置顶信息，创建后就可以分享给玩家。</view>
    </view>

    <view class="section setup-summary">
      <view class="section-title">{{ scriptName }}</view>
      <view class="info-row">店家：{{ storeName }}</view>
      <view class="info-row">我的角色：{{ roleName }}</view>
    </view>

    <view class="section">
      <view class="section-title">开本时间</view>
      <view class="picker-row">
        <picker mode="date" :value="dateValue" :start="today" @change="onDateChange">
          <view class="picker-field">
            <image class="inline-icon" src="/static/icons/clock.png" mode="aspectFit" />
            <text>{{ dateValue }}</text>
          </view>
        </picker>
        <picker mode="time" :value="timeValue" @change="onTimeChange">
          <view class="picker-field">
            <image class="inline-icon" src="/static/icons/clock.png" mode="aspectFit" />
            <text>{{ timeValue }}</text>
          </view>
        </picker>
      </view>
    </view>

    <view class="section">
      <view class="section-title">聊天置顶信息</view>
      <view class="section-note">留空会使用默认信息，创建后会作为车内聊天的置顶消息保存。</view>
      <textarea
        v-model="pinnedMessageText"
        class="textarea"
        maxlength="300"
        :placeholder="defaultPinnedMessage"
        placeholder-class="placeholder"
      />
      <view class="preview-block">
        <view class="preview-label">将置顶为</view>
        <view class="preview-text">{{ effectivePinnedMessage }}</view>
      </view>
    </view>

    <view v-if="statusText" class="notice">{{ statusText }}</view>

    <view class="bottom-action">
      <button
        class="button"
        :class="{ disabled: busyAction || !canSubmit }"
        :disabled="busyAction || !canSubmit"
        @click="createPublishedSession"
      >
        {{ busyAction ? "创建中..." : "创建车局并分享" }}
      </button>
    </view>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import { dataOf, ensureLoggedIn, request } from "../../utils/api";
import {
  readCreateFlow,
  roleOptionsFromFlow,
  selectedRolesFromFlow,
  writeCreateFlow
} from "../../utils/createFlow";

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateText(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function tomorrowAtDefaultTime() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return {
    date: dateText(date),
    time: "14:00"
  };
}

function isNumericId(value) {
  return /^\d+$/.test(String(value || ""));
}

export default {
  components: { AuthIdentityBar },
  data() {
    const defaults = tomorrowAtDefaultTime();
    return {
      store: null,
      script: null,
      role: null,
      roleOptions: [],
      selectedRoles: [],
      dateValue: defaults.date,
      timeValue: defaults.time,
      today: dateText(new Date()),
      pinnedMessageText: "",
      statusText: "",
      busyAction: false
    };
  },
  computed: {
    storeName() {
      return this.store?.name || "店家待定";
    },
    scriptName() {
      return this.script?.name || "剧本待定";
    },
    roleName() {
      return this.role?.name || this.selectedRoles[0]?.name || "待定";
    },
    startAt() {
      return `${this.dateValue} ${this.timeValue}:00`;
    },
    startText() {
      return `${this.dateValue} ${this.timeValue}`;
    },
    storeScriptPrice() {
      return Number(this.script?.price_per_player || this.script?.pricePerPlayer || 0);
    },
    defaultPinnedMessage() {
      return `置顶：${this.scriptName} ${this.startText}，${this.storeName}集合。`;
    },
    effectivePinnedMessage() {
      return this.pinnedMessageText.trim() || this.defaultPinnedMessage;
    },
    canSubmit() {
      return isNumericId(this.store?.id) && isNumericId(this.script?.id);
    }
  },
  onLoad() {
    const flow = readCreateFlow();
    this.store = flow.store || null;
    this.script = flow.script || null;
    this.role = flow.role || null;
    this.roleOptions = roleOptionsFromFlow(flow);
    this.selectedRoles = selectedRolesFromFlow(flow);
    this.pinnedMessageText = flow.pinnedMessageText || "";
    if (flow.startAt) {
      this.dateValue = String(flow.startAt).slice(0, 10) || this.dateValue;
      this.timeValue = String(flow.startAt).slice(11, 16) || this.timeValue;
    }
    if (!this.canSubmit) {
      this.statusText = "当前店家或剧本是演示数据，请连接后端后选择真实店家和剧本。";
    }
  },
  methods: {
    onDateChange(event) {
      this.dateValue = event.detail.value;
      this.persistDraft();
    },
    onTimeChange(event) {
      this.timeValue = event.detail.value;
      this.persistDraft();
    },
    persistDraft() {
      writeCreateFlow({
        startAt: this.startAt,
        startText: this.startText,
        pinnedMessageText: this.pinnedMessageText.trim()
      });
    },
    seatPayload(role) {
      return {
        name: role.name,
        seatType: role.seatType || "normal",
        roleName: role.note || role.name,
        roleGender: role.roleGender || "unlimited",
        basePrice: this.storeScriptPrice,
        adjustment: 0
      };
    },
    async createPublishedSession() {
      if (this.busyAction) {
        return;
      }
      const auth = await ensureLoggedIn({
        content: "登录后发布并分享你的剧本局。",
        requirePhone: true,
        phoneRequiredTitle: "授权手机号后发布",
        phoneRequiredContent: "创建车前需要授权手机号，方便车局沟通和审核。"
      });
      if (!auth) {
        this.statusText = "登录后可继续发布。";
        return;
      }
      if (!this.canSubmit) {
        return;
      }
      this.busyAction = true;
      this.statusText = "";
      const pinnedMessageText = this.effectivePinnedMessage;
      try {
        const sessionResponse = await request({
          url: "/api/sessions",
          method: "POST",
          data: {
            storeId: Number(this.store.id),
            scriptId: Number(this.script.id),
            startAt: this.startAt,
            depositAmount: 0,
            note: "剧本迷·拼车，一起沉浸好本。",
            pinnedMessageText
          }
        });
        const session = dataOf(sessionResponse);
        const roles = this.roleOptions.length > 0 ? this.roleOptions : this.selectedRoles;
        const createdSeats = [];
        for (const role of roles) {
          const seatResponse = await request({
            url: `/api/sessions/${session.id}/seats`,
            method: "POST",
            data: this.seatPayload(role)
          });
          createdSeats.push(dataOf(seatResponse));
        }
        await request({
          url: `/api/sessions/${session.id}/publish`,
          method: "POST"
        });
        const selectedSeat = createdSeats.find((seat) => seat.name === this.role?.name);
        if (selectedSeat) {
          await request({
            url: `/api/session-seats/${selectedSeat.id}/claim`,
            method: "POST",
            data: {
              note: "车头创建时选择角色"
            }
          });
        }
        await request({
          url: `/api/sessions/${session.id}/chat/pin`,
          method: "PATCH",
          data: {
            pinnedMessageText
          }
        });
        writeCreateFlow({
          store: this.store,
          script: this.script,
          role: this.role,
          roleOptions: roles,
          selectedRoles: this.selectedRoles,
          sessionId: session.id,
          startAt: this.startAt,
          startText: this.startText,
          pinnedMessageText,
          note: "剧本迷·拼车，一起沉浸好本。"
        });
        uni.redirectTo({ url: `/pages/session/share?id=${session.id}` });
      } catch (error) {
        this.statusText = this.createErrorText(error);
      } finally {
        this.busyAction = false;
      }
    },
    createErrorText(error) {
      if (error?.statusCode === 400) {
        return "创建失败，请检查时间、店家和剧本是否有效。";
      }
      if (error?.statusCode === 401) {
        return "请先登录后再创建车局。";
      }
      return error?.userMessage || "创建失败，请稍后重试。";
    }
  }
};
</script>

<style scoped>
.flow-page {
  padding-bottom: 150rpx;
}

.flow-top {
  display: none;
}

.step-label {
  color: #b89458;
  font-size: 24rpx;
  font-weight: 600;
}

.section-title {
  margin-bottom: 18rpx;
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
}

.section-note {
  margin-bottom: 18rpx;
  color: #738078;
  font-size: 24rpx;
  line-height: 1.45;
}

.info-row {
  margin-top: 10rpx;
  color: #475569;
  font-size: 26rpx;
  line-height: 1.5;
}

.picker-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
}

.picker-field {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  height: 86rpx;
  border: 1rpx solid #ded8ca;
  border-radius: 12rpx;
  background: #fffefb;
  color: #183d34;
  font-size: 28rpx;
  font-weight: 600;
}

.textarea {
  min-height: 168rpx;
  width: 100%;
  padding: 22rpx;
  box-sizing: border-box;
  border: 1rpx solid #ded8ca;
  border-radius: 12rpx;
  background: #fffefb;
  color: #183d34;
  font-size: 26rpx;
  line-height: 1.5;
}

.placeholder {
  color: #9ba39c;
}

.preview-block {
  margin-top: 18rpx;
  padding: 18rpx;
  border-left: 6rpx solid #b89458;
  border-radius: 8rpx;
  background: #fbf6e9;
}

.preview-label {
  color: #8d7b55;
  font-size: 22rpx;
  font-weight: 600;
}

.preview-text {
  margin-top: 8rpx;
  color: #193d35;
  font-size: 25rpx;
  line-height: 1.5;
}

.notice {
  margin-top: 14rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  background: #eef7f4;
  color: #1f7a68;
  font-size: 24rpx;
  line-height: 1.5;
}
</style>
