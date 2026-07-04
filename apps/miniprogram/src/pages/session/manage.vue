<template>
  <view class="page manage-page">
    <AuthIdentityBar />

    <view class="section">
      <view class="title">{{ session.script_name_snapshot || "车头管理" }}</view>
      <view class="text">{{ summaryText }}</view>
      <view v-if="operationText" class="notice">{{ operationText }}</view>
      <view class="actions">
        <button class="button" :disabled="busyAction" @click="reload">
          {{ busyAction ? "处理中..." : "刷新" }}
        </button>
        <button class="button secondary" :disabled="busyAction" @click="subscribeSignupReminder">
          申请提醒
        </button>
        <button class="button secondary" :disabled="busyAction" @click="goDetail">车局详情</button>
      </view>
    </view>

    <view v-if="session.id" class="section">
      <view class="section-title">车况</view>
      <view class="info-row">店家：{{ session.store_name_snapshot }}</view>
      <view class="info-row">时间：{{ session.start_at }}</view>
      <view class="info-row">状态：{{ sessionStatusLabel(session.status) }}</view>
      <view class="info-row">座位：{{ seatSummary }}</view>
      <view class="actions compact">
        <button
          v-if="hasOtherOnboardMembers"
          class="mini-button muted"
          :disabled="busyAction"
          @click="leaveOrganizer"
        >
          退出车头
        </button>
      </view>
    </view>

    <view v-if="session.id" class="section">
      <view class="section-head">
        <view>
          <view class="section-title">车局设置</view>
          <view class="section-note">车头可以随时调整后续上车规则。</view>
        </view>
        <button
          class="mini-button"
          :class="{ disabled: busyAction || !settingsDirty }"
          :disabled="busyAction || !settingsDirty"
          @click="updateSessionSettings"
        >
          {{ settingsDirty ? "保存" : "已保存" }}
        </button>
      </view>
      <view class="setting-switch-row">
        <view class="setting-switch-copy">
          <view class="setting-title">上车必须留电话</view>
          <view class="section-note">关闭后，玩家可以不授权手机号也能上车或申请。</view>
        </view>
        <view class="setting-switch-meta">
          <view class="setting-switch-label">{{ joinPhoneRequired ? "已开启" : "已关闭" }}</view>
          <switch
            color="#1f7a68"
            :checked="joinPhoneRequired"
            :disabled="busyAction"
            @change="setJoinPhoneRequired($event.detail.value)"
          />
        </view>
      </view>
    </view>

    <ManagePinnedMessage
      v-for="extension in sessionManageExtensions"
      :key="extension.id"
      :session-id="sessionId"
      :session="session"
      :busy="busyAction"
      :auth-tools="authTools"
      @status="setStatus"
      @updated="reload"
    />

    <view v-if="session.seats && session.seats.length" class="section">
      <view class="section-title">座位状态</view>
      <view v-for="seat in session.seats" :key="seat.id" class="seat-card">
        <view class="seat-header">
          <view class="seat-title">{{ seat.name }}</view>
          <view class="seat-status">{{ seatStatusLabel(seat.status) }}</view>
        </view>
        <view class="info-row">角色：{{ seat.role_name || "未标注" }}</view>
        <view class="info-row">类型：{{ seatTypeLabel(seat.seat_type) }}</view>
        <view v-if="canKickSeat(seat)" class="actions compact">
          <button
            v-if="canTransferOrganizerToSeat(seat)"
            class="mini-button"
            :disabled="busyAction"
            @click="transferOrganizerToSeat(seat)"
          >
            转让车头
          </button>
          <button class="mini-button muted" :disabled="busyAction" @click="kickSeat(seat)">
            踢出/释放
          </button>
        </view>
      </view>
    </view>

    <view v-if="session.id" class="section">
      <view class="section-title">上车申请</view>
      <view v-if="signups.length === 0" class="empty">暂无申请。</view>
      <view v-for="signup in signups" :key="signup.id" class="signup-card">
        <view class="seat-header">
          <view class="seat-title">{{ seatName(signup.seat_id) }}</view>
          <view class="seat-status">{{ signupStatusLabel(signup.status) }}</view>
        </view>
        <view class="info-row">申请信息：{{ signup.contact_text || "车内聊天沟通" }}</view>
        <view v-if="signup.note" class="info-row">备注：{{ signup.note }}</view>
        <view class="info-row">座位状态：{{ seatStatusLabel(seatStatus(signup.seat_id)) }}</view>

        <view v-if="signup.status === 'pending'" class="actions compact">
          <button class="mini-button" :disabled="busyAction" @click="approve(signup)">
            通过
          </button>
          <button class="mini-button muted" :disabled="busyAction" @click="reject(signup)">
            拒绝
          </button>
        </view>
      </view>
    </view>

    <view v-if="session.id" class="section danger-section">
      <view v-if="!hasOtherOnboardMembers && !hasActiveAlbumPhotos">
        <view class="section-title">取消车</view>
        <view class="section-note">取消后这辆车会被直接删除，座位、报名、聊天和相册记录会一起删除。</view>
        <textarea
          v-model="cancelReason"
          class="textarea"
          maxlength="200"
          placeholder="可选：写一句取消原因"
          placeholder-class="placeholder"
        />
        <view class="actions">
          <button
            class="button danger"
            :disabled="busyAction"
            @click="cancelSession"
          >
            取消本车
          </button>
        </view>
      </view>
      <view v-else-if="hasOtherOnboardMembers">
        <view class="section-title">退出车头</view>
        <view class="section-note">已有玩家上车，不能取消删除；请退出车头，系统会转给下一位已上车成员。</view>
      </view>
      <view v-else>
        <view class="section-title">先删照片</view>
        <view class="section-note">相册已有照片，不能取消删除；请先删除所有照片，避免留下无主照片。</view>
        <view class="actions">
          <button class="button secondary" :disabled="busyAction" @click="goAlbum">打开相册</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import ManagePinnedMessage from "../../extensions/session-pseudo-chat/ManagePinnedMessage.vue";
