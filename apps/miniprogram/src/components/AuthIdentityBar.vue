<template>
  <view class="auth-identity">
    <view
      class="auth-identity-bar"
      :class="{ empty: !user, passive: !user && passiveGuest }"
      @tap="handleIdentityTap"
    >
      <button
        class="auth-profile-trigger"
        plain
        hover-class="auth-profile-trigger-hover"
        @tap.stop="handleIdentityTap"
      >
        <view v-if="user" class="auth-avatar" :class="barAvatarClass">
          <image
            class="auth-avatar-image"
            :src="barAvatar.src"
            mode="aspectFill"
            :webp="true"
            @error="handleAvatarLoadError(barAvatar.src)"
          />
        </view>
        <view class="auth-main">
          <text class="auth-state">{{ authStateText }}</text>
          <view class="auth-name">
            <t-image v-if="barGenderIcon" class="auth-gender-icon" :src="barGenderIcon" mode="aspectFit" />
            <text class="auth-name-text">{{ displayName }}</text>
          </view>
        </view>
        <view v-if="rolesText" class="auth-roles">{{ rolesText }}</view>
      </button>
      <view v-if="messageChipVisible" class="auth-side">
        <t-button
          class="auth-message-chip"
          hover-class="auth-message-chip-hover"
          @tap.stop="toggleMessagePanel"
        >
          <view class="auth-message-chip-content">
            <text>消息</text>
            <t-badge
              class="auth-message-count"
              :count="messageBadgeCount"
              :max-count="99"
            />
          </view>
        </t-button>
      </view>
    </view>

    <view v-if="messagePanelVisible" class="message-panel" @tap.stop>
      <view class="message-panel-head">
        <view>
          <view class="message-panel-title">消息</view>
          <view class="message-panel-subtitle">{{ messagePanelSummary }}</view>
        </view>
        <view class="message-panel-actions">
          <t-button
            class="message-panel-tool"
            :class="{ disabled: messagesLoading }"
            :disabled="messagesLoading"
            @tap.stop="refreshOrganizerMessages"
          >
            刷新
          </t-button>
          <t-button class="message-panel-tool" @tap.stop="closeMessagePanel">收起</t-button>
        </view>
      </view>

      <view v-if="messagesLoading" class="message-empty">正在同步消息...</view>
      <view
        v-else-if="messageLoadError && authMessages.length === 0"
        class="message-empty error"
      >{{ messageLoadError }}</view>
      <t-empty
        v-else-if="authMessages.length === 0"
        class="message-empty"
        description="暂无消息。"
      />
      <block v-else>
        <t-button
          v-for="message in authMessages"
          :key="message.key"
          class="message-item"
          hover-class="message-item-hover"
          @tap.stop="handleMessageTap(message)"
        >
          <view class="message-item-content">
            <view class="message-copy">
              <view class="message-title-row">
                <text class="message-title">{{ message.title }}</text>
                <t-tag
                  v-if="message.kind === 'pending_signup'"
                  class="message-count"
                  theme="warning"
                  variant="light"
                  size="small"
                >
                  {{ message.count }}待审
                </t-tag>
                <t-tag
                  v-else
                  class="message-count"
                  :theme="message.tagTheme"
                  variant="light"
                  size="small"
                >
                  {{ message.typeTag }}
                </t-tag>
                <text
                  v-if="message.kind === 'persistent' && message.unread"
                  class="message-unread"
                >未读</text>
              </view>
              <text class="message-subtitle">{{ message.subtitle }}</text>
            </view>
            <text class="message-action">{{ message.actionText }}</text>
          </view>
        </t-button>
        <view v-if="notificationsHasMore || notificationsLoadMoreError" class="message-load-more">
          <t-button
            class="message-panel-tool"
            :class="{ disabled: notificationsLoadingMore }"
            :disabled="notificationsLoadingMore"
            @tap.stop="loadMoreNotifications"
          >
            {{ notificationsLoadingMore ? "加载中..." : "加载更多" }}
          </t-button>
          <text v-if="notificationsLoadMoreError" class="message-load-more-error">
            {{ notificationsLoadMoreError }}
          </text>
        </view>
      </block>
    </view>

    <view v-if="profileVisible" class="profile-mask" @tap="handleProfileBackdropTap">
      <view class="profile-modal" @tap.stop>
        <view class="profile-head">
          <view>
            <view class="profile-title-row">
              <view class="profile-title">{{ profileTitle }}</view>
              <text v-if="profileOpenidText" class="profile-openid">{{ profileOpenidText }}</text>
            </view>
            <view class="profile-subtitle">{{ profileSubtitle }}</view>
          </view>
          <t-button v-if="!profileRequired" class="profile-close" @tap="closeProfileModal">取消</t-button>
        </view>

        <view class="profile-preview">
          <button
            class="profile-avatar profile-avatar-button"
            :class="[avatarGenderClass, { disabled: avatarChoosing || savingProfile }]"
            :disabled="avatarChoosing || savingProfile"
            open-type="chooseAvatar"
            hover-class="profile-avatar-button-hover"
            aria-label="选择头像"
            @tap="markAvatarChoosing"
            @chooseavatar="handleChooseAvatar"
          >
            <image
              class="profile-avatar-image"
              :src="avatarPreview.src"
              mode="aspectFill"
              :webp="true"
              @error="handleAvatarLoadError(avatarPreview.src)"
            />
          </button>
          <view class="profile-preview-copy">
            <view class="profile-name-control">
              <t-image
                v-if="profileGenderIcon"
                class="profile-gender-icon"
                :src="profileGenderIcon"
                mode="aspectFit"
              />
              <input
                class="profile-nickname-input"
                type="nickname"
                maxlength="32"
                :placeholder="profileNicknamePlaceholder"
                :class="{ disabled: savingProfile }"
                :value="draftNickname"
                :disabled="savingProfile"
                @input="handleNicknameInput"
                @change="handleNicknameInput"
                @confirm="handleNicknameInput"
                @blur="handleNicknameBlur"
              />
            </view>
            <view class="profile-avatar-label">{{ avatarLabelText }}</view>
          </view>
        </view>

        <view class="profile-field-label">性别</view>
        <view class="gender-options">
          <t-button
            class="gender-option male"
            :class="{ selected: draftGender === 'male' }"
            @tap="selectGender('male')"
          >
            <view class="gender-option-content">
              <view class="option-avatar">
                <image
                  class="option-avatar-image"
                  :src="defaultAvatars.male.src"
                  mode="aspectFill"
                />
              </view>
              <view class="option-copy">
                <text class="option-title">男</text>
                <text class="option-subtitle">默认男生头像</text>
              </view>
            </view>
          </t-button>
          <t-button
            class="gender-option female"
            :class="{ selected: draftGender === 'female' }"
            @tap="selectGender('female')"
          >
            <view class="gender-option-content">
              <view class="option-avatar">
                <image
                  class="option-avatar-image"
                  :src="defaultAvatars.female.src"
                  mode="aspectFill"
                />
              </view>
              <view class="option-copy">
                <text class="option-title">女</text>
                <text class="option-subtitle">默认女生头像</text>
              </view>
            </view>
          </t-button>
        </view>

        <t-button
          class="profile-save"
          :class="{ disabled: !canSaveProfile }"
          :disabled="!canSaveProfile"
          @tap="saveProfile"
        >
          {{ saveButtonText }}
        </t-button>
        <t-button class="profile-logout" @tap="logoutProfile">退出登录</t-button>
      </view>
    </view>

    <view v-if="phoneVisible" class="profile-mask" @tap="handlePhoneBackdropTap">
      <view class="profile-modal phone-modal" @tap.stop>
        <view class="profile-head">
          <view>
            <view class="profile-title">{{ phoneTitle }}</view>
            <view class="profile-subtitle">{{ phoneSubtitle }}</view>
          </view>
          <t-button v-if="!phoneRequired" class="profile-close" @tap="skipPhoneAuthorization">跳过</t-button>
        </view>

        <view class="phone-copy">
          <view class="phone-copy-title">手机号仅用于车局沟通</view>
          <view class="phone-copy-text">不会在公开车局、分享页或个人信息条展示。</view>
        </view>

        <t-button
          class="phone-authorize"
          :class="{ disabled: savingPhone }"
          :disabled="savingPhone"
          open-type="getPhoneNumber"
          @getphonenumber="handlePhoneNumber"
        >
          {{ phoneButtonText }}
        </t-button>
        <t-button v-if="!phoneRequired" class="phone-skip" @tap="skipPhoneAuthorization">稍后再说</t-button>
      </view>
    </view>
  </view>
