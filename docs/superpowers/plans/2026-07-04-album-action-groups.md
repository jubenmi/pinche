# Album Action Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the mini-program album header controls into simple action groups while preserving all existing album behavior.

**Architecture:** Keep all business logic inside `apps/miniprogram/src/pages/session/album.vue`; this is a presentational information-architecture change. Add static coverage to `scripts/check-miniprogram.js` so future edits keep the grouped action and filter structure.

**Tech Stack:** uni-app Vue single-file component, existing scoped CSS, existing Node static check script.

---

### Task 1: Add Static Check Coverage

**Files:**
- Modify: `scripts/check-miniprogram.js`

- [x] **Step 1: Write the failing static check**

Add a required-token loop after the existing album download checks:

```js
  for (const requiredAlbumActionGroupText of [
    "album-primary-actions",
    "album-action-groups",
    "album-action-group",
    "album-action-group-title",
    "保存到手机",
    "整理标注",
    "album-filter-panel",
    "filter-panel-head",
    "查看照片",
    "角色",
    "openDownloadSelectionMode",
    "openTagSelectionMode"
  ]) {
    if (!albumSource.includes(requiredAlbumActionGroupText)) {
      fail(`Album page must group header actions by user task: ${requiredAlbumActionGroupText}`);
    }
  }
```

- [x] **Step 2: Run the static check and verify it fails**

Run: `node scripts/check-miniprogram.js`

Expected: FAIL with `Album page must group header actions by user task: album-primary-actions`.

### Task 2: Rework Album Header Actions

**Files:**
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [x] **Step 1: Replace the current header command rail**

Replace the `album-actions` block with a primary action row and two grouped action sections:

```vue
      <view v-if="!timelineMode" class="album-actions">
        <view v-show="!selectionMode" class="album-primary-actions">
          <button
            v-if="canUpload"
            class="button album-action-primary"
            :class="{ disabled: albumBusy }"
            :disabled="albumBusy"
            @tap="choosePhotos"
          >
            {{ uploading ? "上传中..." : "上传照片" }}
          </button>
          <button
            v-if="canUpload"
            class="button secondary album-privacy-action"
            :disabled="albumBusy"
            @tap="goPrivacy"
          >
            隐私设置
          </button>
        </view>

        <view v-show="!selectionMode" class="album-action-groups">
          <view v-if="photos.length" class="album-action-group">
            <view class="album-action-group-title">保存到手机</view>
            <view class="album-command-rail">
              <button class="album-command" :disabled="albumBusy" @tap="downloadAllPhotos">
                全部下载
              </button>
              <button
                v-if="filteredPhotos.length"
                class="album-command"
                :disabled="albumBusy"
                @tap="openDownloadSelectionMode"
              >
                多选下载
              </button>
            </view>
          </view>

          <view v-if="taggablePhotos.length" class="album-action-group">
            <view class="album-action-group-title">整理标注</view>
            <view class="album-command-rail">
              <button class="album-command" :disabled="albumBusy" @tap="openTagSelectionMode">
                批量标注
              </button>
              <view class="album-action-hint">待标注 {{ filteredUntaggedPhotoCount }}</view>
            </view>
          </view>
        </view>
      </view>
```

- [x] **Step 2: Update CSS for grouped actions**

Replace the old `.album-actions`, `.album-action-primary`, `.album-command-rail`, and `.album-command` styles with grouped layout styles that keep stable dimensions and allow wrapping:

```css
.album-actions {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 24rpx;
}

.album-primary-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180rpx;
  gap: 12rpx;
}

.album-action-primary,
.album-privacy-action {
  height: 78rpx;
  margin: 0;
  border-radius: 12rpx;
  font-size: 26rpx;
}

.album-action-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
}

.album-action-group {
  min-width: 0;
}

.album-action-group-title {
  margin-bottom: 8rpx;
  color: #8a7c63;
  font-size: 21rpx;
  line-height: 1.2;
}

.album-command-rail {
  display: flex;
  min-width: 0;
  min-height: 70rpx;
  padding: 4rpx;
  border: 1rpx solid rgba(222, 215, 202, 0.82);
  border-radius: 14rpx;
  background: rgba(250, 248, 241, 0.72);
}

.album-command,
.album-action-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
  min-height: 62rpx;
  margin: 0;
  padding: 0 8rpx;
  border: 0;
  border-radius: 10rpx;
  background: transparent;
  color: #23483f;
  font-size: 22rpx;
  font-weight: 500;
  line-height: 1.16;
  box-shadow: none;
}
```

### Task 3: Move Filters Into a View Panel

**Files:**
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [x] **Step 1: Wrap existing filters in `album-filter-panel`**

Replace the standalone `role-filter-row` and `filter-row` blocks with:

```vue
    <view v-if="!timelineMode" class="album-filter-panel">
      <view class="filter-panel-head">
        <view class="filter-panel-title">查看照片</view>
        <view class="filter-panel-count">当前 {{ filteredPhotos.length }} 张</view>
      </view>

      <view class="filter-row">
        <button
          v-for="filter in albumFilterOptions"
          :key="filter.value"
          class="filter-chip"
          :class="{ active: activeFilter === filter.value }"
          :disabled="albumBusy"
          @tap="activeFilter = filter.value"
        >
          <text>{{ filter.label }}</text>
          <text class="filter-count">{{ filter.count }}</text>
        </button>
      </view>

      <view class="role-filter-row">
        <view class="role-filter-label">角色</view>
        <picker
          mode="selector"
          :range="albumRoleFilterLabels"
          :value="selectedRoleFilterIndex"
          :disabled="albumBusy || albumRoleFilterOptions.length <= 1"
          @change="handleRoleFilterChange"
        >
          <view
            class="role-filter-picker"
            :class="{ disabled: albumBusy || albumRoleFilterOptions.length <= 1 }"
          >
            {{ selectedRoleFilterLabel }}
          </view>
        </picker>
      </view>
    </view>
```

- [x] **Step 2: Update filter panel CSS**

Add panel styles and remove the old duplicated `.filter-row` declarations:

```css
.album-filter-panel {
  margin-bottom: 20rpx;
  padding: 18rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.82);
  border-radius: 12rpx;
  background: rgba(255, 255, 252, 0.8);
}

.filter-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-bottom: 14rpx;
}

.filter-panel-title {
  color: #153f34;
  font-size: 25rpx;
  font-weight: 600;
}

.filter-panel-count {
  flex-shrink: 0;
  color: #839087;
  font-size: 21rpx;
}
```

### Task 4: Verify

**Files:**
- Check: `scripts/check-miniprogram.js`
- Check: `apps/miniprogram/src/pages/session/album.vue`

- [x] **Step 1: Run static check**

Run: `node scripts/check-miniprogram.js`

Expected: no output and exit code `0`.

- [x] **Step 2: Run syntax checks for edited files**

Run: `node --check scripts/check-miniprogram.js`

Expected: no output and exit code `0`.

- [x] **Step 3: Inspect changed files**

Run: `git diff -- docs/superpowers/specs/2026-07-04-album-action-groups-design.md docs/superpowers/plans/2026-07-04-album-action-groups.md scripts/check-miniprogram.js apps/miniprogram/src/pages/session/album.vue`

Expected: diff only contains the new docs, the static check, and the album UI regrouping.
