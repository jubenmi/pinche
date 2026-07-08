<template>
  <view class="page flow-page">
    <AuthIdentityBar />
    <FeedbackHost />

    <view class="flow-top">
      <view class="step-label">2 / 4</view>
      <view class="title">选择剧本</view>
      <view class="text">{{ storeName }} 可玩的剧本，选一个就好。</view>
    </view>

    <view class="list-surface">
      <t-notice-bar
        v-if="statusText"
        class="notice"
        theme="warning"
        :visible="true"
        :content="statusText"
      />
      <view
        v-for="script in scripts"
        :key="script.id"
        class="script-row"
        :class="{ selected: isSelectedScript(script) }"
        @tap="selectScript(script)"
      >
        <view class="script-main">
          <view class="script-head">
            <view class="script-title">{{ script.name }}</view>
            <view class="script-count">{{ script.player_count || 0 }}人</view>
            <t-tag class="script-tag" theme="primary" variant="light" size="small">
              {{ scriptMood(script) }}
            </t-tag>
          </view>
          <view class="script-summary">{{ script.summary_no_spoiler || "暂无简介" }}</view>
          <view v-if="scriptBadge(script)" class="private-badge">{{ scriptBadge(script) }}</view>
        </view>
        <t-image
          class="script-status-icon"
          :src="isSelectedScript(script) ? '/static/icons/check.png' : '/static/icons/chevron.png'"
          mode="aspectFit"
        />
      </view>
      <view v-if="scripts.length === 0 && !statusText" class="empty-row">
        <view class="empty-title">没有找到剧本</view>
        <view class="empty-text">添加给自己用，管理员审核后会变成公共资料。</view>
        <t-button class="inline-button" size="small" @tap="showScriptForm = true">添加给自己用</t-button>
      </view>
      <view class="add-row" @tap="showScriptForm = !showScriptForm">
        {{ showScriptForm ? "收起添加剧本" : "没有找到？添加一个剧本" }}
      </view>
    </view>

    <view v-if="showScriptForm" class="private-form">
      <view class="form-title">添加给自己用</view>
      <t-input
        :value="scriptForm.name"
        class="field"
        placeholder="剧本名称"
        @change="scriptForm.name = $event.detail.value"
      />
      <view class="field-row">
        <t-input
          :value="scriptForm.playerCount"
          class="field half"
          type="number"
          placeholder="人数"
          @change="scriptForm.playerCount = $event.detail.value"
        />
        <t-input
          :value="scriptForm.typeTagsText"
          class="field half"
          placeholder="标签，逗号分隔"
          @change="scriptForm.typeTagsText = $event.detail.value"
        />
      </view>
      <t-textarea
        :value="scriptForm.summaryNoSpoiler"
        class="textarea"
        placeholder="无剧透简介"
        @change="scriptForm.summaryNoSpoiler = $event.detail.value"
      />
      <view class="form-actions">
        <t-button class="button" :disabled="creatingScript" @tap="submitPrivateScript">
          {{ creatingScript ? "提交中..." : "提交并使用" }}
        </t-button>
        <t-button class="button secondary" :disabled="creatingScript" @tap="resetScriptForm">
          清空
        </t-button>
      </view>
    </view>

    <view class="bottom-action">
      <t-button class="button" :class="{ disabled: !selectedScript }" @tap="goNext">下一步</t-button>
    </view>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import { dataOf, queryString, request } from "../../utils/api";
import { displayTags, firstTag, readCreateFlow, writeCreateFlow } from "../../utils/createFlow";
import { showToast } from "../../utils/tdesignFeedback";