</template>

<script>
import { onShow } from "@dcloudio/uni-app";
import {
  AUTH_CHANGE_EVENT,
  AUTH_PHONE_ACK_EVENT,
  AUTH_PHONE_REQUEST_EVENT,
  AUTH_PHONE_RESPONSE_EVENT,
  AUTH_PROFILE_ACK_EVENT,
  AUTH_PROFILE_REQUEST_EVENT,
  AUTH_PROFILE_RESPONSE_EVENT,
  assetUrl,
  clearAuth,
  clearCurrentUserAvatarUrl,
  goHomeAfterLogout,
  getCurrentUser,
  getToken,
  refreshCurrentAuth,
  uploadUserAvatar,
  updateUserPhoneFromWechatPhoneCode,
  updateUserGender,
  updateUserProfile,
  dataOf,
  request,
  userGenderLabel
} from "../utils/api";
import {
  authMessageIdentityKey,
  buildOrganizerSignupMessages,
  buildPersistentMessages,
  mergePersistentMessagePages,
  mergeAuthMessages,
  restorePersistentUnread,
  shouldApplyMessageRefresh,
  totalMessageBadgeCount,
  totalOrganizerSignupMessageCount
} from "../utils/authMessages";
import { showToast } from "../utils/tdesignFeedback";

const DEFAULT_AVATARS = {
  male: {
    src: "/static/avatars/default-male.jpg",
    label: "默认男生头像"
  },
  female: {
    src: "/static/avatars/default-female.jpg",
    label: "默认女生头像"
  },
  unknown: {
    src: "/static/icons/user.png",
    label: "默认头像"
  }
};

const GENDER_ICONS = {
  male: "/static/icons/gender-male.png",
  female: "/static/icons/gender-female.png"
};

function avatarForGender(gender) {
  return DEFAULT_AVATARS[gender] || DEFAULT_AVATARS.unknown;
}

function genderAvatarClass(gender) {
  return ["male", "female"].includes(gender) ? gender : "unknown";
}

function genderIcon(gender) {
  return GENDER_ICONS[gender] || "";
}

function profileDisplayName(nickname) {
  return (nickname || "").trim() || "填写昵称";
}

function currentPageRoute() {
  if (typeof getCurrentPages !== "function") {
    return "";
  }
  const pages = getCurrentPages();
  return pages.length > 0 ? pages[pages.length - 1].route || "" : "";
}

