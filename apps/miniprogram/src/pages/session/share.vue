<template>
  <view class="page share-page">
    <AuthIdentityBar />
    <FeedbackHost />

    <view class="flow-top">
      <view class="step-label">4 / 4</view>
      <view class="title">{{ pageTitle }}</view>
      <view class="text">{{ pageIntro }}</view>
    </view>

    <view class="ticket-card">
      <t-image class="ticket-bamboo" src="/static/art/bamboo-corner.png" mode="widthFix" />
      <t-image
        class="ticket-mountains"
        src="/static/art/ticket-landscape.jpg"
        mode="aspectFill"
        width="100%"
        height="72rpx"
        custom-style="width: 100%; height: 72rpx;"
      />
      <view class="ticket-title">{{ scriptName }}</view>
      <t-tag class="ticket-tags" theme="primary" variant="light" size="small">
        {{ scriptTags }} · {{ playerCountText }}
      </t-tag>

      <view class="ticket-row">
        <t-image class="ticket-icon" src="/static/icons/home.png" mode="aspectFit" />
        <view class="ticket-label">店家</view>
        <view class="ticket-value">{{ storeName }}</view>
      </view>
      <view class="ticket-row">
        <t-image class="ticket-icon" src="/static/icons/role.png" mode="aspectFit" />
        <view class="ticket-label">角色</view>
        <view class="ticket-value">{{ roleName }}</view>
      </view>
      <view class="ticket-row">
        <t-image class="ticket-icon" src="/static/icons/clock.png" mode="aspectFit" />
        <view class="ticket-label">时间</view>
        <view class="ticket-value">{{ startText }}</view>
      </view>

      <view class="ticket-divider"></view>

      <view class="ticket-row">
        <t-image class="ticket-icon" src="/static/icons/note.png" mode="aspectFit" />
        <view class="ticket-label">备注</view>
        <view class="ticket-value">{{ note }}</view>
      </view>
    </view>

    <view class="share-role-board">
      <RoleSeatBoard
        :sections="roleSeatSections"
        :empty-text="isClaimMode ? '暂无待认领角色。' : '暂无可选角色。'"
        @itemtap="handleSharedRoleTap"
      />
    </view>

    <view v-if="sessionLoadError" class="session-load-error">
      <text class="session-load-error-text">{{ sessionLoadError }}</text>
      <button
        class="session-load-retry"
        :disabled="sessionLoading"
        @tap="retryLoadSession"
      >
        重新加载
      </button>
    </view>

    <view v-else class="share-actions">
      <button
        v-if="showInviteRetry"
        class="button wechat-action"
        :disabled="invitePreparing"
        @tap="retryPrepareInvite"
      >
        <view class="wechat-action-content">
          <t-image
            class="button-icon"
            src="/static/icons/share-light.svg"
            mode="aspectFit"
            width="48rpx"
            height="48rpx"
            custom-style="width: 48rpx; height: 48rpx; opacity: 0.82;"
          />
          <text>重新准备分享</text>
        </view>
      </button>
      <button
        v-else
        class="button wechat-action"
        open-type="share"
        :disabled="!shareReady"
        @tap="persistFlow"
      >
        <view class="wechat-action-content">
          <t-image
            class="button-icon"
            src="/static/icons/share-light.svg"
            mode="aspectFit"
            width="48rpx"
            height="48rpx"
            custom-style="width: 48rpx; height: 48rpx; opacity: 0.82;"
          />
          <text>{{ shareReady ? shareButtonText : "分享准备中…" }}</text>
        </view>
      </button>
    </view>
  </view>
</template>

<script>
import { formatBeijingDateTime } from "@pinche/shared";
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import RoleSeatBoard from "../../components/RoleSeatBoard.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import {
  AUTH_CHANGE_EVENT,
  dataOf,
  ensureLoggedIn,
  getCurrentUser,
  getToken,
  request
} from "../../utils/api";
import {
  displayTags,
  flowToQuery,
  isCrossCast,
  isRoleSelected,
  isSameRole,
  mergeSelectedRoles,
  queryToFlow,
  readCreateFlow,
  roleGenderSymbol,
  roleOptionsFromFlow,
  writeCreateFlow
} from "../../utils/createFlow";
import { showWechatShareMenus } from "../../utils/share";
import {
  buildSessionSharePayload,
  resolveSessionShareMode,
  sessionSharePresentation
} from "../../utils/sessionShare";
import {
  isConfirmedSessionMember,
  requestSubscriptionAfterConfirmedJoin
} from "../../utils/sessionMembership";
import {
  requestSessionRescheduledSubscription,
  requestSignupReviewedSubscription
} from "../../utils/subscribeMessages";
import { showModal, showToast } from "../../utils/tdesignFeedback";

