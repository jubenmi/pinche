<template>
  <view class="page session-detail-page">
    <AuthIdentityBar />

    <view class="section">
      <view class="title">{{ session.script_name_snapshot || "车局" }}</view>
      <view class="text">{{ summaryText }}</view>
      <view v-if="isPostStart" class="post-start-album-card">
        <view class="post-start-title">相册已开放</view>
        <view class="post-start-text">{{ postStartAlbumText }}</view>
        <view class="post-start-album-stats">
          <view class="post-start-stat">
            <view class="post-start-stat-value">{{ albumVisiblePhotoCount }}</view>
            <view class="post-start-stat-label">可见照片</view>
          </view>
          <view class="post-start-stat">
            <view class="post-start-stat-value">{{ reviewCount }}</view>
            <view class="post-start-stat-label">车友记录</view>
          </view>
        </view>
      </view>
      <view v-if="loadStatusText" class="notice">{{ loadStatusText }}</view>
      <view v-if="copyStatusText" class="notice">{{ copyStatusText }}</view>
      <view class="actions">
        <button v-if="isPostStart" class="button" @click="goAlbum">{{ albumPrimaryText }}</button>
        <button v-else class="button" @click="goShare">选择角色</button>
        <button class="button secondary" open-type="share">分享</button>
        <button class="button secondary" @click="goManage">车头管理</button>
        <button v-if="!isPostStart" class="button secondary" @click="goAlbum">{{ albumButtonText }}</button>
        <button
          v-if="isPostStart && myReviewState.can_review"
          class="button secondary"
          @click="goReview"
        >
          {{ myReviewState.review ? "编辑记录" : "写记录" }}
        </button>
      </view>
    </view>

    <view v-if="session.id" class="section info-section">
      <view class="section-title">基础信息</view>
      <view class="info-row">店家：{{ session.store_name_snapshot }}</view>
      <view class="info-row">时间：{{ session.start_at }}</view>
      <view class="info-row">指定DM：{{ session.dm_name_snapshot || "未指定" }}</view>
      <view class="info-row">指定NPC：{{ session.npc_name_snapshot || "未指定" }}</view>
      <view class="info-row">状态：{{ statusLabel(session.status) }}</view>
      <view v-if="shareStats.view_count !== undefined" class="info-row subtle">
        浏览 {{ shareStats.view_count || 0 }} · 申请 {{ shareStats.signup_count || 0 }}
      </view>
    </view>

    <view v-if="session.seats && session.seats.length" class="section">
      <view class="section-title">角色与座位</view>
      <view
        v-for="seat in session.seats"
        :key="seat.id"
        class="seat-card"
        :class="{ focused: isFocusedSeat(seat), unavailable: !canApplySeat(seat) }"
      >
        <view class="seat-header">
          <view class="seat-title">{{ seat.name }}</view>
          <view class="seat-status">{{ seatStatusLabel(seat.status) }}</view>
        </view>
        <view class="info-row">角色：{{ seat.role_name || "未标注" }}</view>
        <view class="info-row">类型：{{ seatTypeLabel(seat.seat_type) }}</view>
        <view class="seat-actions">
          <button v-if="canApplySeat(seat)" class="mini-button" @click="goShare(seat)">
            选择此位
          </button>
          <view v-else class="item-sub">当前座位不可选择</view>
          <button class="mini-button ghost" open-type="share" :data-seat-id="seat.id">
            分享此位
          </button>
        </view>
      </view>
    </view>

    <view v-if="session.id" class="section">
      <view class="section-head">
        <view class="section-title">车友记录</view>
        <button
          v-if="myReviewState.can_review"
          class="review-edit"
          @click="goReview"
        >
          {{ myReviewState.review ? "编辑记录" : "写记录" }}
        </button>
      </view>
      <view v-if="reviewStatusText" class="notice">{{ reviewStatusText }}</view>
      <view v-if="reviews.length === 0 && !reviewStatusText" class="empty">还没有车友记录。</view>
      <view v-for="review in reviews" :key="review.id" class="review-card">
        <view class="review-head">
          <image
            class="review-avatar"
            :src="review.user_avatar_url ? assetUrl(review.user_avatar_url) : '/static/icons/user.png'"
            mode="aspectFill"
            :webp="true"
          />
          <view class="review-main">
            <view class="review-name">{{ reviewAuthorName(review) }}</view>
            <view class="review-meta">
              {{ review.seat_name || "座位" }} · {{ review.seat_role_name || "角色" }}
            </view>
          </view>
          <view class="review-stars">{{ starText(review.rating) }}</view>
        </view>
        <view v-if="review.content" class="review-content">{{ review.content }}</view>
        <view v-if="review.photos && review.photos.length" class="review-photos">
          <image
            v-for="photo in review.photos"
            :key="photo"
            class="review-photo"
            :src="assetUrl(photo)"
            mode="aspectFill"
          />
        </view>
      </view>
    </view>

    <ChatEntry
      v-for="extension in sessionDetailExtensions"
      :key="extension.id"
      ref="sessionDetailExtensionRefs"
      :session-id="sessionId"
      :session="session"
      :current-user-id="currentUserId"
      :focus-chat-on-load="focusChatOnLoad"
      :auth-tools="authTools"
    />
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import ChatEntry from "../../extensions/session-pseudo-chat/ChatEntry.vue";
import { sessionDetailExtensions } from "../../extensions/sessionExtensions.js";
import {
  assetUrl,
  dataOf,
  ensureLoggedIn,
  getCurrentUser,
  queryString,
  request
} from "../../utils/api";