const FALLBACK_SCRIPTS = [
  {
    id: "demo-script-1",
    name: "风起洛阳",
    type_tags: "[\"古风\",\"6人本\"]",
    player_count: 6,
    summary_no_spoiler: "神都迷案重起，拨开迷雾，揭开真相。",
    default_seat_template_json:
      "[{\"name\":\"萧景璟\",\"roleName\":\"主线位\",\"roleGender\":\"male\"},{\"name\":\"百里无瑕\",\"roleName\":\"沉浸位\",\"roleGender\":\"male\"},{\"name\":\"柳疏影\",\"roleName\":\"互动位\",\"roleGender\":\"female\"},{\"name\":\"裴昭\",\"roleName\":\"推理位\",\"roleGender\":\"male\"},{\"name\":\"沈清商\",\"roleName\":\"情感位\",\"roleGender\":\"female\"},{\"name\":\"公孙策\",\"roleName\":\"观察位\",\"roleGender\":\"unlimited\"}]"
  },
  {
    id: "demo-script-2",
    name: "长夜将尽",
    type_tags: "[\"推理\",\"6人本\"]",
    player_count: 6,
    summary_no_spoiler: "一起追还凶案，六位陌生人被卷入真相。",
    default_seat_template_json:
      "[{\"name\":\"陆闻舟\",\"roleGender\":\"male\"},{\"name\":\"林见鹿\",\"roleGender\":\"female\"},{\"name\":\"周祈\",\"roleGender\":\"male\"},{\"name\":\"许知夏\",\"roleGender\":\"female\"},{\"name\":\"梁照\",\"roleGender\":\"male\"},{\"name\":\"宋停云\",\"roleGender\":\"unlimited\"}]"
  },
  {
    id: "demo-script-3",
    name: "余烬之上",
    type_tags: "[\"现代\",\"7人本\"]",
    player_count: 7,
    summary_no_spoiler: "一场大火后的秘密，谁在操控这一切？",
    default_seat_template_json:
      "[{\"name\":\"顾南枝\",\"roleGender\":\"female\"},{\"name\":\"沈砚\",\"roleGender\":\"male\"},{\"name\":\"程也\",\"roleGender\":\"male\"},{\"name\":\"江离\",\"roleGender\":\"unlimited\"},{\"name\":\"夏眠\",\"roleGender\":\"female\"},{\"name\":\"白序\",\"roleGender\":\"male\"},{\"name\":\"唐越\",\"roleGender\":\"unlimited\"}]"
  },
  {
    id: "demo-script-4",
    name: "南墙",
    type_tags: "[\"情感\",\"5人本\"]",
    player_count: 5,
    summary_no_spoiler: "爱与执念的边界，真相藏在回忆里。",
    default_seat_template_json:
      "[{\"name\":\"南墙\",\"roleGender\":\"unlimited\"},{\"name\":\"阿木\",\"roleGender\":\"male\"},{\"name\":\"沈清商\",\"roleGender\":\"female\"},{\"name\":\"柳疏影\",\"roleGender\":\"female\"},{\"name\":\"裴昭\",\"roleGender\":\"male\"}]"
  }
];

function defaultScriptForm() {
  return {
    name: "",
    playerCount: "6",
    typeTagsText: "情感,沉浸",
    summaryNoSpoiler: ""
  };
}

