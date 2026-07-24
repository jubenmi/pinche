<template>
  <view class="role-seat-surface" :class="{ frameless: !surface }">
    <view
      v-for="(section, sectionIndex) in normalizedSections"
      :key="section.key"
      class="role-seat-section"
      :class="{ divided: sectionIndex > 0 }"
    >
      <view
        v-if="section.title || section.summary || section.statusPill"
        class="role-seat-head"
      >
        <view class="role-seat-head-main">
          <view v-if="section.title" class="edit-title">{{ section.title }}</view>
          <view v-if="section.summary" class="section-note">{{ section.summary }}</view>
        </view>
        <t-tag v-if="section.statusPill" class="status-pill" theme="primary" variant="light" size="small">
          {{ section.statusPill }}
        </t-tag>
      </view>

      <t-notice-bar
        v-if="section.notice"
        class="notice"
        theme="warning"
        :visible="true"
        :content="section.notice"
      />

      <view v-if="section.items.length" class="role-board">
        <view
          v-for="item in section.items"
          :key="item.key || item.id || item.name"
          class="role-choice"
          :class="[
            roleToneClass(item),
            roleSelectionToneClass(item),
            {
              selected: item.selected || item.checked,
              focused: item.focused,
              'with-avatar': shouldShowRoleAvatar(item),
              mine: item.stateKind === 'mine' || item.mine,
              switching: item.stateKind === 'switching',
              pending: item.pending,
              taken: item.stateKind === 'taken' || item.taken,
              unavailable: item.stateKind === 'unavailable' || item.unavailable
            }
          ]"
          @tap="handleItemTap(item, section)"
        >
          <view class="role-choice-top">
            <view
              v-if="shouldShowRoleAvatar(item)"
              class="role-avatar"
              :class="roleAvatarClass(item)"
            >
              <image
                class="role-avatar-image"
                :src="roleAvatarSrc(item)"
                mode="aspectFill"
              />
            </view>
            <view class="role-choice-name">
              <text class="role-choice-title">{{ item.name }}</text>
              <text v-if="roleSymbol(item)" class="role-gender-symbol">
                {{ roleSymbol(item) }}
              </text>
            </view>
            <t-tag v-if="item.stateLabel" class="role-state" theme="primary" variant="light" size="small">
              {{ item.stateLabel }}
            </t-tag>
          </view>

          <view v-if="item.note || item.crossCast" class="role-choice-note">
            <text v-if="item.note" class="role-choice-note-text">{{ item.note }}</text>
            <text v-if="item.crossCast" class="cross-cast-tag">反串</text>
          </view>
          <view v-if="itemMeta(item).length" class="role-meta">
            <view
              v-for="meta in itemMeta(item)"
              :key="meta.key || meta.label || meta.text"
              class="role-meta-line"
            >
              <text v-if="meta.label" class="role-meta-label">{{ meta.label }}：</text>
              <text>{{ meta.text }}</text>
            </view>
          </view>

          <t-image
            v-if="item.checked"
            class="role-check"
            src="/static/icons/check.png"
            mode="aspectFit"
          />

          <view
            v-if="itemActions(item).length"
            class="role-actions"
            :class="{ single: itemActions(item).length === 1 }"
            @tap.stop
          >
            <t-button
              v-for="action in itemActions(item)"
              :key="action.key || action.label"
              class="role-action"
              :class="[action.variant || '', { disabled: action.disabled }]"
              :disabled="action.disabled"
              :open-type="action.openType || ''"
              :data-seat-id="action.seatId || item.seatId || item.id || ''"
              @tap.stop="handleActionTap(action, item, section)"
            >
              {{ action.label }}
            </t-button>
          </view>
        </view>
      </view>

      <t-empty v-else class="role-seat-empty" :description="emptyText" />
    </view>
  </view>
</template>

<script>
import { assetUrl } from "../utils/api";
import { normalizeRoleGender, roleGenderSymbol } from "../utils/createFlow";

const DEFAULT_AVATARS = {
  male: "/static/avatars/default-male.jpg",
  female: "/static/avatars/default-female.jpg",
  unknown: "/static/icons/user.png"
};

