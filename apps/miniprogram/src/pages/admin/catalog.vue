<template>
  <view class="page">
    <AuthIdentityBar />
    <FeedbackHost />

    <view v-if="!isAdmin" class="section">
      <view class="title">资料管理</view>
      <view class="text">当前微信账号没有系统管理员权限。</view>
      <view class="actions">
        <t-button class="button" @tap="goMine">去登录</t-button>
      </view>
    </view>

    <view v-else>
      <view class="section workbench">
        <view class="workbench-head">
          <view>
            <view class="title">管理工作台</view>
            <view class="text">维护店家、剧本和待审核资料。</view>
          </view>
          <view class="workbench-tools">
            <t-button class="tool-button" @tap="scanAdminWebLogin">扫码登录 Web 后台</t-button>
            <t-button class="tool-button secondary" :disabled="loading" @tap="retryActiveTab">刷新</t-button>
          </view>
        </view>

        <view class="stats-grid">
          <view
            v-for="item in catalogStats"
            :key="item.key"
            class="stat-tile"
            :class="{ active: activeTab === item.key }"
            @tap="switchTab(item.key)"
          >
            <view class="stat-value">{{ item.value }}</view>
            <view class="stat-label">{{ item.label }}</view>
          </view>
        </view>

        <view class="status-line" :class="{ error: Boolean(loadError) }">
          {{ loadError || lastOperationMessage || "准备处理资料" }}
        </view>

        <t-tabs
          class="tabs"
          theme="tag"
          :value="activeTab"
          custom-style="width: 100%; --td-tab-item-height: 64rpx; --td-tab-item-tag-height: 56rpx; --td-tab-item-active-color: #1f7a68; --td-tab-item-tag-active-bg: #eef7f4; --td-tab-item-tag-bg: #eef2f7; --td-tab-nav-bg-color: transparent; --td-tab-font: 600 24rpx / 44rpx PingFang SC, Microsoft YaHei, sans-serif;"
          @change="handleTabChange"
        >
          <t-tab-panel
            v-for="tab in tabs"
            :key="tab.key"
            :label="tab.label"
            :value="tab.key"
          />
        </t-tabs>
      </view>

      <view v-if="loading" class="section compact">
        <view class="text">正在加载...</view>
      </view>

      <view v-if="activeTab === 'stores'" class="panel">
        <view class="section editor-section">
          <view class="section-head">
            <view>
              <view class="section-title">{{ editingStoreId ? "编辑店家" : "新增店家" }}</view>
              <view class="section-note">店家资料和微信小程序共用 GCJ-02 坐标。</view>
            </view>
            <t-button class="mini-button muted" @tap="resetStoreForm">清空</t-button>
          </view>

          <t-input
            :value="storeForm.name"
            class="field"
            placeholder="店家名称"
            @change="updateStoreField('name', $event.detail.value)"
          />
          <view class="field-row">
            <t-input
              :value="storeForm.city"
              class="field half"
              placeholder="城市"
              @change="updateStoreField('city', $event.detail.value)"
            />
            <t-input
              :value="storeForm.district"
              class="field half"
              placeholder="区域"
              @change="updateStoreField('district', $event.detail.value)"
            />
          </view>
          <t-input
            :value="storeForm.address"
            class="field"
            placeholder="地址"
            @change="updateStoreField('address', $event.detail.value)"
          />
          <t-input
            :value="storeForm.contactNote"
            class="field"
            placeholder="联系方式备注"
            @change="updateStoreField('contactNote', $event.detail.value)"
          />

          <view class="form-card">
            <view class="card-title">位置设置</view>
            <view class="section-note">可地图选点，也可手填 GCJ-02 纬度和经度；不使用 POI 搜索额度。</view>
            <view class="field-row">
              <t-input
                :value="storeForm.latitude"
                class="field half"
                type="digit"
                placeholder="纬度（GCJ-02）"
                @change="updateStoreField('latitude', $event.detail.value)"
              />
              <t-input
                :value="storeForm.longitude"
                class="field half"
                type="digit"
                placeholder="经度（GCJ-02）"
                @change="updateStoreField('longitude', $event.detail.value)"
              />
            </view>
            <view class="actions tight">
              <t-button class="button secondary" @tap="pickStoreLocation">地图选点</t-button>
              <t-button
                class="button secondary"
                :disabled="!hasStoreLocation(storeForm)"
                @tap="openStoreLocation(storeForm)"
              >
                查看地图
              </t-button>
            </view>
            <view class="section-note">{{ storeLocationText(storeForm) }}</view>
          </view>

          <view class="toggle-row">
            <t-button
              class="toggle"
              :class="{ active: storeForm.status === 'active' }"
              @tap="updateStoreField('status', 'active')"
            >
              上架
            </t-button>
            <t-button
              class="toggle"
              :class="{ active: storeForm.status === 'inactive' }"
              @tap="updateStoreField('status', 'inactive')"
            >
              下架
            </t-button>
          </view>

          <view class="form-card">
            <view class="card-title">关联剧本与价格</view>
            <view v-if="!editingStoreId" class="section-note">新店家保存后会同步保存这些关联。</view>
            <view class="field-row">
              <t-search
                :value="storeLinkKeyword"
                class="field search"
                placeholder="搜索可关联剧本"
                shape="round"
                @change="storeLinkKeyword = $event.detail.value || ''"
              />
              <t-input
                :value="pendingStoreScriptPrice"
                class="field price-field"
                type="number"
                placeholder="价格"
                @change="pendingStoreScriptPrice = $event.detail.value"
              />
            </view>
            <view
              v-for="script in storeLinkCandidates"
              :key="script.id"
              class="link-option"
            >
              <view class="link-main">{{ script.name }} · {{ script.player_count || 0 }}人</view>
              <t-button class="mini-button" @tap="addStoreScriptLink(script)">关联</t-button>
            </view>
            <view v-if="storeScriptLinks.length === 0" class="empty-inline">暂未关联剧本</view>
            <view
              v-for="link in storeScriptLinks"
              :key="link.scriptId"
              class="linked-row"
            >
              <view class="linked-name">{{ link.scriptName }}</view>
              <t-input
                :value="link.pricePerPerson"
                class="field linked-price"
                type="number"
                placeholder="每人价"
                @change="updateStoreLinkPrice(link.scriptId, $event.detail.value)"
              />
              <t-button class="mini-button muted" @tap="removeStoreScriptLink(link.scriptId)">移除</t-button>
            </view>
          </view>

          <view class="actions">
            <t-button class="button" :disabled="loading" @tap="saveStore">
              {{ editingStoreId ? "保存店家" : "新增店家" }}
            </t-button>
            <t-button
              v-if="editingStoreId"
              class="button danger"
              :disabled="loading"
              @tap="deleteStoreByItem(currentEditingStore)"
            >
              删除
            </t-button>
          </view>
        </view>

        <view class="section">
          <view class="section-head">
            <view class="section-title">店家列表</view>
            <t-button class="mini-button secondary" @tap="toggleSelectionMode('stores')">
              {{ selectionMode === 'stores' ? "退出选择" : "选择" }}
            </t-button>
          </view>
          <view class="search-row">
            <t-search
              :value="storeKeyword"
              class="field search"
              placeholder="搜索名称/城市/区域/地址"
              action="搜索"
              shape="round"
              @change="storeKeyword = $event.detail.value || ''"
              @submit="loadStores"
              @action-click="loadStores"
            />
          </view>
          <view class="field-row">
            <t-input
              :value="storeCityFilter"
              class="field half"
              placeholder="城市筛选"
              @change="storeCityFilter = $event.detail.value"
            />
            <t-button class="button secondary half-button" @tap="loadStores">应用筛选</t-button>
          </view>
          <view class="toggle-row wrap">
            <t-button
              v-for="item in statusFilters"
              :key="item.value"
              class="toggle"
              :class="{ active: storeStatus === item.value }"
              @tap="setStoreStatus(item.value)"
            >
              {{ item.label }}
            </t-button>
            <t-button
              v-for="item in auditFilters"
              :key="`store-${item.value}`"
              class="toggle"
              :class="{ active: storeReviewStatus === item.value }"
              @tap="setStoreReviewStatus(item.value)"
            >
              {{ item.label }}
            </t-button>
          </view>

          <view v-if="stores.length === 0" class="empty-inline">暂无店家，先新增一条。</view>
          <view v-for="store in stores" :key="store.id" class="item">
            <view class="item-main">
              <view class="item-title">{{ store.name }}</view>
              <view class="item-sub">{{ store.city }} {{ store.district || "" }}</view>
              <view class="item-sub">{{ store.address || "暂无地址" }}</view>
              <view class="audit-row">
                <view class="audit-badge" :class="catalogAuditClass(store)">
                  {{ catalogAuditLabel(store) }}
                </view>
                <view class="audit-badge location" :class="{ approved: hasStoreLocation(store) }">
                  {{ hasStoreLocation(store) ? "已定位" : "缺坐标" }}
                </view>
              </view>
            </view>
            <view class="item-actions">
              <t-button
                v-if="selectionMode === 'stores'"
                class="mini-button"
                :class="{ muted: !isSelected('stores', store.id) }"
                @tap="toggleItemSelected('stores', store.id)"
              >
                {{ isSelected('stores', store.id) ? "已选" : "选择" }}
              </t-button>
              <t-button class="mini-button" @tap="editStore(store)">编辑</t-button>
              <t-button class="mini-button muted" @tap="toggleStore(store)">
                {{ store.status === "active" ? "下架" : "上架" }}
              </t-button>
              <t-button class="mini-button muted" @tap="deleteStoreByItem(store)">删除</t-button>
            </view>
          </view>
        </view>

        <view v-if="selectionMode === 'stores'" class="bulk-bar">
          <view class="bulk-text">已选 {{ selectedStoreIds.length }} 个店家</view>
          <t-button class="mini-button" @tap="runBulkStatus('stores', 'active')">批量上架</t-button>
          <t-button class="mini-button muted" @tap="runBulkStatus('stores', 'inactive')">批量下架</t-button>
          <t-button class="mini-button danger" @tap="runBulkDelete('stores')">批量删除</t-button>
        </view>
      </view>

      <view v-if="activeTab === 'scripts'" class="panel">
        <view class="section editor-section">
          <view class="section-head">
            <view>
              <view class="section-title">{{ editingScriptId ? "编辑剧本" : "新增剧本" }}</view>
              <view class="section-note">结构化维护玩家角色和 NPC 角色。</view>
            </view>
            <t-button class="mini-button muted" @tap="resetScriptForm">清空</t-button>
          </view>
          <t-input
            :value="scriptForm.name"
            class="field"
            placeholder="剧本名称"
            @change="updateScriptField('name', $event.detail.value)"
          />
          <view class="field-row">
            <t-input
              :value="scriptForm.typeTagsText"
              class="field half"
              placeholder="标签，逗号分隔"
              @change="updateScriptField('typeTagsText', $event.detail.value)"
            />
            <t-input
              :value="scriptForm.playerCount"
              class="field half"
              type="number"
              placeholder="人数"
              @change="updateScriptField('playerCount', $event.detail.value)"
            />
          </view>
          <t-textarea
            :value="scriptForm.summaryNoSpoiler"
            class="textarea"
            placeholder="无剧透简介"
            @change="updateScriptField('summaryNoSpoiler', $event.detail.value)"
          />

          <view class="form-card">
            <view class="card-head">
              <view>
                <view class="card-title">玩家角色</view>
                <view class="section-note">{{ scriptRoleRows.length }} 个角色，人数为 {{ scriptForm.playerCount || 0 }}</view>
              </view>
              <view class="card-actions">
                <t-button class="mini-button secondary" @tap="fillDefaultRoles">补齐角色</t-button>
                <t-button class="mini-button" @tap="addScriptRole">新增角色</t-button>
              </view>
            </view>
            <view v-if="roleCountWarning" class="warning">角色数量与玩家人数不一致，请检查后保存。</view>
            <view v-if="scriptTemplateParseError" class="warning">模板 JSON 解析失败，已保留原始内容，请补齐角色后保存。</view>
            <t-textarea
              v-if="scriptTemplateParseError"
              :value="scriptRawTemplateText"
              class="textarea template"
              placeholder="原始模板 JSON"
              @change="scriptRawTemplateText = $event.detail.value"
            />
            <view
              v-for="(role, index) in scriptRoleRows"
              :key="role.id"
              class="role-card"
            >
              <view class="role-index">角色 {{ index + 1 }}</view>
              <t-input
                :value="role.name"
                class="field"
                placeholder="角色名"
                @change="updateRoleField(index, 'name', $event.detail.value)"
              />
              <t-input
                :value="role.description"
                class="field"
                placeholder="角色描述"
                @change="updateRoleField(index, 'description', $event.detail.value)"
              />
              <view class="toggle-row wrap">
                <t-button
                  v-for="item in genderOptions"
                  :key="`${role.id}-${item.value}`"
                  class="toggle"
                  :class="{ active: role.roleGender === item.value }"
                  @tap="updateRoleField(index, 'roleGender', item.value)"
                >
                  {{ item.label }}
                </t-button>
              </view>
              <view class="actions tight">
                <t-button class="mini-button secondary" @tap="moveScriptRole(index, -1)">上移</t-button>
                <t-button class="mini-button secondary" @tap="moveScriptRole(index, 1)">下移</t-button>
                <t-button class="mini-button muted" @tap="removeScriptRole(index)">删除</t-button>
              </view>
            </view>
          </view>

          <view class="form-card">
            <view class="card-head">
              <view>
                <view class="card-title">NPC 角色</view>
                <view class="section-note">{{ scriptNpcRows.length }} 个 NPC 角色，不计入玩家人数。</view>
              </view>
              <t-button class="mini-button" @tap="addNpcRole">新增 NPC</t-button>
            </view>
            <view v-if="scriptNpcRows.length === 0" class="empty-inline">暂无 NPC 角色</view>
            <view
              v-for="(npcRole, index) in scriptNpcRows"
              :key="npcRole.id"
              class="role-card"
            >
              <view class="role-index">NPC {{ index + 1 }}</view>
              <t-input
                :value="npcRole.name"
                class="field"
                placeholder="NPC 名称"
                @change="updateNpcRoleField(index, 'name', $event.detail.value)"
              />
              <t-input
                :value="npcRole.description"
                class="field"
                placeholder="NPC 描述"
                @change="updateNpcRoleField(index, 'description', $event.detail.value)"
              />
              <view class="toggle-row wrap">
                <t-button
                  v-for="item in genderOptions"
                  :key="`${npcRole.id}-${item.value}`"
                  class="toggle"
                  :class="{ active: npcRole.roleGender === item.value }"
                  @tap="updateNpcRoleField(index, 'roleGender', item.value)"
                >
                  {{ item.label }}
                </t-button>
              </view>
              <view class="actions tight">
                <t-button class="mini-button secondary" @tap="moveNpcRole(index, -1)">上移</t-button>
                <t-button class="mini-button secondary" @tap="moveNpcRole(index, 1)">下移</t-button>
                <t-button class="mini-button muted" @tap="removeNpcRole(index)">删除</t-button>
              </view>
            </view>
          </view>

          <view class="toggle-row">
            <t-button
              class="toggle"
              :class="{ active: scriptForm.status === 'active' }"
              @tap="updateScriptField('status', 'active')"
            >
              上架
            </t-button>
            <t-button
              class="toggle"
              :class="{ active: scriptForm.status === 'inactive' }"
              @tap="updateScriptField('status', 'inactive')"
            >
              下架
            </t-button>
          </view>
          <view class="actions">
            <t-button class="button" :disabled="loading" @tap="saveScript">
              {{ editingScriptId ? "保存剧本" : "新增剧本" }}
            </t-button>
            <t-button
              v-if="editingScriptId"
              class="button danger"
              :disabled="loading"
              @tap="deleteScriptByItem(currentEditingScript)"
            >
              删除
            </t-button>
          </view>
        </view>

        <view class="section">
          <view class="section-head">
            <view class="section-title">剧本列表</view>
            <t-button class="mini-button secondary" @tap="toggleSelectionMode('scripts')">
              {{ selectionMode === 'scripts' ? "退出选择" : "选择" }}
            </t-button>
          </view>
          <view class="search-row">
            <t-search
              :value="scriptKeyword"
              class="field search"
              placeholder="搜索名称/标签/简介"
              action="搜索"
              shape="round"
              @change="scriptKeyword = $event.detail.value || ''"
              @submit="loadScripts"
              @action-click="loadScripts"
            />
          </view>
          <view class="field-row">
            <t-input
              :value="scriptTagFilter"
              class="field half"
              placeholder="标签筛选"
              @change="scriptTagFilter = $event.detail.value"
            />
            <t-button class="button secondary half-button" @tap="loadScripts">应用筛选</t-button>
          </view>
          <view class="toggle-row wrap">
            <t-button
              v-for="item in statusFilters"
              :key="item.value"
              class="toggle"
              :class="{ active: scriptStatus === item.value }"
              @tap="setScriptStatus(item.value)"
            >
              {{ item.label }}
            </t-button>
            <t-button
              v-for="item in auditFilters"
              :key="`script-${item.value}`"
              class="toggle"
              :class="{ active: scriptReviewStatus === item.value }"
              @tap="setScriptReviewStatus(item.value)"
            >
              {{ item.label }}
            </t-button>
          </view>
          <view v-if="scripts.length === 0" class="empty-inline">暂无剧本，先新增一条。</view>
          <view v-for="script in scripts" :key="script.id" class="item">
            <view class="item-main">
              <view class="item-title">{{ script.name }}</view>
              <view class="item-sub">{{ displayTags(script.type_tags) }} / {{ script.player_count || 0 }}人</view>
              <view class="item-sub">{{ script.summary_no_spoiler || "暂无简介" }}</view>
              <view class="audit-row">
                <view class="audit-badge" :class="catalogAuditClass(script)">
                  {{ catalogAuditLabel(script) }}
                </view>
                <view class="audit-badge" :class="{ approved: roleTemplateStatus(script).ok }">
                  {{ roleTemplateStatus(script).label }}
                </view>
                <view class="audit-badge location">{{ npcRoleCount(script) }} NPC</view>
              </view>
            </view>
            <view class="item-actions">
              <t-button
                v-if="selectionMode === 'scripts'"
                class="mini-button"
                :class="{ muted: !isSelected('scripts', script.id) }"
                @tap="toggleItemSelected('scripts', script.id)"
              >
                {{ isSelected('scripts', script.id) ? "已选" : "选择" }}
              </t-button>
              <t-button class="mini-button" @tap="editScript(script)">编辑</t-button>
              <t-button class="mini-button muted" @tap="toggleScript(script)">
                {{ script.status === "active" ? "下架" : "上架" }}
              </t-button>
              <t-button class="mini-button muted" @tap="deleteScriptByItem(script)">删除</t-button>
            </view>
          </view>
        </view>

        <view v-if="selectionMode === 'scripts'" class="bulk-bar">
          <view class="bulk-text">已选 {{ selectedScriptIds.length }} 个剧本</view>
          <t-button class="mini-button" @tap="runBulkStatus('scripts', 'active')">批量上架</t-button>
          <t-button class="mini-button muted" @tap="runBulkStatus('scripts', 'inactive')">批量下架</t-button>
          <t-button class="mini-button danger" @tap="runBulkDelete('scripts')">批量删除</t-button>
        </view>
      </view>

      <view v-if="activeTab === 'requests'" class="panel">
        <view v-if="editingReviewItem" class="section editor-section">
          <view class="section-head">
            <view>
              <view class="section-title">审核编辑：{{ itemTypeLabel(editingReviewItem.type) }}</view>
              <view class="section-note">可先保存草稿，也可随审核动作一起提交。</view>
            </view>
            <t-button class="mini-button muted" @tap="closeReviewEditor">关闭</t-button>
          </view>

          <view v-if="editingReviewItem.type === 'store'">
            <t-input
              :value="reviewForm.name"
              class="field"
              placeholder="店家名称"
              @change="updateReviewFormField('name', $event.detail.value)"
            />
            <view class="field-row">
              <t-input
                :value="reviewForm.city"
                class="field half"
                placeholder="城市"
                @change="updateReviewFormField('city', $event.detail.value)"
              />
              <t-input
                :value="reviewForm.district"
                class="field half"
                placeholder="区域"
                @change="updateReviewFormField('district', $event.detail.value)"
              />
            </view>
            <t-input
              :value="reviewForm.address"
              class="field"
              placeholder="地址"
              @change="updateReviewFormField('address', $event.detail.value)"
            />
            <t-input
              :value="reviewForm.contactNote"
              class="field"
              placeholder="联系方式备注"
              @change="updateReviewFormField('contactNote', $event.detail.value)"
            />
            <view class="field-row">
              <t-input
                :value="reviewForm.latitude"
                class="field half"
                type="digit"
                placeholder="纬度（GCJ-02）"
                @change="updateReviewFormField('latitude', $event.detail.value)"
              />
              <t-input
                :value="reviewForm.longitude"
                class="field half"
                type="digit"
                placeholder="经度（GCJ-02）"
                @change="updateReviewFormField('longitude', $event.detail.value)"
              />
            </view>
            <view class="actions tight">
              <t-button class="button secondary" @tap="pickReviewStoreLocation">地图选点</t-button>
              <t-button
                class="button secondary"
                :disabled="!hasStoreLocation(reviewForm)"
                @tap="openStoreLocation(reviewForm)"
              >
                查看地图
              </t-button>
            </view>
          </view>

          <view v-else>
            <t-input
              :value="reviewForm.name"
              class="field"
              placeholder="剧本名称"
              @change="updateReviewFormField('name', $event.detail.value)"
            />
            <view class="field-row">
              <t-input
                :value="reviewForm.typeTagsText"
                class="field half"
                placeholder="标签，逗号分隔"
                @change="updateReviewFormField('typeTagsText', $event.detail.value)"
              />
              <t-input
                :value="reviewForm.playerCount"
                class="field half"
                type="number"
                placeholder="人数"
                @change="updateReviewFormField('playerCount', $event.detail.value)"
              />
            </view>
            <t-textarea
              :value="reviewForm.summaryNoSpoiler"
              class="textarea"
              placeholder="无剧透简介"
              @change="updateReviewFormField('summaryNoSpoiler', $event.detail.value)"
            />
            <view class="form-card">
              <view class="card-head">
                <view class="card-title">审核剧本角色</view>
                <t-button class="mini-button" @tap="addReviewRole">新增角色</t-button>
              </view>
              <view
                v-for="(role, index) in reviewRoleRows"
                :key="role.id"
                class="role-card"
              >
                <view class="role-index">角色 {{ index + 1 }}</view>
                <t-input
                  :value="role.name"
                  class="field"
                  placeholder="角色名"
                  @change="updateReviewRoleField(index, 'name', $event.detail.value)"
                />
                <t-input
                  :value="role.description"
                  class="field"
                  placeholder="角色描述"
                  @change="updateReviewRoleField(index, 'description', $event.detail.value)"
                />
              </view>
              <view class="card-head">
                <view class="card-title">审核 NPC 角色</view>
                <t-button class="mini-button" @tap="addReviewNpcRole">新增 NPC</t-button>
              </view>
              <view
                v-for="(npcRole, index) in reviewNpcRows"
                :key="npcRole.id"
                class="role-card"
              >
                <view class="role-index">NPC {{ index + 1 }}</view>
                <t-input
                  :value="npcRole.name"
                  class="field"
                  placeholder="NPC 名称"
                  @change="updateReviewNpcField(index, 'name', $event.detail.value)"
                />
                <t-input
                  :value="npcRole.description"
                  class="field"
                  placeholder="NPC 描述"
                  @change="updateReviewNpcField(index, 'description', $event.detail.value)"
                />
              </view>
            </view>

            <view class="form-card">
              <view class="card-title">批准后关联店家</view>
              <view class="section-note">批准剧本时可同步写入 storeScriptLinks。</view>
              <view
                v-for="store in reviewStoreCandidates"
                :key="store.id"
                class="link-option"
              >
                <view class="link-main">{{ store.name }} · {{ store.city }}</view>
                <t-button class="mini-button" @tap="addReviewStoreLink(store)">关联</t-button>
              </view>
              <view v-if="reviewStoreLinks.length === 0" class="empty-inline">暂不关联店家</view>
              <view
                v-for="link in reviewStoreLinks"
                :key="link.storeId"
                class="linked-row"
              >
                <view class="linked-name">{{ link.storeName }}</view>
                <t-input
                  :value="link.pricePerPerson"
                  class="field linked-price"
                  type="number"
                  placeholder="每人价"
                  @change="updateReviewStoreLinkPrice(link.storeId, $event.detail.value)"
                />
                <t-button class="mini-button muted" @tap="removeReviewStoreLink(link.storeId)">移除</t-button>
              </view>
            </view>
          </view>

          <t-input
            :value="reviewNote"
            class="field"
            placeholder="审核备注，会写入用户可见结果"
            @change="reviewNote = $event.detail.value"
          />
          <view class="actions">
            <t-button class="button secondary" @tap="saveReviewDraft">保存草稿</t-button>
            <t-button class="button" @tap="approveReviewItem(editingReviewItem)">批准公开</t-button>
            <t-button class="button secondary" @tap="needsChangesReviewItem(editingReviewItem)">需要补充</t-button>
            <t-button class="button danger" @tap="rejectReviewItem(editingReviewItem)">拒绝</t-button>
          </view>
        </view>

        <view class="section">
          <view class="section-title">待审核资料</view>
          <view class="search-row">
            <t-search
              :value="requestKeyword"
              class="field search"
              placeholder="搜索申请名称"
              action="搜索"
              shape="round"
              @change="requestKeyword = $event.detail.value || ''"
              @submit="loadRequests"
              @action-click="loadRequests"
            />
          </view>
          <view class="toggle-row wrap">
            <t-button
              v-for="item in requestTypeFilters"
              :key="item.value"
              class="toggle"
              :class="{ active: reviewTypeFilter === item.value }"
              @tap="setReviewTypeFilter(item.value)"
            >
              {{ item.label }}
            </t-button>
            <t-button
              v-for="item in requestStatusFilters"
              :key="item.value"
              class="toggle"
              :class="{ active: requestStatus === item.value }"
              @tap="setRequestStatus(item.value)"
            >
              {{ item.label }}
            </t-button>
          </view>
          <t-input
            :value="mergeTargetId"
            class="field"
            type="number"
            placeholder="合并目标公共资料 ID，仅合并时填写"
            @change="mergeTargetId = $event.detail.value"
          />
          <view v-if="requests.length === 0" class="empty-inline">暂无待审核资料</view>
          <view v-for="item in requests" :key="`${item.type}-${item.id}`" class="item">
            <view class="item-main">
              <view class="item-title">{{ itemTypeLabel(item.type) }}：{{ item.name }}</view>
              <view class="item-sub">{{ reviewItemMeta(item) }} / {{ reviewStatusLabel(item.review_status) }}</view>
              <view class="item-sub">
                提交人：{{ item.created_by_user_name || item.created_by_user_id || "未知" }} · 使用车局数：{{ item.session_count || 0 }}
              </view>
              <view v-if="item.created_at" class="item-sub">提交时间：{{ formatDate(item.created_at) }}</view>
              <view v-if="item.review_note" class="item-sub">备注：{{ item.review_note }}</view>
              <view v-if="item.merged_into_name" class="item-sub">合并到：{{ item.merged_into_name }}</view>
            </view>
            <view class="item-actions">
              <t-button class="mini-button" @tap="editReviewItem(item)">编辑审核</t-button>
              <t-button class="mini-button" @tap="approveReviewItem(item)">批准公开</t-button>
              <t-button class="mini-button muted" @tap="needsChangesReviewItem(item)">需要补充</t-button>
              <t-button class="mini-button muted" @tap="rejectReviewItem(item)">拒绝</t-button>
              <t-button class="mini-button muted" @tap="mergeReviewItem(item)">合并</t-button>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { onLoad, onShow } from "@dcloudio/uni-app";
