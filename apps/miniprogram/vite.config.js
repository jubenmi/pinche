import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import uniPlugin from "@dcloudio/vite-plugin-uni";

const uni = typeof uniPlugin === "function" ? uniPlugin : uniPlugin.default;
const buildTime = formatBuildTime();

function formatBuildTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  ].join(" ");
}

export default defineConfig({
  define: {
    __PINCHE_BUILD_TIME__: JSON.stringify(buildTime)
  },
  plugins: [uni(), stripDcloudPreloadAssetPlugin()]
});

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
