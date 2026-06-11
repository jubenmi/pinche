<template>
  <view class="page">
    <view class="section">
      <view class="title">{{ session.script_name_snapshot || "车详情" }}</view>
      <view class="text">{{ summaryText }}</view>
      <view v-if="loadStatusText" class="notice">{{ loadStatusText }}</view>
      <view class="actions">
        <button class="button" @tap="goApply">申请上车</button>
        <button class="button secondary" open-type="share">分享</button>
      </view>
    </view>

    <view v-if="session.id" class="section">
      <view class="section-title">发车信息</view>
      <view class="info-row">店家：{{ session.store_name_snapshot }}</view>
      <view class="info-row">时间：{{ session.start_at }}</view>
      <view class="info-row">指定DM：{{ session.dm_name_snapshot || "未指定" }}</view>
      <view class="info-row">指定NPC：{{ session.npc_name_snapshot || "未指定" }}</view>
      <view class="info-row">押金：{{ formatCents(session.deposit_amount || 0) }}</view>
      <view class="info-row">状态：{{ statusLabel(session.status) }}</view>
      <view v-if="session.note" class="info-row">备注：{{ session.note }}</view>
    </view>

    <view v-if="session.seats && session.seats.length" class="section">
      <view class="section-title">座位</view>
      <view v-for="seat in session.seats" :key="seat.id" class="seat-card">
        <view class="seat-header">
          <view class="seat-title">{{ seat.name }}</view>
          <view class="seat-status">{{ seatStatusLabel(seat.status) }}</view>
        </view>
        <view class="info-row">类型：{{ seat.seat_type }}</view>
        <view class="info-row">角色：{{ seat.role_name || "未标注" }}</view>
        <view class="info-row">原价：{{ formatCents(seat.base_price) }}</view>
        <view class="info-row">调整：{{ formatCents(seat.adjustment) }}</view>
        <view class="info-row strong">实付：{{ formatCents(seat.payable_price) }}</view>
        <view class="seat-actions">
          <button
            v-if="canApplySeat(seat)"
            class="mini-button"
            @tap="goApply(seat)"
          >
            申请此位
          </button>
          <view v-else class="item-sub">当前座位不可申请</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { dataOf, queryString, request } from "../../utils/api";

export default {
  data() {
    return {
      sessionId: "",
      shareCode: "",
      source: "",
      session: {},
      loadStatusText: ""
    };
  },
  computed: {
    summaryText() {
      if (!this.session.id) {
        return "座位、价格调整和申请状态。";
      }
      return `${this.session.store_name_snapshot} / ${this.session.start_at}`;
    }
  },
  onLoad(options) {
    this.sessionId = options.id || "";
    this.shareCode = options.shareCode || "";
    this.source = options.source || "";
    this.loadSession();
    this.trackShareView();
  },
  onShareAppMessage() {
    const id = this.sessionId || "d1-demo";
    const shareCode = `s${id}-${Date.now()}`;
    const query = queryString({
      id,
      shareCode,
      source: "wechat_share"
    });
    const title = this.session.script_name_snapshot
      ? `${this.session.script_name_snapshot} 发车`
      : "拼车发车";
    return {
      title,
      path: `/pages/session/detail${query}`
    };
  },
  methods: {
    async loadSession() {
      if (!this.sessionId || this.sessionId === "d1-demo") {
        this.loadStatusText = "请从已发布车进入详情。";
        return;
      }
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}` });
        this.session = dataOf(response) || {};
        this.loadStatusText = "";
      } catch (error) {
        this.loadStatusText = "车详情加载失败，请稍后重试。";
      }
    },
    trackShareView() {
      if (!this.sessionId || this.sessionId === "d1-demo") {
        return;
      }
      if (!this.shareCode && !this.source) {
        return;
      }
      request({
        url: "/api/share-events/view",
        method: "POST",
        data: {
          sessionId: Number(this.sessionId),
          shareCode: this.shareCode,
          source: this.source || "unknown",
          path: `/pages/session/detail?id=${this.sessionId}`,
          rawPayload: {
            source: this.source,
            shareCode: this.shareCode
          }
        }
      }).catch(() => {});
    },
    goApply(seat) {
      const id = this.sessionId || "d1-demo";
      const query = queryString({
        id,
        seatId: seat?.id || "",
        shareCode: this.shareCode,
        source: this.source
      });
      uni.navigateTo({ url: `/pages/session/apply${query}` });
    },
    canApplySeat(seat) {
      return (
        this.session.status === "recruiting" &&
        ["open", "applied"].includes(seat.status)
      );
    },
    statusLabel(status) {
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

.notice {
  margin-top: 14rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  background: #eef7f4;
  color: #1f7a68;
  font-size: 24rpx;
  line-height: 1.5;
}

.info-row {
  margin-top: 10rpx;
  color: #475569;
  font-size: 26rpx;
  line-height: 1.5;
}

.info-row.strong {
  color: #1f2933;
  font-weight: 600;
}

.seat-card {
  margin-top: 18rpx;
  padding: 20rpx;
  border: 1rpx solid #e6e8eb;
  border-radius: 8rpx;
  background: #fbfcfd;
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

.seat-actions {
  margin-top: 16rpx;
}

.mini-button {
  height: 60rpx;
  border-radius: 8rpx;
  background: #1f7a68;
  color: #ffffff;
  font-size: 24rpx;
  line-height: 60rpx;
}

.item-sub {
  color: #94a3b8;
  font-size: 24rpx;
}
</style>