import { computed, ref } from "vue";
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import { dataOf, getCurrentUser, queryString, request } from "../../utils/api";
import { showModal, showToast } from "../../utils/tdesignFeedback";

const tabs = [
  { key: "stores", label: "店家" },
  { key: "scripts", label: "剧本" },
  { key: "requests", label: "待审核" }
];
const statusFilters = [
  { value: "", label: "全部状态" },
  { value: "active", label: "上架" },
  { value: "inactive", label: "下架" }
];
const auditFilters = [
  { value: "", label: "全部审核" },
  { value: "approved", label: "已公开" },
  { value: "pending", label: "待审" },
  { value: "needs_changes", label: "补充" },
  { value: "rejected", label: "拒绝" },
  { value: "merged", label: "合并" }
];
const requestTypeFilters = [
  { value: "", label: "全部类型" },
  { value: "store", label: "店家" },
  { value: "script", label: "剧本" }
];
const requestStatusFilters = [
  { value: "pending", label: "待审" },
  { value: "needs_changes", label: "补充" },
  { value: "approved", label: "公开" },
  { value: "rejected", label: "拒绝" },
  { value: "merged", label: "合并" },
  { value: "", label: "全部" }
];
const genderOptions = [
  { value: "unlimited", label: "不限" },
  { value: "male", label: "男位" },
  { value: "female", label: "女位" }
];

