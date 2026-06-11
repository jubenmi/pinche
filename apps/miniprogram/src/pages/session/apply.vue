<template>
  <view class="page">
    <view class="section">
      <view class="title">{{ session.script_name_snapshot || "申请上车" }}</view>
      <view class="text">{{ summaryText }}</view>
      <view v-if="statusText" class="notice">{{ statusText }}</view>
    </view>

    <view v-if="session.id" class="section">
      <view class="section-title">选择座位</view>
      <view
        v-for="seat in session.seats"
        :key="seat.id"
        class="seat-card"
        :class="{ selected: Number(selectedSeatId) === Number(seat.id), unavailable: !canApplySeat(seat) }"
        @tap="selectSeat(seat)"
      >
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
      <view class="section-title">报名信息</view>
      <input
        v-model="form.contactText"
        class="field"
        placeholder="联系方式，可填微信号或手机号"
      />
      <textarea
        v-model="form.note"
        class="textarea"
        placeholder="申请备注，可写可接受的角色、时间确认等"
      />
      <view class="actions">
        <button class="button" :disabled="submitBusy" @tap="submitSignup">
          {{ submitBusy ? "提交中..." : "提交申请" }}
        </button>
      </view>
    </view>
  </view>
</template>

<script>
import {
  dataOf,
  getCurrentUser,
  queryString,
  request,
  setAuth
} from "../../utils/api";

