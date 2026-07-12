<template>
  <view class="page manage-page">
    <AuthIdentityBar />
    <FeedbackHost />

    <view class="section overview-card">
      <view class="overview-head">
        <view class="overview-main">
          <view class="overview-kicker">车局总览</view>
          <view class="overview-title-row">
            <view class="title">{{ session.script_name_snapshot || "车头管理" }}</view>
            <t-tag v-if="session.id" class="status-pill" theme="primary" variant="light" size="small">
              {{ sessionStatusLabel(session.status) }}
            </t-tag>
          </view>
          <view class="text">{{ summaryText }}</view>
        </view>
        <t-button class="overview-refresh" :disabled="busyAction" @tap="reload">
          {{ busyAction ? "处理中" : "刷新" }}
        </t-button>
      </view>
      <t-notice-bar
        v-if="operationText"
        class="notice"
        theme="warning"
        :visible="true"
        :content="operationText"
      />
      <view v-if="session.id" class="overview-stats">
        <view class="overview-stat">
          <view class="overview-stat-value">{{ seatStats.total }}</view>
          <view class="overview-stat-label">座位</view>
        </view>
        <view class="overview-stat">
          <view class="overview-stat-value">{{ seatStats.open }}</view>
          <view class="overview-stat-label">空位</view>
        </view>
        <view class="overview-stat warning">
          <view class="overview-stat-value">{{ seatStats.applied }}</view>
          <view class="overview-stat-label">待审</view>
        </view>
        <view class="overview-stat">
          <view class="overview-stat-value">{{ seatStats.onboard }}</view>
          <view class="overview-stat-label">已上车</view>
        </view>
      </view>
      <view v-if="session.id" class="overview-lines">
        <view class="overview-line">店家：{{ session.store_name_snapshot }}</view>
        <view class="overview-line">时间：{{ formattedStartAt }}</view>
      </view>
      <view v-if="session.id" class="overview-actions">
        <t-button
          v-if="canReschedule"
          class="mini-button muted"
          :disabled="busyAction"
          @tap="openReschedulePicker"
        >
          改期
        </t-button>
        <t-button class="mini-button muted" :disabled="busyAction" @tap="subscribeSignupReminder">
          申请提醒
        </t-button>
        <t-button class="mini-button muted" :disabled="busyAction" @tap="goDetail">车局详情</t-button>
        <t-button
          v-if="hasOtherOnboardMembers"
          class="mini-button muted"
          :disabled="busyAction"
          @tap="leaveOrganizer"
        >
          退出车头
        </t-button>
        <t-date-time-picker
          title="选择新的开本时间"
          :mode="['date', 'minute']"
          format="YYYY-MM-DD HH:mm"
          :visible="reschedulePickerVisible"
          :value="rescheduleValue"
          :start="rescheduleMinimum"
          @confirm="confirmRescheduleSelection"
          @cancel="closeReschedulePicker"
          @close="closeReschedulePicker"
        />
      </view>
      <view v-if="session.id" class="overview-pinned">
        <ManagePinnedMessage
          v-for="extension in sessionManageExtensions"
          :key="extension.id"
          :session-id="sessionId"
          :session="session"
          :busy="busyAction"
          :embedded="true"
          :auth-tools="authTools"
          @status="setStatus"
          @updated="reload"
        />
      </view>
    </view>

    <view v-if="session.id" class="section">
      <view class="section-head">
        <view>
          <view class="section-title">车局设置</view>
          <view class="section-note">像群设置一样，车头可以随时调整后续上车规则。</view>
        </view>
        <t-button
          class="mini-button"
          :class="{ disabled: busyAction || !settingsDirty }"
          :disabled="busyAction || !settingsDirty"
          @tap="updateSessionSettings"
        >
          {{ settingsDirty ? "保存" : "已保存" }}
        </t-button>
      </view>
      <view class="setting-switch-row">
        <view class="setting-switch-copy">
          <view class="setting-title">上车审核</view>
          <view class="section-note">
            开启后，玩家和NPC申请需要车头通过；关闭后可直接上车。
          </view>
        </view>
        <view class="setting-switch-meta">
          <view class="setting-switch-label">
            {{ joinPolicy === "review_required" ? "需要审核" : "直接上车" }}
          </view>
          <t-switch
            color="#1f7a68"
            :value="joinPolicy === 'review_required'"
            :disabled="busyAction"
            @change="setJoinPolicy($event.detail.value ? 'review_required' : 'direct')"
          />
        </view>
      </view>
      <view class="setting-switch-row">
        <view class="setting-switch-copy">
          <view class="setting-title">上车必须留电话</view>
          <view class="section-note">关闭后，玩家和NPC仍需登录，但可以不授权手机号也能上车或申请。</view>
        </view>
        <view class="setting-switch-meta">
          <view class="setting-switch-label">{{ joinPhoneRequired ? "已开启" : "已关闭" }}</view>
          <t-switch
            color="#1f7a68"
            :value="joinPhoneRequired"
            :disabled="busyAction"
            @change="setJoinPhoneRequired($event.detail.value)"
          />
        </view>
      </view>
      <view class="setting-switch-row">
        <view class="setting-switch-copy">
          <view class="setting-title">允许NPC工作人员自选角色</view>
          <view class="section-note">关闭后，由车头在管理页手动安排NPC角色。</view>
        </view>
        <view class="setting-switch-meta">
          <view class="setting-switch-label">{{ npcJoinEnabled ? "已开启" : "已关闭" }}</view>
          <t-switch
            color="#1f7a68"
            :value="npcJoinEnabled"
            :disabled="busyAction"
            @change="setNpcJoinEnabled($event.detail.value)"
          />
        </view>
      </view>
    </view>

    <RoleSeatBoard
      v-if="manageRoleSeatSections.length"
      :sections="manageRoleSeatSections"
      empty-text="暂无座位或NPC角色。"
      @actiontap="handleManageRoleSeatAction"
    />

    <RoleSeatBoard
      v-if="session.id"
      title="上车申请"
      :summary="signupSummary"
      :items="signupCards"
      empty-text="暂无申请。"
      @actiontap="handleSignupAction"
    />

    <view v-if="session.id" class="section danger-section">
      <view v-if="!hasOtherOnboardMembers && !hasActiveAlbumPhotos">
        <view class="section-title">取消车</view>
        <view class="section-note">取消后这辆车会被直接删除，座位、报名、聊天和相册记录会一起删除。</view>
        <t-textarea
          :value="cancelReason"
          class="textarea"
          maxlength="200"
          placeholder="可选：写一句取消原因"
          placeholder-class="placeholder"
          @change="cancelReason = $event.detail.value"
        />
        <view class="actions">
          <t-button
            class="button danger"
            :disabled="busyAction"
            @tap="cancelSession"
          >
            取消本车
          </t-button>
        </view>
      </view>
      <view v-else-if="hasOtherOnboardMembers">
        <view class="section-title">退出车头</view>
        <view class="section-note">已有玩家上车，不能取消删除；请退出车头，系统会转给下一位已上车成员。</view>
      </view>
      <view v-else>
        <view class="section-title">先删照片</view>
        <view class="section-note">相册已有照片，不能取消删除；请先删除所有照片，避免留下无主照片。</view>
        <view class="actions">
          <t-button class="button secondary" :disabled="busyAction" @tap="goAlbum">打开相册</t-button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import RoleSeatBoard from "../../components/RoleSeatBoard.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import ManagePinnedMessage from "../../extensions/session-pseudo-chat/ManagePinnedMessage.vue";