const activeTab = ref("stores");
const roles = ref(getCurrentUser().roles || []);
const isAdmin = computed(() => roles.value.includes("system_admin"));
const loading = ref(false);
const loadError = ref("");
const lastOperationMessage = ref("准备处理资料");
const dirty = ref(false);

const stores = ref([]);
const storeKeyword = ref("");
const storeCityFilter = ref("");
const storeStatus = ref("");
const storeReviewStatus = ref("");
const editingStoreId = ref("");
const storeForm = ref(defaultStoreForm());
const storeScriptLinks = ref([]);
const storeLinkKeyword = ref("");
const pendingStoreScriptPrice = ref("");

const scripts = ref([]);
const scriptKeyword = ref("");
const scriptTagFilter = ref("");
const scriptStatus = ref("");
const scriptReviewStatus = ref("");
const editingScriptId = ref("");
const scriptForm = ref(defaultScriptForm());
const scriptRoleRows = ref(defaultRoleRows(6));
const scriptNpcRows = ref([]);
const scriptTemplateParseError = ref("");
const scriptRawTemplateText = ref("");

const requests = ref([]);
const requestKeyword = ref("");
const requestStatus = ref("pending");
const reviewTypeFilter = ref("");
const reviewNote = ref("");
const mergeTargetId = ref("");
const editingReviewItem = ref(null);
const reviewForm = ref(defaultReviewForm());
const reviewRoleRows = ref([]);
const reviewNpcRows = ref([]);
const reviewStoreLinks = ref([]);

