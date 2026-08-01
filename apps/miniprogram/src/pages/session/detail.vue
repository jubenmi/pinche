<template>
  <view class="page session-detail-page">
    <AuthIdentityBar />
    <FeedbackHost />

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
      <t-notice-bar
        v-if="loadStatusText"
        class="notice"
        theme="warning"
        :visible="true"
        :content="loadStatusText"
      />
      <t-notice-bar
        v-if="copyStatusText"
        class="notice"
        theme="info"
        :visible="true"
        :content="copyStatusText"
      />
      <t-notice-bar
        v-if="rescheduleReminderStatusText"
        class="notice"
        theme="info"
        :visible="true"
        :content="rescheduleReminderStatusText"
      />
      <t-notice-bar
        v-if="isCityPreview"
        class="notice"
        theme="warning"
        :visible="true"
        content="同城发现仅供浏览。请先联系店家；收到店家或车友分享卡片后可选择角色上车。"
      />
      <view v-if="!isCityPreview" class="actions">
        <t-button v-if="albumPrimaryAction" class="button" @tap="goAlbum">{{ albumPrimaryText }}</t-button>
        <t-button v-else class="button" @tap="goShare">选择角色</t-button>
        <t-button
          v-if="isHistoricalOrganizer"
          class="button secondary"
          @tap="goShare"
        >
          邀请同车成员补认
        </t-button>
        <t-button
          v-if="persistedSessionLoaded && !isHistorical && guestNeedsLogin"
          class="button secondary"
          @tap="requestShareAction"
        >
          分享
        </t-button>
        <t-button
          v-else-if="persistedSessionLoaded && !isHistorical"
          class="button secondary"
          open-type="share"
        >
          分享
        </t-button>
        <t-button
          v-if="!isHistorical || isHistoricalOrganizer"
          class="button secondary"
          @tap="goManage"
        >
          车头管理
        </t-button>
        <t-button v-if="!albumPrimaryAction" class="button secondary" @tap="goAlbum">{{ albumButtonText }}</t-button>
        <t-button
          v-if="!isHistorical && canRequestRescheduleReminder"
          class="button secondary"
          @tap="requestRescheduleReminder"
        >
          改期提醒
        </t-button>
        <t-button
          v-if="isPostStart && myReviewState.can_review"
          class="button secondary"
          @tap="goReview"
        >
          {{ myReviewState.review ? "编辑记录" : "写记录" }}
        </t-button>
      </view>
    </view>

    <view v-if="session.id" class="section info-section">
      <view class="section-title">基础信息</view>
      <view class="info-row">店家：{{ session.store_name_snapshot }}</view>
      <view v-if="session.store_address || hasStoreLocation" class="info-row location-row">
        <view v-if="session.store_address" class="location-text">地址：{{ session.store_address }}</view>
        <view v-else class="location-text subtle">地址：未填写</view>
        <t-button v-if="hasStoreLocation" class="map-button" @tap="openStoreMap">
          查看地图
        </t-button>
      </view>
      <view class="info-row">时间：{{ sessionStartAtText }}</view>
      <view class="info-row">指定DM：{{ session.dm_name_snapshot || "未指定" }}</view>
      <view class="info-row">指定NPC：{{ session.npc_name_snapshot || "未指定" }}</view>
      <view class="info-row">状态：{{ statusLabel(session.status) }}</view>
      <view
        v-if="persistedSessionLoaded && !isHistorical && shareStats.view_count !== undefined"
        class="info-row subtle"
      >
        浏览 {{ shareStats.view_count || 0 }} · 申请 {{ shareStats.signup_count || 0 }}
      </view>
    </view>

    <RoleSeatBoard
      v-if="detailRoleSeatSections.length"
      :sections="detailRoleSeatSections"
      empty-text="暂无座位或NPC角色。"
      @itemtap="handleDetailSeatTap"
      @actiontap="handleDetailSeatAction"
    />

    <template v-if="!isCityPreview && (!isGuestPreview || currentUserId)">
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
    </template>

    <view v-if="session.id" class="section">
      <view class="section-head">
        <view class="section-title">车友记录</view>
        <t-button
          v-if="!isCityPreview && myReviewState.can_review"
          class="review-edit"
          @tap="goReview"
        >
          {{ myReviewState.review ? "编辑记录" : "写记录" }}
        </t-button>
      </view>
      <t-notice-bar
        v-if="reviewStatusText"
        class="notice"
        theme="warning"
        :visible="true"
        :content="reviewStatusText"
      />
      <t-empty
        v-if="reviews.length === 0 && !reviewStatusText"
        class="empty"
        description="还没有车友记录。"
      />
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
          <t-image
            v-for="photo in review.photos"
            :key="photo"
            class="review-photo"
            :src="apiUrl(photo)"
            mode="aspectFill"
          />
        </view>
      </view>
    </view>

    <template v-if="!isCityPreview && (!isGuestPreview || currentUserId)">
      <ChatEntry
        v-for="extension in sessionDetailExtensions"
        :key="detailExtensionKey(extension)"
        ref="sessionDetailExtensionRefs"
        :session-id="sessionId"
        :session="session"
        :current-user-id="currentUserId"
        :focus-chat-on-load="focusChatOnLoad"
        :auth-tools="authTools"
      />
    </template>
  </view>
