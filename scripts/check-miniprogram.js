import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const apiServerPath = path.join(root, "apps/api/src/server.js");
const miniprogramRoot = path.join(root, "apps/miniprogram");
const srcRoot = path.join(miniprogramRoot, "src");
const pagesJsonPath = path.join(srcRoot, "pages.json");
const manifestJsonPath = path.join(srcRoot, "manifest.json");
const miniprogramPackageJsonPath = path.join(miniprogramRoot, "package.json");
const miniprogramProjectConfigPath = path.join(miniprogramRoot, "project.config.json");
const miniprogramPrivateProjectConfigPath = path.join(
  miniprogramRoot,
  "project.private.config.json"
);
const srcProjectConfigPath = path.join(srcRoot, "project.config.json");
const viteConfigPath = path.join(miniprogramRoot, "vite.config.js");
const miniprogramDevEnvPath = path.join(miniprogramRoot, ".env.development");
const miniprogramProdEnvPath = path.join(miniprogramRoot, ".env.production");
const miniprogramDevRoot = path.join(miniprogramRoot, "dist/dev/mp-weixin");
const miniprogramBuildRoot = path.join(miniprogramRoot, "dist/build/mp-weixin");
const codexHooksPath = path.join(root, ".codex/hooks.json");
const devtoolsHookPath = path.join(root, "scripts/devtools-refresh-hook.js");
const d35AdminCatalogCheckPath = path.join(root, "scripts/d35-miniprogram-admin-catalog-check.js");
const albumImageViewerPath = path.join(srcRoot, "components", "AlbumImageViewer.vue");
const productionApiBaseUrl = "https://api.pinche.jubenmi.com";
const productionWechatAppId = "wx2675a606d3bd242c";
const requireBuiltWxml = process.argv.includes("--require-built-wxml");
const mainPackageLimitBytes = Math.floor(1.5 * 1024 * 1024);
const localMediaLimitBytes = 200 * 1024;
const localFontLimitBytes = 200 * 1024;
const localMediaPattern = /\.(?:png|jpe?g|gif|webp|mp3|m4a|aac|wav|mp4|mov)$/i;
const localFontPattern = /\.(?:ttf|otf|woff2?|eot)$/i;
const brandFontPath = "static/fonts/pinche-brand.ttf";
const tdesignPackageName = "tdesign-miniprogram";
const tdesignDistPath = path.join(root, "node_modules", tdesignPackageName, "miniprogram_dist");
const tdesignWxcomponentsPath = path.join(srcRoot, "wxcomponents", tdesignPackageName);
const tdesignDirectComponentNames = [
  "action-sheet",
  "back-top",
  "badge",
  "button",
  "cell",
  "collapse",
  "date-time-picker",
  "dialog",
  "empty",
  "form",
  "icon",
  "image",
  "input",
  "loading",
  "notice-bar",
  "picker",
  "popup",
  "search",
  "segmented",
  "skeleton",
  "steps",
  "sticky",
  "switch",
  "tabs",
  "tag",
  "textarea",
  "toast"
];
const tdesignSupportComponentNames = [
  "cell-group",
  "collapse-panel",
  "form-item",
  "grid",
  "grid-item",
  "overlay",
  "picker-item",
  "step-item",
  "tab-panel",
  "transition"
];
const tdesignRequiredBaseFolders = ["common"];
const tdesignRequiredRuntimePaths = [
  ".wechatide.ib.json",
  "index.js",
  "mixins/transition.js",
  "mixins/using-config.js",
  "mixins/using-custom-navbar.js",
  "config-provider/config-store.js",
  "config-provider/reactive-state.js",
  "config-provider/use-config.js",
  "locale/zh_CN.js",
  "miniprogram_npm/dayjs"
];
const tdesignNativePrimitiveTags = ["button", "image", "input", "picker", "switch", "textarea"];
const tdesignRequiredHighPriorityTags = ["t-badge", "t-empty", "t-notice-bar", "t-search", "t-tag"];
const tdesignRequiredMediumPriorityTags = [
  "t-action-sheet",
  "t-dialog",
  "t-popup",
  "t-segmented",
  "t-tab-panel",
  "t-tabs",
  "t-toast"
];
const tdesignDisallowedSourceTags = ["t-avatar"];
const tdesignSourceScanSubdirs = ["pages", "components", "extensions"];
const allowedFeedbackApiFiles = new Set([
  "apps/miniprogram/src/utils/tdesignFeedback.js"
]);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(file) : [file];
  });
}

function formatSize(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function relativePath(file) {
  return path.relative(root, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function collectVueFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return walkFiles(dir).filter((file) => /\.vue$/i.test(file));
}

function sourceScanVueFiles() {
  return tdesignSourceScanSubdirs.flatMap((subdir) => collectVueFiles(path.join(srcRoot, subdir)));
}

function sourceAppCodeFiles() {
  return walkFiles(srcRoot).filter((file) => {
    const relative = path.relative(srcRoot, file).replaceAll(path.sep, "/");
    return (
      /\.(?:vue|js)$/i.test(file) &&
      !relative.startsWith("uni_modules/")
    );
  });
}

function tagComponentName(tagName) {
  return tagName.replace(/^t-/, "");
}

function componentTagName(componentName) {
  return `t-${componentName}`;
}

function tdesignComponentPath(componentName) {
  return `/wxcomponents/${tdesignPackageName}/${componentName}/${componentName}`;
}

function builtTdesignComponentPath(componentName) {
  return `/wxcomponents/${tdesignPackageName}/${componentName}/${componentName}`;
}

function resolveBuiltComponentBasePath(buildRoot, ownerJsonPath, componentPath) {
  const normalized = componentPath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (componentPath.startsWith("/")) {
    return path.join(buildRoot, normalized);
  }
  return path.resolve(path.dirname(ownerJsonPath), normalized);
}

function expectedBuiltTdesignComponentBasePath(buildRoot, componentName) {
  return path.join(
    buildRoot,
    "wxcomponents",
    tdesignPackageName,
    componentName,
    componentName
  );
}

function assertBuiltComponentFilesExist(buildRoot, ownerJsonPath, componentPath, owner) {
  const componentBasePath = resolveBuiltComponentBasePath(buildRoot, ownerJsonPath, componentPath);
  for (const extension of [".json", ".wxml", ".js"]) {
    const file = `${componentBasePath}${extension}`;
    if (!fs.existsSync(file)) {
      fail(`${owner} points to missing built component file: ${relativePath(file)}`);
    }
  }
}

function builtTdesignTagsForJson(jsonPath) {
  const wxmlPath = jsonPath.replace(/\.json$/i, ".wxml");
  if (!fs.existsSync(wxmlPath)) {
    return [];
  }
  return extractTdesignTags(fs.readFileSync(wxmlPath, "utf8"));
}

function extractTdesignTags(source) {
  const tags = new Set();
  const tagPattern = /<\s*(t-[a-z0-9-]+)(?=[\s>/])/g;
  for (const match of source.matchAll(tagPattern)) {
    tags.add(match[1]);
  }
  return tags;
}

function sourceTdesignTags(files) {
  const tags = new Set();
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const tag of extractTdesignTags(source)) {
      tags.add(tag);
    }
  }
  return [...tags].sort();
}

function assertNoTdesignAvatarImageTags(files) {
  const failures = [];
  const pattern = /<\s*t-image(?=[\s>/])[^>]*\bclass\s*=\s*["'][^"']*avatar[^"']*["'][^>]*>/g;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    if (pattern.test(source)) {
      failures.push(`${relativePath(file)} must use native <image> for avatar rendering`);
    }
  }
  for (const failure of failures) {
    fail(failure);
  }
}

function isAllowedNativeAvatarPrimitiveTag(tag, tagSource) {
  const classMatch = tagSource.match(/\bclass\s*=\s*["']([^"']+)["']/);
  if (!classMatch) {
    return false;
  }
  const className = classMatch[1];
  if (tag === "image") {
    return (
      /\bavatar\b/.test(className) ||
      /avatar/.test(className) ||
      /photo-preview-image/.test(className) ||
      /album-image-viewer__image/.test(className) ||
      /album-image-viewer__video-poster/.test(className)
    );
  }
  if (tag === "button") {
    return /profile-avatar-button/.test(className) || /auth-profile-trigger/.test(className);
  }
  if (tag === "input") {
    return /\bprofile-nickname-input\b/.test(className) && /\btype\s*=\s*["']nickname["']/.test(tagSource);
  }
  return false;
}

function assertNoNativeTdesignPrimitiveTags(files) {
  const failures = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const tag of tdesignNativePrimitiveTags) {
      const pattern = new RegExp(`<\\s*${tag}(?=[\\s>/])[^>]*>`, "g");
      for (const match of source.matchAll(pattern)) {
        if (isAllowedNativeAvatarPrimitiveTag(tag, match[0])) {
          continue;
        }
        failures.push(`${relativePath(file)} still uses native <${tag}>`);
        break;
      }
    }
  }
  for (const failure of failures) {
    fail(failure);
  }
}

function assertNoDirectFeedbackApis(files) {
  const pattern = /\buni\.(showToast|showModal|showActionSheet)\s*\(/g;
  for (const file of files) {
    const relative = relativePath(file).replaceAll(path.sep, "/");
    if (allowedFeedbackApiFiles.has(relative)) {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) {
      fail(`${relative} must use utils/tdesignFeedback.js instead of uni.${match[1]}`);
    }
  }
}

function tdesignComponentJsonPath(componentName) {
  return path.join(tdesignDistPath, componentName, `${componentName}.json`);
}

function componentNameFromTdesignPath(value) {
  const normalized = value.replace(/\\/g, "/");
  const match = normalized.match(/(?:^|\/)([a-z0-9-]+)\/[a-z0-9-]+$/);
  return match?.[1] || "";
}

function tdesignComponentDependencies(componentName, seen = new Set()) {
  if (seen.has(componentName)) {
    return seen;
  }
  seen.add(componentName);
  const componentJsonPath = tdesignComponentJsonPath(componentName);
  if (!fs.existsSync(componentJsonPath)) {
    return seen;
  }
  const componentJson = readJson(componentJsonPath);
  for (const dependencyPath of Object.values(componentJson.usingComponents || {})) {
    const dependencyName = componentNameFromTdesignPath(dependencyPath);
    if (dependencyName) {
      tdesignComponentDependencies(dependencyName, seen);
    }
  }
  return seen;
}

function requiredTdesignFoldersForTags(tags) {
  const folders = new Set(tdesignRequiredBaseFolders);
  for (const tag of tags) {
    const componentName = tagComponentName(tag);
    for (const folder of tdesignComponentDependencies(componentName)) {
      folders.add(folder);
    }
  }
  return [...folders].sort();
}

function extractStringArrayConst(source, constName) {
  const pattern = new RegExp(`const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
  const body = source.match(pattern)?.[1] || "";
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function assertTdesignMigrationConfig(pagesJson) {
  if (!fs.existsSync(miniprogramPackageJsonPath)) {
    fail("Mini-program package.json is missing");
    return;
  }
  const miniprogramPackageJson = readJson(miniprogramPackageJsonPath);
  if (!miniprogramPackageJson.dependencies?.[tdesignPackageName]) {
    fail(`Mini-program package.json must depend on ${tdesignPackageName}`);
  }
  if (!fs.existsSync(tdesignDistPath)) {
    fail(`Installed ${tdesignPackageName} package is missing miniprogram_dist`);
    return;
  }

  const appVueFiles = sourceScanVueFiles();
  const usedTags = sourceTdesignTags(appVueFiles);
  assertNoTdesignAvatarImageTags(appVueFiles);
  for (const tag of tdesignDisallowedSourceTags) {
    if (usedTags.includes(tag)) {
      fail(`${tag} is disabled for avatar rendering; use native image containers instead`);
    }
  }
  for (const tag of tdesignRequiredHighPriorityTags) {
    if (!usedTags.includes(tag)) {
      fail(`High-priority TDesign migration must use ${tag}`);
    }
  }
  for (const tag of tdesignRequiredMediumPriorityTags) {
    if (!usedTags.includes(tag)) {
      fail(`Medium-priority TDesign migration must use ${tag}`);
    }
  }
  const registeredTdesignComponents = {
    ...(pagesJson.globalStyle?.usingComponents || {}),
    ...Object.assign(
      {},
      ...(pagesJson.pages || []).map((page) => page.style?.usingComponents || {})
    )
  };
  const globalTdesignComponents = pagesJson.globalStyle?.usingComponents || {};
  const adminCatalogPage = pagesJson.pages?.find((page) => page.path === "pages/admin/catalog") || {};
  const adminCatalogComponents = adminCatalogPage.style?.usingComponents || {};
  for (const tabTag of ["t-tabs", "t-tab-panel"]) {
    if (globalTdesignComponents[tabTag]) {
      fail(`${tabTag} must be registered only on pages/admin/catalog to avoid global DevTools component resolution noise`);
    }
    if (adminCatalogComponents[tabTag] !== tdesignComponentPath(tagComponentName(tabTag))) {
      fail(`pages/admin/catalog must register ${tabTag}: ${tdesignComponentPath(tagComponentName(tabTag))}`);
    }
  }
  for (const tag of usedTags) {
    const componentName = tagComponentName(tag);
    const expectedPath = tdesignComponentPath(componentName);
    if (registeredTdesignComponents[tag] !== expectedPath) {
      fail(`pages.json usingComponents must register ${tag}: ${expectedPath}`);
    }
  }

  const allowedComponentNames = new Set([
    ...tdesignDirectComponentNames,
    ...tdesignSupportComponentNames
  ]);
  for (const [tag, componentPath] of Object.entries(registeredTdesignComponents)) {
    if (!tag.startsWith("t-")) {
      continue;
    }
    const componentName = tagComponentName(tag);
    if (!allowedComponentNames.has(componentName)) {
      fail(`pages.json registers unapproved TDesign component ${tag}`);
    }
    if (componentPath !== tdesignComponentPath(componentName)) {
      fail(`pages.json has an unexpected TDesign path for ${tag}: ${componentPath}`);
    }
  }

  const viteConfigSource = fs.existsSync(viteConfigPath)
    ? fs.readFileSync(viteConfigPath, "utf8")
    : "";
  if (
    !viteConfigSource.includes("tdesignPackageDistCandidates") ||
    !viteConfigSource.includes("workspaceRoot")
  ) {
    fail("Mini-program Vite build must resolve TDesign from hoisted workspace node_modules as well as package-local node_modules");
  }
  const copiedFolders = new Set(extractStringArrayConst(viteConfigSource, "tdesignComponentFoldersToCopy"));
  for (const tag of tdesignDisallowedSourceTags) {
    const folder = tagComponentName(tag);
    if (copiedFolders.has(folder)) {
      fail(`Vite TDesign copy list must not include disabled component ${folder}`);
    }
  }
  for (const folder of requiredTdesignFoldersForTags(usedTags)) {
    if (!copiedFolders.has(folder)) {
      fail(`Vite TDesign copy list must include ${folder}`);
    }
  }
  if (copiedFolders.has("miniprogram_npm")) {
    fail("Vite TDesign copy list must not copy the whole miniprogram_npm folder");
  }
  const copiedRuntimePaths = new Set(
    extractStringArrayConst(viteConfigSource, "tdesignRuntimePathsToCopy")
  );
  for (const runtimePath of tdesignRequiredRuntimePaths) {
    if (!copiedRuntimePaths.has(runtimePath)) {
      fail(`Vite TDesign runtime copy list must include ${runtimePath}`);
    }
  }

  assertNoNativeTdesignPrimitiveTags(appVueFiles);
  assertNoDirectFeedbackApis(sourceAppCodeFiles());

  const segmentedPropsPath = path.join(tdesignWxcomponentsPath, "segmented/props.js");
  const segmentedPropsSource = fs.existsSync(segmentedPropsPath)
    ? fs.readFileSync(segmentedPropsPath, "utf8")
    : "";
  if (!segmentedPropsSource.includes("options:{type:Array,value:[]}")) {
    fail("TDesign segmented local props must declare options as Array so native array bindings are accepted");
  }
}

function readEnv(file) {
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    values[key] = value;
  }
  return values;
}

function methodBody(source, name) {
  const patterns = [
    new RegExp(`async\\s+function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`async\\s+${name}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`${name}\\s*\\([^)]*\\)\\s*\\{`)
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match || match.index === undefined) {
      continue;
    }
    const start = match.index + match[0].length;
    let depth = 1;
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === "{") {
        depth += 1;
      } else if (source[i] === "}") {
        depth -= 1;
      }
      if (depth === 0) {
        return source.slice(start, i);
      }
    }
  }
  return "";
}

function callbackObjectBody(source, name) {
  const pattern = new RegExp(`${name}\\s*\\(\\s*\\(\\)\\s*=>\\s*\\(\\{([\\s\\S]*?)\\}\\)\\s*\\)`);
  return source.match(pattern)?.[1] || "";
}

function assertBefore(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex === -1 || secondIndex === -1 || firstIndex > secondIndex) {
    fail(message);
  }
}

function builtMainPackageSize(buildRoot) {
  const appJsonPath = path.join(buildRoot, "app.json");
  const appJson = fs.existsSync(appJsonPath) ? readJson(appJsonPath) : {};
  const subpackages = appJson.subPackages || appJson.subpackages || [];
  const subpackageRoots = subpackages
    .map((subpackage) => subpackage.root)
    .filter(Boolean)
    .map((subpackageRoot) => subpackageRoot.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);

  return walkFiles(buildRoot).reduce((total, file) => {
    const relative = path.relative(buildRoot, file).replaceAll(path.sep, "/");
    const isSubpackageFile = subpackageRoots.some(
      (subpackageRoot) => relative === subpackageRoot || relative.startsWith(`${subpackageRoot}/`)
    );
    return isSubpackageFile ? total : total + fs.statSync(file).size;
  }, 0);
}

function assertMinifiedEnabled(file, setting) {
  if (setting?.minified !== true) {
    fail(`${relativePath(file)} must enable setting.minified for WeChat JS compression`);
  }
  if (setting?.minifyWXML === true) {
    fail(
      `${relativePath(file)} must not enable setting.minifyWXML because WeChat DevTools Nightly crashes during WXML precompile`
    );
  }
}

function isDevelopmentApiBaseUrl(value) {
  return value === productionApiBaseUrl;
}

function assertMediaAssetsUnderLimit(rootDir, label, { skipDist = false } = {}) {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  for (const file of walkFiles(rootDir)) {
    const relative = path.relative(rootDir, file).replaceAll(path.sep, "/");
    if (skipDist && relative.startsWith("dist/")) {
      continue;
    }
    if (!localMediaPattern.test(file)) {
      continue;
    }
    const size = fs.statSync(file).size;
    if (size > localMediaLimitBytes) {
      fail(`${label} media asset exceeds 200 KB: ${relativePath(file)} (${formatSize(size)})`);
    }
  }
}

function assertFontAssetsUnderLimit(rootDir, label, { skipDist = false } = {}) {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  for (const file of walkFiles(rootDir)) {
    const relative = path.relative(rootDir, file).replaceAll(path.sep, "/");
    if (skipDist && relative.startsWith("dist/")) {
      continue;
    }
    if (!localFontPattern.test(file)) {
      continue;
    }
    const size = fs.statSync(file).size;
    if (size > localFontLimitBytes) {
      fail(`${label} font asset exceeds 200 KB: ${relativePath(file)} (${formatSize(size)})`);
    }
  }
}

function assertBrandFontAsset(rootDir, label) {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  const fontPath = path.join(rootDir, brandFontPath);
  if (!fs.existsSync(fontPath)) {
    fail(`${label} must include brand font asset: ${path.relative(root, fontPath)}`);
  }
}

function assertNoWebpAssets(rootDir, label) {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  for (const file of walkFiles(rootDir)) {
    if (/\.webp$/i.test(file)) {
      fail(`${label} must use JPG/PNG instead of WebP for Mini Program device compatibility: ${relativePath(file)}`);
    }
  }
}

function assertNoWebpStaticReferences(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  const sourcePattern = /\.(?:vue|js|ts|json|css|scss|wxss|wxml)$/i;
  for (const file of walkFiles(rootDir)) {
    if (!sourcePattern.test(file)) {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    if (/\/static\/[^"'`\s?]+\.webp/i.test(source)) {
      fail(`Source must reference JPG/PNG static assets instead of WebP: ${relativePath(file)}`);
    }
  }
}

