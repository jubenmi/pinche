import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_PROXY_TARGET || "http://localhost:3018";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5178,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true
      },
      "/health": {
        target: apiTarget,
        changeOrigin: true
      }
    }
  }
});