export default {
  components: { AuthIdentityBar, ChatEntry },
  data() {
    return {
      sessionId: "",
      shareCode: "",
      source: "",
      focusedSeatId: "",
      session: {},
      shareStats: {},
      sessionDetailExtensions,
      loadStatusText: "",
      copyStatusText: "",
      currentUserId: "",
      focusChatOnLoad: false,
      sessionDetailExtensionRefs: [],
      reviews: [],
      myReviewState: { can_review: false, review: null },
      reviewStatusText: ""
    };
  },
  computed: {
    summaryText() {
      if (!this.session.id) {
        return "基础信息、角色状态和车内留言。";
      }
      if (this.isPostStart) {
        return "相册、照片标注和车友记录会沉淀在这里。";
      }
      return `${this.session.store_name_snapshot} / ${this.session.start_at}`;
    },
    focusedSeat() {
      return (this.session.seats || []).find(
        (seat) => Number(seat.id) === Number(this.focusedSeatId)
      );
    },
    authTools() {
      return { dataOf, ensureLoggedIn, request };
    },
    albumButtonText() {
      return this.isAlbumOpen() ? "车局相册" : "相册·发车后";
    },
    isPostStart() {
      return this.isAlbumOpen() && this.session.status !== "cancelled";
    },
    albumVisiblePhotoCount() {
      return Number(this.session.visible_photo_count || this.session.photo_count || 0);
    },
    reviewCount() {
      return Number(this.session.review_count || this.reviews.length || 0);
    },
    albumContentCount() {
      return this.albumVisiblePhotoCount + this.reviewCount;
    },
    albumPrimaryText() {
      return this.albumContentCount > 0 ? "回看相册" : "上传照片";
    },
    postStartAlbumText() {
      if (this.albumContentCount > 0) {
        const parts = [];
        if (this.albumVisiblePhotoCount > 0) {
          parts.push(`${this.albumVisiblePhotoCount} 张照片`);
        }
        if (this.reviewCount > 0) {
          parts.push(`${this.reviewCount} 条记录`);
        }
        return `已有 ${parts.join("、")}，一起回看这场车。`;
      }
      return "相册已开放，上传那天的第一张照片。";
    }
  },
  async onLoad(options) {
    this.sessionId = options.id || "";
    this.shareCode = options.shareCode || "";
    this.source = options.source || "";
    this.focusedSeatId = options.seatId || "";
    this.focusChatOnLoad = options.chat === "1";
    this.hydrateUser();
    this.relinkSessionMembership();
    this.loadSession();
    this.loadSessionReviews();
    this.loadMyReviewState();
    this.loadShareStats();
    this.trackShareView();
  },
  onShow() {
    this.hydrateUser();
    this.relinkSessionMembership();
    if (this.sessionId) {
      this.loadSessionReviews();
      this.loadMyReviewState();
    }
  },
  onHide() {
    this.stopDetailExtensions();
  },
  onUnload() {
    this.stopDetailExtensions();
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
      : "剧本迷·拼车";
    return {
      title,
      path: `/pages/session/detail${query}`
    };
  },
  methods: {
    assetUrl,
    hydrateUser() {
      const auth = getCurrentUser();
      this.currentUserId = auth.user?.id || "";
    },
    async relinkSessionMembership() {
      if (!this.currentUserId || !this.sessionId || this.sessionId === "d1-demo") {
        return;
      }
      try {
        await request({
          url: `/api/sessions/${this.sessionId}/relink`,
          method: "PATCH"
        });
      } catch (error) {
        // Non-members can still view public session detail; relink only restores existing ties.
      }
    },
    async ensureProtectedActionLogin() {
      const auth = await ensureLoggedIn({
        content: "登录后继续查看相册、选择角色或管理车局。"
      });
      if (!auth?.user) {
        this.loadStatusText = "登录后可继续操作。";
        return null;
      }
      this.currentUserId = auth.user.id || "";
      return auth;
    },
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
    async loadSessionReviews() {
      if (!this.sessionId || this.sessionId === "d1-demo") {
        return;
      }
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/reviews` });
        this.reviews = dataOf(response) || [];
        this.reviewStatusText = "";
      } catch (error) {
        this.reviewStatusText = "车友记录加载失败，请稍后重试。";
      }
    },
    async loadMyReviewState() {
      if (!this.currentUserId || !this.sessionId || this.sessionId === "d1-demo") {
        this.myReviewState = { can_review: false, review: null };
        return;
      }
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/review` });
        this.myReviewState = dataOf(response) || { can_review: false, review: null };
      } catch (error) {
        this.myReviewState = { can_review: false, review: null };
      }
    },
    stopDetailExtensions() {
      const refs = this.$refs.sessionDetailExtensionRefs || [];
      const extensionRefs = Array.isArray(refs) ? refs : [refs];
      extensionRefs.forEach((extensionRef) => {
        if (extensionRef?.stop) {
          extensionRef.stop();
        }
      });
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
    async goShare(seat) {
      const auth = await this.ensureProtectedActionLogin();
      if (!auth) {
        return;
      }
      const id = this.sessionId || "d1-demo";
      const selectedSeat = seat || this.focusedSeat;
      const query = queryString({
        id,
        seatId: selectedSeat?.id || "",
        shareCode: this.shareCode,
        source: this.source
      });
      uni.navigateTo({ url: `/pages/session/share${query}` });
    },
    async goManage() {
      const auth = await this.ensureProtectedActionLogin();
      if (!auth) {
        return;
      }
      const id = this.sessionId || "d1-demo";
      uni.navigateTo({ url: `/pages/session/manage?id=${id}` });
    },
    goReview() {
      const id = this.sessionId || "d1-demo";
      uni.navigateTo({ url: `/pages/session/review?id=${id}` });
    },
    async goAlbum() {
      const auth = await this.ensureProtectedActionLogin();
      if (!auth) {
        return;
      }
      if (!this.isAlbumOpen()) {
        uni.showToast({ title: "相册会在发车后开放", icon: "none" });
        return;
      }
      const id = this.sessionId || "d1-demo";
      uni.navigateTo({ url: `/pages/session/album?id=${id}` });
    },
    isAlbumOpen() {
      if (!this.session.start_at) {
        return false;
      }
      const startAt = Date.parse(String(this.session.start_at).replace(" ", "T"));
      return Number.isFinite(startAt) && startAt <= Date.now();
    },
    starText(rating) {
      const value = Math.max(0, Math.min(5, Number(rating || 0)));
      return "★★★★★".slice(0, value) + "☆☆☆☆☆".slice(0, 5 - value);
    },
    reviewAuthorName(review) {
      return review.user_nickname || review.user_open_id || "车友";
    },
    seatById(seatId) {
      return (this.session.seats || []).find((seat) => Number(seat.id) === Number(seatId));
    },
    isFocusedSeat(seat) {
      return this.focusedSeatId && Number(seat.id) === Number(this.focusedSeatId);
    },
    canApplySeat(seat) {
      if (this.session.status === "recruiting") {
        return ["open", "applied"].includes(seat.status);
      }
      return (
        this.session.status === "locked" &&
        this.isAlbumOpen() &&
        seat.status === "open"
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
        confirmed: "已上车",
        locked: "已锁定",
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
.session-detail-page {
  padding-bottom: 180rpx;
}

.section-title {
  margin-bottom: 18rpx;
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  margin-bottom: 18rpx;
}

.section-head .section-title {
  margin-bottom: 0;
}

.actions {
  flex-wrap: wrap;
}

.actions .button {
  flex: 1 1 42%;
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

.post-start-album-card {
  margin-top: 22rpx;
  padding: 22rpx;
  border: 1rpx solid #d7e6df;
  border-radius: 14rpx;
  background: #f1f8f5;
}

.post-start-title {
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1.3;
}

.post-start-text {
  margin-top: 10rpx;
  color: #5d7068;
  font-size: 25rpx;
  line-height: 1.55;
}

.post-start-album-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
  margin-top: 18rpx;
}

.post-start-stat {
  min-height: 92rpx;
  padding: 16rpx 18rpx;
  border: 1rpx solid rgba(36, 116, 95, 0.16);
  border-radius: 10rpx;
  background: rgba(255, 255, 255, 0.72);
  box-sizing: border-box;
}

.post-start-stat-value {
  color: #153f34;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1.1;
}

.post-start-stat-label {
  margin-top: 8rpx;
  color: #64766f;
  font-size: 22rpx;
  line-height: 1.25;
}

.info-row {
  margin-top: 10rpx;
  color: #475569;
  font-size: 26rpx;
  line-height: 1.5;
}

.info-row.subtle {
  color: #8a948d;
}

.seat-card {
  margin-top: 18rpx;
  padding: 22rpx;
  border: 1rpx solid #e6e0d2;
  border-radius: 8rpx;
  background: #fffefb;
}

.seat-card.focused {
  border-color: #1f6f5b;
  background: #eef5ef;
}

.seat-card.unavailable {
  background: #f7f4ee;
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

.seat-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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

.mini-button.ghost {
  background: #ffffff;
  color: #193d35;
  border: 1rpx solid #ded8ca;
}

.review-edit {
  width: 132rpx;
  height: 56rpx;
  margin: 0;
  border-radius: 8rpx;
  background: #1f7a68;
  color: #ffffff;
  font-size: 24rpx;
  line-height: 56rpx;
}

.review-card {
  padding: 22rpx 0;
  border-top: 1rpx solid #edf1f5;
}

.review-head {
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.review-avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: #eef2f7;
}

.review-main {
  flex: 1;
  min-width: 0;
}

.review-name {
  color: #1f2933;
  font-size: 26rpx;
  font-weight: 600;
}

.review-meta {
  margin-top: 4rpx;
  color: #64748b;
  font-size: 22rpx;
}

.review-stars {
  color: #d97706;
  font-size: 24rpx;
}

.review-content {
  margin-top: 16rpx;
  color: #334155;
  font-size: 25rpx;
  line-height: 1.55;
}

.review-photos {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10rpx;
  margin-top: 16rpx;
}

.review-photo {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8rpx;
  background: #f1f5f9;
}

.item-sub {
  display: flex;
  align-items: center;
  color: #94a3b8;
  font-size: 24rpx;
}

</style>
