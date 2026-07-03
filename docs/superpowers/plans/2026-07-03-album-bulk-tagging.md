# Album Bulk Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mini-program album multi-select bulk tagging that replaces selected photos with the same tag set by looping over the existing single-photo tag endpoint.

**Architecture:** Keep the backend unchanged. Extend `apps/miniprogram/src/pages/session/album.vue` with local selection state, a batch action bar, and a save path that reuses the current tag sheet and loops through selected photo ids. Extend the existing mini-program static check so the behavior stays covered by the root check suite.

**Tech Stack:** uni-app Vue single-file component, existing `request` helper, existing Node static check script.

---

### Task 1: Add Static Check Coverage

**Files:**
- Modify: `scripts/check-miniprogram.js`

- [x] **Step 1: Write the failing static check**

Add these required tokens after the existing album busy checks in `scripts/check-miniprogram.js`:

```js
  for (const requiredAlbumBulkTagText of [
    "selectionMode",
    "selectedPhotoIds",
    "bulkTagging",
    "toggleSelectionMode",
    "togglePhotoSelection",
    "openBulkTagSheet",
    "selectedPhotoCount",
    "selectedTagTargetCount",
    "selection-checkbox",
    "selection-checkbox-box",
    "部分照片标注失败",
    "给 {{ selectedTagTargetCount }} 张照片标注",
    "for (const photoId of targetPhotoIds)",
    "url: `/api/session-album/photos/${photoId}/tags`",
    "data: { tagKeys: this.selectedTagKeys }"
  ]) {
    if (!albumSource.includes(requiredAlbumBulkTagText)) {
      fail(`Album page must support bulk tagging: ${requiredAlbumBulkTagText}`);
    }
  }
```

- [x] **Step 2: Run the static check and verify it fails**

Run: `node scripts/check-miniprogram.js`

Expected: FAIL with a message like `Album page must support bulk tagging: selectionMode`.

- [x] **Step 3: Keep the failing check for implementation**

Do not weaken the check. The implementation must add the exact behavior tokens.

### Task 2: Add Multi-Select UI and State

**Files:**
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [x] **Step 1: Add state and computed helpers**

Add these data fields:

```js
      selectionMode: false,
      selectedPhotoIds: [],
      bulkTagging: false,
```

Add these computed values:

```js
    taggablePhotos() {
      return this.filteredPhotos.filter((photo) => photo.can_tag);
    },
    selectedPhotoCount() {
      return this.selectedPhotoIds.length;
    },
    selectedTagTargetCount() {
      if (this.bulkTagging) {
        return this.selectedPhotoCount;
      }
      return this.tagSheetPhoto ? 1 : 0;
    },
```

Keep `albumBusy` tied to actual in-flight work. `savingTags` already locks bulk saves while requests are running, so `bulkTagging` should not be included in `albumBusy`.

- [x] **Step 2: Add selection methods**

Add methods:

```js
    toggleSelectionMode() {
      if (this.albumBusy) {
        return;
      }
      this.selectionMode = !this.selectionMode;
      this.selectedPhotoIds = [];
    },
    isPhotoSelected(photo) {
      return this.selectedPhotoIds.includes(Number(photo.id));
    },
    togglePhotoSelection(photo) {
      if (!this.selectionMode || this.albumBusy || !photo.can_tag) {
        return;
      }
      const photoId = Number(photo.id);
      if (this.selectedPhotoIds.includes(photoId)) {
        this.selectedPhotoIds = this.selectedPhotoIds.filter((id) => id !== photoId);
        return;
      }
      this.selectedPhotoIds = [...this.selectedPhotoIds, photoId];
    },
    openBulkTagSheet() {
      if (this.albumBusy || this.selectedPhotoIds.length === 0) {
        return;
      }
      this.bulkTagging = true;
      this.tagSheetPhoto = { id: null };
      this.selectedTagKeys = [];
    },
```

Update `activeFilter` watcher to clear selection:

```js
    activeFilter() {
      this.selectionMode = false;
      this.selectedPhotoIds = [];
      this.refreshWaterfall();
    }
```

- [x] **Step 3: Add template controls**

Add a top action button shown only when the current filter has taggable photos:

```vue
        <button
          v-if="taggablePhotos.length"
          class="button secondary"
          :disabled="albumBusy"
          @tap="toggleSelectionMode"
        >
          {{ selectionMode ? "退出多选" : "多选" }}
        </button>
```

Add selection classes and tap behavior to each `.photo-card`:

```vue
            :class="{
              selectable: selectionMode && photo.can_tag,
              selected: selectionMode && isPhotoSelected(photo),
              disabled: selectionMode && !photo.can_tag
            }"
            @tap="togglePhotoSelection(photo)"
```