import { sessionManageExtensions } from "../../extensions/sessionExtensions.js";
import { dataOf, ensureLoggedIn, request } from "../../utils/api";
import { requestSignupCreatedSubscription } from "../../utils/subscribeMessages";

function booleanSetting(value, fallback = true) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return ["1", "true", "enabled", "required"].includes(String(value).trim().toLowerCase());
}

export default {
  components: { AuthIdentityBar, ManagePinnedMessage },
  data() {
    return {
      sessionId: "",
      session: {},
      signups: [],
      sessionManageExtensions,
      joinPhoneRequired: true,
      statusText: "",
      busyAction: false,
      busyText: "",
      cancelReason: ""
    };
  },
  computed: {
    operationText() {
      if (this.busyAction) {
        return this.busyText || "正在处理，请稍候...";
      }
      return this.statusText;
    },
    summaryText() {
      if (!this.session.id) {
        return "置顶信息、处理上车、释放座位和取消车。";
      }
      return `${this.session.store_name_snapshot} / ${this.session.start_at}`;
    },
    seatSummary() {
      const seats = this.session.seats || [];
      const open = seats.filter((seat) => seat.status === "open").length;
      const applied = seats.filter((seat) => seat.status === "applied").length;
      const confirmed = seats.filter((seat) => seat.status === "confirmed").length;
      const locked = seats.filter((seat) => seat.status === "locked").length;
      return `${seats.length}位，${open}空位，${applied}待审，${confirmed + locked}已上车`;
    },
    authTools() {
      return { dataOf, request };
    },
    hasOtherOnboardMembers() {
      const seats = this.session.seats || [];
      if (seats.length > 0) {
        return seats.some(
          (seat) =>
            ["confirmed", "locked"].includes(seat.status) &&
            seat.confirmed_user_id &&
            Number(seat.confirmed_user_id) !== Number(this.session.organizer_user_id)
        );
      }
      return Number(this.session.other_onboard_member_count || 0) > 0;
    },
    hasActiveAlbumPhotos() {
      return Number(this.session.active_album_photo_count || this.session.photo_count || 0) > 0;
    },
    settingsDirty() {
      if (!this.session.id) {
        return false;
      }
      return this.joinPhoneRequired !== this.sessionJoinPhoneRequired();
    }
  },
  async onLoad(options) {
    const auth = await ensureLoggedIn({
      content: "登录后继续管理你创建的车。"
    });
    if (!auth) {
      this.statusText = "登录后可继续管理发车。";
      return;
    }
    this.sessionId = options.id || "";
    this.reload();
  },
  methods: {
    async ensureManageActionLogin() {
      const auth = await ensureLoggedIn({
        content: "登录后继续管理你创建的车。"
      });
      if (!auth) {
        this.statusText = "登录后可继续管理发车。";
        return null;
      }
      return auth;
    },
    async reload() {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      if (!this.sessionId || this.sessionId === "d1-demo") {
        this.statusText = "请从我的发车进入管理页。";
        return;
      }
      await this.loadSession();
      await this.loadSignups();
    },
    async loadSession() {
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}` });
        this.session = dataOf(response) || {};
        this.syncSessionSettings();
      } catch (error) {
        this.statusText = "车详情加载失败，请稍后重试。";
      }
    },
    async loadSignups() {
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/signups` });
        this.signups = dataOf(response) || [];
        this.statusText = "";
      } catch (error) {
        if (error?.statusCode === 403) {
          this.statusText = "只有车头可以管理本车。";
        } else if (error?.statusCode === 401) {
          this.statusText = "请先登录后再管理发车。";
        } else {
          this.statusText = "申请列表加载失败，请稍后重试。";
        }
        this.signups = [];
      }
    },
    setStatus(statusText) {
      this.statusText = statusText;
    },
    sessionJoinPhoneRequired() {
      return booleanSetting(this.session.join_phone_required, true);
    },
    syncSessionSettings() {
      this.joinPhoneRequired = this.sessionJoinPhoneRequired();
    },
    setJoinPhoneRequired(value) {
      this.joinPhoneRequired = Boolean(value);
    },
    async updateSessionSettings() {
      const auth = await this.ensureManageActionLogin();
      if (!auth || !this.settingsDirty || this.busyAction) {
        return;
      }
      const nextJoinPhoneRequired = this.joinPhoneRequired;
      this.busyAction = true;
      this.busyText = "正在处理，请稍候...";
      try {
        await request({
          url: `/api/sessions/${this.sessionId}`,
          method: "PATCH",
          data: {
            joinPhoneRequired: nextJoinPhoneRequired,
            join_phone_required: nextJoinPhoneRequired
          }
        });
        await this.reload();
        this.statusText =
          this.joinPhoneRequired === nextJoinPhoneRequired
            ? "车局设置已更新。"
            : "车局设置没有生效，请确认后端已部署最新车局设置接口。";
      } catch (error) {
        this.statusText = this.actionErrorText(error);
      } finally {
        this.busyAction = false;
        this.busyText = "";
      }
    },
    async approve(signup) {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      await this.runAction("已通过申请，玩家可进入车内聊天。", {
        url: `/api/signups/${signup.id}/approve`,
        method: "PATCH"
      });
    },
    async reject(signup) {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      await this.runAction("已拒绝申请。", {
        url: `/api/signups/${signup.id}/reject`,
        method: "PATCH"
      });
    },
    async subscribeSignupReminder() {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      const result = await requestSignupCreatedSubscription();
      this.statusText =
        result.status === "accept" ||
        result.status === "acceptWithAudio" ||
        result.status === "acceptWithAlert"
          ? "已开启新申请提醒。"
          : "未开启提醒，也不影响你继续管理申请。";
    },
    async kickSeat(seat) {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      this.confirmAction(`确认释放「${seat.name}」吗？`, async () => {
        await this.runAction("座位已释放。", {
          url: `/api/session-seats/${seat.id}/kick`,
          method: "PATCH"
        });
      });
    },
    async transferOrganizerToSeat(seat) {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      this.confirmAction(`确认把车头转让给「${seat.name}」吗？`, async () => {
        await this.runOrganizerTransition("车头已转让。", {
          url: `/api/sessions/${this.sessionId}/organizer/transfer`,
          method: "PATCH",
          data: {
            targetUserId: seat.confirmed_user_id
          }
        });
      });
    },
    async leaveOrganizer() {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      this.confirmAction("确认退出车头吗？系统会交给下一位已上车成员。", async () => {
        await this.runOrganizerTransition("已退出车头。", {
          url: `/api/sessions/${this.sessionId}/organizer/leave`,
          method: "PATCH"
        });
      });
    },
    async cancelSession() {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      if (this.hasActiveAlbumPhotos) {
        this.confirmAction("相册已有照片，不能取消删除。要先打开相册删除所有照片吗？", () => {
          this.goAlbum();
        });
        return;
      }
      this.confirmAction("确认取消本车吗？取消后这辆车会被直接删除。", async () => {
        await this.runCancelSession();
      });
    },
    async runCancelSession() {
      if (this.busyAction) {
        return;
      }
      this.busyAction = true;
      this.busyText = "正在取消本车...";
      try {
        await request({
          url: `/api/sessions/${this.sessionId}/cancel`,
          method: "PATCH",
          data: {
            reason: this.cancelReason.trim()
          }
        });
        this.statusText = "本车已取消。";
        uni.showToast({ title: "本车已取消", icon: "none" });
        uni.redirectTo({ url: "/pages/mine/index" });
      } catch (error) {
        this.statusText = this.cancelSessionErrorText(error);
      } finally {
        this.busyAction = false;
        this.busyText = "";
      }
    },
    confirmAction(content, onConfirm) {
      if (this.busyAction) {
        return;
      }
      uni.showModal({
        title: "确认操作",
        content,
        confirmText: "确认",
        cancelText: "再想想",
        success: (result) => {
          if (result.confirm) {
            onConfirm();
          }
        }
      });
    },
    async runAction(successText, options) {
      if (this.busyAction) {
        return;
      }
      this.busyAction = true;
      this.busyText = "正在处理，请稍候...";
      try {
        await request(options);
        await this.reload();
        this.statusText = successText;
      } catch (error) {
        this.statusText = this.actionErrorText(error);
      } finally {
        this.busyAction = false;
        this.busyText = "";
      }
    },
    async runOrganizerTransition(successText, options) {
      if (this.busyAction) {
        return;
      }
      this.busyAction = true;
      this.busyText = "正在处理，请稍候...";
      try {
        await request(options);
        this.statusText = successText;
        uni.showToast({ title: successText, icon: "none" });
        const id = this.sessionId || "d1-demo";
        uni.redirectTo({ url: `/pages/session/detail?id=${id}` });
      } catch (error) {
        this.statusText = this.actionErrorText(error);
      } finally {
        this.busyAction = false;
        this.busyText = "";
      }
    },
    actionErrorText(error) {
      if (error?.statusCode === 403) {
        return "只有车头可以执行这个操作。";
      }
      if (error?.statusCode === 409) {
        return "暂无可接任的车友，请先确认有人已上车。";
      }
      return "操作失败，请稍后重试。";
    },
    cancelSessionErrorText(error) {
      if (error?.data?.error?.code === "SESSION_HAS_ONBOARD_MEMBERS") {
        return "已有玩家上车，不能取消删除；请退出车头。";
      }
      if (error?.data?.error?.code === "SESSION_HAS_ALBUM_PHOTOS") {
        return "相册已有照片，请先删除所有照片后再取消这辆车。";
      }
      return this.actionErrorText(error);
    },
    goAlbum() {
      if (this.busyAction) {
        return;
      }
      const id = this.sessionId || "d1-demo";
      uni.navigateTo({ url: `/pages/session/album?id=${id}` });
    },
    async goDetail() {
      if (this.busyAction) {
        return;
      }
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      const id = this.sessionId || "d1-demo";
      uni.navigateTo({ url: `/pages/session/detail?id=${id}` });
    },
    seatById(seatId) {
      return (this.session.seats || []).find((seat) => Number(seat.id) === Number(seatId));
    },
    seatName(seatId) {
      return this.seatById(seatId)?.name || `座位 ${seatId}`;
    },
    seatStatus(seatId) {
      return this.seatById(seatId)?.status || "";
    },
    canKickSeat(seat) {
      return Boolean(seat?.id);
    },
    canTransferOrganizerToSeat(seat) {
      return (
        seat?.confirmed_user_id &&
        Number(seat.confirmed_user_id) !== Number(this.session.organizer_user_id)
      );
    },
    sessionStatusLabel(status) {
      const labels = {
        draft: "草稿",
        recruiting: "招募中",
        locked: "已锁车",
        cancelled: "已取消"
      };
      return labels[status] || status || "未知";
    },
    seatStatusLabel(status) {
      const labels = {
        open: "开放",
        applied: "待审核",
        confirmed: "已上车",
        locked: "已锁定",
        cancelled: "已取消"
      };
      return labels[status] || status || "未知";
    },
    signupStatusLabel(status) {
      const labels = {
        pending: "待审核",
        approved: "已通过",
        rejected: "已拒绝",
        cancelled: "已取消"
      };
      return labels[status] || status || "未知";
    },
    seatTypeLabel(type) {
      const labels = {
        love_companion: "情感沉浸位",
        f4: "互动位",
        normal: "普通位"
      };
      return labels[type] || type || "普通位";
    }
  }
};
</script>

