# Album Tag Sheet Action Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep “取消” and “保存标注” visible and tappable while long role lists scroll inside the album tag sheet.

**Architecture:** Preserve the existing `t-popup`, role selection data, and save handlers. Convert the tag sheet into a bounded vertical flex container, move variable-length content into a native mini-program `scroll-view`, and keep the action row as a non-scrolling footer. Add a source-structure regression test and register it in the album media test command.

**Tech Stack:** UniApp Vue SFC, WeChat mini-program `scroll-view`, TDesign Mini Program, Node.js built-in test runner.

---

## File map

- Create `apps/miniprogram/test/albumTagSheetLayout.test.mjs`: regression contract for the tag sheet scroll boundary and fixed action footer.
- Modify `apps/miniprogram/src/pages/session/album.vue`: split the tag sheet into fixed header, native scrolling body, and fixed footer; update scoped styles.
- Modify `apps/miniprogram/package.json`: include the regression test in `test:album-media`.

### Task 1: Add the failing tag-sheet layout regression test

**Files:**
- Create: `apps/miniprogram/test/albumTagSheetLayout.test.mjs`
- Modify: `apps/miniprogram/package.json`
- Test: `apps/miniprogram/test/albumTagSheetLayout.test.mjs`

- [ ] **Step 1: Write the source-structure regression test**

Create `apps/miniprogram/test/albumTagSheetLayout.test.mjs` with:

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const albumPath = fileURLToPath(new URL("../src/pages/session/album.vue", import.meta.url));
const albumSource = readFileSync(albumPath, "utf8");

function tagSheetMarkup() {
  const popupStart = albumSource.indexOf('<t-popup\n      :visible="tagSheetVisible"');
  const popupEnd = albumSource.indexOf("</t-popup>", popupStart);
  assert.notEqual(popupStart, -1, "album tag popup must exist");
  assert.notEqual(popupEnd, -1, "album tag popup must close");
  return albumSource.slice(popupStart, popupEnd);
}

function styleRule(className) {
  const styleStart = albumSource.lastIndexOf("<style scoped>");
  const styleSource = albumSource.slice(styleStart);
  const match = styleSource.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `.${className} style rule must exist`);
  return match[1];
}

test("album tag actions stay outside the native scrolling role content", () => {
  const markup = tagSheetMarkup();
  const scrollStart = markup.indexOf('<scroll-view scroll-y class="tag-sheet-scroll">');
  const scrollEnd = markup.indexOf("</scroll-view>", scrollStart);
  const actionsStart = markup.indexOf('<view class="sheet-actions">');

  assert.notEqual(scrollStart, -1, "tag sheet must use a native vertical scroll-view");
  assert.notEqual(scrollEnd, -1, "tag sheet native scroll-view must close");
  assert.notEqual(actionsStart, -1, "tag sheet actions must exist");
  assert.ok(
    scrollEnd < actionsStart,
    "cancel and save actions must be outside the scrolling role content",
  );
});

test("album tag sheet bounds scrolling and keeps the footer from shrinking", () => {
  const sheet = styleRule("tag-sheet");
  const scroll = styleRule("tag-sheet-scroll");
  const actions = styleRule("sheet-actions");

  assert.match(sheet, /display:\s*flex/);
  assert.match(sheet, /flex-direction:\s*column/);
  assert.match(sheet, /overflow:\s*hidden/);
  assert.doesNotMatch(sheet, /overflow-y:\s*auto/);
  assert.match(scroll, /flex:\s*1/);
  assert.match(scroll, /min-height:\s*0/);
  assert.match(actions, /flex:\s*0\s+0\s+auto/);
});
```

- [ ] **Step 2: Register the test in the album media suite**

Update `apps/miniprogram/package.json` so `test:album-media` includes the new file:

```json
"test:album-media": "npm run build:mp-weixin && node --test test/albumTagSheetLayout.test.mjs test/albumMediaSelection.test.mjs test/albumMediaOperation.test.mjs test/albumPhotoUpload.test.mjs test/cosSdkBundle.test.mjs"
```

- [ ] **Step 3: Run the targeted test and verify RED**

Run:

```bash
node --test apps/miniprogram/test/albumTagSheetLayout.test.mjs
```

Expected: FAIL because the current markup has no `tag-sheet-scroll` native `scroll-view`, and `.tag-sheet` still uses `overflow-y: auto`.

### Task 2: Split the tag sheet into fixed and scrolling regions

**Files:**
- Modify: `apps/miniprogram/src/pages/session/album.vue:591`
- Test: `apps/miniprogram/test/albumTagSheetLayout.test.mjs`

- [ ] **Step 1: Keep the title and note in a fixed header**

Replace the opening content inside `.tag-sheet` with this structure:

```vue
<view class="tag-sheet" @tap.stop>
  <view class="tag-sheet-head">
    <view class="sheet-bar"></view>
    <view class="sheet-title">
      <text v-if="bulkTagging">给 {{ selectedTagTargetCount }} 张照片标注</text>
      <text v-else>这张照片里有谁</text>
    </view>
    <view class="sheet-note">
      {{
        bulkTagging
          ? "保存后，这些照片会替换成同一组标签。"
          : "标注后只会展示给上传者和对应被标注成员。"
      }}
    </view>
  </view>