Add a checkbox overlay inside each `.photo-image-shell`:

```vue
              <view
                v-if="selectionMode"
                class="selection-checkbox"
                :class="{ selected: isPhotoSelected(photo), disabled: !photo.can_tag }"
              >
                <view class="selection-checkbox-box">
                  {{ isPhotoSelected(photo) ? "✓" : "" }}
                </view>
              </view>
```

Hide per-card tag/delete actions in selection mode with `v-if="!selectionMode"`.

Add a bottom action bar after the waterfall:

```vue
    <view v-if="selectionMode" class="bulk-action-bar">
      <button class="button secondary" :disabled="albumBusy" @tap="toggleSelectionMode">取消</button>
      <view class="bulk-count">已选 {{ selectedPhotoCount }} 张</view>
      <button
        class="button"
        :class="{ disabled: albumBusy || selectedPhotoCount === 0 }"
        :disabled="albumBusy || selectedPhotoCount === 0"
        @tap="openBulkTagSheet"
      >
        批量标注
      </button>
    </view>
```

### Task 3: Implement Bulk Save Semantics

**Files:**
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [x] **Step 1: Update the tag sheet copy**

Change the tag sheet title to:

```vue
        <view class="sheet-title">
          <text v-if="bulkTagging">给 {{ selectedTagTargetCount }} 张照片标注</text>
          <text v-else>这张照片里有谁</text>
        </view>
```

Change the note to mention replacement in bulk mode:

```vue
        <view class="sheet-note">
          {{ bulkTagging ? "保存后，这些照片会替换成同一组标签。" : "标注后会按成员隐私自动决定谁可见。" }}
        </view>
```

- [x] **Step 2: Preserve single-photo save and add bulk loop**

Replace `saveTags` with a target-list implementation:

```js
    async saveTags() {
      if (!this.tagSheetPhoto || this.albumBusy) {
        return;
      }
      const targetPhotoIds = this.bulkTagging
        ? [...this.selectedPhotoIds]
        : [Number(this.tagSheetPhoto.id)];
      if (targetPhotoIds.length === 0) {
        return;
      }
      this.savingTags = true;
      let failedCount = 0;
      try {
        for (const photoId of targetPhotoIds) {
          try {
            await request({
              url: `/api/session-album/photos/${photoId}/tags`,
              method: "PUT",
              data: { tagKeys: this.selectedTagKeys }
            });
          } catch (error) {
            failedCount += 1;
          }
        }
        const allFailed = failedCount === targetPhotoIds.length;
        this.closeTagSheet();
        this.selectionMode = false;
        this.selectedPhotoIds = [];
        await this.loadAlbum();
        if (allFailed) {
          uni.showToast({ title: "标注保存失败", icon: "none" });
          return;
        }
        if (failedCount > 0) {
          uni.showToast({ title: "部分照片标注失败", icon: "none" });
        }
      } finally {
        this.savingTags = false;
      }
    }
```

- [x] **Step 3: Reset bulk state when closing the tag sheet**

Update `closeTagSheet`:

```js
    closeTagSheet() {
      this.tagSheetPhoto = null;
      this.selectedTagKeys = [];
      this.bulkTagging = false;
    },
```

### Task 4: Styling and Verification

**Files:**
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [x] **Step 1: Add scoped styles**

Add styles for selected cards, checkbox overlay, and bottom bar:

```css
.photo-card.selectable {
  border-color: rgba(31, 111, 91, 0.45);
}

.photo-card.selected {
  border-color: #1f6f5b;
  box-shadow: 0 0 0 3rpx rgba(31, 111, 91, 0.12);
}

.photo-card.disabled {
  opacity: 0.62;
}

.selection-checkbox {
  position: absolute;
  top: 12rpx;
  right: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52rpx;
  height: 52rpx;
  border-radius: 10rpx;
  background: rgba(15, 23, 42, 0.32);
}

.selection-checkbox-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34rpx;
  height: 34rpx;
  border: 3rpx solid rgba(255, 255, 255, 0.96);
  border-radius: 7rpx;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 26rpx;
  font-weight: 700;
  line-height: 34rpx;
}

.selection-checkbox.selected {
  background: #1f6f5b;
}

.selection-checkbox.selected .selection-checkbox-box {
  border-color: #ffffff;
  background: #1f6f5b;
}

.selection-checkbox.disabled {
  background: rgba(148, 163, 184, 0.64);
}

.selection-checkbox.disabled .selection-checkbox-box {
  background: rgba(255, 255, 255, 0.1);
}

.bulk-action-bar {
  position: fixed;
  right: 24rpx;
  bottom: 34rpx;
  left: 24rpx;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 16rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.92);
  border-radius: 10rpx;
  background: rgba(255, 255, 252, 0.98);
  box-shadow: 0 18rpx 42rpx rgba(32, 44, 38, 0.16);
}

.bulk-count {
  flex: 1;
  color: #334155;
  font-size: 25rpx;
  text-align: center;
}
```

