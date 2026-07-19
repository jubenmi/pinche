<template>
  <view class="page review-share-page">
    <AuthIdentityBar passive-guest @guest-login="loginFromGuestBar" />
    <FeedbackHost />

    <view class="share-heading">
      <view class="share-kicker">游后感</view>
      <view class="title">{{ review?.script_name || "车局记录" }}</view>
      <view v-if="review" class="text session-meta">
        {{ sessionMetaText }}
      </view>
    </view>

    <view v-if="loading" class="section state-section">
      <view class="state-title">正在打开这条记录…</view>
    </view>

    <view v-else-if="errorText" class="section state-section">
      <view class="state-title">这条记录暂时无法查看</view>
      <view class="state-text">{{ errorText }}</view>
    </view>

    <template v-else-if="review">
      <view class="section review-card">
        <view class="author-row">
          <image
            class="author-avatar"
            :src="review.author?.avatar_url ? assetUrl(review.author.avatar_url) : '/static/icons/user.png'"
            mode="aspectFill"
            :webp="true"
          />
          <view class="author-copy">
            <view class="author-name">{{ review.author?.nickname || "车友" }}</view>
            <view class="author-role">这一晚，饰演「{{ review.role_name || "车友" }}」</view>
          </view>
        </view>

        <view class="rating-row" aria-label="评价星级">
          <text
            v-for="value in [1, 2, 3, 4, 5]"
            :key="value"
            class="rating-star"
            :class="{ active: review.rating >= value }"
          >★</text>
          <text class="rating-text">{{ review.rating }} 星</text>
        </view>

        <view v-if="review.content" class="review-content">{{ review.content }}</view>
        <view v-else class="review-content empty-content">这位玩家只留下了星级。</view>

        <view v-if="review.photos?.length" class="share-photo-grid">
          <t-image
            v-for="(photo, index) in review.photos"
            :key="`${index}-${photo}`"
            class="share-photo"
            :src="reviewPhotoUrl(photo)"
            mode="aspectFill"
            @tap="previewPhoto(index)"
          />
        </view>
      </view>

      <view class="share-note">每个人的记录，都是了解一场游戏的一个角度。</view>
    </template>

    <view v-if="review" class="bottom-action share-bottom-action">
      <view class="timeline-help">可分享给好友、群聊；朋友圈请使用右上角菜单</view>
      <t-button
        class="button share-button"
        open-type="share"
        custom-style="width: 100%; height: 90rpx; min-height: 90rpx; border-color: #07553f; background: #07553f; color: #ffffff;"
      >
        分享给好友或群
      </t-button>
    </view>
  </view>
</template>

<script>
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import { apiUrl, assetUrl, dataOf, ensureLoggedIn, request } from "../../utils/api";
import { showWechatShareMenus } from "../../utils/share";

const SHARE_FALLBACK_IMAGE = "/static/art/ticket-landscape.jpg";

