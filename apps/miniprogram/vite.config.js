import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, transformWithEsbuild } from "vite";
import uniPlugin from "@dcloudio/vite-plugin-uni";

const uni = typeof uniPlugin === "function" ? uniPlugin : uniPlugin.default;
const miniprogramRoot = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = path.resolve(miniprogramRoot, "../..");
const buildTime = formatBuildTime();
const tdesignPackageName = "tdesign-miniprogram";
const tdesignSourceRoot = path.join(miniprogramRoot, "src/wxcomponents", tdesignPackageName);
const tdesignPackageDistCandidates = [
  path.join(miniprogramRoot, "node_modules", tdesignPackageName, "miniprogram_dist"),
  path.join(workspaceRoot, "node_modules", tdesignPackageName, "miniprogram_dist")
];
const tdesignPackageDistRoot = firstExistingPath(tdesignPackageDistCandidates) || tdesignPackageDistCandidates[0];
const tdesignComponentFoldersToCopy = [
  "action-sheet",
  "badge",
  "button",
  "cell",
  "common",
  "date-time-picker",
  "dialog",
  "empty",
  "grid",
  "grid-item",
  "icon",
  "image",
  "input",
  "loading",
  "notice-bar",
  "overlay",
  "picker",
  "picker-item",
  "popup",
  "search",
  "segmented",
  "sticky",
  "switch",
  "tab-panel",
  "tabs",
  "tag",
  "textarea",
  "toast"
];
const tdesignRuntimePathsToCopy = [
  ".wechatide.ib.json",
  "index.js",
  "mixins/transition.js",
  "mixins/using-config.js",
  "mixins/using-custom-navbar.js",
  "config-provider/config-store.js",
  "config-provider/reactive-state.js",
  "config-provider/use-config.js",
  "locale/zh_CN.js",
  "miniprogram_npm/dayjs",
  "miniprogram_npm/tinycolor2",
  "miniprogram_npm/tslib"
];
const nativeTdesignTags = new Set([
  "root-portal",
  "t-action-sheet",
  "t-badge",
  "t-button",
  "t-date-time-picker",
  "t-dialog",
  "t-empty",
  "t-image",
  "t-input",
  "t-notice-bar",
  "t-picker",
  "t-picker-item",
  "t-popup",
  "t-search",
  "t-segmented",
  "t-switch",
  "t-tabs",
  "t-tab-panel",
  "t-tag",
  "t-textarea",
  "t-toast"
]);

function formatBuildTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  ].join(" ");
}

function firstExistingPath(paths) {
  return paths.find((candidatePath) => fs.existsSync(candidatePath));
}

export default defineConfig({
  define: {
    __PINCHE_BUILD_TIME__: JSON.stringify(buildTime)
  },
  plugins: [
    uni({
      vueOptions: {
        template: {
          compilerOptions: {
            isCustomElement: isNativeTdesignComponent
          }
        }
      }
    }),
    copyTdesignMiniprogramNpmPlugin(),
    stripDcloudPreloadAssetPlugin(),
    compileTdesignMiniprogramRuntimePlugin()
  ]
});

function isNativeTdesignComponent(tag) {
  return nativeTdesignTags.has(tag);
}

function copyTdesignMiniprogramNpmPlugin() {
  return {
    name: "pinche:copy-tdesign-miniprogram-npm",
    buildStart() {
      preseedTdesignMiniprogramNpmPackage();
    },
    generateBundle() {
      preseedTdesignMiniprogramNpmPackage();
    },
    writeBundle(outputOptions) {
      if (!outputOptions.dir) {
        return;
      }
      copyTdesignComponentNpmPackage(
        path.join(outputOptions.dir, "wxcomponents", tdesignPackageName)
      );
    }
  };
}

function compileTdesignMiniprogramRuntimePlugin() {
  let tdesignOutputRoot = "";

  return {
    name: "pinche:compile-tdesign-miniprogram-runtime",
    enforce: "post",
    writeBundle(outputOptions) {
      if (!outputOptions.dir) {
        return;
      }
      tdesignOutputRoot = path.join(outputOptions.dir, "wxcomponents", tdesignPackageName);
    },
    async closeBundle() {
      await compileTdesignModulesForWechatRuntime(tdesignOutputRoot);
    }
  };
}

function preseedTdesignMiniprogramNpmPackage() {
  copyTdesignComponentNpmPackage(tdesignSourceRoot, {
    includeRuntime: false,
    preserveExisting: true
  });
}

