<template>
  <view>
    <t-button v-if="showChatEntry" class="chat-float-button" @tap="openChatModal">
      <view class="chat-float-content">
        <text class="chat-float-icon">聊</text>
        <text class="chat-float-text">车友</text>
        <t-badge
          v-if="unreadCount > 0"
          class="chat-unread-badge"
          :count="unreadCount"
          :max-count="99"
        />
      </view>
    </t-button>

    <t-popup
      :visible="chatModalOpen"
      placement="bottom"
      :close-on-overlay-click="true"
      @visible-change="handleChatPopupVisibleChange"
    >
      <view class="chat-modal" @tap.stop>
        <view class="chat-modal-head">
          <view>
            <view class="chat-modal-title">车内聊天</view>
            <view class="chat-modal-subtitle">上车玩家可见，每 3 秒刷新。</view>
          </view>
          <t-button class="chat-modal-close" @tap="closeChatModal">关闭</t-button>
        </view>

        <scroll-view scroll-y class="chat-modal-body">
          <view v-if="pinnedMessage" class="pinned-message">
            <view class="pinned-label">置顶</view>
            <view class="pinned-text">{{ pinnedMessage.content }}</view>
          </view>

          <t-notice-bar
            v-if="messageStatusText"
            class="notice"
            theme="warning"
            :visible="true"
            :content="messageStatusText"
          />

          <view class="message-list">
            <t-empty
              v-if="messages.length === 0 && canChat"
              class="empty"
              description="还没有留言，先发一句确认信息。"
            />
            <view
              v-for="message in messages"
              :key="message.id"
              class="message-item"
              :class="{ mine: isMine(message) }"
            >
              <view class="message-meta">
                <text>{{ message.sender_label || "玩家" }}</text>
                <text>{{ timeText(message.created_at) }}</text>
              </view>
              <view class="message-content">{{ message.content }}</view>
            </view>
          </view>
        </scroll-view>

        <view class="message-compose">
          <t-input
            :value="draftMessage"
            class="message-input"
            placeholder="输入留言"
            placeholder-class="placeholder"
            confirm-type="send"
            :disabled="!canChat || session.status === 'cancelled'"
            @change="draftMessage = $event.detail.value"
            @enter="sendMessage"
          />
          <t-button
            class="button compact"
            :class="{ disabled: !canSendMessage }"
            :disabled="!canSendMessage"
            @tap="sendMessage"
          >
            发送
          </t-button>
        </view>
      </view>
    </t-popup>
  </view>
</template>

<script>
import { chatApi } from "./api.js";