export default {
  props: {
    title: {
      type: String,
      default: ""
    },
    summary: {
      type: String,
      default: ""
    },
    statusPill: {
      type: String,
      default: ""
    },
    notice: {
      type: String,
      default: ""
    },
    items: {
      type: Array,
      default: () => []
    },
    sections: {
      type: Array,
      default: () => []
    },
    emptyText: {
      type: String,
      default: "暂无角色。"
    },
    surface: {
      type: Boolean,
      default: true
    }
  },
  computed: {
    normalizedSections() {
      const sections = this.sections.length
        ? this.sections
        : [
            {
              key: "main",
              title: this.title,
              summary: this.summary,
              statusPill: this.statusPill,
              notice: this.notice,
              items: this.items
            }
          ];
      return sections.map((section, index) => ({
        key: section.key || `section-${index}`,
        title: section.title || "",
        summary: section.summary || "",
        statusPill: section.statusPill || "",
        notice: section.notice || "",
        items: Array.isArray(section.items) ? section.items : []
      }));
    }
  },
  methods: {
    roleToneClass(item) {
      const gender = normalizeRoleGender(item.roleGender || item.role_gender || item.gender);
      return ["male", "female"].includes(gender) || item.showGenderSymbol ? gender : "";
    },
    roleSelectionToneClass(item) {
      const selectedByCurrentUser =
        item.mine ||
        item.pending ||
        item.selected ||
        item.checked ||
        item.focused ||
        ["mine", "switching"].includes(item.stateKind);
      if (!selectedByCurrentUser) {
        return "";
      }
      const gender = normalizeRoleGender(
        item.ownerGender ||
          item.selectionGender ||
          item.userGender ||
          item.avatarGender ||
          item.confirmedUserGender ||
          item.boundUserGender
      );
      return ["male", "female"].includes(gender) ? `owner-${gender}` : "";
    },
    roleSymbol(item) {
      if (item.genderSymbol) {
        return item.genderSymbol;
      }
      const gender = normalizeRoleGender(item.roleGender || item.role_gender || item.gender);
      if (item.showGenderSymbol && gender === "unlimited") {
        return "不限";
      }
      return roleGenderSymbol(gender);
    },
    roleAvatarGender(item) {
      return normalizeRoleGender(
        item.avatarGender ||
          item.userGender ||
          item.confirmedUserGender ||
          item.boundUserGender ||
          item.roleGender ||
          item.role_gender ||
          item.gender
      );
    },
    roleAvatarSrc(item) {
      const avatarUrl = item.avatarUrl || item.userAvatarUrl || item.confirmedUserAvatarUrl || item.boundUserAvatarUrl;
      if (avatarUrl) {
        return assetUrl(avatarUrl);
      }
      const gender = this.roleAvatarGender(item);
      return DEFAULT_AVATARS[gender] || DEFAULT_AVATARS.unknown;
    },
    roleAvatarClass(item) {
      const gender = this.roleAvatarGender(item);
      return ["male", "female"].includes(gender) ? gender : "unknown";
    },
    shouldShowRoleAvatar(item) {
      return Boolean(
        item.avatarUrl ||
          item.userAvatarUrl ||
          item.confirmedUserAvatarUrl ||
          item.boundUserAvatarUrl ||
          item.mine ||
          item.taken ||
          item.pending ||
          item.boundUserId ||
          item.confirmedUserId ||
          item.pendingUserId ||
          ["mine", "taken", "switching", "pendingReview"].includes(item.stateKind)
      );
    },
    itemActions(item) {
      return Array.isArray(item.actions) ? item.actions.filter(Boolean) : [];
    },
    itemMeta(item) {
      return Array.isArray(item.meta) ? item.meta.filter((meta) => meta?.text) : [];
    },
    handleItemTap(item, section) {
      this.$emit("itemtap", { item, sectionKey: section.key });
    },
    handleActionTap(action, item, section) {
      if (action.disabled) {
        return;
      }
      this.$emit("actiontap", { action, item, sectionKey: section.key });
    }
  }
};
</script>

<style scoped>
.role-seat-surface {
  margin-bottom: 24rpx;
  padding: 28rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.9);
  border-radius: 16rpx;
  background: rgba(255, 255, 252, 0.94);
  box-shadow: 0 16rpx 42rpx rgba(51, 69, 59, 0.05);
}

.role-seat-surface.frameless {
  margin-bottom: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.role-seat-section.divided {
  margin-top: 28rpx;
  padding-top: 24rpx;
  border-top: 1rpx solid rgba(223, 216, 204, 0.86);
}

.role-seat-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24rpx;
  margin-bottom: 22rpx;
}

.role-seat-head-main {
  min-width: 0;
}

.edit-title {
  margin-bottom: 8rpx;
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1.3;
}

.section-note {
  color: #7a857d;
  font-size: 24rpx;
  line-height: 1.45;
}

.status-pill {
  flex-shrink: 0;
  padding: 8rpx 14rpx;
  border-radius: 6rpx;
  background: #eef5ef;
  color: #1f6f5b;
  font-size: 22rpx;
  font-weight: 600;
  line-height: 1.35;
}

.notice {
  margin-bottom: 22rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  background: #eef7f4;
  color: #1f7a68;
  font-size: 24rpx;
  line-height: 1.5;
}

.role-board {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16rpx;
}

.role-choice {
  position: relative;
  width: 100%;
  min-width: 0;
  min-height: 132rpx;
  padding: 22rpx 18rpx;
  overflow: hidden;
  border: 1rpx solid rgba(223, 216, 204, 0.92);
  border-radius: 16rpx;
  background: rgba(255, 255, 252, 0.96);
  box-sizing: border-box;
}

.role-choice.with-avatar {
  min-height: 140rpx;
}

.role-choice.male {
  border-color: rgba(159, 184, 178, 0.9);
  background: rgba(242, 248, 247, 0.98);
}