const selectionMode = ref("");
const selectedStoreIds = ref([]);
const selectedScriptIds = ref([]);

const catalogStats = computed(() => [
  { key: "stores", label: "店家", value: stores.value.length },
  { key: "scripts", label: "剧本", value: scripts.value.length },
  { key: "requests", label: "待审核", value: requests.value.length }
]);
const currentEditingStore = computed(
  () => stores.value.find((store) => Number(store.id) === Number(editingStoreId.value)) || {}
);
const currentEditingScript = computed(
  () => scripts.value.find((script) => Number(script.id) === Number(editingScriptId.value)) || {}
);
const roleCountWarning = computed(
  () => Number(scriptForm.value.playerCount || 0) !== scriptRoleRows.value.length
);
const storeLinkCandidates = computed(() => {
  const linked = new Set(storeScriptLinks.value.map((link) => Number(link.scriptId)));
  const keyword = String(storeLinkKeyword.value || "").trim().toLowerCase();
  return scripts.value
    .filter((script) => script.status === "active")
    .filter((script) => !linked.has(Number(script.id)))
    .filter((script) => {
      if (!keyword) {
        return true;
      }
      return `${script.name || ""} ${displayTags(script.type_tags)}`.toLowerCase().includes(keyword);
    })
    .slice(0, 8);
});
const reviewStoreCandidates = computed(() => {
  const linked = new Set(reviewStoreLinks.value.map((link) => Number(link.storeId)));
  return stores.value
    .filter((store) => store.status === "active")
    .filter((store) => !linked.has(Number(store.id)))
    .slice(0, 8);
});

onLoad(syncAdminState);
onShow(syncAdminState);

function syncAdminState() {
  roles.value = getCurrentUser().roles || [];
  if (isAdmin.value) {
    refreshAll();
  }
}

function defaultStoreForm() {
  return {
    name: "",
    city: "北京",
    district: "",
    address: "",
    contactNote: "",
    latitude: "",
    longitude: "",
    status: "active"
  };
}

function defaultScriptForm() {
  return {
    name: "",
    typeTagsText: "情感,沉浸",
    playerCount: "6",
    summaryNoSpoiler: "",
    status: "active"
  };
}

function defaultReviewForm() {
  return {
    name: "",
    city: "北京",
    district: "",
    address: "",
    contactNote: "",
    latitude: "",
    longitude: "",
    typeTagsText: "",
    playerCount: "6",
    summaryNoSpoiler: "",
    status: "active"
  };
}

function defaultRoleRows(count) {
  return Array.from({ length: Math.max(Number(count || 0), 1) }, (_, index) =>
    toEditorRole({}, index)
  );
}

function showMessage(title, icon = "none") {
  showToast({ title, icon });
  lastOperationMessage.value = title;
}

function markDirty() {
  dirty.value = true;
}

function modalConfirm(options = {}) {
  return new Promise((resolve) => {
    showModal({
      title: options.title || "确认操作",
      content: options.content || "确认继续？",
      confirmText: options.confirmText || "确认",
      cancelText: options.cancelText || "取消",
      success(result) {
        resolve(Boolean(result.confirm));
      },
      fail() {
        resolve(false);
      }
    });
  });
}

async function confirmDiscardChanges() {
  if (!dirty.value) {
    return true;
  }
  return modalConfirm({
    title: "放弃未保存修改？",
    content: "当前表单有未保存内容，继续会丢弃这些修改。",
    confirmText: "放弃修改"
  });
}

function confirmDanger(title, content) {
  return modalConfirm({ title, content, confirmText: "确认" });
}

function goMine() {
  uni.navigateTo({ url: "/pages/mine/index" });
}

async function handleTabChange(event) {
  await switchTab(event.detail.value);
}

async function switchTab(tabKey) {
  if (tabKey === activeTab.value) {
    return;
  }
  if (!(await confirmDiscardChanges())) {
    return;
  }
  dirty.value = false;
  activeTab.value = tabKey;
  selectionMode.value = "";
}

function parseAdminWebLoginQr(rawValue) {
  const value = String(rawValue || "");
  const prefix = "pinche-admin-login://ticket/";
  if (!value.startsWith(prefix)) {
    return null;
  }

  const withoutPrefix = value.slice(prefix.length);
  const [ticketId, queryText = ""] = withoutPrefix.split("?");
  const secretPair = queryText
    .split("&")
    .map((item) => item.split("="))
    .find(([key]) => key === "secret");
  const secret = secretPair ? decodeURIComponent(secretPair[1] || "") : "";
  if (!ticketId || !secret) {
    return null;
  }

  return { ticketId, secret };
}

function confirmAdminWebLogin() {
  return modalConfirm({
    title: "Web 后台登录",
    content: "确认批准这台电脑登录 Web 管理后台？",
    confirmText: "确认登录"
  });
}

async function scanAdminWebLogin() {
  const result = await new Promise((resolve, reject) => {
    uni.scanCode({
      onlyFromCamera: false,
      success: resolve,
      fail: reject
    });
  }).catch(() => null);

  const parsed = parseAdminWebLoginQr(result?.result);
  if (!parsed) {
    showMessage("请扫描 Web 后台登录二维码");
    return;
  }

  const confirmed = await confirmAdminWebLogin();
  if (!confirmed) {
    showMessage("已取消 Web 后台登录");
    return;
  }

  try {
    await request({
      url: `/api/admin/web-login/tickets/${parsed.ticketId}/approve`,
      method: "POST",
      data: { secret: parsed.secret }
    });
    showMessage("Web 后台已登录", "success");
  } catch (error) {
    showMessage(error?.message || "Web 后台登录失败");
  }
}

