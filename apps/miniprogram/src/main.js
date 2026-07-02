import { createSSRApp } from "vue";
import App from "./App.vue";
import uvUI from "./uni_modules/uv-ui-tools/index.js";

export function createApp() {
  const app = createSSRApp(App);
  app.use(uvUI);
  return {
    app
  };
}
