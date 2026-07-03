<template>
  <section class="mini-app-workspace" :class="{ busy }">
    <p v-if="statusText" class="warning">{{ statusText }}</p>
    <p v-if="errorText" class="error">{{ errorText }}</p>
    <p v-if="busy" class="loading-strip">{{ busyText || "处理中..." }}</p>

    <div v-if="screen === 'create'" class="table-card mini-section">
      <div class="section-head">
        <h3>创建车局</h3>
        <span>{{ createStepLabel }}</span>
      </div>
      <div class="mini-flow">
        <div class="mini-stepper">
          <button
            v-for="item in createSteps"
            :key="item.value"
            type="button"
            :class="{ active: createStep === item.value }"
            :disabled="busy || !canEnterCreateStep(item.value)"
            @click="enterCreateStep(item.value)"
          >
            {{ item.label }}
          </button>
        </div>

        <section v-if="createStep === 'store'" class="mini-body">
          <div class="toolbar toolbar-primary mini-toolbar">
            <div class="filter-group">
              <input
                v-model="storeKeyword"
                placeholder="搜索店名或商圈"
                :disabled="busy"
                @keydown.enter="loadStores"
              />
              <button type="button" :disabled="busy" @click="loadStores">搜索店家</button>
            </div>
            <button class="primary" type="button" :disabled="busy || !canEnterCreateStep('script')" @click="enterCreateStep('script')">
              下一步
            </button>
          </div>
          <div class="mini-list">
            <button
              v-for="store in stores"
              :key="store.id"
              class="mini-list-row"
              :class="{ active: selectedStore?.id === store.id }"
              type="button"
              :disabled="busy"
              @click="selectStore(store)"
            >
              <strong>{{ store.name }}</strong>
              <span>{{ storeMeta(store) }}</span>
            </button>
            <div v-if="stores.length === 0" class="empty-block">暂无店家。</div>
          </div>
        </section>

        <section v-if="createStep === 'script'" class="mini-body">
          <div class="toolbar toolbar-primary mini-toolbar">
            <div class="filter-group">
              <input
                v-model="scriptKeyword"
                placeholder="搜索剧本"
                :disabled="busy"
                @keydown.enter="loadScripts"
              />
              <button type="button" :disabled="busy" @click="loadScripts">搜索剧本</button>
            </div>
            <button class="primary" type="button" :disabled="busy || !canEnterCreateStep('role')" @click="enterCreateStep('role')">
              下一步
            </button>
          </div>
          <div class="mini-list">
            <button
              v-for="script in scripts"
              :key="script.id"
              class="mini-list-row"
              :class="{ active: selectedScript?.id === script.id }"
              type="button"
              :disabled="busy"
              @click="selectScript(script)"
            >
              <strong>{{ script.name }}</strong>
              <span>{{ script.player_count || 0 }}人 · {{ displayTags(script.type_tags) }}</span>
              <small>{{ script.summary_no_spoiler || "暂无简介" }}</small>
            </button>
            <div v-if="scripts.length === 0" class="empty-block">暂无可选剧本。</div>
          </div>
        </section>

        <section v-if="createStep === 'role'" class="mini-body">
          <div class="role-card-grid">
            <button
              v-for="role in roleOptions"
              :key="role.id"
              class="role-card"
              :class="[role.roleGender, { active: selectedRole?.id === role.id }]"
              type="button"
              :disabled="busy"
              @click="selectedRole = role"
            >
              <strong>{{ role.name }} {{ roleGenderSymbol(role.roleGender) }}</strong>
              <span>{{ role.note || "角色位" }}</span>
            </button>
          </div>
          <div class="mini-bottom-actions">
            <button class="secondary-action" type="button" :disabled="busy" @click="enterCreateStep('script')">上一步</button>
            <button class="primary" type="button" :disabled="busy || !canEnterCreateStep('setup')" @click="enterCreateStep('setup')">
              下一步
            </button>
          </div>
        </section>

        <section v-if="createStep === 'setup'" class="mini-body">
          <div class="mini-form-grid">
            <label>
              <span>店家</span>
              <input :value="selectedStore?.name || ''" disabled />
            </label>
            <label>
              <span>剧本</span>
              <input :value="selectedScript?.name || ''" disabled />
            </label>
            <label>
              <span>日期</span>
              <input v-model="createDate" type="date" :disabled="busy" />
            </label>
            <label>
              <span>时间</span>
              <input v-model="createTime" type="time" :disabled="busy" />
            </label>
            <label class="full">
              <span>本场额外NPC</span>
              <textarea
                v-model="extraNpcRolesText"
                placeholder="每行一个NPC角色，适合店家本场额外设计"
                :disabled="busy"
              ></textarea>
            </label>
            <label class="full">
              <span>聊天置顶信息</span>
              <textarea v-model="pinnedMessageText" :placeholder="defaultPinnedMessage" :disabled="busy"></textarea>
            </label>
          </div>
          <div class="mini-bottom-actions">
            <button class="secondary-action" type="button" :disabled="busy" @click="enterCreateStep('role')">上一步</button>
            <button class="primary" type="button" :disabled="busy || !canCreate" @click="createPublishedSession">
              {{ busy ? busyText || "创建中..." : "创建车局并分享" }}
            </button>
          </div>
        </section>
      </div>
    </div>

    <div v-else-if="screen === 'home' || screen === 'mine'" class="mini-dashboard">
      <section class="table-card mini-section mine-calendar-section">
        <div class="section-head mine-calendar-head">
          <div class="mini-dashboard-title">
            <h3>我的拼车日程</h3>
            <div class="mini-dashboard-metrics" aria-label="我的拼车日程统计">
              <span>{{ mineCalendarItems.length }} 场车局</span>
              <span>发起 {{ mineCalendarOrganizedCount }}</span>
              <span>参与 {{ mineCalendarJoinedCount }}</span>
            </div>
          </div>
          <div class="mini-workbench-actions">
            <button class="primary mini-create-action" type="button" :disabled="busy" @click="startCreate">
              创建车局
            </button>
            <button type="button" class="action-button mini-refresh-action" :disabled="busy" @click="loadMine">
              刷新
            </button>
          </div>
        </div>

        <div class="mine-calendar-toolbar" role="tablist" aria-label="我的拼车日程筛选">
          <button
            v-for="filter in mineCalendarFilterTabs"
            :key="filter.value"
            type="button"
            role="tab"
            class="mine-filter-tab"
            :class="{ active: activeMineFilter === filter.value }"
            :aria-selected="activeMineFilter === filter.value"
            :disabled="busy"
            @click="setMineCalendarFilter(filter.value)"
          >
            <span>{{ filter.label }}</span>
            <small>{{ filter.count }}</small>
          </button>
        </div>

        <div v-if="filteredMineCalendarItems.length === 0" class="empty-block mine-calendar-empty">
          {{ mineCalendarEmptyText }}
        </div>

        <div v-else class="mine-day-list">
          <section v-for="group in mineDayGroups" :key="group.dateKey" class="mine-day-group">
            <div class="mine-day-marker">{{ group.markerText }}</div>
            <div class="mine-day-card">
              <div class="mine-day-head">
                <div>
                  <strong>{{ group.relativeLabel || group.dateLabel }}</strong>
                  <span>{{ group.relativeLabel ? group.dateLabel : group.weekday }} · {{ group.items.length }} 场</span>
                </div>
                <small>{{ group.relativeLabel ? group.weekday : "" }}</small>
              </div>

              <div class="mine-day-items">
                <article
                  v-for="item in group.items"
                  :key="item.key"
                  class="mine-session-row"
                  :class="{ organized: item.isOrganized, joined: item.isJoined }"
                  @click="openDetail(item.sessionId)"
                >
                  <div class="mine-session-stripe"></div>
                  <div class="mine-session-main">
                    <div class="mine-session-title-row">
                      <strong>{{ item.title }}</strong>
                      <span
                        v-for="tag in item.identityTags"
                        :key="tag.key"
                        class="mine-identity-tag"
                        :class="tag.tone"
                      >
                        {{ tag.label }}
                      </span>
                    </div>
                    <div class="mine-session-meta">{{ item.storeName }} · {{ item.timeText }}</div>
                    <div class="mine-session-status">{{ item.statusText }} · {{ item.metaText }}</div>
                  </div>

                  <div class="mini-row-actions mine-session-actions">
                    <button
                      v-if="item.primaryActionLabel !== '详情'"
                      type="button"
                      class="action-button"
                      :disabled="busy"
                      @click.stop="handleMineCalendarPrimaryAction(item)"
                    >
                      {{ item.primaryActionLabel }}
                    </button>
                    <button type="button" class="action-button" :disabled="busy" @click.stop="openDetail(item.sessionId)">详情</button>
                    <button
                      v-if="item.secondaryActionLabel"
                      type="button"
                      class="action-button"
                      :disabled="busy"
                      @click.stop="handleMineCalendarSecondaryAction(item)"
                    >
                      {{ item.secondaryActionLabel }}
                    </button>
                    <button type="button" class="action-button" :disabled="busy" @click.stop="openShare(item.sessionId)">分享</button>
                    <button
                      type="button"
                      class="action-button danger"
                      :disabled="busy"
                      @click.stop="handleMineCalendarRemoval(item)"
                    >
                      {{ item.removeActionLabel }}
                    </button>
                  </div>
                </article>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>

    <div v-else-if="screen === 'detail'" class="mini-grid two">
      <section class="table-card mini-section">
        <div class="section-head">
          <h3>{{ detailSession.script_name_snapshot || "车详情" }}</h3>
          <span>{{ sessionLifecycleLabel(detailSession) }}</span>
        </div>
        <div class="mini-body">
          <div class="detail-line">店家：{{ detailSession.store_name_snapshot || "-" }}</div>
          <div class="detail-line">时间：{{ formatDate(detailSession.start_at) }}</div>
          <div class="detail-line">DM：{{ detailSession.dm_name_snapshot || "未指定" }}</div>
          <div class="detail-line">NPC：{{ detailSession.npc_name_snapshot || "未指定" }}</div>
          <div class="detail-line" v-if="shareStats.view_count !== undefined">
            浏览 {{ shareStats.view_count || 0 }} · 申请 {{ shareStats.signup_count || 0 }}
          </div>
          <div class="mini-action-grid">
            <button v-if="isPostStartSession(detailSession)" class="primary" type="button" :disabled="busy" @click="openAlbum(detailSession.id)">
              {{ webAlbumPrimaryActionLabel(detailSession) }}
            </button>
            <button class="secondary-action" type="button" :disabled="busy" @click="copySessionLink">复制详情链接</button>
            <button v-if="!isPostStartSession(detailSession)" class="secondary-action" type="button" :disabled="busy" @click="openShare(detailSession.id)">选择角色</button>
            <button class="secondary-action" type="button" :disabled="busy" @click="copyShareLink">复制分享链接</button>
            <button class="secondary-action" type="button" :disabled="busy" @click="openManage(detailSession.id)">车头管理</button>
            <button class="secondary-action" type="button" :disabled="busy" @click="openReview(detailSession.id)">写记录</button>
            <button v-if="!isPostStartSession(detailSession)" class="secondary-action" type="button" :disabled="busy" @click="openAlbum(detailSession.id)">车局相册</button>
          </div>
        </div>
      </section>

      <section class="table-card mini-section">
        <div class="section-head">
          <h3>角色与座位</h3>
          <span>{{ detailSession.seats?.length || 0 }} 位</span>
        </div>
        <div class="mini-list">
          <div v-for="seat in detailSession.seats || []" :key="seat.id" class="mini-item">
            <strong>{{ seat.name }}</strong>
            <span>{{ seat.role_name || "角色位" }} · {{ seatTypeLabel(seat.seat_type) }}</span>
            <small>{{ seatStatusLabel(seat.status) }}</small>
            <div class="mini-row-actions">
              <button
                type="button"
                class="action-button"
                :disabled="busy || !canClaimSeat(seat)"
                @click="openShare(detailSession.id, seat.id)"
              >
                选择此位
              </button>
              <button type="button" class="action-button" :disabled="busy" @click="copySeatShareLink(seat)">
                复制此位
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="table-card mini-section span-all">
        <div class="section-head">
          <h3>车友记录</h3>
          <span>{{ sessionReviews.length }} 条</span>
        </div>
        <div class="review-list">
          <article v-for="review in sessionReviews" :key="review.id" class="review-mini-card">
            <strong>{{ review.user_nickname || review.user_open_id || "车友" }}</strong>
            <span>{{ starText(review.rating) }} · {{ review.seat_name || "座位" }}</span>
            <p v-if="review.content">{{ review.content }}</p>
            <div v-if="review.photos?.length" class="review-photo-strip">
              <img v-for="photo in review.photos" :key="photo" :src="assetUrl(photo)" alt="" />
            </div>
          </article>
          <div v-if="sessionReviews.length === 0" class="empty-block">还没有记录。</div>
        </div>
      </section>

      <section class="table-card mini-section span-all">
        <div class="section-head">
          <h3>车内聊天</h3>
          <button type="button" class="action-button" :disabled="busy" @click="loadChat">刷新</button>
        </div>
        <div class="mini-body">
          <p v-if="chatStatusText" class="warning">{{ chatStatusText }}</p>
          <div v-if="chatState.pinnedMessage" class="detail-line">
            置顶：{{ chatState.pinnedMessage.content }}
          </div>
          <div v-if="!chatState.canChat" class="empty-block">
            上车后可查看和发送车内聊天。
          </div>
          <div v-else class="mini-chat-panel">
            <div class="mini-chat-list">
              <div v-if="chatState.messages.length === 0" class="empty-block">
                还没有留言，先发一句确认信息。
              </div>
              <article
                v-for="message in chatState.messages"
                :key="message.id"
                class="mini-chat-message"
                :class="{ mine: Number(message.sender_user_id) === Number(currentUserId) }"
              >
                <div class="mini-chat-meta">
                  <strong>{{ message.sender_label || "玩家" }}</strong>
                  <span>{{ formatDate(message.created_at) }}</span>
                </div>
                <p>{{ message.content }}</p>
              </article>
            </div>
            <div class="mini-chat-compose">
              <input v-model="chatDraft" placeholder="输入留言" :disabled="busy" @keydown.enter="sendChatMessage" />
              <button class="primary" type="button" :disabled="busy || !chatDraft.trim()" @click="sendChatMessage">
                发送
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-else-if="screen === 'share'" class="mini-grid two">
      <section class="table-card mini-section">
        <div class="section-head">
          <h3>分享票</h3>
          <span>{{ shareRoleSummaryText }}</span>
        </div>
        <div class="mini-body">
          <div class="mini-ticket">
            <strong>{{ shareSessionTitle() }}</strong>
            <span>{{ shareSessionStoreName() }} · {{ formatDate(shareSession.start_at) }}</span>
            <span>{{ shareRoleOptions.length || 0 }} 人本 · {{ roleDisplayText(currentShareRole) }}</span>
          </div>
          <p v-if="shareStatusText" class="warning">{{ shareStatusText }}</p>
          <div class="mini-action-grid">
            <button class="secondary-action" type="button" :disabled="busy" @click="copyShareLink">复制分享链接</button>
            <button class="secondary-action" type="button" :disabled="busy" @click="openDetail(shareSession.id)">返回详情</button>
            <button class="secondary-action" type="button" :disabled="busy" @click="openManage(shareSession.id)">车头管理</button>
          </div>
        </div>
      </section>

      <section class="table-card mini-section">
        <div class="section-head">
          <h3>角色状态</h3>
          <span>{{ shareRoleOptions.length }} 位</span>
        </div>
        <div class="mini-body">
          <div class="role-card-grid">
            <button
              v-for="role in shareRoleCards"
              :key="role.id"
              class="role-card"
              :class="[
                role.roleGender,
                role.stateKind,
                { active: pendingShareRole && isSameRole(role, pendingShareRole) }
              ]"
              type="button"
              :disabled="busy"
              @click="chooseShareRole(role)"
            >
              <strong>
                {{ role.name }} {{ roleGenderSymbol(role.roleGender) }}
                <template v-if="role.crossCast">（反串）</template>
              </strong>
              <span>{{ role.note || "角色位" }}</span>
              <small>{{ role.stateLabel }}</small>
            </button>
          </div>
          <div class="mini-bottom-actions">
            <button class="primary" type="button" :disabled="busy || !pendingShareRole" @click="confirmShareRole">
              {{ shareConfirmButtonText }}
            </button>
          </div>
        </div>
      </section>
    </div>

    <div v-else-if="screen === 'manage'" class="mini-grid two">
      <section class="table-card mini-section">
        <div class="section-head">
          <h3>车头管理</h3>
          <button type="button" class="action-button" :disabled="busy" @click="loadManage">刷新</button>
        </div>
        <div class="mini-body">
          <div class="detail-line">车局：{{ detailSession.script_name_snapshot || "-" }}</div>
          <div class="detail-line">座位：{{ seatSummary }}</div>
          <label
            v-if="!hasOtherOnboardMembers(detailSession) && !hasActiveAlbumPhotos(detailSession)"
            class="mini-textarea-label"
          >
            <span>取消原因</span>
            <textarea v-model="cancelReason" placeholder="可选" :disabled="busy"></textarea>
          </label>
          <div v-else-if="hasOtherOnboardMembers(detailSession)" class="detail-line">
            已有玩家上车，不能取消删除；请退出车头，系统会转给下一位已上车成员。
          </div>
          <div v-else class="detail-line">
            相册已有照片，不能取消删除；请先删除所有照片，避免留下无主照片。
          </div>
          <div class="mini-action-grid">
            <button
              v-if="hasOtherOnboardMembers(detailSession)"
              class="secondary-action"
              type="button"
              :disabled="busy"
              @click="leaveOrganizer"
            >
              退出车头
            </button>
            <button
              v-if="!hasOtherOnboardMembers(detailSession) && hasActiveAlbumPhotos(detailSession)"
              class="secondary-action"
              type="button"
              :disabled="busy"
              @click="openAlbum(detailSession.id)"
            >
              打开相册
            </button>
            <button
              v-if="!hasOtherOnboardMembers(detailSession) && !hasActiveAlbumPhotos(detailSession)"
              class="secondary-action danger"
              type="button"
              :disabled="busy"
              @click="cancelCurrentSession"
            >
              取消本车
            </button>
            <button class="secondary-action" type="button" :disabled="busy" @click="openDetail(detailSession.id)">
              返回详情
            </button>
          </div>
        </div>
      </section>

      <section class="table-card mini-section">
        <div class="section-head">
          <h3>置顶信息</h3>
          <button type="button" class="action-button" :disabled="busy" @click="loadPinnedMessage">刷新</button>
        </div>
        <div class="mini-body">
          <p v-if="pinnedMessageStatus" class="warning">{{ pinnedMessageStatus }}</p>
          <label class="mini-textarea-label">
            <span>给车内成员看的置顶一句话</span>
            <textarea
              v-model="pinnedMessageDraft"
              maxlength="300"
              placeholder="集合时间、房间号或临时变更"
              :disabled="busy"
            ></textarea>
          </label>
          <div class="mini-bottom-actions">
            <button class="primary" type="button" :disabled="busy" @click="savePinnedMessage">
              {{ busy ? busyText || "保存中..." : "保存置顶" }}
            </button>
          </div>
        </div>
      </section>

      <section class="table-card mini-section">
        <div class="section-head">
          <h3>上车申请</h3>
          <span>{{ signups.length }} 条</span>
        </div>
        <div class="mini-list">
          <div v-for="signup in signups" :key="signup.id" class="mini-item">
            <strong>{{ seatName(signup.seat_id) }}</strong>
            <span>{{ signup.contact_text || "车内聊天沟通" }}</span>
            <small>{{ signupStatusLabel(signup.status) }} · 定金 {{ signup.deposit_status || "unpaid" }}</small>
            <div class="mini-row-actions">
              <button type="button" class="action-button" :disabled="busy || signup.status !== 'pending'" @click="approve(signup)">
                通过
              </button>
              <button type="button" class="action-button" :disabled="busy || signup.status !== 'pending'" @click="reject(signup)">
                拒绝
              </button>
              <button type="button" class="action-button" :disabled="busy" @click="markDeposit(signup, 'confirmed')">
                定金确认
              </button>
            </div>
          </div>
          <div v-if="signups.length === 0" class="empty-block">暂无申请。</div>
        </div>
      </section>

      <section class="table-card mini-section span-all">
        <div class="section-head">
          <h3>座位状态</h3>
          <span>{{ detailSession.seats?.length || 0 }} 位</span>
        </div>
        <div class="seat-admin-grid">
          <article v-for="seat in detailSession.seats || []" :key="seat.id" class="seat-admin-card">
            <strong>{{ seat.name }}</strong>
            <span>{{ seat.role_name || "角色位" }} · {{ seatStatusLabel(seat.status) }}</span>
            <div class="mini-row-actions">
              <button type="button" class="action-button" :disabled="busy || seat.status !== 'confirmed'" @click="lockSeat(seat)">
                锁座
              </button>
              <button type="button" class="action-button danger" :disabled="busy" @click="kickSeat(seat)">
                释放
              </button>
              <button
                type="button"
                class="action-button"
                :disabled="busy || !canTransferToSeat(seat)"
                @click="transferOrganizer(seat)"
              >
                转让车头
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>

    <div v-else-if="screen === 'review'" class="table-card mini-section">
      <div class="section-head">
        <h3>写记录</h3>
        <span>{{ reviewState.can_review ? "可保存" : "发车后已上车可写" }}</span>
      </div>
      <div class="mini-body">
        <div class="rating-row-web">
          <button
            v-for="value in [1, 2, 3, 4, 5]"
            :key="value"
            type="button"
            :class="{ active: reviewForm.rating >= value }"
            @click="reviewForm.rating = value"
          >
            ★
          </button>
        </div>
        <label class="mini-textarea-label">
          <span>文字记录</span>
          <textarea
            v-model="reviewForm.content"
            maxlength="500"
            placeholder="写一点这车的体验"
            :disabled="busy"
          ></textarea>
        </label>
        <div class="review-upload-row">
          <input ref="reviewFileInput" class="sr-only" type="file" accept="image/jpeg,image/png" multiple @change="handleReviewFiles" />
          <button class="secondary-action" type="button" :disabled="busy || reviewForm.photos.length >= 9" @click="reviewFileInput?.click()">
            添加照片
          </button>
          <span>{{ reviewForm.photos.length }}/9</span>
        </div>
        <div class="review-photo-strip editable">
          <button v-for="(photo, index) in reviewForm.photos" :key="photo" type="button" @click="removeReviewPhoto(index)">
            <img :src="assetUrl(photo)" alt="" />
            <span>移除</span>
          </button>
        </div>
        <div class="mini-bottom-actions">
          <button class="secondary-action" type="button" :disabled="busy" @click="openDetail(activeSessionId)">返回详情</button>
          <button class="primary" type="button" :disabled="busy || !reviewState.can_review" @click="saveReview">
            {{ busy ? "保存中..." : "保存记录" }}
          </button>
        </div>
      </div>
    </div>

    <SessionAlbumWorkspace v-else-if="screen === 'album'" :session-id="activeSessionId" />
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { miniScreens, sessionBackedMiniScreens, writeAdminRoute } from "../adminRoute";
import {
  approveSignup,
  cancelSession,
  claimSessionSeat,
  createSessionSeat,
  createUserSession,
  getSessionChat,
  getSession,
  getSessionShareStats,
  getMySessionReview,
  getStoredAuth,
  hideMySignup,
  kickSessionSeat,
  listActiveScripts,
  listActiveStores,
  listMySessions,
  listMySignups,
  listSessionReviews,
  listSessionSignups,
  lockSessionSeat,
  leaveSessionOrganizer,
  pinSessionChatMessage,
  publishSession,
  rejectSignup,
  saveMySessionReview,
  sendSessionMessage,
  trackShareView,
  transferSessionOrganizer,
  updateSignupDeposit,
  uploadSessionReviewPhoto
} from "../api";
import SessionAlbumWorkspace from "./SessionAlbumWorkspace.vue";