export default {
  emits: ["guest-login"],
  props: {
    passiveGuest: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      user: null,
      roles: [],
      ownerRoute: "",
      profileVisible: false,
      profileRequired: false,
      profileRequestId: "",
      draftNickname: "",
      draftGender: "",
      draftAvatarUrl: "",
      draftAvatarTempPath: "",
      avatarChoosing: false,
      avatarChooseTimer: null,
      organizerMessages: [],
      persistentMessages: [],
      persistentUnreadCount: 0,
      notificationsNextCursor: null,
      notificationsHasMore: false,
      notificationsLoadingMore: false,
      notificationsLoadMoreError: "",
      notificationReadInFlight: [],
      messagesLoading: false,
      sessionsMessagesError: "",
      notificationsMessagesError: "",
      messageRefreshGeneration: 0,
      activeMessageIdentityKey: "",
      messagePanelVisible: false,
      phoneVisible: false,
      phoneRequired: false,
      phoneRequestId: "",
      phoneTitleText: "",
      phoneContentText: "",
      savingPhone: false,
      savingProfile: false
    };
  },
  computed: {
    displayName() {
      if (!this.user) {
        return this.passiveGuest ? "可先体验功能" : "前往登录页";
      }
      return profileDisplayName(this.user.nickname);
    },
    authStateText() {
      if (this.user) {
        return "已登录";
      }
      return this.passiveGuest ? "游客浏览" : "未登录";
    },
    barGenderIcon() {
      return genderIcon(this.user?.gender);
    },
    profileGenderIcon() {
      return genderIcon(this.draftGender || this.user?.gender);
    },
    profileNicknamePlaceholder() {
      return "填写昵称";
    },
    genderText() {
      return this.user?.gender ? userGenderLabel(this.user.gender) : "";
    },
    rolesText() {
      return [this.genderText, ...(this.roles || [])].filter(Boolean).join(" / ");
    },
    barAvatar() {
      if (this.user?.avatarUrl) {
        return {
          src: assetUrl(this.user.avatarUrl),
          label: "当前头像"
        };
      }
      return avatarForGender(this.user?.gender || "");
    },
    barAvatarClass() {
      return genderAvatarClass(this.user?.gender);
    },
    avatarPreview() {
      if (this.draftAvatarTempPath) {
        return {
          src: this.draftAvatarTempPath,
          label: "新头像预览"
        };
      }
      if (this.draftAvatarUrl) {
        return {
          src: assetUrl(this.draftAvatarUrl),
          label: "当前头像"
        };
      }
      return avatarForGender(this.draftGender || this.user?.gender || "");
    },
    avatarGenderClass() {
      return genderAvatarClass(this.draftGender || this.user?.gender);
    },
    defaultAvatars() {
      return DEFAULT_AVATARS;
    },
    profileTitle() {
      return this.profileRequired ? "完善个人信息" : "个人信息";
    },
    profileOpenidText() {
      const openid = this.user?.openid || this.user?.open_id || "";
      return openid ? `openid: ${openid}` : "";
    },
    profileSubtitle() {
      return this.profileRequired ? "请选择性别后继续使用。" : "昵称和头像会同步到个人资料。";
    },
    canSaveProfile() {
      return (!this.profileRequired || Boolean(this.draftGender)) && !this.savingProfile;
    },
    saveButtonText() {
      return this.savingProfile ? "保存中..." : "保存";
    },
    avatarLabelText() {
      return this.avatarChoosing ? "选择中..." : this.avatarPreview.label;
    },
    phoneTitle() {
      if (this.phoneTitleText) {
        return this.phoneTitleText;
      }
      return this.phoneRequired ? "授权手机号后继续" : "授权手机号";
    },
    phoneSubtitle() {
      if (this.phoneContentText) {
        return this.phoneContentText;
      }
      return this.phoneRequired
        ? "创建车或上车前需要授权手机号。"
        : "现在可以跳过，创建车或上车前会再次要求授权。";
    },
    phoneButtonText() {
      return this.savingPhone ? "授权中..." : "授权手机号";
    },
    organizerMessageCount() {
      return totalOrganizerSignupMessageCount(this.organizerMessages);
    },
    authMessages() {
      return mergeAuthMessages(this.organizerMessages, this.persistentMessages);
    },
    messageBadgeCount() {
      return totalMessageBadgeCount(this.organizerMessages, this.persistentUnreadCount);
    },
    messageChipVisible() {
      return Boolean(this.user) &&
        (this.messagesLoading || this.authMessages.length > 0 || Boolean(this.messageLoadError));
    },
    messageLoadError() {
      if (this.sessionsMessagesError && this.notificationsMessagesError) {
        return "消息加载失败，请稍后重试。";
      }
      return this.sessionsMessagesError || this.notificationsMessagesError;
    },
    messageBadgeText() {
      if (!this.user || this.messageBadgeCount < 1) {
        return "";
      }
      return this.messageBadgeCount > 99 ? "99+" : String(this.messageBadgeCount);
    },
    messagePanelSummary() {
      if (this.messagesLoading) {
        return "正在同步消息";
      }
      if (this.sessionsMessagesError || this.notificationsMessagesError) {
        return this.authMessages.length > 0
          ? `${this.authMessages.length}条消息，部分消息同步失败，请刷新重试`
          : "部分消息同步失败，请刷新重试";
      }
      if (this.authMessages.length < 1) {
        return "暂无消息";
      }
      return `${this.authMessages.length}条消息，${this.messageBadgeCount}条待处理或未读`;
    }
  },
  created() {
    this.ownerRoute = currentPageRoute();
    this.refreshIdentity();
    if (typeof uni.$on === "function") {
      uni.$on(AUTH_CHANGE_EVENT, this.refreshIdentity);
      uni.$on(AUTH_PHONE_REQUEST_EVENT, this.handlePhoneRequest);
      uni.$on(AUTH_PROFILE_REQUEST_EVENT, this.handleProfileRequest);
    }
  },
  unmounted() {
    if (typeof uni.$off === "function") {
      uni.$off(AUTH_CHANGE_EVENT, this.refreshIdentity);
      uni.$off(AUTH_PHONE_REQUEST_EVENT, this.handlePhoneRequest);
      uni.$off(AUTH_PROFILE_REQUEST_EVENT, this.handleProfileRequest);
    }
    this.clearAvatarChoosing();
  },
  setup() {
    onShow(() => {
      const auth = getCurrentUser();
      if (typeof uni.$emit === "function") {
        uni.$emit(AUTH_CHANGE_EVENT, auth);
      }
    });
  },
  methods: {
    syncProfileDrafts() {
      this.draftNickname = this.user?.nickname || "";
      this.draftGender = this.user?.gender || "";
      this.draftAvatarUrl = this.user?.avatarUrl || "";
      this.draftAvatarTempPath = "";
      this.clearAvatarChoosing();
    },
    handleIdentityTap() {
      if (!this.user && this.passiveGuest) {
        this.$emit("guest-login");
        return;
      }
      this.openProfileModal(false);
    },
    clearOrganizerMessages() {
      this.organizerMessages = [];
      this.persistentMessages = [];
      this.persistentUnreadCount = 0;
      this.notificationsNextCursor = null;
      this.notificationsHasMore = false;
      this.notificationsLoadingMore = false;
      this.notificationsLoadMoreError = "";
      this.notificationReadInFlight = [];
      this.sessionsMessagesError = "";
      this.notificationsMessagesError = "";
      this.messageRefreshGeneration += 1;
      this.activeMessageIdentityKey = "";
      this.messagesLoading = false;
      this.messagePanelVisible = false;
    },
    async refreshOrganizerMessages() {
      const token = getToken();
      const identityKey = authMessageIdentityKey(this.user?.id, token);
      if (!this.user || !identityKey) {
        this.clearOrganizerMessages();
        return;
      }
      const generation = this.messageRefreshGeneration + 1;
      this.messageRefreshGeneration = generation;
      this.notificationsLoadingMore = false;
      const requestContext = { generation, identityKey };
      if (this.activeMessageIdentityKey !== identityKey) {
        this.organizerMessages = [];
        this.persistentMessages = [];
        this.persistentUnreadCount = 0;
        this.notificationsNextCursor = null;
        this.notificationsHasMore = false;
        this.notificationsLoadingMore = false;
        this.notificationsLoadMoreError = "";
        this.notificationReadInFlight = [];
        this.sessionsMessagesError = "";
        this.notificationsMessagesError = "";
        this.activeMessageIdentityKey = identityKey;
      }

      this.messagesLoading = true;
      try {
        const [sessionsResult, notificationsResult] = await Promise.allSettled([
          request({ url: "/api/users/me/sessions?limit=50" }),
          request({ url: "/api/users/me/notifications" })
        ]);
        const authError = [sessionsResult, notificationsResult].find(
          (result) => result.status === "rejected" && result.reason?.statusCode === 401
        );
        const currentContext = {
          generation: this.messageRefreshGeneration,
          identityKey: authMessageIdentityKey(this.user?.id, getToken())
        };
        if (!shouldApplyMessageRefresh(requestContext, currentContext)) {
          return;
        }
        if (authError) {
          clearAuth();
          this.refreshIdentity();
          return;
        }
        if (sessionsResult.status === "fulfilled") {
          this.organizerMessages = buildOrganizerSignupMessages(dataOf(sessionsResult.value) || []);
          this.sessionsMessagesError = "";
        } else {
          this.organizerMessages = [];
          this.sessionsMessagesError = "待审核申请同步失败。";
        }
        if (notificationsResult.status === "fulfilled") {
          const inbox = dataOf(notificationsResult.value) || {};
          this.persistentMessages = buildPersistentMessages(inbox.items || []);
          this.persistentUnreadCount = Math.max(0, Number(inbox.unread_count) || 0);
          this.notificationsNextCursor = inbox.next_cursor || null;
          this.notificationsHasMore = Boolean(inbox.has_more && this.notificationsNextCursor);
          this.notificationsLoadMoreError = "";
          this.notificationsMessagesError = "";
        } else {
          this.persistentMessages = [];
          this.persistentUnreadCount = 0;
          this.notificationsNextCursor = null;
          this.notificationsHasMore = false;
          this.notificationsMessagesError = "通知消息同步失败。";
        }
      } catch (error) {
        const currentContext = {
          generation: this.messageRefreshGeneration,
          identityKey: authMessageIdentityKey(this.user?.id, getToken())
        };
        if (!shouldApplyMessageRefresh(requestContext, currentContext)) {
          return;
        }
        if (error?.statusCode === 401) {
          clearAuth();
          this.refreshIdentity();
          return;
        }
        this.organizerMessages = [];
        this.persistentMessages = [];
        this.persistentUnreadCount = 0;
        this.notificationsNextCursor = null;
        this.notificationsHasMore = false;
        this.sessionsMessagesError = "待审核申请同步失败。";
        this.notificationsMessagesError = "通知消息同步失败。";
      } finally {
        const currentContext = {
          generation: this.messageRefreshGeneration,
          identityKey: authMessageIdentityKey(this.user?.id, getToken())
        };
        if (shouldApplyMessageRefresh(requestContext, currentContext)) {
          this.messagesLoading = false;
        }
      }
    },
    async loadMoreNotifications() {
      const cursor = this.notificationsNextCursor;
      const requestContext = {
        generation: this.messageRefreshGeneration,
        identityKey: authMessageIdentityKey(this.user?.id, getToken())
      };
      if (!cursor || !this.notificationsHasMore || this.notificationsLoadingMore) {
        return;
      }
      this.notificationsLoadingMore = true;
      this.notificationsLoadMoreError = "";
      try {
        const response = await request({
          url: `/api/users/me/notifications?cursor=${encodeURIComponent(cursor)}`
        });
        const currentContext = {
          generation: this.messageRefreshGeneration,
          identityKey: authMessageIdentityKey(this.user?.id, getToken())
        };
        if (!shouldApplyMessageRefresh(requestContext, currentContext)) {
          return;
        }
        const inbox = dataOf(response) || {};
        this.persistentMessages = mergePersistentMessagePages(
          this.persistentMessages,
          buildPersistentMessages(inbox.items || [])
        );
        this.persistentUnreadCount = Math.max(0, Number(inbox.unread_count) || 0);
        this.notificationsNextCursor = inbox.next_cursor || null;
        this.notificationsHasMore = Boolean(inbox.has_more && this.notificationsNextCursor);
      } catch (error) {
        const currentContext = {
          generation: this.messageRefreshGeneration,
          identityKey: authMessageIdentityKey(this.user?.id, getToken())
        };
        if (!shouldApplyMessageRefresh(requestContext, currentContext)) {
          return;
        }
        if (error?.statusCode === 401) {
          clearAuth();
          this.refreshIdentity();
          return;
        }
        this.notificationsLoadMoreError = "更多通知加载失败，请重试。";
      } finally {
        const currentContext = {
          generation: this.messageRefreshGeneration,
          identityKey: authMessageIdentityKey(this.user?.id, getToken())
        };
        if (shouldApplyMessageRefresh(requestContext, currentContext)) {
          this.notificationsLoadingMore = false;
        }
      }
    },
    toggleMessagePanel() {
      if (!this.user) {
        return;
      }
      this.messagePanelVisible = !this.messagePanelVisible;
    },
    closeMessagePanel() {
      this.messagePanelVisible = false;
    },
    goManageFromMessage(message) {
      if (!message?.sessionId) {
        return;
      }
      this.messagePanelVisible = false;
      uni.navigateTo({ url: `/pages/session/manage?id=${message.sessionId}` });
    },
    handleMessageTap(message) {
      if (message?.kind === "pending_signup") {
        this.goManageFromMessage(message);
        return;
      }
      if (!message?.targetUrl) {
        return;
      }
      const notificationId = message.notificationId;
      if (notificationId && this.notificationReadInFlight.includes(notificationId)) {
        return;
      }
      if (notificationId) {
        const identityKey = this.activeMessageIdentityKey;
        const wasUnread = Boolean(message.unread);
        this.notificationReadInFlight = [...this.notificationReadInFlight, notificationId];
        if (wasUnread) {
          this.persistentMessages = this.persistentMessages.map((item) =>
            item.notificationId === notificationId ? { ...item, unread: false } : item
          );
          this.persistentUnreadCount = Math.max(0, this.persistentUnreadCount - 1);
        }
        request({
          url: `/api/users/me/notifications/${notificationId}/read`,
          method: "POST"
        })
          .catch((error) => {
            if (identityKey !== this.activeMessageIdentityKey) {
              return;
            }
            if (error?.statusCode === 401) {
              clearAuth();
              this.refreshIdentity();
              return;
            }
            if (wasUnread) {
              const restored = restorePersistentUnread(
                this.persistentMessages,
                this.persistentUnreadCount,
                notificationId
              );
              this.persistentMessages = restored.messages;
              this.persistentUnreadCount = restored.unreadCount;
            }
          })
          .finally(() => {
            if (identityKey === this.activeMessageIdentityKey) {
              this.notificationReadInFlight = this.notificationReadInFlight.filter(
                (id) => id !== notificationId
              );
            }
          });
      }
      this.messagePanelVisible = false;
      uni.navigateTo({ url: message.targetUrl });
    },
    clearAvatarChoosing() {
      this.avatarChoosing = false;
      if (this.avatarChooseTimer) {
        clearTimeout(this.avatarChooseTimer);
        this.avatarChooseTimer = null;
      }
    },
    refreshIdentity() {
      const auth = getCurrentUser();
      this.user = auth.user || null;
      this.roles = auth.roles || [];
      if (this.user && getToken()) {
        this.refreshOrganizerMessages();
      } else {
        this.clearOrganizerMessages();
      }
      if (!this.profileVisible && !this.phoneVisible) {
        this.syncProfileDrafts();
      }
    },
    async refreshIdentityFromServer() {
      const auth = getCurrentUser();
      if (!auth.user) {
        return;
      }
      if (!getToken()) {
        clearAuth();
        this.refreshIdentity();
        return;
      }
      try {
        await refreshCurrentAuth();
      } catch (error) {
        if (error?.statusCode === 401) {
          clearAuth();
        }
      }
      this.refreshIdentity();
    },
    handlePhoneRequest(payload = {}) {
      if (payload.route && this.ownerRoute && payload.route !== this.ownerRoute) {
        return;
      }

      this.refreshIdentity();
      this.phoneRequired = Boolean(payload.required);
      this.phoneRequestId = payload.requestId || "";
      this.phoneTitleText = payload.title || "";
      this.phoneContentText = payload.content || "";
      if (typeof uni.$emit === "function" && payload.requestId) {
        uni.$emit(AUTH_PHONE_ACK_EVENT, { requestId: payload.requestId });
      }
      this.openPhoneModal(this.phoneRequired);
    },
    handleProfileRequest(payload = {}) {
      if (payload.route && this.ownerRoute && payload.route !== this.ownerRoute) {
        return;
      }

      this.refreshIdentity();
      this.profileRequired = Boolean(payload.required);
      this.profileRequestId = payload.requestId || "";
      if (typeof uni.$emit === "function" && payload.requestId) {
        uni.$emit(AUTH_PROFILE_ACK_EVENT, { requestId: payload.requestId });
      }
      this.openProfileModal(this.profileRequired);
    },
    async openProfileModal(required = false) {
      if (!this.user) {
        if (!required) {
          this.goLoginPage();
        }
        return;
      }

      this.profileRequired = Boolean(required);
      this.messagePanelVisible = false;
      this.profileVisible = true;
      this.syncProfileDrafts();
    },
    openPhoneModal(required = false) {
      if (!this.user) {
        this.finishPhoneRequest(null);
        return;
      }

      this.phoneRequired = Boolean(required);
      this.phoneVisible = true;
    },
    goLoginPage() {
      if (currentPageRoute() === "pages/mine/index") {
        return;
      }
      uni.navigateTo({ url: "/pages/mine/index" });
    },
    handlePhoneBackdropTap() {
      if (this.phoneRequired) {
        this.finishPhoneRequest(null);
        showToast({ title: "授权手机号后继续", icon: "none" });
        return;
      }

      this.skipPhoneAuthorization();
    },
    handlePhonePopupVisibleChange(event = {}) {
      if (event.detail?.visible === false) {
        this.handlePhoneBackdropTap();
      }
    },
    skipPhoneAuthorization() {
      this.finishPhoneRequest(getCurrentUser());
    },
    finishPhoneRequest(auth) {
      const requestId = this.phoneRequestId;
      this.phoneVisible = false;
      this.phoneRequired = false;
      this.phoneRequestId = "";
      this.phoneTitleText = "";
      this.phoneContentText = "";
      this.savingPhone = false;
      if (requestId && typeof uni.$emit === "function") {
        uni.$emit(AUTH_PHONE_RESPONSE_EVENT, { requestId, auth });
      }
    },
    async handlePhoneNumber(event = {}) {
      const code = event.detail?.code || "";
      if (!code) {
        if (this.phoneRequired) {
          this.finishPhoneRequest(null);
          showToast({ title: "授权手机号后继续", icon: "none" });
        } else {
          this.skipPhoneAuthorization();
        }
        return;
      }

      this.savingPhone = true;
      try {
        const auth = await updateUserPhoneFromWechatPhoneCode(code);
        if (!auth?.user) {
          throw new Error("Missing updated user");
        }
        this.user = auth.user;
        this.roles = auth.roles || [];
        this.finishPhoneRequest(auth);
        showToast({ title: "手机号已授权", icon: "none" });
      } catch (error) {
        showToast({ title: "手机号授权失败，请重试", icon: "none" });
      } finally {
        this.savingPhone = false;
      }
    },
    handleProfileBackdropTap() {
      if (!this.profileRequired) {
        this.closeProfileModal();
      }
    },
    handleProfilePopupVisibleChange(event = {}) {
      if (event.detail?.visible === false) {
        this.handleProfileBackdropTap();
      }
    },
    closeProfileModal() {
      if (this.profileRequired) {
        showToast({ title: "请选择性别后继续", icon: "none" });
        return;
      }

      this.profileVisible = false;
      this.profileRequestId = "";
      this.syncProfileDrafts();
    },
    finishProfileRequest(auth) {
      const requestId = this.profileRequestId;
      this.profileVisible = false;
      this.profileRequired = false;
      this.profileRequestId = "";
      this.savingProfile = false;
      this.clearAvatarChoosing();
      this.syncProfileDrafts();
      if (requestId && typeof uni.$emit === "function") {
        uni.$emit(AUTH_PROFILE_RESPONSE_EVENT, { requestId, auth });
      }
    },
    selectGender(gender) {
      this.draftGender = gender;
    },
    applyDraftNickname(value, options = {}) {
      const nickname = (value || "").trim();
      if (!nickname && options.keepCurrentOnEmpty) {
        return true;
      }
      if (nickname.length > 32) {
        showToast({ title: "昵称最多32个字", icon: "none" });
        return false;
      }
      this.draftNickname = nickname;
      return true;
    },
    handleNicknameInput(event = {}) {
      this.applyDraftNickname(event.detail?.value || "");
    },
    handleNicknameBlur(event = {}) {
      this.applyDraftNickname(event.detail?.value || "", { keepCurrentOnEmpty: true });
    },
    markAvatarChoosing() {
      if (this.avatarChoosing || this.savingProfile) {
        return;
      }
      this.avatarChoosing = true;
      if (this.avatarChooseTimer) {
        clearTimeout(this.avatarChooseTimer);
      }
      this.avatarChooseTimer = setTimeout(() => {
        this.avatarChoosing = false;
        this.avatarChooseTimer = null;
      }, 1500);
    },
    handleChooseAvatar(event = {}) {
      this.clearAvatarChoosing();
      const avatarUrl = event.detail?.avatarUrl || "";
      if (avatarUrl) {
        this.draftAvatarTempPath = avatarUrl;
      }
    },
    handleAvatarLoadError(imageSrc = "") {
      if (!this.user?.avatarUrl) {
        return;
      }
      const currentAvatarSrc = assetUrl(this.user.avatarUrl);
      if (imageSrc && imageSrc !== currentAvatarSrc) {
        return;
      }
      clearCurrentUserAvatarUrl(this.user.avatarUrl);
      this.refreshIdentity();
      this.syncProfileDrafts();
    },
    async saveProfile() {
      if (!this.canSaveProfile) {
        if (!this.draftGender) {
          showToast({ title: "请选择性别", icon: "none" });
        }
        return;
      }
      if ((this.draftNickname || "").trim().length > 32) {
        showToast({ title: "昵称最多32个字", icon: "none" });
        return;
      }

      this.savingProfile = true;
      try {
        let avatarUrl = this.draftAvatarUrl || "";
        if (this.draftAvatarTempPath) {
          avatarUrl = await uploadUserAvatar(this.draftAvatarTempPath);
        }

        const patch = {
          nickname: this.draftNickname,
          avatarUrl
        };
        if (this.draftGender) {
          patch.gender = this.draftGender;
        }

        const auth = await updateUserProfile(patch);
        if (!auth?.user) {
          throw new Error("Missing updated user");
        }
        this.user = auth.user;
        this.roles = auth.roles || [];
        this.syncProfileDrafts();
        this.profileVisible = false;
        this.profileRequired = false;
        const requestId = this.profileRequestId;
        this.profileRequestId = "";
        if (requestId && typeof uni.$emit === "function") {
          uni.$emit(AUTH_PROFILE_RESPONSE_EVENT, { requestId, auth });
        }
        showToast({ title: "个人信息已更新", icon: "none" });
      } catch (error) {
        if (error?.statusCode === 401) {
          this.finishProfileRequest(null);
          this.refreshIdentity();
          showToast({
            title: error.userMessage || "登录已过期，请重新登录。",
            icon: "none"
          });
          return;
        }
        showToast({ title: error?.userMessage || "个人信息保存失败", icon: "none" });
      } finally {
        this.savingProfile = false;
      }
    },
    logoutProfile() {
      const requestId = this.profileRequestId;
      clearAuth();
      this.user = null;
      this.roles = [];
      this.clearOrganizerMessages();
      this.profileVisible = false;
      this.profileRequired = false;
      this.profileRequestId = "";
      this.draftGender = "";
      this.draftNickname = "";
      this.draftAvatarUrl = "";
      this.draftAvatarTempPath = "";
      this.clearAvatarChoosing();
      this.savingProfile = false;
      if (requestId && typeof uni.$emit === "function") {
        uni.$emit(AUTH_PROFILE_RESPONSE_EVENT, { requestId, auth: null });
      }
      showToast({ title: "已退出登录", icon: "none" });
      goHomeAfterLogout();
    }
  }
};
</script>