</template>

<script>
import { formatBeijingDateTime, isHistoricalSession } from "@pinche/shared";
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import RoleSeatBoard from "../../components/RoleSeatBoard.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import ChatEntry from "../../extensions/session-pseudo-chat/ChatEntry.vue";
import { sessionDetailExtensions } from "../../extensions/sessionExtensions.js";
import {
  AUTH_CHANGE_EVENT,
  apiUrl,
  assetUrl,
  dataOf,
  ensureLoggedIn,
  getCurrentUser,
  getToken,
  queryString,
  request
} from "../../utils/api";
import { contentModerationErrorText } from "../../utils/contentModeration";
import { normalizeAuthorPrivateSession } from "../../utils/authorPrivateText";
import { showToast } from "../../utils/tdesignFeedback";
import { canRequestRescheduleReminder } from "../../utils/sessionMembership";
import { requestSessionRescheduledSubscription } from "../../utils/subscribeMessages";
import { authPrincipalOf } from "../../utils/sessionShareInvite";

function coordinateNumber(value, min, max) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export default {
  components: { AuthIdentityBar, RoleSeatBoard, ChatEntry, FeedbackHost },
  data() {
    return {
      sessionId: "",
      entry: "",
      accessScope: "",
      shareCode: "",
      source: "",
      focusedSeatId: "",
      session: {},
      persistedSessionLoaded: false,
      shareStats: {},
      sessionDetailExtensions,
      loadStatusText: "",
      copyStatusText: "",
      rescheduleReminderStatusText: "",
      currentUserId: "",
      currentAuthPrincipal: "guest",
      detailAuthGeneration: 0,
      detailLoginContinuationNonce: 0,
      detailShareViewTrackStarted: false,
      detailInitialShareStatsPending: true,
      pageActive: false,
      pageGeneration: 0,
      detailRequestGeneration: 0,
      focusChatOnLoad: false,
      sessionDetailExtensionRefs: [],
      reviews: [],
      myReviewState: { can_review: false, review: null },
      reviewStatusText: ""
    };
  },
  computed: {
    isHistorical() {
      return isHistoricalSession(this.session);
    },
    isHistoricalOrganizer() {
      return (
        this.isHistorical &&
        Boolean(this.currentUserId) &&
        Number(this.currentUserId) === Number(this.session.organizer_user_id)
      );
    },
    isCityPreview() {
      return this.entry === "city";
    },
    isGuestPreview() {
      return this.entry === "guest";
    },
    guestNeedsLogin() {
      return this.isGuestPreview && !this.currentUserId;
    },
    canRequestRescheduleReminder() {
      return (
        !this.isHistorical &&
        !this.isCityPreview &&
        canRequestRescheduleReminder(this.session, this.currentUserId)
      );
    },
    summaryText() {
      if (!this.session.id) {
        return "基础信息、角色状态和车内留言。";
      }
      if (this.isHistorical) {
        return "这是已经完成车局的历史资料记录，可在相册补上当时的照片和车友记录。";
      }
      if (this.isPostStart) {
        return "相册、照片标注和车友记录会沉淀在这里。";
      }
      return `${this.session.store_name_snapshot} / ${this.sessionStartAtText}`;
    },
    sessionStartAtText() {
      return formatBeijingDateTime(this.session.start_at);
    },
    focusedSeat() {
      return (this.session.seats || []).find(
        (seat) => Number(seat.id) === Number(this.focusedSeatId)
      );
    },
    authTools() {
      return { dataOf, ensureLoggedIn, request, contentModerationErrorText };
    },
    albumButtonText() {
      return this.isAlbumOpen() ? "车局相册" : "相册·发车后";
    },
    albumPrimaryAction() {
      return this.isHistorical || this.isPostStart;
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
    },
    seatBoardSummary() {
      const seats = this.session.seats || [];
      if (this.isHistorical) {
        const claimed = seats.filter((seat) => Boolean(seat.confirmed_user_id)).length;
        return `${seats.length - claimed} 个待补认，${claimed} 个已补认`;
      }
      const open = seats.filter((seat) => this.canApplySeat(seat)).length;
      const applied = seats.filter((seat) => seat.status === "applied").length;
      const onboard = seats.filter((seat) => ["confirmed", "locked"].includes(seat.status)).length;
      return `${open} 个可选，${applied} 个待审，${onboard} 个已上车`;
    },
    storeMapLatitude() {
      return coordinateNumber(this.session.store_latitude, -90, 90);
    },
    storeMapLongitude() {
      return coordinateNumber(this.session.store_longitude, -180, 180);
    },
    hasStoreLocation() {
      return this.storeMapLatitude !== null && this.storeMapLongitude !== null;
    },
    detailSeatCards() {
      return (this.session.seats || []).map((seat) => {
        const canApply = this.canApplySeat(seat);
        const actions = [];
        if (this.persistedSessionLoaded && !this.isCityPreview && !this.isHistorical) {
          if (canApply) {
            actions.push({ key: "select", label: "选择此位" });
          }
          actions.push({
            key: "share",
            label: "分享此位",
            variant: "ghost",
            openType: this.guestNeedsLogin ? "" : "share",
            seatId: seat.id
          });
        }
        return {
          id: seat.id,
          seatId: seat.id,
          raw: seat,
          name: seat.name,
          note: seat.role_name || this.seatTypeLabel(seat.seat_type),
          roleGender: seat.role_gender || "unlimited",
          avatarUrl: seat.confirmed_user_avatar_url || "",
          avatarGender: seat.confirmed_user_gender || seat.role_gender || "unlimited",
          confirmedUserId: seat.confirmed_user_id || "",
          stateKind: canApply ? "available" : this.seatStateKind(seat),
          stateLabel: canApply
            ? this.isCityPreview ? "需联系店家" : "可选"
            : this.seatStatusLabel(seat.status, seat),
          focused: this.isFocusedSeat(seat),
          actions
        };
      });
    },
    npcSelfJoinEnabled() {
      return this.session.npc_join_enabled === undefined
        ? true
        : Boolean(this.session.npc_join_enabled);
    },
    detailNpcRoleSummary() {
      const roles = this.session.session_npc_roles || [];
      if (this.isHistorical) {
        const claimed = roles.filter((role) => Boolean(role.bound_user_id)).length;
        return `${roles.length - claimed} 个待补认，${claimed} 个已补认`;
      }
      const available = roles.filter((role) => this.canApplyNpcRole(role)).length;
      const pending = roles.filter(
        (role) => role.pending_signup_id || role.has_pending_signup
      ).length;
      const assigned = roles.filter((role) => role.bound_user_id || role.is_bound).length;
      return `${available} 个可选，${pending} 个待审，${assigned} 个已安排`;
    },
    detailNpcRoleCards() {
      return (this.session.session_npc_roles || []).map((role) => {
        const canApply = this.canApplyNpcRole(role);
        const stateKind = canApply ? "available" : this.npcRoleStateKind(role);
        const actions = !this.isCityPreview && canApply
          ? [{ key: "selectNpc", label: "选择NPC" }]
          : [];
        return {
          id: `npc-${role.id}`,
          npcRoleId: role.id,
          raw: role,
          boardType: "npc",
          name: role.name || "NPC角色",
          note: role.bound_user_name || role.description || "NPC工作人员",
          roleGender: role.role_gender || "unlimited",
          avatarUrl: role.bound_user_avatar_url || "",
          avatarGender: role.bound_user_gender || role.role_gender || "unlimited",
          boundUserId: role.bound_user_id || "",
          showGenderSymbol: true,
          stateKind,
          stateLabel: canApply
            ? this.isCityPreview ? "需联系店家" : "可选"
            : this.npcRoleStatusLabel(role),
          actions
        };
      });
    },
    detailRoleSeatSections() {
      const sections = [];
      if (this.session.seats?.length) {
        sections.push({
          key: "seat",
          title: "角色与座位",
          summary: this.seatBoardSummary,
          items: this.detailSeatCards
        });
      }
      if (this.detailNpcRoleCards.length) {
        sections.push({
          key: "npc",
          title: "NPC角色",
          summary: this.detailNpcRoleSummary,
          statusPill: this.isHistorical
            ? "待补认 / 已补认"
            : this.npcSelfJoinEnabled ? "可自选" : "车头安排",
          items: this.detailNpcRoleCards
        });
      }
      return sections;
    }
  },
  async onLoad(options) {
    this.sessionId = options.id || "";
    this.entry = options.entry || "";
    this.shareCode = options.shareCode || "";
    this.source = options.source || "";
    this.focusedSeatId = options.seatId || "";
    this.focusChatOnLoad = options.chat === "1";
    const currentAuth = getCurrentUser();
    this.currentAuthPrincipal = authPrincipalOf(currentAuth, getToken());
    this.currentUserId = this.currentAuthPrincipal === "guest" ? "" : currentAuth.user?.id || "";
    this.observeDetailAuthChanges();
    const requestOwner = this.activateDetailPage();
    this.hideSessionShareMenu();
    await this.reloadDetailProjection(requestOwner, {
      includeInitialShareContext: true
    });
  },
  async onShow() {
    const identityChanged = this.applyDetailAuthSnapshot(getCurrentUser());
    const requestOwner = this.activateDetailPage();
    if (this.sessionId) {
      await this.reloadDetailProjection(requestOwner, {
        loadShareStats: identityChanged,
        includeInitialShareContext: true
      });
    }
  },
  onHide() {
    this.invalidateDetailPage();
    this.hideSessionShareMenu();
    this.stopDetailExtensions();
  },
  onUnload() {
    this.invalidateDetailPage();
    this.hideSessionShareMenu();
    this.stopDetailExtensions();
    this.unobserveDetailAuthChanges();
  },
  onShareAppMessage(options) {
    if (!this.persistedSessionLoaded || this.isHistorical) {
      return undefined;
    }
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
    apiUrl,
    assetUrl,
    detailExtensionKey(extension = {}) {
      return `${extension.id || "extension"}:${this.currentAuthPrincipal}:${this.detailAuthGeneration}`;
    },
    activateDetailPage() {
      this.pageActive = true;
      this.pageGeneration += 1;
      return this.beginDetailRequest();
    },
    invalidateDetailPage() {
      this.pageActive = false;
      this.pageGeneration += 1;
      this.detailRequestGeneration += 1;
      this.detailLoginContinuationNonce += 1;
    },
    beginDetailRequest() {
      this.detailRequestGeneration += 1;
      return {
        pageGeneration: this.pageGeneration,
        requestGeneration: this.detailRequestGeneration,
        sessionId: String(this.sessionId || ""),
        authGeneration: this.detailAuthGeneration,
        principal: this.currentAuthPrincipal
      };
    },
    currentDetailPageOwner() {
      return {
        pageGeneration: this.pageGeneration,
        sessionId: String(this.sessionId || ""),
        authGeneration: this.detailAuthGeneration,
        principal: this.currentAuthPrincipal
      };
    },
    isCurrentDetailPage(owner) {
      return Boolean(
        this.pageActive &&
          owner &&
          owner.pageGeneration === this.pageGeneration &&
          owner.sessionId === String(this.sessionId || "") &&
          owner.authGeneration === this.detailAuthGeneration &&
          owner.principal === this.currentAuthPrincipal
      );
    },
    isCurrentDetailRequest(requestOwner) {
      return Boolean(
        this.isCurrentDetailPage(requestOwner) &&
          requestOwner.requestGeneration === this.detailRequestGeneration
      );
    },
    observeDetailAuthChanges() {
      if (typeof uni !== "undefined" && typeof uni.$on === "function") {
        uni.$on(AUTH_CHANGE_EVENT, this.handleDetailAuthChange);
      }
    },
    unobserveDetailAuthChanges() {
      if (typeof uni !== "undefined" && typeof uni.$off === "function") {
        uni.$off(AUTH_CHANGE_EVENT, this.handleDetailAuthChange);
      }
    },
    applyDetailAuthSnapshot(auth = null) {
      const currentAuth = auth && Object.prototype.hasOwnProperty.call(auth, "user")
        ? auth
        : getCurrentUser();
      const nextPrincipal = authPrincipalOf(currentAuth, getToken());
      const nextUserId = nextPrincipal === "guest" ? "" : currentAuth.user?.id || "";
      if (nextPrincipal === this.currentAuthPrincipal) {
        this.currentUserId = nextUserId;
        return false;
      }
      this.currentAuthPrincipal = nextPrincipal;
      this.currentUserId = nextUserId;
      this.detailAuthGeneration += 1;
      this.detailRequestGeneration += 1;
      this.clearProtectedDetail("");
      return true;
    },
    async handleDetailAuthChange(auth = null) {
      const identityChanged = this.applyDetailAuthSnapshot(auth);
      if (!identityChanged || !this.pageActive || !this.sessionId) {
        return false;
      }
      const requestOwner = this.beginDetailRequest();
      return this.reloadDetailProjection(requestOwner, {
        loadShareStats: true,
        includeInitialShareContext: true
      });
    },
    beginDetailLoginContinuation() {
      this.detailLoginContinuationNonce += 1;
      return {
        nonce: this.detailLoginContinuationNonce,
        pageGeneration: this.pageGeneration,
        sessionId: String(this.sessionId || ""),
        authGeneration: this.detailAuthGeneration,
        originPrincipal: this.currentAuthPrincipal
      };
    },
    isCurrentDetailLoginContinuation(continuation) {
      return Boolean(
        this.pageActive &&
          continuation &&
          continuation.nonce === this.detailLoginContinuationNonce &&
          continuation.pageGeneration === this.pageGeneration &&
          continuation.sessionId === String(this.sessionId || "")
      );
    },
    async relinkSessionMembership(requestOwner = null) {
      if (requestOwner && !this.isCurrentDetailRequest(requestOwner)) {
        return false;
      }
      if (this.isCityPreview || this.isGuestPreview) {
        return true;
      }
      if (!this.currentUserId || !this.sessionId || this.sessionId === "d1-demo") {
        return true;
      }
      try {
        await request({
          url: `/api/sessions/${this.sessionId}/relink`,
          method: "PATCH"
        });
      } catch (error) {
        // Non-members can still view public session detail; relink only restores existing ties.
      }
      return !requestOwner || this.isCurrentDetailRequest(requestOwner);
    },
    async reloadDetailProjection(requestOwner, options = {}) {
      if (!this.isCurrentDetailRequest(requestOwner)) {
        return false;
      }
      await this.relinkSessionMembership(requestOwner);
      if (!this.isCurrentDetailRequest(requestOwner)) {
        return false;
      }
      const loaded = await this.loadSession(requestOwner);
      if (!loaded || !this.isCurrentDetailRequest(requestOwner)) {
        return false;
      }
      await Promise.all([
        this.loadSessionReviews(requestOwner),
        this.loadMyReviewState(requestOwner)
      ]);
      if (!this.isCurrentDetailRequest(requestOwner)) {
        return false;
      }
      const shouldLoadInitialShareContext = Boolean(
        options.includeInitialShareContext && this.detailInitialShareStatsPending
      );
      if (shouldLoadInitialShareContext) {
        await this.trackShareView(requestOwner);
        if (!this.isCurrentDetailRequest(requestOwner)) {
          return false;
        }
        const shareStatsLoaded = await this.loadShareStats(requestOwner);
        if (!this.isCurrentDetailRequest(requestOwner)) {
          return false;
        }
        if (shareStatsLoaded) {
          this.detailInitialShareStatsPending = false;
        }
      } else if (options.loadShareStats) {
        await this.loadShareStats(requestOwner);
      }
      return this.isCurrentDetailRequest(requestOwner);
    },
    async ensureProtectedActionLogin(content = "登录后继续查看相册、选择角色或管理车局。") {
      if (!this.pageActive) {
        return null;
      }
      const continuation = this.beginDetailLoginContinuation();
      const auth = await ensureLoggedIn({
        content
      });
      if (!this.isCurrentDetailLoginContinuation(continuation)) {
        return null;
      }
      const latestAuth = getCurrentUser();
      const latestAuthenticated = getToken();
      const returnedPrincipal = authPrincipalOf(auth);
      const actualPrincipal = authPrincipalOf(latestAuth, latestAuthenticated);
      if (
        returnedPrincipal === "guest" ||
        !auth?.user ||
        returnedPrincipal !== actualPrincipal
      ) {
        if (
          this.detailAuthGeneration === continuation.authGeneration &&
          this.currentAuthPrincipal === continuation.originPrincipal &&
          actualPrincipal === continuation.originPrincipal
        ) {
          this.loadStatusText = "登录后可继续操作。";
        }
        return null;
      }
      if (actualPrincipal !== this.currentAuthPrincipal) {
        this.applyDetailAuthSnapshot(latestAuth);
      }
      if (!this.isCurrentDetailLoginContinuation(continuation)) {
        return null;
      }
      const generationUnchanged =
        this.detailAuthGeneration === continuation.authGeneration;
      const freshGuestLogin = Boolean(
        continuation.originPrincipal === "guest" &&
          this.detailAuthGeneration === continuation.authGeneration + 1 &&
          this.currentAuthPrincipal === actualPrincipal
      );
      if (
        (!generationUnchanged && !freshGuestLogin) ||
        this.currentAuthPrincipal !== actualPrincipal
      ) {
        return null;
      }
      const requestOwner = this.beginDetailRequest();
      const loaded = await this.reloadDetailProjection(requestOwner, {
        loadShareStats: true,
        includeInitialShareContext: true
      });
      if (!loaded) {
        return null;
      }
      const finalAuth = getCurrentUser();
      const finalPrincipal = authPrincipalOf(finalAuth, getToken());
      if (
        !this.isCurrentDetailLoginContinuation(continuation) ||
        !this.isCurrentDetailRequest(requestOwner) ||
        finalPrincipal !== returnedPrincipal ||
        finalPrincipal !== this.currentAuthPrincipal
      ) {
        return null;
      }
      this.syncSessionShareMenu(requestOwner);
      return auth;
    },
    clearProtectedDetail(message, requestOwner = null) {
      if (requestOwner && !this.isCurrentDetailRequest(requestOwner)) {
        return false;
      }
      this.stopDetailExtensions();
      this.session = {};
      this.persistedSessionLoaded = false;
      this.accessScope = "";
      this.shareStats = {};
      this.reviews = [];
      this.myReviewState = { can_review: false, review: null };
      this.reviewStatusText = "";
      this.loadStatusText = message;
      this.hideSessionShareMenu();
      return true;
    },
    async loadSession(requestOwner = null) {
      requestOwner = requestOwner || this.beginDetailRequest();
      if (!this.isCurrentDetailRequest(requestOwner)) {
        return false;
      }
      if (!this.sessionId || this.sessionId === "d1-demo") {
        this.loadStatusText = "请从已发布车进入详情。";
        return false;
      }
      this.persistedSessionLoaded = false;
      this.hideSessionShareMenu();
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}` });
        if (!this.isCurrentDetailRequest(requestOwner)) {
          return false;
        }
        this.session = normalizeAuthorPrivateSession(dataOf(response) || {});
        this.persistedSessionLoaded = Boolean(this.session.id);
        this.accessScope = this.session.access_scope || "";
        this.loadStatusText = "";
        if (this.focusedSeatId && this.focusedSeat) {
          this.loadStatusText = "已定位到分享指定座位。";
        }
        this.syncSessionShareMenu(requestOwner);
        return true;
      } catch (error) {
        if (!this.isCurrentDetailRequest(requestOwner)) {
          return false;
        }
        if (error?.statusCode === 404) {
          this.clearProtectedDetail("车局已发车，仅同车成员可查看。", requestOwner);
          return false;
        }
        this.clearProtectedDetail("车详情加载失败，请稍后重试。", requestOwner);
        return false;
      }
    },
    syncSessionShareMenu(requestOwner = null) {
      if (
        !this.pageActive ||
        (requestOwner && !this.isCurrentDetailRequest(requestOwner))
      ) {
        return;
      }
      if (typeof uni === "undefined") {
        return;
      }
      const menus = ["shareAppMessage", "shareTimeline"];
      if (
        !this.persistedSessionLoaded ||
        this.isCityPreview ||
        this.guestNeedsLogin ||
        this.isHistorical
      ) {
        if (typeof uni.hideShareMenu === "function") {
          uni.hideShareMenu({ menus });
        }
        return;
      }
      if (typeof uni.showShareMenu === "function") {
        uni.showShareMenu({ withShareTicket: true, menus });
      }
    },
    hideSessionShareMenu() {
      if (typeof uni !== "undefined" && typeof uni.hideShareMenu === "function") {
        uni.hideShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
      }
    },
    async loadShareStats(requestOwner) {
      if (this.isHistorical) {
        if (!this.isCurrentDetailRequest(requestOwner)) {
          return false;
        }
        this.shareStats = {};
        return true;
      }
      if (!this.isCurrentDetailRequest(requestOwner)) {
        return false;
      }
      if (!this.sessionId || this.sessionId === "d1-demo") {
        this.shareStats = {};
        return true;
      }
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/share-stats` });
        if (!this.isCurrentDetailRequest(requestOwner)) {
          return false;
        }
        this.shareStats = dataOf(response) || {};
        return true;
      } catch (error) {
        if (!this.isCurrentDetailRequest(requestOwner)) {
          return false;
        }
        this.shareStats = {};
        return false;
      }
    },
    async loadSessionReviews(requestOwner) {
      if (!this.isCurrentDetailRequest(requestOwner)) {
        return false;
      }
      if (!this.sessionId || this.sessionId === "d1-demo") {
        return false;
      }
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/reviews` });
        if (!this.isCurrentDetailRequest(requestOwner)) {
          return false;
        }
        this.reviews = dataOf(response) || [];
        this.reviewStatusText = "";
        return true;
      } catch (error) {
        if (!this.isCurrentDetailRequest(requestOwner)) {
          return false;
        }
        this.reviews = [];
        this.reviewStatusText = "车友记录加载失败，请稍后重试。";
        return false;
      }
    },
    async loadMyReviewState(requestOwner) {
      if (!this.isCurrentDetailRequest(requestOwner)) {
        return false;
      }
      if (!this.currentUserId || !this.sessionId || this.sessionId === "d1-demo") {
        this.myReviewState = { can_review: false, review: null };
        return true;
      }
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/review` });
        if (!this.isCurrentDetailRequest(requestOwner)) {
          return false;
        }
        this.myReviewState = dataOf(response) || { can_review: false, review: null };
        return true;
      } catch (error) {
        if (!this.isCurrentDetailRequest(requestOwner)) {
          return false;
        }
        this.myReviewState = { can_review: false, review: null };
        return false;
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
    async trackShareView(requestOwner) {
      if (this.isHistorical) {
        return false;
      }
      if (!this.isCurrentDetailRequest(requestOwner)) {
        return false;
      }
      if (!this.sessionId || this.sessionId === "d1-demo") {
        return false;
      }
      if (!this.shareCode && !this.source) {
        return false;
      }
      if (this.detailShareViewTrackStarted) {
        return false;
      }
      // Claim the one-time page view before yielding so a superseding request owner
      // can refresh stats without emitting the same analytics event again.
      this.detailShareViewTrackStarted = true;
      try {
        await request({
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
        });
        if (!this.isCurrentDetailRequest(requestOwner)) {
          return false;
        }
        return true;
      } catch (error) {
        return false;
      }
    },
    async goShare(seat) {
      if (this.isCityPreview) {
        return;
      }
      if (this.isHistorical && !this.isHistoricalOrganizer) {
        return;
      }
      const auth = await this.ensureProtectedActionLogin(
        this.isHistorical ? "登录后可邀请同车成员补认角色。" : "登录后可选择角色上车。"
      );
      if (!auth) {
        return;
      }
      if (this.isHistorical && !this.isHistoricalOrganizer) {
        return;
      }
      const id = this.sessionId || "d1-demo";
      if (this.isHistorical) {
        uni.navigateTo({ url: `/pages/session/share?id=${id}` });
        return;
      }
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
      if (this.isCityPreview) {
        return;
      }
      if (this.isHistorical && !this.isHistoricalOrganizer) {
        return;
      }
      const auth = await this.ensureProtectedActionLogin("登录后可管理车局。");
      if (!auth) {
        return;
      }
      if (this.isHistorical && !this.isHistoricalOrganizer) {
        return;
      }
      const id = this.sessionId || "d1-demo";
      uni.navigateTo({ url: `/pages/session/manage?id=${id}` });
    },
    async goReview() {
      if (this.isCityPreview) {
        return;
      }
      const auth = await this.ensureProtectedActionLogin("登录后可写车友记录。");
      if (!auth) {
        return;
      }
      const id = this.sessionId || "d1-demo";
      uni.navigateTo({ url: `/pages/session/review?id=${id}` });
    },
    async requestShareAction() {
      if (!this.persistedSessionLoaded || this.isHistorical) {
        return;
      }
      const auth = await this.ensureProtectedActionLogin("登录后可分享车局。");
      if (auth) {
        showToast({ title: "已登录，请再次点击分享", icon: "none" });
      }
    },
    async requestRescheduleReminder() {
      if (!this.canRequestRescheduleReminder) {
        return;
      }
      const result = await requestSessionRescheduledSubscription().catch(() => ({
        status: "unavailable"
      }));
      const acceptedStatuses = ["accept", "acceptWithAudio", "acceptWithAlert"];
      if (acceptedStatuses.includes(result?.status)) {
        this.rescheduleReminderStatusText = "已开启改期提醒。";
        return;
      }
      if (["reject", "ban"].includes(result?.status)) {
        this.rescheduleReminderStatusText = "暂未开启提醒，你可以稍后再试。";
        return;
      }
      this.rescheduleReminderStatusText = "当前暂无法开启提醒，请稍后再试。";
    },
    openStoreMap() {
      if (!this.hasStoreLocation || typeof uni.openLocation !== "function") {
        showToast({ title: "地图打开失败，请稍后再试", icon: "none" });
        return;
      }
      uni.openLocation({
        latitude: this.storeMapLatitude,
        longitude: this.storeMapLongitude,
        name: this.session.store_name_snapshot || "店家",
        address: this.session.store_address || "",
        scale: 18,
        fail: () => showToast({ title: "地图打开失败，请稍后再试", icon: "none" })
      });
    },
    async goAlbum() {
      if (this.isCityPreview) {
        return;
      }
      const auth = await this.ensureProtectedActionLogin("登录后可查看车局相册。");
      if (!auth) {
        return;
      }
      if (!this.isAlbumOpen()) {
        showToast({ title: "相册会在发车后开放", icon: "none" });
        return;
      }
      const id = this.sessionId || "d1-demo";
      uni.navigateTo({ url: `/pages/session/album?id=${id}` });
    },
    isAlbumOpen() {
      if (typeof this.session.has_started === "boolean") {
        return this.session.has_started;
      }
      if (!this.session.start_at) {
        return false;
      }
      return isBusinessDateTimeReached(this.session.start_at);
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
      if (this.isHistorical) {
        return false;
      }
      if (this.session.status === "recruiting") {
        return ["open", "applied"].includes(seat.status);
      }
      return (
        this.session.status === "locked" &&
        this.isAlbumOpen() &&
        seat.status === "open"
      );
    },
    canApplyNpcRole(role) {
      if (this.isHistorical) {
        return false;
      }
      if (role.author_private?.content?.is_draft === true) {
        return false;
      }
      if (!this.npcSelfJoinEnabled) {
        return false;
      }
      if (role.status && role.status !== "active") {
        return false;
      }
      if (
        role.bound_user_id ||
        role.pending_signup_id ||
        role.is_bound ||
        role.has_pending_signup
      ) {
        return false;
      }
      return this.session.status === "recruiting";
    },
    handleDetailSeatTap(payload) {
      if (this.isCityPreview) {
        return;
      }
      if (payload.item?.boardType === "npc" || payload.sectionKey === "npc") {
        if (this.canApplyNpcRole(payload.item.raw)) {
          this.goShare();
        }
        return;
      }
      const seat = payload.item.raw;
      if (seat && this.canApplySeat(seat)) {
        this.goShare(seat);
      }
    },
    handleDetailSeatAction(payload) {
      if (this.isCityPreview) {
        return;
      }
      if (payload.item?.boardType === "npc" || payload.sectionKey === "npc") {
        if (payload.action.key === "selectNpc") {
          this.goShare();
        }
        return;
      }
      if (payload.action.key === "share" && this.guestNeedsLogin) {
        this.requestShareAction();
        return;
      }
      const seat = payload.item.raw;
      if (!seat || payload.action.key !== "select") {
        return;
      }
      this.goShare(seat);
    },
    seatStateKind(seat) {
      if (this.isHistorical) {
        return seat.confirmed_user_id ? "taken" : "available";
      }
      if (seat.status === "applied") {
        return "pendingReview";
      }
      if (["confirmed", "locked"].includes(seat.status)) {
        return "taken";
      }
      return "unavailable";
    },
    npcRoleStateKind(role) {
      if (this.isHistorical) {
        if (this.currentUserId && Number(role.bound_user_id || 0) === Number(this.currentUserId)) {
          return "mine";
        }
        return role.bound_user_id ? "taken" : "available";
      }
      if (role.author_private?.content?.is_draft === true) {
        return "pendingReview";
      }
      if (this.currentUserId && Number(role.bound_user_id || 0) === Number(this.currentUserId)) {
        return "mine";
      }
      if (role.bound_user_id || role.is_bound) {
        return "taken";
      }
      if (role.pending_signup_id || role.has_pending_signup) {
        return "pendingReview";
      }
      if (role.status && role.status !== "active") {
        return "unavailable";
      }
      return this.npcSelfJoinEnabled ? "available" : "unavailable";
    },
    npcRoleStatusLabel(role) {
      if (this.isHistorical) {
        return role.bound_user_id ? "已补认" : "待补认";
      }
      if (role.author_private?.content?.is_draft === true) {
        return role.moderation_message || "仅自己可见 · 审核中";
      }
      const stateKind = this.npcRoleStateKind(role);
      if (stateKind === "mine") {
        return "";
      }
      if (stateKind === "taken") {
        return "已安排";
      }
      if (stateKind === "pendingReview") {
        return "待审核";
      }
      if (stateKind === "unavailable") {
        return this.npcSelfJoinEnabled ? "不可用" : "车头安排";
      }
      return "可选";
    },
    statusLabel(status) {
      if (isHistoricalSession(this.session)) {
        return status === "cancelled" ? "已取消补录" : "历史补录";
      }
      const labels = {
        draft: "草稿",
        recruiting: "招募中",
        locked: "已锁车",
        cancelled: "已取消"
      };
      return labels[status] || status || "未知";
    },
    seatStatusLabel(status, seat = {}) {
      if (this.isHistorical) {
        return seat.confirmed_user_id || ["confirmed", "locked"].includes(status)
          ? "已补认"
          : "待补认";
      }
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
        cp: "CP位",
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

.location-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.location-text {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}

.map-button {
  flex: 0 0 148rpx;
  width: 148rpx;
  min-width: 148rpx;
  height: 56rpx;
  margin: 0;
  border-radius: 8rpx;
  color: #1f7a68;
  font-size: 24rpx;
  line-height: 56rpx;
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

</style>
