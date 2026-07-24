import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function rulesFor(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...styles.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "g"))]
    .map((match) => match[1]);
}

test("drawer close text keeps the shallow-green action color in its final rule", () => {
  const closeButtonRules = rulesFor(".close-button");
  assert.ok(closeButtonRules.length > 0, "expected a .close-button style rule");
  assert.match(closeButtonRules.at(-1), /color:\s*var\(--admin-accent-strong\)/);
});

test("disabled actions override danger text with the neutral disabled color", () => {
  const disabledRules = rulesFor(".toolbar button:disabled,\n.primary:disabled,\n.secondary-action:disabled,\n.action-button:disabled,\n.close-button:disabled,\n.bulk-action-button:disabled,\n.review-footer-actions button:disabled,\n.mini-stepper button:disabled,\n.user-box button:disabled");
  assert.equal(disabledRules.length, 1, "expected the shared disabled action rule");
  assert.match(disabledRules[0], /color:\s*#ffffff\s*!important/);
});
