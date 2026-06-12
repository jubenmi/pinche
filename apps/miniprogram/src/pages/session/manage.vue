<template>
  <view class="page">
    <view class="section">
      <view class="title">{{ session.script_name_snapshot || "车头管理" }}</view>
      <view class="text">{{ summaryText }}</view>
      <view v-if="statusText" class="notice">{{ statusText }}</view>
      <view class="actions">
        <button class="button" @tap="reload">刷新</button>
        <button class="button secondary" @tap="goDetail">车详情</button>
      </view>
    </view>

    <view v-if="session.id" class="section">
      <view class="section-title">车况</view>
      <view class="info-row">店家：{{ session.store_name_snapshot }}</view>
      <view class="info-row">时间：{{ session.start_at }}</view>
      <view class="info-row">状态：{{ sessionStatusLabel(session.status) }}</view>
      <view class="info-row">押金：{{ formatCents(session.deposit_amount || 0) }}</view>
      <view class="info-row">座位：{{ seatSummary }}</view>
    </view>

    <view v-if="session.seats && session.seats.length" class="section">
      <view class="section-title">座位状态</view>
      <view v-for="seat in session.seats" :key="seat.id" class="seat-card">
        <view class="seat-header">
          <view class="seat-title">{{ seat.name }}</view>
          <view class="seat-status">{{ seatStatusLabel(seat.status) }}</view>
        </view>
        <view class="info-row">类型：{{ seat.seat_type }}</view>
        <view class="info-row">角色：{{ seat.role_name || "未标注" }}</view>
        <view class="info-row">实付：{{ formatCents(seat.payable_price) }}</view>
      </view>
    </view>

    <view v-if="session.id" class="section">
      <view class="section-title">申请列表</view>
      <view v-if="signups.length === 0" class="empty">暂无申请。</view>
      <view v-for="signup in signups" :key="signup.id" class="signup-card">
        <view class="seat-header">
          <view class="seat-title">{{ seatName(signup.seat_id) }}</view>
          <view class="seat-status">{{ signupStatusLabel(signup.status) }}</view>
        </view>
        <view class="info-row">联系方式：{{ signup.contact_text || "未填写" }}</view>
        <view v-if="signup.note" class="info-row">备注：{{ signup.note }}</view>
        <view class="info-row">押金状态：{{ depositStatusLabel(signup.deposit_status) }}</view>
        <view class="info-row">座位状态：{{ seatStatusLabel(seatStatus(signup.seat_id)) }}</view>

        <view v-if="signup.status === 'pending'" class="actions compact">
          <button
            class="mini-button"
            :disabled="busyAction"
            @tap="approve(signup)"
          >
            通过
          </button>
          <button
            class="mini-button muted"
            :disabled="busyAction"
            @tap="reject(signup)"
          >
            拒绝
          </button>
        </view>

        <view v-if="signup.status === 'approved'" class="deposit-grid">
          <button
            v-for="item in depositStatuses"
            :key="item.value"
            class="deposit-button"
            :class="{ active: signup.deposit_status === item.value }"
            :disabled="busyAction"
            @tap="updateDepositStatus(signup, item.value)"
          >
            {{ item.label }}
          </button>
        </view>

        <view v-if="canLock(signup)" class="actions compact">
          <button
            class="mini-button"
            :disabled="busyAction"
            @tap="lock(signup)"
          >
            锁座
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { dataOf, request } from "../../utils/api";

export default {
  data() {
    return {
      sessionId: "",
      session: {},
      signups: [],
      statusText: "",
      busyAction: false,
      depositStatuses: [
        { value: "unpaid", label: "未付" },
        { value: "pending_confirm", label: "待确认" },
        { value: "confirmed", label: "已确认" },
        { value: "refunded", label: "已退" }
      ]
    };
  },
  computed: {
    summaryText() {
      if (!this.session.id) {
        return "审核申请、记录押金和锁座。";
      }
      return `${this.session.store_name_snapshot} / ${this.session.start_at}`;
    },
    seatSummary() {
      const seats = this.session.seats || [];
      const pending = seats.filter((seat) => seat.status === "applied").length;
      const confirmed = seats.filter((seat) => seat.status === "confirmed").length;
      const locked = seats.filter((seat) => seat.status === "locked").length;
      return `${seats.length}位，${pending}待审，${confirmed}已确认，${locked}已锁座`;
    }
  },
  onLoad(options) {
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
          this.statusText = "只有车头可以查看联系方式和审核申请。";
        } else if (error?.statusCode === 401) {
          this.statusText = "请先登录后再管理发车。";
        } else {
          this.statusText = "申请列表加载失败，请稍后重试。";
        }
        this.signups = [];
      }
    },
    async approve(signup) {
      await this.runAction("已通过申请。", {
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
    async updateDepositStatus(signup, depositStatus) {
      await this.runAction("押金状态已更新。", {
        url: `/api/signups/${signup.id}/deposit`,
        method: "PATCH",
        data: { depositStatus }
      });
    },
    async lock(signup) {
      await this.runAction("已锁座。", {
        url: `/api/session-seats/${signup.seat_id}/lock`,
        method: "POST"
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
    canLock(signup) {
      return signup.status === "approved" && this.seatStatus(signup.seat_id) === "confirmed";
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
        confirmed: "已确认",
        locked: "已锁座",
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
    depositStatusLabel(status) {
      const labels = {
        unpaid: "未付",
        pending_confirm: "待确认",
        confirmed: "已确认",
        refunded: "已退"
      };
      return labels[status] || status || "未知";
    },
    formatCents(value) {
      const cents = Number(value || 0);
      const prefix = cents < 0 ? "-¥" : "¥";
      const absolute = Math.abs(cents);
      const yuan = absolute % 100 === 0 ? String(absolute / 100) : (absolute / 100).toFixed(2);
      return `${prefix}${yuan}`;
    }
  }
};
</script>

<style scoped>
.section-title {
  margin-bottom: 18rpx;
  font-size: 30rpx;
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

.seat-card,
.signup-card {
  margin-top: 18rpx;
  padding: 20rpx;
  border: 1rpx solid #e6e8eb;
  border-radius: 8rpx;
  background: #fbfcfd;
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
  color: #1f2933;
  font-size: 28rpx;
  font-weight: 600;
}

.seat-status {
  flex-shrink: 0;
  color: #1f7a68;
  font-size: 24rpx;
}

.actions.compact {
  gap: 12rpx;
  margin-top: 18rpx;
}

.mini-button,
.deposit-button {
  height: 60rpx;
  border-radius: 8rpx;
  background: #1f7a68;
  color: #ffffff;
  font-size: 24rpx;
  line-height: 60rpx;
}

.mini-button.muted,
.deposit-button {
  background: #eef2f7;
  color: #334155;
}

.deposit-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10rpx;
  margin-top: 18rpx;
}

.deposit-button.active {
  background: #1f7a68;
  color: #ffffff;
}
</style>