function assertNoDcloudPreloadImageCode(rootDir, label) {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  for (const file of walkFiles(rootDir)) {
    if (!/\.js$/i.test(file)) {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    if (
      source.includes("shadow-grey.png") ||
      source.includes("__UNI_PRELOAD_SHADOW_IMAGE__") ||
      source.includes("wx.preloadAssets")
    ) {
      fail(`${label} must not include DCloud preload image code: ${relativePath(file)}`);
    }
  }
}

function assertBuiltTdesignUsingComponentPaths(buildRoot) {
  if (!fs.existsSync(buildRoot)) {
    return;
  }
  const builtAppJsonPath = path.join(buildRoot, "app.json");
  const globalUsingComponents = fs.existsSync(builtAppJsonPath)
    ? readJson(builtAppJsonPath).usingComponents || {}
    : {};
  for (const file of walkFiles(buildRoot)) {
    const relative = path.relative(buildRoot, file).replaceAll(path.sep, "/");
    if (
      !/\.json$/i.test(file) ||
      relative.startsWith("miniprogram_npm/") ||
      relative.startsWith("node_modules/")
    ) {
      continue;
    }
    const json = readJson(file);
    if (relative === "app.json") {
      for (const [tag, componentPath] of Object.entries(json.usingComponents || {})) {
        if (!tag.startsWith("t-") || !componentPath.includes(tdesignPackageName)) {
          continue;
        }
        const componentName = tagComponentName(tag);
        const componentBasePath = resolveBuiltComponentBasePath(buildRoot, file, componentPath);
        if (componentBasePath !== expectedBuiltTdesignComponentBasePath(buildRoot, componentName)) {
          fail(`Built app.json must register ${tag} from wxcomponents/tdesign-miniprogram`);
        }
        assertBuiltComponentFilesExist(buildRoot, file, componentPath, `Built app.json ${tag}`);
      }
      continue;
    }
    for (const tag of builtTdesignTagsForJson(file)) {
      const expectedPath = builtTdesignComponentPath(tagComponentName(tag));
      const componentPath = json.usingComponents?.[tag] || globalUsingComponents[tag];
      if (!componentPath) {
        fail(
          `Built ${relative} must register ${tag} locally or globally: ${expectedPath}`
        );
        continue;
      }
      const componentBasePath = resolveBuiltComponentBasePath(buildRoot, file, componentPath);
      if (componentBasePath !== expectedBuiltTdesignComponentBasePath(buildRoot, tagComponentName(tag))) {
        fail(`Built ${relative} must resolve ${tag} to ${expectedPath}`);
      }
      assertBuiltComponentFilesExist(buildRoot, file, componentPath, `Built ${relative} ${tag}`);
    }
    for (const [tag, componentPath] of Object.entries(json.usingComponents || {})) {
      if (!tag.startsWith("t-") || !componentPath.includes(tdesignPackageName)) {
        continue;
      }
      const expectedPath = builtTdesignComponentPath(tagComponentName(tag));
      const componentBasePath = resolveBuiltComponentBasePath(buildRoot, file, componentPath);
      if (componentBasePath !== expectedBuiltTdesignComponentBasePath(buildRoot, tagComponentName(tag))) {
        fail(
          `Built ${relative} must resolve ${tag} to ${expectedPath}`
        );
      }
      assertBuiltComponentFilesExist(buildRoot, file, componentPath, `Built ${relative} ${tag}`);
    }
  }
}

function assertTdesignTslibCompatShims(tdesignBuildRoot, label) {
  if (!fs.existsSync(tdesignBuildRoot)) {
    return;
  }
  for (const file of walkFiles(tdesignBuildRoot)) {
    if (!/\.js$/i.test(file) || /(?:^|\/)tslib\.js$/i.test(file.replaceAll(path.sep, "/"))) {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    if (!/\bfrom\s*["']tslib["']/.test(source)) {
      continue;
    }
    const shimPath = path.join(path.dirname(file), "tslib.js");
    if (!fs.existsSync(shimPath)) {
      fail(`${label} must include a tslib.js shim next to ${relativePath(file)}`);
    }
  }
}

if (!fs.existsSync(pagesJsonPath)) {
  fail("apps/miniprogram/src/pages.json is missing");
} else {
  let manifestJson = null;
  if (fs.existsSync(miniprogramProjectConfigPath)) {
    const projectConfig = readJson(miniprogramProjectConfigPath);
    assertMinifiedEnabled(miniprogramProjectConfigPath, projectConfig.setting);
    if (projectConfig.appid !== productionWechatAppId) {
      fail(`Miniprogram project.config.json must use appid ${productionWechatAppId}`);
    }
  }
  if (fs.existsSync(miniprogramPrivateProjectConfigPath)) {
    const privateProjectConfig = readJson(miniprogramPrivateProjectConfigPath);
    if (privateProjectConfig.appid && privateProjectConfig.appid !== productionWechatAppId) {
      fail("Miniprogram project.private.config.json must not override appid");
    }
  }
  if (fs.existsSync(srcProjectConfigPath)) {
    const srcProjectConfig = readJson(srcProjectConfigPath);
    assertMinifiedEnabled(srcProjectConfigPath, srcProjectConfig.setting);
    if (srcProjectConfig.appid !== productionWechatAppId) {
      fail(`Miniprogram src/project.config.json must use appid ${productionWechatAppId}`);
    }
    if (srcProjectConfig.miniprogramRoot) {
      fail("Miniprogram src/project.config.json must not set miniprogramRoot because DevTools opens the generated dist/dev/mp-weixin project directly");
    }
  }
  if (fs.existsSync(manifestJsonPath)) {
    manifestJson = readJson(manifestJsonPath);
    assertMinifiedEnabled(manifestJsonPath, manifestJson["mp-weixin"]?.setting);
    if (manifestJson["mp-weixin"]?.appid !== productionWechatAppId) {
      fail(`Miniprogram manifest must use appid ${productionWechatAppId}`);
    }
  }

  const pagesJson = readJson(pagesJsonPath);
  const pages = pagesJson.pages || [];
  assertTdesignMigrationConfig(pagesJson);

  if (manifestJson?.["mp-weixin"]?.lazyCodeLoading !== "requiredComponents") {
    fail('Miniprogram manifest must enable lazyCodeLoading: "requiredComponents" for component lazy injection');
  }

  assertMediaAssetsUnderLimit(miniprogramRoot, "Miniprogram project", { skipDist: true });
  assertMediaAssetsUnderLimit(miniprogramDevRoot, "Dev package");
  assertMediaAssetsUnderLimit(miniprogramBuildRoot, "Build package");
  assertFontAssetsUnderLimit(miniprogramRoot, "Miniprogram project", { skipDist: true });
  assertFontAssetsUnderLimit(miniprogramDevRoot, "Dev package");
  assertFontAssetsUnderLimit(miniprogramBuildRoot, "Build package");
  assertBrandFontAsset(srcRoot, "Miniprogram source");
  assertBrandFontAsset(miniprogramDevRoot, "Dev package");
  assertBrandFontAsset(miniprogramBuildRoot, "Build package");
  assertNoWebpAssets(path.join(srcRoot, "static"), "Miniprogram static assets");
  assertNoWebpStaticReferences(srcRoot);
  assertNoWebpAssets(miniprogramDevRoot, "Dev package");
  assertNoWebpAssets(miniprogramBuildRoot, "Build package");
  assertNoWebpStaticReferences(miniprogramDevRoot);
  assertNoWebpStaticReferences(miniprogramBuildRoot);
  assertNoDcloudPreloadImageCode(miniprogramDevRoot, "Dev package");
  assertNoDcloudPreloadImageCode(miniprogramBuildRoot, "Build package");

  for (const [packageRoot, packageLabel] of [
    [miniprogramDevRoot, "Dev package"],
    [miniprogramBuildRoot, "Build package"]
  ]) {
    if (!fs.existsSync(packageRoot)) {
      continue;
    }
    const builtAppJsonPath = path.join(packageRoot, "app.json");
    if (fs.existsSync(builtAppJsonPath)) {
      const builtAppJson = readJson(builtAppJsonPath);
      if (builtAppJson.lazyCodeLoading !== "requiredComponents") {
        fail(`${packageLabel} app.json must include lazyCodeLoading: "requiredComponents"`);
      }
    }
    assertBuiltTdesignUsingComponentPaths(packageRoot);
    assertTdesignTslibCompatShims(
      path.join(packageRoot, "node_modules/tdesign-miniprogram/miniprogram_dist"),
      `${packageLabel} TDesign node_modules package`
    );
    assertTdesignTslibCompatShims(
      path.join(packageRoot, "miniprogram_npm/tdesign-miniprogram"),
      `${packageLabel} TDesign miniprogram_npm package`
    );
    assertTdesignTslibCompatShims(
      path.join(packageRoot, "wxcomponents/tdesign-miniprogram"),
      `${packageLabel} TDesign wxcomponents package`
    );
  }

  if (fs.existsSync(miniprogramBuildRoot)) {
    const mainPackageSize = builtMainPackageSize(miniprogramBuildRoot);
    if (mainPackageSize > mainPackageLimitBytes) {
      fail(
        `Built main package exceeds 1.5 MB: ${formatSize(mainPackageSize)} in ${relativePath(miniprogramBuildRoot)}`
      );
    }
  }

  for (const page of pages) {
    const pagePath = typeof page === "string" ? page : page.path;
    const file = path.join(srcRoot, `${pagePath}.vue`);
    if (!fs.existsSync(file)) {
      fail(`Missing UniApp page file: ${file}`);
    }
  }

  for (const required of ["App.vue", "main.js", "manifest.json"]) {
    const file = path.join(srcRoot, required);
    if (!fs.existsSync(file)) {
      fail(`Missing UniApp source file: ${file}`);
    }
  }

  const pagePaths = pages.map((page) => (typeof page === "string" ? page : page.path));
  const firstFlowPages = [
    "pages/index/index",
    "pages/mine/index",
    "pages/session/create",
    "pages/session/script",
    "pages/session/role",
    "pages/session/setup",
    "pages/session/share"
  ];

  for (const firstFlowPage of firstFlowPages) {
    if (!pagePaths.includes(firstFlowPage)) {
      fail(`First creation flow page is not registered: ${firstFlowPage}`);
    }
  }
  if (pagePaths.includes("pages/session/apply")) {
    fail("Apply page must not be registered because the share page is the final role-selection page");
  }
  if (fs.existsSync(path.join(srcRoot, "pages/session/apply.vue"))) {
    fail("Apply page file should be removed because the share page is the final role-selection page");
  }

  const firstFlowFiles = {
    "entry page": path.join(srcRoot, "pages/index/index.vue"),
    "store step": path.join(srcRoot, "pages/session/create.vue"),
    "script step": path.join(srcRoot, "pages/session/script.vue"),
    "role step": path.join(srcRoot, "pages/session/role.vue"),
    "setup step": path.join(srcRoot, "pages/session/setup.vue"),
    "share step": path.join(srcRoot, "pages/session/share.vue")
  };

  for (const [label, file] of Object.entries(firstFlowFiles)) {
    if (!fs.existsSync(file)) {
      fail(`Missing first creation flow ${label}: ${file}`);
    }
  }

  const indexSource = fs.existsSync(firstFlowFiles["entry page"])
    ? fs.readFileSync(firstFlowFiles["entry page"], "utf8")
    : "";
  for (const requiredHomeEntryText of [
    "我的车局（点击登录）",
    "我的车局（点击创建）",
    "近期车局"
  ]) {
    if (!indexSource.includes(requiredHomeEntryText)) {
      fail(`Entry page must support the D40 shared calendar UI: ${requiredHomeEntryText}`);
    }
  }
  for (const requiredHomeRoutingText of [
    "SessionCalendar",
    "ensureLoggedIn",
    "getCurrentUser",
    "getToken",
    "loadHomeCalendar",
    "loadGuestSessions",
    "/api/sessions/public/upcoming?limit=20",
    "/api/users/me/sessions?limit=50",
    "/api/users/me/signups",
    'calendarMode = computed(() => (isAuthenticated.value ? "member" : "guest"))'
  ]) {
    if (!indexSource.includes(requiredHomeRoutingText)) {
      fail(`Entry page must support D40 shared calendar routing: ${requiredHomeRoutingText}`);
    }
  }
  for (const retiredHomeToken of ["发起第一辆车", "first-session", "startFirstSession", "homeState"]) {
    if (indexSource.includes(retiredHomeToken)) {
      fail(`Entry page must remove the retired first-session state: ${retiredHomeToken}`);
    }
  }
  for (const requiredMaintenanceText of [
    "backendStatus.maintenance",
    "服务正在上线维护中",
    "我们正在准备后端服务，稍后会自动恢复。",
    "retryBackend",
    "startMaintenancePolling",
    "stopMaintenancePolling",
    "BACKEND_STATUS_CHANGE_EVENT",
    "checkBackendHealth"
  ]) {
    if (!indexSource.includes(requiredMaintenanceText)) {
      fail(`Entry page maintenance mode is missing ${requiredMaintenanceText}`);
    }
  }
  if (!/<view v-if="backendStatus\.maintenance" class="maintenance-state">/.test(indexSource)) {
    fail("Entry page must render a dedicated maintenance state before normal homepage content");
  }
  if (!/<view v-else class="home-normal">/.test(indexSource)) {
    fail("Entry page must hide normal homepage content while maintenance mode is active");
  }
  if (!indexSource.includes("buildVersion") || !indexSource.includes("__PINCHE_BUILD_TIME__")) {
    fail("Entry page must display the injected build-time version label");
  }
  if (!/<view class="build-version">\{\{ buildVersion \}\}<\/view>/.test(indexSource)) {
    fail("Entry page must render the build-time version label on the first screen");
  }
  if (!indexSource.includes('menus: ["shareAppMessage", "shareTimeline"]')) {
    fail("Entry page share menu must enable both friend/group and Moments sharing");
  }
  if (!indexSource.includes("showHomeShareMenus")) {
    fail("Entry page must enable the WeChat share menu when it loads or becomes visible");
  }
  const homeShareAppMessageSource = callbackObjectBody(indexSource, "onShareAppMessage");
  if (!homeShareAppMessageSource) {
    fail("Entry page must support friend/group sharing with onShareAppMessage");
  }
  if (!homeShareAppMessageSource.includes("path: HOME_SHARE_PATH")) {
    fail("Entry page friend/group sharing must open the home page path");
  }
  if (!homeShareAppMessageSource.includes("imageUrl: HOME_SHARE_IMAGE")) {
    fail("Entry page friend/group sharing must use the home landscape share image");
  }
  const homeShareTimelineSource = callbackObjectBody(indexSource, "onShareTimeline");
  if (!homeShareTimelineSource) {
    fail("Entry page must support WeChat Moments sharing with onShareTimeline");
  }
  if (!homeShareTimelineSource.includes('query: ""')) {
    fail("Entry page Moments sharing must return an empty home-page query");
  }
  if (homeShareTimelineSource.includes("path:")) {
    fail("Entry page Moments sharing must use query instead of path");
  }
  if (!homeShareTimelineSource.includes("imageUrl: HOME_SHARE_IMAGE")) {
    fail("Entry page Moments sharing must use the home landscape share image");
  }
  const maintenanceArtPath = path.join(srcRoot, "static/art/maintenance-landscape.jpg");
  if (!fs.existsSync(maintenanceArtPath)) {
    fail("Entry page maintenance state must have a dedicated complete art asset: static/art/maintenance-landscape.jpg");
  }
  if (!indexSource.includes('/static/art/maintenance-landscape.jpg')) {
    fail("Entry page maintenance state must use the dedicated maintenance landscape art asset");
  }
  if (/class="maintenance-art"\s+src="\/static\/art\/ticket-landscape\.(?:webp|jpe?g|png)"/.test(indexSource)) {
    fail("Entry page maintenance state must not reuse the ticket footer landscape art asset");
  }
  if (!indexSource.includes("<AuthIdentityBar passive-guest")) {
    fail("Entry page identity bar must stay in passive guest mode before users choose login");
  }
  if (!indexSource.includes('@guest-login="loginFromGuestBar"')) {
    fail("Entry page passive guest identity bar must allow users to login from the bar");
  }
  const loadGuestSessionsSource = methodBody(indexSource, "loadGuestSessions");
  if (!loadGuestSessionsSource.includes("/api/sessions/public/upcoming?limit=20")) {
    fail("Entry page guest mode must load the anonymous D40 upcoming-session feed");
  }
  if (loadGuestSessionsSource.includes("ensureLoggedIn")) {
    fail("Entry page guest calendar loading must not request login");
  }
  const handleCreateActionSource = methodBody(indexSource, "handleCreateAction");
  if (
    !handleCreateActionSource.includes("loginFromIdentityAction") ||
    !handleCreateActionSource.includes("goCreate")
  ) {
    fail("Entry page primary action must login guests and enter creation only for members");
  }
  const loginFromGuestBarSource = methodBody(indexSource, "loginFromGuestBar");
  if (!loginFromGuestBarSource.includes("loginFromIdentityAction")) {
    fail("Entry page passive guest identity bar must request login when tapped");
  }
  if (loginFromGuestBarSource.includes("goCreate")) {
    fail("Entry page passive guest identity bar must login without entering creation directly");
  }
  const goCreateSource = methodBody(indexSource, "goCreate");
  assertBefore(
    goCreateSource,
    "clearCreateFlow",
    "uni.navigateTo",
    "Entry page calendar 发车 button must start a fresh create flow before navigating"
  );
  const mineSource = fs.existsSync(path.join(srcRoot, "pages/mine/index.vue"))
    ? fs.readFileSync(path.join(srcRoot, "pages/mine/index.vue"), "utf8")
    : "";
  const appVueSource = fs.existsSync(path.join(srcRoot, "App.vue"))
    ? fs.readFileSync(path.join(srcRoot, "App.vue"), "utf8")
    : "";
  const d33CreateSource = fs.existsSync(path.join(srcRoot, "pages/session/create.vue"))
    ? fs.readFileSync(path.join(srcRoot, "pages/session/create.vue"), "utf8")
    : "";
  const d33ScriptSource = fs.existsSync(path.join(srcRoot, "pages/session/script.vue"))
    ? fs.readFileSync(path.join(srcRoot, "pages/session/script.vue"), "utf8")
    : "";
  const d33AdminCatalogSource = fs.existsSync(path.join(srcRoot, "pages/admin/catalog.vue"))
    ? fs.readFileSync(path.join(srcRoot, "pages/admin/catalog.vue"), "utf8")
    : "";
  for (const requiredD33PrivateCatalogText of [
    "submitPrivateStore",
    "没有找到？添加一个店家",
    "storeBadge",
    "submitPrivateScript",
    "没有找到？添加一个剧本",
    "scriptBadge",
    "/api/catalog-review-items/mine",
    "我的资料提交",
    "submitCatalogEdit",
    "/api/admin/catalog-review-items",
    "待审核资料",
    "/approve",
    "/needs-changes",
    "/reject",
    "/merge"
  ]) {
    const combinedD33Source = `${d33CreateSource}\n${d33ScriptSource}\n${mineSource}\n${d33AdminCatalogSource}`;
    if (!combinedD33Source.includes(requiredD33PrivateCatalogText)) {
      fail(`D33 private catalog review mini-program flow is missing ${requiredD33PrivateCatalogText}`);
    }
  }
  const sessionCalendarPath = path.join(srcRoot, "components/SessionCalendar.vue");
  if (!fs.existsSync(sessionCalendarPath)) {
    fail("D22 must extract the shared session calendar component: components/SessionCalendar.vue");
  }
  const sessionCalendarSource = fs.existsSync(sessionCalendarPath)
    ? fs.readFileSync(sessionCalendarPath, "utf8")
    : "";
  const sessionCalendarStripePath = path.join(srcRoot, "utils/sessionCalendarStripe.js");
  if (!fs.existsSync(sessionCalendarStripePath)) {
    fail("Session calendar stripe helper must exist: utils/sessionCalendarStripe.js");
  }
  const sessionCalendarStripeSource = fs.existsSync(sessionCalendarStripePath)
    ? fs.readFileSync(sessionCalendarStripePath, "utf8")
    : "";
  if (sessionCalendarSource.includes("{{ totalCount }} 场车局")) {
    fail("Session calendar hero must not repeat total count; the filter tabs already show counts");
  }
  for (const forbiddenCalendarHeaderCopy of [
    "calendarUpdatedText",
    "hero-subtitle",
    "hero-copy",
    "showLogoutButton",
    "show-logout-button",
    "<t-icon",
    ">退出</t-button>",
    ">管理员</t-button>"
  ]) {
    if (sessionCalendarSource.includes(forbiddenCalendarHeaderCopy)) {
      fail(`Session calendar action bar must not keep redundant header copy or logout controls: ${forbiddenCalendarHeaderCopy}`);
    }
  }
  if (indexSource.includes("show-logout-button") || mineSource.includes("show-logout-button")) {
    fail("Session calendar callers must not render a page-header logout button; logout lives in the identity bar");
  }
  if (
    !indexSource.includes(':create-button-label="createButtonLabel"') ||
    !indexSource.includes('isAuthenticated.value ? "我的车局（点击创建）" : "我的车局（点击登录）"')
  ) {
    fail("Entry calendar primary action must switch between the D40 guest and member labels");
  }
  for (const requiredCompactCalendarActionBar of [
    'v-if="showCalendarActions"',
    "calendar-action-bar",
    "showCalendarActions",
    "primary-action-inner",
    "admin-icon-button",
    "admin-action-icon",
    "min-height: 92rpx",
    "width: 92rpx",
    'src="/static/icons/settings-light.svg"',
    'aria-label="归位到今天"',
    'src="/static/icons/return-green.svg"',
    'aria-label="选择日期"',
    'src="/static/icons/calendar-green.svg"',
    "linear-gradient(145deg, #2d8069 0%, #1f6f5b 100%)",
    'src="/static/icons/user-plus-white.png"'
  ]) {
    if (!sessionCalendarSource.includes(requiredCompactCalendarActionBar)) {
      fail(`Session calendar must keep the compact action bar layout: ${requiredCompactCalendarActionBar}`);
    }
  }
  for (const requiredAlignedCalendarControls of [
    "height: 64rpx; box-sizing: border-box",
    "grid-template-columns: minmax(0, 1fr) 216rpx",
    "align-items: stretch",
    "height: 64rpx",
    "line-height: 64rpx",
    "--td-segmented-item-label-font: 600 23rpx / 52rpx sans-serif"
  ]) {
    if (!sessionCalendarSource.includes(requiredAlignedCalendarControls)) {
      fail(`Session calendar top controls must be visually aligned: ${requiredAlignedCalendarControls}`);
    }
  }
  for (const requiredCalendarSegmentedGlobalStyle of [
    "height: 52rpx !important",
    "font-size: 23rpx !important",
    "border-radius: 10rpx !important"
  ]) {
    if (!appVueSource.includes(requiredCalendarSegmentedGlobalStyle)) {
      fail(`Calendar segmented global style must align with the top buttons: ${requiredCalendarSegmentedGlobalStyle}`);
    }
  }
  for (const forbiddenPillButtonSelector of [
    ".primary-quiet-button",
    ".admin-icon-button",
    ".today-reset-button"
  ]) {
    const escapedSelector = forbiddenPillButtonSelector.replace(".", "\\.");
    if (
      new RegExp(`${escapedSelector}(?:\\s*,[^\\{]+)?\\s*\\{[^}]*border-radius:\\s*999rpx`).test(
        sessionCalendarSource
      )
    ) {
      fail(`Session calendar header controls must use rounded-square buttons, not pill buttons: ${forbiddenPillButtonSelector}`);
    }
  }
  if (
    !sessionCalendarSource.includes('v-if="item.canManage"') ||
    !sessionCalendarSource.includes('@tap.stop="goManage(item.sessionId)"') ||
    !(
      sessionCalendarSource.includes(">管理</button>") ||
      sessionCalendarSource.includes(">管理</t-button>")
    )
  ) {
    fail("Session calendar cards must expose a direct management button when the user can manage the session");
  }
  if (!sessionCalendarSource.includes("item.canManage = item.isOrganized")) {
    fail("Session calendar management button must only appear for sessions the user organizes");
  }
  const calendarActionSource = methodBody(sessionCalendarSource, "handleCalendarAction");
  const calendarShareSource = methodBody(sessionCalendarSource, "goShare");
  if (!calendarShareSource.includes("/pages/session/share?id=")) {
    fail("Session calendar must expose share-page navigation for pre-start organized cards");
  }
  if (!calendarActionSource.includes("goShare(item.sessionId)")) {
    fail("Pre-start organized calendar card taps must open the share page");
  }
  if (
    !calendarActionSource.includes('item.type === "city"') ||
    !calendarActionSource.includes("goDetail(item.sessionId)")
  ) {
    fail("D38 city calendar card taps must open the session detail page");
  }
  for (const forbiddenCalendarCardAction of [
    "goManage(item.sessionId)",
    "goReview(item.sessionId)"
  ]) {
    if (calendarActionSource.includes(forbiddenCalendarCardAction)) {
      fail(`Calendar card primary tap must only choose album-or-share navigation, not ${forbiddenCalendarCardAction}`);
    }
  }
  for (const requiredCalendarStripeText of [
    ':class="item.stripeTone"',
    "calendarStripeTone",
    ".session-stripe.amber",
    ".session-stripe.green",
    ".session-stripe.red",
    "import { sessionCalendarStripeTone }",
    "return sessionCalendarStripeTone({"
  ]) {
    if (!sessionCalendarSource.includes(requiredCalendarStripeText)) {
      fail(`Session calendar stripe must use traffic-light session status colors: ${requiredCalendarStripeText}`);
    }
  }
  for (const requiredCalendarStripeTone of ['"green"', '"amber"', '"red"']) {
    if (!sessionCalendarStripeSource.includes(requiredCalendarStripeTone)) {
      fail(`Session calendar stripe helper must preserve traffic-light tone: ${requiredCalendarStripeTone}`);
    }
  }
  if (sessionCalendarSource.includes(".session-row.joined .session-stripe")) {
    fail("Session calendar stripe must represent car state, not joined/organized identity");
  }
  for (const forbiddenSessionCalendarWxssSelector of [
    ".load-more text",
    "button::after"
  ]) {
    if (sessionCalendarSource.includes(forbiddenSessionCalendarWxssSelector)) {
      fail(`SessionCalendar component wxss must not use unsupported tag selectors: ${forbiddenSessionCalendarWxssSelector}`);
    }
  }
  for (const requiredSessionCalendarSegmentedSafety of [
    ':options="safeVisibleFilterSegmentOptions"',
    "safeVisibleFilterSegmentOptions",
    "Array.isArray(visibleFilterSegmentOptions.value)"
  ]) {
    if (!sessionCalendarSource.includes(requiredSessionCalendarSegmentedSafety)) {
      fail(`SessionCalendar segmented options must always pass an array: ${requiredSessionCalendarSegmentedSafety}`);
    }
  }
  const sessionCalendarFilterTabsSource =
    sessionCalendarSource.match(/const filterTabs = computed\(\(\) =>[\s\S]*?\n\);/)?.[0] || "";
  for (const requiredCalendarFilterTab of [
    '{ value: "guest", label: "近期车局", count: guestCalendarItems.value.length }',
    '{ value: "mine", label: "我的", count: mineCalendarItems.value.length }',
    '{ value: "city", label: "同城", count: cityCalendarItems.value.length }'
  ]) {
    if (!sessionCalendarFilterTabsSource.includes(requiredCalendarFilterTab)) {
      fail(`D38 session calendar must expose the fixed discovery filters: ${requiredCalendarFilterTab}`);
    }
  }
  for (const legacyCalendarFilter of ['label: "全部"', 'value: "organized"', 'value: "pending"']) {
    if (sessionCalendarFilterTabsSource.includes(legacyCalendarFilter)) {
      fail(`D38 session calendar must remove the legacy filter: ${legacyCalendarFilter}`);
    }
  }
  if (!mineSource.includes("SessionCalendar")) {
    fail("Mine page must reuse the shared SessionCalendar component");
  }
  if (/onLoad\s*\(\s*async\s*\(\)\s*=>\s*\{[\s\S]*ensureLoggedIn\s*\(/.test(mineSource)) {
    fail("Mine page must wait for an explicit login tap before requesting login");
  }
  if (!mineSource.includes("getToken")) {
    fail("Mine page must include token state when deciding whether to load private sessions");
  }
  if (/hasLogin\.value\s*=\s*Boolean\(\s*auth\.user\s*\)/.test(mineSource)) {
    fail("Mine page must not treat cached user data without token as a logged-in session");
  }
  const mineLoginSource = methodBody(mineSource, "login");
  if (mineLoginSource.includes("promptPhoneAfterLogin: true")) {
    fail("Mine page login must not request phone authorization before a protected action");
  }
  const mineLogoutSource = methodBody(mineSource, "logout");
  if (!mineLogoutSource.includes("goHomeAfterLogout")) {
    fail("Mine page logout must relaunch the home entry after clearing auth");
  }

  const createSource = fs.existsSync(firstFlowFiles["store step"])
    ? fs.readFileSync(firstFlowFiles["store step"], "utf8")
    : "";
  for (const forbiddenText of [
    "补贴",
    "押金",
    "座位与实付",
    "补充资料申请",
    "发布车"
  ]) {
    if (createSource.includes(forbiddenText)) {
      fail(`Store selection step still contains unrelated creation responsibility: ${forbiddenText}`);
    }
  }
  if (
    !/selectStore\(store\)\s*\{[\s\S]*this\.isSelectedStore\(store\)[\s\S]*this\.goNext\(\);[\s\S]*return;[\s\S]*writeCreateFlow\(\{ store, script: null, role: null \}\);/.test(createSource)
  ) {
    fail("Store selection should confirm and continue when tapping the selected store again");
  }
  const selectStoreSource = methodBody(createSource, "selectStore");
  const createGoNextSource = methodBody(createSource, "goNext");
  if (createSource.includes("ensureCreateStepLogin") || selectStoreSource.includes("ensureLoggedIn")) {
    fail("Store selection must be browsable before login");
  }
  if (createGoNextSource.includes("ensureLoggedIn")) {
    fail("Store next button must let users continue browsing before login");
  }
  for (const requiredD34StoreLocationText of [
    "latitude: \"\"",
    "longitude: \"\"",
    "地图选点",
    "pickStoreLocation",
    "uni.chooseLocation",
    "storeForm.latitude",
    "storeForm.longitude",
    "latitude: this.storeForm.latitude",
    "longitude: this.storeForm.longitude"
  ]) {
    if (!createSource.includes(requiredD34StoreLocationText)) {
      fail(`D34 store location create flow is missing ${requiredD34StoreLocationText}`);
    }
  }
  if (createSource.includes("uni.getLocation") || createSource.includes("wx.getLocation")) {
    fail("D34 store location flow must not read current user location");
  }
  const mpWeixinConfig = manifestJson?.["mp-weixin"] || {};
  if (
    !mpWeixinConfig.permission?.["scope.userLocation"]?.desc?.includes("剧本店位置") ||
    !mpWeixinConfig.permission?.["scope.userLocation"]?.desc?.includes("同城")
  ) {
    fail("Location permission copy must explain store selection and D38 city discovery");
  }
  if (!mpWeixinConfig.requiredPrivateInfos?.includes("chooseLocation")) {
    fail("D34 store location manifest must declare chooseLocation in requiredPrivateInfos");
  }
  if (!mpWeixinConfig.requiredPrivateInfos?.includes("getLocation")) {
    fail("D38 city discovery manifest must declare getLocation");
  }

  const scriptSource = fs.existsSync(firstFlowFiles["script step"])
    ? fs.readFileSync(firstFlowFiles["script step"], "utf8")
    : "";
  if (
    !/selectScript\(script\)\s*\{[\s\S]*this\.isSelectedScript\(script\)[\s\S]*this\.goNext\(\);[\s\S]*return;[\s\S]*writeCreateFlow\(\{ script, role: null \}\);/.test(scriptSource)
  ) {
    fail("Script selection should confirm and continue when tapping the selected script again");
  }
  const selectScriptSource = methodBody(scriptSource, "selectScript");
  const scriptGoNextSource = methodBody(scriptSource, "goNext");
  if (scriptSource.includes("ensureScriptStepLogin") || selectScriptSource.includes("ensureLoggedIn")) {
    fail("Script selection must be browsable before login");
  }
  if (scriptGoNextSource.includes("ensureLoggedIn")) {
    fail("Script next button must let users continue browsing before login");
  }

  const shareSource = fs.existsSync(firstFlowFiles["share step"])
    ? fs.readFileSync(firstFlowFiles["share step"], "utf8")
    : "";
  const shareLightIconPath = path.join(srcRoot, "static/icons/share-light.svg");
  const shareLightIconSource = fs.existsSync(shareLightIconPath)
    ? fs.readFileSync(shareLightIconPath, "utf8")
    : "";
  const sharedRoleSeatBoardSourceForShare = fs.existsSync(
    path.join(srcRoot, "components/RoleSeatBoard.vue")
  )
    ? fs.readFileSync(path.join(srcRoot, "components/RoleSeatBoard.vue"), "utf8")
    : "";
  for (const requiredShareText of ["角色状态", "可选", "已选", "换选"]) {
    if (!shareSource.includes(requiredShareText)) {
      fail(`Share page must let invited players inspect and choose open roles: ${requiredShareText}`);
    }
  }
  for (const requiredWechatShareStyle of [
    'src="/static/icons/share-light.svg"',
    'custom-style="height: 88rpx; min-height: 88rpx; border-color: #1a5d4d; background: linear-gradient(145deg, #1a5d4d 0%, #2b765f 100%); color: #ffffff;',
    'width="48rpx"',
    'height="48rpx"',
    'custom-style="width: 48rpx; height: 48rpx; opacity: 0.82;"',
    ".wechat-action {",
    "background: linear-gradient(145deg, #1a5d4d 0%, #2b765f 100%)",
    "color: #ffffff",
    ".wechat-action .button-icon",
    "width: 48rpx",
    "opacity: 0.82"
  ]) {
    if (!shareSource.includes(requiredWechatShareStyle)) {
      fail(`Share page bottom action must use a green background, white text, and larger light share icon: ${requiredWechatShareStyle}`);
    }
  }
  if (shareSource.includes('src="/static/icons/wechat.png"')) {
    fail("Share page bottom action must use a share icon instead of the WeChat icon");
  }
  for (const requiredShareIconShape of [
    '<circle cx="34" cy="64"',
    '<circle cx="84" cy="36"',
    '<circle cx="88" cy="92"',
    'd="M45 59L73 43M46 70L76 86"'
  ]) {
    if (!shareLightIconSource.includes(requiredShareIconShape)) {
      fail(`Share light icon must be a three-node share symbol, not an upload symbol: ${requiredShareIconShape}`);
    }
  }
  if (/M36 74v18|M72 22v58|M48 46l24-24 24 24/.test(shareLightIconSource)) {
    fail("Share light icon must not contain upload arrow/tray paths");
  }
  for (const forbiddenSelectedLabelSource of [
    shareSource,
    fs.existsSync(path.join(srcRoot, "pages/session/role.vue"))
      ? fs.readFileSync(path.join(srcRoot, "pages/session/role.vue"), "utf8")
      : "",
    fs.existsSync(path.join(srcRoot, "pages/session/detail.vue"))
      ? fs.readFileSync(path.join(srcRoot, "pages/session/detail.vue"), "utf8")
      : ""
  ]) {
    if (/\?\s*"我选"/.test(forbiddenSelectedLabelSource)) {
      fail("Selected role cards must not render the redundant 我选 state label");
    }
  }
  if (shareSource.includes('class="button role-action"') || shareSource.includes("role-action")) {
    fail("Share page must not render a separate confirm role button; tapping a role card should act directly");
  }
  if (shareSource.includes(">确认选择<") || shareSource.includes('"确认选择"')) {
    fail("Share page must not show legacy confirm selection copy");
  }
  for (const requiredSwitchingText of [
    "switchingCount",
    'stateKind === "switching"',
    ".role-choice.switching"
  ]) {
    const switchingSource = requiredSwitchingText.startsWith(".role-choice")
      ? sharedRoleSeatBoardSourceForShare
      : shareSource;
    if (!switchingSource.includes(requiredSwitchingText)) {
      fail(`Share page must distinguish switching roles from current roles: ${requiredSwitchingText}`);
    }
  }
  const shareButtonCount = (shareSource.match(/open-type="share"/g) || []).length;
  if (shareButtonCount !== 1) {
    fail(`Share page must keep a single share button, found ${shareButtonCount}`);
  }
  if (!shareSource.includes("分享给好友或群聊")) {
    fail("Share page must use one combined friend/group share button");
  }
  for (const requiredShareSeatAvatarText of [
    "confirmedUserAvatarUrl: seat.confirmed_user_avatar_url || \"\"",
    "confirmedUserGender: seat.confirmed_user_gender || \"\"",
    "confirmedUserName: seat.confirmed_user_nickname || seat.confirmed_user_open_id || \"\"",
    "note: this.roleOccupantDisplayName(role)",
    "avatarUrl: this.roleOccupantAvatarUrl(role)",
    "avatarGender: this.roleOccupantGender(role)",
    "ownerGender: this.roleOccupantGender(role)"
  ]) {
    if (!shareSource.includes(requiredShareSeatAvatarText)) {
      fail(`Share page must pass selected seat avatars into role cards: ${requiredShareSeatAvatarText}`);
    }
  }
  if (shareSource.includes("note: seat.role_name || this.seatTypeLabel(seat.seat_type)")) {
    fail("Share page role cards must not repeat the role name as the secondary line");
  }
  for (const requiredShareNpcAvatarText of [
    "currentUserEffectiveNpcRole",
    "const effectiveCurrentNpcRole = this.currentUserEffectiveNpcRole",
    "const duplicateCurrentUserNpcRole = boundByCurrentUser && !mine",
    "const effectiveBoundUserId = duplicateCurrentUserNpcRole ? 0 : boundUserId",
    "const taken = effectiveBoundUserId > 0 || effectivePendingUserId > 0",
    "note: this.npcRoleOccupantDisplayName(displayRole, mine, pendingMine)",
    "avatarUrl: this.npcRoleOccupantAvatarUrl(displayRole, mine, pendingMine)",
    "avatarGender: this.npcRoleOccupantGender(displayRole, mine, pendingMine)",
    "ownerGender: this.npcRoleOccupantGender(displayRole, mine, pendingMine)",
    "crossCast: (mine || pendingMine) && isCrossCast(this.currentUserGender, role.role_gender)"
  ]) {
    if (!shareSource.includes(requiredShareNpcAvatarText)) {
      fail(`Share page must pass NPC role avatars into role cards: ${requiredShareNpcAvatarText}`);
    }
  }
  if (
    !/class="ticket-mountains"[\s\S]*src="\/static\/art\/ticket-landscape\.jpg"[\s\S]*mode="aspectFill"[\s\S]*width="100%"[\s\S]*height="72rpx"[\s\S]*custom-style="width: 100%; height: 72rpx;"/.test(
      shareSource
    )
  ) {
    fail("Share ticket landscape art must use a fixed-height crop instead of expanding the card");
  }
  if (!/\.ticket-card\s*\{[\s\S]*padding:\s*42rpx 42rpx 48rpx;/.test(shareSource)) {
    fail("Share ticket card must stay compact with note-height bottom spacing");
  }
  if (!/\.ticket-mountains\s*\{[\s\S]*bottom:\s*-12rpx;[\s\S]*height:\s*72rpx;/.test(shareSource)) {
    fail("Share ticket landscape art must stay about as tall as the note row");
  }
  if (!shareSource.includes('<view class="share-role-board">\n      <RoleSeatBoard')) {
    fail("Share page must wrap the role board so card spacing survives mini-program component compilation");
  }
  if (!/\.share-role-board\s*\{[\s\S]*margin-top:\s*24rpx;/.test(shareSource)) {
    fail("Share page must keep visible breathing room between the ticket and role cards");
  }
  const shareTimelineSource = methodBody(shareSource, "onShareTimeline");
  if (!shareTimelineSource) {
    fail("Share page must support WeChat Moments sharing with onShareTimeline");
  }
  if (!shareTimelineSource.includes("query:")) {
    fail("Share page Moments sharing must return a query for the current share page route");
  }
  if (!shareTimelineSource.includes("title: this.timelineShareTitle()")) {
    fail("Share page Moments sharing must use a dedicated attractive timeline title");
  }
  const shareAppMessageSource = methodBody(shareSource, "onShareAppMessage");
  if (!shareAppMessageSource.includes("title: this.shareCardTitle()")) {
    fail("Share page friend/group sharing must use the shared session title with script, store, and time");
  }
  const shareCardTitleSource = methodBody(shareSource, "shareCardTitle");
  if (
    !shareCardTitleSource.includes("this.scriptName") ||
    !shareCardTitleSource.includes("this.storeName") ||
    !shareCardTitleSource.includes("this.startText")
  ) {
    fail("Share page title copy must include script name, store, and time");
  }
  const timelineShareTitleSource = methodBody(shareSource, "timelineShareTitle");
  if (
    !timelineShareTitleSource.includes("this.scriptName") ||
    !timelineShareTitleSource.includes("this.storeName") ||
    !timelineShareTitleSource.includes("this.startText")
  ) {
    fail("Share page Moments copy must include script name, store, and time");
  }
  if (!shareSource.includes("timelineShareTitle")) {
    fail("Share page must keep Moments copy separate from friend/group share copy");
  }
  if (!shareSource.includes("还差") || !shareSource.includes("沉浸一局")) {
    fail("Share page Moments copy must read like an inviting carpool pitch");
  }
  if (shareTimelineSource.includes("path:")) {
    fail("Share page Moments sharing must use query instead of path");
  }
  if (!shareSource.includes('menus: ["shareAppMessage", "shareTimeline"]')) {
    fail("Share page share menu must enable both friend/group and Moments sharing");
  }
  for (const requiredFinalShareText of ["claimSeat", "/api/signups", "loadPublishedSession"]) {
    if (!shareSource.includes(requiredFinalShareText)) {
      fail(`Share page must be the final role-selection page: ${requiredFinalShareText}`);
    }
  }
  for (const requiredAlbumEntryText of [
    "entry",
    "isAlbumEntry",
    "redirectAlbumMemberIfNeeded",
    "/pages/session/album?id=",
    "join_policy",
    "/api/session-seats/${seatId}/claim",
    "join_result",
    "已提交申请，等待车头审核"
  ]) {
    if (!shareSource.includes(requiredAlbumEntryText)) {
      fail(`Share page must support D23 album-entry join flow: ${requiredAlbumEntryText}`);
    }
  }
  const claimSeatSource = methodBody(shareSource, "claimSeat");
  if (!claimSeatSource.includes('this.session.join_policy === "direct"')) {
    fail("Share page album entry must branch direct join by session.join_policy");
  }
  assertBefore(
    claimSeatSource,
    'this.session.join_policy === "direct"',
    'url: "/api/signups"',
    "Share page must try direct claim before falling back to review signup"
  );
  if (/onLoad\s*\(\s*options\s*\)\s*\{\s*const auth = await ensureLoggedIn\s*\(/.test(shareSource)) {
    fail("Share page must let invited users browse before login");
  }
  if (!/async confirmRole\(role = null, options = \{\}\)\s*\{[\s\S]*ensureSeatSelectionLogin\s*\(/.test(shareSource)) {
    fail("Share page must require login before applying a role selection");
  }
  const shareChooseRoleSource = methodBody(shareSource, "chooseRole");
  const shareChooseNpcRoleSource = methodBody(shareSource, "chooseNpcRole");
  const shareConfirmRoleSource = methodBody(shareSource, "confirmRole");
  const shareConfirmSwitchRoleSource = methodBody(shareSource, "confirmSwitchRole");
  const shareCurrentSelectionForSwitchSource = methodBody(shareSource, "currentSelectionForSwitch");
  const shareOnLoadSource = methodBody(shareSource, "onLoad");
  const refreshCurrentUserGenderSource = methodBody(shareSource, "refreshCurrentUserGender");
  const clearSeatSelectionWhenLoggedOutSource = methodBody(shareSource, "clearSeatSelectionWhenLoggedOut");
  if (!shareSource.includes("clearSeatSelectionWhenLoggedOut")) {
    fail("Share page must clear pending role selection when the user is logged out");
  }
  if (!refreshCurrentUserGenderSource.includes("clearSeatSelectionWhenLoggedOut")) {
    fail("Share page auth refresh must clear pending role selection when logged out");
  }
  if (!clearSeatSelectionWhenLoggedOutSource.includes("this.pendingRole = null")) {
    fail("Share page logged-out cleanup must clear pending role selection");
  }
  if (!clearSeatSelectionWhenLoggedOutSource.includes('this.confirmedCrossCastRoleKey = ""')) {
    fail("Share page logged-out cleanup must clear cross-cast confirmation state");
  }
  if (!shareOnLoadSource.includes("seatRole && this.currentUserId && !seatRole.taken")) {
    fail("Share page must not preselect a shared seat before login");
  }
  assertBefore(
    shareChooseRoleSource,
    "ensureSeatSelectionLogin",
    "confirmCrossCastRole",
    "Share role selection must not show cross-cast confirmation before login"
  );
  assertBefore(
    shareChooseRoleSource,
    "ensureSeatSelectionLogin",
    "confirmRole(targetRole",
    "Share role selection must not apply a role before login"
  );
  assertBefore(
    shareConfirmRoleSource,
    "ensureSeatSelectionLogin",
    "claimSeat",
    "Share role application must request login before claiming a role"
  );
  assertBefore(
    shareConfirmRoleSource,
    "ensureSeatSelectionLogin",
    "this.role = targetRole",
    "Share role application must request login before updating local role state"
  );
  if (!shareConfirmRoleSource.includes("requirePhone: this.joinRequiresPhone")) {
    fail("Share role application must use the session phone setting before claiming a role");
  }
  assertBefore(
    shareConfirmRoleSource,
    "requirePhone: this.joinRequiresPhone",
    "claimSeat",
    "Share role application must apply the session phone setting before claiming a role"
  );
  if (
    !/async chooseRole\(role\)\s*\{[\s\S]*ensureSeatSelectionLogin[\s\S]*confirmCrossCastRole[\s\S]*await this\.confirmRole\(targetRole,\s*\{[\s\S]*revealPending: !this\.sessionId[\s\S]*\}\);/.test(shareSource)
  ) {
    fail("Share role selection should apply immediately after tapping a role card");
  }
  if (shareChooseRoleSource.includes("this.pendingRole = targetRole")) {
    fail("Published share role switching must not render the target role as an intermediate pending card");
  }
  for (const requiredSilentSwitchText of [
    "roleSelectionSubmitting",
    "if (this.roleSelectionSubmitting)",
    "this.roleSelectionSubmitting = true",
    "this.roleSelectionSubmitting = false",
    "async confirmRole(role = null, options = {})",
    "const targetRole = role || this.pendingRole",
    "const revealPending = options.revealPending !== false",
    "await this.claimSeat(targetRole)"
  ]) {
    if (!shareSource.includes(requiredSilentSwitchText)) {
      fail(`Share role switching must hide intermediate selection state: ${requiredSilentSwitchText}`);
    }
  }
  if (claimSeatSource.trim().startsWith('this.statusText = "";')) {
    fail("Share role switching must not clear the status notice before the final seat state is ready");
  }
  if (!shareSource.includes("confirmSwitchRole")) {
    fail("Share role selection must keep a confirmation dialog before switching away from the current role");
  }
  if (
    !shareConfirmSwitchRoleSource.includes("this.currentSelectionForSwitch(role)") ||
    !shareCurrentSelectionForSwitchSource.includes("this.currentUserNpcRole") ||
    !shareCurrentSelectionForSwitchSource.includes('role.boardType === "npc"')
  ) {
    fail("Share role switching must treat ordinary seats and NPC roles as one exclusive role pool");
  }
  for (const requiredNpcSwitchText of [
    "if (this.roleSelectionSubmitting)",
    "const selectedRoleKey = this.roleKey(npcRole)",
    "const targetRole = this.npcRoleCards.find((item) => this.roleKey(item) === selectedRoleKey) || npcRole",
    "const switchConfirmed = await this.confirmSwitchRole(targetRole)",
    "const confirmed = await this.confirmCrossCastRole(targetRole)",
    "this.confirmedCrossCastRoleKey = this.roleKey(targetRole)",
    "url: `/api/session-npc-roles/${targetRole.id}/claim`"
  ]) {
    if (!shareChooseNpcRoleSource.includes(requiredNpcSwitchText)) {
      fail(`NPC role selection must mirror ordinary role switching: ${requiredNpcSwitchText}`);
    }
  }
  for (const forbiddenShareActionText of [
    "分享到群",
    "复制文案",
    "copyInviteText",
    "setClipboardData",
    '@click="shareTimeline"',
    "share-actions action-grid",
    "/pages/session/apply"
  ]) {
    if (shareSource.includes(forbiddenShareActionText)) {
      fail(`Share page should not keep extra share action: ${forbiddenShareActionText}`);
    }
  }
  for (const forbiddenTicketRowText of [
    '<view class="ticket-label">已选</view>',
    '<view class="ticket-label">我选</view>',
    '<view class="ticket-label">沟通</view>',
    "note-row"
  ]) {
    if (shareSource.includes(forbiddenTicketRowText)) {
      fail(`Share ticket should only keep basic session info, remove: ${forbiddenTicketRowText}`);
    }
  }

  const createFlowSource = fs.readFileSync(path.join(srcRoot, "utils/createFlow.js"), "utf8");
  for (const requiredStateText of [
    "selectedRoles",
    "roleOptions",
    "mergeSelectedRoles",
    "pinnedMessageText",
    "startAt"
  ]) {
    if (!createFlowSource.includes(requiredStateText)) {
      fail(`Share flow state must preserve role availability across shares: ${requiredStateText}`);
    }
  }

  const roleSource = fs.existsSync(firstFlowFiles["role step"])
    ? fs.readFileSync(firstFlowFiles["role step"], "utf8")
    : "";
  if (!roleSource.includes("/pages/session/setup")) {
    fail("Role step must continue to the time and pinned-message setup page");
  }
  if (
    !/async selectRole\(role\)\s*\{[\s\S]*this\.isSelectedRole\(role\)[\s\S]*this\.goNext\(\);[\s\S]*return;[\s\S]*confirmCrossCastRole/.test(roleSource)
  ) {
    fail("Role selection should confirm and continue when tapping the selected role again");
  }
  const selectRoleSource = methodBody(roleSource, "selectRole");
  const roleGoNextSource = methodBody(roleSource, "goNext");
  if (roleSource.includes("ensureRoleStepLogin") || selectRoleSource.includes("ensureLoggedIn")) {
    fail("Role selection must be browsable before login");
  }
  if (roleGoNextSource.includes("ensureLoggedIn")) {
    fail("Role next button must let users continue browsing before login");
  }

  const setupSource = fs.existsSync(firstFlowFiles["setup step"])
    ? fs.readFileSync(firstFlowFiles["setup step"], "utf8")
    : "";
  for (const requiredSetupText of [
    'mode="date"',
    ':mode="[\'hour\', \'minute\']"',
    "pinnedMessageText",
    "defaultPinnedMessage",
    "createPublishedSession",
    'time: "14:00"',
    "/api/sessions",
    "/chat/pin"
  ]) {
    if (!setupSource.includes(requiredSetupText)) {
      fail(`Setup step must collect and persist start time plus pinned chat info: ${requiredSetupText}`);
    }
  }
  for (const forbiddenSetupExtraNpcText of [
    "本场额外NPC",
    "extraNpcRolesPlaceholder",
    "extraNpcRolesText",
    "extraNpcRoles:"
  ]) {
    if (setupSource.includes(forbiddenSetupExtraNpcText)) {
      fail(`Setup step must not expose per-session extra NPC creation yet: ${forbiddenSetupExtraNpcText}`);
    }
  }
  for (const requiredJoinPolicyText of [
    "joinPolicy",
    "review_required",
    "direct",
    "setJoinPolicy",
    "上车审核",
    "需要审核",
    "直接上车"
  ]) {
    if (!setupSource.includes(requiredJoinPolicyText)) {
      fail(`Setup step must expose D23 join policy control: ${requiredJoinPolicyText}`);
    }
  }
  for (const requiredSetupSettingsSwitchText of [
    "setting-switch-row",
    "setting-switch-meta",
    'color="#1f7a68"',
    ':value="joinPolicy === \'review_required\'"',
    '@change="setJoinPolicy($event.detail.value ? \'review_required\' : \'direct\')"',
    ':value="joinPhoneRequired"',
    "@change=\"setJoinPhoneRequired($event.detail.value)\"",
    ':value="npcJoinEnabled"',
    "@change=\"setNpcJoinEnabled($event.detail.value)\""
  ]) {
    if (!setupSource.includes(requiredSetupSettingsSwitchText)) {
      fail(`Setup step settings must use unified switch controls: ${requiredSetupSettingsSwitchText}`);
    }
  }
  if (!setupSource.includes("<switch") && !setupSource.includes("<t-switch")) {
    fail("Setup step settings must use switch controls");
  }
  for (const forbiddenSetupSettingsToggleText of [
    "policy-toggle",
    "policy-option",
    "npc-join-toggle",
    "toggleJoinPhoneRequired",
    "toggleNpcJoinEnabled"
  ]) {
    if (setupSource.includes(forbiddenSetupSettingsToggleText)) {
      fail(`Setup step settings must not keep legacy button toggles: ${forbiddenSetupSettingsToggleText}`);
    }
  }
  if (/placeholder="[^"]*(?:&#10;|\n)[^"]*"/.test(setupSource)) {
    fail("Setup step must bind multiline textarea placeholders so WeChat upload compilation does not receive literal newlines in WXML attributes");
  }
  const createPublishedSessionSource = methodBody(setupSource, "createPublishedSession");
  if (!createPublishedSessionSource.includes("ensureLoggedIn")) {
    fail("Setup publish button must request login before publishing");
  }
  if (!createPublishedSessionSource.includes("requirePhone: true")) {
    fail("Setup publish button must require phone before publishing");
  }
  assertBefore(
    createPublishedSessionSource,
    "ensureLoggedIn",
    "this.busyAction = true",
    "Setup publish button must not mark busy before login"
  );
  assertBefore(
    createPublishedSessionSource,
    "ensureLoggedIn",
    "request",
    "Setup publish button must request login before publishing"
  );
  assertBefore(
    createPublishedSessionSource,
    "requirePhone: true",
    "this.busyAction = true",
    "Setup publish button must require phone before marking busy"
  );
  assertBefore(
    createPublishedSessionSource,
    "requirePhone: true",
    "request",
    "Setup publish button must require phone before publishing requests"
  );

  const extensionFiles = {
    "session extension registry": path.join(srcRoot, "extensions/sessionExtensions.js"),
    "pseudo chat miniprogram adapter": path.join(
      srcRoot,
      "extensions/session-pseudo-chat/index.js"
    ),
    "talk chat entry": path.join(root, "packages/talk/miniprogram/ChatEntry.vue"),
    "talk pinned-message manager": path.join(
      root,
      "packages/talk/miniprogram/ManagePinnedMessage.vue"
    )
  };
  for (const [label, file] of Object.entries(extensionFiles)) {
    if (!fs.existsSync(file)) {
      fail(`Missing ${label}: ${file}`);
    }
  }

  const detailSource = fs.existsSync(path.join(srcRoot, "pages/session/detail.vue"))
    ? fs.readFileSync(path.join(srcRoot, "pages/session/detail.vue"), "utf8")
    : "";
  for (const requiredD34DetailLocationText of [
    "session.store_address",
    "session.store_address || hasStoreLocation",
    "查看地图",
    "hasStoreLocation",
    "openStoreMap",
    "uni.openLocation",
    "store_latitude",
    "store_longitude",
    "scale: 18",
    "地图打开失败，请稍后再试"
  ]) {
    if (!detailSource.includes(requiredD34DetailLocationText)) {
      fail(`D34 store location detail page is missing ${requiredD34DetailLocationText}`);
    }
  }
  const roleSeatBoardPath = path.join(srcRoot, "components/RoleSeatBoard.vue");
  const roleSeatBoardSource = fs.existsSync(roleSeatBoardPath)
    ? fs.readFileSync(roleSeatBoardPath, "utf8")
    : "";
  if (!fs.existsSync(roleSeatBoardPath)) {
    fail("Seat and role displays must share components/RoleSeatBoard.vue");
  }
  for (const requiredRoleSeatBoardText of [
    "role-board",
    "role-choice",
    "role-choice-top",
    "role-choice-name",
    "role-choice-title",
    "role-state",
    "role-choice-note",
    "role-actions",
    "role-meta",
    "role-meta-line",
    "mine",
    "switching",
    "pending",
    "taken",
    "unavailable",
    "male",
    "female"
  ]) {
    if (!roleSeatBoardSource.includes(requiredRoleSeatBoardText)) {
      fail(`Shared role seat board must render the approved visual system: ${requiredRoleSeatBoardText}`);
    }
  }
  for (const requiredRoleSeatBoardOverflowText of [
    ".role-choice-title",
    "overflow: hidden",
    "text-overflow: ellipsis",
    "white-space: nowrap"
  ]) {
    if (!roleSeatBoardSource.includes(requiredRoleSeatBoardOverflowText)) {
      fail(`Shared role seat board must truncate overflowing names: ${requiredRoleSeatBoardOverflowText}`);
    }
  }
  for (const requiredRoleSeatBoardAvatarText of [
    "DEFAULT_AVATARS",
    "/static/avatars/default-male.jpg",
    "/static/avatars/default-female.jpg",
    "roleAvatarSrc(item)",
    "roleAvatarClass(item)",
    "roleSelectionToneClass(item)",
    "shouldShowRoleAvatar(item)",
    'class="role-avatar"',
    ":src=\"roleAvatarSrc(item)\"",
    ".role-choice.with-avatar",
    ".role-avatar-image"
  ]) {
    if (!roleSeatBoardSource.includes(requiredRoleSeatBoardAvatarText)) {
      fail(`Shared role seat board must show occupied role avatars with gender defaults: ${requiredRoleSeatBoardAvatarText}`);
    }
  }
  for (const requiredRoleSeatBoardNameLayoutText of [
    ".role-choice-title",
    "flex: 0 1 auto",
    ".role-choice-note",
    ".role-choice-note-text",
    "text-overflow: ellipsis",
    "white-space: nowrap"
  ]) {
    if (!roleSeatBoardSource.includes(requiredRoleSeatBoardNameLayoutText)) {
      fail(`Shared role seat board must keep gender beside role name and truncate user nicknames: ${requiredRoleSeatBoardNameLayoutText}`);
    }
  }
  const roleBoardStyle = roleSeatBoardSource.match(/\.role-board\s*\{[\s\S]*?\n\}/)?.[0] || "";
  if (!roleBoardStyle.includes("grid-template-columns: repeat(2, minmax(0, 1fr));")) {
    fail("Shared role seat board must lock seat columns with minmax(0, 1fr)");
  }
  const roleChoiceStyle = roleSeatBoardSource.match(/\.role-choice\s*\{[\s\S]*?\n\}/)?.[0] || "";
  for (const requiredLockedSeatCardStyle of [
    "width: 100%;",
    "min-width: 0;",
    "overflow: hidden;"
  ]) {
    if (!roleChoiceStyle.includes(requiredLockedSeatCardStyle)) {
      fail(`Shared role seat card width must stay locked inside its column: ${requiredLockedSeatCardStyle}`);
    }
  }
  const roleChoiceNameStyle = roleSeatBoardSource.match(/\.role-choice-name\s*\{[\s\S]*?\n\}/)?.[0] || "";
  if (!roleChoiceNameStyle.includes("flex: 1 1 0;")) {
    fail("Shared role seat card title row must allocate a fixed remaining width before ellipsis");
  }
  const roleChoiceNoteStyle = roleSeatBoardSource.match(/\.role-choice-note\s*\{[\s\S]*?\n\}/)?.[0] || "";
  for (const requiredLockedSeatNoteStyle of [
    "width: 100%;",
    "max-width: 100%;"
  ]) {
    if (!roleChoiceNoteStyle.includes(requiredLockedSeatNoteStyle)) {
      fail(`Shared role seat nickname row must truncate against the locked card width: ${requiredLockedSeatNoteStyle}`);
    }
  }
  for (const requiredRoleSeatBoardSelectedFrameText of [
    "owner-male",
    "owner-female",
    ".role-choice.mine.owner-male",
    ".role-choice.mine.owner-female",
    "border-width: 9rpx",
    "padding: 14rpx 10rpx",
    "border-color: #2f6fed",
    "border-color: #8f5bd6"
  ]) {
    if (!roleSeatBoardSource.includes(requiredRoleSeatBoardSelectedFrameText)) {
      fail(`Shared role seat board selected frame must follow the selecting user gender: ${requiredRoleSeatBoardSelectedFrameText}`);
    }
  }
  const selectedMaleStyle =
    roleSeatBoardSource.match(/\.role-choice\.mine\.male,[\s\S]*?\.role-choice\.focused\.male\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const selectedFemaleStyle =
    roleSeatBoardSource.match(/\.role-choice\.mine\.female,[\s\S]*?\.role-choice\.focused\.female\s*\{[\s\S]*?\n\}/)?.[0] || "";
  if (!selectedMaleStyle.includes("background: rgba(242, 248, 247, 0.98);")) {
    fail("Shared role seat board selected male card must keep the male green background");
  }
  if (!selectedFemaleStyle.includes("background: rgba(255, 248, 245, 0.98);")) {
    fail("Shared role seat board selected female card must keep the female pink background");
  }
  const selectedOwnerMaleStyle =
    roleSeatBoardSource.match(/\.role-choice\.mine\.owner-male,[\s\S]*?\.role-choice\.focused\.owner-male\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const selectedOwnerFemaleStyle =
    roleSeatBoardSource.match(/\.role-choice\.mine\.owner-female,[\s\S]*?\.role-choice\.focused\.owner-female\s*\{[\s\S]*?\n\}/)?.[0] || "";
  if (!selectedOwnerMaleStyle.includes("border-color: #2f6fed;")) {
    fail("Shared role seat board selected owner-male card must use the blue frame even when the role is female");
  }
  if (!selectedOwnerFemaleStyle.includes("border-color: #8f5bd6;")) {
    fail("Shared role seat board selected owner-female card must use the purple frame even when the role is male");
  }
  for (const forbiddenRoleGenderFrameText of [
    ".role-choice.mine.male,\n.role-choice.switching.male,\n.role-choice.selected.male,\n.role-choice.focused.male {\n  border-color",
    ".role-choice.mine.female,\n.role-choice.switching.female,\n.role-choice.selected.female,\n.role-choice.focused.female {\n  border-color"
  ]) {
    if (roleSeatBoardSource.includes(forbiddenRoleGenderFrameText)) {
      fail(`Shared role seat board selected frame must not use role gender classes for frame color: ${forbiddenRoleGenderFrameText}`);
    }
  }
  if (
    !/\.role-choice\.taken\.male,[\s\S]*?\.role-choice\.unavailable\.male\s*\{[\s\S]*?background:\s*rgba\(242,\s*248,\s*247,\s*0\.98\);/.test(
      roleSeatBoardSource
    )
  ) {
    fail("Shared role seat board occupied male card must keep the male green background");
  }
  if (
    !/\.role-choice\.taken\.female,[\s\S]*?\.role-choice\.unavailable\.female\s*\{[\s\S]*?background:\s*rgba\(255,\s*248,\s*245,\s*0\.98\);/.test(
      roleSeatBoardSource
    )
  ) {
    fail("Shared role seat board occupied female card must keep the female pink background");
  }
  for (const forbiddenRoleSeatBoardSelectedFrameText of [
    "0 0 0 3rpx rgba(216, 167, 61",
    "inset 0 0 0 1rpx rgba(216, 167, 61",
    "background: #b89458"
  ]) {
    if (roleSeatBoardSource.includes(forbiddenRoleSeatBoardSelectedFrameText)) {
      fail(`Shared role seat board selected frame must not use the old golden selected styling: ${forbiddenRoleSeatBoardSelectedFrameText}`);
    }
  }
  if (roleSeatBoardSource.includes('<t-tag v-if="item.crossCast" class="cross-cast-tag"')) {
    fail("Shared role seat board cross-cast label must render beside the occupant nickname, not in the cramped title row");
  }
  if (
    !roleSeatBoardSource.includes('v-if="item.note || item.crossCast" class="role-choice-note"') ||
    !roleSeatBoardSource.includes('<text v-if="item.note" class="role-choice-note-text">{{ item.note }}</text>') ||
    !roleSeatBoardSource.includes('<text v-if="item.crossCast" class="cross-cast-tag">反串</text>')
  ) {
    fail("Shared role seat board must render cross-cast label after the occupant nickname");
  }
  for (const [pageLabel, pagePath] of Object.entries({
    "role page": path.join(srcRoot, "pages/session/role.vue"),
    "share page": path.join(srcRoot, "pages/session/share.vue"),
    "detail page": path.join(srcRoot, "pages/session/detail.vue"),
    "manage page": path.join(srcRoot, "pages/session/manage.vue"),
    "album page": path.join(srcRoot, "pages/session/album.vue")
  })) {
    const pageSource = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, "utf8") : "";
    if (!pageSource.includes("RoleSeatBoard") || !pageSource.includes("<RoleSeatBoard")) {
      fail(`${pageLabel} must use the shared RoleSeatBoard component`);
    }
  }
  if (detailSource.includes('class="seat-card"')) {
    fail("Detail page role and seat list must use RoleSeatBoard instead of legacy seat-card layout");
  }
  for (const requiredDetailNpcRoleSeatText of [
    ':sections="detailRoleSeatSections"',
    "detailNpcRoleCards",
    "session.session_npc_roles",
    'key: "npc"',
    'title: "NPC角色"'
  ]) {
    if (!detailSource.includes(requiredDetailNpcRoleSeatText)) {
      fail(`Detail page role and seat board must include NPC role section: ${requiredDetailNpcRoleSeatText}`);
    }
  }
  for (const requiredDetailExtensionText of [
    "sessionDetailExtensions",
    "sessionDetailExtensionRefs",
    "stopDetailExtensions",
    "authTools"
  ]) {
    if (!detailSource.includes(requiredDetailExtensionText)) {
      fail(`Detail page must mount session extensions: ${requiredDetailExtensionText}`);
    }
  }
  if (/onLoad\s*\(\s*options\s*\)\s*\{\s*const auth = await ensureLoggedIn\s*\(/.test(detailSource)) {
    fail("Detail page must let shared users browse before login");
  }
  if (!/async ensureProtectedActionLogin\([^)]*\)\s*\{[\s\S]*ensureLoggedIn\s*\(/.test(detailSource)) {
    fail("Detail page must provide a login guard for protected buttons");
  }
  if (!/async goShare\(seat\)\s*\{[\s\S]*ensureProtectedActionLogin\s*\(/.test(detailSource)) {
    fail("Detail page must require login before choosing a role");
  }
  if (!/async goManage\(\)\s*\{[\s\S]*ensureProtectedActionLogin\s*\(/.test(detailSource)) {
    fail("Detail page must require login before opening management");
  }

  const manageSource = fs.existsSync(path.join(srcRoot, "pages/session/manage.vue"))
    ? fs.readFileSync(path.join(srcRoot, "pages/session/manage.vue"), "utf8")
    : "";
  for (const requiredManageExtensionText of [
    "sessionManageExtensions",
    "authTools",
    "@updated=\"reload\"",
    "@status=\"setStatus\""
  ]) {
    if (!manageSource.includes(requiredManageExtensionText)) {
      fail(`Manage page must mount session extensions: ${requiredManageExtensionText}`);
    }
  }
  if (!/ensureManageActionLogin/.test(manageSource)) {
    fail("Manage action buttons must guard login before requests or confirmation dialogs");
  }
  for (const requiredManageOverviewText of [
    "车局总览",
    "overview-card",
    "overview-actions",
    "overview-pinned",
    ':embedded="true"',
    "车局详情"
  ]) {
    if (!manageSource.includes(requiredManageOverviewText)) {
      fail(`Manage page must integrate top actions, status, and pinned message into one overview block: ${requiredManageOverviewText}`);
    }
  }
  for (const requiredManageDateTimeText of [
    "formatSessionDateTime",
    "formattedStartAt",
    "时间：{{ formattedStartAt }}"
  ]) {
    if (!manageSource.includes(requiredManageDateTimeText)) {
      fail(`Manage page must present a localized session time: ${requiredManageDateTimeText}`);
    }
  }
  if (manageSource.includes("时间：{{ session.start_at }}")) {
    fail("Manage page must not expose the raw ISO session time");
  }
  if (!manageSource.includes("return `${this.session.store_name_snapshot} / ${this.formattedStartAt}`")) {
    fail("Manage summary must use the localized formattedStartAt value");
  }
  if (/section-title">\s*车况/.test(manageSource)) {
    fail("Manage page must not keep a separate 车况 section after overview consolidation");
  }
  if (manageSource.includes('class="seat-card"')) {
    fail("Manage page seat status list must use RoleSeatBoard instead of legacy seat-card layout");
  }
  for (const requiredManageNpcRoleSeatText of [
    ':sections="manageRoleSeatSections"',
    "manageNpcRoleCards",
    "session.session_npc_roles",
    'key: "npc"',
    'title: "NPC角色"',
    "releaseNpcRole"
  ]) {
    if (!manageSource.includes(requiredManageNpcRoleSeatText)) {
      fail(`Manage page seat status board must include NPC role section and actions: ${requiredManageNpcRoleSeatText}`);
    }
  }
  if (manageSource.includes('class="signup-card"') || manageSource.includes("seat-header")) {
    fail("Manage page signup target cards must use RoleSeatBoard instead of legacy signup-card layout");
  }
  for (const requiredManageSettingsSwitchText of [
    "setting-switch-row",
    "setting-switch-meta",
    'color="#1f7a68"',
    ':value="joinPolicy === \'review_required\'"',
    '@change="setJoinPolicy($event.detail.value ? \'review_required\' : \'direct\')"',
    ':value="joinPhoneRequired"',
    "@change=\"setJoinPhoneRequired($event.detail.value)\"",
    ':value="npcJoinEnabled"',
    "@change=\"setNpcJoinEnabled($event.detail.value)\""
  ]) {
    if (!manageSource.includes(requiredManageSettingsSwitchText)) {
      fail(`Manage page settings must use unified switch controls: ${requiredManageSettingsSwitchText}`);
    }
  }
  if (!manageSource.includes("<switch") && !manageSource.includes("<t-switch")) {
    fail("Manage page settings must use switch controls");
  }
  for (const forbiddenManageSettingsToggleText of [
    "settings-toggle",
    "setting-option",
    "setting-toggle",
    "toggleJoinPhoneRequired",
    "toggleNpcJoinEnabled"
  ]) {
    if (manageSource.includes(forbiddenManageSettingsToggleText)) {
      fail(`Manage page settings must not keep legacy button toggles: ${forbiddenManageSettingsToggleText}`);
    }
  }
  const pinnedManagerSource = fs.existsSync(path.join(root, "packages/talk/miniprogram/ManagePinnedMessage.vue"))
    ? fs.readFileSync(path.join(root, "packages/talk/miniprogram/ManagePinnedMessage.vue"), "utf8")
    : "";
  for (const requiredPinnedManagerText of [
    "embedded",
    "pinned-manager",
    ".pinned-manager.embedded",
    "保存置顶"
  ]) {
    if (!pinnedManagerSource.includes(requiredPinnedManagerText)) {
      fail(`Pinned-message manager must support embedded overview rendering: ${requiredPinnedManagerText}`);
    }
  }
  const manageButtonChecks = [
    ["reload", "loadSession", "Manage refresh button must request login before loading data"],
    ["goDetail", "uni.navigateTo", "Manage detail button must request login before navigating"],
    ["approve", "runAction", "Manage approve button must request login before requests"],
    ["reject", "runAction", "Manage reject button must request login before requests"],
    ["kickSeat", "confirmAction", "Manage kick button must not show confirmation before login"],
    ["cancelSession", "confirmAction", "Manage cancel button must not show confirmation before login"]
  ];
  for (const [methodName, nextAction, message] of manageButtonChecks) {
    assertBefore(methodBody(manageSource, methodName), "ensureManageActionLogin", nextAction, message);
  }
  for (const requiredManageBusyText of [
    "operationText",
    "正在处理，请稍候",
    ':disabled="busyAction"',
    "{{ busyAction ?",
    "this.busyAction = true",
    "this.busyAction = false"
  ]) {
    if (!manageSource.includes(requiredManageBusyText)) {
      fail(`Manage page must lock related controls while busy: ${requiredManageBusyText}`);
    }
  }

  const albumSource = fs.existsSync(path.join(srcRoot, "pages/session/album.vue"))
    ? fs.readFileSync(path.join(srcRoot, "pages/session/album.vue"), "utf8")
    : "";
  const albumImageViewerPath = path.join(srcRoot, "components/AlbumImageViewer.vue");
  const albumImageViewerSource = fs.existsSync(albumImageViewerPath)
    ? fs.readFileSync(albumImageViewerPath, "utf8")
    : "";
  const builtAlbumImageViewerWxmlPath = path.join(
    miniprogramBuildRoot,
    "components",
    "AlbumImageViewer.wxml"
  );
  if (!fs.existsSync(builtAlbumImageViewerWxmlPath)) {
    if (requireBuiltWxml) {
      fail(
        "Built AlbumImageViewer WXML is required; run npm run build:mp-weixin before this check"
      );
    }
  } else {
    const builtAlbumImageViewerWxml = fs.readFileSync(builtAlbumImageViewerWxmlPath, "utf8");
    const builtAlbumViewerSwiperTag =
      builtAlbumImageViewerWxml.match(/<swiper(?=[\s>])[^>]*>/)?.[0] || "";
    if (!builtAlbumViewerSwiperTag) {
      fail("Built AlbumImageViewer WXML must contain a structural swiper tag");
    }
    for (const requiredBuiltSwiperAttribute of ["wx:for=", "wx:key=", "data-generation="]) {
      if (!builtAlbumViewerSwiperTag.includes(requiredBuiltSwiperAttribute)) {
        fail(`Built AlbumImageViewer swiper must remount structurally: ${requiredBuiltSwiperAttribute}`);
      }
    }
  }
  if (!albumImageViewerSource.includes('v-for="(photo, windowIndex) in windowPhotos"')) {
    fail("AlbumImageViewer swiper template must render windowPhotos instead of the full photos list");
  }
  if (albumImageViewerSource.includes('v-for="(photo, index) in photos"')) {
    fail("AlbumImageViewer swiper template must not mount the full photos list");
  }
  const apiServerSource = fs.existsSync(apiServerPath)
    ? fs.readFileSync(apiServerPath, "utf8")
    : "";
  for (const requiredAlbumRoleSeatBoardText of [
    "albumTagSections",
    "albumTagSection",
    "albumTagCard",
    "handleAlbumTagTap",
    'role_gender: seat.role_gender || "unlimited"',
    '<RoleSeatBoard'
  ]) {
    if (!albumSource.includes(requiredAlbumRoleSeatBoardText)) {
      fail(`Album tag role picker must use RoleSeatBoard: ${requiredAlbumRoleSeatBoardText}`);
    }
  }
  for (const forbiddenAlbumTagCardText of [
    "people-grid",
    "person-choice",
    "person-note",
    'class="group-title"'
  ]) {
    if (albumSource.includes(forbiddenAlbumTagCardText)) {
      fail(`Album tag role picker must not keep legacy person card styles: ${forbiddenAlbumTagCardText}`);
    }
  }
  for (const requiredAlbumBusyText of [
    "albumBusy",
    "loadingAlbum",
    "deletingPhotoId",
    "operationText",
    "正在处理，请稍候",
    ':disabled="albumBusy"',
    "this.deletingPhotoId = photo.id",
    "this.deletingPhotoId = null"
  ]) {
    if (!albumSource.includes(requiredAlbumBusyText)) {
      fail(`Album page must lock related controls while busy: ${requiredAlbumBusyText}`);
    }
  }
  for (const requiredD32AlbumVideoText of [
    // D32 admin album video: media_type === "image" and media_type === "video".
    "D32 admin album video",
    "MAX_ALBUM_VIDEO_DURATION_SECONDS",
    "MIN_ALBUM_VIDEO_COMPRESS_BYTES = 20 * 1024 * 1024",
    "wx.chooseMedia",
    "wx.compressVideo",
    "chooseAlbumMedia",
    "classifyAlbumMediaSelection",
    "canUploadVideo",
    "shouldCompressVideoBeforeUpload",
    "isSuspiciousCompressedVideo",
    "originalSize > 0 && originalSize <= MIN_ALBUM_VIDEO_COMPRESS_BYTES",
    "压缩后视频异常",
    "media_type === \"image\"",
    "media_type === \"video\"",
    "打开小程序查看视频"
  ]) {
    if (!albumSource.includes(requiredD32AlbumVideoText)) {
      fail(`D32 admin album video flow is missing ${requiredD32AlbumVideoText}`);
    }
  }
  const albumVideoPreviewPhotoSource = methodBody(albumSource, "previewPhoto");
  const openPhotoPreviewSourceForVideo = methodBody(albumSource, "openPhotoPreview");
  if (albumSource.includes("video-player-popup") || albumSource.includes("videoPlayerVisible")) {
    fail("Album video playback must use AlbumImageViewer instead of a separate video popup");
  }
  if (albumSource.includes("openVideoPlayer(") || albumSource.includes("openVideoPlayer(photo)")) {
    fail("Album video playback must not branch to openVideoPlayer");
  }
  if (
    !albumVideoPreviewPhotoSource.includes("this.timelineMode && photo?.media_type === \"video\"") ||
    !albumVideoPreviewPhotoSource.includes("打开小程序查看视频")
  ) {
    fail("Album timeline video taps must stay outside the member viewer and show the mini-program hint");
  }
  if (
    !openPhotoPreviewSourceForVideo.includes("item.media_type !== \"video\" || this.videoReady(item)") ||
    !openPhotoPreviewSourceForVideo.includes("!this.timelineMode || item.media_type !== \"video\"")
  ) {
    fail("Album member preview must retain ready videos while timeline preview excludes them");
  }
  const ensurePreviewMediaAroundSourceForVideo = methodBody(albumSource, "ensurePreviewMediaAround");
  if (ensurePreviewMediaAroundSourceForVideo.includes("this.loadPreviewVideoUrl(photo);")) {
    fail("Album preview must only load video playback URLs for the active viewer slide");
  }
  for (const requiredAlbumVideoViewerText of [
    "@need-video=\"handlePreviewVideoRequest\"",
    "loadPreviewVideoUrl",
    "const videoUrlEndpoint = `/api/session-album/media/${photo.id}/video-url`;",
    "this.normalizeAlbumMediaUrl(data.url)",
    "video_display_url",
    "video_load_failed"
  ]) {
    if (!albumSource.includes(requiredAlbumVideoViewerText)) {
      fail(`Album video viewer integration is missing ${requiredAlbumVideoViewerText}`);
    }
  }
  for (const requiredAlbumImageViewerVideoText of [
    "isVideo(photo)",
    "isActiveVideo(logicalIndexForWindowIndex(windowIndex))",
    "<video",
    "v-if=\"isActiveVideo(logicalIndexForWindowIndex(windowIndex)) && videoUrl(photo)\"",
    "videoDomId(photo, logicalIndexForWindowIndex(windowIndex))",
    "album-image-viewer__video",
    "video_display_url",
    "video_load_failed",
    "need-video",
    "pauseVideoAt",
    "pauseAllVideos"
  ]) {
    if (!albumImageViewerSource.includes(requiredAlbumImageViewerVideoText)) {
      fail(`AlbumImageViewer must support mixed image/video preview: ${requiredAlbumImageViewerVideoText}`);
    }
  }
  for (const requiredAlbumPhotoCompressText of [
    "MAX_ALBUM_PHOTO_UPLOAD_BYTES = 4 * 1024 * 1024",
    "ALBUM_PHOTO_COMPRESS_QUALITY",
    "ALBUM_PHOTO_COMPRESS_WIDTH",
    "ALBUM_PHOTO_COMPRESS_HEIGHT",
    "getPhotoFileInfo",
    "getPhotoFileStat",
    "getFileSystemManager().stat",
    "compressPhotoBeforeUpload",
    "preparePhotoForUpload",
    "normalizePhotoUploadItem",
    'sizeType: ["original"]',
    "result.tempFiles || []",
    "photoItems.length ? photoItems : result.tempFilePaths || []",
    "const pickerSize = Number(normalized.size || 0)",
    "pickerSize || Number(originalInfo.size || 0)",
    "uni.getFileInfo",
    "uni.compressImage",
    "if (!originalSize) {",
    "if (!uploadSize) {",
    "无法读取图片大小",
    "无法读取压缩后图片大小",
    "originalSize > 0 && originalSize <= MAX_ALBUM_PHOTO_UPLOAD_BYTES",
    "compressedWidth: ALBUM_PHOTO_COMPRESS_WIDTH",
    "compressedHeight: ALBUM_PHOTO_COMPRESS_HEIGHT",
    "uploadSize > MAX_ALBUM_PHOTO_UPLOAD_BYTES",
    "图片超过 4MB"
  ]) {
    if (!albumSource.includes(requiredAlbumPhotoCompressText)) {
      fail(`Album photo upload must compress and enforce 4MB client-side: ${requiredAlbumPhotoCompressText}`);
    }
  }
  const uploadChosenPhotosSource = methodBody(albumSource, "uploadChosenPhotos");
  if (!uploadChosenPhotosSource.includes("preparePhotoForUpload(filePath)")) {
    fail("Album photo upload must prepare each image before uploading");
  }
  if (
    !uploadChosenPhotosSource.includes("uploadAlbumPhoto({") ||
    !uploadChosenPhotosSource.includes("filePath: prepared.filePath")
  ) {
    fail("Album photo upload must send the compressed/prepared image path");
  }
  const deletePhotoSource = methodBody(albumSource, "deletePhoto");
  if (!deletePhotoSource.includes("this.albumBusy")) {
    fail("Album delete action must refuse duplicate deletes while another album action is busy");
  }
  const changeWaterfallListSource = methodBody(albumSource, "changeWaterfallList");
  if (changeWaterfallListSource.includes("this[event.name].push")) {
    fail("Album waterfall callback must not push into uv-waterfall internal list names directly");
  }
  const uvWaterfallSource = fs.existsSync(
    path.join(srcRoot, "uni_modules/uv-ui-tools/components/uv-waterfall/uv-waterfall.vue")
  )
    ? fs.readFileSync(
        path.join(srcRoot, "uni_modules/uv-ui-tools/components/uv-waterfall/uv-waterfall.vue"),
        "utf8"
      )
    : "";
  for (const requiredWaterfallWidthText of [
    ".photo-waterfall",
    "display: flex",
    "width: 100%",
    "max-width: 100%",
    "overflow-x: hidden",
    ".waterfall-column",
    ".waterfall-photo-card",
    "box-sizing: border-box",
    "flex: 1 1 0",
    "min-width: 0"
  ]) {
    if (!albumSource.includes(requiredWaterfallWidthText) && !uvWaterfallSource.includes(requiredWaterfallWidthText)) {
      fail(`Album waterfall must clamp columns after operation reflow: ${requiredWaterfallWidthText}`);
    }
  }
  if (/\.photo-waterfall\s*\{[^}]*display:\s*block;/.test(albumSource)) {
    fail("Album waterfall root must not override uv-waterfall flex layout with display:block");
  }
  for (const requiredWaterfallCallbackText of [
    "targetListName",
    "waterfallList",
    "Array.isArray(this[targetListName])",
    "findCurrentAlbumMediaRow(this.filteredPhotos, event.value)",
    "this[targetListName].push(currentPhoto)"
  ]) {
    if (!changeWaterfallListSource.includes(requiredWaterfallCallbackText)) {
      fail(`Album waterfall callback must map uv-waterfall names to page lists: ${requiredWaterfallCallbackText}`);
    }
  }
  for (const requiredAlbumBulkTagText of [
    "selectionMode",
    "selectedPhotoIds",
    "bulkTagging",
    "toggleSelectionMode",
    "togglePhotoSelection",
    "openBulkTagSheet",
    "selectedPhotoCount",
    "selectedTagTargetCount",
    "album-floating-toolbar",
    "safe-area-inset-bottom",
    "selection-checkbox",
    "selection-checkbox-box",
    "部分照片标注失败",
    "给 {{ selectedTagTargetCount }} 张照片标注",
    "for (const photoId of targetPhotoIds)",
    "url: `/api/session-album/photos/${photoId}/tags`",
    "data: { tagKeys: this.selectedTagKeys }",
    "tagPersonTitle",
    "tagPersonSubtitle",
    "note: this.tagPersonSubtitle(person)",
    "account_name: accountName"
  ]) {
    if (!albumSource.includes(requiredAlbumBulkTagText)) {
      fail(`Album page must support bulk tagging: ${requiredAlbumBulkTagText}`);
    }
  }
  const albumFloatingToolbarStyle =
    albumSource.match(/\.album-floating-toolbar\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const albumFloatingToolbarDisabledStyle =
    albumSource.match(/\.floating-toolbar-button\.disabled\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const albumActionsStyle =
    albumSource.match(/\.album-actions\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const albumStickyActionsFloatingStyle =
    albumSource.match(/\.album-sticky-actions\.floating\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const albumActionsShellFloatingStyle =
    albumSource.match(/\.album-actions-shell\.floating\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const albumSelectionPageStyle =
    albumSource.match(/\.album-page\.selection-active\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const albumToolbarFilterPanelStyle =
    albumSource.match(/\.album-toolbar-filter-panel\s*\{[\s\S]*?\n\}/)?.[0] || "";
  if (/(^|[;{\n\r])\s*bottom:\s*calc\(/.test(albumFloatingToolbarStyle)) {
    fail("Album floating toolbar must keep a plain bottom fallback so it appears immediately in WeChat DevTools");
  }
  if (
    albumSource.includes('<scroll-view scroll-y class="album-scroll">') ||
    albumSource.includes('class="album-scroll-content"')
  ) {
    fail("Album page must use native page scrolling; wrapping the album in scroll-view hides the fixed selection toolbar in WeChat DevTools");
  }
  if (
    albumSource.includes('<cover-view v-if="!timelineMode && selectionMode && !tagSheetPhoto" class="album-floating-toolbar">') ||
    !albumSource.includes('<root-portal :enable="!timelineMode && selectionMode && !tagSheetPhoto">') ||
    !albumSource.includes('<view v-if="!timelineMode && selectionMode && !tagSheetPhoto" class="album-floating-toolbar">')
  ) {
    fail("Album selection toolbar must render in a root-portal view so it survives scroll and selection rerenders");
  }
  if (
    !albumFloatingToolbarStyle.includes("height: 132rpx") ||
    !/(^|[;{\n\r])\s*position:\s*fixed/.test(albumFloatingToolbarStyle) ||
    !/(^|[;{\n\r])\s*bottom:\s*0/.test(albumFloatingToolbarStyle) ||
    !/(^|[;{\n\r])\s*left:\s*0/.test(albumFloatingToolbarStyle) ||
    !/(^|[;{\n\r])\s*right:\s*0/.test(albumFloatingToolbarStyle) ||
    !/(^|[;{\n\r])\s*z-index:\s*12000/.test(albumFloatingToolbarStyle) ||
    !/(^|[;{\n\r])\s*display:\s*flex/.test(albumFloatingToolbarStyle) ||
    !/(^|[;{\n\r])\s*gap:/.test(albumFloatingToolbarStyle) ||
    !albumFloatingToolbarStyle.includes("box-shadow:")
  ) {
    fail("Album selection toolbar must be a fixed bottom toolbar that paints immediately in WeChat DevTools");
  }
  if (!albumSelectionPageStyle.includes("padding-bottom: 190rpx")) {
    fail("Album selection mode must reserve scroll content space behind the fixed bottom toolbar");
  }
  if (
    !albumFloatingToolbarDisabledStyle.includes("background-color: #d7dbd6") ||
    !albumFloatingToolbarDisabledStyle.includes("color: #7a857d") ||
    !albumFloatingToolbarDisabledStyle.includes("opacity: 1")
  ) {
    fail("Album bulk toolbar action must be gray while disabled and become green after selecting photos");
  }
  const selectedTagTargetCountSource = methodBody(albumSource, "selectedTagTargetCount");
  if (
    !selectedTagTargetCountSource.includes('this.selectionModePurpose === "tag"') ||
    !selectedTagTargetCountSource.includes("return this.selectedTaggablePhotoIds.length")
  ) {
    fail("Album bulk tag button must become active after selecting taggable photos");
  }
  const openDownloadSelectionModeSource = methodBody(albumSource, "openDownloadSelectionMode");
  const openTagSelectionModeSource = methodBody(albumSource, "openTagSelectionMode");
  for (const [modeName, modeSource] of [
    ["download", openDownloadSelectionModeSource],
    ["tag", openTagSelectionModeSource]
  ]) {
    for (const requiredSelectionEntryText of [
      "this.closePhotoPreview()",
      "this.tagSheetPhoto = null",
      "this.bulkTagging = false",
      "this.selectedTagKeys = []"
    ]) {
      if (!modeSource.includes(requiredSelectionEntryText)) {
        fail(`Album ${modeName} selection mode must clear overlay state before showing the bottom toolbar: ${requiredSelectionEntryText}`);
      }
    }
  }
  for (const requiredAlbumAdminParityText of [
    "albumFilterOptions",
    "countAlbumPhotosForFilter",
    "selectedRoleFilter",
    "albumRoleFilterOptions",
    "albumFilterSegmentOptions",
    "handleAlbumFilterChange",
    "canSelectAlbumFilter",
    "handleRoleFilterChange",
    "photoMatchesSelectedRole",
    "roleFilterOptionLabel",
    "photoDetailText",
    "formatDate(photo.created_at)",
    "album-filter-panel",
    "角色"
  ]) {
    if (!albumSource.includes(requiredAlbumAdminParityText)) {
      fail(`Album page must match admin album filter and info affordances: ${requiredAlbumAdminParityText}`);
    }
  }
  for (const removedAlbumToolbarText of [
    "album-action-hint",
    "filter-panel-head",
    "filter-panel-title",
    "filter-panel-count",
    '<view class="album-action-hint">待标注 {{ filteredUntaggedPhotoCount }}</view>',
    '<view class="filter-panel-title">查看照片</view>',
    '<view class="filter-panel-count">当前 {{ filteredPhotos.length }} 张</view>'
  ]) {
    if (albumSource.includes(removedAlbumToolbarText)) {
      fail(`Album toolbar must not render duplicated filter or tag summary text: ${removedAlbumToolbarText}`);
    }
  }
  for (const removedAlbumHeaderMetricText of [
    "album-metrics",
    "album-metric",
    "metric-value",
    "metric-label",
    "我的照片",
    "当前筛选",
    "已标注",
    '<text class="metric-label">待标注</text>'
  ]) {
    if (albumSource.includes(removedAlbumHeaderMetricText)) {
      fail(`Album page must not show the removed header metric strip: ${removedAlbumHeaderMetricText}`);
    }
  }
  for (const removedAlbumTitleHeaderText of [
    "album-head-copy",
    "album-kicker",
    "album-title-row",
    "album-progress-badge",
    "album-intro",
    "{{ albumTitle }}",
    "{{ albumIntro }}",
    "车局影像",
    "标注 {{ filteredTagProgressPercent }}%"
  ]) {
    if (albumSource.includes(removedAlbumTitleHeaderText)) {
      fail(`Album page must not render the removed title header: ${removedAlbumTitleHeaderText}`);
    }
  }
  for (const requiredAlbumUploadButtonText of [
    "albumUploadButtonLabel",
    "album-upload-button-content",
    "album-upload-label",
    "album-upload-icon",
    "/static/icons/upload-bold.png",
    "albumUploadButtonCustomStyle",
    "--td-button-default-bg-color: #1f6f5b",
    "--td-button-default-color: #ffffff",
    "width: 48rpx",
    "[${roleName}·${scriptName}]",
    "载入中"
  ]) {
    if (!albumSource.includes(requiredAlbumUploadButtonText)) {
      fail(`Album upload action must show role/script label with upload icon: ${requiredAlbumUploadButtonText}`);
    }
  }
  const albumUploadButtonLabelSource = methodBody(albumSource, "albumUploadButtonLabel");
  for (const forbiddenAlbumUploadLabelFallbackText of [
    '|| "角色"',
    '|| "剧本"'
  ]) {
    if (albumUploadButtonLabelSource.includes(forbiddenAlbumUploadLabelFallbackText)) {
      fail(
        `Album upload label must show loading before real role/script names arrive: ${forbiddenAlbumUploadLabelFallbackText}`
      );
    }
  }
  if (!albumUploadButtonLabelSource.includes("!roleName || !scriptName")) {
    fail("Album upload label must show loading until both role and script names are available");
  }
  const albumUploadIconPath = path.join(srcRoot, "static/icons/upload-bold.png");
  if (!fs.existsSync(albumUploadIconPath)) {
    fail("Album upload action must use the generated bold upload icon asset");
  }
  if (albumSource.includes("rotate(180deg)")) {
    fail("Album upload action must not reuse the small rotated download icon");
  }
  if (albumSource.includes('{{ uploading ? "上传中..." : "上传照片" }}')) {
    fail("Album upload action must not render the old plain upload text");
  }
  if (albumSource.includes('{{ uploading ? "上传中..." : "上传第一张照片" }}')) {
    fail("Album empty upload action must reuse the role/script upload button content");
  }
  for (const requiredAlbumFilterLabel of [
    '{ value: "all", label: "全部" }',
    '{ value: "mine", label: "上传" }',
    '{ value: "withMe", label: "我的" }',
    '{ value: "untagged", label: "待标" }'
  ]) {
    if (!albumSource.includes(requiredAlbumFilterLabel)) {
      fail(`Album segmented filter labels must stay compact: ${requiredAlbumFilterLabel}`);
    }
  }
  for (const outdatedAlbumFilterLabel of [
    '{ value: "all", label: "我的照片" }',
    '{ value: "mine", label: "我上传的" }',
    '{ value: "untagged", label: "待标注" }'
  ]) {
    if (albumSource.includes(outdatedAlbumFilterLabel)) {
      fail(`Album segmented filter label is too long: ${outdatedAlbumFilterLabel}`);
    }
  }
  const albumFilterSegmentOptionsSource = methodBody(albumSource, "albumFilterSegmentOptions");
  const handleAlbumFilterChangeSource = methodBody(albumSource, "handleAlbumFilterChange");
  const canSelectAlbumFilterSource = methodBody(albumSource, "canSelectAlbumFilter");
  if (
    !albumFilterSegmentOptionsSource.includes("disabled: filter.count === 0") ||
    !albumSource.includes('@change="handleAlbumFilterChange"') ||
    !handleAlbumFilterChangeSource.includes("this.canSelectAlbumFilter(value)") ||
    !canSelectAlbumFilterSource.includes("option.count > 0") ||
    albumSource.includes('@change="activeFilter = $event.detail.value"')
  ) {
    fail("Album segmented filters with zero photos must be disabled and ignored when tapped");
  }
  for (const outdatedAlbumCardText of [
    "photo-info-grid",
    "photo-info-item",
    "photo-info-label",
    "photo-info-value",
    "photo-action-rail",
    "photo-caption-facts",
    "photo-caption-meta"
  ]) {
    if (albumSource.includes(outdatedAlbumCardText)) {
      fail(`Album photo cards must not use the bulky Info Ledger footer layout: ${outdatedAlbumCardText}`);
    }
  }
  for (const requiredAlbumCardCaptionText of [
    "photo-caption-body",
    "photo-caption-title",
    "photo-actions-row",
    "photo-status-slot",
    "photo-source-badge",
    "photo-source-icon",
    "photo-source-label",
    "photoSourceIcon(photo)",
    "/static/icons/user.png",
    "/static/icons/group.png",
    "photo-safe-actions",
    "photo-action-text",
    "photo-danger-action",
    "showPhotoInfo(photo)",
    '@longpress.stop="showPhotoInfo(photo)"',
    "图片信息",
    "上传者",
    "时间",
    "尺寸",
    "photoActionDateText(photo)"
  ]) {
    if (!albumSource.includes(requiredAlbumCardCaptionText)) {
      fail(`Album photo cards must use the compact caption footer layout: ${requiredAlbumCardCaptionText}`);
    }
  }
  if (/\.photo-meta\s*\{[\s\S]*min-height:\s*116rpx;/.test(albumSource)) {
    fail("Album photo card footer must not keep fixed 116rpx min-height after compact footer redesign");
  }
  if (/\.photo-upload-source\s*\{[\s\S]*line-height:\s*52rpx;/.test(albumSource)) {
    fail("Album photo source indicator must not rely on 52rpx text line-height that truncates in narrow cards");
  }
  assertBefore(
    albumSource,
    'class="photo-safe-actions"',
    'class="photo-action-text danger photo-danger-action"',
    "Album download and delete actions must be separated into safe and danger zones"
  );
  assertBefore(
    albumSource,
    'class="filter-row"',
    'class="role-filter-row"',
    "Album photo scope filters must appear before the role picker in the grouped filter panel"
  );
  for (const requiredAlbumDownloadText of [
    "downloading",
    "downloadProgressText",
    "downloadSinglePhoto",
    "downloadSelectedPhotos",
    "downloadAllPhotos",
    "confirmDownloadPhotos",
    "openDownloadSelectionMode",
    "saveImageToPhotosAlbum",
    "scope.writePhotosAlbum",
    "ensurePhotosAlbumPermission",
    "saveAlbumImageToPhotosAlbum",
    "全部下载",
    "多选下载",
    "下载所选",
    "下载照片",
    "this.downloading = true",
    "this.downloadProgressText = `正在保存 ${index + 1}/${photos.length} 张照片...`"
  ]) {
    if (!albumSource.includes(requiredAlbumDownloadText)) {
      fail(`Album page must support single, selected and all-photo downloads: ${requiredAlbumDownloadText}`);
    }
  }
  for (const requiredAlbumActionGroupText of [
    "album-primary-actions",
    "album-actions-shell",
    "album-sticky-actions",
    "topActionsFloating",
    "onPageScroll",
    "updateTopActionsFloating",
    "album-action-groups",
    "album-command-content",
    "album-command-icon",
    "album-privacy-button-content",
    "album-privacy-icon",
    "album-download-all-command",
    "album-download-selected-command",
    "album-tag-command",
    "/static/icons/album-download.svg",
    "/static/icons/album-select.svg",
    "/static/icons/album-tag-white.svg",
    "/static/icons/album-privacy.svg",
    "album-filter-panel",
    "角色",
    "openDownloadSelectionMode",
    "openTagSelectionMode"
  ]) {
    if (!albumSource.includes(requiredAlbumActionGroupText)) {
      fail(`Album page must group header actions by user task: ${requiredAlbumActionGroupText}`);
    }
  }
  for (const forbiddenAlbumActionGroupText of [
    "album-action-group-title",
    "album-download-action-group",
    "album-download-command-rail",
    "album-tag-action-group full",
    "album-tag-command-rail",
    "保存到手机",
    "整理标注"
  ]) {
    if (albumSource.includes(forbiddenAlbumActionGroupText)) {
      fail(`Album toolbar commands must render as one compact row: ${forbiddenAlbumActionGroupText}`);
    }
  }
  for (const forbiddenAlbumToolbarPngText of [
    "/static/icons/download.png",
    "/static/icons/check.png",
    "/static/icons/note.png",
    "/static/icons/album-download.png",
    "/static/icons/album-select.png",
    "/static/icons/album-tag-white.png",
    "/static/icons/album-privacy.png"
  ]) {
    if (albumSource.includes(forbiddenAlbumToolbarPngText)) {
      fail(`Album toolbar must use the custom vector icon set, not raster PNG icons: ${forbiddenAlbumToolbarPngText}`);
    }
  }
  for (const requiredAlbumToolbarIconPath of [
    "static/icons/album-download.svg",
    "static/icons/album-select.svg",
    "static/icons/album-tag-white.svg",
    "static/icons/album-privacy.svg"
  ]) {
    if (!fs.existsSync(path.join(srcRoot, requiredAlbumToolbarIconPath))) {
      fail(`Album toolbar custom vector icon asset is missing: ${requiredAlbumToolbarIconPath}`);
    }
  }
  const albumActionGroupsStyle = albumSource.match(/\.album-action-groups\s*\{[\s\S]*?\n\}/)?.[0] || "";
  if (
    !albumActionGroupsStyle.includes(
      "grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 2fr);"
    )
  ) {
    fail("Album toolbar commands must use 1/4, 1/4 and 1/2 column widths");
  }
  for (const requiredCompactAlbumCommandText of [
    "height: 52rpx",
    "min-height: 52rpx",
    "font-size: 23rpx",
    "width: 30rpx",
    "--td-button-default-bg-color: #1f6f5b",
    "--td-button-default-color: #ffffff",
    "--td-button-default-border-color: #1f6f5b"
  ]) {
    if (!albumSource.includes(requiredCompactAlbumCommandText)) {
      fail(`Album toolbar commands must match the selected compact primary/secondary mockup: ${requiredCompactAlbumCommandText}`);
    }
  }
  if (
    !albumSource.includes(':class="{ floating: topActionsFloating }"') ||
    !albumActionsShellFloatingStyle.includes("min-height:") ||
    !/(^|[;{\n\r])\s*position:\s*fixed/.test(albumStickyActionsFloatingStyle) ||
    !/(^|[;{\n\r])\s*top:\s*0/.test(albumStickyActionsFloatingStyle) ||
    !/(^|[;{\n\r])\s*left:\s*20rpx/.test(albumStickyActionsFloatingStyle) ||
    !/(^|[;{\n\r])\s*right:\s*20rpx/.test(albumStickyActionsFloatingStyle) ||
    !/(^|[;{\n\r])\s*z-index:\s*900/.test(albumStickyActionsFloatingStyle) ||
    !albumActionsStyle.includes("box-shadow:")
  ) {
    fail("Album header actions must become a fixed top toolbar while scrolling the photo list");
  }
  const albumStickyActionsIndex = albumSource.indexOf('class="album-actions album-sticky-actions"');
  const albumToolbarFilterIndex = albumSource.indexOf(
    'class="album-filter-panel album-toolbar-filter-panel"'
  );
  if (
    albumStickyActionsIndex < 0 ||
    albumToolbarFilterIndex < albumStickyActionsIndex ||
    !albumSource.includes(".album-toolbar-filter-panel") ||
    !albumToolbarFilterPanelStyle.includes("border-top:") ||
    !albumToolbarFilterPanelStyle.includes("background: transparent")
  ) {
    fail("Album filters must be attached to the fixed top toolbar while scrolling");
  }
  const downloadPhotosSource = methodBody(albumSource, "downloadPhotos");
  const confirmDownloadPhotosSource = methodBody(albumSource, "confirmDownloadPhotos");
  if (!downloadPhotosSource.includes("await this.confirmDownloadPhotos")) {
    fail("Album downloads must ask for confirmation before saving photos");
  }
  assertBefore(
    downloadPhotosSource,
    "await this.confirmDownloadPhotos",
    "this.downloading = true",
    "Album download confirmation must happen before entering downloading state"
  );
  for (const requiredDownloadConfirmText of [
    "showModal",
    "确认下载",
    "confirmText: \"下载\"",
    "resolve(Boolean(result.confirm))",
    "将保存这张照片到系统相册",
    "将保存所选",
    "将保存我的相册中"
  ]) {
    if (!confirmDownloadPhotosSource.includes(requiredDownloadConfirmText) && !albumSource.includes(requiredDownloadConfirmText)) {
      fail(`Album downloads must confirm every download entry point: ${requiredDownloadConfirmText}`);
    }
  }
  for (const requiredAlbumShareText of [
    "timelineMode",
    "albumShareToken",
    "loadPublicAlbum",
    "localAlbumShareSubject",
    "canRequestAlbumShareToken",
    "/album/public-share",
    "/album/share-token",
    "entry=album",
    "source: \"wechat_timeline\"",
    "albumTimelineQuery",
    "showWechatShareMenus",
    "(!this.timelineMode && !token)"
  ]) {
    if (!albumSource.includes(requiredAlbumShareText)) {
      fail(`Album page must support D23 group/Moments album sharing: ${requiredAlbumShareText}`);
    }
  }
  const albumOnLoadSource = methodBody(albumSource, "onLoad");
  const albumOnShowSource = methodBody(albumSource, "onShow");
  const previewPhotoSource = methodBody(albumSource, "previewPhoto");
  assertBefore(
    albumOnLoadSource,
    "if (this.timelineMode)",
    "ensureLoggedIn",
    "Album timeline mode must load public album before any login prompt"
  );
  for (const requiredAlbumPreviewLifecycleText of [
    "skipNextAlbumRefreshOnShow",
    "consumePreviewReturnRefreshSkip",
    "this.skipNextAlbumRefreshOnShow = false"
  ]) {
    if (!albumSource.includes(requiredAlbumPreviewLifecycleText)) {
      fail(`Album photo preview must not refresh the whole album after closing: ${requiredAlbumPreviewLifecycleText}`);
    }
  }
  assertBefore(
    albumOnShowSource,
    "consumePreviewReturnRefreshSkip",
    "albumMediaRefresh?.refresh",
    "Album onShow must consume photo-preview return before refreshing the member album"
  );
  if ((albumOnShowSource.match(/albumMediaRefresh\?\.refresh\(\)/g) || []).length < 2) {
    fail("Album onShow must consume photo-preview return before refreshing the public album");
  }
  const albumPageConfig = pages.find((page) => page.path === "pages/session/album") || {};
  const albumUsingComponents = albumPageConfig.style?.usingComponents || {};
  if (albumUsingComponents["t-image-viewer"]) {
    fail("Album page must not register TDesign ImageViewer for the native non-sliding preview");
  }
  const tdesignImageViewerSourcePath = path.join(
    srcRoot,
    "wxcomponents/tdesign-miniprogram/image-viewer"
  );
  if (fs.existsSync(tdesignImageViewerSourcePath)) {
    fail("Unused TDesign ImageViewer source directory must be removed from the mini-program");
  }
  if (!apiServerSource) {
    fail("API server source must be readable for album direct media URL checks");
  }
  for (const requiredAlbumDirectMediaText of [
    "const SESSION_ALBUM_DISPLAY_JPG_RULE =",
    "thumbnail/2048x2048>",
    "format/jpg/quality/85",
    "rule: SESSION_ALBUM_DISPLAY_JPG_RULE",
    "const SESSION_ALBUM_THUMBNAIL_RULE =",
    "thumbnail/640x640>",
    "format/jpg/quality/75",
    'throw forbidden(`${label} is invalid`)',
    'throw forbidden(`${label} expired`)',
    "function signSessionAlbumDirectMediaToken(payload)",
    'signSignedPayload("session-album-media"',
    "function verifySessionAlbumDirectMediaQuery(photoId, query)",
    "if (tokenPhotoId !== Number(photoId))",
    'sessionId: tokenPositiveInteger(payload.sessionId, "sessionId")',
    'userId: tokenPositiveInteger(payload.userId, "userId")',
    'photoId: tokenPositiveInteger(payload.photoId, "photoId")',
    'variant: mediaVariantName(payload.variant || "preview")',
    'exp: tokenPositiveInteger(payload.exp, "exp")',
    "function sessionAlbumDirectMediaPath(photoId, album, userId, variant = \"preview\")",
    'previewLoad: sessionAlbumDirectMediaPath(photo.id, album, userId, "preview")',
    'thumbnailLoad: sessionAlbumDirectMediaPath(photo.id, album, userId, "thumbnail")',
    "const data = attachSessionAlbumMediaUrls(album, user.user.id)",
    'const directMediaToken = url.searchParams.get("token") || ""',
    "if (directMediaToken)",
    "if (claims.variant !== variant)",
    "if (Number(photo.session_id) !== claims.sessionId)",
    'options.variant === "thumbnail" ? SESSION_ALBUM_THUMBNAIL_RULE : undefined'
  ]) {
    if (!apiServerSource.includes(requiredAlbumDirectMediaText)) {
      fail(`API session album media must expose stable direct-load preview URLs: ${requiredAlbumDirectMediaText}`);
    }
  }
  const sessionAlbumMediaRouteStart = apiServerSource.indexOf("const sessionAlbumMediaPhotoId = idMatch");
  const sessionAlbumMediaRouteEnd = apiServerSource.indexOf(
    'if (request.method === "POST" && url.pathname === "/api/users/me/avatar")'
  );
  const sessionAlbumMediaRouteSource =
    sessionAlbumMediaRouteStart >= 0 && sessionAlbumMediaRouteEnd > sessionAlbumMediaRouteStart
      ? apiServerSource.slice(sessionAlbumMediaRouteStart, sessionAlbumMediaRouteEnd)
      : "";
  if (!sessionAlbumMediaRouteSource) {
    fail("API session album media route must be readable for direct token checks");
  }
  assertBefore(
    sessionAlbumMediaRouteSource,
    "if (directMediaToken)",
    "const user = await getAuthUser(request)",
    "Album direct media token must allow image loading before Authorization is required"
  );
  assertBefore(
    sessionAlbumMediaRouteSource,
    "verifySessionAlbumDirectMediaQuery",
    "getVisibleSessionAlbumPhotoForMedia",
    "Album direct media token must be validated before visible media is served"
  );
  if (!albumImageViewerSource) {
    fail("AlbumImageViewer component must exist for D31 preview");
  }
  for (const requiredAlbumViewerWindowText of [
    "const ALBUM_VIEWER_WINDOW_SIZE = 5;",
    'v-for="generation in swiperGenerations"',
    ':key="generation"',
    ':data-generation="generation"',
    '@animationfinish="handleSwiperAnimationFinish"',
    'v-for="(photo, windowIndex) in windowPhotos"',
    ':key="photoKey(photo, logicalIndexForWindowIndex(windowIndex))"',
    "isActiveVideo(logicalIndexForWindowIndex(windowIndex))",
    "videoDomId(photo, logicalIndexForWindowIndex(windowIndex))"
  ]) {
    if (!albumImageViewerSource.includes(requiredAlbumViewerWindowText)) {
      fail(`AlbumImageViewer must implement five-slide windowing: ${requiredAlbumViewerWindowText}`);
    }
  }
  if (albumImageViewerSource.includes(':data-generation="swiperGeneration"')) {
    fail("AlbumImageViewer swiper must not use a non-structural swiperGeneration data binding");
  }
  const albumViewerSwiperGenerationsSource = methodBody(
    albumImageViewerSource,
    "swiperGenerations"
  );
  if (!albumViewerSwiperGenerationsSource.includes("return [this.swiperGeneration]")) {
    fail("AlbumImageViewer swiperGenerations must expose exactly the current generation token");
  }
  const albumViewerWindowPhotosSource = methodBody(albumImageViewerSource, "windowPhotos");
  for (const requiredWindowPhotosText of [
    "this.photos.slice(",
    "this.windowStart + ALBUM_VIEWER_WINDOW_SIZE"
  ]) {
    if (!albumViewerWindowPhotosSource.includes(requiredWindowPhotosText)) {
      fail(`AlbumImageViewer windowPhotos must slice the five-slide logical window: ${requiredWindowPhotosText}`);
    }
  }
  for (const requiredAlbumImageViewerText of [
    "thumbnail_display_url",
    "previewLoadedById",
    "previewFailedById",
    "thumbnailLoadedById",
    "thumbnailFailedById",
    "$emit(\"download\"",
    "allowDownload",
    "mediaProgress",
    "loadingProgressText(photo)",
    "album-image-viewer__loading-progress-bar",
    "previewCanLoad(photo)",
    "handlePreviewLoad",
    "handlePreviewError",
    "handleThumbnailLoad",
    "handleThumbnailError"
  ]) {
    if (!albumImageViewerSource.includes(requiredAlbumImageViewerText)) {
      fail(`AlbumImageViewer must implement D31 viewer behavior: ${requiredAlbumImageViewerText}`);
    }
  }
  if (
    !albumImageViewerSource.includes('v-if="previewCanLoad(photo) && !previewFailed(photo)"') &&
    !albumImageViewerSource.includes('v-if="isImage(photo) && previewCanLoad(photo) && !previewFailed(photo)"')
  ) {
    fail("AlbumImageViewer preview image must wait for thumbnail load before mounting");
  }
  const albumViewerCounterSource = methodBody(albumImageViewerSource, "counterText");
  if (!albumViewerCounterSource.includes("this.currentIndex + 1")) {
    fail("AlbumImageViewer counter must display the 1-based current index");
  }
  if (!albumViewerCounterSource.includes("this.photos.length")) {
    fail("AlbumImageViewer counter must display the full preview photo count");
  }
  const albumViewerSwiperChangeSource = methodBody(albumImageViewerSource, "handleSwiperChange");
  for (const requiredSwiperChangeText of [
    "this.isCurrentSwiperEvent(event)",
    "this.windowPhotos.length",
    "event?.detail?.current",
    "this.windowStart + windowIndex",
    "this.activeWindowIndex = windowIndex",
    "this.updatePendingWindowRebase(windowIndex, nextIndex)",
    "this.currentIndex = nextIndex",
    'this.$emit("change"'
  ]) {
    if (!albumViewerSwiperChangeSource.includes(requiredSwiperChangeText)) {
      fail(`AlbumImageViewer must map window swipes to logical state: ${requiredSwiperChangeText}`);
    }
  }
  for (const forbiddenSwiperChangeText of [
    "this.swiperIndex",
    "this.windowStart =",
    "this.swiperGeneration",
    "this.rebuildWindowAt("
  ]) {
    if (albumViewerSwiperChangeSource.includes(forbiddenSwiperChangeText)) {
      fail(`AlbumImageViewer native change handler must not mutate window structure: ${forbiddenSwiperChangeText}`);
    }
  }
  const albumViewerSyncInitialIndexSource = methodBody(albumImageViewerSource, "syncInitialIndex");
  if (!albumViewerSyncInitialIndexSource.includes("this.rebuildWindowAt(nextIndex)")) {
    fail("AlbumImageViewer initial index sync must rebuild the logical window at nextIndex");
  }
  const albumViewerGenerationGuardSource = methodBody(albumImageViewerSource, "isCurrentSwiperEvent");
  for (const requiredGenerationGuardText of [
    "Number(event?.currentTarget?.dataset?.generation)",
    "Number.isFinite(generation)",
    "generation === this.swiperGeneration"
  ]) {
    if (!albumViewerGenerationGuardSource.includes(requiredGenerationGuardText)) {
      fail(`AlbumImageViewer native event generation guard is missing: ${requiredGenerationGuardText}`);
    }
  }
  const albumViewerAnimationFinishSource = methodBody(
    albumImageViewerSource,
    "handleSwiperAnimationFinish"
  );
  for (const requiredAnimationFinishText of [
    "this.isCurrentSwiperEvent(event)",
    "this.pendingWindowRebase",
    "event?.detail?.current",
    "this.logicalIndexForWindowIndex(finishedWindowIndex)",
    "pending.generation !== this.swiperGeneration",
    "pending.logicalIndex !== this.currentIndex",
    "finishedLogicalIndex !== pending.logicalIndex",
    "this.windowStartForIndex(this.currentIndex)",
    "this.rebuildWindowAt(this.currentIndex, { internalRebase: true })"
  ]) {
    if (!albumViewerAnimationFinishSource.includes(requiredAnimationFinishText)) {
      fail(`AlbumImageViewer animationfinish validation is missing: ${requiredAnimationFinishText}`);
    }
  }
  const albumViewerPhotosWatcherSource = methodBody(albumImageViewerSource, "photos");
  if (
    !albumViewerPhotosWatcherSource.includes("syncCurrentIndexAfterPhotosChange(") ||
    !albumViewerPhotosWatcherSource.includes("nextPhotos") ||
    !albumViewerPhotosWatcherSource.includes("previousPhotos")
  ) {
    fail("AlbumImageViewer photos watcher must distinguish hydration from structure changes");
  }
  const albumViewerPhotosSyncSource = methodBody(
    albumImageViewerSource,
    "syncCurrentIndexAfterPhotosChange"
  );
  for (const requiredPhotosSyncText of [
    "this.samePhotoStructure",
    "previousPhotos[previousIndex]",
    "this.pauseVideoPhoto",
    "this.rebuildWindowAt(nextIndex, { force: true })"
  ]) {
    if (!albumViewerPhotosSyncSource.includes(requiredPhotosSyncText)) {
      fail(`AlbumImageViewer structure sync is missing ${requiredPhotosSyncText}`);
    }
  }
  const albumViewerThumbnailUrlSource = methodBody(albumImageViewerSource, "thumbnailUrl");
  if (!albumViewerThumbnailUrlSource.includes("photo?.thumbnail_display_url")) {
    fail("AlbumImageViewer must prefer cached visible thumbnails before remote thumbnail URLs");
  }
  if (
    albumViewerThumbnailUrlSource.includes("thumbnail_load_url") ||
    albumViewerThumbnailUrlSource.includes("thumbnail_url")
  ) {
    fail("AlbumImageViewer thumbnail image must not render remote album URLs directly");
  }
  if (!albumViewerThumbnailUrlSource.includes("thumbnail !== preview")) {
    fail("AlbumImageViewer must not render duplicate thumbnail/preview layers for the same URL");
  }
  const albumViewerPreviewUrlSource = methodBody(albumImageViewerSource, "previewUrl");
  if (!albumViewerPreviewUrlSource.includes("photo?.preview_display_url")) {
    fail("AlbumImageViewer must prefer cached visible previews before remote preview URLs");
  }
  if (
    albumViewerPreviewUrlSource.includes("preview_load_url") ||
    albumViewerPreviewUrlSource.includes("preview_url") ||
    albumViewerPreviewUrlSource.includes("image_url")
  ) {
    fail("AlbumImageViewer preview image must not render remote album URLs directly");
  }
  if (!albumSource.includes("viewerPhotoWithCachedMedia(photo)")) {
    fail("Album D31 preview must pass cached list thumbnails into the image viewer");
  }
  for (const requiredAlbumMediaProgressText of [
    "mediaProgressById",
    "setAlbumMediaProgress",
    "onProgressUpdate",
    "progress: progress.progress",
    "uni.downloadFile",
    ':media-progress="previewMediaProgress"'
  ]) {
    if (!albumSource.includes(requiredAlbumMediaProgressText)) {
      fail(`Album D31 preview must expose local media download progress to the viewer: ${requiredAlbumMediaProgressText}`);
    }
  }
  if (!albumSource.includes(':media-progress="previewMediaProgress"')) {
    fail("Album preview must pass previewMediaProgress to AlbumImageViewer");
  }
  if (albumSource.includes(':media-progress="mediaProgressById"')) {
    fail("Album preview must not pass the full media progress map");
  }

  const previewMediaProgressSource = methodBody(albumSource, "previewMediaProgress");
  for (const requiredText of [
    "this.previewCurrentIndex",
    "this.previewPhotos",
    '["thumbnail", "preview"]',
    "this.mediaProgressById[key]"
  ]) {
    if (!previewMediaProgressSource.includes(requiredText)) {
      fail("Album preview progress window is missing " + requiredText);
    }
  }

  const setAlbumMediaProgressSource = methodBody(albumSource, "setAlbumMediaProgress");
  if (
    !setAlbumMediaProgressSource.includes("this.mediaProgressById[key] =") ||
    setAlbumMediaProgressSource.includes("this.mediaProgressById =")
  ) {
    fail("Album progress must update one key without replacing the root map");
  }

  const updatePreviewMediaSource = methodBody(
    albumSource,
    "updatePreviewPhotoDisplayMedia"
  );
  if (
    !updatePreviewMediaSource.includes("this.previewPhotos.findIndex") ||
    !updatePreviewMediaSource.includes("this.previewPhotos.splice") ||
    updatePreviewMediaSource.includes(".map(")
  ) {
    fail("Album preview hydration must replace only one matching photo");
  }

  const ensurePreviewMediaAroundSource = methodBody(albumSource, "ensurePreviewMediaAround");
  for (const requiredText of ["center - 2", "center + 3"]) {
    if (!ensurePreviewMediaAroundSource.includes(requiredText)) {
      fail("Album preview media range is missing " + requiredText);
    }
  }
  const albumDownloadOnceSource = methodBody(albumSource, "downloadAlbumImageOnce");
  if (!albumSource.includes("requestAlbumImageOnce(photo, variant")) {
    fail("Album D31 media download must fall back to request-based cache writes when downloadFile is unavailable");
  }
  if (/uni\.downloadFile\(\{[\s\S]*?\bfilePath\b/.test(albumDownloadOnceSource)) {
    fail("Album D31 media download must not pass a persistent cache filePath directly to uni.downloadFile");
  }
  for (const requiredAlbumPreviewMediaHydrationText of [
    "ensurePreviewMediaAround(currentIndex)",
    "updatePreviewPhotoDisplayMedia(photo.id",
    'this.loadVisiblePhotoMedia(photo, "preview")'
  ]) {
    if (!albumSource.includes(requiredAlbumPreviewMediaHydrationText)) {
      fail(`Album D31 preview must hydrate local viewer media instead of using remote image URLs: ${requiredAlbumPreviewMediaHydrationText}`);
    }
  }
  if (!albumSource.includes("thumbnail_display_url: visibleMedia.thumbnail")) {
    fail("Album D31 preview must use visiblePhotoMedia thumbnail cache as the viewer thumbnail");
  }
  const viewerPhotoWithCachedMediaSource = methodBody(albumSource, "viewerPhotoWithCachedMedia");
  if (!viewerPhotoWithCachedMediaSource.includes("preview_display_url: visibleMedia.preview")) {
    fail("Album D31 preview must pass cached list preview media into the image viewer");
  }
  for (const requiredAlbumThumbnailGateText of [
    "listThumbnailLoadedById",
    "listThumbnailFailedById",
    "@load=\"handleListThumbnailLoad(photo)\"",
    "@error=\"handleListThumbnailError(photo)\"",
    "canOpenPhotoPreview(photo)",
    "listThumbnailLoaded(photo)"
  ]) {
    if (!albumSource.includes(requiredAlbumThumbnailGateText)) {
      fail(
        `Album D31 preview must block opening until the list thumbnail image has loaded: ${requiredAlbumThumbnailGateText}`
      );
    }
  }
  const albumThumbnailGatePreviewPhotoSource = methodBody(albumSource, "previewPhoto");
  if (!albumThumbnailGatePreviewPhotoSource.includes("!this.canOpenPhotoPreview(photo)")) {
    fail("Album D31 preview must ignore taps while the list thumbnail image is still loading");
  }
  if (!albumThumbnailGatePreviewPhotoSource.includes("return")) {
    fail("Album D31 preview thumbnail-loading guard must return before opening preview");
  }
  for (const forbiddenAlbumImageViewerText of [
    "getToken",
    "downloadSinglePhoto",
    "saveImageToPhotosAlbum",
    "uni.request",
    "getFileSystemManager"
  ]) {
    if (albumImageViewerSource.includes(forbiddenAlbumImageViewerText)) {
      fail(`AlbumImageViewer must not own album download business: ${forbiddenAlbumImageViewerText}`);
    }
  }
  for (const forbiddenAlbumImageViewerDownloadTrigger of [
    "@longpress",
    "@longtap",
    "requestDownload('longpress')",
    'requestDownload("longpress")'
  ]) {
    if (albumImageViewerSource.includes(forbiddenAlbumImageViewerDownloadTrigger)) {
      fail(
        `AlbumImageViewer preview surface must not trigger download on long press: ${forbiddenAlbumImageViewerDownloadTrigger}`
      );
    }
  }
  for (const requiredAlbumImageViewerIntegrationText of [
    'import AlbumImageViewer from "../../components/AlbumImageViewer.vue"',
    "components: { AuthIdentityBar, RoleSeatBoard, FeedbackHost, AlbumImageViewer }",
    "<AlbumImageViewer",
    ':allow-download="previewAllowsDownload"',
    "previewAllowsDownload()",
    "return !this.timelineMode && this.isDownloadableAlbumImage(this.previewCurrentPhoto)",
    '@download="handlePreviewDownload"',
    "handlePreviewChange(event)",
    "handlePreviewDownload(event)",
    "this.downloadSinglePhoto(photo)"
  ]) {
    if (!albumSource.includes(requiredAlbumImageViewerIntegrationText)) {
      fail(`Album page must integrate AlbumImageViewer for D31: ${requiredAlbumImageViewerIntegrationText}`);
    }
  }
  for (const forbiddenInlineAlbumPreviewText of [
    'class="photo-preview-mask"',
    'class="photo-preview-swiper"',
    "previewSwiperIndex",
    "previewTouchStartX",
    "handlePreviewSwiperChange",
    "handlePreviewTouchStart",
    "handlePreviewTouchEnd",
    "photoPreviewImageUrl(photo)",
    "hydratePreviewWindow(centerIndex)"
  ]) {
    if (albumSource.includes(forbiddenInlineAlbumPreviewText)) {
      fail(`Album page must move inline preview behavior into AlbumImageViewer: ${forbiddenInlineAlbumPreviewText}`);
    }
  }
  const openPhotoPreviewSource = methodBody(albumSource, "openPhotoPreview");
  if (!/this\.filteredPhotos\s*\.filter\(/.test(openPhotoPreviewSource)) {
    fail("Album D31 preview must build its preview list from the current filtered photos");
  }
  if (openPhotoPreviewSource.includes(".reverse()")) {
    fail("Album D31 preview order must match the visible filtered photo order");
  }
  if (!openPhotoPreviewSource.includes("this.previewPhotos = previewPhotos")) {
    fail("Album D31 preview must assign the filtered preview list");
  }
  if (!openPhotoPreviewSource.includes("this.previewInitialIndex = currentIndex")) {
    fail("Album D31 preview must set previewInitialIndex only when opening");
  }
  const normalizePhotoMediaSource = methodBody(albumSource, "normalizePhotoMedia");
  if (!normalizePhotoMediaSource.includes("this.normalizeAlbumMediaUrl")) {
    fail("Album D31 preview media URLs must be normalized before image components receive them");
  }
  const normalizeAlbumMediaUrlSource = methodBody(albumSource, "normalizeAlbumMediaUrl");
  if (!normalizeAlbumMediaUrlSource.includes("apiUrl(path)")) {
    fail("Album D31 preview media URL normalization must expand /api relative URLs with apiUrl()");
  }
  if (!normalizeAlbumMediaUrlSource.includes("/^https?\\/\\//i.test(path)")) {
    fail("Album media URL normalization must accept absolute http(s) URLs without apiUrl()");
  }
  if (!normalizeAlbumMediaUrlSource.includes("path.replace(/^(https?)\\/\\//i")) {
    fail("Album media URL normalization must repair malformed http(s)// URLs from signed media endpoints");
  }
  for (const forbiddenAlbumPreviewText of [
    "<t-image-viewer",
    "previewViewerCustomStyle",
    "previewImageProps",
    ":show-index",
    'close-btn="close"',
    '@change="handlePreviewImageViewerChange"',
    "handlePreviewImageViewerChange",
    "previewContextPhotosForPhoto",
    "uniquePreviewPhotos",
    "prewarmPreviewUrls",
    "hydratePreviewPhoto",
    "replacePreviewImageUrlAtIndex",
    "previewImageUrlForIndex(index)",
    "syncPreviewImageUrlsForWindow(centerIndex)",
    "this.syncPreviewImageUrlsForWindow",
    "syncPreviewImageUrlAtIndex(index",
    "this.syncPreviewImageUrlAtIndex",
    "preparePhotoPreviewUrls"
  ]) {
    if (albumSource.includes(forbiddenAlbumPreviewText)) {
      fail(`Album D31 preview must not keep TDesign ImageViewer dynamic-image logic: ${forbiddenAlbumPreviewText}`);
    }
  }
  const mediaUrlForPhotoSource = methodBody(albumSource, "mediaUrlForPhoto");
  for (const requiredMediaUrlSourceText of [
    "photo.thumbnail_load_url",
    "photo.preview_load_url",
    "photo.thumbnail_url",
    "photo.preview_url"
  ]) {
    if (!mediaUrlForPhotoSource.includes(requiredMediaUrlSourceText)) {
      fail(`Album media download URL selection must prefer direct-load URLs before expiring legacy URLs: ${requiredMediaUrlSourceText}`);
    }
  }
  if (
    albumSource.includes(
      "this.photoCachedPreviewUrl(photo) || this.visiblePhotoMedia[photo.id]?.thumbnail || \"\""
    )
  ) {
    fail("Album preview image URLs must use a stable placeholder instead of empty strings");
  }
  if (
    albumSource.includes("const previewLoadUrl = photo.preview_load_url || previewUrl || imageUrl")
  ) {
    fail("Album direct media URL normalization must not collapse direct-load URLs back to legacy preview URLs");
  }
  if (previewPhotoSource.includes("uni.showLoading") || previewPhotoSource.includes("uni.previewImage")) {
    fail("Album D31 preview must not use blocking native previewImage");
  }
  if (albumSource.includes("createIntersectionObserver(this)")) {
    fail("Album visible photo observer must not pass the Vue component proxy to createIntersectionObserver");
  }
  for (const [packageRoot, packageLabel] of [
    [miniprogramDevRoot, "Dev package"],
    [miniprogramBuildRoot, "Build package"]
  ]) {
    const builtAlbumWxmlPath = path.join(packageRoot, "pages/session/album.wxml");
    if (!fs.existsSync(builtAlbumWxmlPath)) {
      continue;
    }
    const builtAlbumWxml = fs.readFileSync(builtAlbumWxmlPath, "utf8");
    if (builtAlbumWxml.includes("<t-image-viewer")) {
      fail(`${packageLabel} album preview must not render TDesign ImageViewer`);
    }
  }
  for (const [packageRoot, packageLabel] of [
    [miniprogramDevRoot, "Dev package"],
    [miniprogramBuildRoot, "Build package"]
  ]) {
    const builtTdesignIconWxssPath = path.join(
      packageRoot,
      "wxcomponents/tdesign-miniprogram/icon/icon.wxss"
    );
    if (!fs.existsSync(builtTdesignIconWxssPath)) {
      continue;
    }
    const builtTdesignIconWxss = fs.readFileSync(builtTdesignIconWxssPath, "utf8");
    if (builtTdesignIconWxss.includes("tdesign.gtimg.com")) {
      fail(`${packageLabel} TDesign icon styles must not load remote icon fonts in the mini-program`);
    }
  }
  const albumShareAppMessageSource = methodBody(albumSource, "onShareAppMessage");
  if (
    !albumShareAppMessageSource.includes("/pages/session/share") ||
    !albumShareAppMessageSource.includes("entry=album") ||
    !albumShareAppMessageSource.includes("source=wechat_share")
  ) {
    fail("Album friend/group sharing must route to the album-entry share page");
  }
  if (
    albumShareAppMessageSource.includes('"车局相册"') ||
    albumShareAppMessageSource.includes("'车局相册'")
  ) {
    fail("Album friend/group sharing title must include script and store names, not generic 车局相册");
  }
  if (!albumShareAppMessageSource.includes("imageUrl:")) {
    fail("Album friend/group sharing must set a privacy-safe imageUrl instead of using the live page screenshot");
  }
  const albumShareTitleSource = methodBody(albumSource, "albumShareTitle");
  if (
    !albumShareTitleSource.includes("albumShareSessionTitle") ||
    !albumShareTitleSource.includes("相册邀请")
  ) {
    fail("Album friend/group sharing title must include script and store names with 相册邀请");
  }
  const albumShareSessionTitleSource = methodBody(albumSource, "albumShareSessionTitle");
  if (
    !albumShareSessionTitleSource.includes("albumScriptName") ||
    !albumShareSessionTitleSource.includes("albumStoreName")
  ) {
    fail("Album sharing session title must be built from script and store names");
  }
  const albumShareTimelineSource = methodBody(albumSource, "onShareTimeline");
  if (!albumShareTimelineSource.includes("query:") || albumShareTimelineSource.includes("path:")) {
    fail("Album Moments sharing must return query only");
  }
  const ensureAlbumShareTokenSource = methodBody(albumSource, "ensureAlbumShareToken");
  assertBefore(
    ensureAlbumShareTokenSource,
    "canRequestAlbumShareToken",
    "/album/share-token",
    "Album share token prefetch must check for a confirmed local seat before requesting the token endpoint"
  );
  if (!ensureAlbumShareTokenSource.includes("this.shareSubject = null")) {
    fail("Album share token prefetch must clear share subject when the current user cannot create a seat-scoped token");
  }
  for (const requiredAlbumReadOnlyText of [
    'v-if="!timelineMode && (canUpload || photos.length || taggablePhotos.length)"',
    'class="album-filter-panel album-toolbar-filter-panel"',
    'v-if="!timelineMode && selectionMode"'
  ]) {
    if (!albumSource.includes(requiredAlbumReadOnlyText)) {
      fail(`Album timeline mode must hide member-only controls: ${requiredAlbumReadOnlyText}`);
    }
  }
  if (
    !albumSource.includes(':visible="tagSheetVisible"') ||
    !albumSource.includes("tagSheetVisible()") ||
    !albumSource.includes("return !this.timelineMode && Boolean(this.tagSheetPhoto)")
  ) {
    fail("Album timeline mode must hide member-only controls: tagSheetVisible");
  }

  const apiSource = fs.readFileSync(path.join(srcRoot, "utils/api.js"), "utf8");
  for (const requiredAuthGuardText of [
    "export async function ensureLoggedIn",
    "showModal",
    "uni.login",
    "setAuth(data)",
    "pinche-auth-change"
  ]) {
    if (!apiSource.includes(requiredAuthGuardText)) {
      fail(`Shared auth guard is missing ${requiredAuthGuardText}`);
    }
  }
  for (const requiredBackendStatusText of [
    "BACKEND_STATUS_CHANGE_EVENT",
    "export function getBackendStatus",
    "export function checkBackendHealth",
    "export function markBackendMaintenance",
    "export function clearBackendMaintenance",
    "export function shouldBlockBusinessRequests",
    "allowDuringMaintenance",
    "/health",
    "maintenance: true"
  ]) {
    if (!apiSource.includes(requiredBackendStatusText)) {
      fail(`Backend maintenance status support is missing ${requiredBackendStatusText}`);
    }
  }
  for (const requiredPhoneAuthText of [
    "AUTH_PHONE_REQUEST_EVENT",
    "AUTH_PHONE_RESPONSE_EVENT",
    "refreshCurrentAuth",
    "updateUserPhoneFromWechatPhoneCode",
    "ensureUserPhone",
    "requirePhone === true",
    "/api/auth/wechat/phone"
  ]) {
    if (!apiSource.includes(requiredPhoneAuthText)) {
      fail(`Shared phone authorization support is missing ${requiredPhoneAuthText}`);
    }
  }
  const ensureLoggedInSource = methodBody(apiSource, "ensureLoggedIn");
  if (ensureLoggedInSource.includes("promptPhoneAfterLogin: true")) {
    fail("Shared login must not force phone authorization immediately after fresh login");
  }
  if (!ensureLoggedInSource.includes("options.requireGender === true")) {
    fail("Shared login must only request profile gender when a protected action explicitly requires it");
  }
  const loginWithWechatSource = methodBody(apiSource, "loginWithWechat");
  if (
    !loginWithWechatSource.includes("fail(loginError)") ||
    !loginWithWechatSource.includes("resolveWechatLoginCode({}, options)") ||
    !loginWithWechatSource.includes("reject(loginError)")
  ) {
    fail("Shared login must fall back to local devCode when wx.login fails in local DevTools mode");
  }
  const logoutRedirectSource = methodBody(apiSource, "goHomeAfterLogout");
  if (!logoutRedirectSource.includes('uni.reLaunch({ url: "/pages/index/index" })')) {
    fail("Shared logout helper must relaunch the home entry page");
  }

  const identityBarPath = path.join(srcRoot, "components/AuthIdentityBar.vue");
  if (!fs.existsSync(identityBarPath)) {
    fail(`Missing shared auth identity bar: ${identityBarPath}`);
  } else {
    const identityBarSource = fs.readFileSync(identityBarPath, "utf8");
    for (const requiredIdentityText of [
      "已登录",
      "退出登录",
      "clearAuth",
      "logoutProfile",
      "rolesText",
      "AUTH_CHANGE_EVENT",
      "getCurrentUser",
      "goLoginPage",
      "passiveGuest",
      "handleIdentityTap",
      "overflow: hidden",
      "white-space: nowrap"
    ]) {
      if (!identityBarSource.includes(requiredIdentityText)) {
        fail(`Auth identity bar must display and refresh identity: ${requiredIdentityText}`);
      }
    }
    if (identityBarSource.includes("loginFromIdentityBar") || identityBarSource.includes("ensureLoggedIn")) {
      fail("Logged-out identity bar must link to the login page instead of opening authorization directly");
    }
    const identityTapSource = methodBody(identityBarSource, "handleIdentityTap");
    if (!identityTapSource.includes('this.$emit("guest-login")')) {
      fail("Passive guest identity bar must emit a login request when tapped");
    }
    if (
      !identityBarSource.includes("<button") ||
      !identityBarSource.includes('class="auth-profile-trigger"') ||
      !identityBarSource.includes("plain") ||
      !identityBarSource.includes('@tap.stop="handleIdentityTap"')
    ) {
      fail("Auth identity bar profile summary must use a native button tap target for opening profile settings");
    }
    if (identityBarSource.includes("<t-popup")) {
      fail("Auth identity bar profile and phone modals must use native profile-mask views instead of TDesign popup");
    }
    for (const requiredIdentityModalText of [
      '<view v-if="profileVisible" class="profile-mask" @tap="handleProfileBackdropTap">',
      '<view v-if="phoneVisible" class="profile-mask" @tap="handlePhoneBackdropTap">'
    ]) {
      if (!identityBarSource.includes(requiredIdentityModalText)) {
        fail(`Auth identity bar modal must render from native mask: ${requiredIdentityModalText}`);
      }
    }
    const identityLogoutSource = methodBody(identityBarSource, "logoutProfile");
    if (!identityLogoutSource.includes("goHomeAfterLogout")) {
      fail("Auth identity bar logout must relaunch the home entry after clearing auth");
    }
    for (const requiredPhoneModalText of [
      "phoneVisible",
      "handlePhoneRequest",
      'open-type="getPhoneNumber"',
      "getphonenumber",
      "创建车或上车前需要授权手机号"
    ]) {
      if (!identityBarSource.includes(requiredPhoneModalText)) {
        fail(`Auth identity bar phone authorization is missing ${requiredPhoneModalText}`);
      }
    }
    const identityBarStyle = identityBarSource.match(/\.auth-identity-bar\s*\{([\s\S]*?)\n\}/)?.[1] || "";
    if (!/\n\s*height:\s*56rpx;/.test(`\n${identityBarStyle}`)) {
      fail("Auth identity bar must use the fixed second-page height: 56rpx");
    }
    if (/\n\s*min-height:/.test(`\n${identityBarStyle}`)) {
      fail("Auth identity bar must not rely on min-height because it can vary across pages");
    }
  }

  const loginOptionalPages = new Set([
    "pages/index/index",
    "pages/session/create",
    "pages/session/script",
    "pages/session/role",
    "pages/admin/catalog"
  ]);
  for (const pagePath of pagePaths) {
    const source = fs.readFileSync(path.join(srcRoot, `${pagePath}.vue`), "utf8");
    if (!loginOptionalPages.has(pagePath) && !source.includes("ensureLoggedIn")) {
      fail(`Page must require login before use: ${pagePath}`);
    }
    if (!source.includes("<AuthIdentityBar")) {
      fail(`Page must show the shared auth identity bar: ${pagePath}`);
    }
    const rootViewMatch = source.match(/<template>\s*<view\b[^>]*class="[^"]*\bpage\b[^"]*"[^>]*>([\s\S]*?)\n\s*<view|\n\s*<image|\n\s*<AuthIdentityBar/);
    const rootStart = source.match(/<template>\s*<view\b[^>]*class="[^"]*\bpage\b[^"]*"[^>]*>/);
    if (rootStart) {
      const afterRoot = source.slice(rootStart.index + rootStart[0].length);
      const authIsFirstRootChild = /^\s*<AuthIdentityBar\b/.test(afterRoot);
      const authIsFirstScrollContentChild =
        /^\s*<scroll-view\b[^>]*>\s*<view\b[^>]*>\s*<AuthIdentityBar\b/.test(afterRoot);
      if (!authIsFirstRootChild && !authIsFirstScrollContentChild) {
        fail(`Auth identity bar must be the first page element: ${pagePath}`);
      }
    } else if (rootViewMatch) {
      fail(`Unable to verify root page element for auth identity bar: ${pagePath}`);
    }
  }

  for (const pagePath of [
    "pages/session/create",
    "pages/session/script",
    "pages/session/role",
    "pages/session/setup"
  ]) {
    const source = fs.readFileSync(path.join(srcRoot, `${pagePath}.vue`), "utf8");
    const onLoadSource = methodBody(source, "onLoad");
    if (onLoadSource.includes("ensureLoggedIn")) {
      fail(`Creation browse page must not request login on load: ${pagePath}`);
    }
  }
  const adminCatalogSource = fs.readFileSync(path.join(srcRoot, "pages/admin/catalog.vue"), "utf8");
  if (/onLoad\s*\(\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{[\s\S]*ensureLoggedIn\s*\(/.test(adminCatalogSource)) {
    fail("Admin catalog page must wait for an explicit login tap before requesting login");
  }

  const appSource = fs.readFileSync(path.join(srcRoot, "App.vue"), "utf8");
  if (!fs.existsSync(miniprogramDevEnvPath)) {
    fail("Miniprogram development env is missing: apps/miniprogram/.env.development");
  } else if (!isDevelopmentApiBaseUrl(readEnv(miniprogramDevEnvPath).VITE_API_BASE_URL)) {
    fail(
      `Miniprogram development API base URL must be ${productionApiBaseUrl}`
    );
  }
  if (!fs.existsSync(miniprogramProdEnvPath)) {
    fail("Miniprogram production env is missing: apps/miniprogram/.env.production");
  } else if (readEnv(miniprogramProdEnvPath).VITE_API_BASE_URL !== productionApiBaseUrl) {
    fail(`Miniprogram production API base URL must be ${productionApiBaseUrl}`);
  }
  if (!appSource.includes(`const productionApiBaseUrl = "${productionApiBaseUrl}"`)) {
    fail(`App.vue must lock mini-program API base URL to ${productionApiBaseUrl}`);
  }
  if (!appSource.includes("apiBaseUrl: productionApiBaseUrl")) {
    fail("App.vue globalData.apiBaseUrl must use the locked production API base URL");
  }
  if (appSource.includes("import.meta.env.VITE_API_BASE_URL")) {
    fail("App.vue must not allow VITE_API_BASE_URL to override the locked production API base URL");
  }
  if (!appSource.includes("@font-face") || !appSource.includes("/static/fonts/pinche-brand.ttf")) {
    fail("App.vue must load the packaged brand font from /static/fonts/pinche-brand.ttf");
  }
  if (!appSource.includes("PincheBrand")) {
    fail("App.vue must expose the packaged brand font as PincheBrand");
  }
  if (/url\(\s*["']?\/?static\/[^)"']+\.(?:png|jpe?g|gif|webp|svg)/.test(appSource)) {
    fail("Global App.vue styles must not use local /static images in CSS url(); use <image> instead");
  }
  const staticReferenceFiles = walkFiles(srcRoot).filter((file) =>
    /\.(?:vue|js|json)$/.test(file)
  );
  const staticAssetPattern = /["'`]((?:\/static\/)[^"'`?#]+\.(?:png|jpe?g|gif|webp|svg|ttf|otf|woff2?))(?:[?#][^"'`]*)?["'`]/g;
  for (const file of staticReferenceFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(staticAssetPattern)) {
      const assetPath = path.join(srcRoot, match[1].slice(1));
      if (!fs.existsSync(assetPath)) {
        fail(`Missing static image asset referenced by ${path.relative(root, file)}: ${match[1]}`);
      }
    }
  }
  for (const requiredButtonSystemText of [
    ".button.compact",
    ".button.disabled",
    ".bottom-action",
    ".action-grid"
  ]) {
    if (!appSource.includes(requiredButtonSystemText)) {
      fail(`Global button system is missing ${requiredButtonSystemText}`);
    }
  }

  const viteConfigSource = fs.existsSync(viteConfigPath) ? fs.readFileSync(viteConfigPath, "utf8") : "";
  if (!viteConfigSource.includes("__PINCHE_BUILD_TIME__")) {
    fail("Vite config must define the build-time version constant");
  }
  if (!/define:\s*\{[\s\S]*__PINCHE_BUILD_TIME__/.test(viteConfigSource)) {
    fail("Vite config must inject the build-time constant through define");
  }
  if (!/formatBuildTime/.test(viteConfigSource) || !/padStart\(2,\s*"0"\)/.test(viteConfigSource)) {
    fail("Vite config must format the build time as a stable YYYY-MM-DD HH:mm label");
  }
  for (const requiredTdesignBuildText of [
    "buildStart",
    "generateBundle",
    "preseedTdesignMiniprogramNpmPackage",
    "copyTdesignMiniprogramNpmPlugin",
    "tdesign-miniprogram",
    "copyTdesignComponentNpmPackage",
    "preserveExisting: true",
    "tslib",
    "isCustomElement"
  ]) {
    if (!viteConfigSource.includes(requiredTdesignBuildText)) {
      fail(`Mini-program Vite build must copy TDesign miniprogram npm assets: ${requiredTdesignBuildText}`);
    }
  }
  if (!viteConfigSource.includes('"root-portal"')) {
    fail("Mini-program Vite config must keep root-portal as a native WeChat component");
  }
  if (viteConfigSource.includes("fs.rmSync(tdesignTarget")) {
    fail("Mini-program Vite build must not remove the live TDesign miniprogram_npm directory while DevTools may be hot-reloading");
  }
  for (const forbiddenTdesignPatchText of [
    "patchTdesignImageViewerStableImages",
    "tdesignImageViewerResetObserver",
    "tdesignImageViewerStableObserver"
  ]) {
    if (viteConfigSource.includes(forbiddenTdesignPatchText)) {
      fail(`Mini-program Vite build must not patch TDesign ImageViewer internals: ${forbiddenTdesignPatchText}`);
    }
  }

  for (const [label, file] of Object.entries(firstFlowFiles)) {
    const source = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (/<button[^>]*@tap=/.test(source)) {
      fail(`${label} buttons should use @click for consistent UniApp button handling`);
    }
    for (const localButtonRule of [
      ".search-button {",
      ".share-button {",
      ".confirm-button {",
      ".bottom-action {",
      ".button.disabled {"
    ]) {
      if (source.includes(localButtonRule)) {
        fail(`${label} should use the shared button system instead of local ${localButtonRule}`);
      }
    }
  }

  if (!process.exitCode) {
    console.log(`UniApp miniprogram check passed: ${pages.length} pages`);
  }
}

if (!fs.existsSync(devtoolsHookPath)) {
  fail("Missing WeChat DevTools refresh hook script: scripts/devtools-refresh-hook.js");
} else {
  const devtoolsHookSource = fs.readFileSync(devtoolsHookPath, "utf8");
  for (const requiredHookText of [
    "wechatwebdevtools.app/Contents/MacOS/cli",
    "apps/miniprogram",
    "dist/dev/mp-weixin",
    "waitForDevOutput",
    "wxcomponents/tdesign-miniprogram/image/image.json",
    "[\"open\", \"--project\", devDist]",
    "projectPath: devDist",
    "open",
    "pinche-devtools-refresh-state.json"
  ]) {
    if (!devtoolsHookSource.includes(requiredHookText)) {
      fail(`WeChat DevTools refresh hook is missing ${requiredHookText}`);
    }
  }
}

if (!fs.existsSync(d35AdminCatalogCheckPath)) {
  fail("Missing D35 mini-program admin catalog check: scripts/d35-miniprogram-admin-catalog-check.js");
}

if (fs.existsSync(codexHooksPath)) {
  const codexHooks = JSON.parse(fs.readFileSync(codexHooksPath, "utf8"));
  const stopHooks = codexHooks.hooks?.Stop || [];
  const hasDevtoolsStopHook = stopHooks.some((entry) =>
    (entry.hooks || []).some(
      (hook) =>
        hook.type === "command" &&
        hook.command?.includes("scripts/devtools-refresh-hook.js")
    )
  );
  if (!hasDevtoolsStopHook) {
    fail("Codex Stop hook must run scripts/devtools-refresh-hook.js");
  }
}