<style scoped>
.auth-identity {
  --avatar-male-surface: #dcece7;
  --avatar-female-surface: #f7dde7;
  --avatar-male-ring: #257b67;
  --avatar-female-ring: #d65b89;
  --avatar-unknown-ring: rgba(196, 174, 119, 0.62);

  position: relative;
  z-index: 8;
  margin-bottom: 24rpx;
}

.auth-identity-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
  height: 56rpx;
  overflow: hidden;
  padding: 0 18rpx;
  box-sizing: border-box;
  border: 1rpx solid rgba(222, 215, 202, 0.9);
  border-radius: 8rpx;
  background: rgba(255, 255, 252, 0.92);
  color: #153f34;
}

.auth-identity-bar.empty {
  color: #7a857d;
}

.auth-profile-trigger {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 14rpx;
  height: 100%;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: normal;
  text-align: left;
  box-sizing: border-box;
}

.auth-profile-trigger-hover {
  opacity: 0.82;
}

.auth-avatar {
  display: flex;
  flex: 0 0 36rpx;
  align-items: center;
  justify-content: center;
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  overflow: hidden;
  border: 3rpx solid var(--avatar-unknown-ring);
  background: #f4efe2;
  box-sizing: border-box;
}

.auth-avatar.male {
  border-color: var(--avatar-male-ring);
  background: var(--avatar-male-surface);
}