export default {
  components: { AuthIdentityBar, RoleSeatBoard, FeedbackHost },
  data() {
    return {
      store: null,
      script: null,
      role: null,
      roleOptions: [],
      selectedRoles: [],
      pendingRole: null,
      entry: "",
      sessionId: "",
      inviteToken: "",
      session: {},
      sessionLoadError: "",
      sessionLoading: false,
      sessionLoaded: false,
      sessionLoadSerial: 0,
      sessionLoadPromise: null,
      invitePreparing: false,
      invitePrepareError: false,
      navigatingAlbum: false,
      currentUserId: "",
      currentUserGender: "",
      confirmedCrossCastRoleKey: "",
      roleSelectionSubmitting: false,
      statusText: "",
      startText: "",
      note: ""
    };
  },
  computed: {
    shareMode() {
      return resolveSessionShareMode(this.session);
    },
    sharePresentation() {
      return sessionSharePresentation(this.shareMode);
    },
    pageTitle() {
      return this.sharePresentation.pageTitle;
    },
    pageIntro() {
      return this.sharePresentation.pageIntro;
    },
    shareButtonText() {
      return this.sharePresentation.buttonText;
    },
    shareReady() {
      if (!this.sessionId) {
        return !this.sessionLoadError;
      }
      return Boolean(
        !this.sessionLoading &&
        this.sessionLoaded &&
        String(this.session.id || "") === String(this.sessionId) &&
        this.inviteToken &&
        !this.sessionLoadError
      );
    },
    showInviteRetry() {
      return Boolean(
        this.sessionId &&
        this.sessionLoaded &&
        !this.sessionLoading &&
        this.session.access_scope === "member" &&
        !this.inviteToken &&
        !this.invitePreparing &&
        this.invitePrepareError &&
        !this.sessionLoadError
      );
    },
    isClaimMode() {
      return this.shareMode === "claim";
    },
    statusPillText() {
      if (this.isClaimMode) {
        return "照片角色待认领";
      }
      return this.session.join_policy === "direct" ? "可直接上车" : "需车头审核";
    },
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
      if (this.role) {
        return this.roleDisplayText(this.role);
      }
      if (this.currentUserNpcRole) {
        return `NPC：${this.roleDisplayText({
          name: this.currentUserNpcRole.name,
          roleGender: this.currentUserNpcRole.role_gender || "unlimited"
        })}`;
      }
      return this.roleDisplayText(this.selectedRoles[0]);
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
      if (this.isClaimMode) {
        return `${this.availableCount} 个待认领，${this.mineCount} 个我认领，${this.switchingCount} 个换认领，${this.takenCount} 个已认领`;
      }
      return `${this.availableCount} 个可选，${this.mineCount} 个我选，${this.switchingCount} 个换选，${this.takenCount} 个已选`;
    },
    roleCards() {
      return this.roleOptions.map((role) => {
        const occupied = this.session.id
          ? ["confirmed", "locked", "cancelled"].includes(role.status)
          : isRoleSelected(role, this.selectedRoles);
        const mine = this.session.id
          ? this.currentUserId &&
            Number(role.confirmedUserId) === Number(this.currentUserId)
          : this.role && isSameRole(role, this.role);
        const claimable = this.isRoleClaimable(role, mine);
        const pending = this.pendingRole && isSameRole(role, this.pendingRole);
        const switching = pending && this.role && !isSameRole(role, this.role);
        const crossCast = (pending || mine) && isCrossCast(this.currentUserGender, role.roleGender);
        let stateKind = "available";
        if (switching) {
          stateKind = "switching";
        } else if (pending || mine) {
          stateKind = "mine";
        } else if (occupied) {
          stateKind = "taken";
        } else if (role.status === "applied") {
          stateKind = "pendingReview";
        } else if (!claimable) {
          stateKind = "unavailable";
        }
        return {
          ...role,
          taken: occupied,
          claimable,
          pending,
          mine,
          crossCast,
          note: this.roleOccupantDisplayName(role),
          avatarUrl: this.roleOccupantAvatarUrl(role),
          avatarGender: this.roleOccupantGender(role),
          ownerGender: this.roleOccupantGender(role),
          boardType: "seat",
          stateKind,
          stateLabel: this.roleStateLabel(stateKind)
        };
      });
    },
    npcSelfJoinEnabled() {
      return this.session.npc_join_enabled === undefined
        ? true
        : Boolean(this.session.npc_join_enabled);
    },
    joinRequiresPhone() {
      const value = this.session.join_phone_required;
      if (value === undefined || value === null || value === "") {
        return true;
      }
      if (typeof value === "boolean") {
        return value;
      }
      return ["1", "true", "required", "enabled"].includes(String(value).trim().toLowerCase());
    },
    currentUserNpcRole() {
      if (!this.currentUserId) {
        return null;
      }
      return (this.session.session_npc_roles || []).find(
        (role) => Number(role.bound_user_id || 0) === Number(this.currentUserId)
      ) || null;
    },
    currentUserEffectiveNpcRole() {
      if (!this.currentUserId || this.role) {
        return null;
      }
      return (this.session.session_npc_roles || [])
        .filter((role) => (role.status || "active") === "active")
        .find((role) => {
          const boundUserId = Number(role.bound_user_id || 0);
          const pendingUserId = Number(role.pending_signup_user_id || 0);
          return (
            boundUserId === Number(this.currentUserId) ||
            pendingUserId === Number(this.currentUserId)
          );
        }) || null;
    },
    npcRoleCards() {
      const effectiveCurrentNpcRole = this.currentUserEffectiveNpcRole;
      return (this.session.session_npc_roles || [])
        .filter((role) => (role.status || "active") === "active")
        .map((role) => {
          const boundUserId = Number(role.bound_user_id || 0);
          const pendingUserId = Number(role.pending_signup_user_id || 0);
          const boundByCurrentUser = this.currentUserId && boundUserId === Number(this.currentUserId);
          const pendingByCurrentUser = this.currentUserId && pendingUserId === Number(this.currentUserId);
          const effectiveRoleId = Number(effectiveCurrentNpcRole?.id || 0);
          const mine = boundByCurrentUser && effectiveRoleId === Number(role.id);
          const pendingMine = pendingByCurrentUser && effectiveRoleId === Number(role.id);
          const duplicateCurrentUserNpcRole = boundByCurrentUser && !mine;
          const duplicateCurrentUserPendingNpcRole = pendingByCurrentUser && !pendingMine;
          const effectiveBoundUserId = duplicateCurrentUserNpcRole ? 0 : boundUserId;
          const effectivePendingUserId = duplicateCurrentUserPendingNpcRole ? 0 : pendingUserId;
          const taken = effectiveBoundUserId > 0 || effectivePendingUserId > 0;
          const displayRole =
            duplicateCurrentUserNpcRole || duplicateCurrentUserPendingNpcRole
              ? {
                  ...role,
                  bound_user_name: "",
                  bound_user_avatar_url: "",
                  bound_user_gender: "",
                  pending_signup_user_name: "",
                  pending_signup_user_avatar_url: "",
                  pending_signup_user_gender: ""
                }
              : role;
          let stateKind = "available";
          if (mine) {
            stateKind = "mine";
          } else if (pendingMine) {
            stateKind = "pendingReview";
          } else if (taken) {
            stateKind = "taken";
          } else if (!this.npcSelfJoinEnabled) {
            stateKind = "unavailable";
          }
          return {
            id: role.id,
            name: role.name || "NPC角色",
            note: this.npcRoleOccupantDisplayName(displayRole, mine, pendingMine),
            roleGender: role.role_gender || "unlimited",
            genderSymbol: roleGenderSymbol(role.role_gender || "unlimited") || "不限",
            showGenderSymbol: true,
            avatarUrl: this.npcRoleOccupantAvatarUrl(displayRole, mine, pendingMine),
            avatarGender: this.npcRoleOccupantGender(displayRole, mine, pendingMine),
            ownerGender: this.npcRoleOccupantGender(displayRole, mine, pendingMine),
            crossCast: (mine || pendingMine) && isCrossCast(this.currentUserGender, role.role_gender),
            pendingSignupId: duplicateCurrentUserPendingNpcRole ? null : role.pending_signup_id || null,
            pendingUserId: effectivePendingUserId,
            boundUserId: effectiveBoundUserId,
            claimable: stateKind === "available",
            mine,
            boardType: "npc",
            stateKind,
            stateLabel: this.roleStateLabel(stateKind)
          };
        });
    },
    roleSeatSections() {
      const sections = [
        {
          key: "seat",
          title: "角色状态",
          summary: this.roleSummaryText,
          statusPill: this.statusPillText,
          notice: this.statusText,
          items: this.roleCards
        }
      ];
      if (this.npcRoleCards.length) {
        sections.push({
          key: "npc",
          title: "NPC角色",
          summary: this.npcSelfJoinEnabled
            ? this.isClaimMode
              ? "工作人员可认领自己的NPC角色"
              : "工作人员可选择自己的NPC角色"
            : "本场NPC由车头安排",
          items: this.npcRoleCards
        });
      }
      return sections;
    },
  },
  async onLoad(options) {
    const stored = readCreateFlow();
    const currentAuth = getCurrentUser();
    this.currentUserId = currentAuth.user?.id || "";
    this.bindAuthChangeListener();
    this.refreshCurrentUserGender(currentAuth);
    const fromQuery = queryToFlow(options);
    this.entry = options.entry || "";
    this.sessionId = options.id || fromQuery.sessionId || stored.sessionId || "";
    this.inviteToken = options.inviteToken || "";
    if (this.sessionId) {
      await this.loadPublishedSession(this.sessionId);
      if (options.seatId) {
        const seatRole = this.roleOptions.find(
          (role) => Number(role.seatId || role.id) === Number(options.seatId)
        );
        if (seatRole && this.currentUserId && !seatRole.taken && this.isRoleClaimable(seatRole)) {
          this.pendingRole = seatRole;
        } else if (seatRole && this.role && !isSameRole(seatRole, this.role)) {
          this.statusText = this.isClaimMode
            ? `你已认领 ${this.role.name}，确认后会释放原角色。`
            : `你已选择 ${this.role.name}，确认后会释放原角色。`;
        }
      }
      await this.prepareJoinInviteToken();
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
  onUnload() {
    this.unbindAuthChangeListener();
  },
  onShareAppMessage() {
    const flow = this.persistFlow();
    if (this.sessionId) {
      const payload = buildSessionSharePayload({
        sessionId: this.sessionId,
        inviteToken: this.inviteToken,
        shareCode: `s${this.sessionId}-${Date.now()}`,
        scriptName: this.scriptName,
        mode: this.shareMode
      });
      if (!this.shareReady || !payload) {
        showToast({ title: "分享尚未准备好，请稍后重试", icon: "none" });
        return undefined;
      }
      return payload;
    }
    return {
      title: this.shareCardTitle(),
      path: `/pages/session/share${flowToQuery(flow)}`,
      imageUrl: "/static/art/ticket-landscape.jpg"
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
        entry: this.entry,
        sessionId: this.sessionId,
        startText: this.startText,
        note: this.note
      };
    },
    persistFlow() {
      return writeCreateFlow(this.currentFlow());
    },
    shareCardTitle() {
      return `${this.scriptName}｜${this.storeName}｜${this.startText}`;
    },
    selectionCopy() {
      if (this.isClaimMode) {
        return {
          phoneTitle: "授权手机号后认领",
          phoneContent: "认领角色前需要授权手机号，便于核对本局玩家。",
          directNote: "相册认领页认领角色",
          success: "角色已认领",
          conflict: "这个角色已被认领"
        };
      }
      return {
        phoneTitle: "授权手机号后上车",
        phoneContent: "上车前需要授权手机号，方便车头沟通和审核。",
        directNote: "分享页选择角色上车",
        success: "已上车",
        conflict: "这个角色已被选择"
      };
    },
    roleStateLabel(stateKind) {
      if (this.isClaimMode) {
        const labels = {
          mine: "我认领",
          taken: "已认领",
          pendingReview: "待确认",
          unavailable: "不可认领",
          available: "待认领",
          switching: "换认领"
        };
        return labels[stateKind] || "";
      }
      const labels = {
        mine: "",
        taken: "已选",
        pendingReview: "待审",
        unavailable: "不可选",
        available: "可选",
        switching: "换选"
      };
      return labels[stateKind] || "";
    },
    hasSeatSelectionLogin() {
      const auth = getCurrentUser();
      return Boolean(auth.user && getToken());
    },
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
      this.currentUserId = currentAuth.user?.id || "";
      const nextGender = currentAuth.user?.gender || "";
      if (nextGender !== this.currentUserGender) {
        this.confirmedCrossCastRoleKey = "";
      }
      this.currentUserGender = nextGender;
      this.clearSeatSelectionWhenLoggedOut();
    },
    clearSeatSelectionWhenLoggedOut() {
      if (this.currentUserId) {
        return;
      }
      this.pendingRole = null;
      this.confirmedCrossCastRoleKey = "";
    },
    roleOccupantAvatarUrl(role) {
      const auth = getCurrentUser();
      const currentUserSelected =
        this.currentUserId &&
        (Number(role.confirmedUserId || 0) === Number(this.currentUserId) ||
          (this.pendingRole && isSameRole(role, this.pendingRole)));
      if (currentUserSelected && auth.user?.avatarUrl) {
        return auth.user.avatarUrl;
      }
      return role.confirmedUserAvatarUrl || "";
    },
    roleOccupantGender(role) {
      const currentUserSelected =
        this.currentUserId &&
        (Number(role.confirmedUserId || 0) === Number(this.currentUserId) ||
          (this.pendingRole && isSameRole(role, this.pendingRole)));
      if (currentUserSelected && this.currentUserGender) {
        return this.currentUserGender;
      }
      return role.confirmedUserGender || role.roleGender || "unlimited";
    },
    roleOccupantDisplayName(role) {
      const auth = getCurrentUser();
      const currentUserSelected =
        this.currentUserId &&
        (Number(role.confirmedUserId || 0) === Number(this.currentUserId) ||
          (this.pendingRole && isSameRole(role, this.pendingRole)));
      if (currentUserSelected) {
        return auth.user?.nickname || auth.user?.open_id || auth.user?.openid || "";
      }
      return role.confirmedUserName || "";
    },
    npcRoleOccupantDisplayName(role, mine = false, pendingMine = false) {
      const auth = getCurrentUser();
      if (mine || pendingMine) {
        return auth.user?.nickname || auth.user?.open_id || auth.user?.openid || "";
      }
      return role.bound_user_name || role.pending_signup_user_name || role.description || "";
    },
    npcRoleOccupantAvatarUrl(role, mine = false, pendingMine = false) {
      const auth = getCurrentUser();
      if ((mine || pendingMine) && auth.user?.avatarUrl) {
        return auth.user.avatarUrl;
      }
      return role.bound_user_avatar_url || role.pending_signup_user_avatar_url || "";
    },
    npcRoleOccupantGender(role, mine = false, pendingMine = false) {
      if ((mine || pendingMine) && this.currentUserGender) {
        return this.currentUserGender;
      }
      return role.bound_user_gender || role.pending_signup_user_gender || role.role_gender || "unlimited";
    },
    async ensureSeatSelectionLogin(options = {}) {
      const wasLoggedIn = this.hasSeatSelectionLogin();
      const auth = await ensureLoggedIn({
        content: this.isClaimMode
          ? "登录后可以认领自己玩过的角色。"
          : "登录后可以选择角色并锁定你的位置。",
        ...options
      });
      if (!auth?.user) {
        this.statusText = this.isClaimMode
          ? "登录后可继续认领角色。"
          : "登录后可继续选择角色。";
        return null;
      }
      this.currentUserId = auth.user.id || "";
      this.refreshCurrentUserGender(auth);
      if (options.refreshAfterFreshLogin === true && !wasLoggedIn) {
        if (this.sessionId) {
          await this.loadPublishedSession(this.sessionId);
        }
      }
      return auth;
    },
    loadPublishedSession(sessionId) {
      if (this.sessionLoading && this.sessionLoadPromise) {
        return this.sessionLoadPromise;
      }
      const serial = this.sessionLoadSerial + 1;
      this.sessionLoadSerial = serial;
      this.sessionLoading = true;
      this.sessionLoaded = false;
      this.sessionLoadError = "";
      this.statusText = "";
      const loadPromise = this.performPublishedSessionLoad(sessionId, serial);
      this.sessionLoadPromise = loadPromise;
      return loadPromise;
    },
    async performPublishedSessionLoad(sessionId, serial) {
      try {
        const inviteQuery = this.inviteToken
          ? `?inviteToken=${encodeURIComponent(this.inviteToken)}`
          : "";
        const response = await request({ url: `/api/sessions/${sessionId}${inviteQuery}` });
        if (serial !== this.sessionLoadSerial) {
          return false;
        }
        const session = dataOf(response) || {};
        if (String(session.id || "") !== String(sessionId)) {
          throw new Error("session response mismatch");
        }
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
          note: "",
          roleGender: seat.role_gender || "unlimited",
          seatType: seat.seat_type,
          status: seat.status,
          confirmedUserId: seat.confirmed_user_id || "",
          confirmedUserName: seat.confirmed_user_nickname || seat.confirmed_user_open_id || "",
          confirmedUserAvatarUrl: seat.confirmed_user_avatar_url || "",
          confirmedUserGender: seat.confirmed_user_gender || ""
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
        this.startText = formatBeijingDateTime(session.start_at);
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
        this.updateNavigationBarTitle();
        if (!this.role && !this.currentUserNpcRole && !this.statusText) {
          this.statusText =
            this.isClaimMode
              ? "请选择自己玩过的角色完成认领。"
              : this.session.join_policy === "direct"
                ? "选择角色后将直接加入本局。"
                : "选择角色提交申请，等待车头审核。";
        }
        this.sessionLoaded = true;
        return true;
      } catch (error) {
        if (serial !== this.sessionLoadSerial) {
          return false;
        }
        this.sessionLoaded = false;
        this.sessionLoadError = "车局加载失败，请重试";
        showToast({ title: this.sessionLoadError, icon: "none" });
        return false;
      } finally {
        if (serial === this.sessionLoadSerial) {
          this.sessionLoading = false;
          this.sessionLoadPromise = null;
        }
      }
    },
    async prepareJoinInviteToken() {
      if (
        this.invitePreparing ||
        this.inviteToken ||
        !this.sessionId ||
        this.sessionLoading ||
        !this.sessionLoaded ||
        String(this.session.id || "") !== String(this.sessionId) ||
        this.session.access_scope !== "member"
      ) {
        return;
      }
      this.invitePreparing = true;
      this.invitePrepareError = false;
      try {
        const response = await request({
          url: `/api/sessions/${this.sessionId}/join-invite-token`,
          method: "POST",
          data: {}
        });
        this.inviteToken = dataOf(response)?.token || "";
        if (!this.inviteToken) {
          this.invitePrepareError = true;
          this.statusText = "分享准备失败，请重试。";
        }
      } catch (error) {
        this.inviteToken = "";
        this.invitePrepareError = true;
        this.statusText = "分享准备失败，请重试。";
      } finally {
        this.invitePreparing = false;
      }
    },
    async retryPrepareInvite() {
      if (this.invitePreparing) {
        return;
      }
      this.invitePrepareError = false;
      this.statusText = "";
      await this.prepareJoinInviteToken();
      if (this.inviteToken) {
        this.invitePrepareError = false;
        this.statusText = "";
      }
    },
    async retryLoadSession() {
      if (!this.sessionId || this.sessionLoading) {
        return;
      }
      const loaded = await this.loadPublishedSession(this.sessionId);
      if (loaded) {
        await this.prepareJoinInviteToken();
      }
    },
    updateNavigationBarTitle() {
      if (typeof uni !== "undefined" && typeof uni.setNavigationBarTitle === "function") {
        uni.setNavigationBarTitle({ title: this.pageTitle });
      }
    },
    openAlbumAfterClaim(wasConfirmedMember = false) {
      if (
        !this.isClaimMode ||
        wasConfirmedMember ||
        !this.sessionId ||
        this.navigatingAlbum
      ) {
        return false;
      }
      const rawPhotoCount =
        this.session.active_album_photo_count ?? this.session.photo_count ?? 0;
      const photoCount = Number(rawPhotoCount);
      if (!Number.isFinite(photoCount) || photoCount <= 0) {
        this.statusText = "角色已认领，照片上传后即可查看。";
        return false;
      }
      this.navigatingAlbum = true;
      uni.redirectTo({
        url: `/pages/session/album?id=${this.sessionId}`,
        fail: () => {
          this.navigatingAlbum = false;
        }
      });
      return true;
    },
    roleKey(role) {
      return String(role?.seatId || role?.id || role?.name || "");
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
    currentSelectionForSwitch(role) {
      if (!this.sessionId) {
        return null;
      }
      if (role.boardType === "npc") {
        if (role.mine) {
          return null;
        }
        if (this.role) {
          return this.role;
        }
        const currentNpcRole = this.currentUserNpcRole;
        if (currentNpcRole && Number(currentNpcRole.id) !== Number(role.id)) {
          return {
            boardType: "npc",
            id: currentNpcRole.id,
            name: `NPC：${currentNpcRole.name || "NPC角色"}`,
            roleGender: currentNpcRole.role_gender || "unlimited"
          };
        }
        return null;
      }
      if (this.role) {
        return isSameRole(role, this.role) ? null : this.role;
      }
      const currentNpcRole = this.currentUserNpcRole;
      if (!currentNpcRole) {
        return null;
      }
      return {
        boardType: "npc",
        id: currentNpcRole.id,
        name: `NPC：${currentNpcRole.name || "NPC角色"}`,
        roleGender: currentNpcRole.role_gender || "unlimited"
      };
    },
    confirmSwitchRole(role) {
      const currentRole = this.currentSelectionForSwitch(role);
      if (!this.sessionId || !currentRole) {
        return Promise.resolve(true);
      }
      const currentRoleName = currentRole.name || "当前角色";
      const nextRoleName = role.name || "新角色";
      const actionText = this.isClaimMode ? "换认领" : "换选";
      return new Promise((resolve) => {
        showModal({
          title: `确认${actionText}`,
          content: `将从 ${currentRoleName} 换到 ${nextRoleName}，原角色会释放，是否继续？`,
          confirmText: actionText,
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
      if (this.roleSelectionSubmitting) {
        return;
      }
      const selectedRoleKey = this.roleKey(role);
      const auth = await this.ensureSeatSelectionLogin({
        refreshAfterFreshLogin: true
      });
      if (!auth) {
        return;
      }
      const targetRole =
        this.sessionId
          ? this.roleCards.find((item) => this.roleKey(item) === selectedRoleKey) || role
          : role;
      const copy = this.selectionCopy();
      if (targetRole.taken && !targetRole.mine) {
        showToast({ title: copy.conflict, icon: "none" });
        return;
      }
      if (!targetRole.claimable && !targetRole.mine) {
        showToast({
          title: this.isClaimMode ? "这个角色暂不可认领" : "这个角色暂不可选择",
          icon: "none"
        });
        return;
      }
      if (targetRole.taken && targetRole.mine) {
        showToast({
          title: this.isClaimMode ? "这是你已认领的角色" : "这是你当前选择的角色",
          icon: "none"
        });
        return;
      }
      this.roleSelectionSubmitting = true;
      try {
        const switchConfirmed = await this.confirmSwitchRole(targetRole);
        if (!switchConfirmed) {
          return;
        }
        const confirmed = await this.confirmCrossCastRole(targetRole);
        if (!confirmed) {
          return;
        }
        this.confirmedCrossCastRoleKey = this.roleKey(targetRole);
        await this.confirmRole(targetRole, {
          revealPending: !this.sessionId
        });
      } finally {
        this.roleSelectionSubmitting = false;
      }
    },
    handleSharedRoleTap(payload) {
      const role = payload.item;
      if (role.boardType === "npc" || payload.sectionKey === "npc") {
        this.chooseNpcRole(role);
        return;
      }
      this.chooseRole(role);
    },
    isSessionStarted() {
      if (!this.session.start_at) {
        return false;
      }
      const startAt = Date.parse(String(this.session.start_at).replace(" ", "T"));
      return Number.isFinite(startAt) && startAt <= Date.now();
    },
    isRoleClaimable(role, mine = false) {
      if (!this.session.id || mine) {
        return true;
      }
      if (this.session.status === "recruiting") {
        return !["confirmed", "locked", "cancelled"].includes(role.status);
      }
      return (
        this.session.status === "locked" &&
        this.isSessionStarted() &&
        role.status === "open"
      );
    },
    roleDisplayText(role) {
      if (!role?.name) {
        return this.isClaimMode ? "待认领" : "待选";
      }
      const symbol = roleGenderSymbol(role.roleGender);
      const suffix = isCrossCast(this.currentUserGender, role.roleGender) ? "（反串）" : "";
      return `${role.name}${symbol ? ` ${symbol}` : ""}${suffix}`;
    },
    async confirmRole(role = null, options = {}) {
      const targetRole = role || this.pendingRole;
      const revealPending = options.revealPending !== false;
      const copy = this.selectionCopy();
      if (!targetRole) {
        showToast({
          title: this.isClaimMode ? "先选择一个待认领角色" : "先选择一个可选角色",
          icon: "none"
        });
        return;
      }
      const auth = await this.ensureSeatSelectionLogin({
        refreshAfterFreshLogin: true,
        requirePhone: this.joinRequiresPhone,
        phoneRequiredTitle: copy.phoneTitle,
        phoneRequiredContent: copy.phoneContent
      });
      if (!auth) {
        if (revealPending) {
          this.pendingRole = null;
        }
        return;
      }
      const pendingRoleKey = this.roleKey(targetRole);
      if (
        isCrossCast(this.currentUserGender, targetRole.roleGender) &&
        this.confirmedCrossCastRoleKey !== pendingRoleKey
      ) {
        const confirmed = await this.confirmCrossCastRole(targetRole);
        if (!confirmed) {
          if (revealPending) {
            this.pendingRole = null;
          }
          return;
        }
        this.confirmedCrossCastRoleKey = pendingRoleKey;
      }
      if (this.sessionId) {
        await this.claimSeat(targetRole);
        return;
      }
      const previousRole = this.role;
      const rest = this.selectedRoles.filter((role) => !previousRole || !isSameRole(role, previousRole));
      this.role = targetRole;
      this.selectedRoles = mergeSelectedRoles(rest, [targetRole]);
      if (revealPending) {
        this.pendingRole = null;
      }
      this.persistFlow();
      showToast({ title: copy.success, icon: "none" });
    },
    async claimSeat(role) {
      const copy = this.selectionCopy();
      try {
        const seatId = role.seatId || role.id;
        if (this.session.join_policy === "direct") {
          const wasConfirmedMember = isConfirmedSessionMember(this.session, this.currentUserId);
          const claimResponse = await request({
            url: `/api/session-seats/${seatId}/claim`,
            method: "POST",
            data: {
              note: copy.directNote
            }
          });
          const joinResult = dataOf(claimResponse)?.join_result;
          await requestSubscriptionAfterConfirmedJoin(
            wasConfirmedMember,
            joinResult,
            "joined",
            requestSessionRescheduledSubscription
          );
          this.pendingRole = null;
          await this.loadPublishedSession(this.sessionId);
          if (joinResult !== "joined") {
            this.statusText = this.isClaimMode
              ? "认领结果异常，请刷新后确认角色状态。"
              : "上车结果异常，请刷新后确认角色状态。";
            showToast({
              title: this.isClaimMode ? "认领结果异常，请稍后确认" : "上车结果异常，请稍后确认",
              icon: "none"
            });
            return;
          }
          if (this.openAlbumAfterClaim(wasConfirmedMember)) {
            return;
          }
          if (!(this.isClaimMode && !wasConfirmedMember)) {
            this.statusText = `${copy.success}。`;
          }
          showToast({
            title: copy.success,
            icon: "none"
          });
          return;
        }
        await request({
          url: "/api/signups",
          method: "POST",
          data: {
            seatId,
            note: copy.directNote
          }
        });
        this.pendingRole = null;
        await this.loadPublishedSession(this.sessionId);
        this.statusText = this.isClaimMode
          ? "已提交认领，等待车头确认。"
          : "已提交申请，等待车头审核。";
        showToast({
          title: this.isClaimMode ? "已提交认领" : "已提交申请",
          icon: "none"
        });
        requestSignupReviewedSubscription();
      } catch (error) {
        if (error?.statusCode === 409) {
          this.statusText = copy.conflict;
        } else if (error?.statusCode === 401) {
          this.statusText = this.isClaimMode
            ? "请先登录后再认领角色。"
            : "请先登录后再选择角色。";
        } else {
          this.statusText = this.isClaimMode
            ? "角色认领失败，请稍后重试。"
            : "申请失败，请稍后重试。";
        }
      }
    },
    async chooseNpcRole(npcRole) {
      if (this.roleSelectionSubmitting) {
        return;
      }
      const selectedRoleKey = this.roleKey(npcRole);
      const loginAuth = await this.ensureSeatSelectionLogin({
        refreshAfterFreshLogin: true
      });
      if (!loginAuth) {
        return;
      }
      const copy = this.selectionCopy();
      const targetRole = this.npcRoleCards.find((item) => this.roleKey(item) === selectedRoleKey) || npcRole;
      if (!targetRole.mine) {
        if (targetRole.stateKind === "pendingReview") {
          this.statusText = this.isClaimMode
            ? "已提交NPC角色认领，等待车头确认。"
            : "已提交NPC角色申请，等待车头审核。";
          return;
        }
        if (!this.npcSelfJoinEnabled) {
          this.statusText = "本场NPC由车头安排。";
          return;
        }
        if (!targetRole.claimable) {
          showToast({ title: copy.conflict, icon: "none" });
          return;
        }
      }

      if (targetRole.mine) {
        showToast({
          title: this.isClaimMode ? "这是你已认领的NPC角色" : "这是你的NPC角色",
          icon: "none"
        });
        return;
      }

      this.roleSelectionSubmitting = true;
      try {
        const switchConfirmed = await this.confirmSwitchRole(targetRole);
        if (!switchConfirmed) {
          return;
        }
        const confirmed = await this.confirmCrossCastRole(targetRole);
        if (!confirmed) {
          return;
        }
        this.confirmedCrossCastRoleKey = this.roleKey(targetRole);
        const auth = await this.ensureSeatSelectionLogin({
          refreshAfterFreshLogin: true,
          requirePhone: this.joinRequiresPhone,
          phoneRequiredTitle: copy.phoneTitle,
          phoneRequiredContent: copy.phoneContent
        });
        if (!auth) {
          return;
        }
        const wasConfirmedMember = isConfirmedSessionMember(this.session, this.currentUserId);
        const response = await request({
          url: `/api/session-npc-roles/${targetRole.id}/claim`,
          method: "POST",
          data: {
            note: copy.directNote
          }
        });
        const result = dataOf(response) || {};
        if (result.join_result === "npc_joined") {
          await requestSubscriptionAfterConfirmedJoin(
            wasConfirmedMember,
            result.join_result,
            "npc_joined",
            requestSessionRescheduledSubscription
          );
          await this.loadPublishedSession(this.sessionId);
          if (this.openAlbumAfterClaim(wasConfirmedMember)) {
            return;
          }
          if (!(this.isClaimMode && !wasConfirmedMember)) {
            this.statusText = this.isClaimMode ? `${copy.success}。` : "已选择NPC角色。";
          }
          showToast({ title: this.isClaimMode ? copy.success : "已选择NPC角色", icon: "none" });
          return;
        }
        if (result.join_result === "pending_review") {
          await this.loadPublishedSession(this.sessionId);
          this.statusText = this.isClaimMode
            ? "已提交NPC角色认领，等待车头确认。"
            : "已提交NPC角色申请，等待车头审核。";
          showToast({
            title: this.isClaimMode ? "已提交认领" : "已提交申请",
            icon: "none"
          });
          requestSignupReviewedSubscription();
          return;
        }
        await this.loadPublishedSession(this.sessionId);
        this.statusText = this.isClaimMode
          ? "认领结果异常，请刷新后确认NPC角色状态。"
          : "上车结果异常，请刷新后确认NPC角色状态。";
        showToast({
          title: this.isClaimMode ? "认领结果异常，请稍后确认" : "上车结果异常，请稍后确认",
          icon: "none"
        });
      } catch (error) {
        if (error?.statusCode === 403) {
          this.statusText = "本场NPC由车头安排。";
        } else if (error?.statusCode === 409) {
          this.statusText = copy.conflict;
        } else if (error?.statusCode === 401) {
          this.statusText = this.isClaimMode
            ? "请先登录后再认领NPC角色。"
            : "请先登录后再选择NPC角色。";
        } else {
          this.statusText = this.isClaimMode
            ? "NPC角色认领失败，请稍后重试。"
            : "NPC角色申请失败，请稍后重试。";
        }
      } finally {
        this.roleSelectionSubmitting = false;
      }
    },
    showShareMenus() {
      const showFriendShareMenu = () => {
        showWechatShareMenus({
          withShareTicket: true,
          menus: ["shareAppMessage"]
        });
      };
      if (typeof uni !== "undefined" && typeof uni.hideShareMenu === "function") {
        uni.hideShareMenu({
          menus: ["shareTimeline"],
          complete: showFriendShareMenu
        });
        return;
      }
      showFriendShareMenu();
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
  min-height: 0;
  padding: 42rpx 42rpx 48rpx;
  border: 1rpx solid rgba(229, 220, 201, 0.92);
  border-radius: 22rpx;
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
  bottom: -12rpx;
  left: 0;
  z-index: 0;
  width: 100%;
  height: 72rpx;
}

.ticket-title {
  position: relative;
  z-index: 1;
  color: #153f34;
  font-size: 48rpx;
  font-weight: 600;
  line-height: 1.14;
  letter-spacing: 2rpx;
}

.ticket-tags {
  position: relative;
  z-index: 1;
  display: inline-block;
  margin-top: 14rpx;
  margin-bottom: 30rpx;
  padding: 8rpx 18rpx;
  border-radius: 6rpx;
  background: rgba(231, 239, 232, 0.94);
  color: #1f6f5b;
  font-size: 23rpx;
}

.ticket-divider {
  position: relative;
  z-index: 1;
  margin: 22rpx 0 16rpx;
  border-top: 1rpx dashed rgba(216, 207, 189, 0.9);
}

.ticket-row {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 12rpx 0;
}

.ticket-icon {
  width: 32rpx;
  height: 32rpx;
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

.share-role-board {
  margin-top: 24rpx;
}

.share-actions {
  margin-top: 28rpx;
}

.session-load-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  margin-top: 24rpx;
  padding: 22rpx 24rpx;
  border: 1rpx solid rgba(184, 99, 72, 0.28);
  border-radius: 14rpx;
  background: rgba(251, 241, 236, 0.9);
}

.session-load-error-text {
  flex: 1;
  color: #8b4936;
  font-size: 25rpx;
  line-height: 1.45;
}

.session-load-retry {
  flex-shrink: 0;
  min-width: 136rpx;
  margin: 0;
  padding: 0 22rpx;
  border: 1rpx solid rgba(26, 93, 77, 0.32);
  border-radius: 999rpx;
  background: #ffffff;
  color: #1a5d4d;
  font-size: 24rpx;
  line-height: 56rpx;
}

.session-load-retry::after,
.wechat-action::after {
  border: 0;
}

.wechat-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 88rpx;
  min-height: 88rpx;
  margin: 0;
  padding: 0 24rpx;
  border: 1rpx solid #1a5d4d;
  border-radius: 12rpx;
  background: linear-gradient(145deg, #1a5d4d 0%, #2b765f 100%);
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 700;
  line-height: 1;
  box-shadow: 0 16rpx 34rpx rgba(31, 111, 91, 0.22);
}

.wechat-action[disabled] {
  border-color: rgba(26, 93, 77, 0.32);
  background: linear-gradient(145deg, #809b92 0%, #91aaa1 100%);
  color: rgba(255, 255, 255, 0.84);
  box-shadow: none;
}

.wechat-action-content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 14rpx;
  min-width: 0;
  color: #ffffff;
}

.wechat-action .button-icon {
  width: 48rpx;
  height: 48rpx;
  opacity: 0.82;
}
</style>
