<template>
  <view class="page manage-page">
    <AuthIdentityBar />

    <view class="section">
      <view class="title">{{ session.script_name_snapshot || "车头管理" }}</view>
      <view class="text">{{ summaryText }}</view>
      <view v-if="statusText" class="notice">{{ statusText }}</view>
      <view class="actions">
        <button class="button" @click="reload">刷新</button>
        <button class="button secondary" @click="goDetail">车局详情</button>
      </view>
    </view>

    <view v-if="session.id" class="section">
      <view class="section-title">车况</view>
      <view class="info-row">店家：{{ session.store_name_snapshot }}</view>
      <view class="info-row">时间：{{ session.start_at }}</view>
      <view class="info-row">状态：{{ sessionStatusLabel(session.status) }}</view>
      <view class="info-row">座位：{{ seatSummary }}</view>
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
      <view class="section-title">取消车</view>
      <view class="section-note">取消后座位会全部关闭，车内留言会留下取消通知。</view>
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
          :disabled="busyAction || session.status === 'cancelled'"
          @click="cancelSession"
        >
          取消本车
        </button>
      </view>
    </view>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import ManagePinnedMessage from "../../extensions/session-pseudo-chat/ManagePinnedMessage.vue";
import { sessionManageExtensions } from "../../extensions/sessionExtensions.js";
import { dataOf, ensureLoggedIn, request } from "../../utils/api";

export default {
  components: { AuthIdentityBar, ManagePinnedMessage },
  data() {
    return {
      sessionId: "",
      session: {},
      signups: [],
      sessionManageExtensions,
      statusText: "",
      busyAction: false,
      cancelReason: ""
    };
  },
  computed: {
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
    async reload() {
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
    async approve(signup) {
      await this.runAction("已通过申请，玩家可进入车内聊天。", {
        url: `/api/signups/${signup.id}/approve`,
        method: "PATCH"
      });
    },
    async reject(signup) {
      await this.runAction("已拒绝申请。", {
        url: `/api/signups/${signup.id}/reject`,
        method: "PATCH"
      });
    },
    kickSeat(seat) {
      this.confirmAction(`确认释放「${seat.name}」吗？`, async () => {
        await this.runAction("座位已释放。", {
          url: `/api/session-seats/${seat.id}/kick`,
          method: "PATCH"
        });
      });
    },
    cancelSession() {
      this.confirmAction("确认取消本车吗？", async () => {
        await this.runAction("本车已取消。", {
          url: `/api/sessions/${this.sessionId}/cancel`,
          method: "PATCH",
          data: {
            reason: this.cancelReason.trim()
          }
        });
      });
    },
    confirmAction(content, onConfirm) {
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
      try {
        await request(options);
        await this.reload();
        this.statusText = successText;
      } catch (error) {
        this.statusText = this.actionErrorText(error);
      } finally {
        this.busyAction = false;
      }
    },
    actionErrorText(error) {
      if (error?.statusCode === 403) {
        return "只有车头可以执行这个操作。";
      }
      if (error?.statusCode === 409) {
        return "座位状态已变化，请刷新后再试。";
      }
      return "操作失败，请稍后重试。";
    },
    goDetail() {
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
      return ["applied", "confirmed", "locked"].includes(seat.status);
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