export default {
  props: {
    sessionId: { type: [String, Number], default: "" },
    session: { type: Object, default: () => ({}) },
    currentUserId: { type: [String, Number], default: "" },
    focusChatOnLoad: { type: Boolean, default: false },
    authTools: { type: Object, required: true }
  },
  data() {
    return {
      pinnedMessage: null,
      messages: [],
      draftMessage: "",
      messageStatusText: "",
      canChat: false,
      chatModalOpen: false,
      unreadCount: 0,
      lastSeenMessageId: "",
      localUserId: this.currentUserId || "",
      focusOpened: false,
      messageTimer: null
    };
  },
  computed: {
    api() {
      return chatApi(this.authTools);
    },
    canSendMessage() {
      return (
        this.canChat &&
        this.session.status !== "cancelled" &&
        Boolean(this.draftMessage.trim())
      );
    },
    showChatEntry() {
      return Boolean(this.sessionId && this.canChat && !this.chatModalOpen);
    },
    unreadBadgeText() {
      return this.unreadCount > 99 ? "99+" : String(this.unreadCount);
    }
  },
  watch: {
    currentUserId(value) {
      this.localUserId = value || "";
    },
    sessionId() {
      this.resetChatState();
      this.startMessagePolling();
      this.openFocusedChatOnce();
    },
    focusChatOnLoad() {
      this.openFocusedChatOnce();
    }
  },
  mounted() {
    this.startMessagePolling();
    this.openFocusedChatOnce();
  },
  beforeUnmount() {
    this.stop();
  },
  methods: {
    stop() {
      this.stopMessagePolling();
    },
    resetChatState() {
      this.stopMessagePolling();
      this.pinnedMessage = null;
      this.messages = [];
      this.draftMessage = "";
      this.messageStatusText = "";
      this.canChat = false;
      this.chatModalOpen = false;
      this.unreadCount = 0;
      this.lastSeenMessageId = "";
      this.focusOpened = false;
    },
    openFocusedChatOnce() {
      if (!this.focusChatOnLoad || this.focusOpened || !this.sessionId) {
        return;
      }
      this.focusOpened = true;
      setTimeout(() => this.openChatModal(), 300);
    },
    async startMessagePolling() {
      if (!this.sessionId || this.sessionId === "d1-demo" || this.messageTimer) {
        return;
      }
      const loaded = await this.loadChat();
      if (loaded) {
        this.messageTimer = setInterval(this.pollMessages, 3000);
      }
    },
    stopMessagePolling() {
      if (this.messageTimer) {
        clearInterval(this.messageTimer);
        this.messageTimer = null;
      }
    },
    pollMessages() {
      this.loadChat({ silent: true });
    },
    async loadChat(options = {}) {
      if (!this.sessionId || this.sessionId === "d1-demo") {
        return false;
      }
      try {
        const chat = await this.api.loadChat(this.sessionId);
        const nextMessages = chat.messages || [];
        this.pinnedMessage = chat.pinnedMessage || null;
        this.updateUnreadCount(nextMessages);
        this.messages = nextMessages;
        this.canChat = true;
        this.messageStatusText = "";
        return true;
      } catch (error) {
        this.canChat = false;
        this.chatModalOpen = false;
        this.unreadCount = 0;
        this.lastSeenMessageId = "";
        this.draftMessage = "";
        this.stopMessagePolling();
        if (!options.silent) {
          this.messageStatusText = this.messageErrorText(error);
        }
        return false;
      }
    },
    async openChatModal() {
      const loaded = this.canChat || (await this.loadChat());
      if (!loaded && !this.canChat) {
        return;
      }
      this.chatModalOpen = true;
      this.markChatRead();
      this.startMessagePolling();
    },
    handleChatPopupVisibleChange(event = {}) {
      if (event.detail?.visible === false) {
        this.closeChatModal();
      }
    },
    closeChatModal() {
      this.chatModalOpen = false;
    },
    updateUnreadCount(nextMessages = []) {
      const latestId = this.latestMessageId(nextMessages);
      if (!latestId) {
        this.unreadCount = 0;
        this.lastSeenMessageId = "";
        return;
      }
      if (this.chatModalOpen) {
        this.markChatRead(nextMessages);
        return;
      }
      if (!this.lastSeenMessageId) {
        this.lastSeenMessageId = latestId;
        this.unreadCount = 0;
        return;
      }
      const lastSeenIndex = nextMessages.findIndex((message) => {
        return String(message.id) === String(this.lastSeenMessageId);
      });
      this.unreadCount =
        lastSeenIndex === -1
          ? nextMessages.length
          : Math.max(0, nextMessages.length - lastSeenIndex - 1);
    },
    markChatRead(messages = this.messages) {
      this.lastSeenMessageId = this.latestMessageId(messages);
      this.unreadCount = 0;
    },
    latestMessageId(messages = []) {
      const latest = messages[messages.length - 1];
      return latest?.id ? String(latest.id) : "";
    },
    messageErrorText(error) {
      if (error?.statusCode === 401) {
        return "登录并上车后可查看车内聊天。";
      }
      if (error?.statusCode === 403) {
        return "只有车头和已上车玩家可以查看与发送聊天。";
      }
      return "聊天加载失败，请稍后重试。";
    },
    async sendMessage() {
      if (!this.draftMessage.trim()) {
        return;
      }
      const loggedIn = await this.ensureLogin();
      if (!loggedIn) {
        return;
      }
      try {
        const message = await this.api.sendMessage(
          this.sessionId,
          this.draftMessage.trim()
        );
        if (message) {
          this.messages = [...this.messages, message];
          if (this.chatModalOpen) {
            this.markChatRead(this.messages);
          }
        }
        this.draftMessage = "";
        this.canChat = true;
        this.messageStatusText = "";
        this.startMessagePolling();
      } catch (error) {
        this.messageStatusText = this.messageErrorText(error);
      }
    },
    async ensureLogin() {
      const auth = await this.authTools.ensureLoggedIn({
        content: "登录后继续使用车内留言。",
        failTitle: "登录失败"
      });
      if (auth?.user) {
        this.localUserId = auth.user.id;
        return true;
      }
      this.messageStatusText = "登录失败，未发送。";
      return false;
    },
    isMine(message) {
      const userId = this.localUserId || this.currentUserId;
      return userId && Number(message.sender_user_id) === Number(userId);
    },
    timeText(value) {
      if (!value) {
        return "";
      }
      return String(value).slice(5, 16);
    }
  }
};
</script>