export default {
  components: { AuthIdentityBar, FeedbackHost },
  data() {
    return {
      reviewId: "",
      review: null,
      loading: true,
      errorText: ""
    };
  },
  computed: {
    sessionMetaText() {
      if (!this.review) return "";
      return [this.review.store_name, this.playedOnText].filter(Boolean).join(" · ");
    },
    playedOnText() {
      const value = String(this.review?.played_on || "");
      return value ? value.replace(/-/g, ".") : "";
    }
  },
  async onLoad(options) {
    this.reviewId = options.id || "";
    showWechatShareMenus({
      withShareTicket: true,
      menus: ["shareAppMessage", "shareTimeline"]
    });
    await this.loadReview();
  },
  onShareAppMessage() {
    return {
      title: this.shareTitle(),
      path: `/pages/session/review-share?id=${this.reviewId}&source=wechat_share`,
      imageUrl: this.shareImage()
    };
  },
  onShareTimeline() {
    return {
      title: this.shareTitle(),
      query: `id=${this.reviewId}&source=wechat_timeline`,
      imageUrl: this.shareImage()
    };
  },
  methods: {
    assetUrl,
    async loginFromGuestBar() {
      await ensureLoggedIn({
        content: "登录后可以查看自己的车局，也可以继续浏览这条游后感。"
      });
    },
    async loadReview() {
      if (!this.reviewId) {
        this.loading = false;
        this.errorText = "分享信息不完整。";
        return;
      }
      try {
        const response = await request({
          url: `/api/session-reviews/${encodeURIComponent(this.reviewId)}`,
          suppressMaintenance: true
        });
        this.review = dataOf(response) || null;
        if (!this.review) this.errorText = "这条记录不存在或已停止公开。";
      } catch (error) {
        this.errorText = "这条记录不存在、仍在审核，或已停止公开。";
      } finally {
        this.loading = false;
      }
    },
    shareTitle() {
      if (!this.review) return "一条车局游后感";
      return `${this.review.author?.nickname || "车友"}的《${this.review.script_name || "剧本"}》游后感`;
    },
    shareImage() {
      const photo = this.review?.photos?.[0];
      return photo ? this.reviewPhotoUrl(photo) : SHARE_FALLBACK_IMAGE;
    },
    reviewPhotoUrl(photo) {
      return apiUrl(photo);
    },
    previewPhoto(index) {
      const urls = (this.review?.photos || []).map((photo) => this.reviewPhotoUrl(photo));
      if (!urls.length) return;
      uni.previewImage({
        current: urls[index] || urls[0],
        urls
      });
    }
  }
};
</script>

<style scoped>
.review-share-page {
  padding-bottom: 210rpx;
}

.share-heading {
  padding: 32rpx 18rpx 34rpx;
  text-align: center;
}

.share-kicker {
  margin-bottom: 10rpx;
  color: #b98420;
  font-size: 23rpx;
  letter-spacing: 8rpx;
}

.share-heading .title {
  margin-bottom: 12rpx;
  font-size: 48rpx;
}

.session-meta {
  font-size: 25rpx;
}

.state-section {
  padding: 70rpx 32rpx;
  text-align: center;
}

.state-title {
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
}

.state-text {
  margin-top: 14rpx;
  color: #77807b;
  font-size: 25rpx;
  line-height: 1.6;
}

.review-card {
  padding: 34rpx;
}

.author-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding-bottom: 26rpx;
  border-bottom: 1rpx solid #e6e0d5;
}

.author-avatar {
  flex: 0 0 84rpx;
  width: 84rpx;
  height: 84rpx;
  overflow: hidden;
  border-radius: 50%;
  background: #f0eee8;
}

.author-copy {
  min-width: 0;
}

.author-name {
  overflow: hidden;
  color: #12382f;
  font-size: 29rpx;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.author-role {
  margin-top: 7rpx;
  color: #777d79;
  font-size: 24rpx;
}

.rating-row {
  display: flex;
  align-items: center;
  gap: 4rpx;
  margin: 28rpx 0 24rpx;
}

.rating-star {
  color: #d5d0c7;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 38rpx;
  font-weight: 700;
  line-height: 1;
}

.rating-star.active {
  color: #e4a313;
}

.rating-text {
  margin-left: 12rpx;
  color: #777d79;
  font-size: 23rpx;
}

.review-content {
  color: #3d4843;
  font-size: 29rpx;
  line-height: 1.9;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-content {
  color: #8a8f8c;
}

.share-photo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10rpx;
  margin-top: 30rpx;
}

.share-photo {
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 10rpx;
  background: #f0eee8;
}

.share-note {
  padding: 20rpx 22rpx 6rpx;
  color: #838781;
  font-size: 23rpx;
  line-height: 1.6;
  text-align: center;
}

.share-bottom-action {
  right: 0;
  bottom: 0;
  left: 0;
  padding: 18rpx 30rpx calc(28rpx + env(safe-area-inset-bottom));
  background: rgba(251, 250, 246, 0.97);
  border-top: 1rpx solid rgba(222, 215, 202, 0.72);
}

.timeline-help {
  margin-bottom: 13rpx;
  color: #777d79;
  font-size: 22rpx;
  text-align: center;
}

.share-button {
  width: 100%;
  height: 90rpx;
  margin: 0;
  border: 0;
  font-size: 29rpx;
}
</style>
