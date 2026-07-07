<template>
  <view class="page flow-page">
    <AuthIdentityBar />
    <FeedbackHost />

    <view class="flow-top">
      <view class="step-label">3 / 5</view>
      <view class="title">选择角色</view>
      <view class="text">{{ scriptName }} 的角色列表，选你想玩的那一个。</view>
    </view>

    <RoleSeatBoard
      :surface="false"
      :items="roleCards"
      empty-text="暂无角色。"
      @itemtap="handleRoleTap"
    />

    <view class="bottom-action">
      <t-button class="button" :class="{ disabled: !selectedRole }" @tap="goNext">下一步</t-button>
    </view>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import RoleSeatBoard from "../../components/RoleSeatBoard.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import { AUTH_CHANGE_EVENT, getCurrentUser } from "../../utils/api";
import {
  isCrossCast,
  readCreateFlow,
  roleOptionsFromScript,
  writeCreateFlow
} from "../../utils/createFlow";
import { showModal, showToast } from "../../utils/tdesignFeedback";

export default {
  components: { AuthIdentityBar, RoleSeatBoard, FeedbackHost },
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
    },
    roleCards() {
      return this.roleOptions.map((role) => {
        const selected = this.isSelectedRole(role);
        return {
          ...role,
          note: role.note || "角色位",
          checked: selected,
          selected,
          crossCast: this.isSelectedCrossCast(role),
          stateKind: selected ? "mine" : "available",
          stateLabel: selected ? "我选" : "可选"
        };
      });
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
    confirmCrossCastRole(role) {
      if (!isCrossCast(this.currentUserGender, role.roleGender)) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        showModal({
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
    async handleRoleTap(payload) {
      await this.selectRole(payload.item);
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
        showToast({ title: "先选择一个角色", icon: "none" });
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

</style>