<style scoped>
.manage-page {
  padding-bottom: 64rpx;
}

.section-title {
  margin-bottom: 18rpx;
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20rpx;
}

.section-note {
  color: #738078;
  font-size: 24rpx;
  line-height: 1.45;
}

.setting-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  margin-top: 18rpx;
  padding-top: 18rpx;
  border-top: 1rpx solid rgba(222, 216, 202, 0.72);
}

.setting-switch-copy {
  min-width: 0;
  flex: 1;
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

.setting-title {
  margin-bottom: 6rpx;
  color: #153f34;
  font-size: 26rpx;
  font-weight: 600;
}

.notice,
.empty {
  margin-top: 14rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  background: #eef7f4;
  color: #1f7a68;
  font-size: 24rpx;
  line-height: 1.5;
}

.empty {
  background: #f8fafc;
  color: #64748b;
}

.info-row {
  margin-top: 10rpx;
  color: #475569;
  font-size: 26rpx;
  line-height: 1.5;
}

.textarea {
  width: 100%;
  height: 132rpx;
  margin-top: 18rpx;
  padding: 20rpx 22rpx;
  box-sizing: border-box;
  border-radius: 14rpx;
  background: #f4f1ea;
  color: #183d34;
  font-size: 26rpx;
  line-height: 1.45;
}

.placeholder {
  color: #9ba39c;
}

.seat-card,
.signup-card {
  margin-top: 18rpx;
  padding: 22rpx;
  border: 1rpx solid #e6e0d2;
  border-radius: 8rpx;
  background: #fffefb;
}

.signup-card {
  background: #ffffff;
}

.seat-header {
  display: flex;
  justify-content: space-between;
  gap: 12rpx;
  margin-bottom: 8rpx;
}

.seat-title {
  color: #153f34;
  font-size: 28rpx;
  font-weight: 600;
}

.seat-status {
  flex-shrink: 0;
  color: #1f6f5b;
  font-size: 24rpx;
  font-weight: 600;
}

.actions.compact {
  gap: 12rpx;
  margin-top: 18rpx;
}

.mini-button {
  height: 64rpx;
  border-radius: 8rpx;
  background: #1f6f5b;
  color: #ffffff;
  font-size: 24rpx;
  line-height: 64rpx;
}

.mini-button.disabled,
.mini-button[disabled] {
  opacity: 0.45;
}

.mini-button.muted {
  background: #ffffff;
  color: #193d35;
  border: 1rpx solid #ded8ca;
}

.button.danger {
  background: #9f3f33;
  box-shadow: 0 12rpx 28rpx rgba(159, 63, 51, 0.18);
}

.danger-section {
  border-color: #ead2ca;
}
</style>