function displayTags(value) {
  if (!value) {
    return "未标注";
  }
  if (Array.isArray(value)) {
    return value.join("、");
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.join("、") : String(value);
  } catch (error) {
    return String(value);
  }
}

function typeTagsFromText(value) {
  return String(value || "")
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonArray(value) {
  if (!value) {
    return { items: [], failed: false, raw: "" };
  }
  if (Array.isArray(value)) {
    return { items: value, failed: false, raw: "" };
  }
  try {
    const parsed = JSON.parse(value);
    return { items: Array.isArray(parsed) ? parsed : [], failed: !Array.isArray(parsed), raw: value };
  } catch (error) {
    return { items: [], failed: true, raw: String(value) };
  }
}

function coordinateText(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  return String(value);
}

function normalizeEntityId(value) {
  return Number(value || 0);
}

function centsToYuan(value) {
  const cents = Number(value || 0);
  if (!Number.isFinite(cents) || cents <= 0) {
    return "";
  }
  return String(cents / 100);
}

function yuanToCents(value) {
  const yuan = Number(value || 0);
  if (!Number.isFinite(yuan) || yuan <= 0) {
    return 0;
  }
  return Math.round(yuan * 100);
}

function toEditorRole(role = {}, index = 0) {
  return {
    id: role.id || `role-${Date.now()}-${index}-${Math.random()}`,
    name: role.name || role.roleName || role.role_name || `角色${index + 1}`,
    description: role.description || role.roleDescription || role.role_description || "",
    roleGender: role.roleGender || role.role_gender || role.gender || "unlimited"
  };
}

function toEditorNpcRole(role = {}, index = 0) {
  return {
    id: role.id || `npc-${Date.now()}-${index}-${Math.random()}`,
    name: role.name || role.roleName || role.role_name || "",
    description: role.description || role.roleDescription || role.note || "",
    roleGender: role.roleGender || role.role_gender || role.gender || "unlimited"
  };
}

function buildSeatTemplateFromRoles(rows = scriptRoleRows.value) {
  return rows.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    roleGender: role.roleGender || "unlimited"
  }));
}

function buildNpcRolesPayload(rows = scriptNpcRows.value) {
  return rows
    .map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      roleGender: role.roleGender || "unlimited"
    }))
    .filter((role) => role.name);
}

function hasStoreLocation(form) {
  const latitude = Number(form?.latitude);
  const longitude = Number(form?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude);
}

function storeLocationText(form) {
  return hasStoreLocation(form)
    ? `已选坐标 ${form.latitude}，${form.longitude}`
    : "可手填 GCJ-02 坐标";
}

function currentStorePayload() {
  return {
    name: storeForm.value.name,
    city: storeForm.value.city,
    district: storeForm.value.district,
    address: storeForm.value.address,
    contactNote: storeForm.value.contactNote,
    latitude: storeForm.value.latitude,
    longitude: storeForm.value.longitude,
    status: storeForm.value.status
  };
}

async function withLoading(action, fallbackMessage = "操作失败") {
  loading.value = true;
  loadError.value = "";
  try {
    return await action();
  } catch (error) {
    const message = error?.message || fallbackMessage;
    loadError.value = message;
    showMessage(message);
    return null;
  } finally {
    loading.value = false;
  }
}

async function refreshAll() {
  await withLoading(async () => {
    await Promise.all([loadStores(false), loadScripts(false), loadRequests(false)]);
    lastOperationMessage.value = "资料已刷新";
  }, "资料加载失败");
}

async function retryActiveTab() {
  if (activeTab.value === "stores") {
    await loadStores();
  } else if (activeTab.value === "scripts") {
    await loadScripts();
  } else {
    await loadRequests();
  }
}

async function loadStores(showLoading = true) {
  const action = async () => {
    const response = await request({
      url:
        "/api/admin/stores" +
        queryString({
          keyword: [storeKeyword.value, storeCityFilter.value].filter(Boolean).join(" "),
          status: storeStatus.value,
          reviewStatus: storeReviewStatus.value,
          limit: 120
        })
    });
    stores.value = dataOf(response) || [];
    return stores.value;
  };
  return showLoading ? withLoading(action, "店家加载失败") : action();
}

function setStoreStatus(status) {
  storeStatus.value = status;
  loadStores();
}

function setStoreReviewStatus(status) {
  storeReviewStatus.value = status;
  loadStores();
}

function updateStoreField(field, value) {
  storeForm.value = { ...storeForm.value, [field]: value };
  markDirty();
}

async function resetStoreForm() {
  if (!(await confirmDiscardChanges())) {
    return;
  }
  editingStoreId.value = "";
  storeForm.value = defaultStoreForm();
  storeScriptLinks.value = [];
  dirty.value = false;
}

async function editStore(store) {
  if (!(await confirmDiscardChanges())) {
    return;
  }
  editingStoreId.value = store.id;
  storeForm.value = {
    name: store.name || "",
    city: store.city || "北京",
    district: store.district || "",
    address: store.address || "",
    contactNote: store.contact_note || store.contactNote || "",
    latitude: coordinateText(store.latitude),
    longitude: coordinateText(store.longitude),
    status: store.status || "active"
  };
  await loadStoreScripts(store.id);
  dirty.value = false;
}

async function loadStoreScripts(storeId) {
  if (!storeId) {
    storeScriptLinks.value = [];
    return [];
  }
  const response = await request({ url: `/api/admin/stores/${storeId}/scripts` });
  const rows = dataOf(response) || [];
  storeScriptLinks.value = rows.map((script) => ({
    scriptId: Number(script.id || script.scriptId),
    scriptName: script.name || script.scriptName || `剧本 ${script.id}`,
    pricePerPerson: centsToYuan(script.pricePerPlayer ?? script.price_per_player)
  }));
  return storeScriptLinks.value;
}

function addStoreScriptLink(script) {
  const scriptId = Number(script.id);
  if (!scriptId || storeScriptLinks.value.some((link) => Number(link.scriptId) === scriptId)) {
    return;
  }
  storeScriptLinks.value = [
    ...storeScriptLinks.value,
    {
      scriptId,
      scriptName: script.name,
      pricePerPerson: pendingStoreScriptPrice.value || ""
    }
  ];
  pendingStoreScriptPrice.value = "";
  markDirty();
}

function removeStoreScriptLink(scriptId) {
  storeScriptLinks.value = storeScriptLinks.value.filter(
    (link) => Number(link.scriptId) !== Number(scriptId)
  );
  markDirty();
}

function updateStoreLinkPrice(scriptId, value) {
  storeScriptLinks.value = storeScriptLinks.value.map((link) =>
    Number(link.scriptId) === Number(scriptId) ? { ...link, pricePerPerson: value } : link
  );
  markDirty();
}

async function saveStoreScripts(storeId) {
  await request({
    url: `/api/admin/stores/${storeId}/scripts`,
    method: "PUT",
    data: {
      scriptLinks: storeScriptLinks.value.map((link) => ({
        scriptId: Number(link.scriptId),
        pricePerPlayer: yuanToCents(link.pricePerPerson)
      }))
    }
  });
}

async function pickStoreLocation() {
  if (typeof uni.chooseLocation !== "function") {
    showMessage("当前环境不支持地图选点，请手填坐标");
    return;
  }
  const result = await new Promise((resolve, reject) => {
    uni.chooseLocation({ success: resolve, fail: reject });
  }).catch((error) => {
    if (!String(error?.errMsg || "").includes("cancel")) {
      showMessage("地图选点失败，请手填坐标");
    }
    return null;
  });
  if (!result) {
    return;
  }
  storeForm.value = {
    ...storeForm.value,
    address: result.address || result.name || storeForm.value.address,
    latitude: coordinateText(result.latitude),
    longitude: coordinateText(result.longitude)
  };
  markDirty();
}

async function pickReviewStoreLocation() {
  if (typeof uni.chooseLocation !== "function") {
    showMessage("当前环境不支持地图选点，请手填坐标");
    return;
  }
  const result = await new Promise((resolve, reject) => {
    uni.chooseLocation({ success: resolve, fail: reject });
  }).catch((error) => {
    if (!String(error?.errMsg || "").includes("cancel")) {
      showMessage("地图选点失败，请手填坐标");
    }
    return null;
  });
  if (!result) {
    return;
  }
  reviewForm.value = {
    ...reviewForm.value,
    address: result.address || result.name || reviewForm.value.address,
    latitude: coordinateText(result.latitude),
    longitude: coordinateText(result.longitude)
  };
  markDirty();
}

function openStoreLocation(form) {
  if (!hasStoreLocation(form) || typeof uni.openLocation !== "function") {
    showMessage("缺少完整坐标");
    return;
  }
  uni.openLocation({
    latitude: Number(form.latitude),
    longitude: Number(form.longitude),
    name: form.name || "剧本店位置",
    address: form.address || "",
    scale: 18,
    fail() {
      showMessage("地图打开失败，请稍后再试");
    }
  });
}