const createSteps = [
  { value: "store", label: "选店" },
  { value: "script", label: "选本" },
  { value: "role", label: "选角色" },
  { value: "setup", label: "设置" }
];
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const props = defineProps({
  initialScreen: { type: String, default: "home" },
  initialSessionId: { type: [String, Number], default: "" },
  initialSeatId: { type: [String, Number], default: "" },
  initialShareCode: { type: String, default: "" },
  initialSource: { type: String, default: "" }
});

const screen = ref(normalizeInitialMiniScreen(props.initialScreen, props.initialSessionId));
const createStep = ref("store");
const busy = ref(false);
const busyText = ref("");
const statusText = ref("");
const errorText = ref("");
const storeKeyword = ref("");
const scriptKeyword = ref("");
const stores = ref([]);
const scripts = ref([]);
const selectedStore = ref(null);
const selectedScript = ref(null);
const roleOptions = ref([]);
const selectedRole = ref(null);
const createDate = ref(defaultDate());
const createTime = ref("14:00");
const extraNpcRolesText = ref("");
const pinnedMessageText = ref("");
const mySessions = ref([]);
const mySignups = ref([]);
const activeMineFilter = ref("all");
const activeSessionId = ref(normalizedRouteValue(props.initialSessionId));
const detailSession = ref({});
const shareStats = ref({});
const sessionReviews = ref([]);
const signups = ref([]);
const cancelReason = ref("");
const reviewState = ref({ can_review: false, review: null });
const reviewForm = ref({ rating: 5, content: "", photos: [] });
const reviewFileInput = ref(null);
const focusedSeatId = ref(normalizedRouteValue(props.initialSeatId));
const inboundShareCode = ref(normalizedRouteValue(props.initialShareCode));
const inboundSource = ref(normalizedRouteValue(props.initialSource));
const shareSession = ref({});
const shareRoleOptions = ref([]);
const pendingShareRole = ref(null);
const currentShareRole = ref(null);
const confirmedCrossCastRoleKey = ref("");
const shareStatusText = ref("");
const chatState = ref({ canChat: false, pinnedMessage: null, messages: [] });
const chatDraft = ref("");
const chatStatusText = ref("");
const pinnedMessageDraft = ref("");
const pinnedMessageStatus = ref("");