.auth-avatar.female {
  border-color: var(--avatar-female-ring);
  background: var(--avatar-female-surface);
}

.auth-avatar.unknown {
  border-color: var(--avatar-unknown-ring);
  background: #eef1eb;
}

.auth-avatar-image {
  display: block;
  width: 100%;
  height: 100%;
}

.auth-main {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 12rpx;
  min-width: 0;
}

.auth-state {
  flex-shrink: 0;
  color: #1f6f5b;
  font-size: 22rpx;
  font-weight: 600;
}

.auth-name {
  display: flex;
  align-items: center;
  gap: 0;
  overflow: hidden;
  min-width: 0;
  height: 32rpx;
}

.auth-gender-icon {
  display: block;
  flex: 0 0 22rpx;
  width: 22rpx;
  height: 22rpx;
  margin-right: 3rpx;
}

.auth-name-text {
  overflow: hidden;
  min-width: 0;
  color: inherit;
  font-size: 22rpx;
  line-height: 32rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.auth-side {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 8rpx;
  min-width: 0;
}

.auth-roles {
  overflow: hidden;
  flex: 0 1 auto;
  min-width: 0;
  color: #8d7b55;
  font-size: 21rpx;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.auth-message-chip {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  height: 36rpx;
  min-width: 82rpx;
  margin: 0;
  padding: 0 12rpx;
  border: 1rpx solid rgba(31, 111, 91, 0.22);
  border-radius: 18rpx;
  background: #e9f4ef;
  color: #1f6f5b;
  font-size: 20rpx;
  font-weight: 700;
  line-height: 34rpx;
}

.auth-message-chip-content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  min-width: 0;
}

.auth-message-chip::after,
.auth-profile-trigger::after,
.message-panel-tool::after,
.message-item::after {
  border: 0;
}

.auth-message-chip-hover,
.message-item-hover {
  opacity: 0.82;
}

.auth-message-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28rpx;
  height: 28rpx;
  padding: 0 6rpx;
  box-sizing: border-box;
  border-radius: 14rpx;
  background: #c94d3f;
  color: #ffffff;
  font-size: 18rpx;
  line-height: 28rpx;
}