import { sessionManageExtensions } from "../../extensions/sessionExtensions.js";
import { dataOf, ensureLoggedIn, request } from "../../utils/api";
import { normalizeRoleGender, roleGenderSymbol } from "../../utils/createFlow";
import {
  buildRescheduleConfirmation,
  canRescheduleSession,
  formatSessionStartAt,
  validateRescheduleSelection
} from "../../utils/sessionReschedule";
import { requestSignupCreatedSubscription } from "../../utils/subscribeMessages";
import { showActionSheet, showModal, showToast } from "../../utils/tdesignFeedback";

function booleanSetting(value, fallback = true) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return ["1", "true", "enabled"].includes(String(value).trim().toLowerCase());
}

function formatSessionDateTime(value) {
  return formatSessionStartAt(value);
}

export default {
  components: { AuthIdentityBar, RoleSeatBoard, ManagePinnedMessage, FeedbackHost },
  data() {
    return {
      sessionId: "",
      session: {},
      signups: [],
      sessionManageExtensions,
      joinPolicy: "review_required",
      joinPhoneRequired: true,
      npcJoinEnabled: true,
      statusText: "",
      busyAction: false,
      busyText: "",
      cancelReason: "",
      reschedulePickerVisible: false,
      rescheduleValue: "",
      rescheduleMinimum: ""
    };
  },
  computed: {
    operationText() {
      if (this.busyAction) {
        return this.busyText || "正在处理，请稍候...";
      }
      return this.statusText;
    },
    summaryText() {
      if (!this.session.id) {
        return "加载车况、提醒、详情和置顶信息。";
      }
      return `${this.session.store_name_snapshot} / ${this.formattedStartAt}`;
    },
    formattedStartAt() {
      return formatSessionDateTime(this.session.start_at);
    },
    canReschedule() {
      return canRescheduleSession(this.session.start_at);
    },
    seatSummary() {
      const seats = this.session.seats || [];
      const open = seats.filter((seat) => seat.status === "open").length;
      const applied = seats.filter((seat) => seat.status === "applied").length;
      const confirmed = seats.filter((seat) => seat.status === "confirmed").length;
      const locked = seats.filter((seat) => seat.status === "locked").length;
      return `${seats.length}位，${open}空位，${applied}待审，${confirmed + locked}已上车`;
    },
    seatStats() {
      const seats = this.session.seats || [];
      const open = seats.filter((seat) => seat.status === "open").length;
      const applied = seats.filter((seat) => seat.status === "applied").length;
      const confirmed = seats.filter((seat) => seat.status === "confirmed").length;
      const locked = seats.filter((seat) => seat.status === "locked").length;
      return {
        total: seats.length,
        open,
        applied,
        onboard: confirmed + locked
      };
    },
    authTools() {
      return { dataOf, request };
    },
    hasOtherOnboardMembers() {
      return this.otherOnboardMemberCount > 0;
    },
    otherOnboardMemberCount() {
      const organizerId = Number(this.session.organizer_user_id);
      const userIds = new Set();
      for (const seat of this.session.seats || []) {
        const userId = Number(seat.confirmed_user_id);
        if (["confirmed", "locked"].includes(seat.status) && userId && userId !== organizerId) {
          userIds.add(userId);
        }
      }
      for (const role of this.session.session_npc_roles || []) {
        const userId = Number(role.bound_user_id);
        if (role.status === "active" && userId && userId !== organizerId) {
          userIds.add(userId);
        }
      }
      if (
        Object.prototype.hasOwnProperty.call(this.session, "seats") ||
        Object.prototype.hasOwnProperty.call(this.session, "session_npc_roles")
      ) {
        return userIds.size;
      }
      return Number(this.session.other_onboard_member_count || 0);
    },
    hasActiveAlbumPhotos() {
      return Number(this.session.active_album_photo_count || this.session.photo_count || 0) > 0;
    },
    settingsDirty() {
      if (!this.session.id) {
        return false;
      }
      return (
        this.joinPolicy !== this.sessionJoinPolicy() ||
        this.joinPhoneRequired !== this.sessionJoinPhoneRequired() ||
        this.npcJoinEnabled !== this.sessionNpcJoinEnabled()
      );
    },
    manageSeatCards() {
      return (this.session.seats || []).map((seat) => {
        const actions = [];
        if (this.canTransferOrganizerToSeat(seat)) {
          actions.push({
            key: "transfer",
            label: "转让车头",
            disabled: this.busyAction
          });
        }
        if (this.canKickSeat(seat)) {
          actions.push({
            key: "kick",
            label: this.kickSeatActionText(seat),
            variant: "ghost",
            disabled: this.busyAction
          });
        }
        return {
          id: seat.id,
          seatId: seat.id,
          raw: seat,
          name: seat.name,
          note: `${seat.role_name || "未标注"} · ${this.seatTypeLabel(seat.seat_type)}`,
          roleGender: seat.role_gender || "unlimited",
          avatarUrl: seat.confirmed_user_avatar_url || "",
          avatarGender: seat.confirmed_user_gender || seat.role_gender || "unlimited",
          confirmedUserId: seat.confirmed_user_id || "",
          stateKind: this.seatStateKind(seat),
          stateLabel: this.seatStatusLabel(seat.status),
          actions
        };
      });
    },
    npcRoleSummary() {
      const roles = this.session.session_npc_roles || [];
      const available = roles.filter((role) => this.npcRoleStateKind(role) === "available").length;
      const pending = roles.filter((role) => this.npcRoleStateKind(role) === "pendingReview").length;
      const assigned = roles.filter((role) => this.npcRoleStateKind(role) === "taken").length;
      return `${roles.length}个NPC，${available}可安排，${pending}待审，${assigned}已安排`;
    },
    manageNpcRoleCards() {
      return (this.session.session_npc_roles || []).map((role) => {
        const stateKind = this.npcRoleStateKind(role);
        const actions = [];
        if (this.npcRoleActionText(role)) {
          actions.push({
            key: "manageNpcRole",
            label: this.npcRoleActionText(role),
            variant: "ghost",
            disabled: this.busyAction
          });
        }
        return {
          id: `npc-${role.id}`,
          npcRoleId: role.id,
          raw: role,
          boardType: "npc",
          name: role.name || "NPC角色",
          note: role.bound_user_name || role.description || "NPC工作人员",
          roleGender: normalizeRoleGender(role.role_gender || "unlimited"),
          genderSymbol: this.npcRoleGenderText(role.role_gender),
          avatarUrl: role.bound_user_avatar_url || "",
          avatarGender: role.bound_user_gender || role.role_gender || "unlimited",
          boundUserId: role.bound_user_id || "",
          showGenderSymbol: true,
          stateKind,
          stateLabel: this.npcRoleStatusLabel(role),
          meta: [
            role.source ? { key: "source", label: "来源", text: role.source === "script" ? "剧本固定" : "本场额外" } : null,
            role.pending_signup_id ? { key: "pending", label: "申请", text: "等待车头审核" } : null
          ].filter(Boolean),
          actions
        };
      });
    },
    manageRoleSeatSections() {
      const sections = [];
      if (this.session.seats?.length) {
        sections.push({
          key: "seat",
          title: "座位状态",
          summary: this.seatSummary,
          items: this.manageSeatCards
        });
      }
      if (this.manageNpcRoleCards.length) {
        sections.push({
          key: "npc",
          title: "NPC角色",
          summary: this.npcRoleSummary,
          statusPill: this.npcJoinEnabled ? "允许自选" : "车头安排",
          items: this.manageNpcRoleCards
        });
      }
      return sections;
    },
    visibleSignups() {
      return (this.signups || []).filter((signup) => signup.status !== "rejected");
    },
    signupSummary() {
      const visibleSignups = this.visibleSignups;
      const pending = visibleSignups.filter((signup) => signup.status === "pending").length;
      const approved = visibleSignups.filter((signup) => signup.status === "approved").length;
      return `${pending} 个待审，${approved} 个已通过`;
    },
    signupCards() {
      return (this.visibleSignups || []).map((signup) => {
        const pending = signup.status === "pending";
        return {
          id: `signup-${signup.id}`,
          raw: signup,
          name: this.applicantName(signup),
          note: signup.contact_text || "车内聊天沟通",
          roleGender: this.isNpcSignup(signup)
            ? normalizeRoleGender(signup.npc_role_gender)
            : "unlimited",
          genderSymbol: this.isNpcSignup(signup)
            ? this.npcRoleGenderText(signup.npc_role_gender)
            : "",
          showGenderSymbol: this.isNpcSignup(signup),
          stateKind: pending
            ? "pendingReview"
            : signup.status === "approved"
              ? "taken"
              : "unavailable",
          stateLabel: this.signupStatusLabel(signup.status),
          meta: [
            { key: "target", label: "申请目标", text: this.signupTargetName(signup) },
            signup.note ? { key: "note", label: "备注", text: signup.note } : null,
            {
              key: "target-status",
              label: this.isNpcSignup(signup) ? "NPC角色" : "座位状态",
              text: this.signupTargetStatus(signup)
            }
          ].filter(Boolean),
          actions: pending
            ? [
                { key: "approve", label: "通过", disabled: this.busyAction },
                { key: "reject", label: "拒绝", variant: "ghost", disabled: this.busyAction }
              ]
            : []
        };
      });
    }
  },
  async onLoad(options) {
    const auth = await ensureLoggedIn({
      content: "登录后继续管理你创建的车。"
    });
    if (!auth) {
      this.statusText = "登录后可继续管理发车。";
      return;
    }
    this.sessionId = options.id || "";
    this.reload();
  },
  methods: {
    async ensureManageActionLogin() {
      const auth = await ensureLoggedIn({
        content: "登录后继续管理你创建的车。"
      });
      if (!auth) {
        this.statusText = "登录后可继续管理发车。";
        return null;
      }
      return auth;
    },
    async reload() {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      if (!this.sessionId || this.sessionId === "d1-demo") {
        this.statusText = "请从我的发车进入管理页。";
        return;
      }
      await this.loadSession();
      await this.loadSignups();
    },
    openReschedulePicker() {
      if (this.busyAction || !this.canReschedule) {
        return;
      }
      if (!this.rescheduleValue) {
        this.rescheduleValue = formatSessionStartAt(this.session.start_at);
      }
      this.rescheduleMinimum = formatSessionStartAt(new Date());
      this.reschedulePickerVisible = true;
    },
    closeReschedulePicker() {
      this.reschedulePickerVisible = false;
    },
    confirmRescheduleSelection(event) {
      const selectedValue = event?.detail?.value || this.rescheduleValue;
      this.rescheduleValue = selectedValue;
      this.reschedulePickerVisible = false;
      const validation = validateRescheduleSelection(
        selectedValue,
        this.session.start_at,
        new Date()
      );
      if (!validation.valid) {
        this.statusText = validation.message;
        return;
      }
      const memberCount = this.otherOnboardMemberCount;
      showModal({
        title: "确认改期",
        content: buildRescheduleConfirmation({
          memberCount,
          oldStartAt: this.session.start_at,
          newStartAt: validation.startAt
        }),
        confirmText: "确认改期",
        cancelText: "再想想",
        success: (result) => {
          if (result.confirm) {
            this.rescheduleSession(validation.startAt, memberCount > 0);
          }
        }
      });
    },
    async rescheduleSession(startAt, membersConfirmed) {
      if (this.busyAction) {
        return;
      }
      this.busyAction = true;
      this.busyText = "正在改期，请稍候...";
      try {
        const response = await request({
          url: `/api/sessions/${this.sessionId}/reschedule`,
          method: "POST",
          data: { startAt, membersConfirmed }
        });
        const updatedSession = dataOf(response) || {};
        const delivery = updatedSession.notification_delivery || {};
        await this.reload();
        this.statusText = this.rescheduleDeliveryText(delivery);
        showToast({ title: "改期成功", icon: "none" });
      } catch (error) {
        this.statusText = this.rescheduleErrorText(error);
        if (this.rescheduleErrorRequiresRefresh(error)) {
          await this.reload();
          this.statusText = this.rescheduleErrorText(error);
        }
      } finally {
        this.busyAction = false;
        this.busyText = "";
      }
    },
    rescheduleDeliveryText(delivery) {
      const recipients = Number(delivery.recipients || 0);
      const sent = Number(delivery.sent || 0);
      const skipped = Number(delivery.skipped || 0);
      const failed = Number(delivery.failed || 0);
      return `改期成功。通知对象 ${recipients} 人：已发送 ${sent}，已跳过 ${skipped}，失败 ${failed}。`;
    },
    rescheduleErrorRequiresRefresh(error) {
      const message = String(error?.data?.error?.message || "").toLowerCase();
      return error?.statusCode === 409 && /past|started/.test(message);
    },
    rescheduleErrorText(error) {
      const message = String(error?.data?.error?.message || "").toLowerCase();
      if (error?.statusCode === 409 && /confirmation/.test(message)) {
        return "已上车成员发生变化，请重新确认改期和通知人数。";
      }
      if (error?.statusCode === 409 && /past|started/.test(message)) {
        return "车局已经开始，不能再改期；页面已刷新。";
      }
      if (/future|past/.test(message)) {
        return "新时间必须晚于当前时间，请重新选择。";
      }
      if (/change|unchanged/.test(message)) {
        return "新时间与当前时间相同，请重新选择。";
      }
      if (/startat|timezone|timestamp|valid/.test(message)) {
        return "所选时间无效，请重新选择。";
      }
      return "改期失败，请保留当前选择后重试。";
    },
    async loadSession() {
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}` });
        this.session = dataOf(response) || {};
        this.syncSessionSettings();
      } catch (error) {
        this.statusText = "车详情加载失败，请稍后重试。";
      }
    },
    async loadSignups() {
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/signups` });
        this.signups = dataOf(response) || [];
        this.statusText = "";
      } catch (error) {
        if (error?.statusCode === 403) {
          this.statusText = "只有车头可以管理本车。";
        } else if (error?.statusCode === 401) {
          this.statusText = "请先登录后再管理发车。";
        } else {
          this.statusText = "申请列表加载失败，请稍后重试。";
        }
        this.signups = [];
      }
    },
    setStatus(statusText) {
      this.statusText = statusText;
    },
    sessionJoinPolicy() {
      return this.session.join_policy === "direct" ? "direct" : "review_required";
    },
    sessionJoinPhoneRequired() {
      return booleanSetting(this.session.join_phone_required, true);
    },
    sessionNpcJoinEnabled() {
      return booleanSetting(this.session.npc_join_enabled, true);
    },
    syncSessionSettings() {
      this.joinPolicy = this.sessionJoinPolicy();
      this.joinPhoneRequired = this.sessionJoinPhoneRequired();
      this.npcJoinEnabled = this.sessionNpcJoinEnabled();
    },
    setJoinPolicy(value) {
      this.joinPolicy = value === "direct" ? "direct" : "review_required";
    },
    setJoinPhoneRequired(value) {
      this.joinPhoneRequired = Boolean(value);
    },
    setNpcJoinEnabled(value) {
      this.npcJoinEnabled = Boolean(value);
    },
    async updateSessionSettings() {
      const auth = await this.ensureManageActionLogin();
      if (!auth || !this.settingsDirty) {
        return;
      }
      const nextSettings = {
        joinPolicy: this.joinPolicy,
        joinPhoneRequired: this.joinPhoneRequired,
        npcJoinEnabled: this.npcJoinEnabled
      };
      if (this.busyAction) {
        return;
      }
      this.busyAction = true;
      this.busyText = "正在处理，请稍候...";
      try {
        await request({
          url: `/api/sessions/${this.sessionId}`,
          method: "PATCH",
          data: {
            joinPolicy: nextSettings.joinPolicy,
            join_policy: nextSettings.joinPolicy,
            joinPhoneRequired: nextSettings.joinPhoneRequired,
            join_phone_required: nextSettings.joinPhoneRequired,
            npcJoinEnabled: nextSettings.npcJoinEnabled,
            npc_join_enabled: nextSettings.npcJoinEnabled
          }
        });
        await this.reload();
        this.statusText = this.settingsUpdatePersisted(nextSettings)
          ? "车局设置已更新。"
          : "车局设置没有生效，请确认后端已部署最新车局设置接口。";
      } catch (error) {
        this.statusText = this.actionErrorText(error);
      } finally {
        this.busyAction = false;
        this.busyText = "";
      }
    },
    settingsUpdatePersisted(settings) {
      return (
        this.joinPolicy === settings.joinPolicy &&
        this.joinPhoneRequired === settings.joinPhoneRequired &&
        this.npcJoinEnabled === settings.npcJoinEnabled
      );
    },
    async approve(signup) {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      await this.runAction("已通过申请，玩家可进入车内聊天。", {
        url: `/api/signups/${signup.id}/approve`,
        method: "PATCH"
      });
    },
    async reject(signup) {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      await this.runAction("已拒绝申请。", {
        url: `/api/signups/${signup.id}/reject`,
        method: "PATCH"
      });
    },
    async subscribeSignupReminder() {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      const result = await requestSignupCreatedSubscription();
      this.statusText =
        result.status === "accept" ||
        result.status === "acceptWithAudio" ||
        result.status === "acceptWithAlert"
          ? "已开启新申请提醒。"
          : "未开启提醒，也不影响你继续管理申请。";
    },
    async kickSeat(seat) {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      if (this.isOnboardSeat(seat)) {
        this.showRemoveMemberReasons(seat);
        return;
      }
      this.confirmAction(`确认释放「${seat.name}」吗？`, async () => {
        await this.runKickSeat(seat, {}, "座位已释放。");
      });
    },
    removeReasonOptions() {
      return [
        {
          label: "普通释放",
          report: false,
          successText: "座位已释放。"
        },
        {
          label: "恶意骚扰",
          reasonType: "harassment",
          report: true,
          successText: "已移除并举报，该成员不能再次加入本车。"
        },
        {
          label: "垃圾信息",
          reasonType: "spam",
          report: true,
          successText: "已移除并举报，该成员不能再次加入本车。"
        },
        {
          label: "疑似诈骗",
          reasonType: "scam",
          report: true,
          successText: "已移除并举报，该成员不能再次加入本车。"
        },
        {
          label: "其他安全原因",
          reasonType: "safety_other",
          report: true,
          successText: "已移除并举报，该成员不能再次加入本车。"
        }
      ];
    },
    showRemoveMemberReasons(seat) {
      const options = this.removeReasonOptions();
      showActionSheet({
        itemList: options.map((option) => option.label),
        success: (result) => {
          const option = options[result.tapIndex];
          if (!option) {
            return;
          }
          const confirmText = option.report
            ? `确认将「${seat.name}」移除并按「${option.label}」举报吗？该成员不能再次加入本车。`
            : `确认普通释放「${seat.name}」吗？`;
          this.confirmAction(confirmText, async () => {
            await this.runKickSeat(
              seat,
              option.report
                ? {
                    report: true,
                    reasonType: option.reasonType
                  }
                : {},
              option.successText
            );
          });
        }
      });
    },
    async runKickSeat(seat, data, successText) {
      await this.runAction(successText, {
        url: `/api/session-seats/${seat.id}/kick`,
        method: "PATCH",
        data
      });
    },
    async transferOrganizerToSeat(seat) {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      this.confirmAction(`确认把车头转让给「${seat.name}」吗？`, async () => {
        await this.runOrganizerTransition("车头已转让。", {
          url: `/api/sessions/${this.sessionId}/organizer/transfer`,
          method: "PATCH",
          data: {
            targetUserId: seat.confirmed_user_id
          }
        });
      });
    },
    async handleNpcRoleManagement(role) {
      if (role.bound_user_id) {
        await this.releaseNpcRole(role);
        return;
      }
      if (role.status && role.status !== "active") {
        await this.openNpcRole(role);
        return;
      }
      await this.closeNpcRole(role);
    },
    async closeNpcRole(role) {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      this.confirmAction(`确认关闭NPC角色「${role.name || "NPC角色"}」吗？`, async () => {
        await this.runAction("NPC角色已关闭。", {
          url: `/api/session-npc-roles/${role.id}`,
          method: "PATCH",
          data: {
            status: "inactive"
          }
        });
      });
    },
    async openNpcRole(role) {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      this.confirmAction(`确认开放NPC角色「${role.name || "NPC角色"}」吗？`, async () => {
        await this.runAction("NPC角色已开放。", {
          url: `/api/session-npc-roles/${role.id}`,
          method: "PATCH",
          data: {
            status: "active"
          }
        });
      });
    },
    async releaseNpcRole(role) {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      this.confirmAction(`确认移除NPC成员「${role.name || "NPC角色"}」吗？`, async () => {
        await this.runAction("NPC成员已移除。", {
          url: `/api/session-npc-roles/${role.id}`,
          method: "PATCH",
          data: {
            boundUserId: null
          }
        });
      });
    },
    async leaveOrganizer() {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      this.confirmAction("确认退出车头吗？系统会交给下一位已上车成员。", async () => {
        await this.runOrganizerTransition("已退出车头。", {
          url: `/api/sessions/${this.sessionId}/organizer/leave`,
          method: "PATCH"
        });
      });
    },
    async cancelSession() {
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      if (this.hasActiveAlbumPhotos) {
        this.confirmAction("相册已有照片，不能取消删除。要先打开相册删除所有照片吗？", () => {
          this.goAlbum();
        });
        return;
      }
      this.confirmAction("确认取消本车吗？取消后这辆车会被直接删除。", async () => {
        await this.runCancelSession();
      });
    },
    async runCancelSession() {
      if (this.busyAction) {
        return;
      }
      this.busyAction = true;
      this.busyText = "正在取消本车...";
      try {
        await request({
          url: `/api/sessions/${this.sessionId}/cancel`,
          method: "PATCH",
          data: {
            reason: this.cancelReason.trim()
          }
        });
        this.statusText = "本车已取消。";
        showToast({ title: "本车已取消", icon: "none" });
        uni.redirectTo({ url: "/pages/mine/index" });
      } catch (error) {
        this.statusText = this.cancelSessionErrorText(error);
      } finally {
        this.busyAction = false;
        this.busyText = "";
      }
    },
    confirmAction(content, onConfirm) {
      if (this.busyAction) {
        return;
      }
      showModal({
        title: "确认操作",
        content,
        confirmText: "确认",
        cancelText: "再想想",
        success: (result) => {
          if (result.confirm) {
            onConfirm();
          }
        }
      });
    },
    async runAction(successText, options) {
      if (this.busyAction) {
        return;
      }
      this.busyAction = true;
      this.busyText = "正在处理，请稍候...";
      try {
        await request(options);
        await this.reload();
        this.statusText = successText;
      } catch (error) {
        this.statusText = this.actionErrorText(error);
      } finally {
        this.busyAction = false;
        this.busyText = "";
      }
    },
    async runOrganizerTransition(successText, options) {
      if (this.busyAction) {
        return;
      }
      this.busyAction = true;
      this.busyText = "正在处理，请稍候...";
      try {
        await request(options);
        this.statusText = successText;
        showToast({ title: successText, icon: "none" });
        const id = this.sessionId || "d1-demo";
        uni.redirectTo({ url: `/pages/session/detail?id=${id}` });
      } catch (error) {
        this.statusText = this.actionErrorText(error);
      } finally {
        this.busyAction = false;
        this.busyText = "";
      }
    },
    actionErrorText(error) {
      if (error?.statusCode === 403) {
        return "只有车头可以执行这个操作。";
      }
      if (error?.statusCode === 409) {
        return "暂无可接任的车友，请先确认有人已上车。";
      }
      return "操作失败，请稍后重试。";
    },
    cancelSessionErrorText(error) {
      if (error?.data?.error?.code === "SESSION_HAS_ONBOARD_MEMBERS") {
        return "已有玩家上车，不能取消删除；请退出车头。";
      }
      if (error?.data?.error?.code === "SESSION_HAS_ALBUM_PHOTOS") {
        return "相册已有照片，请先删除所有照片后再取消这辆车。";
      }
      return this.actionErrorText(error);
    },
    goAlbum() {
      if (this.busyAction) {
        return;
      }
      const id = this.sessionId || "d1-demo";
      uni.navigateTo({ url: `/pages/session/album?id=${id}` });
    },
    async goDetail() {
      if (this.busyAction) {
        return;
      }
      const auth = await this.ensureManageActionLogin();
      if (!auth) {
        return;
      }
      const id = this.sessionId || "d1-demo";
      uni.navigateTo({ url: `/pages/session/detail?id=${id}` });
    },
    seatById(seatId) {
      return (this.session.seats || []).find((seat) => Number(seat.id) === Number(seatId));
    },
    seatName(seatId) {
      return this.seatById(seatId)?.name || `座位 ${seatId}`;
    },
    seatStatus(seatId) {
      return this.seatById(seatId)?.status || "";
    },
    isNpcSignup(signup) {
      return signup?.signup_type === "session_npc_role";
    },
    applicantName(signup) {
      const nickname = String(signup?.applicant_nickname || "").trim();
      if (nickname) {
        return nickname;
      }
      const fallback = String(signup?.applicant_open_id || "").trim();
      return fallback || "未命名申请人";
    },
    signupTargetName(signup) {
      if (this.isNpcSignup(signup)) {
        return `NPC角色：${signup.npc_role_name || "待定"}`;
      }
      return this.seatName(signup.seat_id);
    },
    npcRoleGenderText(roleGender) {
      return roleGenderSymbol(roleGender) || "不限";
    },
    signupTargetStatus(signup) {
      if (this.isNpcSignup(signup)) {
        return signup.npc_role_status === "active" ? "可安排" : "不可用";
      }
      return this.seatStatusLabel(this.seatStatus(signup.seat_id));
    },
    canKickSeat(seat) {
      return Boolean(seat?.id);
    },
    isOnboardSeat(seat) {
      return Boolean(
        seat?.confirmed_user_id && ["confirmed", "locked"].includes(seat.status)
      );
    },
    kickSeatActionText(seat) {
      return this.isOnboardSeat(seat) ? "移除成员" : "关闭座位";
    },
    canTransferOrganizerToSeat(seat) {
      return (
        seat?.confirmed_user_id &&
        Number(seat.confirmed_user_id) !== Number(this.session.organizer_user_id)
      );
    },
    handleManageSeatAction(payload) {
      const seat = payload.item.raw;
      if (!seat) {
        return;
      }
      if (payload.action.key === "transfer") {
        this.transferOrganizerToSeat(seat);
        return;
      }
      if (payload.action.key === "kick") {
        this.kickSeat(seat);
      }
    },
    handleManageRoleSeatAction(payload) {
      if (payload.item?.boardType === "npc" || payload.sectionKey === "npc") {
        const role = payload.item.raw;
        if (role && payload.action.key === "manageNpcRole") {
          this.handleNpcRoleManagement(role);
        }
        return;
      }
      this.handleManageSeatAction(payload);
    },
    handleSignupAction(payload) {
      const signup = payload.item.raw;
      if (!signup) {
        return;
      }
      if (payload.action.key === "approve") {
        this.approve(signup);
        return;
      }
      if (payload.action.key === "reject") {
        this.reject(signup);
      }
    },
    seatStateKind(seat) {
      if (seat.status === "open") {
        return "available";
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
      if (role.bound_user_id) {
        return "taken";
      }
      if (role.pending_signup_id) {
        return "pendingReview";
      }
      if (role.status && role.status !== "active") {
        return "unavailable";
      }
      return "available";
    },
    npcRoleActionText(role) {
      if (role.bound_user_id) {
        return "移除成员";
      }
      if (role.pending_signup_id) {
        return "";
      }
      return role.status && role.status !== "active" ? "开放角色" : "关闭角色";
    },
    npcRoleStatusLabel(role) {
      const stateKind = this.npcRoleStateKind(role);
      if (stateKind === "taken") {
        return "已安排";
      }
      if (stateKind === "pendingReview") {
        return "待审核";
      }
      if (stateKind === "unavailable") {
        return "不可用";
      }
      return this.npcJoinEnabled ? "可自选" : "可安排";
    },
    sessionStatusLabel(status) {
      const labels = {
        draft: "草稿",
        recruiting: "招募中",
        locked: "已锁车",
        cancelled: "已取消"
      };
      return labels[status] || status || "未知";
    },
    seatStatusLabel(status) {
      const labels = {
        open: "开放",
        applied: "待审核",
        confirmed: "已上车",
        locked: "已锁定",
        cancelled: "已取消"
      };
      return labels[status] || status || "未知";
    },
    signupStatusLabel(status) {
      const labels = {
        pending: "待审核",
        approved: "已通过",
        rejected: "已拒绝",
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
.manage-page {
  padding-bottom: 64rpx;
}

.overview-card {
  padding-bottom: 26rpx;
}

.overview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18rpx;
}

.overview-main {
  min-width: 0;
  flex: 1;
}

.overview-kicker {
  margin-bottom: 8rpx;
  color: #7a857d;
  font-size: 22rpx;
  font-weight: 600;
}

.overview-title-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.overview-title-row .title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-pill {
  flex-shrink: 0;
  padding: 6rpx 14rpx;
  border-radius: 8rpx;
  background: #edf7f2;
  color: #1f6f5b;
  font-size: 22rpx;
  font-weight: 600;
  line-height: 1.35;
}

.overview-refresh {
  flex-shrink: 0;
  min-width: 112rpx;
  height: 58rpx;
  padding: 0 18rpx;
  border: 1rpx solid #ded8ca;
  border-radius: 8rpx;
  background: #fffefb;
  color: #193d35;
  font-size: 24rpx;
  font-weight: 600;
  line-height: 58rpx;
}

.overview-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12rpx;
  margin-top: 22rpx;
}

.overview-stat {
  min-width: 0;
  padding: 16rpx 10rpx;
  border: 1rpx solid rgba(222, 216, 202, 0.8);
  border-radius: 8rpx;
  background: #fffefb;
  text-align: center;
}

.overview-stat.warning {
  border-color: rgba(204, 151, 83, 0.45);
  background: #fff9ec;
}

.overview-stat-value {
  color: #153f34;
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1.2;
}

.overview-stat-label {
  margin-top: 4rpx;
  color: #738078;
  font-size: 22rpx;
  line-height: 1.2;
}

.overview-lines {
  margin-top: 18rpx;
  padding-top: 18rpx;
  border-top: 1rpx solid rgba(222, 216, 202, 0.72);
}

.overview-line {
  margin-top: 8rpx;
  color: #475569;
  font-size: 25rpx;
  line-height: 1.45;
}

.overview-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
  margin-top: 20rpx;
}