const createStepLabel = computed(
  () => createSteps.find((item) => item.value === createStep.value)?.label || "创建"
);
const startAt = computed(() => `${createDate.value} ${createTime.value}:00`);
const defaultPinnedMessage = computed(() => {
  const script = selectedScript.value?.name || "剧本";
  const store = selectedStore.value?.name || "店家";
  return `置顶：${script} ${createDate.value} ${createTime.value}，${store}集合。`;
});
const canCreate = computed(() => selectedStore.value?.id && selectedScript.value?.id && selectedRole.value);
const currentUser = computed(() => getStoredAuth().user || {});
const currentUserId = computed(() => currentUser.value.id || "");
const currentUserGender = computed(() => currentUser.value.gender || "");
const seatSummary = computed(() => {
  const seats = detailSession.value.seats || [];
  const open = seats.filter((seat) => seat.status === "open").length;
  const applied = seats.filter((seat) => seat.status === "applied").length;
  const confirmed = seats.filter((seat) => ["confirmed", "locked"].includes(seat.status)).length;
  return `${seats.length}位，${open}空位，${applied}待审，${confirmed}已上车`;
});
const mineCalendarItems = computed(() =>
  mergeMineCalendarItems(mySessions.value, mySignups.value)
);
const mineCalendarOrganizedCount = computed(
  () => mineCalendarItems.value.filter((item) => item.isOrganized).length
);
const mineCalendarJoinedCount = computed(
  () => mineCalendarItems.value.filter((item) => item.isJoined).length
);
const mineCalendarPendingCount = computed(
  () => mineCalendarItems.value.filter((item) => item.isPending).length
);
const mineCalendarFilterTabs = computed(() => [
  { value: "all", label: "全部", count: mineCalendarItems.value.length },
  {
    value: "organized",
    label: "发起",
    count: mineCalendarOrganizedCount.value
  },
  {
    value: "joined",
    label: "参与",
    count: mineCalendarJoinedCount.value
  },
  {
    value: "pending",
    label: "待处理",
    count: mineCalendarPendingCount.value
  }
]);
const filteredMineCalendarItems = computed(() =>
  mineCalendarItems.value.filter((item) => mineCalendarMatchesFilter(item, activeMineFilter.value))
);
const mineDayGroups = computed(() => groupMineCalendarItems(filteredMineCalendarItems.value));
const mineCalendarEmptyText = computed(() =>
  mineCalendarItems.value.length === 0
    ? "还没有发起或选择过车局。"
    : "暂无符合条件的车局。"
);