export default {
  data() {
    return {
      sessionId: "",
      selectedSeatId: "",
      shareCode: "",
      source: "",
      session: {},
      form: {
        contactText: "",
        note: ""
      },
      statusText: "",
      submitBusy: false
    };
  },
  computed: {
    summaryText() {
      if (!this.session.id) {
        return "选择开放座位，填写联系方式后提交给车头审核。";
      }
      return `${this.session.store_name_snapshot} / ${this.session.start_at}`;
    },
    selectedSeat() {
      return (this.session.seats || []).find(
        (seat) => Number(seat.id) === Number(this.selectedSeatId)
      );
    }
  },
  onLoad(options) {
    this.sessionId = options.id || "";
    this.selectedSeatId = options.seatId || "";
    this.shareCode = options.shareCode || "";
    this.source = options.source || "";
    this.loadSession();
  },
  methods: {
    async loadSession() {
      if (!this.sessionId || this.sessionId === "d1-demo") {
        this.statusText = "请从已发布车进入申请页。";
        return;
      }
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}` });
        this.session = dataOf(response) || {};
        this.pickDefaultSeat();
      } catch (error) {
        this.statusText = "车详情加载失败，请稍后重试。";
      }
    },
    pickDefaultSeat() {
      const seats = this.session.seats || [];
      const selected = seats.find(
        (seat) => Number(seat.id) === Number(this.selectedSeatId)
      );
      if (selected && this.canApplySeat(selected)) {
        return;
      }
      const firstOpen = seats.find((seat) => this.canApplySeat(seat));
      this.selectedSeatId = firstOpen ? firstOpen.id : "";
    },
    selectSeat(seat) {
      if (!this.canApplySeat(seat)) {
        this.statusText = "这个座位当前不可申请。";
        return;
      }
      this.selectedSeatId = seat.id;
      this.statusText = "";
    },
    canApplySeat(seat) {
      return (
        this.session.status === "recruiting" &&
        ["open", "applied"].includes(seat.status)
      );
    },
    async ensureLogin() {
      const auth = getCurrentUser();
      if (auth.user) {
        return true;
      }

      this.statusText = "需要微信登录后提交申请。";
      try {
        const authData = await this.loginWithWechat();
        if (!authData) {
          this.statusText = "登录失败，未提交申请。";
          return false;
        }
        return true;
      } catch (error) {
        this.statusText = "登录失败，未提交申请。";
        return false;
      }
    },
    loginWithWechat() {
      return new Promise((resolve, reject) => {
        uni.login({
          provider: "weixin",
          success: (loginResult) => {
            request({
              url: "/api/auth/wechat/login",
              method: "POST",
              data: {
                code: loginResult.code || "dev-player-openid"
              }
            })
              .then((response) => {
                const data = dataOf(response);
                if (data) {
                  setAuth(data);
                }
                resolve(data);
              })
              .catch(reject);
          },
          fail: reject
        });
      });
    },
    async submitSignup() {
      if (this.submitBusy) {
        return;
      }
      if (!this.selectedSeat) {
        this.statusText = "请选择可申请的座位。";
        return;
      }
      if (!this.form.contactText.trim()) {
        this.statusText = "请填写联系方式，方便车头审核。";
        return;
      }
      const loggedIn = await this.ensureLogin();
      if (!loggedIn) {
        return;
      }

      this.submitBusy = true;
      this.statusText = "";
      try {
        const response = await request({
          url: "/api/signups",
          method: "POST",
          data: {
            seatId: this.selectedSeat.id,
            contactText: this.form.contactText.trim(),
            note: this.form.note.trim()
          }
        });
        const signup = dataOf(response) || {};
        this.statusText = "申请已提交，等待车头审核。";
        await this.afterSignupSuccess(signup);
      } catch (error) {
        this.statusText = this.signupErrorText(error);
      } finally {
        this.submitBusy = false;
      }
    },
    async afterSignupSuccess(signup) {
      this.markSeatApplied();
      this.recordShareConvert(signup.id);
      this.requestSignupSubscription(signup.id);
      await this.loadSession();
    },
    markSeatApplied() {
      const seat = this.selectedSeat;
      if (seat && seat.status === "open") {
        seat.status = "applied";
      }
    },
    recordShareConvert(signupId) {
      request({
        url: "/api/share-events/convert",
        method: "POST",
        data: {
          sessionId: Number(this.sessionId),
          seatId: Number(this.selectedSeatId),
          convertedSignupId: signupId || null,
          shareCode: this.shareCode,
          source: this.source || "direct_apply",
          path: `/pages/session/apply${queryString({
            id: this.sessionId,
            seatId: this.selectedSeatId
          })}`,
          rawPayload: {
            shareCode: this.shareCode,
            source: this.source || "direct_apply"
          }
        }
      }).catch(() => {});
    },
    requestSignupSubscription(signupId) {
      const templateId = getApp().globalData.signupResultTemplateId || "";
      if (!templateId || typeof uni.requestSubscribeMessage !== "function") {
        this.recordSubscriptionResult(signupId, false, {
          reason: "template_not_configured"
        });
        return;
      }

      uni.requestSubscribeMessage({
        tmplIds: [templateId],
        success: (result) => {
          this.recordSubscriptionResult(signupId, result[templateId] === "accept", result);
        },
        fail: (error) => {
          this.recordSubscriptionResult(signupId, false, error);
        }
      });
    },
    recordSubscriptionResult(signupId, accepted, rawResult) {
      request({
        url: "/api/subscriptions/request-result",
        method: "POST",
        data: {
          scene: "signup_result",
          accepted,
          rawResult: {
            signupId,
            ...rawResult
          }
        }
      }).catch(() => {});
    },
    signupErrorText(error) {
      if (error?.statusCode === 409) {
        return "你已申请过这个座位，请等待车头审核。";
      }
      if (error?.statusCode === 401) {
        return "请先登录后再提交申请。";
      }
      return "申请提交失败，请稍后重试。";
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

.field,
.textarea {
  width: 100%;
  box-sizing: border-box;
  margin-top: 16rpx;
  padding: 18rpx;
  border: 1rpx solid #d7dde3;
  border-radius: 8rpx;
  background: #ffffff;
  color: #1f2933;
  font-size: 26rpx;
}

.textarea {
  min-height: 160rpx;
}

.seat-card {
  margin-top: 18rpx;
  padding: 20rpx;
  border: 1rpx solid #e6e8eb;
  border-radius: 8rpx;
  background: #fbfcfd;
}

.seat-card.selected {
  border-color: #1f7a68;
  background: #eef7f4;
}

.seat-card.unavailable {
  opacity: 0.58;
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

.info-row {
  margin-top: 8rpx;
  color: #475569;
  font-size: 26rpx;
  line-height: 1.5;
}
</style>
