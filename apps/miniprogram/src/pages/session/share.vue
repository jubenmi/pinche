<template>
  <view class="page share-page">
    <AuthIdentityBar />
    <FeedbackHost />

    <view v-if="isHistorical" class="flow-top historical">
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

    <view v-if="shareUnavailableText" class="session-load-error">
      <text class="session-load-error-text">{{ shareUnavailableText }}</text>
    </view>

    <view v-else-if="sessionLoadError" class="session-load-error">
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
        v-if="showLifecycleRetry"
        class="button wechat-action"
        :disabled="sessionLoading"
        @tap="retryLifecycleRefresh"
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
          <text>刷新分享状态</text>
        </view>
      </button>
      <button
        v-else-if="showInviteRetry"
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
        v-else-if="shareReady"
        class="button wechat-action"
        open-type="share"
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
          <text>{{ shareButtonText }}</text>
        </view>
      </button>
      <view v-else class="button wechat-action wechat-action-preparing">
        <view class="wechat-action-content">
          <t-image
            class="button-icon"
            src="/static/icons/share-light.svg"
            mode="aspectFit"
            width="48rpx"
            height="48rpx"
            custom-style="width: 48rpx; height: 48rpx; opacity: 0.82;"
          />
          <text>分享准备中…</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import {
  formatBeijingDateTime,
  isBusinessDateTimeReached,
  isHistoricalSession,
  parseBusinessDateTime
} from "@pinche/shared";
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
  CREATE_FLOW_KEY,
  clearCreateFlow,
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
  authPrincipalOf,
  beginRoleSelectionOperation as captureRoleSelectionOperation,
  drainLatestAuthRefresh,
  finishRoleSelectionOperation as releaseRoleSelectionOperation,
  historicalClaimRequest,
  historicalInviteRecoveryAllowed,
  historicalRoleClaimable,
  identitySafeCreateFlow,
  inviteQuery,
  inviteTokenState,
  pageRequestIsCurrent,
  pageRequestSnapshot,
  rebaseRoleSelectionOperation as rebaseCapturedRoleSelectionOperation,
  roleSelectionOperationIsCurrent as capturedRoleSelectionOperationIsCurrent,
  sessionShareReady
} from "../../utils/sessionShareInvite";
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