.role-choice.female {
  border-color: rgba(224, 195, 184, 0.9);
  background: rgba(255, 248, 245, 0.98);
}

.role-choice.unlimited {
  border-color: rgba(210, 211, 205, 0.95);
  background: rgba(249, 249, 245, 0.98);
}

.role-choice.pending,
.role-choice.mine,
.role-choice.switching,
.role-choice.selected,
.role-choice.focused {
  border-width: 9rpx;
  padding: 14rpx 10rpx;
  border-color: #1f6f5b;
  box-shadow: 0 12rpx 30rpx rgba(51, 69, 59, 0.1);
}

.role-choice.mine.male,
.role-choice.switching.male,
.role-choice.selected.male,
.role-choice.focused.male {
  background: rgba(242, 248, 247, 0.98);
}

.role-choice.mine.female,
.role-choice.switching.female,
.role-choice.selected.female,
.role-choice.focused.female {
  background: rgba(255, 248, 245, 0.98);
}

.role-choice.mine.unlimited,
.role-choice.switching.unlimited,
.role-choice.selected.unlimited,
.role-choice.focused.unlimited {
  border-color: #1f6f5b;
}

.role-choice.mine.owner-male,
.role-choice.switching.owner-male,
.role-choice.selected.owner-male,
.role-choice.focused.owner-male {
  border-color: #2f6fed;
}

.role-choice.mine.owner-female,
.role-choice.switching.owner-female,
.role-choice.selected.owner-female,
.role-choice.focused.owner-female {
  border-color: #8f5bd6;
}

.role-choice.taken,
.role-choice.unavailable {
  border-color: rgba(214, 205, 188, 0.92);
  background: #f3f0e9;
  color: #8d8a82;
}

.role-choice.taken.male,
.role-choice.unavailable.male {
  background: rgba(242, 248, 247, 0.98);
}

.role-choice.taken.female,
.role-choice.unavailable.female {
  background: rgba(255, 248, 245, 0.98);
}

.role-choice-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  min-width: 0;
}

.role-avatar {
  display: flex;
  width: 46rpx;
  height: 46rpx;
  flex: 0 0 46rpx;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 2rpx solid rgba(196, 174, 119, 0.62);
  border-radius: 50%;
  background: #f4efe6;
}

.role-avatar.male {
  border-color: #2f6fed;
  background: #e8f0ff;
}

.role-avatar.female {
  border-color: #8f5bd6;
  background: #f0e8ff;
}

.role-avatar-image {
  width: 46rpx;
  height: 46rpx;
  border-radius: 50%;
}

.role-choice-name {
  display: flex;
  flex: 1 1 0;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6rpx;
  min-width: 0;
  overflow: hidden;
  color: #153f34;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1.25;
}

.role-choice-title {
  display: block;
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.role-choice.unlimited .role-gender-symbol {
  color: #8d9189;
}

.role-choice.taken .role-choice-name,
.role-choice.unavailable .role-choice-name {
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
  background: #2f6fed;
  color: #ffffff;
}

.role-choice.taken .role-state,
.role-choice.unavailable .role-state {
  color: #9b8d70;
}

.role-choice-note {
  display: flex;
  align-items: center;
  gap: 8rpx;
  width: 100%;
  margin-top: 14rpx;
  max-width: 100%;
  overflow: hidden;
  color: #7a857d;
  font-size: 23rpx;
  line-height: 1.35;
}

.role-choice-note-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cross-cast-tag {
  flex-shrink: 0;
  padding: 2rpx 8rpx;
  border-radius: 6rpx;
  background: #fff1e8;
  color: #d26819;
  font-size: 22rpx;
  font-weight: 600;
  line-height: 1.35;
}

.role-meta {
  margin-top: 12rpx;
}

.role-meta-line {
  margin-top: 6rpx;
  color: #607068;
  font-size: 22rpx;
  line-height: 1.4;
}

.role-meta-label {
  color: #7a857d;
}

.role-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
  margin-top: 20rpx;
}

.role-actions.single {
  grid-template-columns: 1fr;
}

.role-action {
  height: 58rpx;
  margin: 0;
  padding: 0 12rpx;
  border-radius: 8rpx;
  background: #1f6f5b;
  color: #ffffff;
  font-size: 22rpx;
  font-weight: 600;
  line-height: 58rpx;
}

.role-action.ghost,
.role-action.muted {
  border: 1rpx solid rgba(31, 111, 91, 0.34);
  background: #eef7f4;
  color: #1f6f5b;
  --td-button-default-bg-color: #eef7f4;
  --td-button-default-color: #1f6f5b;
  --td-button-default-border-color: rgba(31, 111, 91, 0.34);
}

.role-action.disabled {
  background: #d6d2c8;
  color: #ffffff;
}

.role-check {
  position: absolute;
  right: 18rpx;
  bottom: 16rpx;
  width: 34rpx;
  height: 34rpx;
}

.role-seat-empty {
  padding: 24rpx 0;
  color: #7a857d;
  font-size: 24rpx;
  line-height: 1.5;
}
</style>
