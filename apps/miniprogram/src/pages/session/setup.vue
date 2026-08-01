<template>
  <view class="page flow-page">
    <AuthIdentityBar />
    <FeedbackHost />

    <view class="flow-top">
      <view class="step-label">4 / 5</view>
      <view class="title">开本设置</view>
      <view class="text">确认开本时间和车内置顶信息，创建后就可以分享给玩家。</view>
    </view>

    <view class="section setup-summary">
      <view class="section-title">{{ scriptName }}</view>
      <view class="info-row">店家：{{ storeName }}</view>
      <view class="info-row">我的角色：{{ roleName }}</view>
    </view>

    <view class="section">
      <view class="section-title">开本时间</view>
      <view class="picker-row">
        <view class="picker-field" @tap="openDatePicker">
          <t-image class="inline-icon" src="/static/icons/clock.png" mode="aspectFit" />
          <text>{{ dateValue }}</text>
        </view>
        <view class="picker-field" @tap="openTimePicker">
          <t-image class="inline-icon" src="/static/icons/clock.png" mode="aspectFit" />
          <text>{{ timeValue }}</text>
        </view>
        <t-date-time-picker
          title="选择日期"
          mode="date"
          format="YYYY-MM-DD"
          :visible="datePickerVisible"
          :value="dateValue"
          @confirm="onDateChange"
          @cancel="closeDatePicker"
          @close="closeDatePicker"
        />
        <t-date-time-picker
          title="选择时间"
          :mode="['hour', 'minute']"
          format="HH:mm"
          :visible="timePickerVisible"
          :value="timeValue"
          :start="TIME_PICKER_START"
          :end="TIME_PICKER_END"
          @confirm="onTimeChange"
          @cancel="closeTimePicker"
          @close="closeTimePicker"
        />
      </view>
      <view v-if="isHistorical" class="historical-notice">
        当前为历史补录，仅用于记录已完成的车局，不会发布未来拼车。
      </view>
    </view>

    <view v-if="!isHistorical" class="section">
      <view class="section-title">上车权限</view>
      <view class="section-note">分享到群后，未上车玩家选择角色时使用此规则。</view>
      <view class="setting-switch-row">
        <view class="setting-switch-copy">
          <view class="setting-switch-title">上车审核</view>
          <view class="section-note">开启后，玩家和NPC申请需要车头通过；关闭后可直接上车。</view>
        </view>
        <view class="setting-switch-meta">
          <view class="setting-switch-label">
            {{ joinPolicy === "review_required" ? "需要审核" : "直接上车" }}
          </view>
          <t-switch
            color="#1f7a68"
            :value="joinPolicy === 'review_required'"
            @change="setJoinPolicy($event.detail.value ? 'review_required' : 'direct')"
          />
        </view>
      </view>
      <view class="setting-switch-row">
        <view class="setting-switch-copy">
          <view class="setting-switch-title">上车必须留电话</view>
          <view class="section-note">关闭后，玩家和NPC仍需登录，但可不授权手机号也能上车或提交申请</view>
        </view>
        <view class="setting-switch-meta">
          <view class="setting-switch-label">{{ joinPhoneRequired ? "已开启" : "已关闭" }}</view>
          <t-switch
            color="#1f7a68"
            :value="joinPhoneRequired"
            @change="setJoinPhoneRequired($event.detail.value)"
          />
        </view>
      </view>
      <view class="setting-switch-row">
        <view class="setting-switch-copy">
          <view class="setting-switch-title">允许NPC工作人员自选角色</view>
          <view class="section-note">关闭后由车头手动安排NPC角色</view>
        </view>
        <view class="setting-switch-meta">
          <view class="setting-switch-label">{{ npcJoinEnabled ? "已开启" : "已关闭" }}</view>
          <t-switch
            color="#1f7a68"
            :value="npcJoinEnabled"
            @change="setNpcJoinEnabled($event.detail.value)"
          />
        </view>
      </view>
      <view class="setting-switch-row">
        <view class="setting-switch-copy">
          <view class="setting-switch-title">同城展示</view>
          <view class="section-note">开启后，同城玩家可以发现这辆车；关闭后仅通过分享链接加入。</view>
        </view>
        <view class="setting-switch-meta">
          <view class="setting-switch-label">{{ cityVisible ? "已开启" : "已关闭" }}</view>
          <t-switch
            color="#1f7a68"
            :value="cityVisible"
            @change="setCityVisible($event.detail.value)"
          />
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-title">{{ isHistorical ? "补录说明" : "聊天置顶信息" }}</view>
      <view class="section-note">
        {{
          isHistorical
            ? "可选填写当时的角色分配或其他补充信息，留空不会新增置顶说明。"
            : "留空会使用默认信息，创建后会作为车内聊天的置顶消息保存。"
        }}
      </view>
      <t-textarea
        :value="pinnedMessageText"
        class="textarea"
        maxlength="300"
        :placeholder="defaultPinnedMessage || ''"
        placeholder-class="placeholder"
        @change="onPinnedMessageChange"
      />
      <view v-if="effectivePinnedMessage" class="preview-block">
        <view class="preview-label">{{ isHistorical ? "补录内容" : "将置顶为" }}</view>
        <view class="preview-text">{{ effectivePinnedMessage }}</view>
      </view>
    </view>

    <t-notice-bar
      v-if="statusText"
      class="notice"
      theme="warning"
      :visible="true"
      :content="statusText"
    />

    <view class="bottom-action">
      <t-button
        class="button"
        :class="{ disabled: busyAction || !primaryActionEnabled }"
        :disabled="busyAction || !primaryActionEnabled"
        @tap="handlePrimaryAction"
      >
        {{ busyAction ? "创建中..." : primaryActionText }}
      </t-button>
    </view>
  </view>
