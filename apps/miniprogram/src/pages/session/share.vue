<template>
  <view class="page share-page">
    <AuthIdentityBar />

    <view class="flow-top">
      <view class="step-label">4 / 4</view>
      <view class="title">分享票</view>
      <view class="text">这张局卡已经可以发给朋友或群聊。</view>
    </view>

    <view class="ticket-card">
      <image class="ticket-bamboo" src="/static/art/bamboo-corner.png" mode="widthFix" />
      <image class="ticket-mountains" src="/static/art/ticket-landscape.png" mode="widthFix" />
      <view class="ticket-title">{{ scriptName }}</view>
      <view class="ticket-tags">{{ scriptTags }} · {{ playerCountText }}</view>

      <view class="ticket-row">
        <image class="ticket-icon" src="/static/icons/home.png" mode="aspectFit" />
        <view class="ticket-label">店家</view>
        <view class="ticket-value">{{ storeName }}</view>
      </view>
      <view class="ticket-row">
        <image class="ticket-icon" src="/static/icons/role.png" mode="aspectFit" />
        <view class="ticket-label">角色</view>
        <view class="ticket-value">{{ roleName }}</view>
      </view>
      <view class="ticket-row">
        <image class="ticket-icon" src="/static/icons/clock.png" mode="aspectFit" />
        <view class="ticket-label">时间</view>
        <view class="ticket-value">{{ startText }}</view>
      </view>

      <view class="ticket-divider"></view>

      <view class="ticket-row">
        <image class="ticket-icon" src="/static/icons/note.png" mode="aspectFit" />
        <view class="ticket-label">备注</view>
        <view class="ticket-value">{{ note }}</view>
      </view>
    </view>

    <view class="role-surface">
      <view class="section-head">
        <view>
          <view class="edit-title">角色状态</view>
          <view class="section-note">{{ roleSummaryText }}</view>
        </view>
        <view class="status-pill">可继续分享</view>
      </view>
      <view v-if="statusText" class="notice">{{ statusText }}</view>

      <view class="role-board">
        <view
          v-for="role in roleCards"
          :key="role.id"
          class="role-choice"
          :class="[
            roleGenderClass(role.roleGender),
            {
              taken: role.stateKind === 'taken',
              pending: role.pending,
              mine: role.stateKind === 'mine',
              switching: role.stateKind === 'switching'
            }
          ]"
          @tap="chooseRole(role)"
        >
          <view class="role-choice-top">
            <view class="role-choice-name">
              <text>{{ role.name }}</text>
              <text v-if="roleGenderSymbol(role.roleGender)" class="role-gender-symbol">
                {{ roleGenderSymbol(role.roleGender) }}
              </text>
              <text v-if="role.crossCast" class="cross-cast-tag">（反串）</text>
            </view>
            <view class="role-state">{{ role.stateLabel }}</view>
          </view>
          <view class="role-choice-note">{{ role.note || "角色位" }}</view>
        </view>
      </view>

      <button class="button role-action" :class="{ disabled: !pendingRole }" @click="confirmRole">
        {{ confirmButtonText }}
      </button>
    </view>

    <view class="share-actions">
      <button class="button wechat-action" open-type="share" @click="persistFlow">
        <image class="button-icon" src="/static/icons/wechat.png" mode="aspectFit" />
        <text>分享给好友或群聊</text>
      </button>
    </view>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import { dataOf, ensureLoggedIn, getCurrentUser, request } from "../../utils/api";
import {
  displayTags,
  flowToQuery,
  isCrossCast,
  isRoleSelected,
  isSameRole,
  mergeSelectedRoles,
  normalizeRoleGender,
  queryToFlow,
  readCreateFlow,
  roleGenderSymbol,
  roleOptionsFromFlow,
  writeCreateFlow
} from "../../utils/createFlow";