function canEnterCreateStep(nextStep) {
  switch (nextStep) {
    case "store":
      return true;
    case "script":
      return Boolean(selectedStore.value?.id);
    case "role":
      return Boolean(selectedStore.value?.id && selectedScript.value?.id);
    case "setup":
      return Boolean(selectedRole.value && selectedStore.value?.id && selectedScript.value?.id);
    default:
      return false;
  }
}

function enterCreateStep(nextStep) {
  if (busy.value) {
    return;
  }
  if (!canEnterCreateStep(nextStep)) {
    return;
  }
  createStep.value = nextStep;
}
const shareRoleCards = computed(() =>
  shareRoleOptions.value.map((role) => {
    const mine = isMineShareRole(role);
    const pending = pendingShareRole.value && isSameRole(role, pendingShareRole.value);
    const switching = Boolean(pending && currentShareRole.value && !isSameRole(role, currentShareRole.value));
    const occupied = ["confirmed", "locked", "cancelled"].includes(role.status);
    const claimable = isShareRoleClaimable(role, mine);
    const crossCast = (pending || mine) && isCrossCast(currentUserGender.value, role.roleGender);
    let stateKind = "available";
    if (switching) {
      stateKind = "switching";
    } else if (pending || mine) {
      stateKind = "mine";
    } else if (occupied) {
      stateKind = "taken";
    } else if (role.status === "applied") {
      stateKind = "pendingReview";
    } else if (!claimable) {
      stateKind = "unavailable";
    }
    return {
      ...role,
      mine,
      pending,
      switching,
      taken: occupied,
      claimable,
      crossCast,
      stateKind,
      stateLabel: shareRoleStateLabel(stateKind)
    };
  })
);
const shareAvailableCount = computed(
  () => shareRoleCards.value.filter((role) => role.stateKind === "available").length
);
const shareMineCount = computed(
  () => shareRoleCards.value.filter((role) => role.stateKind === "mine").length
);
const shareSwitchingCount = computed(
  () => shareRoleCards.value.filter((role) => role.stateKind === "switching").length
);
const shareTakenCount = computed(
  () => shareRoleCards.value.filter((role) => role.stateKind === "taken").length
);
const shareRoleSummaryText = computed(
  () =>
    `${shareAvailableCount.value} 个可选，${shareMineCount.value} 个我选，${shareSwitchingCount.value} 个换选，${shareTakenCount.value} 个已选`
);
const shareConfirmButtonText = computed(() => {
  if (
    shareSession.value.id &&
    currentShareRole.value &&
    pendingShareRole.value &&
    !isSameRole(pendingShareRole.value, currentShareRole.value)
  ) {
    return `换选 ${pendingShareRole.value.name}`;
  }
  return pendingShareRole.value ? `确认选择 ${pendingShareRole.value.name}` : "确认选择";
});

function normalizedRouteValue(value) {
  return String(value || "").trim();
}

function normalizeInitialMiniScreen(screenValue, sessionIdValue) {
  const sessionId = normalizedRouteValue(sessionIdValue);
  const nextScreen = miniScreens.has(screenValue) ? screenValue : sessionId ? "detail" : "home";
  if (sessionBackedMiniScreens.has(nextScreen) && !sessionId) {
    return "home";
  }
  if (nextScreen === "mine") {
    return "home";
  }
  return nextScreen;
}

function defaultDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

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

function displayTags(value) {
  const tags = parseJsonArray(value);
  return tags.length ? tags.slice(0, 2).join(" / ") : "未标注";
}

function normalizeRoleGender(value) {
  const text = String(value || "unlimited").trim();
  if (["male", "男", "男位"].includes(text)) {
    return "male";
  }
  if (["female", "女", "女位"].includes(text)) {
    return "female";
  }
  return "unlimited";
}

function roleGenderSymbol(value) {
  const gender = normalizeRoleGender(value);
  if (gender === "male") {
    return "♂";
  }
  if (gender === "female") {
    return "♀";
  }
  return "";
}

function rolesFromScript(script) {
  const template = parseJsonArray(script?.default_seat_template_json);
  if (template.length > 0) {
    return template.map((item, index) => {
      const name = item.name || item.roleName || `角色${index + 1}`;
      return {
        id: `${script.id}-${index}`,
        name,
        note:
          item.description ||
          item.roleDescription ||
          item.role_description ||
          (item.roleName && item.roleName !== name ? item.roleName : ""),
        roleGender: normalizeRoleGender(item.roleGender || item.role_gender || item.gender),
        seatType: item.seatType || item.seat_type || "normal"
      };
    });
  }
  const count = Math.max(1, Number(script?.player_count || 6));
  return Array.from({ length: count }, (_, index) => ({
    id: `${script?.id || "script"}-${index}`,
    name: `角色${index + 1}`,
    note: "角色位",
    roleGender: "unlimited",
    seatType: "normal"
  }));
}

function isSameRole(left, right) {
  return String(left?.seatId || left?.id || left?.name || "") === String(right?.seatId || right?.id || right?.name || "");
}

function roleKey(role) {
  return String(role?.seatId || role?.id || role?.name || "");
}

function isCrossCast(playerGender, roleGender) {
  const player = String(playerGender || "").trim();
  const role = normalizeRoleGender(roleGender);
  return ["male", "female"].includes(player) && ["male", "female"].includes(role) && player !== role;
}

function shareRoleStateLabel(stateKind) {
  return {
    available: "可选",
    mine: "我选",
    switching: "换选",
    taken: "已选",
    pendingReview: "待审",
    unavailable: "不可选"
  }[stateKind] || "可选";
}

function shareRolesFromSession(session) {
  return (session.seats || []).map((seat) => ({
    id: String(seat.id),
    seatId: seat.id,
    name: seat.name,
    note: seat.role_name || seatTypeLabel(seat.seat_type),
    roleGender: seat.role_gender || "unlimited",
    seatType: seat.seat_type,
    status: seat.status,
    confirmedUserId: seat.confirmed_user_id || ""
  }));
}

function isMineShareRole(role) {
  return Boolean(
    currentUserId.value &&
      role.confirmedUserId &&
      Number(role.confirmedUserId) === Number(currentUserId.value)
  );
}

function isShareRoleClaimable(role, mine = false) {
  if (!shareSession.value.id || mine) {
    return true;
  }
  if (shareSession.value.status === "recruiting") {
    return !["confirmed", "locked", "cancelled"].includes(role.status);
  }
  return shareSession.value.status === "locked" && isShareSessionStarted() && role.status === "open";
}

function isShareSessionStarted() {
  const startAtValue = Date.parse(String(shareSession.value.start_at || "").replace(" ", "T"));
  return Number.isFinite(startAtValue) && startAtValue <= Date.now();
}

function roleDisplayText(role) {
  if (!role?.name) {
    return "待选";
  }
  const symbol = roleGenderSymbol(role.roleGender);
  const suffix = isCrossCast(currentUserGender.value, role.roleGender) ? "（反串）" : "";
  return `${role.name}${symbol ? ` ${symbol}` : ""}${suffix}`;
}