.message-panel {
  position: absolute;
  top: 66rpx;
  left: 0;
  right: 0;
  z-index: 20;
  padding: 22rpx;
  box-sizing: border-box;
  border: 1rpx solid #ded8ca;
  border-radius: 12rpx;
  background: #fffef9;
  box-shadow: 0 18rpx 48rpx rgba(23, 41, 35, 0.16);
}

.message-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18rpx;
}

.message-panel-title {
  color: #143d34;
  font-size: 27rpx;
  font-weight: 700;
  line-height: 1.25;
}

.message-panel-subtitle {
  margin-top: 6rpx;
  color: #6f7b73;
  font-size: 22rpx;
  line-height: 1.35;
}

.message-panel-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 10rpx;
}

.message-panel-tool {
  width: 72rpx;
  height: 44rpx;
  margin: 0;
  padding: 0;
  border: 1rpx solid #e5dece;
  border-radius: 8rpx;
  background: #ffffff;
  color: #526159;
  font-size: 22rpx;
  font-weight: 600;
  line-height: 42rpx;
}

.message-panel-tool.disabled {
  color: #9aa39d;
}

.message-empty {
  margin-top: 18rpx;
  padding: 18rpx 0 4rpx;
  color: #6f7b73;
  font-size: 23rpx;
  line-height: 1.4;
}