<style scoped>
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

.chat-float-button {
  position: fixed;
  right: 24rpx;
  bottom: 220rpx;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  width: 104rpx;
  height: 104rpx;
  min-width: 104rpx;
  padding: 0;
  border-radius: 52rpx;
  background: #1f6f5b;
  color: #ffffff;
  box-shadow: 0 18rpx 42rpx rgba(31, 111, 91, 0.34);
  line-height: 1;
}

.chat-float-content {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
}

.chat-float-icon {
  font-size: 34rpx;
  font-weight: 700;
}

.chat-float-text {
  margin-top: 6rpx;
  font-size: 20rpx;
  font-weight: 600;
}

.chat-unread-badge {
  position: absolute;
  top: -8rpx;
  right: -8rpx;
  min-width: 34rpx;
  height: 34rpx;
  padding: 0 8rpx;
  box-sizing: border-box;
  border: 4rpx solid #fffefb;
  border-radius: 999rpx;
  background: #e5484d;
  color: #ffffff;
  font-size: 20rpx;
  font-weight: 700;
  line-height: 26rpx;
  text-align: center;
}

.chat-modal-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 30;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 24rpx 24rpx;
  box-sizing: border-box;
  background: rgba(15, 31, 27, 0.42);
}

.chat-modal {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 78vh;
  overflow: hidden;
  border-radius: 18rpx;
  background: #fffefb;
  box-shadow: 0 28rpx 84rpx rgba(18, 56, 47, 0.24);
}

.chat-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
  padding: 26rpx 26rpx 22rpx;
  border-bottom: 1rpx solid #ece5d7;
}

.chat-modal-title {
  color: #12382f;
  font-size: 32rpx;
  font-weight: 700;
}

.chat-modal-subtitle {
  margin-top: 6rpx;
  color: #7a857d;
  font-size: 22rpx;
  line-height: 1.4;
}

.chat-modal-close {
  flex: 0 0 92rpx;
  width: 92rpx;
  height: 56rpx;
  padding: 0;
  border-radius: 28rpx;
  background: #f1eee6;
  color: #365148;
  font-size: 24rpx;
  line-height: 56rpx;
}

.chat-modal-body {
  flex: 1;
  height: 720rpx;
  max-height: 56vh;
  min-height: 360rpx;
  padding: 24rpx;
  box-sizing: border-box;
}

.pinned-message {
  margin-bottom: 18rpx;
  padding: 20rpx;
  border-left: 6rpx solid #b89458;
  border-radius: 8rpx;
  background: #fbf6e9;
}

.pinned-label {
  color: #8d6f2f;
  font-size: 22rpx;
  font-weight: 600;
}

.pinned-text {
  margin-top: 8rpx;
  color: #203d35;
  font-size: 26rpx;
  line-height: 1.5;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 18rpx;
}

.message-item {
  align-self: flex-start;
  max-width: 86%;
  padding: 18rpx 20rpx;
  border-radius: 8rpx;
  background: #f4f1ea;
}

.message-item.mine {
  align-self: flex-end;
  background: #e8f3ed;
}

.message-meta {
  display: flex;
  justify-content: space-between;
  gap: 24rpx;
  color: #7a857d;
  font-size: 22rpx;
}

.message-content {
  margin-top: 8rpx;
  color: #183d34;
  font-size: 27rpx;
  line-height: 1.5;
}

.message-compose {
  display: flex;
  gap: 14rpx;
  align-items: center;
  margin-top: 22rpx;
  padding: 14rpx;
  border-radius: 14rpx;
  background: #f2f0ea;
}

.message-input {
  flex: 1;
  min-width: 0;
  height: 64rpx;
  color: #183d34;
  font-size: 26rpx;
}

.placeholder {
  color: #9ba39c;
}

.chat-modal .message-compose {
  margin-top: 0;
  border-top: 1rpx solid #ece5d7;
  border-radius: 0;
}
</style>
