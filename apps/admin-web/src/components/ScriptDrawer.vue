<template>
  <aside class="drawer wide">
    <header class="drawer-head">
      <h2>{{ model.id ? "编辑剧本" : "新增剧本" }}</h2>
      <button class="close-button" type="button" @click="$emit('close')">关闭</button>
    </header>
    <form class="drawer-form" @submit.prevent="submit">
      <div class="drawer-body">
        <div class="form-grid">
          <label>
            <span>名称</span>
            <input v-model.trim="model.name" name="scriptName" required />
          </label>
          <label>
            <span>标签</span>
            <input v-model.trim="model.typeTagsText" name="scriptTypeTags" placeholder="情感,沉浸" />
          </label>
          <label>
            <span>人数</span>
            <input v-model.number="model.playerCount" name="scriptPlayerCount" type="number" min="1" />
          </label>
          <label>
            <span>状态</span>
            <select v-model="model.status" name="scriptStatus">
              <option value="active">上架（active）</option>
              <option value="inactive">下架（inactive）</option>
            </select>
          </label>
          <label class="full">
            <span>无剧透简介</span>
            <textarea v-model.trim="model.summaryNoSpoiler" name="scriptSummary" rows="3"></textarea>
          </label>
        </div>

        <section class="role-editor">
          <div class="role-head">
            <div>
              <h3>角色模板</h3>
              <p>{{ model.defaultSeatTemplate.length }} 个角色，人数为 {{ model.playerCount || 0 }}</p>
            </div>
            <button class="secondary-action" type="button" @click="addRole">新增角色</button>
          </div>
          <div class="role-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>角色</th>
                  <th>类型</th>
                  <th>定位</th>
                  <th>性别</th>
                  <th>基础价</th>
                  <th>调整</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(role, index) in model.defaultSeatTemplate" :key="role.id">
                  <td><input v-model.trim="role.name" :name="`roleName-${index}`" required /></td>
                  <td>
                    <select v-model="role.seatType" :name="`roleSeatType-${index}`">
                      <option value="normal">普通</option>
                      <option value="love_companion">沉浸</option>
                      <option value="f4">F4</option>
                      <option value="cp">CP</option>
                    </select>
                  </td>
                  <td><input v-model.trim="role.roleName" :name="`rolePosition-${index}`" /></td>
                  <td>
                    <select v-model="role.roleGender" :name="`roleGender-${index}`">
                      <option value="unlimited">不限</option>
                      <option value="male">男位</option>
                      <option value="female">女位</option>
                    </select>
                  </td>
                  <td>
                    <input
                      v-model.number="role.basePriceYuan"
                      :name="`roleBasePrice-${index}`"
                      type="number"
                      min="0"
                    />
                  </td>
                  <td>
                    <input
                      v-model.number="role.adjustmentYuan"
                      :name="`roleAdjustment-${index}`"
                      type="number"
                    />
                  </td>
                  <td class="row-actions">
                    <button class="action-button" type="button" @click="moveRole(index, -1)">上移</button>
                    <button class="action-button" type="button" @click="moveRole(index, 1)">下移</button>
                    <button type="button" class="action-button danger" @click="removeRole(index)">删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <p v-if="roleCountWarning" class="warning">角色数与人数不一致，可保存，但建议检查。</p>
      </div>

      <footer class="drawer-footer">
        <button class="secondary-action" type="button" @click="$emit('close')">取消</button>
        <button class="primary" type="submit">保存剧本</button>
      </footer>
    </form>
  </aside>
</template>

<script setup>
import { computed, reactive, watch } from "vue";

const props = defineProps({
  script: { type: Object, required: true }
});
const emit = defineEmits(["save", "close"]);
const model = reactive({ defaultSeatTemplate: [] });

function parseJsonArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function toEditorRole(role = {}, index = 0) {
  return {
    id: role.id || `${Date.now()}-${index}`,
    name: role.name || role.roleName || `角色${index + 1}`,
    seatType: role.seatType || role.seat_type || "normal",
    roleName: role.roleName || role.role_name || "",
    roleGender: role.roleGender || role.role_gender || "unlimited",
    basePriceYuan: Math.round(Number(role.basePrice || role.base_price || 0) / 100),
    adjustmentYuan: Math.round(Number(role.adjustment || 0) / 100)
  };
}

function typeTagsText(value) {
  const tags = parseJsonArray(value);
  return tags.join(",");
}

watch(
  () => props.script,
  (script) => {
    Object.assign(model, {
      id: script.id,
      name: script.name || "",
      typeTagsText: Array.isArray(script.typeTags)
        ? script.typeTags.join(",")
        : typeTagsText(script.type_tags),
      playerCount: Number(script.player_count || script.playerCount || 6),
      summaryNoSpoiler: script.summary_no_spoiler || script.summaryNoSpoiler || "",
      status: script.status || "active",
      defaultSeatTemplate: parseJsonArray(
        script.default_seat_template_json || script.defaultSeatTemplate
      ).map(toEditorRole)
    });
  },
  { immediate: true }
);

const roleCountWarning = computed(
  () => Number(model.playerCount || 0) !== model.defaultSeatTemplate.length
);

function addRole() {
  model.defaultSeatTemplate.push(toEditorRole({}, model.defaultSeatTemplate.length));
}

function removeRole(index) {
  model.defaultSeatTemplate.splice(index, 1);
}

function moveRole(index, delta) {
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= model.defaultSeatTemplate.length) {
    return;
  }
  const [role] = model.defaultSeatTemplate.splice(index, 1);
  model.defaultSeatTemplate.splice(nextIndex, 0, role);
}

function tagsFromText(value) {
  return String(value || "")
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function submit() {
  emit("save", {
    id: model.id,
    name: model.name,
    typeTags: tagsFromText(model.typeTagsText),
    playerCount: Number(model.playerCount || 0),
    summaryNoSpoiler: model.summaryNoSpoiler,
    status: model.status,
    defaultSeatTemplate: model.defaultSeatTemplate.map((role) => ({
      id: role.id,
      name: role.name,
      seatType: role.seatType,
      roleName: role.roleName,
      roleGender: role.roleGender,
      basePrice: Number(role.basePriceYuan || 0) * 100,
      adjustment: Number(role.adjustmentYuan || 0) * 100
    }))
  });
}
</script>
