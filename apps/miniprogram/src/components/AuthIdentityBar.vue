<template>
  <view class="auth-identity">
    <view class="auth-identity-bar" :class="{ empty: !user }" @tap="openProfileModal(false)">
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
        <text class="auth-state">{{ user ? "已登录" : "未登录" }}</text>
        <text class="auth-name">{{ displayName }}</text>
      </view>
      <view v-if="rolesText" class="auth-roles">{{ rolesText }}</view>
    </view>

    <view v-if="profileVisible" class="profile-mask" @tap="handleProfileBackdropTap">
      <view class="profile-modal" @tap.stop>
        <view class="profile-head">
          <view>
            <view class="profile-title">{{ profileTitle }}</view>
            <view class="profile-subtitle">{{ profileSubtitle }}</view>
          </view>
          <button v-if="!profileRequired" class="profile-close" @tap="closeProfileModal">取消</button>
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
              <text v-if="profileGenderSymbol" class="profile-gender-symbol">{{ profileGenderSymbol }}</text>
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
          <button
            class="gender-option male"
            :class="{ selected: draftGender === 'male' }"
            @tap="selectGender('male')"
          >
            <view class="option-avatar">
              <image class="option-avatar-image" :src="defaultAvatars.male.src" mode="aspectFill" />
            </view>
            <view class="option-copy">
              <text class="option-title">男</text>
              <text class="option-subtitle">默认男生头像</text>
            </view>
          </button>
          <button
            class="gender-option female"
            :class="{ selected: draftGender === 'female' }"
            @tap="selectGender('female')"
          >
            <view class="option-avatar">
              <image class="option-avatar-image" :src="defaultAvatars.female.src" mode="aspectFill" />
            </view>
            <view class="option-copy">
              <text class="option-title">女</text>
              <text class="option-subtitle">默认女生头像</text>
            </view>
          </button>
        </view>

        <button
          class="profile-save"
          :class="{ disabled: !canSaveProfile }"
          :disabled="!canSaveProfile"
          @tap="saveProfile"
        >
          {{ saveButtonText }}
        </button>
        <button class="profile-logout" @tap="logoutProfile">退出登录</button>
      </view>
    </view>

    <view v-if="phoneVisible" class="profile-mask" @tap="handlePhoneBackdropTap">
      <view class="profile-modal phone-modal" @tap.stop>
        <view class="profile-head">
          <view>
            <view class="profile-title">{{ phoneTitle }}</view>
            <view class="profile-subtitle">{{ phoneSubtitle }}</view>
          </view>
          <button v-if="!phoneRequired" class="profile-close" @tap="skipPhoneAuthorization">跳过</button>
        </view>

        <view class="phone-copy">
          <view class="phone-copy-title">手机号仅用于车局沟通</view>
          <view class="phone-copy-text">不会在公开车局、分享页或个人信息条展示。</view>
        </view>

        <button
          class="phone-authorize"
          :class="{ disabled: savingPhone }"
          :disabled="savingPhone"
          open-type="getPhoneNumber"
          @getphonenumber="handlePhoneNumber"
        >
          {{ phoneButtonText }}
        </button>
        <button v-if="!phoneRequired" class="phone-skip" @tap="skipPhoneAuthorization">稍后再说</button>
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
  getCurrentUser,
  getToken,
  refreshCurrentAuth,
  uploadUserAvatar,
  updateUserPhoneFromWechatPhoneCode,
  updateUserGender,
  updateUserProfile,
  userGenderLabel
} from "../utils/api";

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

function avatarForGender(gender) {
  return DEFAULT_AVATARS[gender] || DEFAULT_AVATARS.unknown;
}

function genderAvatarClass(gender) {
  return ["male", "female"].includes(gender) ? gender : "unknown";
}

function genderSymbol(gender) {
  if (gender === "male") {
    return "♂";
  }
  if (gender === "female") {
    return "♀";
  }
  return "";
}

function profileNameWithGenderSymbol(nickname, gender) {
  const name = (nickname || "").trim() || "填写昵称";
  const symbol = genderSymbol(gender);
  return symbol ? `${symbol} ${name}` : name;
}

function currentPageRoute() {
  if (typeof getCurrentPages !== "function") {
    return "";
  }
  const pages = getCurrentPages();
  return pages.length > 0 ? pages[pages.length - 1].route || "" : "";
}

export default {
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
        return "等待微信登录";
      }
      return profileNameWithGenderSymbol(this.user.nickname, this.user.gender);
    },
    profileGenderSymbol() {
      return genderSymbol(this.draftGender || this.user?.gender);
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
    }
  },
  created() {
    this.ownerRoute = currentPageRoute();
    this.refreshIdentity();
    this.refreshIdentityFromServer();
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
      await refreshCurrentAuth();
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
        uni.showToast({ title: "授权手机号后继续", icon: "none" });
        return;
      }

      this.skipPhoneAuthorization();
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
          uni.showToast({ title: "授权手机号后继续", icon: "none" });
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
        uni.showToast({ title: "手机号已授权", icon: "none" });
      } catch (error) {
        uni.showToast({ title: "手机号授权失败，请重试", icon: "none" });
      } finally {
        this.savingPhone = false;
      }
    },
    handleProfileBackdropTap() {
      if (!this.profileRequired) {
        this.closeProfileModal();
      }
    },
    closeProfileModal() {
      if (this.profileRequired) {
        uni.showToast({ title: "请选择性别后继续", icon: "none" });
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
        uni.showToast({ title: "昵称最多32个字", icon: "none" });
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
          uni.showToast({ title: "请选择性别", icon: "none" });
        }
        return;
      }
      if ((this.draftNickname || "").trim().length > 32) {
        uni.showToast({ title: "昵称最多32个字", icon: "none" });
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
        uni.showToast({ title: "个人信息已更新", icon: "none" });
      } catch (error) {
        if (error?.statusCode === 401) {
          this.finishProfileRequest(null);
          this.refreshIdentity();
          uni.showToast({
            title: error.userMessage || "登录已过期，请重新登录。",
            icon: "none"
          });
          return;
        }
        uni.showToast({ title: "个人信息保存失败", icon: "none" });
      } finally {
        this.savingProfile = false;
      }
    },
    logoutProfile() {
      const requestId = this.profileRequestId;
      clearAuth();
      this.user = null;
      this.roles = [];
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
      uni.showToast({ title: "已退出登录", icon: "none" });
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
  overflow: hidden;
  min-width: 0;
  font-size: 22rpx;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.auth-roles {
  overflow: hidden;
  flex-shrink: 0;
  max-width: 38%;
  color: #8d7b55;
  font-size: 21rpx;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.profile-title {
  color: #143d34;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1.25;
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

.profile-gender-symbol {
  flex: 0 0 auto;
  color: #183d34;
  font-size: 26rpx;
  font-weight: 600;
  line-height: 1.35;
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
