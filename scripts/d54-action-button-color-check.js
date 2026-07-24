import fs from "node:fs";
import path from "node:path";

import {
  findClassOnlyDisabledBindings,
  findMissingRequiredSourcePatterns,
  findNeutralEnabledButtonRules
} from "./lib/action-button-style-contract.mjs";

const root = process.cwd();
const sourceRoots = [
  "apps/miniprogram/src",
  "packages/talk/miniprogram",
  "apps/admin-web/src"
];
const excludedSegments = new Set([
  "wxcomponents",
  "uni_modules",
  "dist",
  "node_modules",
  "design-exports",
  "output"
]);
const allowedExtensions = new Set([".vue", ".css"]);
const selectorExceptions = [
  {
    file: "apps/miniprogram/src/components/AuthIdentityBar.vue",
    selector: ".profile-avatar-button",
    reason: "avatar image picker, not a text action"
  }
];
const disabledExceptions = [];
const requiredSourcePatterns = new Map([
  [
    "apps/miniprogram/src/App.vue",
    [
      {
        name: "TDesign default green token",
        pattern: /--td-button-default-bg-color:\s*var\(--action-green\)/
      },
      {
        name: "secondary shallow-green button",
        pattern: /\.button\.secondary\s*\{[\s\S]*?background:\s*var\(--action-green-light\)/
      },
      {
        name: "disabled gray button",
        pattern: /\.button\.disabled,\s*\.button\[disabled\]\s*\{[\s\S]*?background:\s*var\(--action-disabled\)/
      }
    ]
  ],
  [
    "apps/miniprogram/src/pages/session/albumPrivacy.vue",
    [
      { name: "save settings primary theme", pattern: /theme="primary"/ },
      { name: "save settings disabled binding", pattern: /:disabled="saving"/ }
    ]
  ],
  [
    "apps/miniprogram/src/pages/session/create.vue",
    [{ name: "store next-step disabled binding", pattern: /:disabled="!selectedStore"/ }]
  ],
  [
    "apps/miniprogram/src/pages/session/script.vue",
    [{ name: "script next-step disabled binding", pattern: /:disabled="!selectedScript"/ }]
  ],
  [
    "apps/miniprogram/src/pages/session/role.vue",
    [{ name: "role next-step disabled binding", pattern: /:disabled="!selectedRole"/ }]
  ],
  [
    "apps/miniprogram/src/extensions/session-pseudo-chat/ChatEntry.vue",
    [
      { name: "host draft shallow-green action", pattern: /\.draft-button\s*\{[\s\S]*?background:\s*#eef7f4/ },
      { name: "host close shallow-green action", pattern: /\.chat-modal-close\s*\{[\s\S]*?background:\s*#eef7f4/ }
    ]
  ],
  [
    "packages/talk/miniprogram/ChatEntry.vue",
    [
      { name: "talk draft shallow-green action", pattern: /\.draft-button\s*\{[\s\S]*?background:\s*#eef7f4/ },
      { name: "talk close shallow-green action", pattern: /\.chat-modal-close\s*\{[\s\S]*?background:\s*#eef7f4/ }
    ]
  ],
  [
    "apps/miniprogram/src/extensions/session-pseudo-chat/ManagePinnedMessage.vue",
    [
      { name: "host pinned primary action", pattern: /\.actions \.button\s*\{[\s\S]*?background:\s*#1f6f5b/ },
      { name: "host pinned disabled action", pattern: /\.actions \.button\[disabled\]\s*\{[\s\S]*?background:\s*#aeb8b1/ }
    ]
  ],
  [
    "packages/talk/miniprogram/ManagePinnedMessage.vue",
    [
      { name: "talk pinned primary action", pattern: /\.actions \.button\s*\{[\s\S]*?background:\s*#1f6f5b/ },
      { name: "talk pinned disabled action", pattern: /\.actions \.button\[disabled\]\s*\{[\s\S]*?background:\s*#aeb8b1/ }
    ]
  ],
  [
    "apps/admin-web/src/styles.css",
    [
      { name: "admin action color tokens", pattern: /--admin-action-soft:\s*#eef8f3[\s\S]*?--admin-action-disabled:\s*#c9d6d2/ },
      { name: "admin green secondary action", pattern: /\.toolbar button,[\s\S]*?\.close-button\s*\{[\s\S]*?background:\s*var\(--admin-action-soft\)/ },
      { name: "admin gray disabled action", pattern: /\.toolbar button:disabled,[\s\S]*?\.user-box button:disabled\s*\{[\s\S]*?background:\s*var\(--admin-action-disabled\)/ },
      { name: "admin dangerous action", pattern: /\.bulk-action-button--danger\s*\{[\s\S]*?background:\s*var\(--admin-danger-soft\)/ }
    ]
  ]
]);

function collectFiles(relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true })
    .flatMap((entry) => {
      if (excludedSegments.has(entry.name)) return [];
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) return collectFiles(relativePath);
      return allowedExtensions.has(path.extname(entry.name)) ? [relativePath] : [];
    });
}

const files = sourceRoots.flatMap(collectFiles).sort();
const violations = [];
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  violations.push(...findNeutralEnabledButtonRules(source, file, selectorExceptions));
  if (file.endsWith(".vue")) {
    violations.push(...findClassOnlyDisabledBindings(source, file, disabledExceptions));
  }
  const requirements = requiredSourcePatterns.get(file);
  if (requirements) {
    violations.push(...findMissingRequiredSourcePatterns(source, file, requirements));
  }
}

for (const violation of violations) {
  if ("selector" in violation) {
    console.error(
      `D54 neutral enabled button: ${violation.file} :: ${violation.selector} :: ${violation.value}`
    );
  } else if ("expression" in violation) {
    console.error(
      `D54 class-only disabled binding: ${violation.file} :: ${violation.expression}`
    );
  } else {
    console.error(`D54 required source contract missing: ${violation.file} :: ${violation.name}`);
  }
}

if (violations.length > 0) process.exit(1);
console.log(`D54 action button color check passed (${files.length} source files)`);
