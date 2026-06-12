<template>
  <view class="page">
    <view class="section">
      <view class="title">{{ session.script_name_snapshot || "车详情" }}</view>
      <view class="text">{{ summaryText }}</view>
      <view v-if="loadStatusText" class="notice">{{ loadStatusText }}</view>
      <view v-if="copyStatusText" class="notice">{{ copyStatusText }}</view>
      <view class="actions">
        <button class="button" @tap="goApply">申请上车</button>
        <button class="button secondary" open-type="share">分享</button>
        <button class="button secondary" @tap="copyRecruitmentText">复制文案</button>
      </view>
    </view>

    <view v-if="session.id" class="section">
      <view class="section-title">招募统计</view>
      <view class="stats-grid">
        <view class="stat-item">
          <view class="stat-value">{{ shareStats.view_count || 0 }}</view>
          <view class="stat-label">浏览</view>
        </view>
        <view class="stat-item">
          <view class="stat-value">{{ shareStats.signup_count || 0 }}</view>
          <view class="stat-label">申请</view>
        </view>
        <view class="stat-item">
          <view class="stat-value">{{ shareStats.convert_count || 0 }}</view>
          <view class="stat-label">转化</view>
        </view>
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
      <view
        v-for="seat in session.seats"
        :key="seat.id"
        class="seat-card"
        :class="{ focused: isFocusedSeat(seat) }"
      >
        <view class="seat-header">
          <view class="seat-title">{{ seat.name }}</view>
          <view class="seat-status">{{ seatStatusLabel(seat.status) }}</view>
        </view>
        <view class="info-row">类型：{{ seat.seat_type }}</view>
        <view class="info-row">角色：{{ seat.role_name || "未标注" }}</view>
        <view class="info-row">原价：{{ formatCents(seat.base_price) }}</view>
        <view class="info-row">调整：{{ formatCents(seat.adjustment) }}</view>
        <view class="info-row strong">实付：{{ formatCents(seat.payable_price) }}</view>
        <view v-if="seatShareStats(seat)" class="info-row">
          统计：{{ seatShareStats(seat).view_count || 0 }}浏览 · {{ seatShareStats(seat).signup_count || 0 }}申请
        </view>
        <view class="seat-actions">
          <button
            v-if="canApplySeat(seat)"
            class="mini-button"
            @tap="goApply(seat)"
          >
            申请此位
          </button>
          <view v-else class="item-sub">当前座位不可申请</view>
          <button
            class="mini-button ghost"
            open-type="share"
            :data-seat-id="seat.id"
          >
            分享此位
          </button>
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
      focusedSeatId: "",
      session: {},
      shareStats: {},
      loadStatusText: "",
      copyStatusText: ""
    };
  },
  computed: {
    summaryText() {
      if (!this.session.id) {
        return "座位、价格调整和申请状态。";
      }
      return `${this.session.store_name_snapshot} / ${this.session.start_at}`;
    },
    focusedSeat() {
      return (this.session.seats || []).find(
        (seat) => Number(seat.id) === Number(this.focusedSeatId)
      );
    }
  },
  onLoad(options) {
    this.sessionId = options.id || "";
    this.shareCode = options.shareCode || "";
    this.source = options.source || "";
    this.focusedSeatId = options.seatId || "";
    this.loadSession();
    this.loadShareStats();
    this.trackShareView();
  },
  onShareAppMessage(options) {
    const id = this.sessionId || "d1-demo";
    const shareCode = `s${id}-${Date.now()}`;
    const seatId = options?.target?.dataset?.seatId || "";
    const seat = this.seatById(seatId);
    const query = queryString({
      id,
      shareCode,
      seatId,
      source: "wechat_share"
    });
    const title = this.session.script_name_snapshot
      ? `${this.session.script_name_snapshot}${seat ? ` ${seat.name}` : ""} 发车`
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
        if (this.focusedSeatId && this.focusedSeat) {
          this.loadStatusText = "已定位到分享指定座位。";
        }
      } catch (error) {
        this.loadStatusText = "车详情加载失败，请稍后重试。";
      }
    },
    async loadShareStats() {
      if (!this.sessionId || this.sessionId === "d1-demo") {
        return;
      }
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/share-stats` });
        this.shareStats = dataOf(response) || {};
      } catch (error) {
        this.shareStats = {};
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
          seatId: this.focusedSeatId || null,
          rawPayload: {
            source: this.source,
            shareCode: this.shareCode,
            seatId: this.focusedSeatId
          }
        }
      })
        .then(() => this.loadShareStats())
        .catch(() => {});
    },
    goApply(seat) {
      const id = this.sessionId || "d1-demo";
      const selectedSeat = seat || this.focusedSeat;
      const query = queryString({
        id,
        seatId: selectedSeat?.id || "",
        shareCode: this.shareCode,
        source: this.source
      });
      uni.navigateTo({ url: `/pages/session/apply${query}` });
    },
    copyRecruitmentText() {
      const text = this.recruitmentText();
      const riskWord = this.firstRiskWord(text);
      if (riskWord) {
        this.copyStatusText = `文案包含高风险词「${riskWord}」，请先改写。`;
        return;
      }

      uni.setClipboardData({
        data: text,
        success: () => {
          this.copyStatusText = "招募文案已复制。";
        },
        fail: () => {
          this.copyStatusText = "复制失败，请稍后重试。";
        }
      });
    },
    recruitmentText() {
      const seats = (this.session.seats || []).filter((seat) => this.canApplySeat(seat));
      const seatLines = seats.length
        ? seats.map((seat) => {
            const role = seat.role_name ? `｜${seat.role_name}` : "";
            return `- ${seat.name}${role}｜实付${this.formatCents(seat.payable_price)}`;
          })
        : ["- 当前暂无可申请座位"];
      return [
        `${this.session.script_name_snapshot || "拼车发车"}`,
        `店家：${this.session.store_name_snapshot || "待确认"}`,
        `时间：${this.session.start_at || "待确认"}`,
        "座位：",
        ...seatLines,
        "可在小程序内选择座位并提交申请，车头审核后确认。"
      ].join("\n");
    },
    firstRiskWord(text) {
      const riskWords = [
        "红包",
        "返现",
        "提现",
        "现金奖励",
        "返利",
        "佣金",
        "分享得",
        "分享奖励",
        "拉人奖励",
        "拉新奖励",
        "抽奖",
        "优先锁座",
        "现实陪伴",
        "线下陪伴",
        "联系方式",
        "手机号",
        "微信号",
        "加微信"
      ];
      const keyword = riskWords.find((word) => text.includes(word));
      if (keyword) {
        return keyword;
      }
      if (/1[3-9]\d{9}/.test(text)) {
        return "手机号";
      }
      return "";
    },
    seatById(seatId) {
      return (this.session.seats || []).find((seat) => Number(seat.id) === Number(seatId));
    },
    isFocusedSeat(seat) {
      return this.focusedSeatId && Number(seat.id) === Number(this.focusedSeatId);
    },
    seatShareStats(seat) {
      return (this.shareStats.seats || []).find((item) => Number(item.id) === Number(seat.id));
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

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12rpx;
}

.stat-item {
  padding: 18rpx;
  border: 1rpx solid #e6e8eb;
  border-radius: 8rpx;
  background: #fbfcfd;
}

.stat-value {
  color: #1f2933;
  font-size: 32rpx;
  font-weight: 600;
}

.stat-label {
  margin-top: 6rpx;
  color: #64748b;
  font-size: 24rpx;
}

.seat-card {
  margin-top: 18rpx;
  padding: 20rpx;
  border: 1rpx solid #e6e8eb;
  border-radius: 8rpx;
  background: #fbfcfd;
}

.seat-card.focused {
  border-color: #1f7a68;
  background: #f1fbf8;
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
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
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

.mini-button.ghost {
  background: #eef2f7;
  color: #334155;
}

.item-sub {
  color: #94a3b8;
  font-size: 24rpx;
}
</style>
