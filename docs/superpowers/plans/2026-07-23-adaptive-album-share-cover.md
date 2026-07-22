# 自适应相册分享封面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为相册分享自动精选 1–9 张安全图片，并分别生成好友/群聊 5:4 与朋友圈时间线 1:1 的电影叙事型封面；任意张数都使用明确布局、正确文字与可靠降级图。

**Architecture:** 保留 `session_album_public_shares.cover_media_ids` 作为最多 9 张候选快照，不做数据库迁移；新增独立的封面布局、精选、文案、渲染与内存缓存模块。服务端每次请求先完成 token、分享状态、过期时间、摘要和媒体隐私校验，再命中按分享摘要和版式版本区分的 LRU；小程序分别预加载好友与时间线封面，只开放已准备成功的分享菜单，并为两个渠道使用不同尺寸的本地降级图。

**Tech Stack:** Node.js ESM、Fastify、Sharp、64-bit dHash、Vue 2 / uni-app、`node:test`、微信小程序分享 API

**Design spec:** `docs/superpowers/specs/2026-07-22-adaptive-album-share-cover-design.md`

---

## File map

### New files

- `apps/api/src/modules/album-share-cover/layouts.js` — 1–9 张、双渠道的归一化槽位注册表和布局版本。
- `apps/api/src/modules/album-share-cover/selection.js` — 图片质量、dHash 去重、候选阈值与槽位分配。
- `apps/api/src/modules/album-share-cover/copy.js` — 固定中文文案、角色缺失回退与 XML 转义。
- `apps/api/src/modules/album-share-cover/renderer.js` — Sharp 合成、关注点裁切、文字渐变/字幕条。
- `apps/api/src/modules/album-share-cover/cache.js` — 有界 LRU，只有鉴权后才允许读取。
- `apps/api/test/album-share-cover-layouts.test.mjs` — 布局尺寸、槽位、重叠与覆盖率测试。
- `apps/api/test/album-share-cover-selection.test.mjs` — 质量、去重、阈值、精选数量和槽位匹配测试。
- `apps/api/test/album-share-cover-renderer.test.mjs` — 双输出尺寸、JPEG、文案与 1–9 张渲染测试。
- `apps/api/test/album-share-cover-route.test.mjs` — variant、DTO、鉴权顺序、缓存和撤销测试。
- `apps/miniprogram/src/utils/albumShareCover.js` — 双渠道 URL、降级图和菜单状态的纯函数。
- `apps/miniprogram/test/albumShareCover.test.mjs` — 小程序纯函数测试。
- `apps/miniprogram/src/static/art/album-share-friend.jpg` — 1000×800 无个人信息降级图。
- `apps/miniprogram/src/static/art/album-share-timeline.jpg` — 1000×1000 无个人信息降级图。
- `scripts/d52-adaptive-album-share-cover-check.js` — 跨 API、小程序、Docker 与素材尺寸的静态契约检查。

### Modified files

- `apps/api/src/modules/core/service.js` — 使用新的精选入口，向封面查询返回安全的剧本名/角色名/媒体元数据。
- `apps/api/src/server.js` — 双 variant URL、路由解析、鉴权后缓存、渲染器注入和 DTO 字段。
- `apps/api/Dockerfile` — 安装 `font-noto-cjk`，保证生产环境中文文字可渲染。
- `apps/miniprogram/src/pages/session/album.vue` — 好友/时间线独立预加载、菜单开放与分享图选择。
- `scripts/check-miniprogram.js` — 锁定两个分享生命周期使用不同封面。
- `scripts/d23-album-share-join-policy-smoke.js` — 覆盖两个封面 URL 和撤销行为。
- `scripts/d48-album-sharing-role-claim-separation-check.js` — 将旧相册降级图断言升级为双尺寸素材，同时保留 D48 权限断言。
- `scripts/d48-album-sharing-role-claim-separation-smoke.js` — 从旧动态方格断言切换到新版布局注册表断言。
- `package.json` — 增加 `d52:unit`、`d52:check`。

### Explicit non-changes

- 不修改数据库 schema、迁移或 `cover_media_ids` 的最大 9 张语义。
- 不修改单张媒体预览的分享状态机和现有单媒体降级行为。
- 不把设计探索图或用户照片打包进静态降级素材。

---

### Task 1: 用测试锁定双渠道 1–9 张布局注册表

**Files:**
- Create: `apps/api/test/album-share-cover-layouts.test.mjs`
- Create: `apps/api/src/modules/album-share-cover/layouts.js`
- Modify: `scripts/d48-album-sharing-role-claim-separation-smoke.js`

- [ ] **Step 1: 写失败的布局测试**

测试公开契约：

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  ALBUM_SHARE_COVER_LAYOUT_VERSION,
  albumShareCoverLayout
} from "../src/modules/album-share-cover/layouts.js";

const EXPECTED_SIZE = {
  friend: { width: 1000, height: 800 },
  timeline: { width: 1000, height: 1000 }
};

function overlap(a, b) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

for (const variant of ["friend", "timeline"]) {
  for (let count = 1; count <= 9; count += 1) {
    test(`${variant} ${count} 张布局完整且不重叠`, () => {
      const layout = albumShareCoverLayout(variant, count);
      assert.deepEqual(layout.output, EXPECTED_SIZE[variant]);
      assert.equal(layout.slots.length, count);
      assert.equal(layout.slots[0].role, "hero");
      for (const slot of layout.slots) {
        assert.ok(slot.x >= 0 && slot.y >= 0);
        assert.ok(slot.width > 0 && slot.height > 0);
        assert.ok(slot.x + slot.width <= 1);
        assert.ok(slot.y + slot.height <= 1);
      }
      for (let left = 0; left < count; left += 1) {
        for (let right = left + 1; right < count; right += 1) {
          assert.equal(overlap(layout.slots[left], layout.slots[right]), 0);
        }
      }
    });
  }
}