.message-empty.error {
  color: #a4473d;
}

.message-load-more {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding-top: 16rpx;
}

.message-load-more-error {
  color: #b42318;
  font-size: 22rpx;
}

.message-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  width: 100%;
  min-height: 92rpx;
  margin: 18rpx 0 0;
  padding: 16rpx 0;
  border-top: 1rpx solid #eee8da;
  border-radius: 0;
  background: transparent;
  color: #183d34;
  text-align: left;
}

.message-item-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  width: 100%;
  min-width: 0;
}

.message-copy {
  min-width: 0;
}

.message-title-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}

.message-title {
  overflow: hidden;
  min-width: 0;
  color: #183d34;
  font-size: 25rpx;
  font-weight: 700;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-count {
  flex: 0 0 auto;
  color: #c94d3f;
  font-size: 21rpx;
  font-weight: 700;
  line-height: 1.3;
}

.message-unread {
  flex: 0 0 auto;
  color: #c94d3f;
  font-size: 20rpx;
  font-weight: 700;
  line-height: 1.3;
}

.message-subtitle {
  display: block;
  overflow: hidden;
  margin-top: 6rpx;
  color: #6f7b73;
  font-size: 22rpx;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-action {
  flex: 0 0 auto;
  color: #1f6f5b;
  font-size: 23rpx;
  font-weight: 700;
  line-height: 1.35;
}

.profile-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  box-sizing: border-box;
  background: rgba(20, 28, 26, 0.38);
}

.profile-modal {
  width: 100%;
  max-width: 640rpx;
  padding: 34rpx;
  box-sizing: border-box;
  border-radius: 18rpx;
  background: #fffef9;
  box-shadow: 0 28rpx 80rpx rgba(23, 41, 35, 0.18);
}

.profile-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24rpx;
}

.profile-title-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10rpx 14rpx;
}

