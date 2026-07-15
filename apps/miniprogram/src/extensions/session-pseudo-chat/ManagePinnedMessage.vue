<template>
  <view v-if="session.id" class="pinned-manager" :class="{ embedded }">
    <view class="pinned-head">
      <view>
        <view class="pinned-title">置顶信息</view>
        <view class="pinned-note">只放最重要的一句话，比如集合时间、房间号或临时变更。</view>
      </view>
    </view>
    <view v-if="authorPrivateDraft" class="draft-status">
      {{ authorPrivateDraft.moderation_message }}
    </view>
    <t-textarea
      :value="pinnedMessageText"
      class="textarea"
      maxlength="300"
      placeholder="输入要置顶给车内成员看的信息"
      placeholder-class="placeholder"
      :disabled="isBusy || !canEditPinned"
      @change="pinnedMessageText = $event.detail.value"
    />
    <view class="actions">
      <t-button
        v-if="authorPrivateDraft"
        class="button secondary"
        :disabled="isBusy"
        @tap="cancelPinnedDraft"
      >取消这版</t-button>
      <t-button class="button" :disabled="isBusy || !canEditPinned" @tap="savePinnedMessage">
        {{ replacementDraftId ? "修改后重新提交" : "保存置顶" }}
      </t-button>
    </view>
  </view>
</template>

<script>
import {
  authorPrivatePinnedView,
  chatApi,
  isAuthorPrivateProjection
} from "./api.js";

export default {
  props: {
    sessionId: { type: [String, Number], default: "" },
    session: { type: Object, default: () => ({}) },
    busy: { type: Boolean, default: false },
    embedded: { type: Boolean, default: false },
    authTools: { type: Object, required: true }
  },
  emits: ["updated", "status"],
  data() {
    return {
      pinnedMessage: null,
      pinnedMessageText: "",
      replacementDraftId: null,
      localBusy: false
    };
  },
  computed: {
    api() {
      return chatApi(this.authTools);
    },
    isBusy() {
      return this.busy || this.localBusy;
    },
    authorPrivateDraft() {
      return isAuthorPrivateProjection(this.pinnedMessage?.author_private)
        ? this.pinnedMessage.author_private
        : null;
    },
    canEditPinned() {
      return !this.authorPrivateDraft || this.authorPrivateDraft.can_edit === true;
    }
  },
  watch: {
    sessionId() {
      this.loadChat();
    }
  },
  mounted() {
    this.loadChat();
  },
  methods: {
    async loadChat() {
      if (!this.sessionId || this.sessionId === "d1-demo") {
        return;
      }
      try {
        const chat = await this.api.loadChat(this.sessionId);
        this.pinnedMessage = chat.pinnedMessage || null;
        this.pinnedMessageText = this.pinnedMessage?.content || "";
        this.replacementDraftId = this.authorPrivateDraft?.can_resubmit
          ? this.authorPrivateDraft.draft_id
          : null;
      } catch (error) {
        this.pinnedMessage = null;
        this.replacementDraftId = null;
      }
    },
    async savePinnedMessage() {
      if (this.isBusy) {
        return;
      }
      this.localBusy = true;
      try {
        const result = await this.api.updatePinnedMessage(
          this.sessionId,
          this.pinnedMessageText.trim(),
          this.replacementDraftId
        );
        this.pinnedMessage = isAuthorPrivateProjection(result)
          ? authorPrivatePinnedView(this.pinnedMessage, result)
          : result.pinnedMessage || null;
        this.pinnedMessageText = this.pinnedMessage?.content || this.pinnedMessageText;
        this.replacementDraftId = this.authorPrivateDraft?.can_resubmit
          ? this.authorPrivateDraft.draft_id
          : null;
        this.$emit("updated");
        this.$emit(
          "status",
          this.authorPrivateDraft?.moderation_message || "置顶信息已更新。"
        );
      } catch (error) {
        this.$emit("status", this.actionErrorText(error));
      } finally {
        this.localBusy = false;
      }
    },
    async cancelPinnedDraft() {
      if (!this.authorPrivateDraft || this.isBusy) return;
      this.localBusy = true;
      try {
        await this.api.cancelDraft(this.authorPrivateDraft.draft_id);
        this.replacementDraftId = null;
        await this.loadChat();
        this.$emit("updated");
        this.$emit("status", "已取消这版置顶信息。");
      } catch (error) {
        this.$emit("status", this.actionErrorText(error));
      } finally {
        this.localBusy = false;
      }
    },
    actionErrorText(error) {
      const moderationMessage = this.authTools.contentModerationErrorText?.(error);
      if (moderationMessage) {
        return moderationMessage;
      }
      if (error?.statusCode === 403) {
        return "只有车头可以管理本车。";
      }
      if (error?.statusCode === 401) {
        return "请先登录后再管理发车。";
      }
      return "操作失败，请稍后重试。";
    }
  }
};
</script>

<style scoped>
.pinned-manager {
  margin: 24rpx;
  padding: 28rpx;
  border-radius: 8rpx;
  background: #fffefb;
  box-shadow: 0 10rpx 26rpx rgba(29, 54, 45, 0.08);
}

.pinned-manager.embedded {
  margin: 0;
  padding: 24rpx 0 0;
  border-top: 1rpx solid rgba(222, 216, 202, 0.72);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.pinned-head {
  display: flex;
  justify-content: space-between;
  gap: 16rpx;
}

.pinned-title {
  margin-bottom: 18rpx;
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
}

.pinned-manager.embedded .pinned-title {
  margin-bottom: 6rpx;
  font-size: 26rpx;
}

.pinned-note {
  color: #7a857d;
  font-size: 24rpx;
  line-height: 1.5;
}

.draft-status {
  margin-top: 14rpx;
  color: #9a6700;
  font-size: 23rpx;
}

.textarea {
  width: 100%;
  min-height: 150rpx;
  margin-top: 18rpx;
  padding: 18rpx;
  box-sizing: border-box;
  border-radius: 8rpx;
  background: #f8fafc;
  color: #153f34;
  font-size: 26rpx;
  line-height: 1.5;
}

.placeholder {
  color: #9ba39c;
}

.actions {
  display: flex;
  gap: 16rpx;
  margin-top: 22rpx;
}

.pinned-manager.embedded .actions {
  margin-top: 18rpx;
}
</style>