- [ ] **Step 2: Run the targeted static check**

Run: `node scripts/check-miniprogram.js`

Expected: PASS.

Result: bulk-tagging assertions pass, but the full script is still blocked by the pre-existing local `apps/miniprogram/.env.development` value `VITE_API_BASE_URL=http://127.0.0.1:3018`.

- [x] **Step 3: Run syntax checks**

Run:

```bash
node --check scripts/check-miniprogram.js
npm --workspace apps/miniprogram run build:mp-weixin
```

Expected: both pass.

- [ ] **Step 4: Commit implementation**

Stage only the plan, the mini-program check, and the album page:

```bash
git add docs/superpowers/plans/2026-07-03-album-bulk-tagging.md scripts/check-miniprogram.js apps/miniprogram/src/pages/session/album.vue
git commit -m "feat: add album bulk tagging"
```

Result: deferred. `apps/miniprogram/src/pages/session/album.vue` and `scripts/check-miniprogram.js` already contain unrelated unstaged work in the same files, so committing the whole file would include changes outside this feature.

### Task 5: Add Bulk Tagging To Web Miniapp Album

**Reason:** The in-app browser uses the admin-web "网页小程序" surface at `?view=miniapp&screen=album&sessionId=...`, which renders `SessionAlbumWorkspace.vue` instead of the WeChat mini-program `album.vue`. The approved behavior must therefore exist in this component too.

**Files:**
- Modify: `apps/admin-web/src/components/SessionAlbumWorkspace.vue`
- Modify: `apps/admin-web/src/styles.css`
- Modify: `scripts/d12-admin-web-check.js`

- [x] **Step 1: Add failing admin-web static check**

Added checks for:

```js
"bulkSelectionMode",
"selectedAlbumPhotoIds",
"album-selection-checkbox",
"toggleBulkSelectionMode",
"toggleAlbumPhotoSelection",
"openBulkTagDrawer",
"selectedAlbumPhotoCount",
"selectedTagTargetCount",
"部分照片标注失败",
"for (const photoId of targetPhotoIds)",
"await updateSessionAlbumPhotoTags(photoId, selectedTagKeys.value)"
```

Run: `node scripts/d12-admin-web-check.js`

Result: failed on `admin mini album should support bulk tagging: bulkSelectionMode`.

- [x] **Step 2: Add web miniapp selection UI**

Added "多选照片" to the top album toolbar and album action row, added per-photo checkbox overlays, selection state, and a sticky bulk action bar.

Update: the bulk action bar was replaced by a sticky `album-command-bar` above the photo waterfall. The command bar owns filters, upload entry, privacy entry, multi-select entry, selected count, "全选当前筛选", "清空", and "批量标注". No bulk UI buttons are placed at the waterfall bottom.

- [x] **Step 3: Add web miniapp bulk save loop**

Added bulk drawer mode and saved by looping over selected photo ids with the existing `updateSessionAlbumPhotoTags(photoId, selectedTagKeys.value)` helper.

- [x] **Step 4: Verify admin-web checks and build**

Run:

```bash
node scripts/d12-admin-web-check.js
npm --workspace apps/admin-web run build
```

Expected: both pass.

- [x] **Step 5: Browser-check redesigned layout**

Verified in the in-app browser at `http://localhost:5178/?view=miniapp&screen=album&sessionId=29`:

- `album-command-bar` renders before the waterfall.
- Entering multi-select shows 266 checkbox overlays for 266 visible photos.
- "全选当前筛选" selects all current taggable photos and enables "批量标注".
- "清空" clears the selection without saving.
- `album-action-row` and `album-bulk-action-bar` are absent.

## Self-Review

- Spec coverage: Task 2 covers multi-select entry, selectable photos, selection clearing, and UI affordances. Task 3 covers front-end looping over the existing endpoint, replacement semantics, empty tag sets, partial failure, full failure, refresh, and cleanup. Task 4 covers visual states and verification. No backend work is included.
- Placeholder scan: The plan contains no unresolved placeholders or unspecified implementation steps.
- Type consistency: State names are `selectionMode`, `selectedPhotoIds`, and `bulkTagging` throughout. Bulk saving uses `targetPhotoIds` and sends the same `selectedTagKeys` to every existing single-photo endpoint request.