function shareSessionTitle() {
  return shareSession.value.script_name_snapshot || selectedScript.value?.name || "剧本待定";
}

function shareSessionStoreName() {
  return shareSession.value.store_name_snapshot || selectedStore.value?.name || "店家待定";
}

function buildSessionLink(sessionId, extra = {}) {
  const params = new URLSearchParams();
  params.set("sessionId", sessionId);
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== "") {
      params.set(key, value);
    }
  });
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

async function copyText(text, message) {
  if (busy.value) {
    return;
  }
  try {
    await navigator.clipboard?.writeText(text);
    statusText.value = message;
  } catch (error) {
    statusText.value = text;
  }
}

async function runBusyTask(message, action) {
  if (busy.value) {
    return false;
  }
  busy.value = true;
  busyText.value = message;
  errorText.value = "";
  try {
    await action();
    return true;
  } finally {
    busy.value = false;
    busyText.value = "";
  }
}

function updateMiniRoute(next = {}, options = {}) {
  writeAdminRoute(
    {
      activeView: "miniapp",
      miniScreen: next.screen || screen.value,
      sessionId: next.sessionId === undefined ? activeSessionId.value : next.sessionId,
      seatId: next.seatId === undefined ? focusedSeatId.value : next.seatId,
      shareCode: next.shareCode === undefined ? inboundShareCode.value : next.shareCode,
      source: next.source === undefined ? inboundSource.value : next.source
    },
    options
  );
}

function startCreate(options = {}) {
  if (busy.value) {
    return;
  }
  screen.value = "create";
  createStep.value = "store";
  updateMiniRoute({ screen: "create", sessionId: "", seatId: "", shareCode: "", source: "" }, options);
  loadStores();
}

function openDashboard(options = {}) {
  if (busy.value) {
    return;
  }
  screen.value = "home";
  updateMiniRoute({ screen: "home", sessionId: "", seatId: "", shareCode: "", source: "" }, options);
  loadMine();
}

async function loadStores() {
  errorText.value = "";
  try {
    stores.value = await listActiveStores({ keyword: storeKeyword.value, limit: "30" });
  } catch (error) {
    errorText.value = error.message;
  }
}

async function loadScripts() {
  errorText.value = "";
  try {
    scripts.value = await listActiveScripts({
      keyword: scriptKeyword.value,
      storeId: selectedStore.value?.id || "",
      limit: "50"
    });
  } catch (error) {
    errorText.value = error.message;
  }
}

function selectStore(store) {
  if (busy.value) {
    return;
  }
  selectedStore.value = store;
  selectedScript.value = null;
  roleOptions.value = [];
  selectedRole.value = null;
  extraNpcRolesText.value = "";
  loadScripts();
}

function selectScript(script) {
  if (busy.value) {
    return;
  }
  selectedScript.value = script;
  roleOptions.value = rolesFromScript(script);
  selectedRole.value = null;
  extraNpcRolesText.value = "";
}