export default {
  components: { AuthIdentityBar },
  data() {
    return {
      store: null,
      script: null,
      role: null,
      roleOptions: [],
      selectedRoles: [],
      pendingRole: null,
      sessionId: "",
      session: {},
      currentUserId: "",
      currentUserGender: "",
      confirmedCrossCastRoleKey: "",
      statusText: "",
      startText: "",
      note: ""
    };
  },
  computed: {
    storeName() {
      if (this.session.id) {
        return this.session.store_name_snapshot || "店家待定";
      }
      return this.store?.name || "店家待定";
    },
    scriptName() {
      if (this.session.id) {
        return this.session.script_name_snapshot || "剧本待定";
      }
      return this.script?.name || "剧本待定";
    },
    scriptTags() {
      return displayTags(this.script?.type_tags);
    },
    playerCountText() {
      if (this.session.seats?.length) {
        return `${this.session.seats.length}人本`;
      }
      const count = Number(this.script?.player_count || 0);
      return count > 0 ? `${count}人本` : "人数待定";
    },
    roleName() {
      return this.roleDisplayText(this.role || this.selectedRoles[0]);
    },
    availableCount() {
      return this.roleCards.filter((role) => role.stateKind === "available").length;
    },
    mineCount() {
      return this.roleCards.filter((role) => role.stateKind === "mine").length;
    },
    switchingCount() {
      return this.roleCards.filter((role) => role.stateKind === "switching").length;
    },
    takenCount() {
      return this.roleCards.filter((role) => role.stateKind === "taken").length;
    },
    roleSummaryText() {
      return `${this.availableCount} 个可选，${this.mineCount} 个我选，${this.switchingCount} 个换选，${this.takenCount} 个已选`;
    },
    roleCards() {
      return this.roleOptions.map((role) => {
        const taken = this.session.id
          ? ["confirmed", "locked", "cancelled"].includes(role.status)
          : isRoleSelected(role, this.selectedRoles);
        const mine = this.session.id
          ? this.currentUserId &&
            Number(role.confirmedUserId) === Number(this.currentUserId)
          : this.role && isSameRole(role, this.role);
        const pending = this.pendingRole && isSameRole(role, this.pendingRole);
        const switching = pending && this.role && !isSameRole(role, this.role);
        const crossCast = (pending || mine) && isCrossCast(this.currentUserGender, role.roleGender);
        let stateKind = "available";
        if (switching) {
          stateKind = "switching";
        } else if (pending || mine) {
          stateKind = "mine";
        } else if (taken) {
          stateKind = "taken";
        } else if (role.status === "applied") {
          stateKind = "pendingReview";
        }
        return {
          ...role,
          taken,
          pending,
          mine,
          crossCast,
          stateKind,
          stateLabel: stateKind === "switching"
            ? "换选"
            : stateKind === "mine"
              ? "我选"
              : stateKind === "taken"
                ? "已选"
                : stateKind === "pendingReview"
                  ? "待审"
                  : "可选"
        };
      });
    },
    confirmButtonText() {
      if (
        this.sessionId &&
        this.role &&
        this.pendingRole &&
        !isSameRole(this.pendingRole, this.role)
      ) {
        return `换选 ${this.pendingRole.name}`;
      }
      return this.pendingRole ? `确认选择 ${this.pendingRole.name}` : "确认选择";
    }
  },
  async onLoad(options) {
    const auth = await ensureLoggedIn({
      content: "登录后可以选择角色、分享和继续上车。"
    });
    if (!auth) {
      return;
    }
    const stored = readCreateFlow();
    const currentAuth = getCurrentUser();
    this.currentUserId = currentAuth.user?.id || auth.user?.id || "";
    this.currentUserGender = currentAuth.user?.gender || auth.user?.gender || "";
    const fromQuery = queryToFlow(options);
    this.sessionId = options.id || fromQuery.sessionId || stored.sessionId || "";
    if (this.sessionId) {
      await this.loadPublishedSession(this.sessionId);
      if (options.seatId) {
        const seatRole = this.roleOptions.find(
          (role) => Number(role.seatId || role.id) === Number(options.seatId)
        );
        if (seatRole && !seatRole.taken) {
          this.pendingRole = seatRole;
        } else if (seatRole && this.role && !isSameRole(seatRole, this.role)) {
          this.statusText = `你已选择 ${this.role.name}，确认后会释放原角色。`;
        }
      }
      this.showShareMenus();
      return;
    }
    const sameScript =
      !fromQuery.script?.id || String(stored.script?.id || "") === String(fromQuery.script.id || "");
    const incomingScript = fromQuery.script?.name
      ? {
          ...(sameScript ? stored.script : {}),
          ...fromQuery.script
        }
      : stored.script;
    const localRole = stored.role && sameScript ? stored.role : null;
    const roleOptions = fromQuery.roleOptions?.length
      ? fromQuery.roleOptions
      : stored.roleOptions?.length
        ? stored.roleOptions
        : roleOptionsFromFlow({ script: incomingScript });
    const selectedRoles = mergeSelectedRoles(
      fromQuery.selectedRoles?.length ? fromQuery.selectedRoles : stored.selectedRoles || [],
      localRole ? [localRole] : []
    );
    const flow = {
      ...stored,
      store: fromQuery.store?.name ? fromQuery.store : stored.store,
      script: incomingScript,
      role: localRole,
      roleOptions,
      selectedRoles,
      startText: fromQuery.startText || stored.startText || "时间待定（协商后确认）",
      note: fromQuery.note || stored.note || "剧本迷·拼车，一起沉浸好本。"
    };
    this.store = flow.store;
    this.script = flow.script;
    this.role = flow.role;
    this.roleOptions = flow.roleOptions;
    this.selectedRoles = flow.selectedRoles;
    this.startText = flow.startText;
    this.note = flow.note;
    writeCreateFlow(flow);
    this.showShareMenus();
  },
  onShareAppMessage() {
    const flow = this.persistFlow();
    if (this.sessionId) {
      const shareCode = `s${this.sessionId}-${Date.now()}`;
      return {
        title: `${this.scriptName} · ${this.availableCount}个角色可选`,
        path: `/pages/session/share?id=${this.sessionId}&shareCode=${shareCode}&source=wechat_share`
      };
    }
    return {
      title: `${this.scriptName} · ${this.availableCount}个角色可选`,
      path: `/pages/session/share${flowToQuery(flow)}`
    };
  },
  methods: {
    currentFlow() {
      return {
        store: this.store,
        script: this.script,
        role: this.role,
        roleOptions: this.roleOptions,
        selectedRoles: this.selectedRoles,
        sessionId: this.sessionId,
        startText: this.startText,
        note: this.note
      };
    },
    persistFlow() {
      return writeCreateFlow(this.currentFlow());
    },
    async loadPublishedSession(sessionId) {
      try {
        const response = await request({ url: `/api/sessions/${sessionId}` });
        const session = dataOf(response) || {};
        this.session = session;
        this.store = {
          id: session.store_id,
          name: session.store_name_snapshot
        };
        this.script = {
          id: session.script_id,
          name: session.script_name_snapshot,
          player_count: session.seats?.length || 0
        };
        this.roleOptions = (session.seats || []).map((seat) => ({
          id: String(seat.id),
          seatId: seat.id,
          name: seat.name,
          note: seat.role_name || this.seatTypeLabel(seat.seat_type),
          roleGender: seat.role_gender || "unlimited",
          seatType: seat.seat_type,
          status: seat.status,
          confirmedUserId: seat.confirmed_user_id || ""
        }));
        this.selectedRoles = this.roleOptions.filter((role) =>
          ["confirmed", "locked"].includes(role.status)
        );
        this.role =
          this.roleOptions.find(
            (role) =>
              this.currentUserId &&
              Number(role.confirmedUserId) === Number(this.currentUserId)
          ) || null;
        this.startText = String(session.start_at || "").slice(0, 16);
        this.note = "剧本迷·拼车，一起沉浸好本。";
        writeCreateFlow({
          store: this.store,
          script: this.script,
          role: this.role,
          roleOptions: this.roleOptions,
          selectedRoles: this.selectedRoles,
          sessionId,
          startAt: session.start_at,
          startText: this.startText,
          note: this.note
        });
      } catch (error) {
        uni.showToast({ title: "车局加载失败", icon: "none" });
      }
    },
    roleKey(role) {
      return String(role?.seatId || role?.id || role?.name || "");
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
    async chooseRole(role) {
      if (role.taken && !role.mine) {
        uni.showToast({ title: "这个角色已被选择", icon: "none" });
        return;
      }
      if (role.taken && role.mine) {
        uni.showToast({ title: "这是你当前选择的角色", icon: "none" });
        return;
      }
      const confirmed = await this.confirmCrossCastRole(role);
      if (!confirmed) {
        return;
      }
      this.confirmedCrossCastRoleKey = this.roleKey(role);
      this.pendingRole = role;
      if (this.sessionId && this.role && !isSameRole(role, this.role)) {
        this.statusText = `将从 ${this.role.name} 换到 ${role.name}，确认后释放原角色。`;
      }
    },
    roleGenderSymbol,
    roleGenderClass(roleGender) {
      const gender = normalizeRoleGender(roleGender);
      return ["male", "female"].includes(gender) ? gender : "";
    },
    roleDisplayText(role) {
      if (!role?.name) {
        return "待选";
      }
      const symbol = roleGenderSymbol(role.roleGender);
      const suffix = isCrossCast(this.currentUserGender, role.roleGender) ? "（反串）" : "";
      return `${role.name}${symbol ? ` ${symbol}` : ""}${suffix}`;
    },
    async confirmRole() {
      if (!this.pendingRole) {
        uni.showToast({ title: "先选择一个可选角色", icon: "none" });
        return;
      }
      const pendingRoleKey = this.roleKey(this.pendingRole);
      if (
        isCrossCast(this.currentUserGender, this.pendingRole.roleGender) &&
        this.confirmedCrossCastRoleKey !== pendingRoleKey
      ) {
        const confirmed = await this.confirmCrossCastRole(this.pendingRole);
        if (!confirmed) {
          this.pendingRole = null;
          return;
        }
        this.confirmedCrossCastRoleKey = pendingRoleKey;
      }
      if (this.sessionId) {
        await this.claimSeat(this.pendingRole);
        return;
      }
      const previousRole = this.role;
      const rest = this.selectedRoles.filter((role) => !previousRole || !isSameRole(role, previousRole));
      this.role = this.pendingRole;
      this.selectedRoles = mergeSelectedRoles(rest, [this.pendingRole]);
      this.pendingRole = null;
      this.persistFlow();
      uni.showToast({ title: "角色已选择", icon: "none" });
    },
    async claimSeat(role) {
      this.statusText = "";
      const previousRole = this.role;
      try {
        const response = await request({
          url: `/api/session-seats/${role.seatId || role.id}/claim`,
          method: "POST",
          data: {
            note: "分享页直接选择角色"
          }
        });
        const claimedSeat = dataOf(response);
        this.role = {
          ...role,
          status: claimedSeat?.status || "confirmed",
          confirmedUserId: this.currentUserId
        };
        this.pendingRole = null;
        await this.loadPublishedSession(this.sessionId);
        this.statusText =
          previousRole && !isSameRole(previousRole, role)
            ? "角色已换选，原角色已释放。"
            : "角色已选择，可在车内聊天确认信息。";
        uni.showToast({
          title: previousRole && !isSameRole(previousRole, role) ? "角色已换选" : "角色已选择",
          icon: "none"
        });
      } catch (error) {
        if (error?.statusCode === 409) {
          const message = error?.data?.error?.message || "";
          this.statusText =
            message.includes("locked seat")
              ? `你已锁定 ${this.role?.name || "一个角色"}，暂不能换选。`
              : "这个角色刚刚被别人选走了，请换一个。";
        } else if (error?.statusCode === 401) {
          this.statusText = "请先登录后再选择角色。";
        } else {
          this.statusText = "选择失败，请稍后重试。";
        }
      }
    },
    showShareMenus() {
      if (uni.showShareMenu) {
        uni.showShareMenu({
          withShareTicket: true,
          menus: ["shareAppMessage"]
        });
      }
    },
    seatTypeLabel(type) {
      const labels = {
        love_companion: "情感沉浸位",
        f4: "互动位",
        cp: "CP位",
        normal: "普通位"
      };
      return labels[type] || "角色位";
    }
  }
};
</script>

<style scoped>
.share-page {
  padding-bottom: 54rpx;
}

.flow-top {
  display: none;
}

.step-label {
  color: #b89458;
  font-size: 24rpx;
  font-weight: 600;
}

.ticket-card {
  position: relative;
  overflow: hidden;
  min-height: 588rpx;
  padding: 54rpx 42rpx 154rpx;
  border: 1rpx solid rgba(229, 220, 201, 0.92);
  border-radius: 24rpx;
  background: rgba(255, 254, 250, 0.96);
  box-shadow: 0 28rpx 70rpx rgba(48, 61, 53, 0.12);
}

.ticket-bamboo {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 0;
  width: 190rpx;
  opacity: 0.82;
}

.ticket-mountains {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  width: 100%;
}

.ticket-title {
  position: relative;
  z-index: 1;
  color: #153f34;
  font-size: 52rpx;
  font-weight: 600;
  line-height: 1.18;
  letter-spacing: 2rpx;
}

.ticket-tags {
  position: relative;
  z-index: 1;
  display: inline-block;
  margin-top: 18rpx;
  margin-bottom: 44rpx;
  padding: 8rpx 18rpx;
  border-radius: 6rpx;
  background: rgba(231, 239, 232, 0.94);
  color: #1f6f5b;
  font-size: 23rpx;
}

.ticket-divider {
  position: relative;
  z-index: 1;
  margin: 30rpx 0 24rpx;
  border-top: 1rpx dashed rgba(216, 207, 189, 0.9);
}

.ticket-row {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 18rpx 0;
}

.ticket-icon {
  width: 34rpx;
  height: 34rpx;
}

.ticket-label {
  width: 78rpx;
  flex-shrink: 0;
  color: #777e78;
  font-size: 24rpx;
  letter-spacing: 10rpx;
}

.ticket-value {
  flex: 1;
  color: #203d35;
  font-size: 27rpx;
  line-height: 1.45;
}

.role-surface {
  margin-top: 28rpx;
  padding: 28rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.9);
  border-radius: 16rpx;
  background: rgba(255, 255, 252, 0.94);
  box-shadow: 0 16rpx 42rpx rgba(51, 69, 59, 0.05);
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24rpx;
  margin-bottom: 22rpx;
}