async function saveStore() {
  if (!storeForm.value.name || !storeForm.value.city) {
    showMessage("请填写店家名称和城市");
    return;
  }
  await withLoading(async () => {
    const method = editingStoreId.value ? "PATCH" : "POST";
    const url = editingStoreId.value
      ? `/api/admin/stores/${editingStoreId.value}`
      : "/api/admin/stores";
    const response = await request({ url, method, data: currentStorePayload() });
    const saved = dataOf(response) || {};
    const storeId = editingStoreId.value || saved.id;
    if (storeId) {
      await saveStoreScripts(storeId);
    }
    showMessage("店家已保存", "success");
    dirty.value = false;
    editingStoreId.value = "";
    storeForm.value = defaultStoreForm();
    storeScriptLinks.value = [];
    await loadStores(false);
  }, "店家保存失败");
}

async function toggleStore(store) {
  await withLoading(async () => {
    await request({
      url: `/api/admin/stores/${store.id}`,
      method: "PATCH",
      data: { status: store.status === "active" ? "inactive" : "active" }
    });
    await loadStores(false);
    showMessage(store.status === "active" ? "店家已下架" : "店家已上架");
  }, "店家状态更新失败");
}

async function deleteStoreByItem(store) {
  if (!store?.id) {
    return;
  }
  if (store.status !== "inactive") {
    showMessage("请先下架店家再删除");
    return;
  }
  if (!(await confirmDanger("删除店家", "删除后不可恢复，确认删除？"))) {
    return;
  }
  await withLoading(async () => {
    await request({ url: `/api/admin/stores/${store.id}`, method: "DELETE" });
    showMessage("店家已删除", "success");
    if (Number(editingStoreId.value) === Number(store.id)) {
      editingStoreId.value = "";
      storeForm.value = defaultStoreForm();
      storeScriptLinks.value = [];
      dirty.value = false;
    }
    await loadStores(false);
  }, "店家删除失败，可能仍被引用");
}

async function loadScripts(showLoading = true) {
  const action = async () => {
    const response = await request({
      url:
        "/api/admin/scripts" +
        queryString({
          keyword: [scriptKeyword.value, scriptTagFilter.value].filter(Boolean).join(" "),
          status: scriptStatus.value,
          reviewStatus: scriptReviewStatus.value,
          limit: 120
        })
    });
    scripts.value = dataOf(response) || [];
    return scripts.value;
  };
  return showLoading ? withLoading(action, "剧本加载失败") : action();
}

function setScriptStatus(status) {
  scriptStatus.value = status;
  loadScripts();
}

function setScriptReviewStatus(status) {
  scriptReviewStatus.value = status;
  loadScripts();
}

function updateScriptField(field, value) {
  scriptForm.value = { ...scriptForm.value, [field]: value };
  markDirty();
}

async function resetScriptForm() {
  if (!(await confirmDiscardChanges())) {
    return;
  }
  editingScriptId.value = "";
  scriptForm.value = defaultScriptForm();
  scriptRoleRows.value = defaultRoleRows(scriptForm.value.playerCount);
  scriptNpcRows.value = [];
  scriptTemplateParseError.value = "";
  scriptRawTemplateText.value = "";
  dirty.value = false;
}

function loadScriptRoles(script) {
  const rolesResult = parseJsonArray(script.default_seat_template_json || script.defaultSeatTemplate);
  scriptTemplateParseError.value = rolesResult.failed ? "模板 JSON 解析失败" : "";
  scriptRawTemplateText.value = rolesResult.raw || "";
  scriptRoleRows.value =
    rolesResult.items.length > 0
      ? rolesResult.items.map(toEditorRole)
      : defaultRoleRows(script.player_count || script.playerCount || 1);
  const npcResult = parseJsonArray(script.npc_roles !== undefined ? script.npc_roles : script.npcRoles);
  scriptNpcRows.value = npcResult.items.map(toEditorNpcRole);
}

async function editScript(script) {
  if (!(await confirmDiscardChanges())) {
    return;
  }
  editingScriptId.value = script.id;
  scriptForm.value = {
    name: script.name || "",
    typeTagsText: displayTags(script.type_tags).replaceAll("、", ","),
    playerCount: String(script.player_count || "6"),
    summaryNoSpoiler: script.summary_no_spoiler || "",
    status: script.status || "active"
  };
  loadScriptRoles(script);
  dirty.value = false;
}

function addScriptRole() {
  scriptRoleRows.value = [...scriptRoleRows.value, toEditorRole({}, scriptRoleRows.value.length)];
  markDirty();
}

function removeScriptRole(index) {
  scriptRoleRows.value.splice(index, 1);
  markDirty();
}

function moveScriptRole(index, delta) {
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= scriptRoleRows.value.length) {
    return;
  }
  const rows = [...scriptRoleRows.value];
  const [role] = rows.splice(index, 1);
  rows.splice(nextIndex, 0, role);
  scriptRoleRows.value = rows;
  markDirty();
}

function fillDefaultRoles() {
  const count = Math.max(Number(scriptForm.value.playerCount || 0), 1);
  const rows = [...scriptRoleRows.value];
  while (rows.length < count) {
    rows.push(toEditorRole({}, rows.length));
  }
  if (rows.length === 0) {
    rows.push(...defaultRoleRows(count));
  }
  scriptRoleRows.value = rows;
  scriptTemplateParseError.value = "";
  markDirty();
}

function updateRoleField(index, field, value) {
  scriptRoleRows.value[index] = { ...scriptRoleRows.value[index], [field]: value };
  markDirty();
}

function addNpcRole() {
  scriptNpcRows.value = [...scriptNpcRows.value, toEditorNpcRole({}, scriptNpcRows.value.length)];
  markDirty();
}

function removeNpcRole(index) {
  scriptNpcRows.value.splice(index, 1);
  markDirty();
}

function moveNpcRole(index, delta) {
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= scriptNpcRows.value.length) {
    return;
  }
  const rows = [...scriptNpcRows.value];
  const [role] = rows.splice(index, 1);
  rows.splice(nextIndex, 0, role);
  scriptNpcRows.value = rows;
  markDirty();
}

function updateNpcRoleField(index, field, value) {
  scriptNpcRows.value[index] = { ...scriptNpcRows.value[index], [field]: value };
  markDirty();
}

async function saveScript() {
  if (!scriptForm.value.name) {
    showMessage("请填写剧本名称");
    return;
  }
  if (scriptTemplateParseError.value && scriptRoleRows.value.length === 0) {
    showMessage("模板 JSON 解析失败，请补齐角色后保存");
    return;
  }
  await withLoading(async () => {
    const method = editingScriptId.value ? "PATCH" : "POST";
    const url = editingScriptId.value
      ? `/api/admin/scripts/${editingScriptId.value}`
      : "/api/admin/scripts";
    await request({
      url,
      method,
      data: {
        name: scriptForm.value.name,
        typeTags: typeTagsFromText(scriptForm.value.typeTagsText),
        playerCount: Number(scriptForm.value.playerCount || 0),
        summaryNoSpoiler: scriptForm.value.summaryNoSpoiler,
        defaultSeatTemplate: buildSeatTemplateFromRoles(),
        npcRoles: buildNpcRolesPayload(),
        status: scriptForm.value.status
      }
    });
    showMessage("剧本已保存", "success");
    dirty.value = false;
    editingScriptId.value = "";
    scriptForm.value = defaultScriptForm();
    scriptRoleRows.value = defaultRoleRows(6);
    scriptNpcRows.value = [];
    await loadScripts(false);
  }, "剧本保存失败");
}

async function toggleScript(script) {
  await withLoading(async () => {
    await request({
      url: `/api/admin/scripts/${script.id}`,
      method: "PATCH",
      data: { status: script.status === "active" ? "inactive" : "active" }
    });
    await loadScripts(false);
    showMessage(script.status === "active" ? "剧本已下架" : "剧本已上架");
  }, "剧本状态更新失败");
}

async function deleteScriptByItem(script) {
  if (!script?.id) {
    return;
  }
  if (script.status !== "inactive") {
    showMessage("请先下架剧本再删除");
    return;
  }
  if (!(await confirmDanger("删除剧本", "删除后不可恢复，确认删除？"))) {
    return;
  }
  await withLoading(async () => {
    await request({ url: `/api/admin/scripts/${script.id}`, method: "DELETE" });
    showMessage("剧本已删除", "success");
    if (Number(editingScriptId.value) === Number(script.id)) {
      editingScriptId.value = "";
      scriptForm.value = defaultScriptForm();
      scriptRoleRows.value = defaultRoleRows(6);
      scriptNpcRows.value = [];
      dirty.value = false;
    }
    await loadScripts(false);
  }, "剧本删除失败，可能仍被引用");
}

async function loadRequests(showLoading = true) {
  const action = async () => {
    const response = await request({
      url:
        "/api/admin/catalog-review-items" +
        queryString({
          keyword: requestKeyword.value,
          status: requestStatus.value,
          type: reviewTypeFilter.value,
          limit: 120
        })
    });
    requests.value = dataOf(response) || [];
    return requests.value;
  };
  return showLoading ? withLoading(action, "待审核资料加载失败") : action();
}