const MAX_START_BOUNDARY_TIMER_MS = 2_147_000_000;
const POST_BOUNDARY_RETRY_MS = 1_000;
const MAX_POST_BOUNDARY_REFRESH_ATTEMPTS = 3;

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
      historicalInviteToken: "",
      historicalCapabilitySupplied: false,
      invalidInviteLink: false,
      malformedInviteLink: false,
      sessionLoadReady: false,
      session: {},
      sessionLoadError: "",
      sessionLoading: false,
      sessionLoaded: false,
      sessionLoadSerial: 0,
      sessionLoadPromise: null,
      shareRefreshPromise: null,
      startBoundaryTimer: null,
      startBoundaryRefreshPending: false,
      postBoundaryRefreshAttempts: 0,
      lifecycleRetryAvailable: false,
      shareMenuGeneration: 0,
      sharePageActive: true,
      shareActivityGeneration: 0,
      invitePreparing: false,
      invitePrepareError: false,
      navigatingAlbum: false,
      currentUserId: "",
      currentUserGender: "",
      confirmedCrossCastRoleKey: "",
      roleSelectionSubmitting: false,
      roleSelectionOperationId: 0,
      activeRoleSelectionOperationId: 0,
      authRefreshPromise: null,
      pageActive: false,
      pageGeneration: 0,
      authRevision: 0,
      currentAuthPrincipal: "guest",
      statusText: "",
      startText: "",
      note: ""
    };
  },
  computed: {
    isAlbumEntry() {
      return this.entry === "album";
    },
    shareMode() {
      return resolveSessionShareMode(this.session);
    },
    sharePresentation() {
      return sessionSharePresentation(this.shareMode);
    },
    isHistorical() {
      return isHistoricalSession(this.session);
    },
    viewerIsOrganizer() {
      return Boolean(
        this.currentUserId &&
        Number(this.session.organizer_user_id) === Number(this.currentUserId)
      );
    },
    historicalViewerHasRole() {
      return Boolean(this.role || this.currentUserNpcRole);
    },
    canShareCurrentSession() {
      return sessionShareReady({
        sessionId: this.sessionId,
        sessionLoadReady: this.sessionLoadReady,
        invalidInviteLink: this.invalidInviteLink,
        isHistorical: this.isHistorical,
        historicalInviteToken: this.historicalInviteToken,
        accessScope: this.session.access_scope,
        inviteToken: this.inviteToken
      });
    },
    pageTitle() {
      if (this.isHistorical) {
        return "补认当时角色";
      }
      return this.isAlbumEntry ? "查看车局相册" : "邀请好友认领角色";
    },
    pageIntro() {
      if (this.isHistorical) {
        return "邀请当时同车玩家补认角色";
      }
      if (this.isAlbumEntry) {
        return "同车成员可直接进入相册；未上车先选择角色。";
      }
      return this.sharePresentation.pageIntro;
    },
    shareButtonText() {
      return this.sharePresentation.buttonText;
    },
    shareUnavailableText() {
      return this.sessionLoaded && this.session.status === "cancelled"
        ? "车局已取消，无法分享"
        : "";
    },
    shareLifecycleFresh() {
      if (!this.sessionId || !this.sessionLoaded || this.session.has_started !== false) {
        return true;
      }
      const startAt = parseBusinessDateTime(this.session.start_at);
      const startAtMs = startAt?.getTime();
      return Number.isFinite(startAtMs) && startAtMs > Date.now();
    },
    shareReady() {
      if (!this.sessionId) {
        return this.sharePageActive && !this.sessionLoadError;
      }
      if (this.isHistorical) {
        return Boolean(
          this.pageActive &&
          this.sharePageActive &&
          !this.sessionLoading &&
          this.canShareCurrentSession &&
          !this.shareUnavailableText &&
          !this.sessionLoadError
        );
      }
      return Boolean(
        this.sharePageActive &&
        !this.sessionLoading &&
        this.sessionLoaded &&
        String(this.session.id || "") === String(this.sessionId) &&
        this.inviteToken &&
        this.shareLifecycleFresh &&
        !this.shareUnavailableText &&
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
        !this.shareUnavailableText &&
        !this.sessionLoadError
      );
    },
    showLifecycleRetry() {
      return Boolean(
        this.sharePageActive &&
        this.sessionId &&
        this.sessionLoaded &&
        !this.sessionLoading &&
        this.lifecycleRetryAvailable &&
        !this.shareUnavailableText &&
        !this.sessionLoadError
      );
    },
    isClaimMode() {
      return this.shareMode === "claim";
    },
    statusPillText() {
      if (this.isHistorical) {
        return "历史补录";
      }
      if (this.isAlbumEntry) {
        return this.session.join_policy === "direct" ? "可直接上车" : "需车头审核";
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
      if (this.isHistorical) {
        return "待补认";
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
      if (this.isHistorical) {
        const claimed = this.roleCards.filter((role) =>
          ["mine", "taken"].includes(role.stateKind)
        ).length;
        return `${this.roleCards.length - claimed} 个待补认，${claimed} 个已补认`;
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
        const claimable = this.isHistorical
          ? historicalRoleClaimable({
              hasHistoricalToken: Boolean(this.historicalInviteToken),
              invalidInviteLink: this.invalidInviteLink,
              malformedInviteLink: this.malformedInviteLink,
              occupied,
              viewerHasRole: this.historicalViewerHasRole,
              viewerIsOrganizer: this.viewerIsOrganizer
            })
          : this.isRoleClaimable(role, mine);
        const pending = !this.isHistorical && this.pendingRole && isSameRole(role, this.pendingRole);
        const switching = pending && this.role && !isSameRole(role, this.role);
        const crossCast = (pending || mine) && isCrossCast(this.currentUserGender, role.roleGender);
        let stateKind = "available";
        if (this.isHistorical) {
          if (mine) {
            stateKind = "mine";
          } else if (occupied) {
            stateKind = "taken";
          } else if (!claimable) {
            stateKind = "unavailable";
          }
        } else if (switching) {
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
          stateLabel: this.isHistorical
            ? ["mine", "taken"].includes(stateKind) ? "已补认" : "待补认"
            : stateKind === "switching"
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
          const taken = Boolean(
            role.is_bound ||
            role.has_pending_signup ||
            effectiveBoundUserId > 0 ||
            effectivePendingUserId > 0
          );
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
          const claimable = this.isHistorical
            ? historicalRoleClaimable({
                hasHistoricalToken: Boolean(this.historicalInviteToken),
                invalidInviteLink: this.invalidInviteLink,
                malformedInviteLink: this.malformedInviteLink,
                occupied: taken,
                viewerHasRole: this.historicalViewerHasRole,
                viewerIsOrganizer: this.viewerIsOrganizer
              })
            : !taken && this.npcSelfJoinEnabled;
          let stateKind = "available";
          if (this.isHistorical) {
            if (mine) {
              stateKind = "mine";
            } else if (taken) {
              stateKind = "taken";
            } else if (!claimable) {
              stateKind = "unavailable";
            }
          } else if (mine) {
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
            claimable,
            mine,
            boardType: "npc",
            stateKind,
            stateLabel: this.isHistorical
              ? ["mine", "taken"].includes(stateKind) ? "已补认" : "待补认"
              : stateKind === "mine"
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
        const claimedNpcCount = this.npcRoleCards.filter((role) =>
          ["mine", "taken"].includes(role.stateKind)
        ).length;
        sections.push({
          key: "npc",
          title: "NPC角色",
          summary: this.isHistorical
            ? `${this.npcRoleCards.length - claimedNpcCount} 个待补认，${claimedNpcCount} 个已补认`
            : this.npcSelfJoinEnabled ? "工作人员可选择自己的NPC角色" : "本场NPC由车头安排",
          items: this.npcRoleCards
        });
      }
      return sections;
    },
  },
  async onLoad(options) {
    this.pageGeneration += 1;
    this.pageActive = true;
    const stored = readCreateFlow();
    const currentAuth = getCurrentUser();
    this.currentAuthPrincipal = authPrincipalOf(currentAuth, getToken());
    this.bindAuthChangeListener();
    this.refreshCurrentUserGender(currentAuth);
    const fromQuery = queryToFlow(options);
    this.entry = options.entry || "";
    this.sessionId = options.id || fromQuery.sessionId || stored.sessionId || "";
    const tokenState = inviteTokenState(options);
    this.inviteToken = tokenState.inviteToken;
    this.historicalInviteToken = tokenState.historicalInviteToken;
    this.historicalCapabilitySupplied = tokenState.historicalCapabilitySupplied;
    if (this.sessionId) {
      this.hideShareMenus();
    }
    if (tokenState.invalid) {
      this.inviteToken = "";
      this.historicalInviteToken = "";
      this.malformedInviteLink = true;
      this.invalidInviteLink = true;
      this.statusText = "邀请链接无效。";
      this.hideShareMenus();
      return;
    }
    if (this.sessionId) {
      const loaded = await this.loadPublishedSession(this.sessionId);
      if (!loaded || !this.pageActive || this.navigatingAlbum) {
        return;
      }
      if (options.seatId && !this.isHistorical) {
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
      const inviteReady = await this.prepareJoinInviteToken();
      if (!inviteReady || !this.pageActive || this.navigatingAlbum) {
        return;
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
      note: fromQuery.note || stored.note || "剧本谜，一起沉浸好本。"
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
  onShow() {
    if (!this.pageActive) {
      this.pageGeneration += 1;
      this.pageActive = true;
    }
    if (!this.sharePageActive) {
      this.sharePageActive = true;
      this.shareActivityGeneration += 1;
    }
    this.lifecycleRetryAvailable = false;
    if (!this.sessionId) {
      this.showShareMenus();
      return;
    }
    this.postBoundaryRefreshAttempts = 0;
    return this.refreshPublishedShareState();
  },
  onHide() {
    this.pageActive = false;
    this.pageGeneration += 1;
    this.deactivateSharePage();
  },
  onUnload() {
    this.pageActive = false;
    this.pageGeneration += 1;
    this.deactivateSharePage();
    this.unbindAuthChangeListener();
  },
  onShareAppMessage() {
    if (!this.canShareCurrentSession) {
      return undefined;
    }
    if (!this.shareReady) {
      return undefined;
    }
    const flow = this.persistFlow();
    const title = this.shareCardTitle();
    if (this.sessionId) {
      const shareCode = `s${this.sessionId}-${Date.now()}`;
      if (this.isHistorical) {
        const historicalQuery = inviteQuery({
          mode: "historical",
          token: this.historicalInviteToken
        });
        if (!historicalQuery) {
          showToast({ title: "补认邀请生成失败，请稍后重试", icon: "none" });
          return undefined;
        }
        return {
          title,
          path: `/pages/session/share?id=${this.sessionId}&shareCode=${shareCode}${historicalQuery.replace(/^\?/, "&")}&source=wechat_share`,
          imageUrl: "/static/art/ticket-landscape.jpg"
        };
      }
      return buildSessionSharePayload({
        sessionId: this.sessionId,
        inviteToken: this.inviteToken,
        shareCode,
        scriptName: this.scriptName,
        mode: this.shareMode
      });
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
      if (this.isHistorical) {
        return `邀请当时同车玩家补认角色｜${this.scriptName}`;
      }
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
        uni.$on(AUTH_CHANGE_EVENT, this.handleAuthChange);
      }
    },
    unbindAuthChangeListener() {
      if (typeof uni.$off === "function") {
        uni.$off(AUTH_CHANGE_EVENT, this.handleAuthChange);
      }
    },
    handleAuthChange(auth = null) {
      const currentAuth = auth && Object.prototype.hasOwnProperty.call(auth, "user")
        ? auth
        : getCurrentUser();
      const nextPrincipal = authPrincipalOf(currentAuth, getToken());
      this.refreshCurrentUserGender(currentAuth);
      if (nextPrincipal === this.currentAuthPrincipal) {
        return Promise.resolve(false);
      }
      this.currentAuthPrincipal = nextPrincipal;
      this.authRevision += 1;
      if (this.malformedInviteLink) {
        return Promise.resolve(false);
      }
      if (!this.pageActive || !this.sessionId) {
        return Promise.resolve(false);
      }
      this.invalidateIdentityBoundRequests();
      this.clearIdentityBoundProjection();
      return this.reloadSessionAfterAuth();
    },
    refreshCurrentUserGender(auth = null) {
      const hasExplicitAuth = Boolean(
        auth && Object.prototype.hasOwnProperty.call(auth, "user")
      );
      const currentAuth = hasExplicitAuth ? auth : getCurrentUser();
      const authenticatedUser = authPrincipalOf(currentAuth, getToken()) === "guest"
        ? null
        : currentAuth.user;
      this.currentUserId = authenticatedUser?.id || "";
      const nextGender = authenticatedUser?.gender || "";
      if (nextGender !== this.currentUserGender) {
        this.confirmedCrossCastRoleKey = "";
      }
      this.currentUserGender = nextGender;
      this.clearSeatSelectionWhenLoggedOut();
    },
    clearIdentityBoundProjection() {
      const sessionPurpose = this.session.session_purpose || "";
      this.session = {
        session_purpose: sessionPurpose
      };
      this.store = null;
      this.script = null;
      this.role = null;
      this.roleOptions = [];
      this.selectedRoles = [];
      this.pendingRole = null;
      this.confirmedCrossCastRoleKey = "";
      this.startText = "";
      this.note = "";
      this.statusText = "正在重新加载车局…";
      this.sessionLoadReady = false;
      try {
        clearCreateFlow();
      } catch (error) {
        // Continue with an explicit neutral write if removal is unavailable.
      }
      try {
        uni.setStorageSync(
          CREATE_FLOW_KEY,
          identitySafeCreateFlow({
            sessionId: this.sessionId,
            sessionPurpose
          })
        );
      } catch (error) {
        // Storage failures must not retain an identity-bound in-memory projection.
      }
      this.hideShareMenus();
    },
    invalidateIdentityBoundRequests() {
      this.sessionLoadSerial += 1;
      this.sessionLoading = false;
      this.sessionLoadPromise = null;
      this.invitePreparing = false;
      this.invitePrepareError = false;
    },
    async reloadSessionAfterAuth() {
      if (this.malformedInviteLink || !this.pageActive || !this.sessionId) {
        return false;
      }
      return drainLatestAuthRefresh({
        capture: () => ({
          ...pageRequestSnapshot(this),
          sessionId: this.sessionId
        }),
        getActive: () => this.authRefreshPromise,
        setActive: (promise) => {
          this.authRefreshPromise = promise;
        },
        refresh: async (snapshot) => {
          const loaded = await this.loadPublishedSession(this.sessionId);
          if (!loaded || !pageRequestIsCurrent(this, snapshot) || this.navigatingAlbum) {
            return false;
          }
          const inviteReady = await this.prepareJoinInviteToken();
          if (
            !inviteReady ||
            !pageRequestIsCurrent(this, snapshot) ||
            this.navigatingAlbum
          ) {
            return false;
          }
          this.showShareMenus();
          return true;
        }
      });
    },
    clearSeatSelectionWhenLoggedOut() {
      if (this.currentUserId) {
        return;
      }
      this.pendingRole = null;
      this.confirmedCrossCastRoleKey = "";
    },
    isShareActivityCurrent(generation) {
      return Boolean(
        this.pageActive &&
        this.sharePageActive &&
        generation === this.shareActivityGeneration
      );
    },
    deactivateSharePage() {
      this.sharePageActive = false;
      this.shareActivityGeneration += 1;
      this.startBoundaryRefreshPending = false;
      this.postBoundaryRefreshAttempts = 0;
      this.lifecycleRetryAvailable = false;
      this.clearStartBoundaryRefresh();
      this.shareRefreshPromise = null;
      this.sessionLoadSerial += 1;
      this.sessionLoading = false;
      this.sessionLoadPromise = null;
      this.invitePreparing = false;
      this.roleSelectionSubmitting = false;
      this.hideShareMenus();
    },
    clearStartBoundaryRefresh() {
      if (this.startBoundaryTimer !== null) {
        clearTimeout(this.startBoundaryTimer);
        this.startBoundaryTimer = null;
      }
    },
    scheduleStartBoundaryRefresh(
      activityGeneration = this.shareActivityGeneration
    ) {
      this.clearStartBoundaryRefresh();
      if (
        !this.isShareActivityCurrent(activityGeneration) ||
        this.isHistorical ||
        this.shareUnavailableText ||
        this.session.has_started !== false
      ) {
        this.postBoundaryRefreshAttempts = 0;
        this.lifecycleRetryAvailable = false;
        return;
      }
      const startAt = parseBusinessDateTime(this.session.start_at);
      const startAtMs = startAt?.getTime();
      if (!Number.isFinite(startAtMs)) {
        return;
      }
      const remainingMs = startAtMs - Date.now();
      let delay;
      if (remainingMs <= 0) {
        if (this.postBoundaryRefreshAttempts >= MAX_POST_BOUNDARY_REFRESH_ATTEMPTS) {
          this.lifecycleRetryAvailable = true;
          return;
        }
        delay = POST_BOUNDARY_RETRY_MS * 2 ** this.postBoundaryRefreshAttempts;
        this.postBoundaryRefreshAttempts += 1;
      } else {
        this.postBoundaryRefreshAttempts = 0;
        this.lifecycleRetryAvailable = false;
        delay = Math.min(remainingMs, MAX_START_BOUNDARY_TIMER_MS);
      }
      this.startBoundaryTimer = setTimeout(() => {
        this.startBoundaryTimer = null;
        if (!this.isShareActivityCurrent(activityGeneration)) {
          return;
        }
        if (
          !this.shareUnavailableText &&
          this.session.has_started === false &&
          isBusinessDateTimeReached(this.session.start_at)
        ) {
          return this.handleStartBoundaryRefresh(activityGeneration);
        }
        return this.scheduleStartBoundaryRefresh(activityGeneration);
      }, delay);
    },
    handleStartBoundaryRefresh(
      activityGeneration = this.shareActivityGeneration
    ) {
      if (!this.isShareActivityCurrent(activityGeneration)) {
        return Promise.resolve(false);
      }
      this.startBoundaryRefreshPending = true;
      this.showShareMenus();
      if (this.shareRefreshPromise) {
        return this.shareRefreshPromise;
      }
      this.startBoundaryRefreshPending = false;
      return this.refreshPublishedShareState();
    },
    refreshPublishedShareState() {
      if (!this.isShareActivityCurrent(this.shareActivityGeneration)) {
        this.hideShareMenus();
        return Promise.resolve(false);
      }
      if (!this.sessionId) {
        this.showShareMenus();
        return Promise.resolve(false);
      }
      if (this.shareRefreshPromise) {
        return this.shareRefreshPromise;
      }
      const activityGeneration = this.shareActivityGeneration;
      const refreshPromise = this.performPublishedShareStateRefresh(activityGeneration);
      this.shareRefreshPromise = refreshPromise;
      const finishRefresh = () => {
        if (this.shareRefreshPromise === refreshPromise) {
          this.shareRefreshPromise = null;
        }
        if (
          this.isShareActivityCurrent(activityGeneration) &&
          this.startBoundaryRefreshPending
        ) {
          this.startBoundaryRefreshPending = false;
          this.refreshPublishedShareState();
        }
      };
      void refreshPromise.then(finishRefresh, finishRefresh);
      return refreshPromise;
    },
    async performPublishedShareStateRefresh(activityGeneration) {
      if (!this.isShareActivityCurrent(activityGeneration)) {
        return false;
      }
      this.clearStartBoundaryRefresh();
      this.hideShareMenus();
      const loaded = await this.loadPublishedSession(
        this.sessionId,
        activityGeneration
      );
      if (!loaded || !this.isShareActivityCurrent(activityGeneration)) {
        return false;
      }
      this.scheduleStartBoundaryRefresh(activityGeneration);
      if (!this.isShareActivityCurrent(activityGeneration)) {
        return false;
      }
      await this.prepareJoinInviteToken(activityGeneration);
      return Boolean(
        this.isShareActivityCurrent(activityGeneration) &&
        this.shareReady
      );
    },
    beginRoleSelectionOperation() {
      const operation = captureRoleSelectionOperation(this);
      if (!operation) {
        return null;
      }
      this.roleSelectionOperationId = operation.operationId;
      this.activeRoleSelectionOperationId = operation.operationId;
      this.roleSelectionSubmitting = true;
      return operation;
    },
    rebaseRoleSelectionOperation(operation, auth) {
      const actualAuth = getCurrentUser();
      const authenticated = getToken();
      return rebaseCapturedRoleSelectionOperation({
        operation,
        state: this,
        returnedPrincipal: authPrincipalOf(auth),
        actualPrincipal: authPrincipalOf(actualAuth, authenticated)
      });
    },
    roleSelectionOperationIsCurrent(operation) {
      if (!operation) {
        return this.isShareActivityCurrent(this.shareActivityGeneration);
      }
      return capturedRoleSelectionOperationIsCurrent(this, operation);
    },
    finishRoleSelectionOperation(operationId) {
      const released = releaseRoleSelectionOperation(this, operationId);
      this.activeRoleSelectionOperationId = released.activeRoleSelectionOperationId;
      this.roleSelectionSubmitting = released.roleSelectionSubmitting;
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
      if (!this.pageActive) {
        return null;
      }
      const pageGeneration = this.pageGeneration;
      const wasLoggedIn = this.hasSeatSelectionLogin();
      const auth = await ensureLoggedIn({
        content: this.isHistorical
          ? "登录后可以补认当时角色。"
          : "登录后可以选择角色并锁定你的位置。",
        ...options
      });
      if (!this.pageActive || this.pageGeneration !== pageGeneration) {
        return null;
      }
      const actualAuth = getCurrentUser();
      const authenticated = getToken();
      const returnedPrincipal = authPrincipalOf(auth);
      const actualPrincipal = authPrincipalOf(actualAuth, authenticated);
      if (
        returnedPrincipal !== actualPrincipal ||
        actualPrincipal !== this.currentAuthPrincipal
      ) {
        return null;
      }
      if (returnedPrincipal === "guest" || !auth?.user) {
        this.statusText = this.isHistorical
          ? "登录后可继续补认角色。"
          : "登录后可继续选择角色。";
        return null;
      }
      this.currentUserId = auth.user.id || "";
      this.refreshCurrentUserGender(auth);
      if (options.refreshAfterFreshLogin === true && !wasLoggedIn) {
        if (this.sessionId) {
          const loaded = await this.reloadSessionAfterAuth();
          if (
            !loaded ||
            !this.pageActive ||
            this.pageGeneration !== pageGeneration
          ) {
            return null;
          }
          if (this.navigatingAlbum) {
            return null;
          }
        }
      }
      const latestAuth = getCurrentUser();
      const latestAuthenticated = getToken();
      if (
        authPrincipalOf(auth) !==
          authPrincipalOf(latestAuth, latestAuthenticated) ||
        authPrincipalOf(latestAuth, latestAuthenticated) !== this.currentAuthPrincipal
      ) {
        return null;
      }
      return auth;
    },
    loadPublishedSession(
      sessionId,
      activityGeneration = this.shareActivityGeneration
    ) {
      if (this.malformedInviteLink) {
        return Promise.resolve(false);
      }
      if (!this.isShareActivityCurrent(activityGeneration)) {
        return Promise.resolve(false);
      }
      if (this.sessionLoading && this.sessionLoadPromise) {
        return this.sessionLoadPromise;
      }
      const serial = this.sessionLoadSerial + 1;
      this.sessionLoadSerial = serial;
      this.sessionLoading = true;
      this.sessionLoaded = false;
      this.sessionLoadError = "";
      this.sessionLoadReady = false;
      this.hideShareMenus();
      const loadPromise = this.performPublishedSessionLoad(
        sessionId,
        serial,
        activityGeneration
      );
      this.sessionLoadPromise = loadPromise;
      return loadPromise;
    },
    async performPublishedSessionLoad(
      sessionId,
      serial,
      activityGeneration
    ) {
      const requestSnapshot = pageRequestSnapshot(this);
      const historicalRequest = Boolean(
        this.historicalCapabilitySupplied ||
        this.historicalInviteToken ||
        this.isHistorical
      );
      try {
        const query = this.historicalInviteToken
          ? inviteQuery({ mode: "historical", token: this.historicalInviteToken })
          : inviteQuery({ mode: "normal", token: this.inviteToken });
        const response = await request({ url: `/api/sessions/${sessionId}${query}` });
        if (
          serial !== this.sessionLoadSerial ||
          !this.isShareActivityCurrent(activityGeneration) ||
          !pageRequestIsCurrent(this, requestSnapshot)
        ) {
          return false;
        }
        const session = dataOf(response) || {};
        if (String(session.id || "") !== String(sessionId)) {
          throw new Error("session response mismatch");
        }
        this.session = session;
        if (this.isHistorical) {
          this.inviteToken = "";
          if (historicalInviteRecoveryAllowed({
            malformedInviteLink: this.malformedInviteLink,
            sessionLoaded: true,
            historicalInviteToken: this.historicalInviteToken
          })) {
            this.invalidInviteLink = false;
            if ([
              "补认邀请已失效",
              "补认邀请加载失败，请稍后重试"
            ].includes(this.statusText)) {
              this.statusText = "";
            }
          }
          if (typeof uni.setNavigationBarTitle === "function") {
            uni.setNavigationBarTitle({ title: this.pageTitle });
          }
        }
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
        this.note = this.isHistorical
          ? "历史车局补录"
          : "剧本谜，一起沉浸好本。";
        try {
          writeCreateFlow({
            store: this.store,
            script: this.script,
            role: this.role,
            roleOptions: this.roleOptions,
            selectedRoles: this.selectedRoles,
            sessionId,
            sessionPurpose: session.session_purpose,
            startAt: session.start_at,
            startText: this.startText,
            note: this.note
          });
        } catch (error) {
          // A storage failure must not turn a successful session GET into a load failure.
        }
        this.sessionLoadReady = true;
        this.sessionLoaded = true;
        if (this.statusText === "正在重新加载车局…") {
          this.statusText = "";
        }
        if (this.redirectHistoricalMemberIfNeeded()) {
          return true;
        }
        if (
          !this.isHistorical &&
          this.isAlbumEntry &&
          !this.role &&
          !this.currentUserNpcRole &&
          !this.statusText
        ) {
          this.statusText =
            this.isClaimMode
              ? "请选择自己玩过的角色完成认领。"
              : this.session.join_policy === "direct"
                ? "选择角色后将直接加入本局。"
                : "选择角色提交申请，等待车头审核。";
        }
        if (!this.navigatingAlbum) {
          this.showShareMenus();
        }
        return true;
      } catch (error) {
        if (
          serial !== this.sessionLoadSerial ||
          !this.isShareActivityCurrent(activityGeneration) ||
          !pageRequestIsCurrent(this, requestSnapshot)
        ) {
          return false;
        }
        this.sessionLoadReady = false;
        this.sessionLoaded = false;
        if (historicalRequest) {
          this.invalidInviteLink = true;
          this.historicalInviteToken = "";
          this.statusText = error?.statusCode === 403
            ? "补认邀请已失效"
            : "补认邀请加载失败，请稍后重试";
          this.hideShareMenus();
          showToast({ title: this.statusText, icon: "none" });
          return false;
        }
        this.sessionLoadError = "车局加载失败，请重试";
        this.statusText = "车局加载失败，请稍后重试";
        showToast({ title: this.statusText, icon: "none" });
        return false;
      } finally {
        if (
          serial === this.sessionLoadSerial &&
          this.isShareActivityCurrent(activityGeneration) &&
          pageRequestIsCurrent(this, requestSnapshot)
        ) {
          this.sessionLoading = false;
          this.sessionLoadPromise = null;
          this.showShareMenus();
        }
      }
    },
    async prepareJoinInviteToken(
      activityGeneration = this.shareActivityGeneration
    ) {
      const requestSnapshot = pageRequestSnapshot(this);
      if (
        !this.isShareActivityCurrent(activityGeneration) ||
        !pageRequestIsCurrent(this, requestSnapshot)
      ) {
        return false;
      }
      if (this.isHistorical) {
        if (this.malformedInviteLink) {
          return false;
        }
        if (
          this.historicalInviteToken ||
          !this.sessionId ||
          !this.viewerIsOrganizer
        ) {
          return true;
        }
        try {
          const response = await request({
            url: `/api/sessions/${this.sessionId}/historical-invite-token`,
            method: "POST",
            data: {}
          });
          if (
            !this.isShareActivityCurrent(activityGeneration) ||
            !pageRequestIsCurrent(this, requestSnapshot)
          ) {
            return false;
          }
          this.historicalInviteToken = dataOf(response)?.token || "";
          if (historicalInviteRecoveryAllowed({
            malformedInviteLink: this.malformedInviteLink,
            organizerTokenMinted: true,
            historicalInviteToken: this.historicalInviteToken
          })) {
            this.invalidInviteLink = false;
            if ([
              "补认邀请已失效",
              "补认邀请加载失败，请稍后重试"
            ].includes(this.statusText)) {
              this.statusText = "";
            }
          }
          if (!this.historicalInviteToken) {
            this.statusText = "补认邀请生成失败，请稍后重试。";
          }
          return Boolean(this.historicalInviteToken);
        } catch (error) {
          if (
            !this.isShareActivityCurrent(activityGeneration) ||
            !pageRequestIsCurrent(this, requestSnapshot)
          ) {
            return false;
          }
          this.historicalInviteToken = "";
          this.statusText = "补认邀请生成失败，请稍后重试。";
          return false;
        }
      }
      if (
        this.invitePreparing ||
        this.inviteToken ||
        !this.sessionId ||
        this.sessionLoading ||
        !this.sessionLoaded ||
        String(this.session.id || "") !== String(this.sessionId) ||
        this.session.access_scope !== "member" ||
        !this.shareLifecycleFresh ||
        this.shareUnavailableText
      ) {
        return true;
      }
      this.invitePreparing = true;
      this.invitePrepareError = false;
      try {
        const response = await request({
          url: `/api/sessions/${this.sessionId}/join-invite-token`,
          method: "POST",
          data: {}
        });
        if (
          !this.isShareActivityCurrent(activityGeneration) ||
          !pageRequestIsCurrent(this, requestSnapshot)
        ) {
          return false;
        }
        this.inviteToken = dataOf(response)?.token || "";
        if (!this.inviteToken) {
          this.invitePrepareError = true;
          this.statusText = "分享准备失败，请重试。";
        }
        return Boolean(this.inviteToken);
      } catch (error) {
        if (
          !this.isShareActivityCurrent(activityGeneration) ||
          !pageRequestIsCurrent(this, requestSnapshot)
        ) {
          return false;
        }
        this.inviteToken = "";
        if (error?.statusCode === 409) {
          this.invitePrepareError = false;
          this.session = {
            ...this.session,
            status: "cancelled"
          };
          this.statusText = "车局已取消，无法分享";
          this.clearStartBoundaryRefresh();
        } else {
          this.invitePrepareError = true;
          this.statusText = "分享准备失败，请重试。";
        }
        return false;
      } finally {
        if (
          this.isShareActivityCurrent(activityGeneration) &&
          pageRequestIsCurrent(this, requestSnapshot)
        ) {
          this.invitePreparing = false;
          this.showShareMenus();
        }
      }
    },
    async retryPrepareInvite() {
      if (this.invitePreparing) {
        return;
      }
      const activityGeneration = this.shareActivityGeneration;
      this.invitePrepareError = false;
      this.statusText = "";
      await this.prepareJoinInviteToken(activityGeneration);
      if (!this.isShareActivityCurrent(activityGeneration)) {
        return;
      }
      if (this.inviteToken || this.historicalInviteToken) {
        this.invitePrepareError = false;
        this.statusText = "";
      }
    },
    async retryLoadSession() {
      if (!this.sessionId || this.sessionLoading) {
        return;
      }
      this.postBoundaryRefreshAttempts = 0;
      await this.refreshPublishedShareState();
    },
    async retryLifecycleRefresh() {
      if (!this.showLifecycleRetry) {
        return;
      }
      this.lifecycleRetryAvailable = false;
      this.postBoundaryRefreshAttempts = 0;
      await this.refreshPublishedShareState();
    },
    updateNavigationBarTitle() {
      if (typeof uni !== "undefined" && typeof uni.setNavigationBarTitle === "function") {
        uni.setNavigationBarTitle({ title: this.pageTitle });
      }
    },
    redirectHistoricalMemberIfNeeded() {
      if (
        !this.isHistorical ||
        this.viewerIsOrganizer ||
        !this.sessionId ||
        !this.historicalViewerHasRole ||
        this.navigatingAlbum
      ) {
        return false;
      }
      this.navigatingAlbum = true;
      uni.redirectTo({ url: `/pages/session/album?id=${this.sessionId}` });
      return true;
    },
    openAlbumAfterClaim(
      wasConfirmedMember = false,
      activityGeneration = this.shareActivityGeneration
    ) {
      if (
        !this.isShareActivityCurrent(activityGeneration) ||
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
    async chooseHistoricalRole(role) {
      const operationEntry = this.beginRoleSelectionOperation();
      if (!operationEntry) {
        return;
      }
      const activityGeneration = this.shareActivityGeneration;
      const selectedRoleKey = this.roleKey(role);
      const selectedBoardType = role?.boardType === "npc" ? "npc" : "seat";
      let operation = operationEntry;
      try {
        const auth = await this.ensureSeatSelectionLogin({
          refreshAfterFreshLogin: true
        });
        if (!auth) {
          return;
        }
        operation = this.rebaseRoleSelectionOperation(operationEntry, auth);
        if (!operation || !this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
        const roleCards = selectedBoardType === "npc" ? this.npcRoleCards : this.roleCards;
        const targetRole = roleCards.find(
          (item) => this.roleKey(item) === selectedRoleKey
        );
        if (!targetRole) {
          return;
        }
        if (!targetRole.claimable) {
          showToast({
            title: targetRole.stateKind === "taken"
              ? "角色刚被其他人补认"
              : "这个角色暂不可补认",
            icon: "none"
          });
          return;
        }
        const confirmed = await this.confirmCrossCastRole(targetRole);
        if (!this.roleSelectionOperationIsCurrent(operation) || !confirmed) {
          return;
        }
        const confirmedRoleCards = selectedBoardType === "npc"
          ? this.npcRoleCards
          : this.roleCards;
        const confirmedTargetRole = confirmedRoleCards.find(
          (item) => this.roleKey(item) === selectedRoleKey
        );
        if (!confirmedTargetRole || !confirmedTargetRole.claimable) {
          return;
        }
        await this.claimHistoricalRole(confirmedTargetRole, operation);
        if (!this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
      } finally {
        this.finishRoleSelectionOperation(operationEntry.operationId);
      }
    },
    async chooseRole(role) {
      if (this.invalidInviteLink || this.malformedInviteLink) {
        return;
      }
      if (this.isHistorical) {
        return this.chooseHistoricalRole(role);
      }
      const operationEntry = this.beginRoleSelectionOperation();
      if (!operationEntry) {
        return;
      }
      const selectedRoleKey = this.roleKey(role);
      let operation = operationEntry;
      try {
        const auth = await this.ensureSeatSelectionLogin({
          refreshAfterFreshLogin: true
        });
        if (!auth) {
          return;
        }
        operation = this.rebaseRoleSelectionOperation(operationEntry, auth);
        if (!operation || !this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
        const targetRole = this.sessionId
          ? this.roleCards.find((item) => this.roleKey(item) === selectedRoleKey)
          : role;
        if (!targetRole) {
          return;
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
        const switchConfirmed = await this.confirmSwitchRole(targetRole);
        if (!this.roleSelectionOperationIsCurrent(operation) || !switchConfirmed) {
          return;
        }
        const confirmed = await this.confirmCrossCastRole(targetRole);
        if (!this.roleSelectionOperationIsCurrent(operation) || !confirmed) {
          return;
        }
        this.confirmedCrossCastRoleKey = this.roleKey(targetRole);
        await this.confirmRole(targetRole, {
          revealPending: !this.sessionId,
          operation
        });
        if (!this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
      } finally {
        this.finishRoleSelectionOperation(operationEntry.operationId);
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
      return this.session.has_started === true;
    },
    isRoleClaimable(role, mine = false) {
      if (this.isHistorical) {
        return historicalRoleClaimable({
          hasHistoricalToken: Boolean(this.historicalInviteToken),
          invalidInviteLink: this.invalidInviteLink,
          malformedInviteLink: this.malformedInviteLink,
          occupied: ["confirmed", "locked", "cancelled"].includes(role.status),
          viewerHasRole: this.historicalViewerHasRole,
          viewerIsOrganizer: this.viewerIsOrganizer
        });
      }
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
      const operation = options.operation;
      if (!this.roleSelectionOperationIsCurrent(operation)) {
        return;
      }
      const activityGeneration = this.shareActivityGeneration;
      const copy = this.selectionCopy();
      const selectedRole = role || this.pendingRole;
      const revealPending = options.revealPending !== false;
      if (!selectedRole) {
        showToast({ title: "先选择一个可选角色", icon: "none" });
        return;
      }
      const selectedRoleKey = this.roleKey(selectedRole);
      const selectedBoardType = selectedRole.boardType === "npc" ? "npc" : "seat";
      if (this.isHistorical) {
        const auth = await this.ensureSeatSelectionLogin({
          refreshAfterFreshLogin: true
        });
        if (!auth || !this.roleSelectionOperationIsCurrent(operation)) {
          if (this.roleSelectionOperationIsCurrent(operation) && revealPending) {
            this.pendingRole = null;
          }
          return;
        }
        const roleCards = selectedBoardType === "npc" ? this.npcRoleCards : this.roleCards;
        const targetRole = roleCards.find(
          (item) => this.roleKey(item) === selectedRoleKey
        );
        if (!targetRole) {
          return;
        }
        await this.claimHistoricalRole(targetRole, operation);
        if (!this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
        return;
      }
      const auth = await this.ensureSeatSelectionLogin({
        refreshAfterFreshLogin: true,
        requirePhone: this.joinRequiresPhone,
        phoneRequiredTitle: copy.phoneTitle,
        phoneRequiredContent: copy.phoneContent,
        activityGeneration
      });
      if (!auth || !this.roleSelectionOperationIsCurrent(operation)) {
        if (this.roleSelectionOperationIsCurrent(operation) && revealPending) {
          this.pendingRole = null;
        }
        return;
      }
      const targetRole = this.sessionId
        ? this.roleCards.find((item) => this.roleKey(item) === selectedRoleKey)
        : selectedRole;
      if (!targetRole) {
        return;
      }
      const pendingRoleKey = this.roleKey(targetRole);
      if (
        isCrossCast(this.currentUserGender, targetRole.roleGender) &&
        this.confirmedCrossCastRoleKey !== pendingRoleKey
      ) {
        const confirmed = await this.confirmCrossCastRole(targetRole);
        if (!this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
        if (!confirmed) {
          if (revealPending) {
            this.pendingRole = null;
          }
          return;
        }
        this.confirmedCrossCastRoleKey = pendingRoleKey;
      }
      if (this.sessionId) {
        await this.claimSeat(targetRole, operation);
        if (!this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
        return;
      }
      if (!this.roleSelectionOperationIsCurrent(operation)) {
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
    async claimHistoricalRole(role, operation) {
      if (
        !this.roleSelectionOperationIsCurrent(operation) ||
        !this.isHistorical ||
        this.invalidInviteLink ||
        this.malformedInviteLink ||
        !String(this.historicalInviteToken || "").trim()
      ) {
        return;
      }
      try {
        await request(historicalClaimRequest({
          sessionId: this.sessionId,
          inviteToken: this.historicalInviteToken,
          role
        }));
        if (!this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
        this.pendingRole = null;
        this.statusText = "已补认角色";
        showToast({ title: "已补认角色", icon: "none" });
        const loaded = await this.loadPublishedSession(this.sessionId);
        if (!loaded || !this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
      } catch (error) {
        if (!this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
        if (error?.statusCode === 409) {
          const conflictText = "角色刚被其他人补认";
          this.statusText = conflictText;
          const loaded = await this.loadPublishedSession(this.sessionId);
          if (!this.roleSelectionOperationIsCurrent(operation)) {
            return;
          }
          if (!loaded) {
            return;
          }
          this.statusText = conflictText;
          showToast({ title: this.statusText, icon: "none" });
          return;
        } else if (error?.statusCode === 403) {
          this.statusText = "补认邀请已失效";
          this.invalidInviteLink = true;
          this.historicalInviteToken = "";
          this.hideShareMenus();
        } else if (error?.statusCode === 401) {
          this.statusText = "请先登录后再补认角色";
        } else {
          this.statusText = "角色补认失败，请稍后重试";
        }
        showToast({ title: this.statusText, icon: "none" });
      }
    },
    async claimSeat(role, operation) {
      if (
        !this.roleSelectionOperationIsCurrent(operation) ||
        this.invalidInviteLink ||
        this.malformedInviteLink ||
        this.isHistorical
      ) {
        return;
      }
      const activityGeneration = this.shareActivityGeneration;
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
          if (!this.roleSelectionOperationIsCurrent(operation)) {
            return;
          }
          const joinResult = dataOf(claimResponse)?.join_result;
          await requestSubscriptionAfterConfirmedJoin(
            wasConfirmedMember,
            joinResult,
            "joined",
            requestSessionRescheduledSubscription
          );
          if (!this.roleSelectionOperationIsCurrent(operation)) {
            return;
          }
          const loaded = await this.loadPublishedSession(this.sessionId);
          if (!loaded || !this.roleSelectionOperationIsCurrent(operation)) {
            return;
          }
          this.pendingRole = null;
          if (joinResult !== "joined") {
            this.statusText = "上车结果异常，请刷新后确认角色状态。";
            showToast({ title: "上车结果异常，请稍后确认", icon: "none" });
            return;
          }
          if (joinResult === "joined") {
            if (
              this.openAlbumAfterClaim(
                wasConfirmedMember,
                activityGeneration
              )
            ) {
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
          this.statusText = this.isClaimMode
            ? "认领结果异常，请刷新后确认角色状态。"
            : "上车结果异常，请刷新后确认角色状态。";
          showToast({
            title: this.isClaimMode ? "认领结果异常，请稍后确认" : "上车结果异常，请稍后确认",
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
        if (!this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
        const loaded = await this.loadPublishedSession(this.sessionId);
        if (!loaded || !this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
        await requestSignupReviewedSubscription();
        if (!this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
        this.pendingRole = null;
        this.statusText = "已提交申请，等待车头审核。";
        showToast({
          title: this.isClaimMode ? "已提交认领" : "已提交申请",
          icon: "none"
        });
      } catch (error) {
        if (!this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
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
      if (this.invalidInviteLink || this.malformedInviteLink) {
        return;
      }
      if (this.isHistorical) {
        return this.chooseHistoricalRole(npcRole);
      }
      const operationEntry = this.beginRoleSelectionOperation();
      if (!operationEntry) {
        return;
      }
      const activityGeneration = this.shareActivityGeneration;
      const copy = this.selectionCopy();
      const selectedRoleKey = this.roleKey(npcRole);
      let operation = operationEntry;
      try {
        const loginAuth = await this.ensureSeatSelectionLogin({
          refreshAfterFreshLogin: true
        });
        if (!loginAuth) {
          return;
        }
        operation = this.rebaseRoleSelectionOperation(operationEntry, loginAuth);
        if (!operation || !this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
        const targetRole = this.npcRoleCards.find(
          (item) => this.roleKey(item) === selectedRoleKey
        );
        if (!targetRole) {
          return;
        }
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

        const switchConfirmed = await this.confirmSwitchRole(targetRole);
        if (!this.roleSelectionOperationIsCurrent(operation) || !switchConfirmed) {
          return;
        }
        const confirmed = await this.confirmCrossCastRole(targetRole);
        if (!this.roleSelectionOperationIsCurrent(operation) || !confirmed) {
          return;
        }
        this.confirmedCrossCastRoleKey = this.roleKey(targetRole);
        const auth = await this.ensureSeatSelectionLogin({
          refreshAfterFreshLogin: true,
          requirePhone: this.joinRequiresPhone,
          phoneRequiredTitle: copy.phoneTitle,
          phoneRequiredContent: copy.phoneContent,
          activityGeneration
        });
        if (
          !this.roleSelectionOperationIsCurrent(operation) ||
          !auth ||
          this.invalidInviteLink ||
          this.malformedInviteLink ||
          this.isHistorical
        ) {
          return;
        }
        const confirmedTargetRole = this.npcRoleCards.find(
          (item) => this.roleKey(item) === selectedRoleKey
        );
        if (!confirmedTargetRole) {
          return;
        }
        const wasConfirmedMember = isConfirmedSessionMember(this.session, this.currentUserId);
        const response = await request({
          url: `/api/session-npc-roles/${confirmedTargetRole.id}/claim`,
          method: "POST",
          data: {
            note: copy.directNote
          }
        });
        if (!this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
        const result = dataOf(response) || {};
        if (result.join_result === "npc_joined") {
          await requestSubscriptionAfterConfirmedJoin(
            wasConfirmedMember,
            result.join_result,
            "npc_joined",
            requestSessionRescheduledSubscription
          );
          if (!this.roleSelectionOperationIsCurrent(operation)) {
            return;
          }
          const loaded = await this.loadPublishedSession(this.sessionId);
          if (!loaded || !this.roleSelectionOperationIsCurrent(operation)) {
            return;
          }
          this.statusText = "已选择NPC角色。";
          if (this.isAlbumEntry && !this.navigatingAlbum) {
            uni.redirectTo({ url: `/pages/session/album?id=${this.sessionId}` });
            return;
          }
          if (
            this.openAlbumAfterClaim(
              wasConfirmedMember,
              activityGeneration
            )
          ) {
            return;
          }
          if (!(this.isClaimMode && !wasConfirmedMember)) {
            this.statusText = this.isClaimMode ? `${copy.success}。` : "已选择NPC角色。";
          }
          showToast({ title: this.isClaimMode ? copy.success : "已选择NPC角色", icon: "none" });
          return;
        }
        if (result.join_result === "pending_review") {
          const loaded = await this.loadPublishedSession(this.sessionId);
          if (!loaded || !this.roleSelectionOperationIsCurrent(operation)) {
            return;
          }
          await requestSignupReviewedSubscription();
          if (!this.roleSelectionOperationIsCurrent(operation)) {
            return;
          }
          this.statusText = "已提交NPC角色申请，等待车头审核。";
          showToast({ title: "已提交申请", icon: "none" });
          return;
        }
        const loaded = await this.loadPublishedSession(this.sessionId);
        if (!loaded || !this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
        this.statusText = "上车结果异常，请刷新后确认NPC角色状态。";
        showToast({ title: "上车结果异常，请稍后确认", icon: "none" });
      } catch (error) {
        if (!this.roleSelectionOperationIsCurrent(operation)) {
          return;
        }
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
        this.finishRoleSelectionOperation(operationEntry.operationId);
      }
    },
    hideShareMenus() {
      this.shareMenuGeneration += 1;
      if (typeof uni !== "undefined" && typeof uni.hideShareMenu === "function") {
        uni.hideShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
      }
    },
    showShareMenus() {
      if (
        !this.pageActive || this.navigatingAlbum ||
        !this.shareReady ||
        (this.isHistorical && !this.canShareCurrentSession) ||
        this.navigatingAlbum
      ) {
        this.hideShareMenus();
        return;
      }
      const activityGeneration = this.shareActivityGeneration;
      const generation = this.shareMenuGeneration + 1;
      this.shareMenuGeneration = generation;
      const showFriendShareMenu = () => {
        if (
          !this.pageActive || this.navigatingAlbum ||
          !this.isShareActivityCurrent(activityGeneration) ||
          generation !== this.shareMenuGeneration ||
          this.navigatingAlbum ||
          !this.shareReady
        ) {
          return;
        }
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

.flow-top.historical {
  display: block;
  margin-bottom: 24rpx;
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