```

- [ ] **Step 2: Wrap only variable-length content in native scrolling**

Place the existing `.selected-row`, `RoleSeatBoard`, and `.privacy-impact` markup inside:

```vue
<scroll-view scroll-y class="tag-sheet-scroll">
  <view class="tag-sheet-scroll-content">
    <view class="selected-row">
      <t-tag
        v-for="person in selectedPeople"
        :key="person.key"
        class="selected-chip"
        theme="primary"
        variant="light"
        size="small"
        @tap="togglePerson(person.key)"
      >
        <text>{{ tagPersonTitle(person) }}</text>
        <text
          v-if="person.tag_type === 'session_npc_role'"
          class="npc-gender-mark"
          :class="npcRoleGenderClass(person.role_gender)"
        >
          {{ npcRoleGenderText(person.role_gender) }}
        </text>
        <text>×</text>
      </t-tag>
      <t-empty
        v-if="selectedPeople.length === 0"
        class="selected-empty"
        description="暂未标注，只有上传者可见"
      />
    </view>

    <RoleSeatBoard
      :surface="false"
      :sections="albumTagSections"
      empty-text="暂无可标注角色。"
      @itemtap="handleAlbumTagTap"
    />

    <view class="privacy-impact">
      未标注只有上传者可见；标注角色后只展示给上传者和对应被标注成员。
    </view>
  </view>
</scroll-view>
```

Close `</scroll-view>` before `.sheet-actions`. Keep the existing action markup unchanged so `closeTagSheet`, `saveTags`, disabled states, and saving copy retain their behavior.

- [ ] **Step 3: Make the sheet bounded and the footer non-scrolling**

Replace the existing `.tag-sheet` rule and add the new region rules:

```css
.tag-sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 78vh;
  max-height: 78vh;
  overflow: hidden;
  border-radius: 24rpx 24rpx 0 0;
  background: #fffefb;
  box-sizing: border-box;
}

.tag-sheet-head {
  flex: 0 0 auto;
  padding: 18rpx 30rpx 0;
}

.tag-sheet-scroll {
  flex: 1;
  min-height: 0;
}

.tag-sheet-scroll-content {
  padding: 0 30rpx 24rpx;
  box-sizing: border-box;
}
```

Replace `.sheet-actions` with:

```css
.sheet-actions {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: 1fr 1fr;
  gap: 14rpx;
  padding: 20rpx 30rpx 24rpx;
  border-top: 1rpx solid #ece5d7;
  background: #fffefb;
}
```

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run:

```bash
node --test apps/miniprogram/test/albumTagSheetLayout.test.mjs
```

Expected: 2 tests pass.

- [ ] **Step 5: Run nearby album tests**

Run:

```bash
node --test apps/miniprogram/test/albumTagSheetLayout.test.mjs apps/miniprogram/test/albumMediaSelection.test.mjs apps/miniprogram/test/albumMediaOperation.test.mjs
```

Expected: all tests pass with no warnings or errors.

- [ ] **Step 6: Commit the tested fix**

```bash
git add apps/miniprogram/test/albumTagSheetLayout.test.mjs apps/miniprogram/package.json apps/miniprogram/src/pages/session/album.vue
git commit -m "fix(album): keep tag sheet actions visible"
```

### Task 3: Verify build output and same-pattern audit

**Files:**
- Verify: `apps/miniprogram/src/pages/session/album.vue`
- Verify: `apps/miniprogram/src/pages/session/review.vue`
- Verify: `apps/miniprogram/src/extensions/session-pseudo-chat/ChatEntry.vue`

- [ ] **Step 1: Build the WeChat mini-program**

Run:

```bash
npm run build:mp-weixin
```

Expected: UniApp completes the `mp-weixin` production build successfully.

- [ ] **Step 2: Run the album static contract checks**

Run:

```bash
npm run d53:check
```

Expected: the D53 album selection check completes successfully.

- [ ] **Step 3: Confirm every source `t-popup` keeps critical actions outside variable content**

Run:

```bash
rg -n -C 6 '<t-popup|<scroll-view|sheet-actions|album-picker-done|message-compose' apps/miniprogram/src/pages/session/album.vue apps/miniprogram/src/pages/session/review.vue apps/miniprogram/src/extensions/session-pseudo-chat/ChatEntry.vue
```

Expected:

- album tag popup: native scroll body followed by `.sheet-actions`;
- review album picker: native scroll grid with `.album-picker-done` in the fixed header;
- chat popup: native scroll body followed by `.message-compose`.

- [ ] **Step 4: Check the final diff for accidental changes**

Run:

```bash
git diff --check HEAD^..HEAD
git show --stat --oneline HEAD
```

Expected: only the three implementation files are included, with no whitespace errors or unrelated changes.
