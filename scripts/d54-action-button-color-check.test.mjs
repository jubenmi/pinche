import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  extractStyleBlocks,
  findClassOnlyDisabledBindings,
  findMissingRequiredSourcePatterns,
  findNeutralEnabledButtonRules
} from "./lib/action-button-style-contract.mjs";

test("extracts every Vue style block", () => {
  assert.deepEqual(
    extractStyleBlocks("<style>.a { color: red; }</style><style scoped>.b { color: blue; }</style>"),
    [".a { color: red; }", ".b { color: blue; }"]
  );
});

test("reports neutral enabled text-button rules", () => {
  const source = `
    <style>
    .button.secondary { background: #ffffff; color: #193d35; }
    .mini-button.muted { background: #64748b; color: #ffffff; }
    </style>
  `;
  assert.deepEqual(
    findNeutralEnabledButtonRules(source, "sample.vue"),
    [
      { file: "sample.vue", selector: ".button.secondary", value: "#ffffff" },
      { file: "sample.vue", selector: ".mini-button.muted", value: "#64748b" }
    ]
  );
});

test("reports neutral rules for named text-action classes", () => {
  const source = `
    <style>
    .message-panel-tool { background: #ffffff; }
    .profile-logout { background: #fffefb; }
    .phone-skip { background: #ffffff; }
    .chat-modal-close { background: #f8fafc; }
    .role-action.ghost { background: #ffffff; }
    .city-location-action { background: #ffffff; }
    .profile-close { background: #ffffff; }
    .floating-toolbar-button.secondary { background: #fffefc; }
    .album-image-viewer__primary-action { background: #ffffff; }
    </style>
  `;
  assert.deepEqual(
    findNeutralEnabledButtonRules(source, "sample.vue"),
    [
      { file: "sample.vue", selector: ".message-panel-tool", value: "#ffffff" },
      { file: "sample.vue", selector: ".profile-logout", value: "#fffefb" },
      { file: "sample.vue", selector: ".phone-skip", value: "#ffffff" },
      { file: "sample.vue", selector: ".chat-modal-close", value: "#f8fafc" },
      { file: "sample.vue", selector: ".role-action.ghost", value: "#ffffff" },
      { file: "sample.vue", selector: ".city-location-action", value: "#ffffff" },
      { file: "sample.vue", selector: ".profile-close", value: "#ffffff" },
      { file: "sample.vue", selector: ".floating-toolbar-button.secondary", value: "#fffefc" },
      { file: "sample.vue", selector: ".album-image-viewer__primary-action", value: "#ffffff" }
    ]
  );
});

test("allows green, disabled, danger, and pure icon rules", () => {
  const source = `
    <style>
    .button { background: #1f6f5b; }
    .button.secondary { background: #eef7f4; }
    .button.disabled { background: #aeb8b1; }
    .button.danger { background: #9f3f33; }
    .album-image-viewer__icon-button { background: #ffffff; }
    </style>
  `;
  assert.deepEqual(findNeutralEnabledButtonRules(source, "sample.vue"), []);
});

test("accepts a concrete neutral selector exception", () => {
  const source = "<style>.avatar-button { background: #ffffff; }</style>";
  assert.deepEqual(
    findNeutralEnabledButtonRules(source, "sample.vue", [
      { file: "sample.vue", selector: ".avatar-button", reason: "avatar picker" }
    ]),
    []
  );
});

test("reports dynamic disabled classes without a disabled binding", () => {
  const source = `
    <t-button class="button" :class="{ disabled: saving }" @tap="save">保存</t-button>
    <t-button class="button" :class="{ disabled: busy }" :disabled="busy">提交</t-button>
  `;
  assert.deepEqual(findClassOnlyDisabledBindings(source, "sample.vue"), [
    { file: "sample.vue", expression: "saving" }
  ]);
});

test("accepts a concrete class-only disabled exception", () => {
  const source = "<view class=\"button\" :class=\"{ disabled: decorative }\">提示</view>";
  assert.deepEqual(
    findClassOnlyDisabledBindings(source, "sample.vue", [
      { file: "sample.vue", expression: "decorative", reason: "non-interactive view" }
    ]),
    []
  );
});

test("reports required static contract patterns that are missing", () => {
  const source = '<t-button theme="primary" :disabled="saving">保存</t-button>';
  assert.deepEqual(
    findMissingRequiredSourcePatterns(source, "sample.vue", [
      { name: "primary theme", pattern: /theme="primary"/ },
      { name: "green button token", pattern: /--action-green/ }
    ]),
    [{ file: "sample.vue", name: "green button token" }]
  );
});

test("marks catalog list deletion controls as danger actions", () => {
  const source = fs.readFileSync("apps/miniprogram/src/pages/admin/catalog.vue", "utf8");

  for (const handler of [
    "deleteStoreByItem(store)",
    "deleteScriptByItem(script)",
    "removeScriptRole(index)",
    "removeNpcRole(index)"
  ]) {
    assert.match(
      source,
      new RegExp(`class="mini-button danger" @tap="${handler.replace(/[().]/g, "\\$&")}"`),
      `${handler} must be rendered as a danger action`
    );
  }
});

test("registers distinct action-button checks without replacing the existing D54 commands", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

  assert.equal(
    packageJson.scripts["action-button:unit"],
    "node --test scripts/d54-action-button-color-check.test.mjs"
  );
  assert.equal(
    packageJson.scripts["action-button:check"],
    "node scripts/d54-action-button-color-check.js"
  );
  assert.match(packageJson.scripts.check, /npm run action-button:unit/);
  assert.match(packageJson.scripts.check, /npm run action-button:check/);
  assert.equal(
    packageJson.scripts.postcheck,
    "npm run d54:unit && npm run d54:check && npm run d55:unit && npm run d55:check && npm run d56:unit && npm run d56:check"
  );
  assert.match(packageJson.scripts["d54:check"], /d54-public-album-full-share-pagination-check/);
});
