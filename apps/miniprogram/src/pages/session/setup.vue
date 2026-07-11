<template>
  <view class="page flow-page">
    <AuthIdentityBar />
    <FeedbackHost />

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
        <view class="picker-field" @tap="openDatePicker">
          <t-image class="inline-icon" src="/static/icons/clock.png" mode="aspectFit" />
          <text>{{ dateValue }}</text>
        </view>
        <view class="picker-field" @tap="openTimePicker">
          <t-image class="inline-icon" src="/static/icons/clock.png" mode="aspectFit" />
          <text>{{ timeValue }}</text>
        </view>
        <t-date-time-picker
          title="选择日期"
          mode="date"
          format="YYYY-MM-DD"
          :visible="datePickerVisible"
          :value="dateValue"
          :start="today"
          @confirm="onDateChange"
          @cancel="closeDatePicker"
          @close="closeDatePicker"
        />
        <t-date-time-picker
          title="选择时间"
          :mode="['hour', 'minute']"
          format="HH:mm"
          :visible="timePickerVisible"
          :value="timeValue"
          @confirm="onTimeChange"
          @cancel="closeTimePicker"
          @close="closeTimePicker"
        />
      </view>
    </view>

    <view class="section">
      <view class="section-title">上车权限</view>
      <view class="section-note">分享到群后，未上车玩家选择角色时使用此规则。</view>
      <view class="setting-switch-row">
        <view class="setting-switch-copy">
          <view class="setting-switch-title">上车审核</view>
          <view class="section-note">开启后，玩家和NPC申请需要车头通过；关闭后可直接上车。</view>
        </view>
        <view class="setting-switch-meta">
          <view class="setting-switch-label">
            {{ joinPolicy === "review_required" ? "需要审核" : "直接上车" }}
          </view>
          <t-switch
            color="#1f7a68"
            :value="joinPolicy === 'review_required'"
            @change="setJoinPolicy($event.detail.value ? 'review_required' : 'direct')"
          />
        </view>
      </view>
      <view class="setting-switch-row">
        <view class="setting-switch-copy">
          <view class="setting-switch-title">上车必须留电话</view>
          <view class="section-note">关闭后，玩家和NPC仍需登录，但可不授权手机号也能上车或提交申请</view>
        </view>
        <view class="setting-switch-meta">
          <view class="setting-switch-label">{{ joinPhoneRequired ? "已开启" : "已关闭" }}</view>
          <t-switch
            color="#1f7a68"
            :value="joinPhoneRequired"
            @change="setJoinPhoneRequired($event.detail.value)"
          />
        </view>
      </view>
      <view class="setting-switch-row">
        <view class="setting-switch-copy">
          <view class="setting-switch-title">允许NPC工作人员自选角色</view>
          <view class="section-note">关闭后由车头手动安排NPC角色</view>
        </view>
        <view class="setting-switch-meta">
          <view class="setting-switch-label">{{ npcJoinEnabled ? "已开启" : "已关闭" }}</view>
          <t-switch
            color="#1f7a68"
            :value="npcJoinEnabled"
            @change="setNpcJoinEnabled($event.detail.value)"
          />
        </view>
      </view>
      <view class="setting-switch-row">
        <view class="setting-switch-copy">
          <view class="setting-switch-title">同城展示</view>
          <view class="section-note">开启后，同城玩家可以发现这辆车；关闭后仅通过分享链接加入。</view>
        </view>
        <view class="setting-switch-meta">
          <view class="setting-switch-label">{{ cityVisible ? "已开启" : "已关闭" }}</view>
          <t-switch
            color="#1f7a68"
            :value="cityVisible"
            @change="setCityVisible($event.detail.value)"
          />
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-title">聊天置顶信息</view>
      <view class="section-note">留空会使用默认信息，创建后会作为车内聊天的置顶消息保存。</view>
      <t-textarea
        :value="pinnedMessageText"
        class="textarea"
        maxlength="300"
        :placeholder="defaultPinnedMessage || ''"
        placeholder-class="placeholder"
        @change="pinnedMessageText = $event.detail.value"
      />
      <view class="preview-block">
        <view class="preview-label">将置顶为</view>
        <view class="preview-text">{{ effectivePinnedMessage }}</view>
      </view>
    </view>

    <t-notice-bar
      v-if="statusText"
      class="notice"
      theme="warning"
      :visible="true"
      :content="statusText"
    />

    <view class="bottom-action">
      <t-button
        class="button"
        :class="{ disabled: busyAction || !canSubmit }"
        :disabled="busyAction || !canSubmit"
        @tap="createPublishedSession"
      >
        {{ busyAction ? "创建中..." : "创建车局并分享" }}
      </t-button>
    </view>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
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
  components: { AuthIdentityBar, FeedbackHost },
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
      datePickerVisible: false,
      timePickerVisible: false,
      today: dateText(new Date()),
      pinnedMessageText: "",
      joinPolicy: "review_required",
      joinPhoneRequired: true,
      npcJoinEnabled: true,
      cityVisible: true,
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
    this.joinPolicy = flow.joinPolicy === "direct" ? "direct" : "review_required";
    this.joinPhoneRequired =
      flow.joinPhoneRequired === undefined ? true : Boolean(flow.joinPhoneRequired);
    this.npcJoinEnabled = flow.npcJoinEnabled === undefined ? true : Boolean(flow.npcJoinEnabled);
    this.cityVisible = flow.cityVisible === undefined ? true : Boolean(flow.cityVisible);
    if (flow.startAt) {
      this.dateValue = String(flow.startAt).slice(0, 10) || this.dateValue;
      this.timeValue = String(flow.startAt).slice(11, 16) || this.timeValue;
    }
    if (!this.canSubmit) {
      this.statusText = "当前店家或剧本是演示数据，请连接后端后选择真实店家和剧本。";
    }
  },
  methods: {
    openDatePicker() {
      this.datePickerVisible = true;
    },
    closeDatePicker() {
      this.datePickerVisible = false;
    },
    openTimePicker() {
      this.timePickerVisible = true;
    },
    closeTimePicker() {
      this.timePickerVisible = false;
    },
    onDateChange(event) {
      this.dateValue = event.detail.value;
      this.datePickerVisible = false;
      this.persistDraft();
    },
    onTimeChange(event) {
      this.timeValue = event.detail.value;
      this.timePickerVisible = false;
      this.persistDraft();
    },
    setJoinPolicy(value) {
      this.joinPolicy = value === "direct" ? "direct" : "review_required";
      this.persistDraft();
    },
    setJoinPhoneRequired(value) {
      this.joinPhoneRequired = Boolean(value);
      this.persistDraft();
    },
    setNpcJoinEnabled(value) {
      this.npcJoinEnabled = Boolean(value);
      this.persistDraft();
    },
    setCityVisible(value) {
      this.cityVisible = Boolean(value);
      this.persistDraft();
    },
    persistDraft() {
      writeCreateFlow({
        startAt: this.startAt,
        startText: this.startText,
        pinnedMessageText: this.pinnedMessageText.trim(),
        joinPolicy: this.joinPolicy,
        joinPhoneRequired: this.joinPhoneRequired,
        npcJoinEnabled: this.npcJoinEnabled,
        cityVisible: this.cityVisible
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
            joinPolicy: this.joinPolicy,
            joinPhoneRequired: this.joinPhoneRequired,
            npcJoinEnabled: this.npcJoinEnabled,
            visibility: this.cityVisible ? "public" : "share_only",
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
          joinPolicy: this.joinPolicy,
          joinPhoneRequired: this.joinPhoneRequired,
          npcJoinEnabled: this.npcJoinEnabled,
          cityVisible: this.cityVisible,
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

.setting-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  padding: 22rpx 0;
  border-top: 1rpx solid rgba(222, 216, 202, 0.72);
}

.section-note + .setting-switch-row {
  margin-top: 12rpx;
}

.setting-switch-copy {
  min-width: 0;
  flex: 1;
}

.setting-switch-title {
  margin-bottom: 6rpx;
  color: #153f34;
  font-size: 26rpx;
  font-weight: 600;
}

.setting-switch-row .section-note {
  margin-bottom: 0;
}

.setting-switch-meta {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.setting-switch-label {
  min-width: 88rpx;
  color: #153f34;
  font-size: 24rpx;
  font-weight: 600;
  line-height: 1.3;
  text-align: right;
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
