<template>
  <view class="auth-identity">
    <view class="auth-identity-bar" :class="{ empty: !user }" @tap="openProfileModal(false)">
      <view v-if="user" class="auth-avatar" :class="barAvatarClass">
        <image class="auth-avatar-image" :src="barAvatar.src" mode="aspectFill" />
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
          <view class="profile-avatar" :class="avatarGenderClass">
            <image class="profile-avatar-image" :src="avatarPreview.src" mode="aspectFill" />
          </view>
          <view class="profile-preview-copy">
            <view class="profile-name">{{ displayName }}</view>
            <view class="profile-avatar-label">{{ avatarPreview.label }}</view>
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
      </view>
    </view>
  </view>
</template>

<script>
import { onShow } from "@dcloudio/uni-app";
import {
  AUTH_CHANGE_EVENT,
  AUTH_PROFILE_ACK_EVENT,
  AUTH_PROFILE_REQUEST_EVENT,
  AUTH_PROFILE_RESPONSE_EVENT,
  getCurrentUser,
  updateUserGender,
  userGenderLabel
} from "../utils/api";

const DEFAULT_AVATARS = {
  male: {
    src: "/static/avatars/default-male.png",
    label: "默认男生头像"
  },
  female: {
    src: "/static/avatars/default-female.png",
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
      draftGender: "",
      savingProfile: false
    };
  },
  computed: {
    displayName() {
      if (!this.user) {
        return "等待微信登录";
      }
      return this.user.open_id || this.user.openid || `用户${this.user.id}`;
    },
    genderText() {
      return this.user?.gender ? userGenderLabel(this.user.gender) : "";
    },
    rolesText() {
      return [this.genderText, ...(this.roles || [])].filter(Boolean).join(" / ");
    },
    barAvatar() {
      return avatarForGender(this.user?.gender || "");
    },
    barAvatarClass() {
      return this.user?.gender || "unknown";
    },
    avatarPreview() {
      return avatarForGender(this.draftGender || this.user?.gender || "");
    },
    avatarGenderClass() {
      return this.draftGender || this.user?.gender || "unknown";
    },
    defaultAvatars() {
      return DEFAULT_AVATARS;
    },
    profileTitle() {
      return this.profileRequired ? "完善个人信息" : "个人信息";
    },
    profileSubtitle() {
      return this.profileRequired ? "请选择性别后继续使用。" : "更改性别后会同步更新默认头像。";
    },
    canSaveProfile() {
      return Boolean(this.draftGender) && !this.savingProfile;
    },
    saveButtonText() {
      return this.savingProfile ? "保存中..." : "保存";
    }
  },
  created() {
    this.ownerRoute = currentPageRoute();
    this.refreshIdentity();
    if (typeof uni.$on === "function") {
      uni.$on(AUTH_CHANGE_EVENT, this.refreshIdentity);
      uni.$on(AUTH_PROFILE_REQUEST_EVENT, this.handleProfileRequest);
    }
  },
  unmounted() {
    if (typeof uni.$off === "function") {
      uni.$off(AUTH_CHANGE_EVENT, this.refreshIdentity);
      uni.$off(AUTH_PROFILE_REQUEST_EVENT, this.handleProfileRequest);
    }
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
    refreshIdentity() {
      const auth = getCurrentUser();
      this.user = auth.user || null;
      this.roles = auth.roles || [];
      if (!this.profileVisible) {
        this.draftGender = this.user?.gender || "";
      }
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
    openProfileModal(required = false) {
      if (!this.user) {
        if (!required) {
          uni.showToast({ title: "请先登录", icon: "none" });
        }
        return;
      }

      this.profileRequired = Boolean(required);
      this.profileVisible = true;
      this.draftGender = this.user.gender || "";
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
      this.draftGender = this.user?.gender || "";
    },
    selectGender(gender) {
      this.draftGender = gender;
    },
    async saveProfile() {
      if (!this.canSaveProfile) {
        if (!this.draftGender) {
          uni.showToast({ title: "请选择性别", icon: "none" });
        }
        return;
      }

      this.savingProfile = true;
      try {
        const auth = await updateUserGender(this.draftGender);
        if (!auth?.user) {
          throw new Error("Missing updated user");
        }
        this.user = auth.user;
        this.roles = auth.roles || [];
        this.profileVisible = false;
        this.profileRequired = false;
        const requestId = this.profileRequestId;
        this.profileRequestId = "";
        if (requestId && typeof uni.$emit === "function") {
          uni.$emit(AUTH_PROFILE_RESPONSE_EVENT, { requestId, auth });
        }
        uni.showToast({ title: "个人信息已更新", icon: "none" });
      } catch (error) {
        uni.showToast({ title: "个人信息保存失败", icon: "none" });
      } finally {
        this.savingProfile = false;
      }
    }
  }
};
</script>

<style scoped>
.auth-identity {
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
  border: 1rpx solid rgba(196, 174, 119, 0.6);
  background: #f4efe2;
}

.auth-avatar.male {
  background: #e9eadf;
}

.auth-avatar.female {
  background: #f0e3de;
}

.auth-avatar.unknown {
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
  border-radius: 50%;
  overflow: hidden;
  border: 2rpx solid rgba(196, 174, 119, 0.62);
  background: #f4efe2;
}

.profile-avatar.male,
.gender-option.male .option-avatar {
  background: #e9eadf;
}

.profile-avatar.female,
.gender-option.female .option-avatar {
  background: #f0e3de;
}

.profile-avatar.unknown {
  background: #eef1eb;
}

.profile-avatar-image {
  display: block;
  width: 100%;
  height: 100%;
}

.profile-preview-copy {
  min-width: 0;
}

.profile-name {
  overflow: hidden;
  color: #183d34;
  font-size: 26rpx;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
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
</style>