.section-note {
  margin-top: 8rpx;
  color: #7a857d;
  font-size: 24rpx;
}

.status-pill {
  flex-shrink: 0;
  padding: 8rpx 14rpx;
  border-radius: 6rpx;
  background: #eef5ef;
  color: #1f6f5b;
  font-size: 22rpx;
}

.role-board {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
}

.role-choice {
  min-height: 132rpx;
  padding: 22rpx 18rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.92);
  border-radius: 16rpx;
  background: rgba(255, 255, 252, 0.96);
  box-sizing: border-box;
}

.role-choice.male {
  border-color: rgba(159, 184, 178, 0.9);
  background: rgba(242, 248, 247, 0.98);
}

.role-choice.female {
  border-color: rgba(224, 195, 184, 0.9);
  background: rgba(255, 248, 245, 0.98);
}

.role-choice.pending,
.role-choice.mine,
.role-choice.switching {
  box-shadow:
    0 0 0 3rpx rgba(216, 167, 61, 0.86),
    inset 0 0 0 1rpx rgba(216, 167, 61, 0.26);
}

.role-choice.taken {
  border-color: rgba(214, 205, 188, 0.92);
  background: #f3f0e9;
  color: #8d8a82;
}

.role-choice-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.role-choice-name {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 6rpx;
  min-width: 0;
  color: #153f34;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1.25;
}

