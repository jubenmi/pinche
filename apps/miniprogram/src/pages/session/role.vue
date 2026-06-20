<template>
  <view class="page flow-page">
    <AuthIdentityBar />

    <view class="flow-top">
      <view class="step-label">3 / 5</view>
      <view class="title">选择角色</view>
      <view class="text">{{ scriptName }} 的角色列表，选你想玩的那一个。</view>
    </view>

    <view class="role-grid">
      <view
        v-for="role in roleOptions"
        :key="role.id"
        class="role-tile"
        :class="[roleGenderClass(role.roleGender), { selected: isSelectedRole(role) }]"
        @tap="selectRole(role)"
      >
        <view class="role-name">
          <text>{{ role.name }}</text>
          <text v-if="roleGenderSymbol(role.roleGender)" class="role-gender-symbol">
            {{ roleGenderSymbol(role.roleGender) }}
          </text>
          <text v-if="isSelectedCrossCast(role)" class="cross-cast-tag">（反串）</text>
        </view>
        <view class="role-note">{{ role.note }}</view>
        <image
          v-if="isSelectedRole(role)"
          class="role-check"
          src="/static/icons/check.png"
          mode="aspectFit"
        />
      </view>
    </view>

    <view class="bottom-action">
      <button class="button" :class="{ disabled: !selectedRole }" @click="goNext">下一步</button>
    </view>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import { AUTH_CHANGE_EVENT, getCurrentUser } from "../../utils/api";
import {
  isCrossCast,
  normalizeRoleGender,
  readCreateFlow,
  roleGenderSymbol,
  roleOptionsFromScript,
  writeCreateFlow
} from "../../utils/createFlow";

export default {
  components: { AuthIdentityBar },
  data() {
    return {
      store: null,
      script: null,
      roleOptions: [],
      selectedRole: null,
      currentUserGender: ""
    };
  },
  computed: {
    storeName() {
      return this.store?.name || "店家待定";
    },
    scriptName() {
      return this.script?.name || "剧本待定";
    }
  },
  onLoad() {
    this.bindAuthChangeListener();
    this.refreshCurrentUserGender();
    const flow = readCreateFlow();
    this.store = flow.store || null;
    this.script = flow.script || {
      id: "draft-script",
      name: "剧本待定",
      player_count: 6,
      default_seat_template_json:
        "[{\"name\":\"角色1\"},{\"name\":\"角色2\"},{\"name\":\"角色3\"},{\"name\":\"角色4\"},{\"name\":\"角色5\"},{\"name\":\"角色6\"}]"
    };
    this.roleOptions = roleOptionsFromScript(this.script);
  },
  onUnload() {
    this.unbindAuthChangeListener();
  },
  methods: {
    roleGenderSymbol,
    bindAuthChangeListener() {
      if (typeof uni.$on === "function") {
        uni.$on(AUTH_CHANGE_EVENT, this.refreshCurrentUserGender);
      }
    },
    unbindAuthChangeListener() {
      if (typeof uni.$off === "function") {
        uni.$off(AUTH_CHANGE_EVENT, this.refreshCurrentUserGender);
      }
    },
    refreshCurrentUserGender(auth = null) {
      const currentAuth = auth?.user ? auth : getCurrentUser();
      this.currentUserGender = currentAuth.user?.gender || "";
    },
    roleGenderClass(roleGender) {
      const gender = normalizeRoleGender(roleGender);
      return ["male", "female"].includes(gender) ? gender : "";
    },
    confirmCrossCastRole(role) {
      if (!isCrossCast(this.currentUserGender, role.roleGender)) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        uni.showModal({
          title: "确认反串",
          content: "反串可能会影响游戏体验，是否确认",
          confirmText: "确认",
          cancelText: "取消",
          success(result) {
            resolve(Boolean(result.confirm));
          },
          fail() {
            resolve(false);
          }
        });
      });
    },
    async selectRole(role) {
      if (this.isSelectedRole(role)) {
        await this.goNext();
        return;
      }
      const confirmed = await this.confirmCrossCastRole(role);
      if (!confirmed) {
        return;
      }
      this.selectedRole = role;
      writeCreateFlow({ role });
    },
    isSelectedRole(role) {
      return (
        this.selectedRole &&
        String(this.selectedRole.id) === String(role.id)
      );
    },
    isSelectedCrossCast(role) {
      return this.isSelectedRole(role) && isCrossCast(this.currentUserGender, role.roleGender);
    },
    async goNext() {
      if (!this.selectedRole) {
        uni.showToast({ title: "先选择一个角色", icon: "none" });
        return;
      }
      writeCreateFlow({
        store: this.store,
        script: this.script,
        role: this.selectedRole,
        roleOptions: this.roleOptions,
        selectedRoles: [this.selectedRole]
      });
      uni.navigateTo({ url: "/pages/session/setup" });
    }
  }
};
</script>

<style scoped>
.flow-page {
  padding-bottom: 150rpx;
}

.flow-top {
  display: none;
}

.step-label {
  color: #b89458;
  font-size: 24rpx;
  font-weight: 600;
}

.role-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20rpx;
}

.role-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 164rpx;
  padding: 28rpx 20rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.92);
  border-radius: 16rpx;
  background: rgba(255, 255, 252, 0.94);
  box-sizing: border-box;
  box-shadow: 0 12rpx 32rpx rgba(51, 69, 59, 0.04);
}

.role-tile.male {
  border-color: rgba(159, 184, 178, 0.9);
  background: rgba(242, 248, 247, 0.98);
}

.role-tile.female {
  border-color: rgba(224, 195, 184, 0.9);
  background: rgba(255, 248, 245, 0.98);
}

.role-tile.selected {
  box-shadow:
    0 0 0 3rpx rgba(216, 167, 61, 0.86),
    inset 0 0 0 1rpx rgba(216, 167, 61, 0.26);
}

.role-name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8rpx;
  min-width: 0;
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1.3;
}

.role-gender-symbol {
  flex-shrink: 0;
  color: #8d7b55;
  font-size: 28rpx;
  font-weight: 700;
}

.role-tile.male .role-gender-symbol {
  color: #66877f;
}

.role-tile.female .role-gender-symbol {
  color: #aa7b71;
}

.cross-cast-tag {
  flex-shrink: 0;
  color: #b06b35;
  font-size: 22rpx;
  font-weight: 600;
}

.role-note {
  margin-top: 14rpx;
  color: #7a857d;
  font-size: 23rpx;
  line-height: 1.35;
}

.role-check {
  position: absolute;
  right: 18rpx;
  bottom: 16rpx;
  width: 34rpx;
  height: 34rpx;
}

</style>