</template>

<script>
import {
  FUTURE_CARPOOL,
  HISTORICAL_RECORD,
  formatBeijingDateTime
} from "@pinche/shared";
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import { dataOf, ensureLoggedIn, request } from "../../utils/api";
import { isAuthorPrivateText } from "../../utils/authorPrivateText";
import {
  createSessionCreationKey,
  readCreateFlow,
  roleOptionsFromFlow,
  selectedRolesFromFlow,
  writeCreateFlow
} from "../../utils/createFlow";
import {
  HISTORICAL_PINNED_PLACEHOLDER,
  TIME_PICKER_END,
  TIME_PICKER_START,
  clearPendingHistoricalDraftState,
  createOrRecoverHistoricalDraft,
  createSessionSetupSubmissionController,
  historicalAuthorPrivatePendingDisposition,
  historicalCreateSettings,
  historicalCreationOperationErrorDisposition,
  historicalDraftFingerprint,
  historicalPendingMatchesDescriptor,
  historicalPrimaryActionEnabled,
  historicalPinnedMessage,
  historicalSetupDescriptor,
  missingSeatPayloads,
  persistPendingHistoricalDraftState,
  sessionSetupSubmissionMatches,
  seatInitializationKey,
  selectedSessionPurpose,
  submitPurposeChanged
} from "../../utils/sessionSetup";

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateText(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function tomorrowAtDefaultTime() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return {
    date: dateText(date),
    time: "14:00"
  };
}

function isNumericId(value) {
  return /^\d+$/.test(String(value || ""));
}

