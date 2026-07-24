import assert from "node:assert/strict";
import test from "node:test";

import {
  extractStyleBlocks,
  findClassOnlyDisabledBindings,
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