function copyTdesignComponentNpmPackage(tdesignTarget, options = {}) {
  const componentSourceRoot =
    path.resolve(tdesignTarget) === path.resolve(tdesignSourceRoot)
      ? tdesignPackageDistRoot
      : tdesignSourceRoot;
  if (!fs.existsSync(componentSourceRoot)) {
    return;
  }

  for (const folder of tdesignComponentFoldersToCopy) {
    copyPath(path.join(componentSourceRoot, folder), path.join(tdesignTarget, folder), options);
  }
  if (options.includeRuntime !== false) {
    for (const runtimePath of tdesignRuntimePathsToCopy) {
      copyPath(
        path.join(tdesignPackageDistRoot, runtimePath),
        path.join(tdesignTarget, runtimePath),
        options
      );
    }
  }
  rewriteTdesignIconFontCss(tdesignTarget, options);
  addTdesignTslibCompatShims(tdesignTarget);
}

function copyPath(source, target, options = {}) {
  if (!fs.existsSync(source)) {
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    force: options.preserveExisting !== true,
    errorOnExist: false
  });
}

function rewriteTdesignIconFontCss(tdesignPackageRoot, options = {}) {
  const iconWxssPath = path.join(tdesignPackageRoot, "icon/icon.wxss");
  const localIconWxssPath = path.join(tdesignSourceRoot, "icon/icon.wxss");
  if (!fs.existsSync(iconWxssPath) || options.preserveExisting === true) {
    return;
  }
  if (fs.existsSync(localIconWxssPath)) {
    fs.copyFileSync(localIconWxssPath, iconWxssPath);
  }
}

function addTdesignTslibCompatShims(tdesignPackageRoot) {
  const fallbackShimPath = path.join(tdesignSourceRoot, "button/tslib.js");
  if (!fs.existsSync(tdesignPackageRoot) || !fs.existsSync(fallbackShimPath)) {
    return;
  }
  const shimSource = fs.readFileSync(fallbackShimPath, "utf8");
  for (const file of walkOutputFiles(tdesignPackageRoot)) {
    if (!/\.js$/i.test(file) || /(?:^|\/)tslib\.js$/i.test(file.replaceAll(path.sep, "/"))) {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    if (!/\bfrom\s*["']tslib["']/.test(source)) {
      continue;
    }
    const shimPath = path.join(path.dirname(file), "tslib.js");
    if (!fs.existsSync(shimPath)) {
      fs.writeFileSync(shimPath, shimSource);
    }
  }
}

async function compileTdesignModulesForWechatRuntime(tdesignPackageRoot) {
  if (!fs.existsSync(tdesignPackageRoot)) {
    return;
  }

  for (const file of walkOutputFiles(tdesignPackageRoot)) {
    const normalizedFile = file.replaceAll(path.sep, "/");
    if (/\.d\.ts$/i.test(file)) {
      fs.rmSync(file);
      continue;
    }
    if (!/\.js$/i.test(file) || normalizedFile.includes("/miniprogram_npm/")) {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    if (!/(^|\n)\s*(?:import|export)\b/.test(source)) {
      continue;
    }
    const transformed = await transformWithEsbuild(source, file, {
      format: "cjs",
      loader: "js",
      minify: true,
      sourcemap: false,
      target: "es2017"
    });
    fs.writeFileSync(file, transformed.code);
  }
}

function stripDcloudPreloadAssetPlugin() {
  return {
    name: "pinche:strip-dcloud-preload-asset",
    generateBundle(_outputOptions, bundle) {
      for (const entry of Object.values(bundle)) {
        if (entry.type === "chunk") {
          entry.code = withoutDcloudPreloadAsset(entry.code);
        } else if (entry.type === "asset" && isTextAsset(entry.fileName)) {
          entry.source = withoutDcloudPreloadAsset(entry.source);
        }
      }
    },
    writeBundle(outputOptions) {
      if (!outputOptions.dir) {
        return;
      }
      for (const file of walkOutputFiles(outputOptions.dir)) {
        if (!/\.js$/i.test(file)) {
          continue;
        }
        const source = fs.readFileSync(file, "utf8");
        const stripped = withoutDcloudPreloadAsset(source);
        if (stripped !== source) {
          fs.writeFileSync(file, stripped);
        }
      }
    }
  };
}

function withoutDcloudPreloadAsset(source) {
  const code = Buffer.isBuffer(source) ? source.toString("utf8") : String(source);
  return code.replace(
    /!function\(\)\{if\([\s\S]{0,120}?wx\.preloadAssets[\s\S]*?shadow-grey\.png[\s\S]*?\}\}\(\),?/g,
    ""
  );
}

function isTextAsset(fileName) {
  return /\.(?:js|json|wxml|wxss|css)$/i.test(fileName);
}

function walkOutputFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walkOutputFiles(file) : [file];
  });
}