.profile-title {
  color: #143d34;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1.25;
}

.profile-openid {
  max-width: 440rpx;
  color: rgba(82, 97, 89, 0.58);
  font-size: 19rpx;
  font-weight: 400;
  line-height: 1.35;
  overflow-wrap: anywhere;
  word-break: break-all;
}

.profile-subtitle {
  margin-top: 8rpx;
  color: #6f7b73;
  font-size: 24rpx;
  line-height: 1.45;
}

.profile-close {
  flex: 0 0 96rpx;
  width: 96rpx;
  height: 54rpx;
  margin: 0;
  padding: 0;
  border: 1rpx solid #ded8ca;
  border-radius: 10rpx;
  background: #ffffff;
  color: #526159;
  font-size: 24rpx;
  line-height: 54rpx;
}

.profile-preview {
  display: flex;
  align-items: center;
  gap: 22rpx;
  margin-top: 32rpx;
  padding: 22rpx 0;
  border-top: 1rpx solid #eee8da;
  border-bottom: 1rpx solid #eee8da;
}

.profile-avatar {
  display: flex;
  flex: 0 0 96rpx;
  align-items: center;
  justify-content: center;
  width: 96rpx;
  height: 96rpx;
  margin: 0;
  padding: 0;
  border-radius: 50%;
  overflow: hidden;
  border: 4rpx solid var(--avatar-unknown-ring);
  background: #f4efe2;
  box-sizing: border-box;
  line-height: 1;
}

.profile-avatar-button::after {
  border: 0;
}

.profile-avatar-button.disabled {
  opacity: 0.68;
}

.profile-avatar-button-hover {
  transform: scale(0.98);
}

.profile-avatar.male,
.gender-option.male .option-avatar {
  border-color: var(--avatar-male-ring);
  background: var(--avatar-male-surface);
}

.profile-avatar.female,
.gender-option.female .option-avatar {
  border-color: var(--avatar-female-ring);
  background: var(--avatar-female-surface);
}

.profile-avatar.unknown {
  border-color: var(--avatar-unknown-ring);
  background: #eef1eb;
}

.profile-avatar-image {
  display: block;
  width: 100%;
  height: 100%;
}

.profile-preview-copy {
  position: relative;
  min-width: 0;
}

.profile-name-control {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 8rpx;
}

.profile-name {
  display: block;
  overflow: hidden;
  color: #183d34;
  font-size: 26rpx;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-name.placeholder {
  color: #1f6f5b;
}

.profile-gender-icon {
  display: block;
  flex: 0 0 28rpx;
  width: 28rpx;
  height: 28rpx;
}

.profile-nickname-input {
  width: 260rpx;
  height: 42rpx;
  min-height: 42rpx;
  padding: 0;
  border: 0;
  background: transparent;
  color: #183d34;
  font-size: 26rpx;
  font-weight: 600;
  line-height: 42rpx;
}

.profile-nickname-input.disabled {
  color: #7b857e;
}

.profile-avatar-label {
  margin-top: 8rpx;
  color: #7b857e;
  font-size: 23rpx;
  line-height: 1.4;
}

.profile-field-label {
  margin-top: 28rpx;
  color: #314d45;
  font-size: 25rpx;
  font-weight: 600;
}

.gender-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18rpx;
  margin-top: 16rpx;
}

.gender-option {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 14rpx;
  min-height: 96rpx;
  margin: 0;
  padding: 14rpx;
  box-sizing: border-box;
  border: 2rpx solid #e5dece;
  border-radius: 14rpx;
  background: #ffffff;
  color: #183d34;
  text-align: left;
}

.gender-option-content {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 14rpx;
  width: 100%;
  min-width: 0;
}

.gender-option.selected {
  border-color: #1f6f5b;
  background: #eef7f4;
}

.option-avatar {
  display: flex;
  flex: 0 0 48rpx;
  align-items: center;
  justify-content: center;
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  overflow: hidden;
  border: 1rpx solid rgba(196, 174, 119, 0.58);
  background: #f4efe2;
}

.option-avatar-image {
  display: block;
  width: 100%;
  height: 100%;
}

.option-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4rpx;
}

.option-title {
  color: #183d34;
  font-size: 26rpx;
  font-weight: 700;
  line-height: 1.2;
}

.option-subtitle {
  color: #7a857d;
  font-size: 21rpx;
  line-height: 1.2;
}

.profile-save {
  height: 78rpx;
  width: 100%;
  margin: 30rpx 0 0;
  border-radius: 14rpx;
  background: #1f6f5b;
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 700;
  line-height: 78rpx;
}

.profile-save.disabled {
  background: #aeb8b1;
}

.profile-logout {
  height: 70rpx;
  width: 100%;
  margin: 18rpx 0 0;
  border: 1rpx solid #e5dece;
  border-radius: 14rpx;
  background: #ffffff;
  color: #7d4b42;
  font-size: 26rpx;
  font-weight: 600;
  line-height: 70rpx;
}

.phone-modal {
  padding-bottom: 30rpx;
}

.phone-copy {
  margin-top: 30rpx;
  padding: 24rpx;
  border: 1rpx solid #e8dfcc;
  border-radius: 14rpx;
  background: #f8f4e9;
}

.phone-copy-title {
  color: #183d34;
  font-size: 27rpx;
  font-weight: 700;
  line-height: 1.3;
}

.phone-copy-text {
  margin-top: 8rpx;
  color: #6f7b73;
  font-size: 23rpx;
  line-height: 1.45;
}

.phone-authorize {
  height: 78rpx;
  width: 100%;
  margin: 30rpx 0 0;
  border-radius: 14rpx;
  background: #1f6f5b;
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 700;
  line-height: 78rpx;
}

.phone-authorize.disabled {
  background: #aeb8b1;
}

.phone-skip {
  height: 70rpx;
  width: 100%;
  margin: 18rpx 0 0;
  border: 1rpx solid #e5dece;
  border-radius: 14rpx;
  background: #ffffff;
  color: #526159;
  font-size: 26rpx;
  font-weight: 600;
  line-height: 70rpx;
}
</style>
