import config from "./libs/config/config.js";
import debounce from "./libs/function/debounce.js";
import * as index from "./libs/function/index.js";
import platform from "./libs/function/platform.js";
import * as test from "./libs/function/test.js";
import throttle from "./libs/function/throttle.js";
import route from "./libs/util/route.js";

const $uv = {
  route,
  config,
  test,
  date: index.timeFormat,
  ...index,
  debounce,
  throttle,
  platform
};

uni.$uv = $uv;

export default {
  install(app) {
    app.config.globalProperties.$uv = $uv;
  }
};