.role-gender-symbol {
  flex-shrink: 0;
  color: #8d7b55;
  font-size: 26rpx;
  font-weight: 700;
}

.role-choice.male .role-gender-symbol {
  color: #66877f;
}

.role-choice.female .role-gender-symbol {
  color: #aa7b71;
}

.cross-cast-tag {
  flex-shrink: 0;
  color: #b06b35;
  font-size: 22rpx;
  font-weight: 600;
}

.role-choice.taken .role-choice-name {
  color: #747066;
}

.role-state {
  flex-shrink: 0;
  color: #1f6f5b;
  font-size: 22rpx;
  font-weight: 600;
}

.role-choice.mine .role-state {
  padding: 2rpx 8rpx;
  border-radius: 6rpx;
  background: #1f6f5b;
  color: #ffffff;
}

.role-choice.switching .role-state {
  padding: 2rpx 8rpx;
  border-radius: 6rpx;
  background: #b89458;
  color: #ffffff;
}

.role-choice.taken .role-state {
  color: #9b8d70;
}

.role-choice-note {
  margin-top: 14rpx;
  color: #7a857d;
  font-size: 23rpx;
  line-height: 1.35;
}

.role-action {
  margin-top: 22rpx;
}

.edit-title {
  margin-bottom: 18rpx;
  color: #153f34;
  font-size: 28rpx;
  font-weight: 600;
}

.share-actions {
  margin-top: 28rpx;
}

.wechat-action {
  width: 100%;
}
</style>
