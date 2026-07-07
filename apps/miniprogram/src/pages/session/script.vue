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
        </view>
        <t-image
          class="script-status-icon"
          :src="isSelectedScript(script) ? '/static/icons/check.png' : '/static/icons/chevron.png'"
          mode="aspectFit"
        />
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

export default {
  components: { AuthIdentityBar, FeedbackHost },
  data() {
    return {
      keyword: "",
      store: null,
      scripts: [],
      selectedScript: null,
      statusText: ""
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

.script-status-icon {
  flex-shrink: 0;
  width: 32rpx;
  height: 32rpx;
  margin-left: 22rpx;
}

</style>
