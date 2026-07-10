import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const dateTimePicker = read(
  "apps/miniprogram/src/wxcomponents/tdesign-miniprogram/date-time-picker/date-time-picker.js"
);
assert(
  dateTimePicker.includes("getFullModeArray(t){if(null==t)return[]"),
  "TDesign date-time-picker should tolerate an empty mode during WeChatLib initialization"
);
assert(
  dateTimePicker.includes("isTimeMode(){const{fullModes:t=[]}=this.data"),
  "TDesign date-time-picker should tolerate missing fullModes"
);

const textareaProps = read(
  "apps/miniprogram/src/wxcomponents/tdesign-miniprogram/textarea/props.js"
);
assert(
  textareaProps.includes('placeholder:{type:null,value:""}'),
  "TDesign textarea should accept WeChatLib's transient null placeholder"
);

const searchProps = read(
  "apps/miniprogram/src/wxcomponents/tdesign-miniprogram/search/props.js"
);
assert(
  searchProps.includes('value:{type:null,value:""}'),
  "TDesign search should accept WeChatLib's transient null value"
);

const setup = read("apps/miniprogram/src/pages/session/setup.vue");
assert(
  setup.includes(":placeholder=\"defaultPinnedMessage || ''\""),
  "Setup textarea should never pass a null placeholder"
);

const create = read("apps/miniprogram/src/pages/session/create.vue");
assert(
  create.includes("keyword = $event.detail.value || ''"),
  "Store search should normalize a cleared value to an empty string"
);

const admin = read("apps/miniprogram/src/pages/admin/catalog.vue");
for (const field of ["storeLinkKeyword", "storeKeyword", "scriptKeyword", "requestKeyword"]) {
  assert(
    admin.includes(`${field} = $event.detail.value || ''`),
    `Admin search should normalize ${field} to an empty string`
  );
}

console.log("WeChatLib runtime compatibility checks passed");