function setRequestStatus(status) {
  requestStatus.value = status;
  loadRequests();
}

function setReviewTypeFilter(type) {
  reviewTypeFilter.value = type;
  loadRequests();
}

function itemTypeLabel(type) {
  return type === "script" ? "剧本" : "店家";
}

function reviewStatusLabel(status) {
  const labels = {
    pending: "待审核",
    needs_changes: "需要补充",
    approved: "已公开",
    rejected: "已拒绝",
    merged: "已合并"
  };
  return labels[status] || status || "-";
}

function catalogAuditStatus(item) {
  return item.review_status || "approved";
}

function catalogAuditLabel(item) {
  return reviewStatusLabel(catalogAuditStatus(item));
}

function catalogAuditClass(item) {
  return catalogAuditStatus(item);
}

function reviewItemMeta(item) {
  if (item.type === "script") {
    return `${displayTags(item.type_tags)} / ${item.player_count || 0}人`;
  }
  return `${item.city || "北京"} ${item.district || ""}`;
}

function formatDate(value) {
  return String(value || "").slice(0, 16).replace("T", " ");
}

function roleTemplateStatus(script) {
  const parsed = parseJsonArray(script.default_seat_template_json || script.defaultSeatTemplate);
  if (parsed.failed) {
    return { ok: false, label: "模板异常" };
  }
  const count = parsed.items.length;
  if (count === Number(script.player_count || 0)) {
    return { ok: true, label: "角色匹配" };
  }
  return { ok: false, label: `${count} 个角色` };
}

function npcRoleCount(script) {
  const parsed = parseJsonArray(script.npc_roles !== undefined ? script.npc_roles : script.npcRoles);
  return parsed.items.length;
}

async function editReviewItem(item) {
  if (!(await confirmDiscardChanges())) {
    return;
  }
  editingReviewItem.value = { ...item };
  reviewNote.value = item.review_note || "";
  mergeTargetId.value = item.merged_into_id ? String(item.merged_into_id) : "";
  if (item.type === "script") {
    reviewForm.value = {
      ...defaultReviewForm(),
      name: item.name || "",
      typeTagsText: displayTags(item.type_tags).replaceAll("、", ","),
      playerCount: String(item.player_count || "6"),
      summaryNoSpoiler: item.summary_no_spoiler || "",
      status: item.status || "active"
    };
    reviewRoleRows.value = parseJsonArray(
      item.default_seat_template_json || item.defaultSeatTemplate
    ).items.map(toEditorRole);
    if (reviewRoleRows.value.length === 0) {
      reviewRoleRows.value = defaultRoleRows(item.player_count || 1);
    }
    reviewNpcRows.value = parseJsonArray(
      item.npc_roles !== undefined ? item.npc_roles : item.npcRoles
    ).items.map(toEditorNpcRole);
    reviewStoreLinks.value = [];
  } else {
    reviewForm.value = {
      ...defaultReviewForm(),
      name: item.name || "",
      city: item.city || "北京",
      district: item.district || "",
      address: item.address || "",
      contactNote: item.contact_note || item.contactNote || "",
      latitude: coordinateText(item.latitude),
      longitude: coordinateText(item.longitude),
      status: item.status || "active"
    };
    reviewRoleRows.value = [];
    reviewNpcRows.value = [];
    reviewStoreLinks.value = [];
  }
  dirty.value = false;
}

async function closeReviewEditor() {
  if (!(await confirmDiscardChanges())) {
    return;
  }
  editingReviewItem.value = null;
  reviewForm.value = defaultReviewForm();
  reviewRoleRows.value = [];
  reviewNpcRows.value = [];
  reviewStoreLinks.value = [];
  dirty.value = false;
}

function updateReviewFormField(field, value) {
  reviewForm.value = { ...reviewForm.value, [field]: value };
  markDirty();
}

function addReviewRole() {
  reviewRoleRows.value = [...reviewRoleRows.value, toEditorRole({}, reviewRoleRows.value.length)];
  markDirty();
}

function updateReviewRoleField(index, field, value) {
  reviewRoleRows.value[index] = { ...reviewRoleRows.value[index], [field]: value };
  markDirty();
}

function addReviewNpcRole() {
  reviewNpcRows.value = [...reviewNpcRows.value, toEditorNpcRole({}, reviewNpcRows.value.length)];
  markDirty();
}

function updateReviewNpcField(index, field, value) {
  reviewNpcRows.value[index] = { ...reviewNpcRows.value[index], [field]: value };
  markDirty();
}

function addReviewStoreLink(store) {
  if (reviewStoreLinks.value.some((link) => Number(link.storeId) === Number(store.id))) {
    return;
  }
  reviewStoreLinks.value = [
    ...reviewStoreLinks.value,
    { storeId: Number(store.id), storeName: store.name, pricePerPerson: "" }
  ];
  markDirty();
}

function removeReviewStoreLink(storeId) {
  reviewStoreLinks.value = reviewStoreLinks.value.filter(
    (link) => Number(link.storeId) !== Number(storeId)
  );
  markDirty();
}

function updateReviewStoreLinkPrice(storeId, value) {
  reviewStoreLinks.value = reviewStoreLinks.value.map((link) =>
    Number(link.storeId) === Number(storeId) ? { ...link, pricePerPerson: value } : link
  );
  markDirty();
}

function reviewPayload(defaultNote = "") {
  const payload = {
    reviewNote: reviewNote.value || defaultNote
  };
  const item = editingReviewItem.value;
  if (!item) {
    return payload;
  }
  if (item.type === "store") {
    return {
      ...payload,
      name: reviewForm.value.name,
      city: reviewForm.value.city,
      district: reviewForm.value.district,
      address: reviewForm.value.address,
      contactNote: reviewForm.value.contactNote,
      latitude: reviewForm.value.latitude,
      longitude: reviewForm.value.longitude,
      status: reviewForm.value.status
    };
  }
  return {
    ...payload,
    name: reviewForm.value.name,
    typeTags: typeTagsFromText(reviewForm.value.typeTagsText),
    playerCount: Number(reviewForm.value.playerCount || 0),
    summaryNoSpoiler: reviewForm.value.summaryNoSpoiler,
    defaultSeatTemplate: buildSeatTemplateFromRoles(reviewRoleRows.value),
    npcRoles: buildNpcRolesPayload(reviewNpcRows.value),
    status: reviewForm.value.status,
    storeScriptLinks: reviewStoreLinks.value.map((link) => ({
      storeId: Number(link.storeId),
      pricePerPlayer: yuanToCents(link.pricePerPerson)
    }))
  };
}

function actionPayloadForItem(item, defaultNote = "") {
  if (
    editingReviewItem.value &&
    item &&
    editingReviewItem.value.type === item.type &&
    Number(editingReviewItem.value.id) === Number(item.id)
  ) {
    return reviewPayload(defaultNote);
  }
  return {
    reviewNote: reviewNote.value || defaultNote
  };
}

async function saveReviewDraft() {
  const item = editingReviewItem.value;
  if (!item) {
    return;
  }
  await withLoading(async () => {
    await request({
      url: `/api/admin/catalog-review-items/${item.type}/${item.id}`,
      method: "PATCH",
      data: reviewPayload("已更新资料")
    });
    dirty.value = false;
    showMessage("审核草稿已保存", "success");
    await loadRequests(false);
  }, "审核草稿保存失败");
}

async function finishReviewAction(message) {
  showMessage(message, "success");
  reviewNote.value = "";
  mergeTargetId.value = "";
  editingReviewItem.value = null;
  dirty.value = false;
  await Promise.all([loadRequests(false), loadStores(false), loadScripts(false)]);
}

async function approveReviewItem(item) {
  await withLoading(async () => {
    await request({
      url: `/api/admin/catalog-review-items/${item.type}/${item.id}/approve`,
      method: "POST",
      data: actionPayloadForItem(item, "通过，已公开")
    });
    await finishReviewAction("已批准公开");
  }, "批准失败");
}

async function needsChangesReviewItem(item) {
  await withLoading(async () => {
    await request({
      url: `/api/admin/catalog-review-items/${item.type}/${item.id}/needs-changes`,
      method: "POST",
      data: actionPayloadForItem(item, "请补充资料")
    });
    await finishReviewAction("已标记需要补充");
  }, "标记补充失败");
}

async function rejectReviewItem(item) {
  if (!(await confirmDanger("拒绝资料", "确认拒绝这条资料？"))) {
    return;
  }
  await withLoading(async () => {
    await request({
      url: `/api/admin/catalog-review-items/${item.type}/${item.id}/reject`,
      method: "POST",
      data: actionPayloadForItem(item, "资料不完整，未通过")
    });
    await finishReviewAction("已拒绝");
  }, "拒绝失败");
}

