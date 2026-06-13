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
  plugins: [uni()]
});