function extraNpcRoles() {
  return extraNpcRolesText.value
    .split(/\r?\n|[，,]/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}

async function createPublishedSession() {
  if (busy.value || !canCreate.value) {
    return;
  }
  busy.value = true;
  busyText.value = "正在创建车局...";
  errorText.value = "";
  statusText.value = "";
  try {
    const session = await createUserSession({
      storeId: Number(selectedStore.value.id),
      scriptId: Number(selectedScript.value.id),
      startAt: startAt.value,
      depositAmount: 0,
      extraNpcRoles: extraNpcRoles(),
      note: "剧本迷·拼车，一起沉浸好本。",
      pinnedMessageText: pinnedMessageText.value.trim() || defaultPinnedMessage.value
    });
    const createdSeats = [];
    for (const role of roleOptions.value) {
      createdSeats.push(
        await createSessionSeat(session.id, {
          name: role.name,
          seatType: role.seatType || "normal",
          roleName: role.note || role.name,
          roleGender: role.roleGender || "unlimited",
          basePrice: Number(selectedScript.value.price_per_player || selectedScript.value.pricePerPlayer || 0),
          adjustment: 0
        })
      );
    }
    await publishSession(session.id);
    const selectedSeat = createdSeats.find((seat) => seat.name === selectedRole.value?.name);
    if (selectedSeat) {
      await claimSessionSeat(selectedSeat.id, { note: "网页小程序创建时选择角色" });
    }
    try {
      await pinSessionChatMessage(
        session.id,
        pinnedMessageText.value.trim() || defaultPinnedMessage.value
      );
    } catch (error) {
      statusText.value = "车局已创建，但置顶信息保存失败，可在车头管理里重试。";
    }
    if (!statusText.value) {
      statusText.value = "车局已创建。";
    }
    await openShare(session.id);
  } catch (error) {
    errorText.value = error.message;
  } finally {
    busy.value = false;
    busyText.value = "";
  }
}

async function loadMine() {
  errorText.value = "";
  try {
    const [sessions, signups] = await Promise.all([
      listMySessions({ limit: "50" }),
      listMySignups()
    ]);
    mySessions.value = sessions || [];
    mySignups.value = signups || [];
  } catch (error) {
    errorText.value = error.message;
  }
}

function setMineCalendarFilter(value) {
  if (busy.value) {
    return;
  }
  activeMineFilter.value = value;
}

function mergeMineCalendarItems(sessions = [], signups = []) {
  const itemsBySession = new Map();

  (sessions || []).forEach((session) => {
    const sessionId = String(session?.id || "");
    if (!sessionId) {
      return;
    }
    itemsBySession.set(sessionId, createMineCalendarItem({ session }));
  });

  (signups || []).forEach((signup) => {
    const sessionId = String(signup?.session_id || "");
    if (!sessionId) {
      return;
    }
    const existing = itemsBySession.get(sessionId);
    if (existing) {
      existing.signup = signup;
      refreshMineCalendarItem(existing);
      return;
    }
    itemsBySession.set(sessionId, createMineCalendarItem({ signup }));
  });

  return Array.from(itemsBySession.values())
    .map((item) => refreshMineCalendarItem(item))
    .filter((item) => item.dateKey)
    .sort((left, right) => {
      if (left.sortValue !== right.sortValue) {
        return right.sortValue - left.sortValue;
      }
      return Number(right.sessionId || 0) - Number(left.sessionId || 0);
    });
}

function createMineCalendarItem({ session = null, signup = null }) {
  return refreshMineCalendarItem({
    session,
    signup
  });
}

function refreshMineCalendarItem(item) {
  const source = item.session || item.signup || {};
  const startDate = parseMineStartAt(source.start_at);
  item.sessionId = item.session?.id || item.signup?.session_id || "";
  item.key = `mine-calendar-${item.sessionId}`;
  item.isOrganized = Boolean(item.session);
  item.isJoined = Boolean(item.signup);
  item.sessionStatus = item.session?.status || item.signup?.session_status || "";
  item.signupStatus = item.signup?.status || "";
  item.title = source.script_name_snapshot || "未命名车局";
  item.storeName = source.store_name_snapshot || "店家待定";
  item.startAt = source.start_at || "";
  item.dateKey = startDate ? mineDateKey(startDate) : "";
  item.sortValue = startDate ? startDate.getTime() : 0;
  item.timeText = startDate ? mineTimeText(startDate) : "时间待定";
  item.identityTags = mineCalendarIdentityTags(item);
  item.isPending = mineCalendarIsPending(item);
  item.canReview = Boolean(item.signup?.can_review);
  item.hasReview = Boolean(item.signup?.has_review);
  item.statusText = mineCalendarStatusText(item);
  item.metaText = mineCalendarMetaText(item);
  item.primaryActionLabel = mineCalendarPrimaryActionLabel(item);
  item.secondaryActionLabel = mineCalendarSecondaryActionLabel(item);
  item.removeActionLabel = item.isOrganized ? organizedRemovalActionText(item.session) : "下架";
  return item;
}

function mineCalendarIdentityTags(item) {
  const tags = [];
  if (item.isOrganized) {
    tags.push({ key: "organized", label: "我发起", tone: "organized" });
  }
  if (item.isJoined) {
    tags.push({
      key: "joined-role",
      label: mineSignupRoleLabel(item.signup),
      tone: "joined"
    });
  }
  return tags;
}

function mineSignupRoleLabel(signup = {}) {
  return signup.seat_role_name || signup.seat_name || "角色待定";
}

function mineCalendarIsPending(item) {
  const pendingSignupCount = Number(item.session?.pending_signup_count || 0);
  return pendingSignupCount > 0 || item.sessionStatus === "draft" || item.signupStatus === "pending";
}

function mineCalendarMatchesFilter(item, filter) {
  if (filter === "organized") {
    return item.isOrganized;
  }
  if (filter === "joined") {
    return item.isJoined;
  }
  if (filter === "pending") {
    return item.isPending;
  }
  return true;
}

function mineCalendarMetaText(item) {
  if (item.isOrganized) {
    const seatCount = Number(item.session?.seat_count || 0);
    const pendingCount = Number(item.session?.pending_signup_count || 0);
    return `${seatCount}位 · ${pendingCount}待审`;
  }
  return `已选 ${mineSignupRoleLabel(item.signup)}`;
}

function mineCalendarStatusText(item) {
  if (isMineCalendarPostStart(item)) {
    return mineCalendarPostStartText(item);
  }
  if (item.isOrganized) {
    return sessionStatusLabel(item.sessionStatus);
  }
  if (item.isJoined) {
    return signupStatusLabel(item.signupStatus);
  }
  return "-";
}

function mineCalendarPostStartText(item) {
  const source = item.session || item.signup || {};
  const visibleCount = Number(source.visible_photo_count || source.photo_count || 0);
  if (visibleCount > 0) {
    return `已发车 · ${visibleCount} 张可见`;
  }
  return "已发车 · 相册开放";
}

function mineCalendarPrimaryActionLabel(item) {
  if (isMineCalendarPostStart(item)) {
    return webAlbumPrimaryActionLabel(item.session || item.signup);
  }
  if (item.isOrganized) {
    return "管理";
  }
  if (item.canReview) {
    return item.hasReview ? "编辑记录" : "写记录";
  }
  return "详情";
}

function mineCalendarSecondaryActionLabel(item) {
  if (!item.isJoined || !item.canReview || !item.isOrganized) {
    return "";
  }
  return item.hasReview ? "编辑记录" : "写记录";
}

function isMineCalendarPostStart(item) {
  if (!isAlbumOpenForSession({ start_at: item.startAt })) {
    return false;
  }
  if (item.sessionStatus === "cancelled" || item.signupStatus === "rejected") {
    return false;
  }
  return item.isOrganized || item.signupStatus === "approved";
}

function groupMineCalendarItems(items) {
  return items.reduce((groups, item) => {
    let group = groups[groups.length - 1];
    if (!group || group.dateKey !== item.dateKey) {
      const date = parseMineStartAt(item.startAt);
      group = createMineDayGroup(date);
      groups.push(group);
    }
    group.items.push(item);
    return groups;
  }, []);
}

function createMineDayGroup(date) {
  const offset = mineDayOffset(date);
  return {
    dateKey: mineDateKey(date),
    markerText: mineDayMarkerText(date, offset),
    relativeLabel: mineRelativeDayLabel(offset),
    dateLabel: `${date.getMonth() + 1}/${date.getDate()}`,
    weekday: WEEKDAYS[date.getDay()],
    items: []
  };
}

function handleMineCalendarPrimaryAction(item) {
  if (isMineCalendarPostStart(item)) {
    openAlbum(item.sessionId);
    return;
  }
  if (item.isOrganized) {
    openManage(item.sessionId);
    return;
  }
  if (item.canReview) {
    openReview(item.sessionId);
    return;
  }
  openDetail(item.sessionId);
}

function handleMineCalendarSecondaryAction(item) {
  if (!item.secondaryActionLabel) {
    return;
  }
  openReview(item.sessionId);
}

function handleMineCalendarRemoval(item) {
  if (item.isOrganized) {
    handleOrganizedRemoval(item.session);
    return;
  }
  if (item.signup) {
    hideSignup(item.signup);
  }
}

async function openShare(sessionId = activeSessionId.value, seatId = "", options = {}) {
  if (!sessionId) {
    errorText.value = "请先选择车局。";
    return;
  }
  activeSessionId.value = sessionId;
  focusedSeatId.value = seatId || "";
  screen.value = "share";
  updateMiniRoute({ screen: "share", sessionId, seatId: seatId || "", shareCode: "", source: "" }, options);
  errorText.value = "";
  shareStatusText.value = "";
  pendingShareRole.value = null;
  confirmedCrossCastRoleKey.value = "";
  try {
    const session = await getSession(sessionId);
    shareSession.value = session || {};
    shareRoleOptions.value = shareRolesFromSession(shareSession.value);
    currentShareRole.value =
      shareRoleOptions.value.find((role) => isMineShareRole(role)) || null;
    if (seatId) {
      const focusedRole = shareRoleOptions.value.find(
        (role) => Number(role.seatId || role.id) === Number(seatId)
      );
      if (focusedRole && isShareRoleClaimable(focusedRole, isMineShareRole(focusedRole))) {
        pendingShareRole.value = focusedRole;
        shareStatusText.value = `已定位到 ${focusedRole.name}。`;
      } else if (focusedRole) {
        shareStatusText.value = `${focusedRole.name} 当前不可选择。`;
      }
    }
  } catch (error) {
    errorText.value = error.message;
  }
}

async function openDetail(sessionId, options = {}) {
  activeSessionId.value = sessionId;
  focusedSeatId.value = options.seatId || "";
  inboundShareCode.value = options.shareCode || "";
  inboundSource.value = options.source || "";
  screen.value = "detail";
  updateMiniRoute(
    {
      screen: "detail",
      sessionId,
      seatId: focusedSeatId.value,
      shareCode: inboundShareCode.value,
      source: inboundSource.value
    },
    { replace: options.replace }
  );
  await loadDetail();
  await loadChat();
  await trackInboundShareView();
}

async function loadDetail() {
  if (!activeSessionId.value) {
    return;
  }
  errorText.value = "";
  try {
    const [session, stats, reviews] = await Promise.all([
      getSession(activeSessionId.value),
      getSessionShareStats(activeSessionId.value).catch(() => ({})),
      listSessionReviews(activeSessionId.value).catch(() => [])
    ]);
    detailSession.value = session || {};
    shareStats.value = stats || {};
    sessionReviews.value = reviews || [];
  } catch (error) {
    errorText.value = error.message;
  }
}

async function trackInboundShareView() {
  if (!activeSessionId.value || (!inboundShareCode.value && !inboundSource.value && !focusedSeatId.value)) {
    return;
  }
  try {
    await trackShareView({
      sessionId: Number(activeSessionId.value),
      shareCode: inboundShareCode.value,
      source: inboundSource.value || "web_admin",
      path: window.location.pathname + window.location.search,
      seatId: focusedSeatId.value || null,
      rawPayload: {
        source: inboundSource.value,
        shareCode: inboundShareCode.value,
        seatId: focusedSeatId.value
      }
    });
    await getSessionShareStats(activeSessionId.value)
      .then((stats) => {
        shareStats.value = stats || {};
      })
      .catch(() => {});
  } catch (error) {
    // Share analytics should not block the admin replacement flow.
  }
}

async function openManage(sessionId, options = {}) {
  activeSessionId.value = sessionId;
  screen.value = "manage";
  updateMiniRoute({ screen: "manage", sessionId, seatId: "", shareCode: "", source: "" }, options);
  await loadManage();
}

async function openAlbum(sessionId = activeSessionId.value, options = {}) {
  if (!sessionId) {
    statusText.value = "请先从车详情进入相册。";
    return;
  }
  errorText.value = "";
  try {
    const session =
      Number(detailSession.value.id || 0) === Number(sessionId)
        ? detailSession.value
        : await getSession(sessionId);
    if (!isAlbumOpenForSession(session)) {
      statusText.value = "相册会在发车后开放。";
      return;
    }
    activeSessionId.value = sessionId;
    detailSession.value = session || {};
    screen.value = "album";
    updateMiniRoute({ screen: "album", sessionId, seatId: "", shareCode: "", source: "" }, options);
  } catch (error) {
    errorText.value = error.message;
  }
}

async function loadManage() {
  if (!activeSessionId.value) {
    return;
  }
  errorText.value = "";
  try {
    const [session, rows] = await Promise.all([
      getSession(activeSessionId.value),
      listSessionSignups(activeSessionId.value)
    ]);
    detailSession.value = session || {};
    signups.value = rows || [];
    await loadPinnedMessage();
  } catch (error) {
    errorText.value = error.message;
  }
}

async function chooseShareRole(role) {
  if (busy.value) {
    return;
  }
  if (role.taken && !role.mine) {
    shareStatusText.value = "这个角色已被选择。";
    return;
  }
  if (!role.claimable && !role.mine) {
    shareStatusText.value = "这个角色暂不可选择。";
    return;
  }
  if (role.taken && role.mine) {
    shareStatusText.value = "这是你当前选择的角色。";
    return;
  }
  if (pendingShareRole.value && isSameRole(role, pendingShareRole.value)) {
    await confirmShareRole();
    return;
  }
  if (isCrossCast(currentUserGender.value, role.roleGender)) {
    const confirmed = window.confirm("反串可能会影响游戏体验，是否确认？");
    if (!confirmed) {
      return;
    }
    confirmedCrossCastRoleKey.value = roleKey(role);
  }
  pendingShareRole.value = role;
  shareStatusText.value =
    shareSession.value.id && currentShareRole.value && !isSameRole(role, currentShareRole.value)
      ? `将从 ${currentShareRole.value.name} 换到 ${role.name}，确认后释放原角色。`
      : `已选择 ${role.name}，请确认。`;
}

async function confirmShareRole() {
  if (busy.value) {
    return;
  }
  if (!pendingShareRole.value) {
    shareStatusText.value = "先选择一个可选角色。";
    return;
  }
  const pendingKey = roleKey(pendingShareRole.value);
  if (
    isCrossCast(currentUserGender.value, pendingShareRole.value.roleGender) &&
    confirmedCrossCastRoleKey.value !== pendingKey
  ) {
    const confirmed = window.confirm("反串可能会影响游戏体验，是否确认？");
    if (!confirmed) {
      pendingShareRole.value = null;
      return;
    }
    confirmedCrossCastRoleKey.value = pendingKey;
  }
  busy.value = true;
  busyText.value = "正在确认角色...";
  try {
    const previousRole = currentShareRole.value;
    await claimSessionSeat(pendingShareRole.value.seatId || pendingShareRole.value.id, {
      note: "网页小程序分享页直接选择角色"
    });
    const claimedName = pendingShareRole.value.name;
    pendingShareRole.value = null;
    await openShare(shareSession.value.id);
    shareStatusText.value =
      previousRole && previousRole.name !== claimedName
        ? "角色已换选，原角色已释放。"
        : "角色已选择，可在车内聊天确认信息。";
  } catch (error) {
    if (error.status === 409) {
      shareStatusText.value = "这个角色刚刚被别人选走了，请换一个。";
    } else if (error.status === 401) {
      shareStatusText.value = "请先登录后再选择角色。";
    } else {
      shareStatusText.value = error.message || "选择失败，请稍后重试。";
    }
  } finally {
    busy.value = false;
    busyText.value = "";
  }
}

async function copyShareLink() {
  const sessionId = activeSessionId.value || shareSession.value.id;
  if (!sessionId) {
    return;
  }
  const shareCode = `web-${sessionId}-${Date.now()}`;
  await copyText(
    buildSessionLink(sessionId, { shareCode, source: "web_share" }),
    "分享链接已复制。"
  );
}

async function copySeatShareLink(seatOrRole) {
  const sessionId = activeSessionId.value || detailSession.value.id || shareSession.value.id;
  const seatId = seatOrRole?.seatId || seatOrRole?.id || "";
  if (!sessionId || !seatId) {
    return;
  }
  const shareCode = `web-${sessionId}-${seatId}-${Date.now()}`;
  await copyText(
    buildSessionLink(sessionId, { seatId, shareCode, source: "web_share" }),
    "指定座位分享链接已复制。"
  );
}

async function loadChat() {
  if (!activeSessionId.value) {
    chatState.value = { canChat: false, pinnedMessage: null, messages: [] };
    return;
  }
  chatStatusText.value = "";
  try {
    const chat = await getSessionChat(activeSessionId.value);
    chatState.value = {
      canChat: true,
      pinnedMessage: chat?.pinnedMessage || null,
      messages: chat?.messages || []
    };
    pinnedMessageDraft.value = chat?.pinnedMessage?.content || pinnedMessageDraft.value || "";
  } catch (error) {
    chatState.value = { canChat: false, pinnedMessage: null, messages: [] };
    if (screen.value === "detail") {
      chatStatusText.value =
        error.status === 403
          ? "只有车头和已上车玩家可以查看与发送聊天。"
          : "聊天加载失败，请稍后重试。";
    }
  }
}

async function sendChatMessage() {
  const content = chatDraft.value.trim();
  if (busy.value || !content || !activeSessionId.value) {
    return;
  }
  busy.value = true;
  busyText.value = "正在发送...";
  chatStatusText.value = "";
  try {
    await sendSessionMessage(activeSessionId.value, content);
    chatDraft.value = "";
    await loadChat();
  } catch (error) {
    chatStatusText.value =
      error.status === 403
        ? "只有车头和已上车玩家可以发送聊天。"
        : error.message || "发送失败，请稍后重试。";
  } finally {
    busy.value = false;
    busyText.value = "";
  }
}

async function loadPinnedMessage() {
  if (!activeSessionId.value) {
    return;
  }
  pinnedMessageStatus.value = "";
  try {
    const chat = await getSessionChat(activeSessionId.value);
    pinnedMessageDraft.value = chat?.pinnedMessage?.content || "";
  } catch (error) {
    pinnedMessageDraft.value = "";
  }
}

async function savePinnedMessage() {
  if (!activeSessionId.value || busy.value) {
    return;
  }
  busy.value = true;
  busyText.value = "正在保存置顶...";
  pinnedMessageStatus.value = "";
  try {
    await pinSessionChatMessage(activeSessionId.value, pinnedMessageDraft.value.trim());
    pinnedMessageStatus.value = "置顶信息已更新。";
    await loadChat();
  } catch (error) {
    pinnedMessageStatus.value =
      error.status === 403 ? "只有车头可以管理本车。" : error.message || "置顶保存失败。";
  } finally {
    busy.value = false;
    busyText.value = "";
  }
}

async function openReview(sessionId, options = {}) {
  activeSessionId.value = sessionId;
  screen.value = "review";
  updateMiniRoute({ screen: "review", sessionId, seatId: "", shareCode: "", source: "" }, options);
  errorText.value = "";
  try {
    const state = await getMySessionReview(sessionId);
    reviewState.value = state || { can_review: false, review: null };
    reviewForm.value = {
      rating: Number(state?.review?.rating || 5),
      content: state?.review?.content || "",
      photos: state?.review?.photos || []
    };
  } catch (error) {
    errorText.value = error.message;
  }
}

async function handleReviewFiles(event) {
  if (busy.value) {
    event.target.value = "";
    return;
  }
  const files = Array.from(event.target.files || []).slice(0, 9 - reviewForm.value.photos.length);
  event.target.value = "";
  if (files.length === 0) {
    return;
  }
  busy.value = true;
  busyText.value = "正在上传照片...";
  try {
    for (const file of files) {
      const photoUrl = await uploadSessionReviewPhoto(file);
      reviewForm.value.photos.push(photoUrl);
    }
  } catch (error) {
    errorText.value = error.message;
  } finally {
    busy.value = false;
    busyText.value = "";
  }
}

function removeReviewPhoto(index) {
  if (busy.value) {
    return;
  }
  reviewForm.value.photos.splice(index, 1);
}

async function saveReview() {
  if (busy.value || !reviewState.value.can_review) {
    return;
  }
  busy.value = true;
  busyText.value = "正在保存记录...";
  try {
    await saveMySessionReview(activeSessionId.value, {
      rating: reviewForm.value.rating,
      content: reviewForm.value.content.trim(),
      photoUrls: reviewForm.value.photos
    });
    statusText.value = "记录已保存。";
    await openDetail(activeSessionId.value);
  } catch (error) {
    errorText.value = error.message;
  } finally {
    busy.value = false;
    busyText.value = "";
  }
}

async function claimSeat(seat) {
  if (busy.value || !canClaimSeat(seat)) {
    return;
  }
  busy.value = true;
  busyText.value = "正在选择角色...";
  try {
    await claimSessionSeat(seat.id, { note: "网页小程序选择角色" });
    statusText.value = "角色已选择。";
    await loadDetail();
  } catch (error) {
    errorText.value = error.message;
  } finally {
    busy.value = false;
    busyText.value = "";
  }
}

async function approve(signup) {
  await runManageAction(() => approveSignup(signup.id), "已通过申请。");
}

async function reject(signup) {
  await runManageAction(() => rejectSignup(signup.id), "已拒绝申请。");
}

async function markDeposit(signup, depositStatus) {
  await runManageAction(() => updateSignupDeposit(signup.id, depositStatus), "定金状态已更新。");
}

async function lockSeat(seat) {
  await runManageAction(() => lockSessionSeat(seat.id), "座位已锁定。");
}

async function kickSeat(seat) {
  if (!window.confirm(`确认释放「${seat.name}」吗？`)) {
    return;
  }
  await runManageAction(() => kickSessionSeat(seat.id), "座位已释放。");
}

async function transferOrganizer(seat) {
  if (!window.confirm(`确认把车头转让给「${seat.name}」吗？`)) {
    return;
  }
  await runManageAction(
    () => transferSessionOrganizer(activeSessionId.value, seat.confirmed_user_id),
    "车头已转让。"
  );
}

async function leaveOrganizer() {
  if (!window.confirm("确认退出车头吗？系统会交给下一位已上车成员。")) {
    return;
  }
  await runManageAction(
    () => leaveSessionOrganizer(activeSessionId.value),
    "已退出车头。"
  );
  await openDetail(activeSessionId.value);
}

async function cancelCurrentSession() {
  if (hasActiveAlbumPhotos(detailSession.value)) {
    if (window.confirm("相册已有照片，不能取消删除。要先打开相册删除所有照片吗？")) {
      await openAlbum(activeSessionId.value);
    }
    return;
  }
  if (!window.confirm("确认取消本车吗？取消后这辆车会被直接删除。")) {
    return;
  }
  if (busy.value) {
    return;
  }
  busy.value = true;
  busyText.value = "正在取消车局...";
  errorText.value = "";
  try {
    await cancelSession(activeSessionId.value, cancelReason.value.trim());
    statusText.value = "本车已取消。";
    activeSessionId.value = "";
    detailSession.value = {};
    await loadMine();
    screen.value = "home";
    updateMiniRoute({ screen: "home", sessionId: "", seatId: "", shareCode: "", source: "" });
  } catch (error) {
    errorText.value = error.message;
  } finally {
    busy.value = false;
    busyText.value = "";
  }
}

function hasOtherOnboardMembers(session = {}) {
  if (Array.isArray(session.seats)) {
    return session.seats.some(
      (seat) =>
        ["confirmed", "locked"].includes(seat.status) &&
        seat.confirmed_user_id &&
        Number(seat.confirmed_user_id) !== Number(session.organizer_user_id)
    );
  }
  return Number(session.other_onboard_member_count || 0) > 0;
}

function hasActiveAlbumPhotos(session = {}) {
  return Number(session.active_album_photo_count || session.photo_count || 0) > 0;
}

async function runManageAction(action, successMessage) {
  if (busy.value) {
    return;
  }
  busy.value = true;
  busyText.value = "正在处理，请稍候...";
  errorText.value = "";
  try {
    await action();
    statusText.value = successMessage;
    await loadManage();
  } catch (error) {
    errorText.value = error.message;
  } finally {
    busy.value = false;
    busyText.value = "";
  }
}

function organizedRemovalActionText(session) {
  if (hasOtherOnboardMembers(session)) {
    return "退出";
  }
  if (hasActiveAlbumPhotos(session)) {
    return "先删照片";
  }
  return "取消";
}

async function handleOrganizedRemoval(session) {
  if (busy.value) {
    return;
  }
  if (hasOtherOnboardMembers(session)) {
    await leaveOrganizedSession(session);
    return;
  }
  if (hasActiveAlbumPhotos(session)) {
    if (window.confirm("相册已有照片，不能取消删除。要先打开相册删除所有照片吗？")) {
      await openAlbum(session.id);
    }
    return;
  }
  await cancelOrganized(session);
}

async function leaveOrganizedSession(session) {
  if (busy.value) {
    return;
  }
  if (
    !window.confirm(
      "已有玩家上车，不能取消删除。确认退出车头并转给下一位已上车成员吗？"
    )
  ) {
    return;
  }
  await runBusyTask("正在退出车头...", async () => {
    await leaveSessionOrganizer(session.id);
    statusText.value = "已退出车头。";
    await loadMine();
  }).catch((error) => {
    errorText.value = error.message;
  });
}

async function cancelOrganized(session) {
  if (busy.value) {
    return;
  }
  if (!window.confirm("确认取消这辆车吗？取消后这辆车会被直接删除。")) {
    return;
  }
  await runBusyTask("正在取消车局...", async () => {
    await cancelSession(session.id, "车头在我的发车取消");
    await loadMine();
  }).catch((error) => {
    errorText.value = error.message;
  });
}

async function hideSignup(signup) {
  if (busy.value) {
    return;
  }
  if (!window.confirm("只从你的参与列表下架，不影响车局。确认下架？")) {
    return;
  }
  await runBusyTask("正在下架参与记录...", async () => {
    await hideMySignup(signup.id);
    await loadMine();
  }).catch((error) => {
    errorText.value = error.message;
  });
}

function canClaimSeat(seat) {
  if (detailSession.value.status === "recruiting") {
    return ["open", "applied"].includes(seat.status);
  }
  return detailSession.value.status === "locked" && seat.status === "open" && isSessionStarted();
}

function isSessionStarted() {
  return isAlbumOpenForSession(detailSession.value);
}

function isPostStartSession(session, kind = "session") {
  if (kind === "signup" && session?.status !== "approved") {
    return false;
  }
  return isAlbumOpenForSession(session) && !["cancelled", "rejected"].includes(session?.status);
}

function sessionLifecycleLabel(session, kind = "session") {
  if (session?.status === "cancelled") {
    return "已取消";
  }
  if (kind === "signup" && session?.status === "rejected") {
    return "已拒绝";
  }
  if (isPostStartSession(session, kind)) {
    return "已发车 · 相册开放";
  }
  if (kind === "signup") {
    return signupStatusLabel(session?.status);
  }
  return sessionStatusLabel(session?.status);
}

function webAlbumPrimaryActionLabel(session) {
  const count = Number(session?.visible_photo_count || session?.photo_count || session?.review_count || 0);
  return count > 0 ? "回看相册" : "打开相册";
}

function isAlbumOpenForSession(session) {
  const startAtValue = Date.parse(String(session?.start_at || "").replace(" ", "T"));
  return Number.isFinite(startAtValue) && startAtValue <= Date.now();
}

function canTransferToSeat(seat) {
  return (
    seat.confirmed_user_id &&
    Number(seat.confirmed_user_id) !== Number(detailSession.value.organizer_user_id)
  );
}

function seatName(seatId) {
  return (detailSession.value.seats || []).find((seat) => Number(seat.id) === Number(seatId))?.name || `座位 ${seatId}`;
}

function storeMeta(store) {
  return [store.district || store.city, store.area || store.business_area, store.distance]
    .filter(Boolean)
    .join(" · ");
}

function parseMineStartAt(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const raw = String(value);
  const localMatch = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (localMatch) {
    return new Date(
      Number(localMatch[1]),
      Number(localMatch[2]) - 1,
      Number(localMatch[3]),
      Number(localMatch[4] || 0),
      Number(localMatch[5] || 0),
      Number(localMatch[6] || 0)
    );
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mineTodayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function mineStartOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function mineDayOffset(date, baseDate = mineTodayStart()) {
  return Math.round((mineStartOfDay(date).getTime() - mineStartOfDay(baseDate).getTime()) / DAY_MS);
}

function mineDateKey(date) {
  return `${date.getFullYear()}-${minePad(date.getMonth() + 1)}-${minePad(date.getDate())}`;
}

function mineTimeText(date) {
  return `${minePad(date.getHours())}:${minePad(date.getMinutes())}`;
}

function mineRelativeDayLabel(offset) {
  if (offset === 0) {
    return "今天";
  }
  if (offset === 1) {
    return "明天";
  }
  if (offset === -1) {
    return "昨天";
  }
  return "";
}

function mineDayMarkerText(date, offset) {
  if (offset === 0) {
    return "今";
  }
  if (offset === 1) {
    return "明";
  }
  return minePad(date.getDate());
}

function minePad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const text = String(value);
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  if (!hasTimeZone) {
    return text.replace("T", " ").slice(0, 16);
  }
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) {
    return text;
  }
  return formatShanghaiDate(date);
}

function formatShanghaiDate(date) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function sessionStatusLabel(value) {
  return {
    draft: "草稿",
    recruiting: "招募中",
    locked: "已锁车",
    cancelled: "已取消"
  }[value] || value || "-";
}

function seatStatusLabel(value) {
  return {
    open: "开放",
    applied: "待审核",
    confirmed: "已上车",
    locked: "已锁定",
    cancelled: "已取消"
  }[value] || value || "-";
}

function signupStatusLabel(value) {
  return {
    pending: "待审核",
    approved: "已通过",
    rejected: "已拒绝",
    cancelled: "已取消"
  }[value] || value || "-";
}

function seatTypeLabel(value) {
  return {
    love_companion: "情感沉浸位",
    f4: "互动位",
    cp: "CP位",
    normal: "普通位"
  }[value] || "普通位";
}

function starText(rating) {
  const value = Math.max(0, Math.min(5, Number(rating || 0)));
  return "★★★★★".slice(0, value) + "☆☆☆☆☆".slice(0, 5 - value);
}

function assetUrl(path) {
  return String(path || "");
}

async function copySessionLink() {
  await copyText(buildSessionLink(activeSessionId.value), "详情链接已复制。");
}

async function openInitialRoute() {
  const initialScreen = normalizeInitialMiniScreen(props.initialScreen, props.initialSessionId);
  const sessionId = normalizedRouteValue(props.initialSessionId);
  if (initialScreen === "create") {
    startCreate({ replace: true });
    return;
  }
  if (!sessionId) {
    openDashboard({ replace: true });
    return;
  }
  if (initialScreen === "manage") {
    await openManage(sessionId, { replace: true });
    return;
  }
  if (initialScreen === "share") {
    await openShare(sessionId, normalizedRouteValue(props.initialSeatId), { replace: true });
    return;
  }
  if (initialScreen === "review") {
    await openReview(sessionId, { replace: true });
    return;
  }
  if (initialScreen === "album") {
    await openAlbum(sessionId, { replace: true });
    return;
  }
  await openDetail(sessionId, {
    seatId: normalizedRouteValue(props.initialSeatId),
    shareCode: normalizedRouteValue(props.initialShareCode),
    source: normalizedRouteValue(props.initialSource),
    replace: true
  });
}

onMounted(() => {
  const auth = getStoredAuth();
  if (!auth.roles?.includes("system_admin")) {
    errorText.value = "当前入口仅管理员可用。";
  }
  openInitialRoute();
});
</script>