async function mergeReviewItem(item) {
  const targetId = Number(mergeTargetId.value || 0);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    showMessage("请填写合并目标公共资料 ID");
    return;
  }
  if (!(await confirmDanger("合并资料", "确认合并到目标公共资料？"))) {
    return;
  }
  await withLoading(async () => {
    await request({
      url: `/api/admin/catalog-review-items/${item.type}/${item.id}/merge`,
      method: "POST",
      data: {
        ...actionPayloadForItem(item, "已合并到已有公共资料"),
        mergedIntoId: targetId
      }
    });
    await finishReviewAction("已合并");
  }, "合并失败");
}

function selectedIds(kind) {
  return kind === "stores" ? selectedStoreIds.value : selectedScriptIds.value;
}

function setSelectedIds(kind, ids) {
  if (kind === "stores") {
    selectedStoreIds.value = ids;
  } else {
    selectedScriptIds.value = ids;
  }
}

function listForKind(kind) {
  return kind === "stores" ? stores.value : scripts.value;
}

function endpointForKind(kind, id) {
  return kind === "stores" ? `/api/admin/stores/${id}` : `/api/admin/scripts/${id}`;
}

function toggleSelectionMode(kind) {
  selectionMode.value = selectionMode.value === kind ? "" : kind;
  if (selectionMode.value !== kind) {
    setSelectedIds(kind, []);
  }
}

function isSelected(kind, id) {
  return selectedIds(kind).some((selectedId) => Number(selectedId) === Number(id));
}

function toggleItemSelected(kind, id) {
  const current = selectedIds(kind);
  if (isSelected(kind, id)) {
    setSelectedIds(
      kind,
      current.filter((selectedId) => Number(selectedId) !== Number(id))
    );
  } else {
    setSelectedIds(kind, [...current, Number(id)]);
  }
}

async function runBulkStatus(kind, status) {
  const ids = selectedIds(kind);
  if (ids.length === 0) {
    showMessage("请先选择资料");
    return;
  }
  await withLoading(async () => {
    let success = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await request({ url: endpointForKind(kind, id), method: "PATCH", data: { status } });
        success += 1;
      } catch (error) {
        failed += 1;
      }
    }
    showMessage(`批量${status === "active" ? "上架" : "下架"}：成功 ${success}，失败 ${failed}`);
    setSelectedIds(kind, []);
    if (kind === "stores") {
      await loadStores(false);
    } else {
      await loadScripts(false);
    }
  }, "批量操作失败");
}

async function runBulkDelete(kind) {
  const ids = selectedIds(kind);
  if (ids.length === 0) {
    showMessage("请先选择资料");
    return;
  }
  const items = listForKind(kind).filter((item) => ids.includes(Number(item.id)));
  const deletable = items.filter((item) => item.status === "inactive");
  const skipped = items.length - deletable.length;
  if (deletable.length === 0) {
    showMessage("批量删除仅处理已下架资料");
    return;
  }
  if (!(await confirmDanger("批量删除", `将删除 ${deletable.length} 条资料，跳过 ${skipped} 条未下架资料。`))) {
    return;
  }
  await withLoading(async () => {
    let success = 0;
    let failed = 0;
    for (const item of deletable) {
      try {
        await request({ url: endpointForKind(kind, item.id), method: "DELETE" });
        success += 1;
      } catch (error) {
        failed += 1;
      }
    }
    showMessage(`批量删除：成功 ${success}，失败 ${failed}，跳过 ${skipped}`);
    setSelectedIds(kind, []);
    if (kind === "stores") {
      await loadStores(false);
    } else {
      await loadScripts(false);
    }
  }, "批量删除失败");
}
</script>

<style scoped>
.panel {
  display: block;
}

.workbench-head,
.section-head,
.card-head {
  display: flex;
  gap: 16rpx;
  align-items: flex-start;
  justify-content: space-between;
}

.workbench-tools,
.card-actions {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  align-items: flex-end;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12rpx;
  margin-top: 22rpx;
}

.stat-tile {
  min-width: 0;
  padding: 18rpx 12rpx;
  border: 1rpx solid #dbe4ea;
  border-radius: 8rpx;
  background: #ffffff;
}

.stat-tile.active {
  border-color: #1f7a68;
  background: #eef7f4;
}

.stat-value {
  color: #1f2933;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1.1;
}

.stat-label,
.section-note,
.status-line,
.empty-inline,
.warning {
  color: #64748b;
  font-size: 24rpx;
  line-height: 1.45;
}

.status-line {
  margin-top: 16rpx;
}

.status-line.error,
.warning {
  color: #be123c;
}

.section-title {
  margin-bottom: 8rpx;
  font-size: 30rpx;
  font-weight: 600;
}

.editor-section {
  border-left: 6rpx solid #1f7a68;
}

.compact {
  padding-top: 16rpx;
  padding-bottom: 16rpx;
}

.toggle-row,
.field-row,
.search-row,
.item-actions,
.actions {
  display: flex;
  gap: 12rpx;
}

.wrap {
  flex-wrap: wrap;
}

.tight {
  margin-top: 10rpx;
}

.tabs {
  display: block;
  width: 100%;
  min-width: 0;
  margin-top: 24rpx;
}

.tool-button,
.tab,
.toggle,
.mini-button {
  min-width: 120rpx;
  min-height: 64rpx;
  padding: 0 18rpx;
  border-radius: 8rpx;
  background: #eef2f7;
  color: #334155;
  font-size: 24rpx;
  line-height: 64rpx;
}

.toggle.active,
.mini-button,
.tool-button {
  background: #1f7a68;
  color: #ffffff;
}

.mini-button.secondary,
.tool-button.secondary,
.button.secondary {
  border: 1rpx solid rgba(31, 122, 104, 0.34);
  background: #eef7f4;
  color: #1f6f5b;
  --td-button-default-bg-color: #eef7f4;
  --td-button-default-color: #1f6f5b;
  --td-button-default-border-color: rgba(31, 122, 104, 0.34);
}

.mini-button.muted {
  background: #2b765f;
  color: #ffffff;
  --td-button-default-bg-color: #2b765f;
  --td-button-default-color: #ffffff;
  --td-button-default-border-color: #1f6f5b;
}

.mini-button.danger,
.button.danger {
  background: #be123c;
  color: #ffffff;
}

.field,
.textarea {
  width: 100%;
  min-height: 76rpx;
  margin-bottom: 16rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  border: 1rpx solid #d7dde5;
  border-radius: 8rpx;
  background: #ffffff;
  color: #1f2933;
  font-size: 28rpx;
}

.textarea {
  min-height: 156rpx;
  padding-top: 18rpx;
  line-height: 1.5;
}

.textarea.template {
  min-height: 220rpx;
  font-family: Menlo, Consolas, monospace;
  font-size: 24rpx;
}

.field.half {
  flex: 1;
}

.field.search {
  flex: 1;
}

.price-field {
  width: 160rpx;
}

.half-button {
  flex: 1;
}

.form-card {
  margin: 18rpx 0;
  padding: 18rpx;
  border: 1rpx solid #e3e8ef;
  border-radius: 8rpx;
  background: #f8fafc;
}

.card-title {
  margin-bottom: 10rpx;
  color: #1f2933;
  font-size: 26rpx;
  font-weight: 700;
}

.item,
.link-option,
.linked-row,
.role-card {
  display: flex;
  gap: 16rpx;
  align-items: flex-start;
  justify-content: space-between;
  margin-top: 18rpx;
  padding: 20rpx 0;
  border-top: 1rpx solid #edf1f5;
}

.role-card {
  display: block;
  padding: 18rpx;
  border: 1rpx solid #e3e8ef;
  border-radius: 8rpx;
  background: #ffffff;
}

.role-index {
  margin-bottom: 12rpx;
  color: #334155;
  font-size: 24rpx;
  font-weight: 700;
}

.item-main,
.link-main,
.linked-name {
  flex: 1;
  min-width: 0;
}

.item-title {
  margin-bottom: 8rpx;
  color: #1f2933;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1.35;
}

.item-sub {
  color: #64748b;
  font-size: 24rpx;
  line-height: 1.45;
  word-break: break-all;
}

.linked-price {
  width: 160rpx;
  margin-bottom: 0;
}

.audit-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-top: 10rpx;
}

.audit-badge {
  padding: 5rpx 12rpx;
  border-radius: 6rpx;
  background: #eef2f7;
  color: #334155;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 1.35;
}

.audit-badge.pending {
  background: #fbf6e9;
  color: #967139;
}

.audit-badge.needs_changes,
.audit-badge.rejected {
  background: #fff1f2;
  color: #be123c;
}

.audit-badge.approved {
  background: #eef7f4;
  color: #1f7a68;
}

.audit-badge.merged,
.audit-badge.location {
  background: #eef2f7;
  color: #64748b;
}

.item-actions {
  flex-direction: column;
}

.bulk-bar {
  position: sticky;
  bottom: 16rpx;
  z-index: 5;
  display: flex;
  gap: 10rpx;
  align-items: center;
  margin: 20rpx 24rpx;
  padding: 16rpx;
  border: 1rpx solid #dbe4ea;
  border-radius: 8rpx;
  background: #ffffff;
  box-shadow: 0 10rpx 28rpx rgba(15, 23, 42, 0.12);
}

.bulk-text {
  flex: 1;
  min-width: 0;
  color: #334155;
  font-size: 24rpx;
  font-weight: 700;
}
</style>