test("布局版本是显式缓存键", () => {
  assert.match(ALBUM_SHARE_COVER_LAYOUT_VERSION, /^album-share-cover-v\d+$/);
});

test("非法 variant 和张数直接拒绝", () => {
  assert.throws(() => albumShareCoverLayout("poster", 3), /variant/);
  assert.throws(() => albumShareCoverLayout("friend", 0), /count/);
  assert.throws(() => albumShareCoverLayout("timeline", 10), /count/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test apps/api/test/album-share-cover-layouts.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `album-share-cover/layouts.js`.

- [ ] **Step 3: 实现显式布局注册表**

导出：

```js
export const ALBUM_SHARE_COVER_LAYOUT_VERSION = "album-share-cover-v1";
export const ALBUM_SHARE_COVER_VARIANTS = Object.freeze({
  friend: Object.freeze({ width: 1000, height: 800 }),
  timeline: Object.freeze({ width: 1000, height: 1000 })
});

const slot = (x, y, width, height) => Object.freeze({ x, y, width, height });
const row3 = (y, height) => [
  slot(0, y, 1 / 3, height),
  slot(1 / 3, y, 1 / 3, height),
  slot(2 / 3, y, 1 / 3, height)
];

const LAYOUTS = Object.freeze({
  friend: Object.freeze({
    1: [slot(0, 0, 1, 1)],
    2: [slot(0, 0, 0.62, 1), slot(0.62, 0, 0.38, 1)],
    3: [slot(0, 0, 0.62, 1), slot(0.62, 0, 0.38, 0.5), slot(0.62, 0.5, 0.38, 0.5)],
    4: [slot(0, 0, 1, 0.58), ...row3(0.58, 0.42)],
    5: [
      slot(0, 0, 0.54, 1),
      slot(0.54, 0, 0.23, 0.5), slot(0.77, 0, 0.23, 0.5),
      slot(0.54, 0.5, 0.23, 0.5), slot(0.77, 0.5, 0.23, 0.5)
    ],
    6: [
      slot(0, 0, 0.54, 1), slot(0.54, 0, 0.46, 0.34),
      slot(0.54, 0.34, 0.23, 0.33), slot(0.77, 0.34, 0.23, 0.33),
      slot(0.54, 0.67, 0.23, 0.33), slot(0.77, 0.67, 0.23, 0.33)
    ],
    7: [slot(0, 0, 1, 0.46), ...row3(0.46, 0.27), ...row3(0.73, 0.27)],
    8: [
      slot(0, 0, 2 / 3, 1 / 3), slot(2 / 3, 0, 1 / 3, 1 / 3),
      ...row3(1 / 3, 1 / 3), ...row3(2 / 3, 1 / 3)
    ],
    9: [...row3(0, 1 / 3), ...row3(1 / 3, 1 / 3), ...row3(2 / 3, 1 / 3)]
  }),
  timeline: Object.freeze({
    1: [slot(0, 0, 1, 1)],
    2: [slot(0, 0, 0.58, 1), slot(0.58, 0, 0.42, 1)],
    3: [slot(0, 0, 1, 0.58), slot(0, 0.58, 0.5, 0.42), slot(0.5, 0.58, 0.5, 0.42)],
    4: [slot(0, 0, 0.5, 0.5), slot(0.5, 0, 0.5, 0.5), slot(0, 0.5, 0.5, 0.5), slot(0.5, 0.5, 0.5, 0.5)],
    5: [
      slot(0, 0, 1, 0.48),
      slot(0, 0.48, 0.5, 0.26), slot(0.5, 0.48, 0.5, 0.26),
      slot(0, 0.74, 0.5, 0.26), slot(0.5, 0.74, 0.5, 0.26)
    ],
    6: [...row3(0, 0.5), ...row3(0.5, 0.5)],
    7: [slot(0, 0, 1, 0.46), ...row3(0.46, 0.27), ...row3(0.73, 0.27)],
    8: [
      slot(0, 0, 2 / 3, 1 / 3), slot(2 / 3, 0, 1 / 3, 1 / 3),
      ...row3(1 / 3, 1 / 3), ...row3(2 / 3, 1 / 3)
    ],
    9: [...row3(0, 1 / 3), ...row3(1 / 3, 1 / 3), ...row3(2 / 3, 1 / 3)]
  })
});

export function albumShareCoverLayout(variant, count) {
  if (!Object.hasOwn(ALBUM_SHARE_COVER_VARIANTS, variant)) {
    throw new TypeError("album share cover variant must be friend or timeline");
  }
  if (!Number.isInteger(count) || count < 1 || count > 9) {
    throw new RangeError("album share cover count must be between 1 and 9");
  }
  return {
    variant,
    output: ALBUM_SHARE_COVER_VARIANTS[variant],
    gutter: variant === "friend" ? 0.008 : 0.01,
    slots: LAYOUTS[variant][count].map((slot, index) => ({
      ...slot,
      role: index === 0 ? "hero" : "detail"
    })),
    textMode: count <= 6 ? "gradient" : "caption-band"
  };
}
```

`LAYOUTS.friend[1..9]` 和 `LAYOUTS.timeline[1..9]` 必须逐项写成归一化矩形，严格实现设计规格中的映射：1 张全幅；2 张主次分栏；3 张主图加两张细节；4 张重点式/2×2；5 张主图加 2×2；6 张主图加五张细节/3×2；7–9 张进入电影字幕条构图。8 张使用 3×3 基础网格并让 hero 横跨顶部两格；9 张使用 3×3。不要通过 `Math.ceil(Math.sqrt(count))` 自动推断布局。

`ALBUM_SHARE_COVER_LAYOUT_VERSION` 实际代表完整渲染契约版本；布局、选图阈值、字体或文案结构任一改变都必须递增它，使旧缓存自动失效。

- [ ] **Step 4: 将 D48 旧布局 smoke 改为导入新注册表**

保留 D48 的分享权限断言，仅将 `publicShareCoverGridLayout` 的行数断言替换为：双 variant、1–9 张槽位数量、输出尺寸和 hero 断言。删除旧函数在测试中的引用，为后续删除旧函数铺路。

- [ ] **Step 5: 运行布局测试**

Run: `node --test apps/api/test/album-share-cover-layouts.test.mjs && node scripts/d48-album-sharing-role-claim-separation-smoke.js`

Expected: all tests pass and the D48 smoke prints its existing success line.

- [ ] **Step 6: 提交布局注册表**

```bash
git add apps/api/src/modules/album-share-cover/layouts.js apps/api/test/album-share-cover-layouts.test.mjs scripts/d48-album-sharing-role-claim-separation-smoke.js
git commit -m "feat: define adaptive album cover layouts"
```

---

### Task 2: 精选安全图片、近重复去重并匹配槽位

**Files:**
- Create: `apps/api/test/album-share-cover-selection.test.mjs`
- Create: `apps/api/src/modules/album-share-cover/selection.js`

- [ ] **Step 1: 写失败的纯函数测试**

覆盖以下固定样例：

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  albumShareImageQuality,
  hammingDistance64,
  selectAlbumShareImages,
  assignAlbumShareImagesToSlots
} from "../src/modules/album-share-cover/selection.js";

const candidate = (id, overrides = {}) => ({
  id,
  width: 1600,
  height: 1200,
  sharpness: 0.9,
  exposure: 0.9,
  relevance: 0.9,
  dHash: 0x1111111111111111n,
  focusX: 0.5,
  focusY: 0.5,
  eligible: true,
  ...overrides
});

test("质量分使用 40/20/20/20 权重", () => {
  const quality = albumShareImageQuality(candidate("a", {
    sharpness: 1, exposure: 0.5, width: 1000, height: 800, relevance: 0.25
  }));
  assert.ok(Math.abs(quality - 0.63) < 1e-9);
});

test("dHash 汉明距离按 64 位计算", () => {
  assert.equal(hammingDistance64(0n, 0b111111n), 6);
  assert.equal(hammingDistance64(0n, 0b1111111n), 7);
});

test("先过滤不安全项，再去掉距离不超过 6 的近重复", () => {
  const selected = selectAlbumShareImages([
    candidate("best", { dHash: 0n }),
    candidate("duplicate", { dHash: 0b111111n, sharpness: 0.8 }),
    candidate("different", { dHash: 0xffffffffffffffffn, sharpness: 0.75 }),
    candidate("private", { eligible: false, dHash: 0xaaaaaaaaaaaaaaaan })
  ]);
  assert.deepEqual(selected.map((item) => item.id), ["best", "different"]);
});

test("仅保留最佳分 65% 以上但至少保留一张、最多九张", () => {
  const selected = selectAlbumShareImages([
    candidate("best", { dHash: 0n, sharpness: 1 }),
    candidate("weak", { dHash: 0xffffffffffffffffn, sharpness: 0.05, exposure: 0.05, relevance: 0.05 })
  ]);
  assert.deepEqual(selected.map((item) => item.id), ["best"]);
});

test("最强图片占 hero，剩余图片按裁切损失匹配槽位", () => {
  const slots = [
    { role: "hero", width: 0.62, height: 1 },
    { role: "detail", width: 0.38, height: 0.5 },
    { role: "detail", width: 0.38, height: 0.5 }
  ];
  const assigned = assignAlbumShareImagesToSlots([
    candidate("hero", { quality: 1, width: 1800, height: 1200 }),
    candidate("portrait", { quality: 0.8, width: 800, height: 1400 }),
    candidate("landscape", { quality: 0.75, width: 1600, height: 900 })
  ], slots);
  assert.equal(assigned[0].image.id, "hero");
  assert.equal(assigned.length, 3);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test apps/api/test/album-share-cover-selection.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `selection.js`.

- [ ] **Step 3: 实现确定性的评分、去重、阈值与分配**

公开函数及常量：

```js
export const ALBUM_SHARE_DUPLICATE_DISTANCE = 6;
export const ALBUM_SHARE_QUALITY_FLOOR_RATIO = 0.65;
export const ALBUM_SHARE_MAX_IMAGES = 9;

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export function albumShareImageQuality(image) {
  const sharpness = clamp01(image.sharpness);
  const exposure = clamp01(image.exposure);
  const resolution = clamp01((Number(image.width) * Number(image.height)) / 2_000_000);
  const relevance = clamp01(image.relevance);
  return sharpness * 0.4 + exposure * 0.2 + resolution * 0.2 + relevance * 0.2;
}

export function exposureScore(meanLuminance) {
  const normalized = clamp01(Number(meanLuminance) / 255);
  return clamp01(1 - Math.abs(normalized - 0.5) * 2);
}

export function cropLoss(image, slot) {
  const imageAspectRatio = image.width / image.height;
  const slotAspectRatio = slot.width / slot.height;
  const weight = slot.role === "hero" ? 2 : 1;
  return Math.abs(Math.log(imageAspectRatio / slotAspectRatio)) * weight;
}
```

实现要求：

1. `albumShareImageQuality` 将 sharpness、exposure、resolution、relevance 归一到 0–1，并按 `0.40/0.20/0.20/0.20` 计算；分辨率以 2,000,000 像素封顶。
2. `selectAlbumShareImages` 先过滤 `eligible !== true`，再按 `quality desc, createdAt asc, id asc` 稳定排序。
3. 逐项保留与已选项 dHash 汉明距离全部大于 6 的图片；若 dHash 缺失，不将其当作重复。
4. 保留分数不低于最佳项 65% 的项目，最多 9 张；若存在安全候选，结果至少一张。
5. `assignAlbumShareImagesToSlots` 固定最强项进 hero，剩余图片用确定性最小总裁切损失匹配剩余槽位；最多 8! 种排列，可枚举并用媒体 ID 字典序解平局。
6. 不把不安全候选重新补回结果以凑满布局。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test apps/api/test/album-share-cover-selection.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: 提交精选模块**

```bash
git add apps/api/src/modules/album-share-cover/selection.js apps/api/test/album-share-cover-selection.test.mjs
git commit -m "feat: select album share cover images"
```

---

### Task 3: 实现电影叙事文案与 Sharp 渲染器

**Files:**
- Create: `apps/api/src/modules/album-share-cover/copy.js`
- Create: `apps/api/src/modules/album-share-cover/renderer.js`
- Create: `apps/api/test/album-share-cover-renderer.test.mjs`
- Modify: `apps/api/Dockerfile`

- [ ] **Step 1: 写失败的文案与渲染测试**

测试必须覆盖：

```js
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { albumShareCoverCopy } from "../src/modules/album-share-cover/copy.js";
import { renderAlbumShareCover } from "../src/modules/album-share-cover/renderer.js";

async function source(width, height, color) {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

test("角色文案与无角色回退完全一致", () => {
  assert.deepEqual(albumShareCoverCopy({ scriptName: "琼崖Ⅱ海角", roleName: "叶辰" }), {
    label: "本场掉落",
    main: "这一晚，我是「叶辰」",
    subtitle: "《琼崖Ⅱ海角》 · 游玩相册"
  });
  assert.equal(albumShareCoverCopy({ scriptName: "琼崖Ⅱ海角", roleName: "" }).main,
    "这一晚，故事没有散场");
});

for (const variant of ["friend", "timeline"]) {
  for (let count = 1; count <= 9; count += 1) {
    test(`${variant} ${count} 张输出固定 JPEG 尺寸`, async () => {
      const inputs = await Promise.all(Array.from({ length: count }, (_, index) => source(
        index % 2 ? 900 : 1600,
        index % 2 ? 1600 : 900,
        { r: 80 + index * 10, g: 60, b: 45 }
      )));
      const result = await renderAlbumShareCover({
        variant,
        images: inputs.map((buffer, index) => ({
          id: String(index + 1), buffer, width: index % 2 ? 900 : 1600,
          height: index % 2 ? 1600 : 900, quality: 1 - index / 20,
          focusX: 0.5, focusY: 0.5
        })),
        scriptName: "琼崖Ⅱ海角",
        roleName: "叶辰"
      });
      const metadata = await sharp(result).metadata();
      assert.equal(metadata.format, "jpeg");
      assert.equal(metadata.width, 1000);
      assert.equal(metadata.height, variant === "friend" ? 800 : 1000);
    });
  }
}
```

另加一个测试：角色名含 `&<>\"'` 时，生成的 SVG 不报错；一个测试：传入空图片数组时抛出明确错误。

再增加以下视觉边界断言：输出 metadata 不含 EXIF/ICC；带 EXIF orientation 的输入经过 `autoOrient()` 后方向正确；允许的最长角色名和剧本名会被确定性截断且 SVG 尺寸不溢出画布安全区。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test apps/api/test/album-share-cover-renderer.test.mjs`

Expected: FAIL because `copy.js` and `renderer.js` do not exist.

- [ ] **Step 3: 实现文案模块**

`albumShareCoverCopy` 必须 trim 输入并返回未编码的显示文案；剧本名缺失时 subtitle 使用 `游玩相册`，不得显示 `《》` 空书名号。公开 `escapeAlbumShareCoverXml`，只在文案插入 SVG 时调用一次，避免双重转义。

- [ ] **Step 4: 实现渲染器**

入口保持单一：

```js
export async function renderAlbumShareCover({
  variant,
  images,
  scriptName = "",
  roleName = ""
})
```

实现顺序：

1. 调用 `albumShareCoverLayout(variant, images.length)`；调用 `assignAlbumShareImagesToSlots`。
2. 将归一化槽位换算为整数像素，所有内部间距填充暖象牙色 `#F4EBDD`；最右/最下边缘使用输出尺寸减去累积坐标，避免 1px 裂缝。
3. 每个源 buffer 先调用 `autoOrient()`。若存在 focusX/focusY，按目标宽高比在已校正源图坐标中计算围绕关注点、且不越界的最大裁切矩形，先 `extract` 再 `resize`；缺失时用 `resize({ fit: "cover", position: "attention" })`，再次失败才用 `centre`。
4. 1–6 张在画面底部叠加透明黑渐变；7–9 张使用高度约输出 19% 的暖黑字幕条。文字顺序固定为 label、main、subtitle。
5. SVG 字体族固定为 `"Noto Sans CJK SC", "PingFang SC", sans-serif`；主文案不超过两行，角色/剧本名过长时按 Unicode code point 截断并加省略号。
6. 统一输出 `jpeg({ quality: 88, chromaSubsampling: "4:4:4" })`，不得调用 `withMetadata()`，确保用户源图的 EXIF、GPS 和 ICC 不进入封面。

- [ ] **Step 5: 保证生产镜像有中文字体**

在 `apps/api/Dockerfile` 的依赖层加入：

```dockerfile
RUN apk add --no-cache font-noto-cjk
```

不要依赖小程序现有的 `pinche-brand.ttf`；它只覆盖 ASCII。

- [ ] **Step 6: 运行渲染测试与 Docker 静态确认**

Run: `node --test apps/api/test/album-share-cover-renderer.test.mjs && rg -n "font-noto-cjk" apps/api/Dockerfile`

Expected: 20 个以上子测试通过；`rg` 命中唯一的字体安装行。

- [ ] **Step 7: 提交渲染器**

```bash
git add apps/api/src/modules/album-share-cover/copy.js apps/api/src/modules/album-share-cover/renderer.js apps/api/test/album-share-cover-renderer.test.mjs apps/api/Dockerfile
git commit -m "feat: render cinematic album share covers"
```

---

### Task 4: 在 core service 中保留安全边界并提供渲染元数据

**Files:**
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/test/album-share-cover-selection.test.mjs`
- Modify: `apps/api/test/album-single-media-share.test.mjs`

- [ ] **Step 1: 写失败的 service 测试**

增加测试，证明：

1. `selectPublicShareCoverMedia` 仍最多返回 9 张，并继续先调用现有 `publicShareCoverPriority` 隐私/审核判定。
2. 创建分享时 `cover_media_ids` 仍然写入选中 ID 的 JSON 快照，不新增表字段。
3. `getPublicSessionAlbumShareCoverMedia` 返回 `{ share, media, scriptName, roleName }`；`roleName` 只能来自当前公开分享 seat，`scriptName` 来自当前 session 的公开剧本名。
4. 被撤销、过期、摘要不匹配或当前已不安全的媒体仍在读取图片对象之前失败。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test apps/api/test/album-share-cover-selection.test.mjs apps/api/test/album-single-media-share.test.mjs`

Expected: FAIL on the new metadata assertions.

- [ ] **Step 3: 接入精选模块但不扩大权限**

在 `selectPublicShareCoverMedia` 中把现有 `publicShareCoverPriority` 的结果映射为 `eligible/relevance`，把已知宽高映射为 selection 候选。创建分享时没有解码像素 buffer，因此只做第一阶段的安全过滤、已知尺寸/相关性排序和最多 9 张快照；完整 sharpness/exposure/dHash 在渲染请求读取图片后执行。

这条两阶段边界必须写进函数注释：数据库快照决定“允许考虑哪些媒体”，渲染阶段只能删减，绝不能从相册补入未写进快照的图片。

- [ ] **Step 4: 扩展封面查询的安全 DTO**

`getPublicSessionAlbumShareCoverMedia` 在所有现有校验成功后返回：

```js
return {
  share,
  media,
  scriptName: String(session.script_name || "").trim(),
  roleName: String(publicSeat.seat?.role_name || "").trim()
};
```

若真实查询字段名称不同，在 SQL 投影中显式别名为 `script_name` / `role_name`，不要把 session、seat、用户或内部审核对象整体传到渲染层。

- [ ] **Step 5: 删除 core 中不再使用的 `publicShareCoverGridLayout`**

确认 D48 smoke 和 server 都已不依赖它后删除该导出，避免存在两套布局真相源。

- [ ] **Step 6: 运行 service 回归测试**

Run: `node --test apps/api/test/album-share-cover-selection.test.mjs apps/api/test/album-single-media-share.test.mjs`

Expected: all tests pass.

- [ ] **Step 7: 提交 service 接线**

```bash
git add apps/api/src/modules/core/service.js apps/api/test/album-share-cover-selection.test.mjs apps/api/test/album-single-media-share.test.mjs
git commit -m "feat: expose safe album cover metadata"
```

---

### Task 5: 增加双 variant API、鉴权后 LRU 与 DTO 字段

**Files:**
- Create: `apps/api/src/modules/album-share-cover/cache.js`
- Create: `apps/api/test/album-share-cover-route.test.mjs`
- Modify: `apps/api/src/server.js`
- Modify: `scripts/d23-album-share-join-policy-smoke.js`

- [ ] **Step 1: 写失败的路由和缓存测试**

通过 `createApp({ publicShareCover: ... })` 注入 verify、load、readObject、render 计数器，覆盖：

```js
test("缺省 variant 是 friend，timeline 被单独传给渲染器", async () => { /* 两次 inject */ });
test("非法 variant 返回 400 且不读取媒体", async () => { /* variant=poster */ });
test("同一缓存键仍每次重新鉴权，只渲染一次", async () => {
  // 第一次：verify=1, load=1, render=1
  // 第二次：verify=2, load=2, render=1
});
test("第二次请求被撤销时返回 403，不能从缓存泄漏 JPEG", async () => { /* load 第二次抛 forbidden */ });
test("friend 与 timeline 不共用缓存项", async () => { /* render=2 */ });
test("摘要或布局版本变化会产生新缓存项", async () => { /* render increments */ });
```

DTO 断言固定为：

```js
assert.match(body.cover_url, /variant=friend/);
assert.match(body.timeline_cover_url, /variant=timeline/);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test apps/api/test/album-share-cover-route.test.mjs`

Expected: FAIL because the route lacks the seam, variant and `timeline_cover_url`.

- [ ] **Step 3: 实现有界 LRU**

`AlbumShareCoverCache` 的公开接口仅为 `get(key)`, `set(key, value)`, `clear()`；默认最多 32 项、单项最多 8 MiB。`set` 复制 Buffer，更新同一 key 时移动到最近使用端，超限时逐个淘汰最旧项。缓存键构造函数固定包含：

```js
export function albumShareCoverCacheKey({ shareId, coverDigest, variant, layoutVersion }) {
  return [shareId, coverDigest, variant, layoutVersion].map(encodeURIComponent).join(":");
}
```

- [ ] **Step 4: 扩展 URL helper 与公开 DTO**

将 helper 改成：

```js
function sessionAlbumPublicShareCoverPath(share, variant = "friend") {
  if (!Array.isArray(share.cover_media_ids) || share.cover_media_ids.length === 0) {
    return "";
  }
  const token = signSessionAlbumPublicCoverToken(share);
  const query = new URLSearchParams({ token, variant });
  return `/api/session-album/public-shares/${share.share_id}/cover?${query.toString()}`;
}
```

以下两个返回路径都增加字段：

```js
cover_url: sessionAlbumPublicShareCoverPath(share, "friend"),
timeline_cover_url: sessionAlbumPublicShareCoverPath(share, "timeline")
```

包括创建/复用分享 token 的响应，以及 `attachPublicSessionAlbumMediaUrls` 生成的公开相册 DTO。

- [ ] **Step 5: 重写 cover 路由的执行顺序**

严格按以下顺序：

1. 解析 variant；缺失为 `friend`，非 `friend|timeline` 用 `badRequest` 返回 400。
2. 验证签名 token 与 shareId/digest。
3. 调用 `getPublicSessionAlbumShareCoverMedia`，完成撤销、过期、摘要、seat 和媒体安全复核。
4. 由安全结果构造缓存键并读取 LRU。
5. 未命中时逐张读取快照内图片对象、用 Sharp metadata/stats/dHash 形成候选、调用 `selectAlbumShareImages`；单张下载或解码失败时只跳过该候选，不能让整张封面失败；只允许删减，至少一张，否则返回明确的不可生成错误。sharpness 使用 `clamp01(stats().sharpness / 12)` 归一化，exposure 使用 `exposureScore` 把亮度均值映射为距离中灰的对称分数，dHash 将图片灰度缩为 9×8 后逐行比较相邻像素得到 64 位 BigInt，relevance 复用 service 的公开相关性分数。
6. 调用 `renderAlbumShareCover`，写入 LRU，返回 `image/jpeg`。

响应继续使用 `Cache-Control: private, no-store`；LRU 是进程内计算缓存，不改变客户端缓存策略。

- [ ] **Step 6: 增加测试 seam**

在 `createApp(options = {})` 中只为测试注入：

```js
const publicShareCover = {
  verifyQuery: options.publicShareCover?.verifyQuery || verifySessionAlbumPublicCoverQuery,
  load: options.publicShareCover?.load || getPublicSessionAlbumShareCoverMedia,
  readObject: options.publicShareCover?.readObject || readUploadedSessionAlbumPhotoObject,
  render: options.publicShareCover?.render || renderAlbumShareCover,
  cache: options.publicShareCover?.cache || defaultAlbumShareCoverCache
};
```

生产默认路径不绕过任何校验；测试替身只在 `createApp` 显式传入时生效。

- [ ] **Step 7: 扩展 D23 smoke**

创建分享后分别请求 `cover_url` 和 `timeline_cover_url`，使用 Sharp/响应 metadata 确认 1000×800 与 1000×1000；撤销分享后两个 URL 都必须返回现有的禁止状态码。

- [ ] **Step 8: 运行 API 路由测试与 smoke**

Run: `node --test apps/api/test/album-share-cover-route.test.mjs && node scripts/d23-album-share-join-policy-smoke.js`

Expected: all route tests pass; D23 smoke prints its success line.

- [ ] **Step 9: 提交 API 路由与缓存**

```bash
git add apps/api/src/modules/album-share-cover/cache.js apps/api/test/album-share-cover-route.test.mjs apps/api/src/server.js scripts/d23-album-share-join-policy-smoke.js
git commit -m "feat: serve channel-specific album covers"
```

---

### Task 6: 制作双尺寸、无个人信息的本地降级图

**Files:**
- Create: `apps/miniprogram/src/static/art/album-share-friend.jpg`
- Create: `apps/miniprogram/src/static/art/album-share-timeline.jpg`
- Create: `scripts/d52-adaptive-album-share-cover-check.js`
- Modify: `scripts/d48-album-sharing-role-claim-separation-check.js`

- [ ] **Step 1: 写失败的素材尺寸检查**

`d52` 使用 Sharp metadata 检查：

```js
const EXPECTED = new Map([
  ["apps/miniprogram/src/static/art/album-share-friend.jpg", [1000, 800]],
  ["apps/miniprogram/src/static/art/album-share-timeline.jpg", [1000, 1000]]
]);
```

同时静态检查两个文件名出现在 `albumShareCover.js`，旧的 278×78 `ticket-landscape.jpg` 不再作为“整本相册”分享降级图；不要禁止其继续用于单媒体分享。

- [ ] **Step 2: 运行检查并确认失败**

Run: `node scripts/d52-adaptive-album-share-cover-check.js`

Expected: FAIL because both fallback files are absent.

- [ ] **Step 3: 用 Image Generation 生成同一艺术方向的两张底图**

实现者必须按 `imagegen` skill 执行生成，提示词固定包含：

```text
中国沉浸式剧本娱乐相册分享封面，电影片尾字幕气质，暖象牙纸张、墨绿与深棕黑渐变，细微胶片颗粒，抽象舞台光束、票根和幕布几何元素，不出现人物、人脸、二维码、品牌标识、真实照片或可识别文字，画面下方保留清晰文字安全区，高级、克制、编辑设计。
```

分别生成 5:4 与 1:1 构图。若模型产生乱码文字，重新生成而不是把乱码打包进项目。最终 JPEG 不含个人照片和用户数据。

- [ ] **Step 4: 规范化为精确像素和 JPEG**

使用 Sharp CLI/已有 Node 依赖做 `cover` 裁切到 1000×800 与 1000×1000，质量 88；不得拉伸。运行 metadata 检查确认尺寸。

- [ ] **Step 5: 更新 D48 旧降级断言**

只替换“整本相册分享图”的旧 `ticket-landscape.jpg` 断言，保留角色归属、隐私和 token 的所有 D48 检查。

- [ ] **Step 6: 运行素材检查**

Run: `node scripts/d52-adaptive-album-share-cover-check.js && node scripts/d48-album-sharing-role-claim-separation-check.js`

Expected: both scripts pass.

- [ ] **Step 7: 提交静态素材**

```bash
git add apps/miniprogram/src/static/art/album-share-friend.jpg apps/miniprogram/src/static/art/album-share-timeline.jpg scripts/d52-adaptive-album-share-cover-check.js scripts/d48-album-sharing-role-claim-separation-check.js
git commit -m "feat: add album share fallback artwork"
```

---

### Task 7: 小程序分别准备好友与时间线封面

**Files:**
- Create: `apps/miniprogram/src/utils/albumShareCover.js`
- Create: `apps/miniprogram/test/albumShareCover.test.mjs`
- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Modify: `scripts/check-miniprogram.js`

- [ ] **Step 1: 写失败的纯函数测试**

公开并测试：

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  ALBUM_SHARE_FRIEND_FALLBACK,
  ALBUM_SHARE_TIMELINE_FALLBACK,
  albumShareCoverResponse,
  albumShareMenus,
  albumShareImage
} from "../src/utils/albumShareCover.js";

test("两个渠道使用不同本地降级图", () => {
  assert.equal(ALBUM_SHARE_FRIEND_FALLBACK, "/static/art/album-share-friend.jpg");
  assert.equal(ALBUM_SHARE_TIMELINE_FALLBACK, "/static/art/album-share-timeline.jpg");
});

test("响应分别归一化 friend 与 timeline URL", () => {
  assert.deepEqual(albumShareCoverResponse({ cover_url: "friend", timeline_cover_url: "timeline" }), {
    friend: "friend", timeline: "timeline"
  });
});

test("只开放已准备成功且有 token 的菜单", () => {
  assert.deepEqual(albumShareMenus({ token: "t", friendReady: true, timelineReady: false }),
    ["shareAppMessage"]);
  assert.deepEqual(albumShareMenus({ token: "t", friendReady: true, timelineReady: true }),
    ["shareAppMessage", "shareTimeline"]);
  assert.deepEqual(albumShareMenus({ token: "", friendReady: true, timelineReady: true }), []);
});

test("远程图缺失时按渠道返回正确降级图", () => {
  assert.equal(albumShareImage("friend", ""), ALBUM_SHARE_FRIEND_FALLBACK);
  assert.equal(albumShareImage("timeline", ""), ALBUM_SHARE_TIMELINE_FALLBACK);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test apps/miniprogram/test/albumShareCover.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the new utility.

- [ ] **Step 3: 实现纯函数 utility**

所有输入均 trim 为字符串，函数不访问 `uni`、页面实例或全局状态。非法 kind 抛 `TypeError`，防止静默选错渠道图。

- [ ] **Step 4: 将页面状态拆成双渠道**

把单一状态替换为：

```js
shareFriendCoverUrl: "",
shareTimelineCoverUrl: "",
shareFriendCoverPrepared: false,
shareTimelineCoverPrepared: false
```

重命名/拆分 getter：

```js
albumFriendShareImage() {
  return albumShareImage("friend", this.shareFriendCoverUrl);
},
albumTimelineShareImage() {
  return albumShareImage("timeline", this.shareTimelineCoverUrl);
}
```

`onShareAppMessage` 只调用 friend getter；`onShareTimeline` 只调用 timeline getter。

- [ ] **Step 5: 独立预加载并精确开放菜单**

token 成功后并行调用 `prepareShareCoverUrl`：friend 使用 `data.cover_url`，timeline 使用 `data.timeline_cover_url`。远程预检失败时再预检对应本地降级图；每个渠道的 prepared 只由自己的最终 URL 决定。

`showShareMenus` 先隐藏两个菜单，再用 `albumShareMenus` 的结果调用 `showWechatShareMenus`。一个渠道失败不能阻断另一个渠道。

页面的三条现有数据路径都必须接入同一 helper：

1. 成员创建/复用分享 token；
2. 公开相册初次加载；
3. 公开相册刷新。

- [ ] **Step 6: 保持单媒体分享状态机不变**

确认 `prepareSingleMediaShare`、viewer 的原生 `open-type="share"` 和单媒体分享降级逻辑无差异。D50 单媒体测试必须保持通过。

- [ ] **Step 7: 扩展小程序静态契约**

`scripts/check-miniprogram.js` 增加断言：`onShareAppMessage` 引用 friend getter，`onShareTimeline` 引用 timeline getter；响应消费同时包含 `cover_url` 和 `timeline_cover_url`；两个 fallback 常量都存在。

- [ ] **Step 8: 运行小程序测试**

Run: `node --test apps/miniprogram/test/albumShareCover.test.mjs apps/miniprogram/test/albumSingleMediaShare.test.mjs && node scripts/check-miniprogram.js`

Expected: all tests pass and static check exits 0.

- [ ] **Step 9: 提交小程序接线**

```bash
git add apps/miniprogram/src/utils/albumShareCover.js apps/miniprogram/test/albumShareCover.test.mjs apps/miniprogram/src/pages/session/album.vue scripts/check-miniprogram.js
git commit -m "feat: prepare album covers per share channel"
```

---

### Task 8: 建立 D52 聚合门禁并完成自动回归

**Files:**
- Modify: `scripts/d52-adaptive-album-share-cover-check.js`
- Modify: `package.json`

- [ ] **Step 1: 扩展 D52 静态检查到完整契约**

检查项必须包括：

- 旧 `publicShareCoverGridLayout` 已从 production code 删除。
- API 暴露 `variant=friend` 与 `variant=timeline`，DTO 有 `timeline_cover_url`。
- 缓存键含 shareId、digest、variant、layoutVersion。
- 路由源码顺序上 load/authorization 在 cache get 前；路由测试提供动态保证。
- renderer 引用 Noto CJK，Docker 安装 `font-noto-cjk`。
- 小程序两个生命周期引用不同 getter，两个 fallback 文件尺寸正确。
- `cover_media_ids` 仍限制最多 9 张，没有新增 migration。

- [ ] **Step 2: 增加 package scripts**

```json
"d52:unit": "node --test apps/api/test/album-share-cover-layouts.test.mjs apps/api/test/album-share-cover-selection.test.mjs apps/api/test/album-share-cover-renderer.test.mjs apps/api/test/album-share-cover-route.test.mjs apps/miniprogram/test/albumShareCover.test.mjs",
"d52:check": "node scripts/d52-adaptive-album-share-cover-check.js"
```

- [ ] **Step 3: 运行 D52 focused gate**

Run: `npm run d52:unit && npm run d52:check`

Expected: all unit tests pass and D52 check prints `D52 adaptive album share cover checks passed`.

- [ ] **Step 4: 运行相邻分享回归**

Run: `npm run d50:unit && npm run d50:check && node scripts/d48-album-sharing-role-claim-separation-smoke.js && node scripts/d48-album-sharing-role-claim-separation-check.js && node scripts/d23-album-share-join-policy-smoke.js`

Expected: all commands exit 0.

- [ ] **Step 5: 运行项目级检查**

Run: `npm run check`

Expected: repository aggregate check passes. If it depends on unavailable external infrastructure, record the exact failing command and run every locally available package-level test instead; do not describe an unrun check as passed.

- [ ] **Step 6: 构建小程序与 API**

Run: `npm --workspace apps/api run check && npm --workspace apps/miniprogram run build:mp-weixin`

Expected: API syntax/import check and mini-program production build both exit 0.

- [ ] **Step 7: 检查差异、素材与 schema 边界**

Run: `git diff --check && git status --short && git diff --name-only -- apps/api/src apps/api/test apps/miniprogram/src apps/miniprogram/test scripts package.json`

Expected: no whitespace errors; no migration/schema files; no unrelated workspace files staged or modified by this implementation.

- [ ] **Step 8: 提交门禁**

```bash
git add scripts/d52-adaptive-album-share-cover-check.js package.json
git commit -m "test: gate adaptive album share covers"
```

---

### Task 9: 在微信开发者工具验证真实分享表面

**Files:**
- Verify: `apps/miniprogram/dist/build/mp-weixin/`
- Verify: API cover endpoints generated by the local environment

- [ ] **Step 1: 启动本地 API 与小程序开发构建**

使用仓库既有启动脚本；确认 API 健康检查成功，小程序构建目录为 `apps/miniprogram/dist/build/mp-weixin`。不要在该步骤修改业务代码。

- [ ] **Step 2: 用 1、2、3、5、6、8、9 张公开安全图片建立代表样本**

至少包含横图、竖图、近重复图和一张低质量图；另准备一个约 100 张媒体的大相册。确认精选结果允许少于输入总数，且近重复/低于 65% 阈值的图片不会为了凑数重新出现，大相册也不会机械退化为九宫格。

- [ ] **Step 3: 在浏览器或 curl 验证双 endpoint**

分别打开 token 响应中的 `cover_url` 与 `timeline_cover_url`；确认前者 1000×800、后者 1000×1000，使用同一精选集合但构图/裁切不同，中文文案无乱码。

- [ ] **Step 4: 在微信开发者工具验证好友分享**

打开相册页，等待准备完成后触发“发送给朋友”；确认卡片显示 5:4 电影叙事封面，主图清晰、文字没有压脸、1–9 张样本均没有异常空白或拉伸。

- [ ] **Step 5: 在微信开发者工具验证朋友圈分享**

触发“分享到朋友圈”；确认使用 1:1 图而不是好友图。让 timeline URL 单独失败一次，确认好友菜单仍可用且时间线使用 1:1 本地降级图/保持对应菜单状态。

- [ ] **Step 6: 在 iOS 和 Android 真机各验证一次**

分别验证好友/群聊卡片和朋友圈预览；重点确认右侧图片没有超出卡片、动态中文没有压线、允许的最长角色名仍可读。

- [ ] **Step 7: 验证撤销和降级**

撤销分享后重新请求两个 URL，均必须拒绝；模拟渲染失败和远程图片预检失败，确认不会显示旧缓存中的私密封面，两个渠道各自使用正确尺寸的无人物降级图。

- [ ] **Step 8: 验证兼容发布顺序**

先部署支持缺省 `variant=friend`、双 URL 和新版 fallback 的服务端/静态资源，使用旧版小程序确认既有 `cover_url` 仍可分享；再发布消费 `timeline_cover_url` 的新版小程序。不要反向发布，以保证新旧客户端并存期间都可用。

- [ ] **Step 9: 最终验证提交边界**

Run: `git status --short && git log --oneline -10`

Expected: 本计划的提交按任务拆分清晰；用户原有的 `package-lock.json`、D48 tasks、`docs/evidence/`、content moderation runbook 与 D51 目录没有被纳入本功能提交。

---

## Completion criteria

- 任意输入数量都只从快照内安全媒体精选 1–9 张，不补入未授权媒体。
- 1–9 每个数量都有显式、美观、无重叠布局；7–9 使用字幕条，1–6 使用渐变文字层。
- 好友分享严格输出 1000×800，朋友圈时间线严格输出 1000×1000。
- 固定文案和无角色回退与设计稿逐字一致，生产 Alpine 镜像可渲染中文。
- 两个渠道 URL、预加载状态、菜单和降级图彼此独立。
- 缓存永远位于 token、撤销、过期、摘要、seat 与媒体安全校验之后。
- 单媒体分享、D48 角色/隐私边界及相邻分享流程全部回归通过。
- 没有数据库迁移，也没有把用户照片或探索稿打包为 fallback。