function typeTagsFromText(value) {
  return String(value || "")
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default {
  components: { AuthIdentityBar, FeedbackHost },
  data() {
    return {
      keyword: "",
      store: null,
      scripts: [],
      selectedScript: null,
      statusText: "",
      showScriptForm: false,
      creatingScript: false,
      scriptForm: defaultScriptForm()
    };
  },
  computed: {
    storeName() {
      return this.store?.name || "当前店家";
    }
  },
  onLoad(options) {
    const flow = readCreateFlow();
    this.store =
      flow.store ||
      (options.storeId
        ? {
            id: options.storeId,
            name: this.safeDecode(options.storeName),
            district: this.safeDecode(options.storeDistrict)
          }
        : null);
    if (this.store) {
      writeCreateFlow({ store: this.store });
    }
    this.loadScripts();
  },
  methods: {
    safeDecode(value) {
      if (!value) {
        return "";
      }
      try {
        return decodeURIComponent(value);
      } catch (error) {
        return String(value);
      }
    },
    displayScriptTags(value) {
      return displayTags(value);
    },
    scriptMood(script) {
      return firstTag(script.type_tags);
    },
    scriptBadge(script) {
      if (script.visibility !== "private") {
        return "";
      }
      if (script.review_status === "pending") {
        return "仅自己可用 · 待审核";
      }
      if (script.review_status === "needs_changes") {
        return "仅自己可用 · 需补充";
      }
      return script.catalog_badge || "仅自己可用";
    },
    async loadScripts() {
      this.statusText = "正在加载剧本...";
      const storeId = this.store?.id;
      try {
        const response = await request({
          url: "/api/scripts" + queryString({ keyword: this.keyword, storeId: this.store?.id, limit: 30 })
        });
        const scripts = dataOf(response) || [];
        if (scripts.length > 0) {
          this.scripts = scripts;
          this.statusText = "";
          return;
        }
        this.scripts = storeId ? [] : FALLBACK_SCRIPTS;
        this.statusText = storeId ? "这家店暂未关联可玩的剧本。" : "";
      } catch (error) {
        this.scripts = storeId ? [] : FALLBACK_SCRIPTS;
        this.statusText = storeId
          ? "剧本加载失败，稍后再试。"
          : "已展示演示剧本，本地服务启动后会显示真实数据。";
      }
    },
    async selectScript(script) {
      if (this.isSelectedScript(script)) {
        await this.goNext();
        return;
      }
      this.selectedScript = script;
      writeCreateFlow({ script, role: null });
    },
    resetScriptForm() {
      this.scriptForm = defaultScriptForm();
    },
    async submitPrivateScript() {
      if (this.creatingScript) {
        return;
      }
      const playerCount = Number(this.scriptForm.playerCount || 0);
      if (!this.scriptForm.name) {
        showToast({ title: "请填写剧本名称", icon: "none" });
        return;
      }
      if (!Number.isInteger(playerCount) || playerCount <= 0) {
        showToast({ title: "请填写正确人数", icon: "none" });
        return;
      }
      this.creatingScript = true;
      try {
        const response = await request({
          url: "/api/scripts",
          method: "POST",
          data: {
            name: this.scriptForm.name,
            playerCount,
            typeTags: typeTagsFromText(this.scriptForm.typeTagsText),
            summaryNoSpoiler: this.scriptForm.summaryNoSpoiler
          }
        });
        const script = dataOf(response);
        if (!script) {
          throw new Error("missing script");
        }
        this.scripts = [script, ...this.scripts.filter((item) => String(item.id) !== String(script.id))];
        this.selectedScript = script;
        writeCreateFlow({ script, role: null });
        this.resetScriptForm();
        this.showScriptForm = false;
        this.statusText = "";
        showToast({ title: "已添加，仅自己可用 · 待审核", icon: "none" });
      } catch (error) {
        showToast({ title: error?.userMessage || "剧本提交失败", icon: "none" });
      } finally {
        this.creatingScript = false;
      }
    },
    isSelectedScript(script) {
      return (
        this.selectedScript &&
        String(this.selectedScript.id) === String(script.id)
      );
    },
    async goNext() {
      if (!this.selectedScript) {
        showToast({ title: "先选择一个剧本", icon: "none" });
        return;
      }
      const query = queryString({ scriptId: this.selectedScript.id });
      uni.navigateTo({ url: `/pages/session/role${query}` });
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

.list-surface {
  overflow: hidden;
  border: 1rpx solid rgba(223, 216, 204, 0.9);
  border-radius: 16rpx;
  background: rgba(255, 255, 252, 0.94);
  box-shadow: 0 16rpx 42rpx rgba(51, 69, 59, 0.05);
}

.notice {
  padding: 22rpx 26rpx;
  color: #8d7b55;
  font-size: 24rpx;
  line-height: 1.5;
  background: #fbf6e9;
}

.script-row {
  display: flex;
  align-items: center;
  min-height: 146rpx;
  padding: 22rpx 24rpx;
  border-top: 1rpx solid #eee8da;
}

.script-row:first-child {
  border-top: none;
}

.script-row.selected {
  background: linear-gradient(90deg, rgba(231, 239, 232, 0.88), rgba(255, 255, 252, 0.9));
}

.script-main {
  flex: 1;
  min-width: 0;
}

.script-head {
  display: flex;
  gap: 18rpx;
  align-items: center;
}

.script-title {
  flex: 1;
  color: #153f34;
  font-size: 31rpx;
  font-weight: 600;
  line-height: 1.28;
}

.script-count {
  color: #7f827b;
  font-size: 24rpx;
}

.script-tag {
  display: inline-block;
  padding: 4rpx 12rpx;
  border-radius: 6rpx;
  background: #f5ecd8;
  color: #967139;
  font-size: 22rpx;
  line-height: 1.35;
}

.script-summary {
  margin-top: 14rpx;
  color: #7a857d;
  font-size: 24rpx;
  line-height: 1.45;
}

.private-badge {
  display: inline-flex;
  margin-top: 12rpx;
  padding: 5rpx 12rpx;
  border: 1rpx solid rgba(31, 122, 104, 0.18);
  border-radius: 6rpx;
  background: #eef7f4;
  color: #1f7a68;
  font-size: 22rpx;
  font-weight: 600;
  line-height: 1.35;
}

.script-status-icon {
  flex-shrink: 0;
  width: 32rpx;
  height: 32rpx;
  margin-left: 22rpx;
}

.empty-row {
  padding: 42rpx 28rpx;
  text-align: center;
}

.empty-title {
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
}

.empty-text {
  margin-top: 10rpx;
  color: #7a857d;
  font-size: 24rpx;
  line-height: 1.5;
}

.inline-button {
  margin-top: 22rpx;
}

.add-row {
  padding: 26rpx 28rpx;
  border-top: 1rpx solid #eee8da;
  color: #1f7a68;
  font-size: 26rpx;
  font-weight: 600;
  text-align: center;
}

.private-form {
  margin-top: 22rpx;
  padding: 24rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.9);
  border-radius: 16rpx;
  background: rgba(255, 255, 252, 0.96);
  box-shadow: 0 16rpx 42rpx rgba(51, 69, 59, 0.05);
}

.form-title {
  margin-bottom: 18rpx;
  color: #153f34;
  font-size: 28rpx;
  font-weight: 700;
}

.field-row,
.form-actions {
  display: flex;
  gap: 14rpx;
}

.field,
.textarea {
  width: 100%;
  margin-bottom: 16rpx;
  box-sizing: border-box;
  border: 1rpx solid #d7dde5;
  border-radius: 8rpx;
  background: #ffffff;
}

.field.half {
  flex: 1;
}

.textarea {
  min-height: 132rpx;
  padding: 18rpx 20rpx;
  color: #1f2933;
  font-size: 26rpx;
  line-height: 1.45;
}

</style>