export default {
  components: { AuthIdentityBar, FeedbackHost },
  data() {
    const defaults = sessionCreationDefaults();
    return {
      TIME_PICKER_START,
      TIME_PICKER_END,
      store: null,
      script: null,
      role: null,
      roleOptions: [],
      selectedRoles: [],
      dateValue: defaults.date,
      timeValue: defaults.time,
      datePickerVisible: false,
      timePickerVisible: false,
      sessionPurpose: selectedSessionPurpose(defaults.date, defaults.time, new Date()),
      pendingHistoricalDraft: null,
      pinnedMessageText: "",
      joinPolicy: "review_required",
      joinPhoneRequired: true,
      npcJoinEnabled: true,
      cityVisible: true,
      statusText: "",
      busyAction: false,
      submissionController: createSessionSetupSubmissionController()
    };
  },
  computed: {
    storeName() {
      return this.store?.name || "店家待定";
    },
    scriptName() {
      return this.script?.name || "剧本待定";
    },
    roleName() {
      return this.role?.name || this.selectedRoles[0]?.name || "待定";
    },
    startAt() {
      return sessionCreationWallTime(this.dateValue, this.timeValue);
    },
    transportStartAt() {
      return sessionCreationTransportStartAt(this.dateValue, this.timeValue);
    },
    startText() {
      return `${this.dateValue} ${this.timeValue}`;
    },
    storeScriptPrice() {
      return Number(this.script?.price_per_player || this.script?.pricePerPlayer || 0);
    },
    defaultPinnedMessage() {
      if (this.isHistorical) {
        return HISTORICAL_PINNED_PLACEHOLDER;
      }
      return `置顶：${this.scriptName} ${this.startText}，${this.storeName}集合。`;
    },
    effectivePinnedMessage() {
      if (this.isHistorical) {
        return historicalPinnedMessage(this.pinnedMessageText);
      }
      return this.pinnedMessageText.trim() || this.defaultPinnedMessage;
    },
    isHistorical() {
      return this.sessionPurpose === HISTORICAL_RECORD;
    },
    hasPendingHistoricalMismatch() {
      if (!this.pendingHistoricalDraft) {
        return false;
      }
      const descriptor = this.historicalDraftDescriptor();
      return Boolean(
        !this.isHistorical ||
          !descriptor ||
          !historicalPendingMatchesDescriptor(this.pendingHistoricalDraft, descriptor)
      );
    },
    primaryActionText() {
      if (this.hasPendingHistoricalMismatch) {
        return "继续上次补录";
      }
      return this.isHistorical ? "创建历史补录" : "创建车局并分享";
    },
    canSubmit() {
      return isNumericId(this.store?.id) && isNumericId(this.script?.id);
    },
    primaryActionEnabled() {
      return historicalPrimaryActionEnabled({
        canSubmitCurrent: this.canSubmit,
        hasPendingMismatch: this.hasPendingHistoricalMismatch,
        pendingHistoricalDraft: this.pendingHistoricalDraft
      });
    }
  },
  onLoad() {
    const flow = readCreateFlow();
    this.store = flow.store || null;
    this.script = flow.script || null;
    this.role = flow.role || null;
    this.roleOptions = roleOptionsFromFlow(flow);
    this.selectedRoles = selectedRolesFromFlow(flow);
    this.pendingHistoricalDraft = flow.pendingHistoricalDraft || null;
    this.pinnedMessageText = flow.pinnedMessageText || "";
    this.joinPolicy = flow.joinPolicy === "direct" ? "direct" : "review_required";
    this.joinPhoneRequired =
      flow.joinPhoneRequired === undefined ? true : Boolean(flow.joinPhoneRequired);
    this.npcJoinEnabled = flow.npcJoinEnabled === undefined ? true : Boolean(flow.npcJoinEnabled);
    this.cityVisible = flow.cityVisible === undefined ? true : Boolean(flow.cityVisible);
    const savedPickerValue = sessionCreationPickerValue(flow.startAt);
    if (savedPickerValue) {
      this.dateValue = savedPickerValue.date;
      this.timeValue = savedPickerValue.time;
    }
    this.sessionPurpose =
      selectedSessionPurpose(this.dateValue, this.timeValue, new Date()) ||
      flow.sessionPurpose ||
      FUTURE_CARPOOL;
    if (this.hasPendingHistoricalMismatch && historicalPendingMatchesDescriptor(this.pendingHistoricalDraft)) {
      this.statusText = "已有未完成的历史补录，请先继续上次补录。";
    } else if (!this.canSubmit) {
      this.statusText = "当前店家或剧本是演示数据，请连接后端后选择真实店家和剧本。";
    } else if (this.pendingHistoricalDraft) {
      this.statusText = "补录草稿已保留，点击重试继续初始化";
    }
  },
  methods: {
    openDatePicker() {
      this.datePickerVisible = true;
    },
    closeDatePicker() {
      this.datePickerVisible = false;
    },
    openTimePicker() {
      this.timePickerVisible = true;
    },
    closeTimePicker() {
      this.timePickerVisible = false;
    },
    onDateChange(event) {
      this.dateValue = event.detail.value;
      this.datePickerVisible = false;
      this.reclassifyPurpose();
      this.persistDraft();
    },
    onTimeChange(event) {
      this.timeValue = event.detail.value;
      this.timePickerVisible = false;
      this.reclassifyPurpose();
      this.persistDraft();
    },
    onPinnedMessageChange(event) {
      this.pinnedMessageText = event.detail.value || "";
      this.persistDraft();
    },
    reclassifyPurpose(now = new Date()) {
      const purpose = selectedSessionPurpose(this.dateValue, this.timeValue, now);
      if (purpose) {
        this.sessionPurpose = purpose;
      }
      return purpose;
    },
    setJoinPolicy(value) {
      this.joinPolicy = value === "direct" ? "direct" : "review_required";
      this.persistDraft();
    },
    setJoinPhoneRequired(value) {
      this.joinPhoneRequired = Boolean(value);
      this.persistDraft();
    },
    setNpcJoinEnabled(value) {
      this.npcJoinEnabled = Boolean(value);
      this.persistDraft();
    },
    setCityVisible(value) {
      this.cityVisible = Boolean(value);
      this.persistDraft();
    },
    persistDraft() {
      writeCreateFlow({
        startAt: this.startAt,
        startText: this.startText,
        sessionPurpose: this.sessionPurpose,
        pinnedMessageText: this.pinnedMessageText.trim(),
        joinPolicy: this.joinPolicy,
        joinPhoneRequired: this.joinPhoneRequired,
        npcJoinEnabled: this.npcJoinEnabled,
        cityVisible: this.cityVisible
      });
    },
    seatPayload(role) {
      return {
        name: role.name,
        seatType: role.seatType || "normal",
        roleName: role.note || role.name,
        roleGender: role.roleGender || "unlimited",
        basePrice: this.storeScriptPrice,
        adjustment: 0
      };
    },
    roleInitialization() {
      const roles = this.roleOptions.length > 0 ? this.roleOptions : this.selectedRoles;
      const seatPayloads = roles.map((role) => this.seatPayload(role));
      const selectedRole = this.role || this.selectedRoles[0] || null;
      const selectedRoleId = String(selectedRole?.id || "");
      let selectedRoleIndex = selectedRoleId
        ? roles.findIndex((role) => String(role?.id || "") === selectedRoleId)
        : -1;
      if (selectedRoleIndex < 0) {
        selectedRoleIndex = roles.findIndex((role) => role === selectedRole);
      }
      const selectedSeatKey = selectedRole
        ? seatInitializationKey(this.seatPayload(selectedRole))
        : "";
      if (selectedRoleIndex < 0 && selectedSeatKey) {
        selectedRoleIndex = seatPayloads.findIndex(
          (payload) => seatInitializationKey(payload) === selectedSeatKey
        );
      }
      const selectedSeatOccurrence = selectedRoleIndex < 0
        ? -1
        : seatPayloads
            .slice(0, selectedRoleIndex)
            .filter((payload) => seatInitializationKey(payload) === selectedSeatKey).length;
      return {
        roles,
        seatPayloads,
        selectedSeatKey,
        selectedSeatOccurrence
      };
    },
    historicalSetupSnapshot() {
      return {
        store: this.store,
        script: this.script,
        role: this.role,
        roleOptions: this.roleOptions,
        selectedRoles: this.selectedRoles,
        dateValue: this.dateValue,
        timeValue: this.timeValue,
        startAt: this.startAt,
        startText: this.startText,
        sessionPurpose: this.sessionPurpose,
        pinnedMessageText: this.pinnedMessageText,
        joinPolicy: this.joinPolicy,
        joinPhoneRequired: this.joinPhoneRequired,
        npcJoinEnabled: this.npcJoinEnabled,
        cityVisible: this.cityVisible
      };
    },
    historicalDraftDescriptor() {
      const initialization = this.roleInitialization();
      const snapshot = this.historicalSetupSnapshot();
      if (this.isHistorical) {
        return historicalSetupDescriptor(snapshot);
      }
      return {
        ...initialization,
        fingerprint: historicalDraftFingerprint({
          storeId: this.store?.id,
          scriptId: this.script?.id,
          startAt: this.startAt,
          sessionPurpose: this.sessionPurpose,
          pinnedMessageText: historicalPinnedMessage(this.pinnedMessageText),
          seatPayloads: initialization.seatPayloads,
          selectedSeatKey: initialization.selectedSeatKey,
          selectedSeatOccurrence: initialization.selectedSeatOccurrence
        }),
        snapshot
      };
    },
    persistPendingHistoricalDraft(pendingHistoricalDraft) {
      return persistPendingHistoricalDraftState(
        this,
        pendingHistoricalDraft,
        (value) => writeCreateFlow({ pendingHistoricalDraft: value })
      );
    },
    clearPendingHistoricalDraft(continueAfterClear) {
      return clearPendingHistoricalDraftState(
        this,
        (value) => writeCreateFlow({ pendingHistoricalDraft: value }),
        continueAfterClear
      );
    },
    restorePendingHistoricalDraft() {
      if (!historicalPendingMatchesDescriptor(this.pendingHistoricalDraft)) {
        this.clearPendingHistoricalDraft();
        this.statusText = "上次补录草稿信息已失效，请再次点击重新创建。";
        return;
      }
      const snapshot = this.pendingHistoricalDraft.snapshot;
      this.store = snapshot.store || null;
      this.script = snapshot.script || null;
      this.role = snapshot.role || null;
      this.roleOptions = Array.isArray(snapshot.roleOptions) ? snapshot.roleOptions : [];
      this.selectedRoles = Array.isArray(snapshot.selectedRoles) ? snapshot.selectedRoles : [];
      this.dateValue = snapshot.dateValue;
      this.timeValue = snapshot.timeValue;
      this.sessionPurpose = snapshot.sessionPurpose;
      this.pinnedMessageText = snapshot.pinnedMessageText || "";
      this.joinPolicy = snapshot.joinPolicy;
      this.joinPhoneRequired = Boolean(snapshot.joinPhoneRequired);
      this.npcJoinEnabled = Boolean(snapshot.npcJoinEnabled);
      this.cityVisible = Boolean(snapshot.cityVisible);
      writeCreateFlow({
        ...snapshot,
        pendingHistoricalDraft: this.pendingHistoricalDraft
      });
      this.statusText = "已恢复上次补录，点击创建历史补录继续初始化。";
    },
    handlePrimaryAction() {
      if (this.hasPendingHistoricalMismatch) {
        this.restorePendingHistoricalDraft();
        return;
      }
      this.createPublishedSession();
    },
    resolveSelectedSeat(seats, selectedSeatKey, selectedSeatOccurrence) {
      const matchingSeats = (Array.isArray(seats) ? seats : [])
        .filter((seat) => seatInitializationKey(seat) === selectedSeatKey)
        .sort((left, right) => Number(left.id) - Number(right.id));
      return matchingSeats[selectedSeatOccurrence] || null;
    },
    sessionCreationData(pinnedMessageText, creationIdentity = {}) {
      const historicalSettings = historicalCreateSettings();
      if (this.isHistorical) {
        return {
          storeId: Number(this.store.id),
          scriptId: Number(this.script.id),
          startAt: this.startAt,
          sessionPurpose: this.sessionPurpose,
          depositAmount: 0,
          ...historicalSettings,
          ...(creationIdentity.historicalCreationKey
            ? {
                historicalCreationKey: creationIdentity.historicalCreationKey,
                idempotencyKey: creationIdentity.idempotencyKey
              }
            : {}),
          note: historicalPinnedMessage(pinnedMessageText) || "历史车局补录",
          pinnedMessageText: historicalPinnedMessage(pinnedMessageText)
        };
      }
      return {
        storeId: Number(this.store.id),
        scriptId: Number(this.script.id),
        startAt: this.startAt,
        sessionPurpose: this.sessionPurpose,
        depositAmount: 0,
        joinPolicy: this.joinPolicy,
        joinPhoneRequired: this.joinPhoneRequired,
        npcJoinEnabled: this.npcJoinEnabled,
        visibility: this.cityVisible ? "public" : "share_only",
        note: "剧本迷·拼车，一起沉浸好本。",
        pinnedMessageText
      };
    },
    async initializeFutureSession(session, descriptor, pinnedMessageText) {
      const createdSeats = [];
      for (const payload of descriptor.seatPayloads) {
        const seatResponse = await request({
          url: `/api/sessions/${session.id}/seats`,
          method: "POST",
          data: payload
        });
        createdSeats.push(dataOf(seatResponse));
      }
      const selectedSeat = this.resolveSelectedSeat(
        createdSeats,
        descriptor.selectedSeatKey,
        descriptor.selectedSeatOccurrence
      );
      await request({
        url: `/api/sessions/${session.id}/publish`,
        method: "POST"
      });
      if (selectedSeat) {
        await request({
          url: `/api/session-seats/${selectedSeat.id}/claim`,
          method: "POST",
          data: {
            note: "车头创建时选择角色"
          }
        });
      }
      await request({
        url: `/api/sessions/${session.id}/chat/pin`,
        method: "PATCH",
        data: {
          pinnedMessageText
        }
      });
      this.completeSessionCreation(
        session.id,
        descriptor.roles,
        pinnedMessageText,
        undefined,
        descriptor.snapshot
      );
    },
    async recoverHistoricalSession(pendingHistoricalDraft) {
      try {
        const response = await request({
          url: `/api/sessions/${pendingHistoricalDraft.sessionId}`
        });
        return dataOf(response) || null;
      } catch (error) {
        if (error?.statusCode === 404 || error?.code === "NOT_FOUND") {
          this.clearPendingHistoricalDraft();
          this.statusText = "上次补录草稿已不存在，请再次点击重新创建。";
          return null;
        }
        throw error;
      }
    },
    recoveredHistoricalSessionMatches(session, pendingHistoricalDraft) {
      const snapshot = pendingHistoricalDraft?.snapshot || {};
      const recoveredStartAt = formatBeijingDateTime(session?.start_at, "");
      return Boolean(
        Number(session?.id) === Number(pendingHistoricalDraft?.sessionId) &&
        session?.session_purpose === HISTORICAL_RECORD &&
        Number(session?.store_id) === Number(snapshot.store?.id) &&
        Number(session?.script_id) === Number(snapshot.script?.id) &&
        recoveredStartAt &&
        `${recoveredStartAt}:00` === snapshot.startAt
      );
    },
    async initializeHistoricalSession(
      session,
      pendingHistoricalDraft,
      descriptor,
      preparedPinnedMessageText
    ) {
      if (
        !historicalPendingMatchesDescriptor(pendingHistoricalDraft, descriptor) ||
        !this.recoveredHistoricalSessionMatches(session, pendingHistoricalDraft)
      ) {
        this.clearPendingHistoricalDraft();
        this.statusText = "上次补录草稿信息已失效，请再次点击重新创建。";
        return;
      }
      if (session.status === "cancelled") {
        this.clearPendingHistoricalDraft();
        this.statusText = "上次补录草稿已取消，请再次点击重新创建。";
        return;
      }
      if (session.status === "locked") {
        return this.clearPendingHistoricalDraft(() =>
          this.redirectToSessionShare(session.id)
        );
      }
      if (session.status !== "draft") {
        throw new Error("Historical draft is not initializable");
      }

      const missingPayloads = missingSeatPayloads(
        descriptor.seatPayloads,
        session.seats || []
      );
      for (const payload of missingPayloads) {
        await request({
          url: `/api/sessions/${session.id}/seats`,
          method: "POST",
          data: payload
        });
      }

      const reloadedResponse = await request({ url: `/api/sessions/${session.id}` });
      const reloaded = dataOf(reloadedResponse) || {};
      if (reloaded.status === "cancelled") {
        this.clearPendingHistoricalDraft();
        this.statusText = "上次补录草稿已取消，请再次点击重新创建。";
        return;
      }
      if (reloaded.status === "locked") {
        return this.clearPendingHistoricalDraft(() =>
          this.redirectToSessionShare(session.id)
        );
      }
      if (reloaded.status !== "draft") {
        throw new Error("Historical draft changed before publish");
      }
      const selectedSeat = this.resolveSelectedSeat(
        reloaded.seats,
        descriptor.selectedSeatKey,
        descriptor.selectedSeatOccurrence
      );
      if (!selectedSeat) {
        throw new Error("Historical creator seat is missing");
      }

      const pinnedMessageText = historicalPinnedMessage(preparedPinnedMessageText);
      if (pinnedMessageText) {
        await request({
          url: `/api/sessions/${session.id}/chat/pin`,
          method: "PATCH",
          data: { pinnedMessageText }
        });
      }
      const creatorSeatId = Number(selectedSeat.id);
      await request({
        url: `/api/sessions/${session.id}/publish`,
        method: "POST",
        data: { creatorSeatId }
      });
      return this.clearPendingHistoricalDraft(() =>
        this.completeSessionCreation(
          session.id,
          descriptor.roles,
          pinnedMessageText,
          pinnedMessageText || "历史车局补录",
          descriptor.snapshot
        )
      );
    },
    completeSessionCreation(sessionId, roles, pinnedMessageText, note, setupSnapshot) {
      const setup = setupSnapshot || this.historicalSetupSnapshot();
      const finalNote = note || "剧本迷·拼车，一起沉浸好本。";
      const completedSettings = setup.sessionPurpose === HISTORICAL_RECORD
        ? historicalCreateSettings()
        : {
            joinPolicy: setup.joinPolicy,
            joinPhoneRequired: setup.joinPhoneRequired,
            npcJoinEnabled: setup.npcJoinEnabled,
            visibility: setup.cityVisible ? "public" : "share_only"
          };
      try {
        writeCreateFlow({
          store: setup.store,
          script: setup.script,
          role: setup.role,
          roleOptions: roles,
          selectedRoles: setup.selectedRoles,
          sessionId,
          startAt: setup.startAt,
          startText: setup.startText,
          sessionPurpose: setup.sessionPurpose,
          pendingHistoricalDraft: null,
          pinnedMessageText,
          joinPolicy: completedSettings.joinPolicy,
          joinPhoneRequired: completedSettings.joinPhoneRequired,
          npcJoinEnabled: completedSettings.npcJoinEnabled,
          cityVisible: completedSettings.visibility === "public",
          note: finalNote
        });
      } catch (error) {
        // The server-side publish already succeeded; navigation is the recovery path.
      }
      this.redirectToSessionShare(sessionId);
    },
    createPublishedSession() {
      return this.submissionController.submit({
        prepare: () => {
          const submitNow = new Date();
          const submitPurpose = selectedSessionPurpose(this.dateValue, this.timeValue, submitNow);
          if (!submitPurpose) {
            this.statusText = "请选择有效的开本日期和时间。";
            return null;
          }
          if (submitPurposeChanged(this.sessionPurpose, this.startAt, submitNow)) {
            this.sessionPurpose = submitPurpose;
            this.persistDraft();
            this.statusText = this.isHistorical
              ? "开本时间已进入过去，当前为历史补录，请再次点击创建历史补录。"
              : "开本时间用途已更新，请再次点击确认创建。";
            return null;
          }
          if (this.hasPendingHistoricalMismatch) {
            this.statusText = "已有未完成的历史补录，请先继续上次补录。";
            return null;
          }
          const descriptor = this.historicalDraftDescriptor();
          if (
            !descriptor ||
            (this.isHistorical &&
              (descriptor.seatPayloads.length === 0 ||
                !descriptor.selectedSeatKey ||
                descriptor.selectedSeatOccurrence < 0))
          ) {
            this.statusText = "请先选择你当时扮演的角色。";
            return null;
          }
          this.statusText = "";
          const pinnedMessageText = this.effectivePinnedMessage;
          return {
            descriptor,
            pinnedMessageText,
            sessionPurpose: this.sessionPurpose,
            isHistorical: this.isHistorical,
            creationData: this.sessionCreationData(pinnedMessageText)
          };
        },
        ensureAuthenticated: async () => {
          const auth = await ensureLoggedIn({
            content: "登录后发布并分享你的剧本局。",
            requirePhone: true,
            phoneRequiredTitle: "授权手机号后发布",
            phoneRequiredContent: "创建车前需要授权手机号，方便车局沟通和审核。"
          });
          if (!auth) {
            this.statusText = "登录后可继续发布。";
            return null;
          }
          if (!this.canSubmit) return null;
          this.busyAction = true;
          return auth;
        },
        createSession: async (prepared) => {
          const {
            descriptor,
            pinnedMessageText,
            sessionPurpose,
            isHistorical,
            creationData
          } = prepared;
          if (!sessionSetupSubmissionMatches({
            preparedPurpose: sessionPurpose,
            currentPurpose: this.sessionPurpose,
            preparedDescriptor: descriptor,
            currentDescriptor: this.historicalDraftDescriptor(),
            preparedCreationData: creationData,
            currentCreationData: this.sessionCreationData(this.effectivePinnedMessage)
          })) {
            this.statusText = "登录期间开本设置已变化，请再次点击确认创建。";
            return null;
          }
          if (!isHistorical) {
            const sessionResponse = await request({
              url: "/api/sessions",
              method: "POST",
              data: creationData
            });
            const session = dataOf(sessionResponse);
            if (isAuthorPrivateText(session)) {
              this.statusText = session.moderation_message;
              return null;
            }
            return { session, pendingHistoricalDraft: null };
          }
          const result = await createOrRecoverHistoricalDraft({
            pendingHistoricalDraft: this.pendingHistoricalDraft,
            descriptor,
            persistPending: (pending) => this.persistPendingHistoricalDraft(pending),
            recoverSession: (pending) => this.recoverHistoricalSession(pending),
            createSession: async ({ historicalCreationKey, idempotencyKey }) => {
              const sessionResponse = await request({
                url: "/api/sessions",
                method: "POST",
                data: {
                  ...creationData,
                  historicalCreationKey,
                  idempotencyKey
                }
              });
              return dataOf(sessionResponse);
            }
          });
          if (!result.session) return null;
          if (isAuthorPrivateText(result.session)) {
            const moderationDisposition = historicalAuthorPrivatePendingDisposition(
              result.session
            );
            if (moderationDisposition.clearPending) {
              this.clearPendingHistoricalDraft();
            }
            this.statusText = moderationDisposition.statusText;
            return null;
          }
          return {
            session: result.session,
            pendingHistoricalDraft: result.pendingHistoricalDraft
          };
        },
        initializeSession: async (
          { session, pendingHistoricalDraft },
          { descriptor, pinnedMessageText, isHistorical }
        ) => {
          if (!isHistorical) {
            return this.initializeFutureSession(session, descriptor, pinnedMessageText);
          }
          return this.initializeHistoricalSession(
            session,
            pendingHistoricalDraft,
            descriptor,
            pinnedMessageText
          );
        }
      }).catch((error) => {
        const operationDisposition = historicalCreationOperationErrorDisposition(error);
        if (operationDisposition) {
          if (operationDisposition.clearPending) {
            this.clearPendingHistoricalDraft();
          }
          this.statusText = operationDisposition.statusText;
        } else if (error?.code === "SESSION_PURPOSE_TIME_MISMATCH") {
          const expectedPurpose = error?.details?.expectedSessionPurpose;
          this.sessionPurpose = [FUTURE_CARPOOL, HISTORICAL_RECORD].includes(expectedPurpose)
            ? expectedPurpose
            : this.reclassifyPurpose(new Date());
          this.persistDraft();
          this.statusText = "开本时间用途已变化，页面已更新，请再次点击确认创建。";
        } else if (this.pendingHistoricalDraft) {
          this.statusText = "补录草稿已保留，点击重试继续初始化";
        } else {
          this.statusText = this.createErrorText(error);
        }
      }).finally(() => {
        this.busyAction = false;
      });
    },
    redirectToSessionShare(sessionId) {
      uni.redirectTo({ url: `/pages/session/share?id=${sessionId}` });
    },
    createErrorText(error) {
      if (error?.statusCode === 400) {
        return "创建失败，请检查时间、店家和剧本是否有效。";
      }
      if (error?.statusCode === 401) {
        return "请先登录后再创建车局。";
      }
      return error?.userMessage || "创建失败，请稍后重试。";
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

.section-title {
  margin-bottom: 18rpx;
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
}

.section-note {
  margin-bottom: 18rpx;
  color: #738078;
  font-size: 24rpx;
  line-height: 1.45;
}

.info-row {
  margin-top: 10rpx;
  color: #475569;
  font-size: 26rpx;
  line-height: 1.5;
}

.picker-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
}

.picker-field {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  height: 86rpx;
  border: 1rpx solid #ded8ca;
  border-radius: 12rpx;
  background: #fffefb;
  color: #183d34;
  font-size: 28rpx;
  font-weight: 600;
}

.historical-notice {
  margin-top: 18rpx;
  padding: 16rpx 18rpx;
  border-left: 6rpx solid #b89458;
  background: #fbf6e9;
  color: #6f5b34;
  font-size: 24rpx;
  line-height: 1.5;
}

.setting-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  padding: 22rpx 0;
  border-top: 1rpx solid rgba(222, 216, 202, 0.72);
}

.section-note + .setting-switch-row {
  margin-top: 12rpx;
}

.setting-switch-copy {
  min-width: 0;
  flex: 1;
}

.setting-switch-title {
  margin-bottom: 6rpx;
  color: #153f34;
  font-size: 26rpx;
  font-weight: 600;
}

.setting-switch-row .section-note {
  margin-bottom: 0;
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

.textarea {
  min-height: 168rpx;
  width: 100%;
  padding: 22rpx;
  box-sizing: border-box;
  border: 1rpx solid #ded8ca;
  border-radius: 12rpx;
  background: #fffefb;
  color: #183d34;
  font-size: 26rpx;
  line-height: 1.5;
}

.placeholder {
  color: #9ba39c;
}

.preview-block {
  margin-top: 18rpx;
  padding: 18rpx;
  border-left: 6rpx solid #b89458;
  border-radius: 8rpx;
  background: #fbf6e9;
}

.preview-label {
  color: #8d7b55;
  font-size: 22rpx;
  font-weight: 600;
}

.preview-text {
  margin-top: 8rpx;
  color: #193d35;
  font-size: 25rpx;
  line-height: 1.5;
}

.notice {
  margin-top: 14rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  background: #eef7f4;
  color: #1f7a68;
  font-size: 24rpx;
  line-height: 1.5;
}
</style>
