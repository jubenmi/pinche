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
        empty-text="暂无可选角色。"
        @itemtap="handleSharedRoleTap"
      />
    </view>

    <view class="share-actions">
      <t-button
        class="button wechat-action"
        open-type="share"
        custom-style="height: 88rpx; min-height: 88rpx; border-color: #1a5d4d; background: linear-gradient(145deg, #1a5d4d 0%, #2b765f 100%); color: #ffffff; --td-button-default-bg-color: #1f6f5b; --td-button-default-color: #ffffff; --td-button-default-border-color: #1a5d4d;"
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
          <text>分享给好友或群聊</text>
        </view>
      </t-button>
    </view>
  </view>
</template>

<script>
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
    isAlbumEntry() {
      return this.entry === "album";
    },
    pageTitle() {
      return this.isAlbumEntry ? "查看车局相册" : "分享票";
    },
    pageIntro() {
      if (this.isAlbumEntry) {
        return "同车成员可直接进入相册；未上车先选择角色。";
      }
      return "这张局卡已经可以发给朋友或群聊。";
    },
    statusPillText() {
      if (this.isAlbumEntry) {
        return this.session.join_policy === "direct" ? "可直接上车" : "需车头审核";
      }
      return "可继续分享";
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
          stateLabel: stateKind === "switching"
            ? "换选"
            : stateKind === "mine"
              ? ""
              : stateKind === "taken"
                ? "已选"
                : stateKind === "pendingReview"
                  ? "待审"
                  : stateKind === "unavailable"
                    ? "不可选"
                  : "可选"
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
            stateLabel: stateKind === "mine"
              ? ""
              : stateKind === "pendingReview"
                ? "待审"
                : stateKind === "taken"
                  ? "已选"
                  : stateKind === "unavailable"
                    ? "不可选"
                    : "可选"
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
          summary: this.npcSelfJoinEnabled ? "工作人员可选择自己的NPC角色" : "本场NPC由车头安排",
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
          this.statusText = `你已选择 ${this.role.name}，确认后会释放原角色。`;
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
    const title = this.shareCardTitle();
    if (this.sessionId) {
      const shareCode = `s${this.sessionId}-${Date.now()}`;
      const entryQuery = this.entry ? `&entry=${encodeURIComponent(this.entry)}` : "";
      const inviteQuery = this.inviteToken
        ? `&inviteToken=${encodeURIComponent(this.inviteToken)}`
        : "";
      return {
        title,
        path: `/pages/session/share?id=${this.sessionId}${entryQuery}&shareCode=${shareCode}${inviteQuery}&source=wechat_share`
      };
    }
    return {
      title: this.shareCardTitle(),
      path: `/pages/session/share${flowToQuery(flow)}`
    };
  },
  onShareTimeline() {
    return {
      title: this.timelineShareTitle(),
      query: this.shareTimelineQuery()
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
    timelineShareTitle() {
      const seatText = this.availableCount > 0
        ? `还差${this.availableCount}位上车`
        : "剧本车局发车中";
      return `${seatText}｜${this.scriptName}｜${this.storeName}｜${this.startText}，来一起沉浸一局`;
    },
    shareTimelineQuery() {
      if (this.sessionId) {
        const shareCode = `s${this.sessionId}-${Date.now()}`;
        return `id=${encodeURIComponent(this.sessionId)}&shareCode=${encodeURIComponent(
          shareCode
        )}&source=wechat_timeline`;
      }
      const query = flowToQuery(this.persistFlow()).replace(/^\?/, "");
      return query ? `${query}&source=wechat_timeline` : "source=wechat_timeline";
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
        content: "登录后可以选择角色并锁定你的位置。",
        ...options
      });
      if (!auth?.user) {
        this.statusText = "登录后可继续选择角色。";
        return null;
      }
      this.currentUserId = auth.user.id || "";
      this.refreshCurrentUserGender(auth);
      if (options.refreshAfterFreshLogin === true && !wasLoggedIn) {
        if (this.sessionId) {
          await this.loadPublishedSession(this.sessionId);
          if (this.redirectAlbumMemberIfNeeded()) {
            return null;
          }
        }
      }
      return auth;
    },
    async loadPublishedSession(sessionId) {
      try {
        const inviteQuery = this.inviteToken
          ? `?inviteToken=${encodeURIComponent(this.inviteToken)}`
          : "";
        const response = await request({ url: `/api/sessions/${sessionId}${inviteQuery}` });
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
        this.redirectAlbumMemberIfNeeded();
        if (this.isAlbumEntry && !this.role && !this.currentUserNpcRole && !this.statusText) {
          this.statusText =
            this.session.join_policy === "direct"
              ? "选择角色后会直接进入相册。"
              : "选择角色提交申请，车头确认后可进入相册。";
        }
      } catch (error) {
        showToast({ title: "车局加载失败", icon: "none" });
      }
    },
    async prepareJoinInviteToken() {
      if (this.inviteToken || !this.sessionId || this.session.access_scope !== "member") {
        return;
      }
      try {
        const response = await request({
          url: `/api/sessions/${this.sessionId}/join-invite-token`,
          method: "POST",
          data: {}
        });
        this.inviteToken = dataOf(response)?.token || "";
      } catch (error) {
        this.inviteToken = "";
      }
    },
    redirectAlbumMemberIfNeeded() {
      if (
        !this.isAlbumEntry ||
        !this.sessionId ||
        (!this.role && !this.currentUserNpcRole) ||
        this.navigatingAlbum
      ) {
        return false;
      }
      this.navigatingAlbum = true;
      uni.redirectTo({ url: `/pages/session/album?id=${this.sessionId}` });
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
      return new Promise((resolve) => {
        showModal({
          title: "确认换选",
          content: `将从 ${currentRoleName} 换到 ${nextRoleName}，原角色会释放，是否继续？`,
          confirmText: "换选",
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
      if (this.isAlbumEntry && !this.currentUserId) {
        await this.loadPublishedSession(this.sessionId);
        if (this.redirectAlbumMemberIfNeeded()) {
          return;
        }
      }
      if (targetRole.taken && !targetRole.mine) {
        showToast({ title: "这个角色已被选择", icon: "none" });
        return;
      }
      if (!targetRole.claimable && !targetRole.mine) {
        showToast({ title: "这个角色暂不可选择", icon: "none" });
        return;
      }
      if (targetRole.taken && targetRole.mine) {
        showToast({ title: "这是你当前选择的角色", icon: "none" });
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
        return "待选";
      }
      const symbol = roleGenderSymbol(role.roleGender);
      const suffix = isCrossCast(this.currentUserGender, role.roleGender) ? "（反串）" : "";
      return `${role.name}${symbol ? ` ${symbol}` : ""}${suffix}`;
    },
    async confirmRole(role = null, options = {}) {
      const targetRole = role || this.pendingRole;
      const revealPending = options.revealPending !== false;
      if (!targetRole) {
        showToast({ title: "先选择一个可选角色", icon: "none" });
        return;
      }
      const auth = await this.ensureSeatSelectionLogin({
        refreshAfterFreshLogin: true,
        requirePhone: this.joinRequiresPhone,
        phoneRequiredTitle: "授权手机号后上车",
        phoneRequiredContent: "上车前需要授权手机号，方便车头沟通和审核。"
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
      showToast({ title: "角色已选择", icon: "none" });
    },
    async claimSeat(role) {
      try {
        const seatId = role.seatId || role.id;
        if (this.session.join_policy === "direct") {
          const claimResponse = await request({
            url: `/api/session-seats/${seatId}/claim`,
            method: "POST",
            data: {
              note: this.isAlbumEntry ? "相册分享页直接上车" : "分享页选择角色上车"
            }
          });
          const joinResult = dataOf(claimResponse)?.join_result || "joined";
          if (joinResult === "joined") {
            await requestSessionRescheduledSubscription().catch(() => null);
          }
          this.pendingRole = null;
          await this.loadPublishedSession(this.sessionId);
          if (this.isAlbumEntry && joinResult === "joined") {
            if (!this.navigatingAlbum) {
              uni.redirectTo({ url: `/pages/session/album?id=${this.sessionId}` });
            }
            return;
          }
          this.statusText = "已上车。";
          showToast({
            title: "已上车",
            icon: "none"
          });
          return;
        }
        await request({
          url: "/api/signups",
          method: "POST",
          data: {
            seatId,
            note: this.isAlbumEntry ? "相册分享页申请上车" : "分享页选择角色申请上车"
          }
        });
        this.pendingRole = null;
        await this.loadPublishedSession(this.sessionId);
        this.statusText = "已提交申请，等待车头审核。";
        showToast({
          title: "已提交申请",
          icon: "none"
        });
        requestSignupReviewedSubscription();
      } catch (error) {
        if (error?.statusCode === 409) {
          this.statusText = "你已经申请过这个角色，请等待车头审核。";
        } else if (error?.statusCode === 401) {
          this.statusText = "请先登录后再选择角色。";
        } else {
          this.statusText = "申请失败，请稍后重试。";
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
      const targetRole = this.npcRoleCards.find((item) => this.roleKey(item) === selectedRoleKey) || npcRole;
      if (!targetRole.mine) {
        if (targetRole.stateKind === "pendingReview") {
          this.statusText = "已提交NPC角色申请，等待车头审核。";
          return;
        }
        if (!this.npcSelfJoinEnabled) {
          this.statusText = "本场NPC由车头安排。";
          return;
        }
        if (!targetRole.claimable) {
          showToast({ title: "这个NPC角色已被选择", icon: "none" });
          return;
        }
      }

      if (targetRole.mine) {
        if (this.isAlbumEntry) {
          uni.redirectTo({ url: `/pages/session/album?id=${this.sessionId}` });
        } else {
          showToast({ title: "这是你的NPC角色", icon: "none" });
        }
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
          phoneRequiredTitle: "授权手机号后上车",
          phoneRequiredContent: "上车前需要授权手机号，方便车头沟通和审核。"
        });
        if (!auth) {
          return;
        }
        const response = await request({
          url: `/api/session-npc-roles/${targetRole.id}/claim`,
          method: "POST",
          data: {
            note: this.isAlbumEntry ? "相册分享页选择NPC角色" : "分享页选择NPC角色"
          }
        });
        const result = dataOf(response) || {};
        await this.loadPublishedSession(this.sessionId);
        if (result.join_result === "npc_joined") {
          await requestSessionRescheduledSubscription().catch(() => null);
          this.statusText = "已选择NPC角色。";
          if (this.isAlbumEntry && !this.navigatingAlbum) {
            uni.redirectTo({ url: `/pages/session/album?id=${this.sessionId}` });
            return;
          }
          showToast({ title: "已选择NPC角色", icon: "none" });
          return;
        }
        if (result.join_result === "pending_review") {
          this.statusText = "已提交NPC角色申请，等待车头审核。";
          showToast({ title: "已提交申请", icon: "none" });
          requestSignupReviewedSubscription();
        }
      } catch (error) {
        if (error?.statusCode === 403) {
          this.statusText = "本场NPC由车头安排。";
        } else if (error?.statusCode === 409) {
          this.statusText = "这个NPC角色已被选择或正在审核。";
        } else if (error?.statusCode === 401) {
          this.statusText = "请先登录后再选择NPC角色。";
        } else {
          this.statusText = "NPC角色申请失败，请稍后重试。";
        }
      } finally {
        this.roleSelectionSubmitting = false;
      }
    },
    showShareMenus() {
      showWechatShareMenus({
        withShareTicket: true,
        menus: ["shareAppMessage", "shareTimeline"]
      });
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

.wechat-action {
  width: 100%;
  border: 1rpx solid #1a5d4d;
  background: linear-gradient(145deg, #1a5d4d 0%, #2b765f 100%);
  color: #ffffff;
  font-weight: 700;
  box-shadow: 0 16rpx 34rpx rgba(31, 111, 91, 0.22);
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
