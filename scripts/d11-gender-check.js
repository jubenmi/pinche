import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    return "";
  }
  return fs.readFileSync(fullPath, "utf8");
}

function cssBlock(source, selector) {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
  return source.match(pattern)?.[1] || "";
}

function hasYellowSelectionRing(block) {
  return (
    block.includes("0 0 0 3rpx rgba(216, 167, 61") &&
    block.includes("inset 0 0 0 1rpx rgba(216, 167, 61")
  );
}

const checks = [
  {
    label: "migration adds users.gender",
    file: "apps/api/migrations/0006_player_role_gender.sql",
    test: (source) => /users[\s\S]*ADD COLUMN gender/.test(source)
  },
  {
    label: "migration adds session_seats.role_gender",
    file: "apps/api/migrations/0006_player_role_gender.sql",
    test: (source) => /session_seats[\s\S]*ADD COLUMN role_gender/.test(source)
  },
  {
    label: "auth public user exposes gender",
    file: "apps/api/src/modules/auth/users.js",
    test: (source) => source.includes("gender: row.gender")
  },
  {
    label: "auth module can update user gender",
    file: "apps/api/src/modules/auth/users.js",
    test: (source) => source.includes("updateUserGender")
  },
  {
    label: "server exposes PATCH /api/users/me",
    file: "apps/api/src/server.js",
    test: (source) =>
      source.includes('request.method === "PATCH"') &&
      source.includes('url.pathname === "/api/users/me"')
  },
  {
    label: "service normalizes role gender",
    file: "apps/api/src/modules/core/service.js",
    test: (source) => source.includes("normalizeRoleGender")
  },
  {
    label: "create seat writes role_gender",
    file: "apps/api/src/modules/core/service.js",
    test: (source) => source.includes("role_gender") && source.includes("roleGender")
  },
  {
    label: "frontend requires missing user gender through profile modal",
    file: "apps/miniprogram/src/utils/api.js",
    test: (source) =>
      source.includes("ensureUserGender") &&
      source.includes("AUTH_PROFILE_REQUEST_EVENT") &&
      source.includes("requestUserGenderFromProfileModal")
  },
  {
    label: "frontend stores updated gender in auth cache",
    file: "apps/miniprogram/src/utils/api.js",
    test: (source) => source.includes("updateUserGender") && source.includes("setAuth")
  },
  {
    label: "create flow preserves roleGender",
    file: "apps/miniprogram/src/utils/createFlow.js",
    test: (source) => source.includes("roleGender")
  },
  {
    label: "create flow infers legacy role gender",
    file: "apps/miniprogram/src/utils/createFlow.js",
    test: (source) => source.includes("inferLegacyRoleGender")
  },
  {
    label: "create flow has role gender symbol helper",
    file: "apps/miniprogram/src/utils/createFlow.js",
    test: (source) => source.includes("roleGenderSymbol")
  },
  {
    label: "fallback scripts include role gender",
    file: "apps/miniprogram/src/pages/session/script.vue",
    test: (source) =>
      source.includes('\\"roleGender\\":\\"male\\"') &&
      source.includes('\\"roleGender\\":\\"female\\"')
  },
  {
    label: "auth identity bar displays user gender",
    file: "apps/miniprogram/src/components/AuthIdentityBar.vue",
    test: (source) => source.includes("userGenderLabel") && source.includes("genderText")
  },
  {
    label: "auth identity bar opens profile modal on tap",
    file: "apps/miniprogram/src/components/AuthIdentityBar.vue",
    test: (source) =>
      source.includes('@tap="handleIdentityTap"') &&
      source.includes("handleIdentityTap") &&
      source.includes("this.openProfileModal(false)") &&
      source.includes('class="profile-modal"') &&
      source.includes("handleProfileRequest")
  },
  {
    label: "auth identity modal provides gendered default avatars",
    file: "apps/miniprogram/src/components/AuthIdentityBar.vue",
    test: (source) =>
      source.includes("DEFAULT_AVATARS") &&
      source.includes("默认男生头像") &&
      source.includes("默认女生头像") &&
      source.includes("/static/avatars/default-male.jpg") &&
      source.includes("/static/avatars/default-female.jpg")
  },
  {
    label: "male default avatar image asset exists",
    file: "apps/miniprogram/src/static/avatars/default-male.jpg",
    test: (source) => source.length > 1024
  },
  {
    label: "female default avatar image asset exists",
    file: "apps/miniprogram/src/static/avatars/default-female.jpg",
    test: (source) => source.length > 1024
  },
  {
    label: "auth identity gender icons switch for male and female",
    file: "apps/miniprogram/src/components/AuthIdentityBar.vue",
    test: (source) =>
      source.includes("GENDER_ICONS") &&
      source.includes("/static/icons/gender-male.png") &&
      source.includes("/static/icons/gender-female.png") &&
      source.includes("profileGenderIcon") &&
      source.includes("draftGender || this.user?.gender")
  },
  {
    label: "male gender icon image asset exists",
    file: "apps/miniprogram/src/static/icons/gender-male.png",
    test: (source) => source.length > 200
  },
  {
    label: "female gender icon image asset exists",
    file: "apps/miniprogram/src/static/icons/gender-female.png",
    test: (source) => source.length > 200
  },
  {
    label: "auth identity modal saves user gender",
    file: "apps/miniprogram/src/components/AuthIdentityBar.vue",
    test: (source) =>
      source.includes("updateUserGender") &&
      source.includes("saveProfile") &&
      source.includes("AUTH_PROFILE_RESPONSE_EVENT")
  },
  {
    label: "auth identity avatars use distinct gender colors",
    file: "apps/miniprogram/src/components/AuthIdentityBar.vue",
    test: (source) =>
      source.includes("--avatar-male-surface: #dcece7") &&
      source.includes("--avatar-female-surface: #f7dde7")
  },
  {
    label: "create flow has cross-cast helper",
    file: "apps/miniprogram/src/utils/createFlow.js",
    test: (source) => source.includes("isCrossCast")
  },
  {
    label: "shared role board shows role gender symbols",
    file: "apps/miniprogram/src/components/RoleSeatBoard.vue",
    test: (source) =>
      source.includes("roleGenderSymbol") &&
      source.includes("role-gender-symbol")
  },
  {
    label: "shared role board tints male and female role cards",
    file: "apps/miniprogram/src/components/RoleSeatBoard.vue",
    test: (source) =>
      source.includes("roleToneClass") &&
      source.includes(".role-choice.male") &&
      source.includes(".role-choice.female")
  },
  {
    label: "shared role board selected state preserves gender tint with yellow ring",
    file: "apps/miniprogram/src/components/RoleSeatBoard.vue",
    test: (source) => {
      const block = cssBlock(
        source,
        ".role-choice.pending,\n.role-choice.mine,\n.role-choice.switching,\n.role-choice.selected,\n.role-choice.focused"
      );
      return (
        hasYellowSelectionRing(block) &&
        !block.includes("border-color:") &&
        !block.includes("background:")
      );
    }
  },
  {
    label: "role page confirms cross-cast selection",
    file: "apps/miniprogram/src/pages/session/role.vue",
    test: (source) =>
      source.includes("confirmCrossCastRole") &&
      source.includes("反串可能会影响游戏体验，是否确认")
  },
  {
    label: "role page refreshes selected cross-cast after gender update",
    file: "apps/miniprogram/src/pages/session/role.vue",
    test: (source) => {
      const boardSource = read("apps/miniprogram/src/components/RoleSeatBoard.vue");
      return (
        source.includes("AUTH_CHANGE_EVENT") &&
        source.includes("refreshCurrentUserGender") &&
        source.includes("isSelectedCrossCast") &&
        source.includes("<RoleSeatBoard") &&
        boardSource.includes("cross-cast-tag")
      );
    }
  },
  {
    label: "setup sends roleGender when creating seats",
    file: "apps/miniprogram/src/pages/session/setup.vue",
    test: (source) => source.includes("roleGender")
  },
  {
    label: "share final selection displays cross-cast",
    file: "apps/miniprogram/src/pages/session/share.vue",
    test: (source) => source.includes("反串") && source.includes("isCrossCast")
  },
  {
    label: "share page uses shared role board for gender-tinted role cards",
    file: "apps/miniprogram/src/pages/session/share.vue",
    test: (source) =>
      source.includes("<RoleSeatBoard") &&
      source.includes("roleSeatSections") &&
      read("apps/miniprogram/src/components/RoleSeatBoard.vue").includes(".role-choice.male") &&
      read("apps/miniprogram/src/components/RoleSeatBoard.vue").includes(".role-choice.female")
  },
  {
    label: "shared role board selected states preserve gender tint with yellow ring",
    file: "apps/miniprogram/src/components/RoleSeatBoard.vue",
    test: (source) => {
      const sharedStateBlock = cssBlock(
        source,
        ".role-choice.pending,\n.role-choice.mine,\n.role-choice.switching,\n.role-choice.selected,\n.role-choice.focused"
      );
      return (
        hasYellowSelectionRing(sharedStateBlock) &&
        !cssBlock(source, ".role-choice.pending").includes("background:") &&
        !cssBlock(source, ".role-choice.mine").includes("background:") &&
        !cssBlock(source, ".role-choice.switching").includes("background:")
      );
    }
  },
  {
    label: "share page confirms cross-cast selection",
    file: "apps/miniprogram/src/pages/session/share.vue",
    test: (source) =>
      source.includes("confirmCrossCastRole") &&
      source.includes("反串可能会影响游戏体验，是否确认")
  },
  {
    label: "share page refreshes selected cross-cast after gender update",
    file: "apps/miniprogram/src/pages/session/share.vue",
    test: (source) =>
      source.includes("AUTH_CHANGE_EVENT") &&
      source.includes("refreshCurrentUserGender") &&
      source.includes('this.confirmedCrossCastRoleKey = ""')
  },
  {
    label: "mine page delegates gender editing to identity bar",
    file: "apps/miniprogram/src/pages/mine/index.vue",
    test: (source) =>
      source.includes("<AuthIdentityBar />") &&
      !source.includes("我的性别") &&
      !source.includes("saveGender")
  },
  {
    label: "root check runs D11 check",
    file: "package.json",
    test: (source) => source.includes("node scripts/d11-gender-check.js")
  }
];

let failed = 0;

for (const check of checks) {
  const source = read(check.file);
  if (!source || !check.test(source)) {
    failed += 1;
    console.error(`D11 gender check failed: ${check.label} (${check.file})`);
  }
}

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log(`D11 gender check passed: ${checks.length} checks`);
}