.overview-actions .mini-button {
  width: 100%;
  margin: 0;
}

.overview-pinned {
  margin-top: 24rpx;
}

.section-title {
  margin-bottom: 18rpx;
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20rpx;
}

.section-note {
  color: #738078;
  font-size: 24rpx;
  line-height: 1.45;
}

.setting-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  padding: 22rpx 0;
  border-top: 1rpx solid rgba(222, 216, 202, 0.72);
}

.section-head + .setting-switch-row {
  margin-top: 12rpx;
}

.setting-switch-copy {
  min-width: 0;
  flex: 1;
}

.setting-switch-meta {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.setting-switch-label {
  min-width: 88rpx;
  color: #153f34;
  font-size: 24rpx;
  font-weight: 600;
  line-height: 1.3;
  text-align: right;
}

.setting-title {
  margin-bottom: 6rpx;
  color: #153f34;
  font-size: 26rpx;
  font-weight: 600;
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

.info-row {
  margin-top: 10rpx;
  color: #475569;
  font-size: 26rpx;
  line-height: 1.5;
}

.textarea {
  width: 100%;
  height: 132rpx;
  margin-top: 18rpx;
  padding: 20rpx 22rpx;
  box-sizing: border-box;
  border-radius: 14rpx;
  background: #f4f1ea;
  color: #183d34;
  font-size: 26rpx;
  line-height: 1.45;
}

.placeholder {
  color: #9ba39c;
}

.actions.compact {
  gap: 12rpx;
  margin-top: 18rpx;
}

.mini-button {
  height: 64rpx;
  border-radius: 8rpx;
  background: #1f6f5b;
  color: #ffffff;
  font-size: 24rpx;
  line-height: 64rpx;
}

.mini-button.disabled,
.mini-button[disabled] {
  opacity: 0.45;
}

.mini-button.muted {
  background: #ffffff;
  color: #193d35;
  border: 1rpx solid #ded8ca;
}

.button.danger {
  background: #9f3f33;
  box-shadow: 0 12rpx 28rpx rgba(159, 63, 51, 0.18);
}

.danger-section {
  border-color: #ead2ca;
}
</style>
