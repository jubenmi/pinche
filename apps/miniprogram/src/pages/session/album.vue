<template>
  <view class="page album-page" :class="{ 'selection-active': selectionMode }">
    <AuthIdentityBar v-if="!timelineMode" />
    <FeedbackHost />

    <view v-if="timelineMode && albumSession" class="section public-share-head">
      <view class="public-share-owner">
        <image
          v-if="shareOwnerAvatar"
          class="public-share-avatar"
          :src="shareOwnerAvatar"
          mode="aspectFill"
        />
        <view class="public-share-owner-copy">
          <view class="public-share-owner-name">{{ shareOwnerName }} 分享了游玩相册</view>
          <view class="public-share-role">这一晚，TA 是「{{ shareSubjectLabel || "角色待定" }}」</view>
        </view>
      </view>
      <view class="public-share-script">《{{ albumScriptName || "剧本待定" }}》</view>
      <view class="public-share-meta">
        <text>{{ albumStoreName || "店家待定" }}</text>
        <text v-if="albumPlayedOn">{{ albumPlayedOn }}</text>
        <text>{{ publicShareCountText }}</text>
      </view>
      <view class="public-share-intro">{{ publicAlbumIntro }}</view>
    </view>

    <view
      v-if="operationText || (!timelineMode && hiddenCount > 0)"
      class="section album-head"
    >
      <t-notice-bar
        v-if="operationText"
        class="notice album-notice"
        theme="warning"
        :visible="true"
        :content="operationText"
      />

      <view v-if="!timelineMode && hiddenCount > 0" class="album-privacy-note">
        另有 {{ hiddenCount }} 张非本人照片或受隐私保护未展示
      </view>
    </view>

    <view
      v-if="!timelineMode && (canUpload || photos.length || taggablePhotos.length)"
      v-show="!selectionMode"
      class="album-actions-shell"
      :class="{ floating: topActionsFloating }"
    >
      <view class="album-actions album-sticky-actions" :class="{ floating: topActionsFloating }">
        <view v-if="canUpload" class="album-primary-actions">
          <t-button
            class="button album-action-primary"
            :class="{ disabled: albumBusy }"
            :custom-style="albumUploadButtonCustomStyle"
            :disabled="albumBusy"
            @tap="chooseAlbumMedia"
          >
            <view class="album-upload-button-content">
              <text class="album-upload-label">{{ albumUploadButtonLabel }}</text>
              <t-image
                class="album-upload-icon"
                src="/static/icons/upload-bold.png"
                mode="aspectFit"
              />
            </view>
          </t-button>
          <t-button
            class="button secondary album-privacy-action"
            :disabled="albumBusy"
            aria-label="相册隐私"
            @tap="goPrivacy"
          >
            <view class="album-privacy-button-content">
              <t-image
                class="album-privacy-icon"
                src="/static/icons/album-privacy.svg"
                mode="aspectFit"
              />
            </view>
          </t-button>
        </view>

        <view
          v-if="photos.length || taggablePhotos.length"
          class="album-action-groups"
        >
          <t-button
            class="album-command"
            size="extra-small"
            custom-style="height: 52rpx; min-height: 52rpx; padding: 0 10rpx; font-size: 23rpx; font-weight: 600; line-height: 52rpx;"
            :disabled="albumBusy"
            @tap="openShareSelectionMode"
          >
            <view class="album-command-content">
              <t-image
                class="album-command-icon"
                src="/static/icons/album-share.svg"
                mode="aspectFit"
              />
              <text class="album-command-label">分享</text>
            </view>
          </t-button>
          <t-button
            class="album-command"
            size="extra-small"
            custom-style="height: 52rpx; min-height: 52rpx; padding: 0 10rpx; font-size: 23rpx; font-weight: 600; line-height: 52rpx;"
            :disabled="albumBusy"
            @tap="openDownloadSelectionMode"
          >
            <view class="album-command-content">
              <t-image
                class="album-command-icon"
                src="/static/icons/album-download.svg"
                mode="aspectFit"
              />
              <text class="album-command-label">下载</text>
            </view>
          </t-button>
          <t-button
            class="album-command"
            size="extra-small"
            custom-style="height: 52rpx; min-height: 52rpx; padding: 0 10rpx; font-size: 23rpx; font-weight: 600; line-height: 52rpx;"
            :disabled="albumBusy"
            :open-type="recruitInviteToken ? 'share' : ''"
            data-album-share="recruit"
            @tap="handleRecruitShareTap"
          >
            <view class="album-command-content">
              <t-image
                class="album-command-icon"
                src="/static/icons/album-recruit.svg"
                mode="aspectFit"
              />
              <text class="album-command-label">招募</text>
            </view>
          </t-button>
          <t-button
            class="album-command album-tag-command tag-action"
            size="extra-small"
            custom-style="height: 52rpx; min-height: 52rpx; padding: 0 10rpx; border-color: #1f6f5b; background: #1f6f5b; color: #ffffff; font-size: 23rpx; font-weight: 700; line-height: 52rpx; --td-button-default-bg-color: #1f6f5b; --td-button-default-color: #ffffff; --td-button-default-border-color: #1f6f5b;"
            :disabled="albumBusy"
            @tap="openTagSelectionMode"
          >
            <view class="album-command-content">
              <t-image
                class="album-command-icon album-tag-command-icon"
                src="/static/icons/album-tag-white.svg"
                mode="aspectFit"
              />
              <text class="album-command-label">标注</text>
            </view>
          </t-button>
        </view>

        <view class="album-filter-panel album-toolbar-filter-panel">
          <t-segmented
            v-if="albumFilterSegmentOptions.length > 0"
            class="filter-row"
            block
            custom-style="width: 100%; --td-segmented-bg-color: rgba(239, 234, 224, 0.78); --td-segmented-item-active-bg: #ffffff; --td-segmented-item-color: #202124; --td-segmented-item-active-color: #0f57d0; --td-segmented-item-label-font: 700 22rpx / 42rpx PingFang SC, Microsoft YaHei, sans-serif;"
            :disabled="albumBusy"
            :value="activeFilter"
            :options="albumFilterSegmentOptions"
            @change="handleAlbumFilterChange"
          />

          <view class="role-filter-row">
            <view class="role-filter-label">角色</view>
            <view
              class="role-filter-picker"
              :class="{ disabled: albumBusy || albumRoleFilterOptions.length <= 1 }"
              @tap="openRoleFilterPicker"
            >
              {{ selectedRoleFilterLabel }}
            </view>
            <t-picker
              title="选择角色"
              :visible="roleFilterPickerVisible"
              :value="[selectedRoleFilter]"
              @confirm="handleRoleFilterChange"
              @cancel="closeRoleFilterPicker"
              @close="closeRoleFilterPicker"
            >
              <t-picker-item :options="albumRolePickerOptions" />
            </t-picker>
          </view>
        </view>
      </view>
    </view>

    <view v-if="!focusedPublicMediaUnavailable && filteredPhotos.length === 0" class="section empty-section">
      <t-empty class="empty-state" :description="`还没有你的照片。${emptyText}`" />
      <t-button
        v-if="canUpload && !timelineMode"
        class="button empty-upload-button"
        :class="{ disabled: albumBusy }"
        :custom-style="albumUploadButtonCustomStyle"
        :disabled="albumBusy"
        @tap="chooseAlbumMedia"
      >
        <view class="album-upload-button-content">
          <text class="album-upload-label">{{ albumUploadButtonLabel }}</text>
          <t-image
            class="album-upload-icon"
            src="/static/icons/upload-bold.png"
            mode="aspectFit"
          />
        </view>
      </t-button>
    </view>

    <uv-waterfall
      v-else-if="!focusedPublicMediaUnavailable"
      ref="albumWaterfall"
      v-model="waterfallPhotos"
      class="photo-waterfall"
      id-key="id"
      :add-time="20"
      :column-count="2"
      column-gap="14rpx"
      @changeList="changeWaterfallList"
    >
      <template v-slot:list1>
        <view class="waterfall-column">
          <view
            v-for="photo in waterfallList1"
            :id="photoDomId(photo)"
            :key="photo.id"
            class="photo-card waterfall-photo-card"
            :class="{
              'video-card': photo.media_type === 'video',
              selectable: selectionMode && canSelectPhoto(photo),
              selected: selectionMode && isPhotoSelected(photo),
              disabled: selectionMode && !canSelectPhoto(photo)
            }"
            @tap="togglePhotoSelection(photo)"
            >
              <view
                class="photo-image-shell"
                :class="{
                  loading: !listThumbnailLoaded(photo),
                  video: photo.media_type === 'video',
                  processing: videoProcessing(photo),
                  failed: videoFailed(photo)
                }"
                :style="photoImageStyle(photo)"
                @tap.stop="selectionMode ? togglePhotoSelection(photo) : previewPhoto(photo)"
                @longpress.stop="showPhotoInfo(photo)"
              >
              <t-image
                v-if="photo.media_type === 'image' && visiblePhotoMedia[photo.id]?.thumbnail && !listThumbnailFailed(photo)"
                class="photo-image"
                :src="visiblePhotoMedia[photo.id].thumbnail"
                mode="aspectFill"
                @load="handleListThumbnailLoad(photo)"
                @error="handleListThumbnailError(photo)"
              />
              <t-image
                v-if="photo.media_type === 'video' && visiblePhotoMedia[photo.id]?.thumbnail && !listThumbnailFailed(photo)"
                class="photo-image"
                :src="visiblePhotoMedia[photo.id].thumbnail"
                mode="aspectFill"
                @load="handleListThumbnailLoad(photo)"
                @error="handleListThumbnailError(photo)"
              />
              <view
                v-if="!listThumbnailLoaded(photo)"
                class="photo-placeholder"
                :class="{ 'video-placeholder': photo.media_type === 'video' }"
              >
                <view v-if="photo.media_type === 'video'" class="video-placeholder-copy">
                  {{ videoStateText(photo) }}
                </view>
                <view v-else-if="mediaModerationStatusText(photo)" class="moderation-placeholder-copy">
                  {{ mediaModerationStatusText(photo) }}
                </view>
                <view v-else class="photo-loading-dot"></view>
              </view>
              <view v-if="photo.media_type === 'video'" class="video-overlay">
                <view v-if="!timelineMode && videoReady(photo)" class="video-play-badge">▶</view>
                <view class="video-state-badge">
                  {{ videoReady(photo) ? formatVideoDuration(photo.duration_seconds) : videoStateText(photo) }}
                </view>
              </view>
              <view
                v-if="selectionMode"
                class="selection-checkbox"
                :class="{ selected: isPhotoSelected(photo), disabled: !canSelectPhoto(photo) }"
              >
                <view class="selection-checkbox-box">
                  {{ isPhotoSelected(photo) ? "✓" : "" }}
                </view>
              </view>
            </view>
            <view v-if="timelineMode" class="photo-meta public-photo-meta">
              <view class="photo-caption-body">
                <view class="photo-caption-title">{{ publicMediaCaption(photo) }}</view>
              </view>
            </view>
            <view v-else class="photo-meta">
              <view class="photo-caption-body">
                <view v-if="mediaModerationStatusText(photo)" class="photo-moderation-status">
                  {{ mediaModerationStatusText(photo) }}
                </view>
                <view v-else class="photo-caption-title" :class="{ pending: photo.tags.length === 0 }">
                  {{ tagSummary(photo) }}
                </view>
              </view>
              <view
                v-if="!selectionMode"
                class="photo-actions-row"
                :class="{ 'has-danger': photo.can_delete }"
              >
                <view class="photo-status-slot">
                  <t-tag class="photo-source-badge" theme="primary" variant="light" size="small">
                    <t-image
                      class="photo-source-icon"
                      :src="photoSourceIcon(photo)"
                      mode="aspectFit"
                    />
                    <text class="photo-source-label">{{ photoSourceLabel(photo) }}</text>
                  </t-tag>
                </view>
                <view class="photo-safe-actions">
                  <t-button
                    v-if="photo.can_tag"
                    class="photo-action-text primary"
                    :disabled="albumBusy"
                    @tap.stop="openTagSheet(photo)"
                  >
                    标注
                  </t-button>
                  <t-button
                    v-if="isDownloadableAlbumImage(photo)"
                    class="photo-action-text"
                    :disabled="albumBusy"
                    @tap.stop="downloadSinglePhoto(photo)"
                  >
                    下载
                  </t-button>
                </view>
                <t-button
                  v-if="photo.can_delete"
                  class="photo-action-text danger photo-danger-action"
                  :disabled="albumBusy"
                  @tap.stop="deletePhoto(photo)"
                >
                  {{ deletingPhotoId === photo.id ? "删除中" : "删除" }}
                </t-button>
              </view>
            </view>
          </view>
        </view>
      </template>
      <template v-slot:list2>
        <view class="waterfall-column">
          <view
            v-for="photo in waterfallList2"
            :id="photoDomId(photo)"
            :key="photo.id"
            class="photo-card waterfall-photo-card"
            :class="{
              'video-card': photo.media_type === 'video',
              selectable: selectionMode && canSelectPhoto(photo),
              selected: selectionMode && isPhotoSelected(photo),
              disabled: selectionMode && !canSelectPhoto(photo)
            }"
            @tap="togglePhotoSelection(photo)"
            >
              <view
                class="photo-image-shell"
                :class="{
                  loading: !listThumbnailLoaded(photo),
                  video: photo.media_type === 'video',
                  processing: videoProcessing(photo),
                  failed: videoFailed(photo)
                }"
                :style="photoImageStyle(photo)"
                @tap.stop="selectionMode ? togglePhotoSelection(photo) : previewPhoto(photo)"
                @longpress.stop="showPhotoInfo(photo)"
              >
              <t-image
                v-if="photo.media_type === 'image' && visiblePhotoMedia[photo.id]?.thumbnail && !listThumbnailFailed(photo)"
                class="photo-image"
                :src="visiblePhotoMedia[photo.id].thumbnail"
                mode="aspectFill"
                @load="handleListThumbnailLoad(photo)"
                @error="handleListThumbnailError(photo)"
              />
              <t-image
                v-if="photo.media_type === 'video' && visiblePhotoMedia[photo.id]?.thumbnail && !listThumbnailFailed(photo)"
                class="photo-image"
                :src="visiblePhotoMedia[photo.id].thumbnail"
                mode="aspectFill"
                @load="handleListThumbnailLoad(photo)"
                @error="handleListThumbnailError(photo)"
              />
              <view
                v-if="!listThumbnailLoaded(photo)"
                class="photo-placeholder"
                :class="{ 'video-placeholder': photo.media_type === 'video' }"
              >
                <view v-if="photo.media_type === 'video'" class="video-placeholder-copy">
                  {{ videoStateText(photo) }}
                </view>
                <view v-else-if="mediaModerationStatusText(photo)" class="moderation-placeholder-copy">
                  {{ mediaModerationStatusText(photo) }}
                </view>
                <view v-else class="photo-loading-dot"></view>
              </view>
              <view v-if="photo.media_type === 'video'" class="video-overlay">
                <view v-if="!timelineMode && videoReady(photo)" class="video-play-badge">▶</view>
                <view class="video-state-badge">
                  {{ videoReady(photo) ? formatVideoDuration(photo.duration_seconds) : videoStateText(photo) }}
                </view>
              </view>
              <view
                v-if="selectionMode"
                class="selection-checkbox"
                :class="{ selected: isPhotoSelected(photo), disabled: !canSelectPhoto(photo) }"
              >
                <view class="selection-checkbox-box">
                  {{ isPhotoSelected(photo) ? "✓" : "" }}
                </view>
              </view>
            </view>
            <view v-if="timelineMode" class="photo-meta public-photo-meta">
              <view class="photo-caption-body">
                <view class="photo-caption-title">{{ publicMediaCaption(photo) }}</view>
              </view>
            </view>
            <view v-else class="photo-meta">
              <view class="photo-caption-body">
                <view v-if="mediaModerationStatusText(photo)" class="photo-moderation-status">
                  {{ mediaModerationStatusText(photo) }}
                </view>
                <view v-else class="photo-caption-title" :class="{ pending: photo.tags.length === 0 }">
                  {{ tagSummary(photo) }}
                </view>
              </view>
              <view
                v-if="!selectionMode"
                class="photo-actions-row"
                :class="{ 'has-danger': photo.can_delete }"
              >
                <view class="photo-status-slot">
                  <t-tag class="photo-source-badge" theme="primary" variant="light" size="small">
                    <t-image
                      class="photo-source-icon"
                      :src="photoSourceIcon(photo)"
                      mode="aspectFit"
                    />
                    <text class="photo-source-label">{{ photoSourceLabel(photo) }}</text>
                  </t-tag>
                </view>
                <view class="photo-safe-actions">
                  <t-button
                    v-if="photo.can_tag"
                    class="photo-action-text primary"
                    :disabled="albumBusy"
                    @tap.stop="openTagSheet(photo)"
                  >
                    标注
                  </t-button>
                  <t-button
                    v-if="isDownloadableAlbumImage(photo)"
                    class="photo-action-text"
                    :disabled="albumBusy"
                    @tap.stop="downloadSinglePhoto(photo)"
                  >
                    下载
                  </t-button>
                </view>
                <t-button
                  v-if="photo.can_delete"
                  class="photo-action-text danger photo-danger-action"
                  :disabled="albumBusy"
                  @tap.stop="deletePhoto(photo)"
                >
                  {{ deletingPhotoId === photo.id ? "删除中" : "删除" }}
                </t-button>
              </view>
            </view>
          </view>
        </view>
      </template>
    </uv-waterfall>

    <view v-if="timelineMode && publicShareLoadingMore" class="public-share-page-status">
      正在加载更多照片…
    </view>
    <view v-else-if="timelineMode && publicShareLoadMoreError" class="public-share-page-status error">
      <text>{{ publicShareLoadMoreError }}</text>
      <t-button size="small" variant="text" @tap="loadMorePublicAlbum">重试</t-button>
    </view>

    <root-portal :enable="!timelineMode && selectionMode && !tagSheetPhoto">
      <view v-if="!timelineMode && selectionMode && !tagSheetPhoto" class="album-floating-toolbar">
        <view class="album-toolbar-state">
          <view class="bulk-count">已选 {{ selectedPhotoCount }} 项</view>
          <view
            class="floating-toolbar-cancel"
            :class="{ disabled: albumBusy }"
            @tap="cancelSelectionMode"
          >
            取消
          </view>
        </view>
        <view v-if="selectionModePurpose === 'share'" class="album-toolbar-business">
          <t-button
            class="floating-toolbar-button secondary"
            :disabled="albumBusy"
            @tap="shareAllAlbumMedia"
          >
            分享全部（{{ shareSelectableMedia.length }}）
          </t-button>
          <t-button
            class="floating-toolbar-button primary"
            :disabled="albumBusy || selectedPhotoCount === 0"
            @tap="shareSelectedAlbumMedia"
          >
            分享选中（{{ selectedPhotoCount }}）
          </t-button>
        </view>
        <view v-else-if="selectionModePurpose === 'download'" class="album-toolbar-business">
          <t-button
            class="floating-toolbar-button secondary"
            :disabled="albumBusy"
            @tap="downloadAllPhotos"
          >
            下载全部（{{ downloadablePhotos.length }}）
          </t-button>
          <t-button
            class="floating-toolbar-button primary"
            :disabled="albumBusy || selectedPhotoCount === 0"
            @tap="downloadSelectedPhotos"
          >
            下载选中（{{ selectedPhotoCount }}）
          </t-button>
        </view>
        <view v-else class="album-toolbar-business">
          <t-button
            class="floating-toolbar-button primary"
            :disabled="albumBusy || selectedTagTargetCount === 0"
            @tap="openBulkTagSheet"
          >
            批量标注
          </t-button>
        </view>
      </view>
    </root-portal>

    <view v-if="!timelineMode && albumShareReadyVisible" class="album-share-ready-layer">
      <view class="album-share-ready-title">分享已准备好</view>
      <view class="album-share-ready-count">已准备分享 {{ activeAlbumShareCount }} 项</view>
      <button
        class="album-share-ready-button"
        open-type="share"
        data-album-share="active"
      >
        发送给好友或群聊
      </button>
      <view class="album-share-ready-hint">朋友圈请使用右上角“…”分享</view>
      <view class="album-share-ready-close" @tap="closeAlbumShareReady">关闭</view>
    </view>

    <AlbumImageViewer
      :visible="previewOverlayVisible"
      :photos="previewPhotos"
      :initial-index="previewInitialIndex"
      :allow-download="previewAllowsDownload"
      :share-status="previewShareStatus"
      :show-counter="!focusedPublicMode"
      :primary-action-label="focusedPublicMode ? '查看完整相册' : ''"
      :media-progress="previewMediaProgress"
      @close="closePhotoPreview"
      @change="handlePreviewChange"
      @video-error="handlePreviewVideoError"
      @need-video="handlePreviewVideoRequest"
      @download="handlePreviewDownload"
      @share-status-tap="handleSingleMediaShareStatusTap"
      @primary-action="showFullPublicAlbum"
    />

    <view
      v-if="previewShowsOwnedUntaggedShareNote"
      class="preview-untagged-share-note"
    >
      未标注，仅在你主动分享后公开
    </view>

    <view
      v-if="focusedPublicMediaUnavailable && publicAlbumSnapshotLoaded"
      class="section focused-public-unavailable"
    >
      <t-empty description="该内容已不可查看" />
      <t-button class="button" @tap="showFullPublicAlbum">查看完整相册</t-button>
    </view>

    <t-popup
      :visible="tagSheetVisible"
      placement="bottom"
      :close-on-overlay-click="true"
      @visible-change="handleTagSheetPopupVisibleChange"
    >
      <view class="tag-sheet" @tap.stop>
        <view class="sheet-bar"></view>
        <view class="sheet-title">
          <text v-if="bulkTagging">给 {{ selectedTagTargetCount }} 张照片标注</text>
          <text v-else>这张照片里有谁</text>
        </view>
        <view class="sheet-note">
          {{
            bulkTagging
              ? "保存后，这些照片会替换成同一组标签。"
              : "标注后只会展示给上传者和对应被标注成员。"
          }}
        </view>

        <view class="selected-row">
          <t-tag
            v-for="person in selectedPeople"
            :key="person.key"
            class="selected-chip"
            theme="primary"
            variant="light"
            size="small"
            @tap="togglePerson(person.key)"
          >
            <text>{{ tagPersonTitle(person) }}</text>
            <text
              v-if="person.tag_type === 'session_npc_role'"
              class="npc-gender-mark"
              :class="npcRoleGenderClass(person.role_gender)"
            >
              {{ npcRoleGenderText(person.role_gender) }}
            </text>
            <text>×</text>
          </t-tag>
          <t-empty
            v-if="selectedPeople.length === 0"
            class="selected-empty"
            description="暂未标注，只有上传者可见"
          />
        </view>

        <RoleSeatBoard
          :surface="false"
          :sections="albumTagSections"
          empty-text="暂无可标注角色。"
          @itemtap="handleAlbumTagTap"
        />

        <view class="privacy-impact">
          未标注只有上传者可见；标注角色后只展示给上传者和对应被标注成员。
        </view>

        <view class="sheet-actions">
          <t-button class="button secondary" :disabled="savingTags" @tap="closeTagSheet">取消</t-button>
          <t-button
            class="button"
            :class="{ disabled: savingTags }"
            :disabled="savingTags"
            @tap="saveTags"
          >
            {{ savingTags ? "保存中..." : "保存标注" }}
          </t-button>
        </view>
      </view>
    </t-popup>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import RoleSeatBoard from "../../components/RoleSeatBoard.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import AlbumImageViewer from "../../components/AlbumImageViewer.vue";
import {
  AUTH_CHANGE_EVENT,
  apiUrl,
  dataOf,
  ensureLoggedIn,
  getCurrentUser,
  getApiBaseUrl,
  getToken,
  queryString,
  request,
  createSessionAlbumVideo,
  uploadSessionAlbumVideo,
  reportAlbumMediaEvent
} from "../../utils/api";
import {
  albumMediaError,
  formatBeijingDateTime,
  isApprovedAlbumImageDownloadCandidate,
  isModerationPublished
} from "@pinche/shared";
import { uploadAlbumPhoto } from "../../utils/albumPhotoUpload";
import {
  clearAlbumMediaRequestIfCurrent,
  createAlbumListRequestAuthority,
  createAlbumMediaRefreshController,
  createAlbumWaterfallRenderAuthority,
  findCurrentAlbumMediaRow,
  isAuthorPrivateAlbumMedia as isAuthorPrivateAlbumMediaRow,
  isCurrentPreviewableAlbumMedia as isCurrentPreviewableAlbumMediaRow,
  isCurrentPublishedAlbumMedia as isCurrentPublishedAlbumMediaRow,
  normalizeAuthorPrivateAlbumImageUrls,
  normalizeAlbumImageUrls,
  pruneAlbumMediaPreviewCache
} from "../../utils/albumMediaUrls";
import {
  canOpenAlbumMediaPreview,
  canReuseVideoUrl,
  compressVideoSizeBytes,
  isUsableRequiredVideoCompression,
  shouldAttachApiAuthorization,
  transitionAlbumVideoViewerFailure,
  videoUrlExpiresAt
} from "../../utils/albumVideo";
import { classifyAlbumMediaSelection } from "../../utils/albumMediaSelection";
import { runExclusiveAlbumMediaTask } from "../../utils/albumMediaOperation";
import {
  authorPrivateContentModerationStatusText,
  contentModerationErrorText,
  contentModerationStatusText
} from "../../utils/contentModeration";
import { normalizeRoleGender, roleGenderSymbol } from "../../utils/createFlow";
import {
  albumShareFriendPayload,
  albumShareLocalImagePath,
  albumShareMenus,
  albumShareTimelinePayload,
  selectAlbumShareTimelineImage
} from "../../utils/albumShareCover";
import {
  ALBUM_SHARE_INTENT,
  albumShareAppMessageIntent,
  memberDefaultAlbumShareMediaFingerprint,
  memberDefaultAlbumShareState,
  recruitmentSharePayload,
  createAlbumShareEntryAuthority
} from "../../utils/albumShareEntry";
import { showWechatShareMenus } from "../../utils/share";
import { showModal, showToast } from "../../utils/tdesignFeedback";
import {
  createFocusedPublicVideoRequestContext,
  createSingleMediaShareAuthority,
  focusedPublicSnapshotProjection,
  isFocusedPublicVideoRequestCurrent,
  normalizeFocusedMediaId,
  publicAlbumMediaCaption,
  singleMediaShareCardImage,
  singleMediaShareFailClosedPayload,
  singleMediaShareRouteState,
  singleMediaSharePath
} from "../../utils/albumSingleMediaShare";
import {
  mergePublicAlbumSharePages,
  publicAlbumSharePageUrl
} from "../../utils/albumPublicSharePagination";

function albumMediaCachePath(photoId, variant = "preview") {
  const root =
    (typeof wx !== "undefined" && wx.env?.USER_DATA_PATH) ||
    (typeof uni !== "undefined" && uni.env?.USER_DATA_PATH) ||
    "";
  return root ? `${root}/session-album-${photoId}-${variant}.jpg` : "";
}

// Admin album video upload remains scoped to system_admin. The 60-second value
// controls only WeChat camera recording; selected album videos have no duration cap.
const MAX_ALBUM_PHOTO_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALBUM_PHOTO_COMPRESS_QUALITY = 85;
const ALBUM_PHOTO_COMPRESS_WIDTH = 2048;
const ALBUM_PHOTO_COMPRESS_HEIGHT = 2048;
const MAX_ALBUM_VIDEO_RECORDING_DURATION_SECONDS = 60;
const VIDEO_COMPRESSION_SUSPICIOUS_MIN_ORIGINAL_BYTES = 20 * 1024 * 1024;

export default {
  components: { AuthIdentityBar, RoleSeatBoard, FeedbackHost, AlbumImageViewer },
  data() {
    return {
      sessionId: "",
      timelineMode: false,
      albumShareToken: "",
      defaultAlbumShareToken: "",
      defaultAlbumShareTimelineCoverUrl: "",
      defaultAlbumShareTimelineCoverPrepared: false,
      defaultAlbumShareSubject: null,
      defaultAlbumShareCounts: { total: 0, photos: 0, videos: 0 },
      defaultAlbumShareGeneration: 0,
      defaultAlbumSharePromise: null,
      defaultAlbumShareKey: "",
      defaultAlbumShareAuthority: createAlbumShareEntryAuthority(),
      activeAlbumShareToken: "",
      activeAlbumShareScope: "",
      activeAlbumShareCount: 0,
      activeAlbumShareTimelineCoverUrl: "",
      activeAlbumShareTimelineCoverPrepared: false,
      activeAlbumShareSubject: null,
      activeAlbumShareOwner: null,
      activeAlbumShareCounts: { total: 0, photos: 0, videos: 0 },
      albumShareRequestVersion: 0,
      albumSharePreparing: false,
      albumShareReadyVisible: false,
      recruitInviteToken: "",
      recruitInviteGeneration: 0,
      recruitInvitePromise: null,
      recruitInviteAuthority: createAlbumShareEntryAuthority(),
      singleMediaShareRequested: false,
      focusedPublicMode: false,
      focusedPublicMediaUnavailable: false,
      focusMediaId: null,
      publicAlbumSnapshotLoaded: false,
      publicShareNextCursor: null,
      publicShareHasMore: false,
      publicShareLoadingMore: false,
      publicShareLoadMoreError: "",
      shareSubject: null,
      shareOwner: null,
      shareTimelineCoverUrl: "",
      shareTimelineCoverPrepared: false,
      shareCounts: { total: 0, photos: 0, videos: 0 },
      albumSession: null,
      photos: [],
      people: [],
      hiddenCount: 0,
      canUpload: false,
      activeFilter: "all",
      selectedRoleFilter: "",
      roleFilterPickerVisible: false,
      statusText: "",
      loadingAlbum: false,
      skipNextAlbumRefreshOnShow: false,
      albumScrollTop: 0,
      topActionsFloating: false,
      uploading: false,
      downloading: false,
      downloadProgressText: "",
      savingTags: false,
      deletingPhotoId: null,
      currentUserId: "",
      currentRoles: [],
      mediaLoadSerial: 0,
      waterfallPhotos: [],
      waterfallList1: [],
      waterfallList2: [],
      visiblePhotoMedia: {},
      mediaProgressById: {},
      listThumbnailLoadedById: {},
      listThumbnailFailedById: {},
      photoObservers: [],
      tagSheetPhoto: null,
      selectedTagKeys: [],
      selectionMode: false,
      selectionModePurpose: "tag",
      selectedPhotoIds: [],
      bulkTagging: false,
      previewOverlayVisible: false,
      previewPhotos: [],
      previewCurrentIndex: 0,
      previewInitialIndex: 0,
      singleMediaShareAuthority: createSingleMediaShareAuthority(),
      singleMediaShareStateVersion: 0,
      previewMediaUrlRefreshRequest: null,
      albumMediaRefresh: null,
      albumListRequestAuthority: createAlbumListRequestAuthority(),
      albumWaterfallRenderAuthority: createAlbumWaterfallRenderAuthority(),
      mediaRefreshAttempts: {},
      previewVideoUrlRequests: {},
      filters: [
        { value: "all", label: "全部" },
        { value: "mine", label: "上传" },
        { value: "withMe", label: "我的" },
        { value: "untagged", label: "待标" }
      ]
    };
  },
  computed: {
    tagSheetVisible() {
      return !this.timelineMode && Boolean(this.tagSheetPhoto);
    },
    isSystemAdmin() {
      return this.currentRoles.includes("system_admin");
    },
    canUploadVideo() {
      return !this.timelineMode && this.canUpload && this.isSystemAdmin;
    },
    downloadablePhotos() {
      return this.photos.filter((photo) =>
        isApprovedAlbumImageDownloadCandidate(photo, this.mediaUrlForPhoto(photo, "download"))
      );
    },
    filteredDownloadablePhotos() {
      return this.filteredPhotos.filter((photo) =>
        isApprovedAlbumImageDownloadCandidate(photo, this.mediaUrlForPhoto(photo, "download"))
      );
    },
    shareSelectableMedia() {
      return this.photos.filter(
        (photo) =>
          this.isCurrentPublishedAlbumMedia(photo) &&
          (this.isImageMedia(photo) || this.videoReady(photo))
      );
    },
    previewCurrentPhoto() {
      return this.previewPhotos[this.previewCurrentIndex] || null;
    },
    previewAllowsDownload() {
      return !this.timelineMode && this.isDownloadableAlbumImage(this.previewCurrentPhoto);
    },
    previewShareStatus() {
      this.singleMediaShareStateVersion;
      if (this.timelineMode || !this.previewOverlayVisible) {
        return "hidden";
      }
      return this.singleMediaShareAuthority.currentEntry(this.previewCurrentPhoto?.id)?.status || "hidden";
    },
    previewShowsOwnedUntaggedShareNote() {
      const photo = this.previewCurrentPhoto;
      return Boolean(
        !this.timelineMode &&
        this.previewOverlayVisible &&
        photo?.media_type === "image" &&
        photo?.is_mine &&
        Array.isArray(photo?.tags) &&
        photo.tags.length === 0
      );
    },
    previewMediaProgress() {
      const result = {};
      if (!this.previewPhotos.length) {
        return result;
      }
      const parsedIndex = Number(this.previewCurrentIndex);
      const currentIndex = Number.isFinite(parsedIndex)
        ? Math.min(
            Math.max(0, Math.trunc(parsedIndex)),
            this.previewPhotos.length - 1
          )
        : 0;
      const start = Math.max(0, currentIndex - 2);
      const end = Math.min(this.previewPhotos.length, currentIndex + 3);

      for (let index = start; index < end; index += 1) {
        const photo = this.previewPhotos[index];
        if (!photo || photo.id === undefined || photo.id === null) {
          continue;
        }
        for (const variant of ["thumbnail", "preview"]) {
          const key = this.albumMediaProgressKey(photo.id, variant);
          const entry = this.mediaProgressById[key];
          if (entry) {
            result[key] = entry;
          }
        }
      }
      return result;
    },
    albumTitle() {
      if (this.timelineMode) {
        return this.shareSubjectLabel ? `${this.shareSubjectLabel}的相册` : "分享相册";
      }
      return this.albumDisplayTitle || "相册";
    },
    albumDisplayTitle() {
      if (!this.currentAlbumRoleName || !this.albumScriptName) {
        return "";
      }
      return `[${this.currentAlbumRoleName}·${this.albumScriptName}] 相册`;
    },
    albumUploadButtonLabel() {
      const roleName = this.currentAlbumRoleName;
      const scriptName = this.albumScriptName;
      if (!roleName || !scriptName) {
        return "载入中";
      }
      return `[${roleName}·${scriptName}]`;
    },
    albumUploadButtonCustomStyle() {
      return [
        "height: 78rpx",
        "min-height: 78rpx",
        "border: 0",
        "background: #1f6f5b",
        "color: #ffffff",
        "--td-button-default-bg-color: #1f6f5b",
        "--td-button-default-color: #ffffff",
        "--td-button-default-border-color: #1f6f5b",
        "--td-button-primary-bg-color: #1f6f5b",
        "--td-button-primary-color: #ffffff"
      ].join("; ");
    },
    albumScriptName() {
      return String(this.albumSession?.script_name_snapshot || "").trim();
    },
    albumStoreName() {
      return String(this.albumSession?.store_name_snapshot || "").trim();
    },
    albumPlayedOn() {
      return String(this.albumSession?.played_on || "").trim();
    },
    shareOwnerName() {
      return String(this.shareOwner?.nickname || "车友").trim() || "车友";
    },
    shareOwnerAvatar() {
      return this.normalizeAlbumMediaUrl(this.shareOwner?.avatar_url || "");
    },
    publicShareCountText() {
      const photoCount = Number(this.shareCounts.photos || 0);
      const videoCount = Number(this.shareCounts.videos || 0);
      if (videoCount > 0) return `${photoCount} 张照片 · ${videoCount} 段视频`;
      return `${photoCount || Number(this.shareCounts.total || 0)} 张照片`;
    },
    currentAlbumRoleName() {
      const userId = Number(this.currentUserId || 0);
      if (!userId) {
        return "";
      }
      const matchingPeople = this.people.filter(
        (person) => Number(person?.user_id || 0) === userId
      );
      const person =
        matchingPeople.find(
          (item) => item.tag_type === "seat" && Number(item.seat_id || 0) > 0
        ) ||
        matchingPeople.find((item) => item.tag_type === "session_npc_role") ||
        matchingPeople.find((item) => ["dm", "npc"].includes(item.tag_type)) ||
        matchingPeople[0];
      return person ? this.tagPersonTitle(person) : this.albumRoleNameFromMineTags();
    },
    albumIntro() {
      if (this.timelineMode) {
        return "公开只读展示，不包含车内完整相册和上车入口。";
      }
      return "仅展示你上传或标注了你角色的照片；其他车友照片不会展示。";
    },
    publicAlbumIntro() {
      return this.albumIntro;
    },
    shareSubjectLabel() {
      return (
        this.shareSubject?.role_name ||
        this.shareSubject?.seat_name ||
        this.shareSubject?.label ||
        ""
      );
    },
    activeAlbumShareSubjectLabel() {
      return (
        this.activeAlbumShareSubject?.role_name ||
        this.activeAlbumShareSubject?.seat_name ||
        this.activeAlbumShareSubject?.label ||
        ""
      );
    },
    emptyText() {
      if (this.timelineMode) {
        return "当前没有可展示的分享照片。";
      }
      return this.canUpload
        ? "这场车还没有与你相关的照片。你可以上传照片，标注后只展示给对应的人。"
        : "当前没有与你相关或满足隐私条件的照片。";
    },
    filteredPhotos() {
      if (this.timelineMode) {
        return this.photos;
      }
      return this.photosForAlbumFilter(this.activeFilter);
    },
    filteredUntaggedPhotoCount() {
      return this.filteredPhotos.filter((photo) => photo.tags.length === 0).length;
    },
    filteredTaggedPhotoCount() {
      return this.filteredPhotos.length - this.filteredUntaggedPhotoCount;
    },
    filteredTagProgressPercent() {
      if (this.filteredPhotos.length === 0) {
        return 0;
      }
      return Math.round((this.filteredTaggedPhotoCount / this.filteredPhotos.length) * 100);
    },
    albumFilterOptions() {
      return this.filters.map((filter) => ({
        ...filter,
        count: this.countAlbumPhotosForFilter(filter.value)
      }));
    },
    albumFilterSegmentOptions() {
      return this.albumFilterOptions.map((filter) => ({
        value: filter.value,
        label: `${filter.label} ${filter.count}`,
        disabled: filter.count === 0
      }));
    },
    albumRoleFilterOptions() {
      if (this.timelineMode) {
        return [];
      }
      const activeFilterCount = this.photosForAlbumFilter(this.activeFilter, { includeRole: false }).length;
      return [
        { value: "", label: `全部角色 ${activeFilterCount}` },
        ...this.people.map((person) => ({
          value: person.key,
          label: `${this.roleFilterOptionLabel(person)} ${this.countPhotosForRole(person.key)}`
        }))
      ];
    },
    albumRoleFilterLabels() {
      return this.albumRoleFilterOptions.map((option) => option.label);
    },
    albumRolePickerOptions() {
      return this.albumRoleFilterOptions.map((option) => ({
        value: option.value,
        label: option.label
      }));
    },
    selectedRoleFilterIndex() {
      const index = this.albumRoleFilterOptions.findIndex(
        (option) => option.value === this.selectedRoleFilter
      );
      return index >= 0 ? index : 0;
    },
    selectedRoleFilterLabel() {
      return this.albumRoleFilterOptions[this.selectedRoleFilterIndex]?.label || "全部角色 0";
    },
    taggablePhotos() {
      return this.filteredPhotos.filter((photo) => photo.can_tag);
    },
    selectedTaggablePhotoIds() {
      return this.selectedPhotoIds.filter((photoId) =>
        this.taggablePhotos.some((photo) => Number(photo.id) === Number(photoId))
      );
    },
    seatPeople() {
      return this.people.filter((person) => person.tag_type === "seat");
    },
    npcPeople() {
      return this.people.filter((person) => ["dm", "npc"].includes(person.tag_type));
    },
    npcRolePeople() {
      return this.people.filter((person) => person.tag_type === "session_npc_role");
    },
    otherPeople() {
      return this.people.filter((person) => person.tag_type === "other");
    },
    albumTagSections() {
      return [
        this.albumTagSection("seat", "车友", this.seatPeople),
        this.albumTagSection("staff", "DM / NPC工作人员", this.npcPeople),
        this.albumTagSection("npcRole", "NPC角色", this.npcRolePeople),
        this.albumTagSection("other", "其他", this.otherPeople)
      ].filter((section) => section.items.length);
    },
    selectedPeople() {
      return this.people.filter((person) => this.selectedTagKeys.includes(person.key));
    },
    selectedPhotoCount() {
      return this.selectedPhotoIds.length;
    },
    selectedTagTargetCount() {
      if (this.bulkTagging || (this.selectionMode && this.selectionModePurpose === "tag")) {
        return this.selectedTaggablePhotoIds.length;
      }
      return this.tagSheetPhoto ? 1 : 0;
    },
    albumBusy() {
      return (
        this.loadingAlbum ||
        this.uploading ||
        this.downloading ||
        this.preparingSharePreview ||
        this.savingShareSelection ||
        this.savingTags ||
        this.albumSharePreparing ||
        Boolean(this.deletingPhotoId)
      );
    },
    operationText() {
      if (this.loadingAlbum) {
        return "正在加载相册...";
      }
      if (this.uploading) {
        return this.statusText || "正在上传照片...";
      }
      if (this.downloading) {
        return this.downloadProgressText || "正在保存照片...";
      }
      if (this.savingTags) {
        return "正在保存标注...";
      }
      if (this.albumSharePreparing) {
        return "正在准备分享...";
      }
      if (this.deletingPhotoId) {
        return "正在删除照片...";
      }
      if (this.albumBusy) {
        return "正在处理，请稍候...";
      }
      return this.statusText;
    }
  },
  async onLoad(options) {
    this.visiblePhotoMediaRequests = {};
    this.sessionId = options.id || "";
    const routeState = singleMediaShareRouteState(options);
    this.singleMediaShareRequested = routeState.singleMediaShareRequested;
    this.focusMediaId = routeState.focusMediaId;
    this.timelineMode = routeState.timelineMode;
    this.albumShareToken = routeState.token;
    this.focusedPublicMode = routeState.focusedPublicMode;
    this.focusedPublicMediaUnavailable = routeState.focusedPublicMediaUnavailable;
    this.publicAlbumSnapshotLoaded = false;
    this.initializeAlbumMediaRefreshController();
    this.showShareMenus();
    this.applyAlbumNavigationTitle();
    if (this.timelineMode) {
      this.cancelSelectionMode({ force: true });
      this.clearActiveAlbumShareState({ hideMenus: true });
      await this.loadPublicAlbum();
      return;
    }
    this.observeAlbumAuthChanges();
    const auth = await ensureLoggedIn({
      content: "登录后可以查看车局相册。"
    });
    if (!auth?.user) {
      this.statusText = "登录后可继续查看相册。";
      return;
    }
    this.currentUserId = auth.user.id || "";
    this.currentRoles = auth.roles || [];
    await this.loadAlbum();
  },
  async onShow() {
    if (this.timelineMode) {
      if (this.loadingAlbum) {
        return;
      }
      if (this.consumePreviewReturnRefreshSkip()) {
        return;
      }
      if (this.sessionId && this.albumShareToken) {
        await this.albumMediaRefresh?.refresh();
      }
      return;
    }
    const auth = getCurrentUser();
    const accountChanged = this.handleAlbumAuthChange(auth);
    if (this.sessionId && this.currentUserId && (!this.defaultAlbumShareToken || !this.recruitInviteToken)) {
      this.primeAlbumShareEntries();
    }
    const skipRefresh = this.consumePreviewReturnRefreshSkip();
    if (skipRefresh && !accountChanged) {
      return;
    }
    if (this.sessionId && this.currentUserId) {
      await this.albumMediaRefresh?.refresh();
    }
  },
  onHide() {
    if (!this.timelineMode) {
      this.invalidateDefaultAlbumShare();
      this.invalidateRecruitInviteShare();
    }
    this.cancelSelectionMode({ force: true });
    this.clearActiveAlbumShareState({ hideMenus: true });
    this.resetAlbumShareCovers();
    this.clearAuthorPrivateAlbumState();
  },
  onUnload() {
    if (!this.timelineMode) {
      this.invalidateDefaultAlbumShare();
      this.invalidateRecruitInviteShare();
    }
    this.resetSingleMediaShareState();
    this.cancelSelectionMode({ force: true });
    this.clearActiveAlbumShareState({ hideMenus: true });
    this.resetAlbumShareCovers();
    if (!this.timelineMode) {
      this.invalidateAlbumShareState();
    }
    this.clearAuthorPrivateAlbumState();
    this.unobserveAlbumAuthChanges();
    this.albumMediaRefresh?.dispose();
    this.disconnectPhotoObservers();
  },
  onPageScroll(event) {
    this.albumScrollTop = Number(event?.scrollTop || 0);
    this.updateTopActionsFloating();
  },
  onReachBottom() {
    if (this.timelineMode) {
      this.loadMorePublicAlbum();
    }
  },
  onShareAppMessage(options) {
    const intent = albumShareAppMessageIntent(options, {
      timelineMode: this.timelineMode
    });
    if (intent.kind === ALBUM_SHARE_INTENT.RECRUIT) {
      return (
        recruitmentSharePayload({
          sessionId: this.sessionId,
          inviteToken: this.recruitInviteToken,
          title: this.albumShareSessionTitle()
        }) || singleMediaShareFailClosedPayload()
      );
    }
    if (intent.kind === ALBUM_SHARE_INTENT.ACTIVE) {
      return this.activeAlbumSharePayload();
    }
    if (intent.kind === ALBUM_SHARE_INTENT.SINGLE) {
      const entry = this.singleMediaShareAuthority.entryFor(intent.mediaId);
      if (entry?.status === "ready" && entry.path) {
        return {
          title: entry.title || this.albumShareTitle(),
          path: entry.path,
          imageUrl: entry.imageUrl || ""
        };
      }
      return singleMediaShareFailClosedPayload();
    }
    if (intent.kind === ALBUM_SHARE_INTENT.UNKNOWN) {
      return singleMediaShareFailClosedPayload();
    }
    if (intent.kind === ALBUM_SHARE_INTENT.DEFAULT_ALL) {
      return this.defaultAlbumSharePayload();
    }
    if (intent.kind === ALBUM_SHARE_INTENT.PUBLIC) {
      if (!this.albumShareToken) return singleMediaShareFailClosedPayload();
      return albumShareFriendPayload({
        title: this.albumShareTitle(),
        path: `/pages/session/album${queryString({
          id: this.sessionId,
          source: "wechat_share",
          albumShareToken: this.albumShareToken
        })}`
      });
    }
    return singleMediaShareFailClosedPayload();
  },
  onShareTimeline() {
    if (this.timelineMode) return this.publicAlbumShareTimelinePayload();
    if (this.albumShareReadyVisible && this.activeAlbumShareToken) {
      return this.activeAlbumShareTimelinePayload();
    }
    return this.defaultAlbumShareTimelinePayload();
  },
  watch: {
    activeFilter() {
      if (this.selectionMode && this.selectionModePurpose === "tag") {
        this.cancelSelectionMode();
      }
      this.updateTopActionsFloating();
      this.refreshWaterfall();
    },
    selectedRoleFilter() {
      if (this.selectionMode && this.selectionModePurpose === "tag") {
        this.cancelSelectionMode();
      }
      this.updateTopActionsFloating();
      this.refreshWaterfall();
    }
  },
  methods: {
    apiUrl,
    showShareMenus() {
      const allMenus = ["shareAppMessage", "shareTimeline"];
      if (typeof uni !== "undefined" && typeof uni.hideShareMenu === "function") {
        uni.hideShareMenu({ menus: allMenus });
      }
      const memberDefaultState = memberDefaultAlbumShareState({
        defaultAlbumShareToken: this.defaultAlbumShareToken,
        defaultAlbumShareTimelineCoverPrepared: this.defaultAlbumShareTimelineCoverPrepared
      });
      const memberState = this.albumShareReadyVisible && this.activeAlbumShareToken
        ? {
            token: this.activeAlbumShareToken,
            timelineReady: this.activeAlbumShareTimelineCoverPrepared
          }
        : memberDefaultState;
      const token = this.timelineMode
        ? this.albumShareToken
        : memberState.token;
      if (!token || this.selectionMode) return;
      const menus = albumShareMenus({
        token,
        timelineReady: this.timelineMode
          ? this.shareTimelineCoverPrepared
          : memberState.timelineReady
      });
      if (menus.length === 0) return;
      showWechatShareMenus({
        withShareTicket: true,
        menus
      });
    },
    async prepareShareCoverUrl(path, { normalize = true } = {}) {
      const source = normalize
        ? this.normalizeAlbumMediaUrl(path || "")
        : String(path || "").trim();
      if (!source) return "";
      if (typeof uni === "undefined" || typeof uni.getImageInfo !== "function") {
        return source;
      }
      return new Promise((resolve) => {
        uni.getImageInfo({
          src: source,
          success: (result) => resolve(result.path || result.tempFilePath || source),
          fail: () => resolve("")
        });
      });
    },
    albumShareLocalPreviewByMediaId(mediaId) {
      const visibleMedia = this.visiblePhotoMedia?.[String(mediaId)] || {};
      return (
        albumShareLocalImagePath(visibleMedia.preview) ||
        albumShareLocalImagePath(visibleMedia.thumbnail)
      );
    },
    selectAlbumShareTimelineImage(data) {
      return selectAlbumShareTimelineImage({
        response: data,
        localPreviewByMediaId: (mediaId) =>
          this.albumShareLocalPreviewByMediaId(mediaId),
        thumbnailUrlResolver: (url) => this.normalizeAlbumMediaUrl(url)
      });
    },
    prepareAlbumShareTimelineImage(data) {
      if (!this.albumShareToken) {
        this.applyAlbumShareTimelineImage("");
        return "";
      }
      const imageUrl = this.selectAlbumShareTimelineImage(data);
      this.applyAlbumShareTimelineImage(imageUrl);
      this.showShareMenus();
      return imageUrl;
    },

    resetAlbumShareCovers() {
      this.shareTimelineCoverUrl = "";
      this.shareTimelineCoverPrepared = false;
    },
    invalidateAlbumShareState() {
      this.albumShareToken = "";
      this.shareSubject = null;
      this.shareOwner = null;
      this.shareCounts = { total: 0, photos: 0, videos: 0 };
      this.albumSession = null;
      this.publicAlbumSnapshotLoaded = false;
      this.resetPublicSharePagination();
      this.resetAlbumShareCovers();
      this.showShareMenus();
    },
    applyAlbumShareTimelineImage(imageUrl) {
      const preparedUrl = String(imageUrl || "").trim();
      this.shareTimelineCoverUrl = preparedUrl;
      this.shareTimelineCoverPrepared = Boolean(preparedUrl);
    },
    albumShareTitle() {
      return `我在《${this.albumScriptName || "剧本待定"}》中饰演「${
        this.shareSubjectLabel || "角色待定"
      }」｜游玩相册`;
    },
    albumTimelineTitle() {
      return `这一晚，我是「${this.shareSubjectLabel || "角色待定"}」｜《${
        this.albumScriptName || "剧本待定"
      }》`;
    },
    albumShareSessionTitle() {
      return `${this.albumScriptName || "剧本待定"}｜${this.albumStoreName || "店家待定"}｜${formatBeijingDateTime(this.albumSession?.start_at, "时间待定")}`;
    },
    defaultAlbumShareSubjectLabel() {
      return (
        this.defaultAlbumShareSubject?.role_name ||
        this.defaultAlbumShareSubject?.seat_name ||
        this.defaultAlbumShareSubject?.label ||
        ""
      );
    },
    defaultAlbumShareTitle() {
      return `我在《${this.albumScriptName || "剧本待定"}》中饰演「${
        this.defaultAlbumShareSubjectLabel() || "角色待定"
      }」｜游玩相册`;
    },
    defaultAlbumShareTimelineTitle() {
      return `这一晚，我是「${this.defaultAlbumShareSubjectLabel() || "角色待定"}」｜《${
        this.albumScriptName || "剧本待定"
      }》`;
    },
    defaultAlbumSharePayload() {
      if (
        this.timelineMode ||
        !this.defaultAlbumShareToken
      ) {
        return singleMediaShareFailClosedPayload();
      }
      return albumShareFriendPayload({
        title: this.defaultAlbumShareTitle(),
        path: `/pages/session/album${queryString({
          id: this.sessionId,
          source: "wechat_share",
          albumShareToken: this.defaultAlbumShareToken
        })}`
      });
    },
    defaultAlbumShareTimelinePayload() {
      if (
        this.timelineMode ||
        !this.defaultAlbumShareToken ||
        !this.defaultAlbumShareTimelineCoverPrepared
      ) {
        return null;
      }
      return albumShareTimelinePayload({
        title: this.defaultAlbumShareTimelineTitle(),
        query: this.albumTimelineQuery(this.defaultAlbumShareToken),
        imageUrl: this.defaultAlbumShareTimelineCoverUrl
      });
    },
    publicAlbumShareTimelinePayload() {
      if (
        !this.timelineMode ||
        !this.albumShareToken ||
        !this.shareTimelineCoverPrepared
      ) {
        return null;
      }
      return albumShareTimelinePayload({
        title: this.albumTimelineTitle(),
        query: this.albumTimelineQuery(this.albumShareToken),
        imageUrl: this.shareTimelineCoverUrl
      });
    },
    activeAlbumShareTimelinePayload() {
      if (
        this.timelineMode ||
        !this.activeAlbumShareToken ||
        !this.activeAlbumShareTimelineCoverPrepared
      ) {
        return null;
      }
      return albumShareTimelinePayload({
        title: this.activeAlbumShareTimelineTitle(),
        query: this.albumTimelineQuery(this.activeAlbumShareToken),
        imageUrl: this.activeAlbumShareTimelineCoverUrl
      });
    },
    activeAlbumShareTitle() {
      return `我在《${this.albumScriptName || "剧本待定"}》中饰演「${
        this.activeAlbumShareSubjectLabel || "角色待定"
      }」｜游玩相册`;
    },
    activeAlbumShareTimelineTitle() {
      return `这一晚，我是「${this.activeAlbumShareSubjectLabel || "角色待定"}」｜《${
        this.albumScriptName || "剧本待定"
      }》`;
    },
    activeAlbumSharePayload() {
      if (
        this.timelineMode ||
        !this.activeAlbumShareToken
      ) {
        showToast({ title: "当前分享尚未准备好", icon: "none" });
        return singleMediaShareFailClosedPayload();
      }
      return albumShareFriendPayload({
        title: this.activeAlbumShareTitle(),
        path: `/pages/session/album${queryString({
          id: this.sessionId,
          source: "wechat_share",
          albumShareToken: this.activeAlbumShareToken
        })}`
      });
    },
    beginAlbumShareSnapshotRequest() {
      this.albumShareRequestVersion += 1;
      return {
        version: this.albumShareRequestVersion,
        sessionId: String(this.sessionId || "")
      };
    },
    isCurrentAlbumShareSnapshotRequest(requestContext) {
      return Boolean(
        requestContext &&
          !this.timelineMode &&
          requestContext.version === this.albumShareRequestVersion &&
          requestContext.sessionId === String(this.sessionId || "")
      );
    },
    installActiveAlbumShareSnapshot(data, { token, scope }) {
      this.activeAlbumShareToken = token;
      this.activeAlbumShareScope = scope;
      this.activeAlbumShareCount = Number(data.visible_count || 0);
      this.activeAlbumShareTimelineCoverUrl = "";
      this.activeAlbumShareTimelineCoverPrepared = false;
      this.activeAlbumShareSubject = data.share_subject || this.localAlbumShareSubject();
      this.activeAlbumShareOwner = data.share_owner || null;
      this.activeAlbumShareCounts = {
        total: this.activeAlbumShareCount,
        photos: Number(data.photo_count || 0),
        videos: Number(data.video_count || 0)
      };
      this.albumShareReadyVisible = true;
    },
    installDefaultAlbumShareSnapshot(data, token) {
      this.defaultAlbumShareToken = token;
      this.defaultAlbumShareTimelineCoverUrl = "";
      this.defaultAlbumShareTimelineCoverPrepared = false;
      this.defaultAlbumShareSubject = data.share_subject || this.localAlbumShareSubject();
      this.defaultAlbumShareCounts = {
        total: Number(data.visible_count || 0),
        photos: Number(data.photo_count || 0),
        videos: Number(data.video_count || 0)
      };
    },
    applyDefaultAlbumShareTimelineImage(imageUrl) {
      const preparedUrl = String(imageUrl || "").trim();
      this.defaultAlbumShareTimelineCoverUrl = preparedUrl;
      this.defaultAlbumShareTimelineCoverPrepared = Boolean(preparedUrl);
    },
    applyActiveAlbumShareTimelineImage(imageUrl) {
      const preparedUrl = String(imageUrl || "").trim();
      this.activeAlbumShareTimelineCoverUrl = preparedUrl;
      this.activeAlbumShareTimelineCoverPrepared = Boolean(preparedUrl);
    },
    clearActiveAlbumShareState({ hideMenus = true, invalidateRequest = true } = {}) {
      if (invalidateRequest) {
        this.albumShareRequestVersion += 1;
        this.albumSharePreparing = false;
        if (this.statusText === "正在准备分享...") {
          this.statusText = "";
        }
      }
      this.activeAlbumShareToken = "";
      this.activeAlbumShareScope = "";
      this.activeAlbumShareCount = 0;
      this.activeAlbumShareTimelineCoverUrl = "";
      this.activeAlbumShareTimelineCoverPrepared = false;
      this.activeAlbumShareSubject = null;
      this.activeAlbumShareOwner = null;
      this.activeAlbumShareCounts = { total: 0, photos: 0, videos: 0 };
      this.albumShareReadyVisible = false;
      if (hideMenus) {
        this.showShareMenus();
      }
    },
    closeAlbumShareReady() {
      if (this.albumSharePreparing) {
        return;
      }
      this.clearActiveAlbumShareState({ hideMenus: true });
    },
    resetSingleMediaShareState() {
      this.singleMediaShareAuthority.reset();
      this.singleMediaShareStateVersion += 1;
    },
    isSingleMediaShareEligible(photo) {
      return Boolean(
        !this.timelineMode &&
          normalizeFocusedMediaId(photo?.id) &&
          this.isCurrentPublishedAlbumMedia(photo) &&
          (this.isImageMedia(photo) || this.videoReady(photo))
      );
    },
    async prepareSingleMediaShareCardImage(photo) {
      const currentPhoto = this.viewerPhotoWithCachedMedia(photo);
      let source = "";
      if (currentPhoto.media_type === "video") {
        source =
          currentPhoto.thumbnail_display_url ||
          currentPhoto.cover_url ||
          await this.loadVisiblePhotoMedia(photo, "thumbnail");
      } else {
        source =
          currentPhoto.preview_display_url ||
          await this.loadVisiblePhotoMedia(photo, "preview") ||
          currentPhoto.thumbnail_display_url ||
          await this.loadVisiblePhotoMedia(photo, "thumbnail");
      }
      return singleMediaShareCardImage(await this.prepareShareCoverUrl(source));
    },
    async prepareSingleMediaShare(photo, { force = false } = {}) {
      const mediaId = normalizeFocusedMediaId(photo?.id);
      if (!this.isSingleMediaShareEligible(photo) || !mediaId) {
        return null;
      }
      const cachedEntry = this.singleMediaShareAuthority.entryFor(mediaId);
      if (cachedEntry?.status === "ready" || (!force && cachedEntry)) {
        return cachedEntry;
      }
      const shareRequest = this.singleMediaShareAuthority.begin(mediaId);
      this.singleMediaShareStateVersion += 1;
      if (!shareRequest) {
        return null;
      }
      try {
        const response = await request({
          url: `/api/sessions/${this.sessionId}/album/share-token`,
          method: "POST",
          data: {
            focusMediaId: mediaId,
            includeOwnedUntaggedImages: true
          }
        });
        const data = dataOf(response) || {};
        const token = typeof data.token === "string" ? data.token.trim() : "";
        if (normalizeFocusedMediaId(data.focus_media_id) !== mediaId || !token) {
          throw albumMediaError("ALBUM_PUBLIC_SHARE_RESPONSE_INVALID", "当前内容暂时无法分享");
        }
        const path = singleMediaSharePath({
          sessionId: this.sessionId,
          token,
          mediaId
        });
        if (!path) {
          throw albumMediaError("ALBUM_PUBLIC_SHARE_RESPONSE_INVALID", "当前内容暂时无法分享");
        }
        const imageUrl = await this.prepareSingleMediaShareCardImage(photo);
        const entry = this.singleMediaShareAuthority.resolve(shareRequest, {
          title: this.albumShareSessionTitle() || this.albumShareTitle(),
          path,
          imageUrl,
          token
        });
        this.singleMediaShareStateVersion += 1;
        return entry;
      } catch (error) {
        const entry = this.singleMediaShareAuthority.reject(shareRequest, error);
        this.singleMediaShareStateVersion += 1;
        if (force && entry?.status === "failed") {
          showModal({
            title: "分享暂不可用",
            content: error?.userMessage || "分享准备失败，请稍后再试。",
            showCancel: false,
            confirmText: "知道了"
          });
        }
        return entry;
      }
    },
    handleSingleMediaShareStatusTap(event) {
      const payload = event?.detail || event || {};
      const mediaId = normalizeFocusedMediaId(payload.mediaId);
      const entry = this.singleMediaShareAuthority.entryFor(mediaId);
      if (entry?.status === "failed") {
        const photo = this.previewPhotos.find((item) => normalizeFocusedMediaId(item?.id) === mediaId);
        if (photo) {
          this.prepareSingleMediaShare(photo, { force: true });
        }
        return;
      }
      showToast({
        title: entry?.status === "blocked" ? "该内容当前不可分享" : "正在准备分享，请稍候",
        icon: "none"
      });
    },
    showFullPublicAlbum() {
      this.focusedPublicMode = false;
      this.singleMediaShareRequested = false;
      this.focusedPublicMediaUnavailable = false;
      this.previewOverlayVisible = false;
      this.previewPhotos = [];
      this.previewCurrentIndex = 0;
      this.previewInitialIndex = 0;
      this.previewVideoUrlRequests = {};
      this.resetPreviewVideoViewerState();
      this.refreshWaterfall();
    },
    albumTimelineQuery(albumShareToken = this.activeAlbumShareToken) {
      return queryString({
        id: this.sessionId,
        source: "wechat_timeline",
        albumShareToken
      }).replace(/^\?/, "");
    },
    albumSessionSummary(data = {}) {
      return {
        id: Number(data.session_id || data.id || this.sessionId || 0) || this.sessionId,
        script_name_snapshot: data.script_name_snapshot || "",
        store_name_snapshot: data.store_name_snapshot || "",
        start_at: data.start_at || "",
        played_on: data.played_on || ""
      };
    },
    applyAlbumSessionFallback(session) {
      if (!session || this.albumScriptName) {
        return;
      }
      this.albumSession = this.albumSessionSummary(session);
    },
    applyAlbumNavigationTitle() {
      if (
        typeof uni === "undefined" ||
        typeof uni.setNavigationBarTitle !== "function"
      ) {
        return;
      }
      uni.setNavigationBarTitle({
        title: this.albumTitle || "相册"
      });
    },
    consumePreviewReturnRefreshSkip() {
      if (!this.skipNextAlbumRefreshOnShow) {
        return false;
      }
      this.skipNextAlbumRefreshOnShow = false;
      return true;
    },
    observeAlbumAuthChanges() {
      if (typeof uni !== "undefined" && typeof uni.$on === "function") {
        uni.$on(AUTH_CHANGE_EVENT, this.handleAlbumAuthChange);
      }
    },
    unobserveAlbumAuthChanges() {
      if (typeof uni !== "undefined" && typeof uni.$off === "function") {
        uni.$off(AUTH_CHANGE_EVENT, this.handleAlbumAuthChange);
      }
    },
    handleAlbumAuthChange(auth = {}) {
      const nextUserId = auth?.user?.id || "";
      const accountChanged = String(nextUserId) !== String(this.currentUserId || "");
      if (accountChanged) {
        this.invalidateDefaultAlbumShare();
        this.invalidateAlbumShareState();
        this.invalidateRecruitInviteShare();
        this.resetSingleMediaShareState();
        this.cancelSelectionMode({ force: true });
        this.clearActiveAlbumShareState({ hideMenus: true });
        this.clearAuthorPrivateAlbumState();
      }
      this.currentUserId = nextUserId;
      this.currentRoles = Array.isArray(auth?.roles) ? auth.roles : [];
      return accountChanged;
    },
    updateTopActionsFloating() {
      const canShowActions = this.canUpload || this.photos.length || this.taggablePhotos.length;
      this.topActionsFloating = Boolean(
        !this.timelineMode &&
        !this.selectionMode &&
        canShowActions &&
        this.albumScrollTop > 180
      );
    },
    localAlbumShareSubject() {
      const userId = Number(this.currentUserId || 0);
      if (!userId) {
        return null;
      }
      const seat = this.people.find(
        (person) =>
          person.tag_type === "seat" &&
          Number(person.user_id || 0) === userId &&
          Number(person.seat_id || 0) > 0
      );
      if (!seat) {
        return null;
      }
      return {
        type: "seat",
        seat_id: Number(seat.seat_id),
        role_name: seat.role_name || "",
        seat_name: seat.seat_name || "",
        label: seat.role_name || seat.seat_name || seat.label || "车友"
      };
    },
    inferredSeatRoleName(person) {
      return String(person?.note || "")
        .split(" · ")
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(-1)[0] || "";
    },
    tagPersonTitle(person) {
      if (person?.tag_type !== "seat") {
        return person?.label || this.tagTypeLabel(person?.tag_type);
      }
      return person.role_name || this.inferredSeatRoleName(person) || person.label || "车友";
    },
    tagTypeLabel(value) {
      const labels = {
        seat: "车友",
        dm: "DM",
        npc: "NPC",
        session_npc_role: "NPC角色",
        other: "其他"
      };
      return labels[value] || "成员";
    },
    tagPersonSubtitle(person) {
      if (!person) {
        return "";
      }
      const title = this.tagPersonTitle(person);
      if (person.tag_type === "seat") {
        const accountName = String(person.account_name || person.account_nickname || "").trim();
        if (accountName && accountName !== title) {
          return accountName;
        }
        const legacyLabel = String(person.label || "").trim();
        return legacyLabel && legacyLabel !== title ? legacyLabel : "";
      }
      if (person.tag_type === "session_npc_role") {
        const accountName = String(person.account_name || person.bound_user_name || "").trim();
        if (accountName && accountName !== title) {
          return accountName;
        }
        const legacyBinding = String(person.note || "").split("绑定：")[1]?.split(" · ")[0]?.trim() || "";
        return legacyBinding && legacyBinding !== title ? legacyBinding : "";
      }
      const subtitle = String(person.account_name || person.note || "").trim();
      return subtitle && subtitle !== person.label ? subtitle : "";
    },
    roleFilterOptionLabel(person) {
      const title = this.tagPersonTitle(person);
      const subtitle = this.tagPersonSubtitle(person);
      const genderText =
        person?.tag_type === "session_npc_role"
          ? ` ${this.npcRoleGenderText(person.role_gender)}`
          : "";
      return subtitle ? `${title}${genderText} / ${subtitle}` : `${title}${genderText}`;
    },
    albumRoleNameFromMineTags() {
      const roleCounts = new Map();
      for (const photo of this.photos || []) {
        if (!photo.is_mine) {
          continue;
        }
        for (const tag of photo.tags || []) {
          if (tag.tag_type === "seat") {
            const label = String(tag.label || "").trim();
            if (!label) {
              continue;
            }
            const key = tag.key || (tag.seat_id ? `seat:${tag.seat_id}` : label);
            const current = roleCounts.get(key) || { label, count: 0 };
            roleCounts.set(key, {
              label: current.label || label,
              count: current.count + 1
            });
            continue;
          }
        }
      }
      return (
        [...roleCounts.values()].sort((left, right) => right.count - left.count)[0]?.label || ""
      );
    },
    npcRoleGenderText(roleGender) {
      return roleGenderSymbol(roleGender) || "不限";
    },
    npcRoleGenderClass(roleGender) {
      return normalizeRoleGender(roleGender);
    },
    albumTagSection(key, title, people) {
      return {
        key,
        title,
        items: people.map((person) => this.albumTagCard(person))
      };
    },
    albumTagCard(person) {
      const selected = this.selectedTagKeys.includes(person.key);
      return {
        key: person.key,
        id: person.key,
        raw: person,
        name: this.tagPersonTitle(person),
        note: this.tagPersonSubtitle(person),
        roleGender: person.role_gender || person.roleGender || person.gender || "unlimited",
        genderSymbol:
          person.tag_type === "session_npc_role"
            ? this.npcRoleGenderText(person.role_gender)
            : "",
        showGenderSymbol: person.tag_type === "session_npc_role",
        selected,
        checked: selected,
        stateKind: selected ? "mine" : "available",
        stateLabel: selected ? "已选" : "可选"
      };
    },
    handleAlbumTagTap(payload) {
      this.togglePerson(payload.item.key);
    },
    photosForAlbumFilter(filterValue, options = {}) {
      const includeRole = options.includeRole !== false;
      let scopedPhotos = this.photos;
      if (filterValue === "mine") {
        scopedPhotos = scopedPhotos.filter((photo) => photo.is_mine);
      }
      if (filterValue === "withMe") {
        scopedPhotos = scopedPhotos.filter((photo) =>
          photo.tags.some((tag) => Number(tag.user_id) === Number(this.currentUserId))
        );
      }
      if (filterValue === "untagged") {
        scopedPhotos = scopedPhotos.filter((photo) => photo.tags.length === 0);
      }
      return includeRole
        ? scopedPhotos.filter((photo) => this.photoMatchesSelectedRole(photo))
        : scopedPhotos;
    },
    countAlbumPhotosForFilter(filterValue) {
      return this.photosForAlbumFilter(filterValue).length;
    },
    canSelectAlbumFilter(value) {
      const option = this.albumFilterOptions.find((filter) => filter.value === value);
      return Boolean(option && option.count > 0);
    },
    handleAlbumFilterChange(event) {
      const value = event?.detail?.value;
      if (!this.canSelectAlbumFilter(value)) {
        return;
      }
      this.activeFilter = value;
    },
    countPhotosForRole(roleKey) {
      if (!roleKey) {
        return this.photosForAlbumFilter(this.activeFilter, { includeRole: false }).length;
      }
      return this.photosForAlbumFilter(this.activeFilter, { includeRole: false }).filter((photo) =>
        this.photoMatchesRole(photo, roleKey)
      ).length;
    },
    photoMatchesSelectedRole(photo) {
      if (!this.selectedRoleFilter) {
        return true;
      }
      return this.photoMatchesRole(photo, this.selectedRoleFilter);
    },
    photoMatchesRole(photo, roleKey) {
      return (photo.tags || []).some((tag) => tag.key === roleKey);
    },
    openRoleFilterPicker() {
      if (this.albumBusy || this.albumRoleFilterOptions.length <= 1) {
        return;
      }
      this.roleFilterPickerVisible = true;
    },
    closeRoleFilterPicker() {
      this.roleFilterPickerVisible = false;
    },
    handleRoleFilterChange(event) {
      const value = event?.detail?.value?.[0] || "";
      this.selectedRoleFilter = this.albumRoleFilterOptions.some((option) => option.value === value)
        ? value
        : "";
      this.roleFilterPickerVisible = false;
    },
    ensureSelectedRoleFilter() {
      if (!this.selectedRoleFilter) {
        return;
      }
      const availableRoleKeys = new Set(this.people.map((person) => person.key));
      if (!availableRoleKeys.has(this.selectedRoleFilter)) {
        this.selectedRoleFilter = "";
      }
    },
    beginAlbumListRequest() {
      return this.albumListRequestAuthority.begin();
    },
    isCurrentAlbumListRequest(listRequest) {
      return this.albumListRequestAuthority.isCurrent(listRequest);
    },
    initializeAlbumMediaRefreshController() {
      this.albumMediaRefresh?.dispose();
      this.albumMediaRefresh = createAlbumMediaRefreshController({
        readAlbum: () => ({ photos: this.photos }),
        writeAlbum: (next) => {
          const beforeMedia = memberDefaultAlbumShareMediaFingerprint(this.photos);
          const nextMedia = memberDefaultAlbumShareMediaFingerprint(next.photos);
          const nextPhotos = (next.photos || []).map((photo) => this.normalizePhotoMedia(photo));
          if (!this.timelineMode && beforeMedia !== nextMedia) {
            this.invalidateDefaultAlbumShare({ hideMenus: true });
          }
          this.mediaLoadSerial += 1;
          this.photos = nextPhotos;
          this.pruneUnpublishedAlbumMediaState(this.photos);
          this.refreshWaterfall();
          if (!this.timelineMode && beforeMedia !== nextMedia) {
            this.primeAlbumShareEntries();
          }
        },
        reloadAlbum: async () => {
          const listRequest = this.beginAlbumListRequest();
          try {
            const response = await request({
              url: this.timelineMode
                ? `/api/sessions/${this.sessionId}/album/public-share${queryString({
                    token: this.albumShareToken
                  })}`
                : `/api/sessions/${this.sessionId}/album`,
              suppressMaintenance: true
            });
            if (!this.isCurrentAlbumListRequest(listRequest)) {
              return null;
            }
            const data = dataOf(response) || {};
            if (this.timelineMode) {
              if (!this.isCurrentAlbumListRequest(listRequest)) {
                return null;
              }
              this.albumSession = this.albumSessionSummary(data);
              this.shareSubject = data.share_subject || this.shareSubject;
              this.shareOwner = data.share_owner || this.shareOwner;
              this.prepareAlbumShareTimelineImage(data);
              this.shareCounts = {
                total: Number(data.visible_count || 0),
                photos: Number(data.photo_count || 0),
                videos: Number(data.video_count || 0)
              };
              this.publicShareNextCursor = data.has_more === true && data.next_cursor
                ? String(data.next_cursor)
                : null;
              this.publicShareHasMore = Boolean(this.publicShareNextCursor);
              this.publicShareLoadingMore = false;
              this.publicShareLoadMoreError = "";
              this.showShareMenus();
              this.applyAlbumNavigationTitle();
            }
            reportAlbumMediaEvent("media_refresh_success", { sessionId: Number(this.sessionId) });
            return {
              photos: (data.photos || []).map((photo) => this.normalizePhotoMedia(photo)),
              isCurrent: () => this.isCurrentAlbumListRequest(listRequest)
            };
          } catch (error) {
            if (!this.isCurrentAlbumListRequest(listRequest)) {
              return null;
            }
            reportAlbumMediaEvent("media_refresh_failure", {
              sessionId: Number(this.sessionId),
              errorCode: error?.code || "MEDIA_REFRESH_FAILED"
            });
            if (error?.statusCode === 401 || error?.statusCode === 403) {
              if (!this.timelineMode) {
                this.invalidateDefaultAlbumShare({ hideMenus: true });
                this.invalidateRecruitInviteShare();
              }
              return {
                photos: [],
                isCurrent: () => this.isCurrentAlbumListRequest(listRequest)
              };
            }
            throw error;
          }
        }
      });
    },
    async loadAlbum() {
      if (this.loadingAlbum) {
        return;
      }
      this.loadingAlbum = true;
      const listRequest = this.beginAlbumListRequest();
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/album` });
        if (!this.isCurrentAlbumListRequest(listRequest)) {
          return;
        }
        const data = dataOf(response) || {};
        this.disconnectPhotoObservers();
        this.visiblePhotoMedia = {};
        this.visiblePhotoMediaRequests = {};
        this.mediaProgressById = {};
        this.listThumbnailLoadedById = {};
        this.listThumbnailFailedById = {};
        this.mediaLoadSerial += 1;
        this.invalidateRecruitInviteShare();
        this.invalidateDefaultAlbumShare({ hideMenus: true });
        this.photos = (data.photos || []).map((photo) => this.normalizePhotoMedia(photo));
        this.pruneUnpublishedAlbumMediaState(this.photos);
        this.albumSession = this.albumSessionSummary(data);
        this.hiddenCount = Number(data.hidden_count || 0);
        this.canUpload = Boolean(data.can_upload);
        this.statusText = "";
        this.refreshWaterfall();
        if (this.canUpload) {
          await this.loadPeople(() => this.isCurrentAlbumListRequest(listRequest));
          if (!this.isCurrentAlbumListRequest(listRequest)) {
            return;
          }
          this.ensureSelectedRoleFilter();
        } else {
          this.people = [];
          this.selectedRoleFilter = "";
        }
        this.applyAlbumNavigationTitle();
        this.albumMediaRefresh?.schedule();
        this.primeAlbumShareEntries();
      } catch (error) {
        if (!this.isCurrentAlbumListRequest(listRequest)) {
          return;
        }
        if (error?.statusCode === 401 || error?.statusCode === 403) {
          this.invalidateDefaultAlbumShare({ hideMenus: true });
          this.invalidateRecruitInviteShare();
          this.mediaLoadSerial += 1;
          this.photos = [];
          this.pruneUnpublishedAlbumMediaState(this.photos);
          this.albumSession = null;
          this.canUpload = false;
          this.statusText = "车局相册发车后仅同车成员可查看。";
          this.refreshWaterfall();
        } else {
          this.statusText = "相册加载失败，请稍后重试。";
        }
        this.applyAlbumNavigationTitle();
        this.albumMediaRefresh?.schedule();
      } finally {
        this.loadingAlbum = false;
      }
    },
    async loadPublicAlbum() {
      if (this.loadingAlbum) {
        return;
      }
      if (!this.sessionId || !this.albumShareToken) {
        this.publicAlbumSnapshotLoaded = false;
        this.resetPublicSharePagination();
        this.focusedPublicMode = false;
        this.focusedPublicMediaUnavailable = this.singleMediaShareRequested;
        this.statusText = this.singleMediaShareRequested
          ? "该内容已不可查看"
          : "分享相册链接缺少访问凭证。";
        return;
      }
      this.loadingAlbum = true;
      this.publicAlbumSnapshotLoaded = false;
      this.resetPublicSharePagination();
      this.resetAlbumShareCovers();
      this.showShareMenus();
      const listRequest = this.beginAlbumListRequest();
      try {
        const response = await request({
          url: `/api/sessions/${this.sessionId}/album/public-share${queryString({
            token: this.albumShareToken
          })}`
        });
        if (!this.isCurrentAlbumListRequest(listRequest)) {
          return;
        }
        const data = dataOf(response) || {};
        if (!this.isCurrentAlbumListRequest(listRequest)) {
          return;
        }
        this.disconnectPhotoObservers();
        this.visiblePhotoMedia = {};
        this.visiblePhotoMediaRequests = {};
        this.mediaProgressById = {};
        this.listThumbnailLoadedById = {};
        this.listThumbnailFailedById = {};
        this.mediaLoadSerial += 1;
        this.people = [];
        this.canUpload = false;
        this.hiddenCount = 0;
        this.albumSession = this.albumSessionSummary(data);
        this.shareSubject = data.share_subject || this.shareSubject;
        this.shareOwner = data.share_owner || this.shareOwner;
        this.prepareAlbumShareTimelineImage(data);
        this.shareCounts = {
          total: Number(data.visible_count || 0),
          photos: Number(data.photo_count || 0),
          videos: Number(data.video_count || 0)
        };
        this.publicShareNextCursor = data.has_more === true && data.next_cursor
          ? String(data.next_cursor)
          : null;
        this.publicShareHasMore = Boolean(this.publicShareNextCursor);
        this.photos = (data.photos || []).map((photo) => this.normalizePhotoMedia(photo));
        this.pruneUnpublishedAlbumMediaState(this.photos);
        this.statusText = "";
        this.publicAlbumSnapshotLoaded = true;
        this.showShareMenus();
        this.refreshWaterfall();
        this.applyAlbumNavigationTitle();
        this.albumMediaRefresh?.schedule();
        if (this.singleMediaShareRequested) {
          const focusedSnapshot = focusedPublicSnapshotProjection(this.photos, this.focusMediaId);
          if (!this.focusedPublicMode || focusedSnapshot.unavailable) {
            this.focusedPublicMode = false;
            this.focusedPublicMediaUnavailable = true;
            this.statusText = "该内容已不可查看";
            return;
          }
          this.focusedPublicMediaUnavailable = false;
          this.resetPreviewVideoViewerState();
          this.previewPhotos = focusedSnapshot.photos.map((photo) => this.viewerPhotoWithCachedMedia(photo));
          this.previewCurrentIndex = 0;
          this.previewInitialIndex = 0;
          this.previewOverlayVisible = true;
          this.ensurePreviewMediaAround(0);
        }
      } catch (error) {
        if (!this.isCurrentAlbumListRequest(listRequest)) {
          return;
        }
        this.mediaLoadSerial += 1;
        this.photos = [];
        this.pruneUnpublishedAlbumMediaState(this.photos);
        this.albumSession = null;
        this.canUpload = false;
        this.resetAlbumShareCovers();
        this.publicAlbumSnapshotLoaded = false;
        this.focusedPublicMediaUnavailable = false;
        this.showShareMenus();
        this.statusText =
          error?.statusCode === 403
            ? "分享相册已过期或不可访问。"
            : "分享相册加载失败，请稍后重试。";
        this.refreshWaterfall();
        this.applyAlbumNavigationTitle();
      } finally {
        this.loadingAlbum = false;
      }
    },
    resetPublicSharePagination() {
      this.publicShareNextCursor = null;
      this.publicShareHasMore = false;
      this.publicShareLoadingMore = false;
      this.publicShareLoadMoreError = "";
    },
    async loadMorePublicAlbum() {
      const cursor = this.publicShareNextCursor;
      if (
        !this.timelineMode ||
        !this.sessionId ||
        !this.albumShareToken ||
        !cursor ||
        !this.publicShareHasMore ||
        this.publicShareLoadingMore ||
        this.loadingAlbum
      ) {
        return;
      }
      const url = publicAlbumSharePageUrl({
        sessionId: this.sessionId,
        token: this.albumShareToken,
        cursor
      });
      if (!url) {
        this.resetPublicSharePagination();
        return;
      }
      const listRequest = this.beginAlbumListRequest();
      this.publicShareLoadingMore = true;
      this.publicShareLoadMoreError = "";
      try {
        const response = await request({ url, suppressMaintenance: true });
        if (!this.isCurrentAlbumListRequest(listRequest)) {
          return;
        }
        const data = dataOf(response) || {};
        const merged = mergePublicAlbumSharePages(
          this.photos,
          (data.photos || []).map((photo) => this.normalizePhotoMedia(photo)),
          data
        );
        this.mediaLoadSerial += 1;
        this.photos = merged.photos;
        this.pruneUnpublishedAlbumMediaState(this.photos);
        this.publicShareNextCursor = merged.nextCursor;
        this.publicShareHasMore = merged.hasMore;
        this.refreshWaterfall();
      } catch (error) {
        if (!this.isCurrentAlbumListRequest(listRequest)) {
          return;
        }
        this.publicShareLoadMoreError = "继续加载失败，可重试。";
      } finally {
        if (this.isCurrentAlbumListRequest(listRequest)) {
          this.publicShareLoadingMore = false;
        }
      }
    },
    normalizeAlbumMediaUrl(path) {
      if (!path) {
        return "";
      }
      if (/^https?:\/\//i.test(path)) {
        return path;
      }
      if (/^https?\/\//i.test(path)) {
        return path.replace(/^(https?)\/\//i, "$1://");
      }
      return apiUrl(path);
    },
    normalizePhotoMedia(photo) {
      const mediaType = photo.media_type === "video" ? "video" : "image";
      const moderationStatus = photo.moderation_status || "";
      const published = isModerationPublished(moderationStatus);
      const authorPrivate =
        !this.timelineMode &&
        isAuthorPrivateAlbumMediaRow(photo, this.currentUserId);
      const previewable = published || authorPrivate;
      if (mediaType === "video") {
        return {
          ...photo,
          media_type: "video",
          moderation_status: moderationStatus,
          processing_status: photo.processing_status || "processing",
          tags: published ? photo.tags || [] : [],
          can_tag: published && Boolean(photo.can_tag),
          cover_url: published ? this.normalizeAlbumMediaUrl(photo.cover_url || "") : "",
          video_url: published ? this.normalizeAlbumMediaUrl(photo.video_url || "") : "",
          video_display_url: published ? photo.video_display_url || "" : "",
          video_load_failed: Boolean(photo.video_load_failed),
          duration_seconds: Number(photo.duration_seconds || 0),
          display_url: ""
        };
      }
      const selectedUrls = published
        ? normalizeAlbumImageUrls(photo)
        : authorPrivate
          ? normalizeAuthorPrivateAlbumImageUrls(photo, this.currentUserId)
          : { thumbnailUrl: "", previewUrl: "", downloadUrl: "", expiresAt: "" };
      const rawImageUrl = previewable
        ? photo.image_url || photo.preview_url || selectedUrls.previewUrl || ""
        : "";
      const rawPreviewUrl = previewable ? photo.preview_url || rawImageUrl : "";
      const rawThumbnailUrl = previewable ? photo.thumbnail_url || rawPreviewUrl || rawImageUrl : "";
      const imageUrl = this.normalizeAlbumMediaUrl(rawImageUrl);
      const previewUrl = this.normalizeAlbumMediaUrl(rawPreviewUrl);
      const thumbnailUrl = this.normalizeAlbumMediaUrl(rawThumbnailUrl);
      const previewLoadUrl = previewable
        ? this.normalizeAlbumMediaUrl(photo.preview_load_url || "")
        : "";
      const thumbnailLoadUrl = previewable
        ? this.normalizeAlbumMediaUrl(photo.thumbnail_load_url || "")
        : "";
      const thumbnailDisplayUrl = previewable
        ? this.normalizeAlbumMediaUrl(selectedUrls.thumbnailUrl)
        : "";
      const previewDisplayUrl = previewable
        ? this.normalizeAlbumMediaUrl(selectedUrls.previewUrl)
        : "";
      const downloadUrl = published
        ? this.normalizeAlbumMediaUrl(selectedUrls.downloadUrl)
        : "";
      return {
        ...photo,
        media_type: "image",
        moderation_status: moderationStatus,
        processing_status: photo.processing_status || "ready",
        tags: published ? photo.tags || [] : [],
        can_tag: published && Boolean(photo.can_tag),
        image_url: imageUrl || previewLoadUrl,
        preview_url: previewUrl || previewLoadUrl,
        thumbnail_url: thumbnailUrl || thumbnailLoadUrl || previewLoadUrl,
        preview_load_url: previewLoadUrl,
        thumbnail_load_url: thumbnailLoadUrl,
        thumbnail_display_url: thumbnailDisplayUrl,
        preview_display_url: previewDisplayUrl,
        download_url: downloadUrl,
        media_url_expires_at: selectedUrls.expiresAt,
        display_url: published ? photo.display_url || "" : ""
      };
    },
    mediaUrlForPhoto(photo, variant = "preview") {
      const published = isModerationPublished(photo?.moderation_status);
      const authorPrivate = this.isAuthorPrivateAlbumMedia(photo);
      if (!published && !authorPrivate) {
        return "";
      }
      if (photo?.media_type === "video") {
        return variant === "thumbnail" ? photo.cover_url || "" : "";
      }
      if (variant === "thumbnail") {
        return (
          photo.thumbnail_display_url ||
          photo.thumbnail_load_url ||
          photo.thumbnail_url ||
          photo.preview_load_url ||
          photo.preview_url ||
          photo.image_url ||
          ""
        );
      }
      if (variant === "download") {
        if (!published) return "";
        return photo.download_url || photo.preview_display_url || photo.preview_load_url ||
          photo.preview_url || photo.image_url || "";
      }
      return photo.preview_display_url || photo.preview_load_url || photo.preview_url ||
        photo.image_url || "";
    },
    albumMediaUrlExpiresSoon(path, skewSeconds = 60) {
      if (!path) {
        return false;
      }
      try {
        const url = new URL(apiUrl(path));
        const expires = Number.parseInt(url.searchParams.get("expires") || "", 10);
        return Boolean(expires) && expires <= Math.floor(Date.now() / 1000) + skewSeconds;
      } catch (error) {
        return false;
      }
    },
    albumMediaRequestError(statusCode, imageUrl) {
      const error = new Error(`album image request failed: ${statusCode}`);
      error.statusCode = statusCode;
      error.status = statusCode;
      if (statusCode === 401 || statusCode === 403) error.code = "MEDIA_URL_EXPIRED";
      error.imageUrl = imageUrl;
      return error;
    },
    albumMediaTransportError(error) {
      const message = error?.message || error?.errMsg || "图片加载失败";
      const normalized = new Error(message);
      normalized.status = Number(error?.status || error?.statusCode || 0);
      normalized.statusCode = normalized.status;
      normalized.code = error?.code || (
        /url not in domain list|不在以下 downloadFile 合法域名列表中/i.test(message)
          ? "COS_DOMAIN_NOT_ALLOWED"
          : /timeout|超时/i.test(message)
            ? "COS_REQUEST_TIMEOUT"
            : "MEDIA_DOWNLOAD_FAILED"
      );
      normalized.details = error?.details;
      return normalized;
    },
    formatAlbumMediaError(error, fallback = "图片加载失败") {
      const moderationMessage = contentModerationErrorText(error);
      if (moderationMessage) {
        return moderationMessage;
      }
      const message = error?.userMessage || error?.message || fallback;
      return error?.code ? `${message} [${error.code}]` : message;
    },
    albumMediaProgressKey(photoId, variant = "preview") {
      return `${String(photoId)}:${variant}`;
    },
    setAlbumMediaProgress(photoId, variant, values) {
      const currentPhoto = this.photos.find((photo) => Number(photo.id) === Number(photoId));
      if (!this.isPreviewableAlbumMedia(currentPhoto)) {
        return;
      }
      const key = this.albumMediaProgressKey(photoId, variant);
      this.mediaProgressById[key] = {
        ...(this.mediaProgressById[key] || {}),
        ...values
      };
    },
    isAlbumMediaAuthError(error) {
      return error?.statusCode === 401 || error?.statusCode === 403 ||
        error?.code === "MEDIA_URL_EXPIRED";
    },
    shouldRefreshAlbumMediaBeforeDownload(photo, variant) {
      const expiresAt = Date.parse(photo?.media_url_expires_at || "");
      if (Number.isFinite(expiresAt)) {
        return expiresAt - Date.now() <= 30_000;
      }
      return this.albumMediaUrlExpiresSoon(this.mediaUrlForPhoto(photo, variant));
    },
    latestPreviewPhoto(photo) {
      if (!photo || photo.id === undefined || photo.id === null) {
        return photo;
      }
      const photoId = String(photo.id);
      return (
        this.photos.find((item) => String(item.id) === photoId) ||
        this.previewPhotos.find((item) => String(item.id) === photoId) ||
        photo
      );
    },
    applyFreshAlbumMediaUrls(freshPhotos = []) {
      const currentMediaById = new Map(
        this.photos
          .filter((photo) => photo && photo.id !== undefined && photo.id !== null)
          .map((photo) => [String(photo.id), photo])
      );
      this.mediaLoadSerial += 1;
      this.photos = (freshPhotos || [])
        .filter((photo) => photo && photo.id !== undefined && photo.id !== null)
        .map((photo) =>
          this.normalizePhotoMedia({ ...currentMediaById.get(String(photo.id)), ...photo })
        );
      this.pruneUnpublishedAlbumMediaState(this.photos);
      this.refreshWaterfall();
    },
    refreshAlbumMediaUrlsForPreview() {
      if (!this.sessionId || !this.albumMediaRefresh) {
        return Promise.resolve(false);
      }
      return this.albumMediaRefresh.refresh().then(() => true).catch(() => false);
    },
    async downloadAlbumImage(photo, variant = "preview", options = {}) {
      let targetPhoto = this.latestPreviewPhoto(photo);
      if (!this.isCurrentPreviewableAlbumMedia(targetPhoto)) {
        throw albumMediaError("MEDIA_NOT_PUBLISHED", contentModerationStatusText("review"));
      }
      if (this.isAuthorPrivateAlbumMedia(targetPhoto) && variant === "download") {
        throw albumMediaError("MEDIA_DOWNLOAD_FORBIDDEN", "仅自己可见内容不能下载");
      }
      if (!options.skipRefresh && this.shouldRefreshAlbumMediaBeforeDownload(targetPhoto, variant)) {
        const refreshed = await this.refreshAlbumMediaUrlsForPreview();
        if (refreshed) {
          targetPhoto = this.latestPreviewPhoto(targetPhoto);
        }
      }
      if (!this.isCurrentPreviewableAlbumMedia(targetPhoto)) {
        throw albumMediaError("MEDIA_NOT_PUBLISHED", contentModerationStatusText("review"));
      }
      if (this.isAuthorPrivateAlbumMedia(targetPhoto)) {
        const previewUrl = this.mediaUrlForPhoto(targetPhoto, variant);
        if (!previewUrl) {
          throw albumMediaError("MEDIA_URL_EXPIRED", "图片地址刷新失败");
        }
        return previewUrl;
      }
      try {
        return await this.downloadAlbumImageOnce(targetPhoto, variant);
      } catch (error) {
        if (!options.skipRefresh && this.isAlbumMediaAuthError(error)) {
          return this.retryCurrentMediaAfterAuthFailure(
            targetPhoto,
            this.mediaUrlForPhoto(targetPhoto, variant),
            variant
          );
        }
        throw error;
      }
    },
    async retryCurrentMediaAfterAuthFailure(photo, failedUrl, variant = "preview") {
      const key = `${photo.id}:${failedUrl}`;
      if (this.mediaRefreshAttempts[key]) {
        throw albumMediaError("MEDIA_URL_EXPIRED", "图片地址刷新后仍不可用");
      }
      this.mediaRefreshAttempts = { ...this.mediaRefreshAttempts, [key]: true };
      const refreshed = await this.refreshAlbumMediaUrlsForPreview();
      if (!refreshed) {
        throw albumMediaError("MEDIA_URL_EXPIRED", "图片地址刷新失败");
      }
      const current = this.latestPreviewPhoto(photo);
      if (!this.isCurrentPreviewableAlbumMedia(current)) {
        throw albumMediaError("MEDIA_NOT_PUBLISHED", contentModerationStatusText("review"));
      }
      if (this.isAuthorPrivateAlbumMedia(current)) {
        const previewUrl = this.mediaUrlForPhoto(current, variant);
        if (!previewUrl) throw albumMediaError("MEDIA_URL_EXPIRED", "图片地址刷新后仍不可用");
        return previewUrl;
      }
      try {
        return await this.downloadAlbumImageOnce(current, variant);
      } catch (error) {
        throw albumMediaError("MEDIA_URL_EXPIRED", "图片地址刷新后仍不可用", error);
      }
    },
    downloadAlbumImageOnce(photo, variant = "preview") {
      return this.downloadAlbumImageWithProgress(photo, variant).catch((error) => {
        if (this.isAlbumMediaAuthError(error)) {
          throw error;
        }
        return this.requestAlbumImageOnce(photo, variant);
      });
    },
    albumMediaDownloadContext(photo, variant = "preview") {
      if (!this.isCurrentPublishedAlbumMedia(photo)) {
        return null;
      }
      const token = getToken();
      const filePath = albumMediaCachePath(photo.id, variant);
      const imageUrl = apiUrl(this.mediaUrlForPhoto(photo, variant));
      const mediaRequestError = (statusCode) => this.albumMediaRequestError(statusCode, imageUrl);
      if ((!this.timelineMode && !token) || !filePath || !imageUrl) {
        return null;
      }
      return {
        filePath,
        imageUrl,
        mediaRequestError,
        header:
          token && shouldAttachApiAuthorization(imageUrl, getApiBaseUrl())
            ? { Authorization: `Bearer ${token}` }
            : {}
      };
    },
    writeAlbumMediaFile(filePath, data) {
      if (
        typeof uni === "undefined" ||
        typeof uni.getFileSystemManager !== "function" ||
        !filePath
      ) {
        return Promise.reject(new Error("album image file system unavailable"));
      }
      return new Promise((resolve, reject) => {
        try {
          uni.getFileSystemManager().writeFile({
            filePath,
            data,
            success() {
              resolve(filePath);
            },
            fail: (error) => reject(this.albumMediaTransportError(error))
          });
        } catch (error) {
          reject(error);
        }
      });
    },
    copyAlbumMediaFile(sourcePath, filePath) {
      if (!sourcePath || !filePath || sourcePath === filePath) {
        return Promise.resolve(sourcePath || filePath);
      }
      if (typeof uni === "undefined" || typeof uni.getFileSystemManager !== "function") {
        return Promise.resolve(sourcePath);
      }
      return new Promise((resolve) => {
        try {
          const fileSystem = uni.getFileSystemManager();
          if (!fileSystem || typeof fileSystem.copyFile !== "function") {
            resolve(sourcePath);
            return;
          }
          fileSystem.copyFile({
            srcPath: sourcePath,
            destPath: filePath,
            success() {
              resolve(filePath);
            },
            fail() {
              resolve(sourcePath);
            }
          });
        } catch (error) {
          resolve(sourcePath);
        }
      });
    },
    downloadAlbumImageWithProgress(photo, variant = "preview") {
      const context = this.albumMediaDownloadContext(photo, variant);
      if (!context) {
        return Promise.reject(new Error("album image auth unavailable"));
      }
      if (typeof uni === "undefined" || typeof uni.downloadFile !== "function") {
        return Promise.reject(new Error("album image downloadFile unavailable"));
      }
      return new Promise((resolve, reject) => {
        let downloadTask = null;
        try {
          downloadTask = uni.downloadFile({
            url: context.imageUrl,
            header: context.header,
            success: (response) => {
              if (response.statusCode < 200 || response.statusCode >= 300) {
                reject(context.mediaRequestError(response.statusCode));
                return;
              }
              const localPath = response.tempFilePath || response.filePath || "";
              if (!localPath) {
                reject(new Error("album image download path unavailable"));
                return;
              }
              this.copyAlbumMediaFile(localPath, context.filePath)
                .then((displayPath) => {
                  this.setAlbumMediaProgress(photo.id, variant, {
                    loading: false,
                    failed: false,
                    progress: 100
                  });
                  resolve(displayPath);
                })
                .catch(reject);
            },
            fail: (error) => reject(this.albumMediaTransportError(error))
          });
        } catch (error) {
          reject(error);
          return;
        }
        try {
          if (downloadTask && typeof downloadTask.onProgressUpdate === "function") {
            downloadTask.onProgressUpdate((progress) => {
              this.setAlbumMediaProgress(photo.id, variant, {
                loading: true,
                failed: false,
                progress: progress.progress,
                totalBytesWritten: progress.totalBytesWritten,
                totalBytesExpectedToWrite: progress.totalBytesExpectedToWrite
              });
            });
          }
        } catch (error) {
          reject(error);
        }
      });
    },
    requestAlbumImageOnce(photo, variant = "preview") {
      const context = this.albumMediaDownloadContext(photo, variant);
      if (!context) {
        return Promise.reject(new Error("album image auth unavailable"));
      }
      if (typeof uni === "undefined" || typeof uni.request !== "function") {
        return Promise.reject(new Error("album image request unavailable"));
      }
      return new Promise((resolve, reject) => {
        try {
          uni.request({
            url: context.imageUrl,
            method: "GET",
            responseType: "arraybuffer",
            header: context.header,
            success: (response) => {
              if (response.statusCode < 200 || response.statusCode >= 300) {
                reject(context.mediaRequestError(response.statusCode));
                return;
              }
              this.writeAlbumMediaFile(context.filePath, response.data)
                .then((displayPath) => {
                  this.setAlbumMediaProgress(photo.id, variant, {
                    loading: false,
                    failed: false,
                    progress: 100
                  });
                  resolve(displayPath);
                })
                .catch(reject);
            },
            fail: reject
          });
        } catch (error) {
          reject(error);
        }
      });
    },
    ensurePhotosAlbumPermission() {
      return new Promise((resolve) => {
        if (
          typeof uni === "undefined" ||
          typeof uni.saveImageToPhotosAlbum !== "function"
        ) {
          resolve(false);
          return;
        }
        if (
          typeof uni.getSetting !== "function" ||
          typeof uni.authorize !== "function"
        ) {
          resolve(true);
          return;
        }
        uni.getSetting({
          success: (settings) => {
            const authSetting = settings.authSetting || {};
            if (authSetting["scope.writePhotosAlbum"]) {
              resolve(true);
              return;
            }
            uni.authorize({
              scope: "scope.writePhotosAlbum",
              success: () => resolve(true),
              fail: () => {
                if (
                  typeof showModal !== "function" ||
                  typeof uni.openSetting !== "function"
                ) {
                  resolve(false);
                  return;
                }
                showModal({
                  title: "需要相册权限",
                  content: "请允许保存图片到系统相册。",
                  confirmText: "去设置",
                  cancelText: "取消",
                  success: (result) => {
                    if (!result.confirm) {
                      resolve(false);
                      return;
                    }
                    uni.openSetting({
                      success: (openResult) =>
                        resolve(Boolean(openResult.authSetting?.["scope.writePhotosAlbum"])),
                      fail: () => resolve(false)
                    });
                  },
                  fail: () => resolve(false)
                });
              }
            });
          },
          fail: () => resolve(true)
        });
      });
    },
    saveAlbumImageToPhotosAlbum(filePath) {
      return new Promise((resolve, reject) => {
        if (
          typeof uni === "undefined" ||
          typeof uni.saveImageToPhotosAlbum !== "function"
        ) {
          reject(new Error("saveImageToPhotosAlbum unavailable"));
          return;
        }
        uni.saveImageToPhotosAlbum({
          filePath,
          success: resolve,
          fail: reject
        });
      });
    },
    async preparePhotoMedia() {
      const serial = this.mediaLoadSerial + 1;
      this.mediaLoadSerial = serial;
      const photos = this.photos || [];
      const hydrated = await Promise.all(
        photos.map(async (photo) => {
          if (!this.isCurrentPreviewableAlbumMedia(photo)) {
            return { ...photo, display_url: "" };
          }
          try {
            const displayUrl = await this.downloadAlbumImage(photo);
            if (!this.isCurrentPreviewableAlbumMedia(photo)) {
              return { ...photo, display_url: "" };
            }
            return {
              ...photo,
              display_url: displayUrl
            };
          } catch (error) {
            return {
              ...photo,
              display_url: ""
            };
          }
        })
      );
      if (serial === this.mediaLoadSerial) {
        this.photos = hydrated.map((photo) => this.normalizePhotoMedia(photo));
        this.pruneUnpublishedAlbumMediaState(this.photos);
      }
    },
    updatePhotoDisplayUrl(photoId, displayUrl) {
      const currentPhoto = this.photos.find((photo) => Number(photo.id) === Number(photoId));
      if (!this.isPreviewableAlbumMedia(currentPhoto)) {
        return;
      }
      this.photos = this.photos.map((photo) =>
        Number(photo.id) === Number(photoId)
          ? {
              ...photo,
              display_url: displayUrl
            }
          : photo
      );
    },
    pruneUnpublishedAlbumMediaState(photos = this.photos) {
      const previewableIds = new Set(
        (photos || [])
          .filter((photo) => this.isPreviewableAlbumMedia(photo))
          .map((photo) => String(photo.id))
      );
      const keepPhotoId = (photoId) => previewableIds.has(String(photoId));
      const keepMediaKey = (key) => keepPhotoId(String(key).split(":")[0]);
      this.visiblePhotoMedia = pruneAlbumMediaPreviewCache(this.visiblePhotoMedia, photos, {
        viewerUserId: this.currentUserId,
        timelineMode: this.timelineMode
      });
      this.visiblePhotoMediaRequests = Object.fromEntries(
        Object.entries(this.visiblePhotoMediaRequests || {}).filter(([key]) => keepMediaKey(key))
      );
      this.mediaProgressById = Object.fromEntries(
        Object.entries(this.mediaProgressById || {}).filter(([key]) => keepMediaKey(key))
      );
      this.listThumbnailLoadedById = Object.fromEntries(
        Object.entries(this.listThumbnailLoadedById || {}).filter(([key]) => keepPhotoId(key))
      );
      this.listThumbnailFailedById = Object.fromEntries(
        Object.entries(this.listThumbnailFailedById || {}).filter(([key]) => keepPhotoId(key))
      );
      this.previewVideoUrlRequests = Object.fromEntries(
        Object.entries(this.previewVideoUrlRequests || {}).filter(([key]) => keepPhotoId(key))
      );
      this.mediaRefreshAttempts = Object.fromEntries(
        Object.entries(this.mediaRefreshAttempts || {}).filter(([key]) => keepMediaKey(key))
      );

      const activePreviewId = this.previewOverlayVisible
        ? this.previewPhotos[this.previewCurrentIndex]?.id
        : null;
      const photosById = new Map((photos || []).map((photo) => [String(photo.id), photo]));
      const nextPreviewPhotos = this.previewPhotos
        .map((preview) => photosById.get(String(preview.id)))
        .filter((photo) => this.isPreviewableAlbumMedia(photo));
      const activeStillPreviewable =
        activePreviewId === null ||
        nextPreviewPhotos.some((photo) => String(photo.id) === String(activePreviewId));
      this.previewPhotos = nextPreviewPhotos;
      if (this.previewOverlayVisible && !activeStillPreviewable) {
        if (this.focusedPublicMode) {
          this.previewOverlayVisible = false;
          this.previewPhotos = [];
          this.previewCurrentIndex = 0;
          this.previewInitialIndex = 0;
          this.focusedPublicMode = false;
          this.focusedPublicMediaUnavailable = true;
          this.statusText = "该内容已不可查看";
          return;
        }
        this.closePhotoPreview();
        return;
      }
      if (this.previewOverlayVisible && nextPreviewPhotos.length > 0) {
        const currentIndex = nextPreviewPhotos.findIndex(
          (photo) => String(photo.id) === String(activePreviewId)
        );
        this.previewCurrentIndex = Math.max(0, currentIndex);
        this.previewInitialIndex = this.previewCurrentIndex;
      }
    },
    clearAuthorPrivateAlbumState() {
      this.albumListRequestAuthority.begin();
      this.mediaLoadSerial += 1;
      this.skipNextAlbumRefreshOnShow = false;
      this.photos = (this.photos || []).filter(
        (photo) => !isAuthorPrivateAlbumMediaRow(photo, this.currentUserId)
      );
      this.previewPhotos = (this.previewPhotos || []).filter(
        (photo) => !isAuthorPrivateAlbumMediaRow(photo, this.currentUserId)
      );
      this.visiblePhotoMediaRequests = {};
      this.previewVideoUrlRequests = {};
      this.mediaRefreshAttempts = {};
      this.pruneUnpublishedAlbumMediaState(this.photos);
      if (this.previewOverlayVisible && this.previewPhotos.length === 0) {
        this.closePhotoPreview();
      }
      this.refreshWaterfall();
    },
    setVisiblePhotoMedia(photoId, values) {
      const currentPhoto = this.photos.find((photo) => Number(photo.id) === Number(photoId));
      if (!this.isPreviewableAlbumMedia(currentPhoto)) {
        return;
      }
      const key = String(photoId);
      this.visiblePhotoMedia = {
        ...this.visiblePhotoMedia,
        [key]: {
          ...(this.visiblePhotoMedia[key] || {}),
          ...values
        }
      };
    },
    updatePreviewPhotoDisplayMedia(photoId, values) {
      const key = photoId === undefined || photoId === null ? "" : String(photoId);
      if (!key || !this.previewPhotos.length) {
        return;
      }
      const currentPhoto = this.photos.find((photo) => String(photo.id) === key);
      if (!this.isPreviewableAlbumMedia(currentPhoto)) {
        return;
      }
      const photoIndex = this.previewPhotos.findIndex((photo) => String(photo.id) === key);
      if (photoIndex === -1) {
        return;
      }
      this.previewPhotos.splice(photoIndex, 1, {
        ...this.previewPhotos[photoIndex],
        ...values
      });
    },
    listThumbnailStateKey(photo) {
      return photo?.id === undefined || photo?.id === null ? "" : String(photo.id);
    },
    listThumbnailLoaded(photo) {
      const key = this.listThumbnailStateKey(photo);
      return Boolean(key && this.listThumbnailLoadedById[key]);
    },
    listThumbnailFailed(photo) {
      const key = this.listThumbnailStateKey(photo);
      return Boolean(key && this.listThumbnailFailedById[key]);
    },
    setListThumbnailState(photo, values) {
      const key = this.listThumbnailStateKey(photo);
      if (!key || !this.isCurrentPreviewableAlbumMedia(photo)) {
        return;
      }
      if (Object.prototype.hasOwnProperty.call(values, "loaded")) {
        this.listThumbnailLoadedById = {
          ...this.listThumbnailLoadedById,
          [key]: Boolean(values.loaded)
        };
      }
      if (Object.prototype.hasOwnProperty.call(values, "failed")) {
        this.listThumbnailFailedById = {
          ...this.listThumbnailFailedById,
          [key]: Boolean(values.failed)
        };
      }
    },
    handleListThumbnailLoad(photo) {
      this.setListThumbnailState(photo, { loaded: true, failed: false });
    },
    handleListThumbnailError(photo) {
      this.setListThumbnailState(photo, { loaded: false, failed: true });
    },
    canOpenPhotoPreview(photo) {
      if (!this.isCurrentPreviewableAlbumMedia(photo)) {
        return false;
      }
      if (
        !(this.focusedPublicMode && this.timelineMode && this.videoReady(photo)) &&
        !canOpenAlbumMediaPreview({
          timelineMode: this.timelineMode,
          mediaType: photo?.media_type,
          processingStatus: this.isAuthorPrivateAlbumMedia(photo)
            ? "ready"
            : photo?.processing_status
        })
      ) {
        return false;
      }
      if (photo?.media_type === "video") {
        return true;
      }
      const key = this.listThumbnailStateKey(photo);
      return Boolean(key && this.visiblePhotoMedia[key]?.thumbnail && this.listThumbnailLoaded(photo));
    },
    async loadVisiblePhotoMedia(photo, variant = "thumbnail") {
      if (!this.isCurrentPreviewableAlbumMedia(photo)) {
        return "";
      }
      const key = String(photo.id);
      const requestKey = `${key}:${variant}`;
      const current = this.visiblePhotoMedia[key] || {};
      if (current[variant]) {
        return current[variant];
      }
      const loadingKey = `${variant}Loading`;
      const activeRequests = this.visiblePhotoMediaRequests || {};
      if (activeRequests[requestKey]) {
        return activeRequests[requestKey];
      }
      if (current[loadingKey]) {
        return "";
      }
      this.setVisiblePhotoMedia(photo.id, { [loadingKey]: true, [`${variant}Failed`]: false });
      this.setAlbumMediaProgress(photo.id, variant, {
        loading: true,
        failed: false,
        progress: 0
      });
      const loadRequest = this.downloadAlbumImage(photo, variant)
        .then((displayUrl) => {
          if (!this.isCurrentPreviewableAlbumMedia(photo)) {
            return "";
          }
          this.setVisiblePhotoMedia(photo.id, {
            [variant]: displayUrl,
            [loadingKey]: false
          });
          this.setAlbumMediaProgress(photo.id, variant, {
            loading: false,
            failed: false,
            progress: 100
          });
          this.updatePreviewPhotoDisplayMedia(photo.id, {
            [`${variant}_display_url`]: displayUrl,
            ...(variant === "preview" ? { display_url: displayUrl } : {})
          });
          if (variant === "preview") {
            this.updatePhotoDisplayUrl(photo.id, displayUrl);
          }
          return displayUrl;
        })
        .catch((error) => {
          if (!this.isCurrentPreviewableAlbumMedia(photo)) {
            return "";
          }
          this.setVisiblePhotoMedia(photo.id, {
            [loadingKey]: false,
            [`${variant}Failed`]: true
          });
          this.setAlbumMediaProgress(photo.id, variant, {
            loading: false,
            failed: true,
            errorCode: error?.code || "",
            errorMessage: error?.message || ""
          });
          if (variant !== "thumbnail") {
            this.statusText = this.formatAlbumMediaError(error);
          }
          return "";
        })
        .finally(() => {
          this.visiblePhotoMediaRequests = clearAlbumMediaRequestIfCurrent(
            this.visiblePhotoMediaRequests,
            requestKey,
            loadRequest
          );
        });
      this.visiblePhotoMediaRequests = {
        ...(this.visiblePhotoMediaRequests || {}),
        [requestKey]: loadRequest
      };
      try {
        return await loadRequest;
      } catch (error) {
        return "";
      }
    },
    onPhotoVisible(photo) {
      if (!this.isCurrentPreviewableAlbumMedia(photo)) {
        return;
      }
      if (photo?.media_type === "video" && !photo.cover_url) {
        return;
      }
      this.loadVisiblePhotoMedia(photo, "thumbnail");
    },
    disconnectPhotoObservers() {
      for (const observer of this.photoObservers || []) {
        if (observer && typeof observer.disconnect === "function") {
          observer.disconnect();
        }
      }
      this.photoObservers = [];
    },
    observeVisiblePhotos() {
      this.disconnectPhotoObservers();
      const photos = [...this.waterfallList1, ...this.waterfallList2];
      if (!photos.length) {
        return;
      }
      if (typeof uni === "undefined" || typeof uni.createIntersectionObserver !== "function") {
        photos.slice(0, 12).forEach((photo) => this.onPhotoVisible(photo));
        return;
      }
      this.$nextTick(() => {
        const observers = [];
        for (const photo of photos) {
          if (this.visiblePhotoMedia[photo.id]?.thumbnail) {
            continue;
          }
          const observer = uni.createIntersectionObserver();
          observer.relativeToViewport({ bottom: 600 }).observe(`#${this.photoDomId(photo)}`, (entry) => {
            if (entry.intersectionRatio > 0) {
              this.onPhotoVisible(photo);
              observer.disconnect();
            }
          });
          observers.push(observer);
        }
        this.photoObservers = observers;
      });
    },
    refreshWaterfall() {
      const waterfallRender = this.albumWaterfallRenderAuthority.begin();
      this.disconnectPhotoObservers();
      const nextPhotos = this.filteredPhotos.map((photo) => ({ ...photo }));
      this.waterfallList1 = [];
      this.waterfallList2 = [];
      if (this.$refs.albumWaterfall && typeof this.$refs.albumWaterfall.clear === "function") {
        this.$refs.albumWaterfall.clear();
      }
      this.waterfallPhotos = [];
      this.$nextTick(() => {
        if (!this.albumWaterfallRenderAuthority.isCurrent(waterfallRender)) {
          return;
        }
        this.waterfallPhotos = nextPhotos;
        this.$nextTick(() => {
          if (!this.albumWaterfallRenderAuthority.isCurrent(waterfallRender)) {
            return;
          }
          this.observeVisiblePhotos();
        });
      });
    },
    changeWaterfallList(event) {
      if (event?.name === "list1" || event?.name === "list2") {
        const targetListName = `waterfallList${event.name.slice(4)}`;
        if (!Array.isArray(this[targetListName])) {
          return;
        }
        const currentPhoto = findCurrentAlbumMediaRow(this.filteredPhotos, event.value);
        if (!currentPhoto) {
          return;
        }
        this[targetListName].push(currentPhoto);
        this.$nextTick(() => this.observeVisiblePhotos());
      }
    },
    photoDomId(photo) {
      return `album-photo-${photo.id}`;
    },
    photoImageStyle(photo) {
      const columnWidth = Number(photo.width || 0);
      const imageWidth = Number(
        photo.media_type === "video" ? photo.video_width || 0 : photo.image_width || 0
      );
      const imageHeight = Number(
        photo.media_type === "video" ? photo.video_height || 0 : photo.image_height || 0
      );
      if (columnWidth > 0 && imageWidth > 0 && imageHeight > 0) {
        const ratio = Math.min(1.8, Math.max(0.68, imageHeight / imageWidth));
        return `height:${Math.round(columnWidth * ratio)}px;`;
      }
      return "height:328rpx;";
    },
    async loadPeople(isCurrent = () => true) {
      let people = [];
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/album/people` });
        people = dataOf(response)?.people || [];
      } catch (error) {
        people = [];
      }
      if (!isCurrent()) {
        return;
      }
      const fallbackPeople = await this.loadSessionPeopleFallback(isCurrent);
      if (!isCurrent()) {
        return;
      }
      this.people = this.mergePeople([...people, ...fallbackPeople]);
    },
    async loadSessionPeopleFallback(isCurrent = () => true) {
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}` });
        if (!isCurrent()) {
          return [];
        }
        const session = dataOf(response) || {};
        this.applyAlbumSessionFallback(session);
        return this.sessionDetailPeople(session);
      } catch (error) {
        return [];
      }
    },
    sessionDetailPeople(session) {
      const people = [];
      for (const seat of session.seats || []) {
        const accountName =
          seat.confirmed_user_name ||
          seat.user_nickname ||
          seat.user_open_id ||
          "";
        people.push({
          key: `seat:${seat.id}`,
          tag_type: "seat",
          seat_id: seat.id,
          user_id: seat.confirmed_user_id || null,
          label: seat.role_name || seat.name || "车友",
          note: accountName,
          role_gender: seat.role_gender || "unlimited",
          role_name: seat.role_name || "",
          seat_name: seat.name || "",
          account_name: accountName
        });
      }

      if (session.dm_user_id || session.dm_name_snapshot) {
        people.push({
          key: "dm:session",
          tag_type: "dm",
          seat_id: null,
          user_id: session.dm_user_id || null,
          label: session.dm_name_snapshot || "DM",
          note: "DM"
        });
      }
      if (session.npc_user_id || session.npc_name_snapshot) {
        people.push({
          key: "npc:session",
          tag_type: "npc",
          seat_id: null,
          user_id: session.npc_user_id || null,
          label: session.npc_name_snapshot || "NPC",
          note: "NPC"
        });
      }

      people.push({
        key: "other:session",
        tag_type: "other",
        seat_id: null,
        user_id: null,
        label: "其他",
        note: "风景/主线外照片"
      });

      for (const role of session.session_npc_roles || []) {
        const accountName = role.bound_user_name || "";
        people.push({
          key: `session-npc:${role.id}`,
          tag_type: "session_npc_role",
          seat_id: null,
          session_npc_role_id: role.id,
          user_id: role.bound_user_id || null,
          label: role.name || "NPC角色",
          role_gender: role.role_gender || "unlimited",
          note: accountName,
          account_name: accountName
        });
      }

      return people;
    },
    mergePeople(people) {
      const peopleByKey = new Map();
      for (const person of people) {
        if (person?.key && !peopleByKey.has(person.key)) {
          peopleByKey.set(person.key, person);
        }
      }
      return [...peopleByKey.values()];
    },
    tagSummary(photo) {
      if (this.timelineMode) {
        return this.publicMediaCaption(photo);
      }
      if (!photo.tags || photo.tags.length === 0) {
        return "待标注";
      }
      return `${photo.media_type === "video" ? "视频" : "照片"}里：${photo.tags.map((tag) => tag.label).join("、")}`;
    },
    mediaModerationStatusText(photo) {
      if (this.timelineMode || !photo?.is_mine) {
        return "";
      }
      if (this.isAuthorPrivateAlbumMedia(photo)) {
        return authorPrivateContentModerationStatusText(photo.moderation_status);
      }
      return contentModerationStatusText(photo.moderation_status);
    },
    isVideoMedia(photo) {
      return photo?.media_type === "video";
    },
    isImageMedia(photo) {
      return photo?.media_type === "image";
    },
    isPublishedAlbumMedia(photo) {
      return isModerationPublished(photo?.moderation_status);
    },
    isAuthorPrivateAlbumMedia(photo) {
      return (
        !this.timelineMode &&
        isAuthorPrivateAlbumMediaRow(photo, this.currentUserId)
      );
    },
    isPreviewableAlbumMedia(photo) {
      return this.isPublishedAlbumMedia(photo) || this.isAuthorPrivateAlbumMedia(photo);
    },
    isCurrentPublishedAlbumMedia(photo) {
      return isCurrentPublishedAlbumMediaRow(this.photos, photo);
    },
    isCurrentPreviewableAlbumMedia(photo) {
      return isCurrentPreviewableAlbumMediaRow(this.photos, photo, {
        viewerUserId: this.currentUserId,
        timelineMode: this.timelineMode
      });
    },
    isDownloadableAlbumImage(photo) {
      return (
        this.isCurrentPublishedAlbumMedia(photo) &&
        isApprovedAlbumImageDownloadCandidate(photo, this.mediaUrlForPhoto(photo, "download"))
      );
    },
    videoReady(photo) {
      return (
        this.isVideoMedia(photo) &&
        this.isPreviewableAlbumMedia(photo) &&
        (
          this.isAuthorPrivateAlbumMedia(photo) ||
          photo.processing_status === "ready"
        )
      );
    },
    videoProcessing(photo) {
      return this.isVideoMedia(photo) && photo.processing_status === "processing";
    },
    videoFailed(photo) {
      return this.isVideoMedia(photo) && photo.processing_status === "failed";
    },
    videoStateText(photo) {
      if (!this.isVideoMedia(photo)) {
        return "";
      }
      const moderationText = this.mediaModerationStatusText(photo);
      if (moderationText) {
        return moderationText;
      }
      if (this.videoProcessing(photo)) {
        return "处理中";
      }
      if (this.videoFailed(photo)) {
        return "处理失败";
      }
      return "短视频";
    },
    publicMediaCaption(photo) {
      return publicAlbumMediaCaption(photo, this.shareSubjectLabel);
    },
    formatVideoDuration(seconds) {
      const totalSeconds = Math.max(0, Math.round(Number(seconds || 0)));
      const minutes = Math.floor(totalSeconds / 60);
      const remainder = String(totalSeconds % 60).padStart(2, "0");
      return `${minutes}:${remainder}`;
    },
    photoDetailText(photo) {
      return `${photo.uploader_name || "车友"} · ${this.formatDate(photo.created_at)}`;
    },
    photoActionDateText(photo) {
      const formatted = this.formatDate(photo.created_at);
      if (!formatted || formatted === "-") {
        return "-";
      }
      return formatted.length > 10 ? formatted.slice(5) : formatted;
    },
    photoSourceIcon(photo) {
      return photo?.is_mine ? "/static/icons/user.png" : "/static/icons/group.png";
    },
    photoSourceLabel(photo) {
      return photo?.is_mine ? "我" : "友";
    },
    showPhotoInfo(photo) {
      if (!photo) {
        return;
      }
      const uploader = photo.uploader_name || "车友";
      const createdAt = this.formatDate(photo.created_at);
      const dimensions = photo.media_type === "video" ? this.videoMetaText(photo) : this.imageMetaText(photo);
      showModal({
        title: photo.media_type === "video" ? "视频信息" : "图片信息",
        content: `${this.tagSummary(photo)}\n上传者：${uploader}\n时间：${createdAt}\n尺寸：${dimensions}`,
        showCancel: false,
        confirmText: "知道了"
      });
    },
    videoMetaText(photo) {
      const width = Number(photo.video_width || 0);
      const height = Number(photo.video_height || 0);
      const byteSize = Number(photo.video_byte_size || 0);
      const sizeText = byteSize > 0 ? this.formatFileSize(byteSize) : "大小未知";
      const durationText = this.formatVideoDuration(photo.duration_seconds);
      if (width > 0 && height > 0) {
        return `${durationText} · ${width}x${height} · ${sizeText}`;
      }
      return `${durationText} · ${sizeText}`;
    },
    formatFileSize(byteSize) {
      const size = Number(byteSize || 0);
      if (size >= 1024 * 1024) {
        return `${Math.max(0.1, size / 1024 / 1024).toFixed(1)}MB`;
      }
      return `${Math.max(1, Math.round(size / 1024))}KB`;
    },
    imageMetaText(photo) {
      const width = Number(photo.image_width || 0);
      const height = Number(photo.image_height || 0);
      const byteSize = Number(photo.image_byte_size || 0);
      const sizeText = byteSize > 0 ? `${Math.max(1, Math.round(byteSize / 1024))}KB` : "大小未知";
      if (width > 0 && height > 0) {
        return `${width}x${height} · ${sizeText}`;
      }
      return sizeText;
    },
    formatDate(value) {
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
      const pad = (number) => String(number).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
        date.getHours()
      )}:${pad(date.getMinutes())}`;
    },
    chooseAlbumMedia() {
      if (this.timelineMode || !this.canUpload || this.albumBusy) {
        showToast({ title: "发车后同车成员可上传", icon: "none" });
        return;
      }
      if (!this.canUploadVideo) {
        this.choosePhotos();
        return;
      }
      if (typeof wx === "undefined" || typeof wx.chooseMedia !== "function") {
        showToast({ title: "当前微信版本仅支持选择图片", icon: "none" });
        this.choosePhotos();
        return;
      }
      wx.chooseMedia({
        count: 9,
        mediaType: ["image", "video"],
        sourceType: ["album", "camera"],
        sizeType: ["original"],
        maxDuration: MAX_ALBUM_VIDEO_RECORDING_DURATION_SECONDS,
        success: async (result) => {
          const selection = classifyAlbumMediaSelection(result);
          if (selection.kind === "invalid") {
            showToast({ title: selection.message, icon: "none" });
            return;
          }
          if (selection.kind === "video") {
            await this.uploadChosenVideo(selection.file);
            return;
          }
          await this.uploadChosenPhotos(selection.paths);
        }
      });
    },
    choosePhotos() {
      if (this.timelineMode || !this.canUpload || this.albumBusy) {
        showToast({ title: "发车后同车成员可上传", icon: "none" });
        return;
      }
      uni.chooseImage({
        count: 9,
        sizeType: ["original"],
        sourceType: ["album", "camera"],
        success: async (result) => {
          const photoItems = result.tempFiles || [];
          await this.uploadChosenPhotos(photoItems.length ? photoItems : result.tempFilePaths || []);
        }
      });
    },
    getPhotoFileStat(filePath) {
      return new Promise((resolve) => {
        const fileSystemApi =
          typeof uni !== "undefined" && typeof uni.getFileSystemManager === "function"
            ? uni
            : typeof wx !== "undefined" && typeof wx.getFileSystemManager === "function"
              ? wx
              : null;
        if (!fileSystemApi || !filePath) {
          resolve({});
          return;
        }
        fileSystemApi.getFileSystemManager().stat({
          path: filePath,
          success: (result) => {
            const stats = result.stats || result.stat || result;
            resolve({ size: Number(stats?.size || 0) });
          },
          fail: () => resolve({})
        });
      });
    },
    getPhotoFileInfo(filePath) {
      return new Promise((resolve) => {
        if (!filePath) {
          resolve({});
          return;
        }
        const imageInfoApi =
          typeof uni !== "undefined" && typeof uni.getImageInfo === "function"
            ? uni
            : typeof wx !== "undefined" && typeof wx.getImageInfo === "function"
              ? wx
              : null;
        const info = {};
        const resolveWithFileSize = () => {
          const getFileInfoApi =
            typeof uni !== "undefined" && typeof uni.getFileInfo === "function"
              ? uni
              : typeof wx !== "undefined" && typeof wx.getFileInfo === "function"
                ? wx
                : null;
          if (!getFileInfoApi) {
            this.getPhotoFileStat(filePath).then((statInfo) => {
              resolve({ ...info, size: Number(statInfo.size || 0) });
            });
            return;
          }
          getFileInfoApi.getFileInfo({
            filePath,
            success: (result) => resolve({ ...info, size: Number(result.size || 0) }),
            fail: async () => {
              const statInfo = await this.getPhotoFileStat(filePath);
              resolve({ ...info, size: Number(statInfo.size || 0) });
            }
          });
        };
        if (!imageInfoApi) {
          resolveWithFileSize();
          return;
        }
        imageInfoApi.getImageInfo({
          src: filePath,
          success: (result) => {
            info.width = Number(result.width || 0);
            info.height = Number(result.height || 0);
            resolveWithFileSize();
          },
          fail: resolveWithFileSize
        });
      });
    },
    normalizePhotoUploadItem(item) {
      if (typeof item === "string") {
        return { filePath: item, size: 0, contentType: this.photoContentType(item) };
      }
      const filePath = item?.tempFilePath || item?.path || item?.filePath || "";
      return {
        filePath,
        size: Number(item?.size || 0),
        contentType: item?.type || item?.mimeType || this.photoContentType(filePath)
      };
    },
    photoContentType(filePath, fallback = "image/jpeg") {
      return /\.png(?:$|[?#])/i.test(String(filePath || "")) ? "image/png" : fallback;
    },
    photoCompressTargetSize(info = {}) {
      const width = Number(info.width || 0);
      const height = Number(info.height || 0);
      if (width > 0 && height > 0) {
        const scale = Math.min(
          1,
          ALBUM_PHOTO_COMPRESS_WIDTH / width,
          ALBUM_PHOTO_COMPRESS_HEIGHT / height
        );
        return {
          compressedWidth: Math.max(1, Math.round(width * scale)),
          compressedHeight: Math.max(1, Math.round(height * scale))
        };
      }
      return {
        compressedWidth: ALBUM_PHOTO_COMPRESS_WIDTH,
        compressedHeight: ALBUM_PHOTO_COMPRESS_HEIGHT
      };
    },
    async compressPhotoBeforeUpload(filePath, originalInfo = {}) {
      if (typeof uni === "undefined" || typeof uni.compressImage !== "function") {
        return { filePath, ...originalInfo };
      }
      const targetSize = this.photoCompressTargetSize(originalInfo);
      return new Promise((resolve) => {
        uni.compressImage({
          src: filePath,
          quality: ALBUM_PHOTO_COMPRESS_QUALITY,
          compressedWidth: targetSize.compressedWidth,
          compressedHeight: targetSize.compressedHeight,
          success: async (result) => {
            const compressedPath = result.tempFilePath || filePath;
            const compressedInfo = await this.getPhotoFileInfo(compressedPath);
            resolve({
              filePath: compressedPath,
              size: Number(result.size || compressedInfo.size || 0),
              width: compressedInfo.width || targetSize.compressedWidth || originalInfo.width || null,
              height: compressedInfo.height || targetSize.compressedHeight || originalInfo.height || null
            });
          },
          fail: () => resolve({ filePath, ...originalInfo })
        });
      });
    },
    async preparePhotoForUpload(item) {
      const normalized = this.normalizePhotoUploadItem(item);
      const { filePath } = normalized;
      const originalInfo = await this.getPhotoFileInfo(filePath);
      const pickerSize = Number(normalized.size || 0);
      const originalSize = pickerSize || Number(originalInfo.size || 0);
      if (originalSize > 0 && originalSize <= MAX_ALBUM_PHOTO_UPLOAD_BYTES) {
        return {
          filePath,
          size: originalSize,
          width: originalInfo.width || null,
          height: originalInfo.height || null,
          contentType: normalized.contentType || this.photoContentType(filePath)
        };
      }
      if (!originalSize) {
        this.statusText = "无法读取图片大小，正在尝试压缩照片...";
      }
      if (originalSize) {
        this.statusText = "正在压缩照片...";
      }
      const compressed = await this.compressPhotoBeforeUpload(filePath, {
        filePath,
        size: originalSize,
        width: originalInfo.width || null,
        height: originalInfo.height || null,
        contentType: normalized.contentType || this.photoContentType(filePath)
      });
      const uploadPath = compressed.filePath || filePath;
      let uploadSize = Number(compressed.size || 0);
      if (!uploadSize) {
        const uploadInfo = await this.getPhotoFileInfo(uploadPath);
        uploadSize = Number(uploadInfo.size || 0);
      }
      if (!uploadSize && uploadPath === filePath) {
        uploadSize = originalSize;
      }
      if (!uploadSize) {
        this.statusText = "无法读取压缩后图片大小，请换一张或先压缩后再上传。";
        showToast({ title: "无法确认图片大小", icon: "none" });
        return null;
      }
      if (uploadSize > MAX_ALBUM_PHOTO_UPLOAD_BYTES) {
        this.statusText = `图片超过 4MB，压缩后仍有 ${this.formatFileSize(uploadSize)}，请换一张或先压缩后再上传。`;
        showToast({ title: "图片超过 4MB", icon: "none" });
        return null;
      }
      return {
        filePath: uploadPath,
        size: uploadSize,
        width: compressed.width || originalInfo.width || null,
        height: compressed.height || originalInfo.height || null,
        contentType: this.photoContentType(
          uploadPath,
          normalized.contentType || this.photoContentType(filePath)
        )
      };
    },
    getVideoFileInfo(filePath) {
      return new Promise((resolve) => {
        if (typeof wx === "undefined" || !filePath) {
          resolve({});
          return;
        }
        const info = {};
        const resolveWithFileSize = () => {
          if (typeof wx.getFileInfo !== "function") {
            this.getPhotoFileStat(filePath).then((statInfo) => {
              resolve({ ...info, size: Number(statInfo.size || 0) });
            });
            return;
          }
          wx.getFileInfo({
            filePath,
            success: (result) => resolve({ ...info, size: Number(result.size || 0) }),
            fail: async () => {
              const statInfo = await this.getPhotoFileStat(filePath);
              resolve({ ...info, size: Number(statInfo.size || 0) });
            }
          });
        };
        if (typeof wx.getVideoInfo !== "function") {
          resolveWithFileSize();
          return;
        }
        wx.getVideoInfo({
          src: filePath,
          success: (result) => {
            Object.assign(info, result || {});
            resolveWithFileSize();
          },
          fail: resolveWithFileSize
        });
      });
    },
    async compressVideoBeforeUpload(filePath, originalInfo = {}) {
      if (typeof wx === "undefined" || typeof wx.compressVideo !== "function") {
        return null;
      }
      return new Promise((resolve) => {
        wx.compressVideo({
          src: filePath,
          quality: "medium",
          success: async (result) => {
            const compressedPath = result.tempFilePath || "";
            if (!compressedPath) {
              resolve(null);
              return;
            }
            const compressedInfo = await this.getVideoFileInfo(compressedPath);
            const reportedSizeBytes = compressVideoSizeBytes(result.size);
            resolve({
              filePath: compressedPath,
              size: Number(compressedInfo.size || reportedSizeBytes || 0),
              width: compressedInfo.width || originalInfo.width || null,
              height: compressedInfo.height || originalInfo.height || null,
              duration: compressedInfo.duration || originalInfo.duration || null
            });
          },
          fail: () => resolve(null)
        });
      });
    },
    isSuspiciousCompressedVideo(compressed = {}, originalInfo = {}) {
      const compressedSize = Number(compressed.size || 0);
      const originalSize = Number(originalInfo.size || 0);
      const durationSeconds = Number(originalInfo.duration || compressed.duration || 0);
      if (!compressedSize) {
        return true;
      }
      return (
        durationSeconds >= 5 &&
        originalSize > VIDEO_COMPRESSION_SUSPICIOUS_MIN_ORIGINAL_BYTES &&
        compressedSize < originalSize * 0.01 &&
        compressedSize < 512 * 1024
      );
    },
    confirmVideoUpload({ durationSeconds, uploadSize }) {
      return new Promise((resolve) => {
        showModal({
          title: "上传视频",
          content: `时长 ${this.formatVideoDuration(durationSeconds)}，预计上传 ${this.formatFileSize(uploadSize)}。上传后按相册隐私展示。`,
          confirmText: "上传",
          cancelText: "取消",
          success(result) {
            resolve(Boolean(result.confirm));
          },
          fail() {
            resolve(false);
          }
        });
      });
    },
    async uploadChosenVideo(file) {
      const originalPath = file.tempFilePath || file.path || "";
      if (!originalPath) {
        showToast({ title: "没有可上传的视频", icon: "none" });
        return;
      }
      try {
        await runExclusiveAlbumMediaTask({
          isBusy: () => this.albumBusy,
          setBusy: (value) => {
            this.uploading = value;
          },
          task: async () => {
            this.statusText = "正在处理视频...";
            const originalInfo = await this.getVideoFileInfo(originalPath);
            const durationSeconds = Math.ceil(
              Number(file.duration || originalInfo.duration || 0)
            );
            if (!durationSeconds) {
              showToast({ title: "无法读取视频时长，请换一个视频", icon: "none" });
              this.statusText = "";
              return;
            }
            const originalSize = Number(file.size || originalInfo.size || 0);
            let uploadInfo = {
              filePath: originalPath,
              size: originalSize,
              width: originalInfo.width || null,
              height: originalInfo.height || null,
              duration: durationSeconds
            };
            this.statusText = "正在压缩视频...";
            const compressed = await this.compressVideoBeforeUpload(originalPath, uploadInfo);
            const compressedSize = Number(compressed?.size || 0);
            const suspicious = this.isSuspiciousCompressedVideo(compressed || {}, uploadInfo);
            if (!isUsableRequiredVideoCompression({
              originalPath,
              compressedPath: compressed?.filePath,
              compressedSize,
              suspicious
            })) {
              showToast({ title: "视频压缩失败，请先压缩后再上传", icon: "none" });
              this.statusText = "视频必须成功压缩后才能上传。";
              return;
            }
            const uploadPath = compressed.filePath;
            let uploadSize = compressedSize;
            uploadInfo = compressed;
            const finalUploadInfo = await this.getVideoFileInfo(uploadPath);
            uploadSize = Number(finalUploadInfo.size || uploadSize || 0);
            if (!uploadSize) {
              showToast({ title: "无法确认视频大小", icon: "none" });
              this.statusText = "无法读取最终视频大小，请换一个视频或先压缩后再上传。";
              return;
            }
            uploadInfo = {
              ...uploadInfo,
              ...finalUploadInfo,
              filePath: uploadPath,
              size: uploadSize
            };
            const confirmed = await this.confirmVideoUpload({ durationSeconds, uploadSize });
            if (!confirmed) {
              this.statusText = "";
              return;
            }
            this.statusText = "正在上传视频...";
            const sourceUrl = await uploadSessionAlbumVideo(this.sessionId, uploadPath);
            await createSessionAlbumVideo(this.sessionId, {
              sourceUrl,
              durationSeconds,
              videoWidth: uploadInfo.width || originalInfo.width || null,
              videoHeight: uploadInfo.height || originalInfo.height || null,
              videoByteSize: uploadSize,
              videoContentType: "video/mp4"
            });
            this.statusText = "";
            await this.loadAlbum();
          }
        });
      } catch (error) {
        this.statusText = error?.userMessage || "相册视频上传失败，请稍后重试。";
      }
    },
    async uploadChosenPhotos(paths) {
      if (this.albumBusy || paths.length === 0) {
        return;
      }
      this.uploading = true;
      let uploadedCount = 0;
      let skippedCount = 0;
      try {
        const phaseLabels = {
          preparing: "准备上传",
          uploading: "上传中",
          validating: "校验中",
          complete: "完成"
        };
        for (const [index, filePath] of paths.entries()) {
          const prepared = await this.preparePhotoForUpload(filePath);
          if (!prepared) {
            skippedCount += 1;
            continue;
          }
          const result = await uploadAlbumPhoto({
            sessionId: this.sessionId,
            filePath: prepared.filePath,
            fileSize: prepared.size,
            contentType: prepared.contentType,
            onPhase: ({ phase, retry }) => {
              const retryText = phase === "uploading" && retry > 0
                ? `（重试 ${retry}/2）`
                : "";
              this.statusText = `${phaseLabels[phase] || phase}${retryText} ${index + 1}/${paths.length}`;
            }
          });
          if (!result?.photo?.id) {
            throw albumMediaError(
              "UPLOAD_FINALIZE_RESPONSE_INVALID",
              "上传完成但缺少相册记录"
            );
          }
          uploadedCount += 1;
        }
        if (uploadedCount > 0) {
          this.statusText = "";
          await this.loadAlbum();
        } else if (!skippedCount) {
          this.statusText = "";
        }
      } catch (error) {
        this.statusText = error?.userMessage || error?.message || "相册照片上传失败，请稍后重试。";
      } finally {
        this.uploading = false;
      }
    },
    deletePhoto(photo) {
      if (this.timelineMode || this.albumBusy || !photo.can_delete) {
        return;
      }
      const mediaLabel = photo.media_type === "video" ? "视频" : "照片";
      showModal({
        title: `删除${mediaLabel}`,
        content: `确认删除这${mediaLabel === "视频" ? "段" : "张"}${mediaLabel}？删除后清空相册才能取消这辆车。`,
        confirmText: "删除",
        cancelText: "再想想",
        success: async (result) => {
          if (!result.confirm) {
            return;
          }
          if (this.albumBusy) {
            return;
          }
          this.deletingPhotoId = photo.id;
          this.statusText = `正在删除${mediaLabel}...`;
          try {
            await request({
              url: `/api/session-album/photos/${photo.id}`,
              method: "DELETE"
            });
            this.statusText = "";
            await this.loadAlbum();
          } catch (error) {
            this.statusText = error?.userMessage || `${mediaLabel}删除失败，请稍后重试。`;
          } finally {
            this.deletingPhotoId = null;
          }
        }
      });
    },
    previewPhoto(photo) {
      if (this.deletingPhotoId) {
        return;
      }
      if (!this.canOpenPhotoPreview(photo)) {
        if (this.timelineMode && photo?.media_type === "video") {
          showToast({ title: "打开小程序查看视频", icon: "none" });
        }
        return false;
      }
      this.openPhotoPreview(photo);
      return true;
    },
    viewerPhotoWithCachedMedia(photo) {
      if (!this.isCurrentPreviewableAlbumMedia(photo)) {
        return {
          ...photo,
          thumbnail_display_url: "",
          preview_display_url: "",
          video_display_url: "",
          video_url: "",
          cover_url: ""
        };
      }
      const visibleMedia = this.visiblePhotoMedia[String(photo.id)] || {};
      if (photo?.media_type === "video") {
        return {
          ...photo,
          thumbnail_display_url: visibleMedia.thumbnail || photo.thumbnail_display_url || photo.cover_url || "",
          preview_display_url: visibleMedia.thumbnail || photo.preview_display_url || "",
          video_display_url: visibleMedia.video || photo.video_display_url || "",
          video_load_failed: Boolean(photo.video_load_failed || visibleMedia.videoFailed)
        };
      }
      return {
        ...photo,
        thumbnail_display_url: visibleMedia.thumbnail || photo.thumbnail_display_url || "",
        preview_display_url: visibleMedia.preview || photo.preview_display_url || photo.display_url || ""
      };
    },
    ensurePreviewMediaAround(centerIndex) {
      const parsedCenter = Number(centerIndex);
      if (!Number.isFinite(parsedCenter) || !this.previewPhotos.length) {
        return;
      }
      const center = Math.min(
        Math.max(0, Math.trunc(parsedCenter)),
        this.previewPhotos.length - 1
      );
      const start = Math.max(0, center - 2);
      const end = Math.min(this.previewPhotos.length, center + 3);
      this.previewPhotos.slice(start, end).forEach((photo) => {
        if (!photo || photo.id === undefined || photo.id === null || !this.isCurrentPreviewableAlbumMedia(photo)) {
          return;
        }
        const visibleMedia = this.visiblePhotoMedia[String(photo.id)] || {};
        if (photo.media_type === "video") {
          if (!visibleMedia.thumbnail && photo.cover_url) {
            this.loadVisiblePhotoMedia(photo, "thumbnail");
          }
          return;
        }
        if (!visibleMedia.thumbnail) {
          this.loadVisiblePhotoMedia(photo, "thumbnail");
        }
        if (!visibleMedia.preview) {
          this.loadVisiblePhotoMedia(photo, "preview");
        }
      });
    },
    openPhotoPreview(photo) {
      if (!this.isCurrentPreviewableAlbumMedia(photo)) {
        return;
      }
      this.resetPreviewVideoViewerState();
      const previewPhotos = this.filteredPhotos
        .filter((item) => this.isCurrentPreviewableAlbumMedia(item))
        .map((item) => this.viewerPhotoWithCachedMedia(item))
        .filter(
        (item) =>
          (!this.timelineMode || item.media_type !== "video") &&
          (item.media_type !== "video" || this.videoReady(item))
        );
      const currentIndex = Math.max(
        0,
        previewPhotos.findIndex((item) => String(item.id) === String(photo.id))
      );
      this.previewPhotos = previewPhotos;
      this.previewCurrentIndex = currentIndex;
      this.previewInitialIndex = currentIndex;
      this.previewOverlayVisible = true;
      this.ensurePreviewMediaAround(currentIndex);
      this.prepareSingleMediaShare(this.previewCurrentPhoto);
    },
    closePhotoPreview() {
      if (this.focusedPublicMode) {
        this.showFullPublicAlbum();
        return;
      }
      this.previewOverlayVisible = false;
      this.previewPhotos = [];
      this.previewCurrentIndex = 0;
      this.previewInitialIndex = 0;
      this.previewVideoUrlRequests = {};
      this.resetSingleMediaShareState();
      this.resetPreviewVideoViewerState();
      this.skipNextAlbumRefreshOnShow = false;
    },
    resetPreviewVideoViewerState() {
      this.visiblePhotoMedia = pruneAlbumMediaPreviewCache(Object.fromEntries(
        Object.entries(this.visiblePhotoMedia || {}).map(([key, media]) => [
          key,
          {
            ...media,
            videoFailed: false,
            videoAutoRefreshUsed: false
          }
        ])
      ), this.photos, {
        viewerUserId: this.currentUserId,
        timelineMode: this.timelineMode
      });
    },
    handlePreviewChange(event) {
      const payload = event?.detail || event || {};
      const index = Number(payload.index || 0);
      this.previewCurrentIndex = index;
      this.ensurePreviewMediaAround(index);
      this.prepareSingleMediaShare(this.previewCurrentPhoto);
    },
    handlePreviewVideoRequest(event) {
      const payload = event?.detail || event || {};
      const focusedPublicVideo = this.timelineMode && this.focusedPublicMode && this.videoReady(payload.photo);
      if (!payload.photo || (!focusedPublicVideo && (this.timelineMode || !this.isCurrentPreviewableAlbumMedia(payload.photo)))) {
        return;
      }
      if (payload.retry) {
        const key = String(payload.photo.id);
        const visibleMedia = this.visiblePhotoMedia[key] || {};
        const transition = transitionAlbumVideoViewerFailure(
          {
            videoUrl: visibleMedia.video || "",
            autoRefreshUsed: Boolean(visibleMedia.videoAutoRefreshUsed),
            videoLoadFailed: Boolean(visibleMedia.videoFailed)
          },
          "retry"
        );
        this.applyPreviewVideoTransition(payload.photo, transition);
        if (transition.requestVideoUrl) {
          this.loadPreviewVideoUrl(payload.photo, { forceRefresh: true });
        }
        return;
      }
      this.loadPreviewVideoUrl(payload.photo);
    },
    handlePreviewVideoError(event) {
      const payload = event?.detail || event || {};
      const photo = payload.photo;
      const focusedPublicVideo = this.timelineMode && this.focusedPublicMode && this.videoReady(photo);
      if (!photo || (!focusedPublicVideo && (this.timelineMode || !this.isCurrentPreviewableAlbumMedia(photo)))) {
        return;
      }
      const key = String(photo.id);
      const visibleMedia = this.visiblePhotoMedia[key] || {};
      const transition = transitionAlbumVideoViewerFailure(
        {
          videoUrl: visibleMedia.video || photo.video_display_url || "",
          autoRefreshUsed: Boolean(visibleMedia.videoAutoRefreshUsed),
          videoLoadFailed: Boolean(visibleMedia.videoFailed)
        },
        "video-error"
      );
      this.applyPreviewVideoTransition(photo, transition);
      if (transition.requestVideoUrl) {
        this.loadPreviewVideoUrl(photo, { forceRefresh: true });
      }
    },
    applyPreviewVideoTransition(photo, transition) {
      this.setVisiblePhotoMedia(photo.id, {
        video: transition.videoUrl,
        videoExpiresAt: null,
        videoFailed: transition.videoLoadFailed,
        videoAutoRefreshUsed: transition.autoRefreshUsed
      });
      this.updatePreviewPhotoDisplayMedia(photo.id, {
        video_display_url: transition.videoUrl,
        video_url_expires_at: null,
        video_load_failed: transition.videoLoadFailed
      });
    },
    loadPreviewVideoUrl(photo, options = {}) {
      const focusedPublicVideo = this.timelineMode && this.focusedPublicMode;
      if (
        (!focusedPublicVideo && this.timelineMode) ||
        !photo ||
        photo.id === undefined ||
        photo.id === null ||
        !this.isCurrentPreviewableAlbumMedia(photo) ||
        !this.videoReady(photo)
      ) {
        return Promise.resolve("");
      }
      const key = String(photo.id);
      const focusedPublicVideoRequest = focusedPublicVideo
        ? createFocusedPublicVideoRequestContext({
            albumShareToken: this.albumShareToken,
            focusMediaId: this.focusMediaId,
            mediaId: photo.id,
            focusedPublicMode: this.focusedPublicMode,
            previewOverlayVisible: this.previewOverlayVisible,
            previewCurrentPhotoId: this.previewCurrentPhoto?.id
          })
        : null;
      if (focusedPublicVideo && !focusedPublicVideoRequest) {
        return Promise.resolve("");
      }
      const focusedPublicVideoRequestIsCurrent = () =>
        !focusedPublicVideo ||
        isFocusedPublicVideoRequestCurrent(focusedPublicVideoRequest, {
          albumShareToken: this.albumShareToken,
          focusMediaId: this.focusMediaId,
          mediaId: photo.id,
          focusedPublicMode: this.focusedPublicMode,
          previewOverlayVisible: this.previewOverlayVisible,
          previewCurrentPhotoId: this.previewCurrentPhoto?.id
        });
      const cachedPhoto =
        this.photos.find((item) => String(item.id) === key) ||
        this.previewPhotos.find((item) => String(item.id) === key) ||
        photo;
      const visibleMedia = this.visiblePhotoMedia[key] || {};
      const cachedUrl = visibleMedia.video || cachedPhoto.video_display_url || "";
      const cachedExpiresAt =
        visibleMedia.videoExpiresAt || cachedPhoto.video_url_expires_at || null;
      if (!options.forceRefresh && canReuseVideoUrl(cachedUrl, cachedExpiresAt)) {
        return Promise.resolve(cachedUrl);
      }
      if (cachedUrl) {
        this.setVisiblePhotoMedia(photo.id, { video: "", videoExpiresAt: null });
        this.updatePreviewPhotoDisplayMedia(photo.id, {
          video_display_url: "",
          video_url_expires_at: null
        });
      }
      if (this.previewVideoUrlRequests[key]) {
        return this.previewVideoUrlRequests[key];
      }
      this.updatePreviewPhotoDisplayMedia(photo.id, { video_load_failed: false });
      this.setVisiblePhotoMedia(photo.id, { videoFailed: false });
      const videoUrlEndpoint = `/api/session-album/media/${photo.id}/video-url`;
      const playbackVideoUrlEndpoint = focusedPublicVideo
        ? `/api/session-album/public-share/media/${photo.id}/video-url${queryString({
            token: this.albumShareToken
          })}`
        : videoUrlEndpoint;
      const loadRequest = request({ url: playbackVideoUrlEndpoint })
        .then((response) => {
          if (!this.isCurrentPreviewableAlbumMedia(photo) || !focusedPublicVideoRequestIsCurrent()) {
            return "";
          }
          const data = dataOf(response) || {};
          if (!data.url) {
            throw new Error("video url missing");
          }
          const videoUrl = this.normalizeAlbumMediaUrl(data.url);
          const expiresAt = videoUrlExpiresAt(data.expiresInSeconds, Date.now());
          if (!expiresAt) {
            throw new Error("video url expiry missing");
          }
          this.setVisiblePhotoMedia(photo.id, {
            video: videoUrl,
            videoExpiresAt: expiresAt,
            videoFailed: false
          });
          this.updatePreviewPhotoDisplayMedia(photo.id, {
            video_display_url: videoUrl,
            video_url_expires_at: expiresAt,
            video_load_failed: false
          });
          return videoUrl;
        })
        .catch(() => {
          if (!focusedPublicVideoRequestIsCurrent()) {
            return "";
          }
          this.setVisiblePhotoMedia(photo.id, { videoFailed: true });
          this.updatePreviewPhotoDisplayMedia(photo.id, { video_load_failed: true });
          return "";
        })
        .finally(() => {
          this.previewVideoUrlRequests = clearAlbumMediaRequestIfCurrent(
            this.previewVideoUrlRequests,
            key,
            loadRequest
          );
        });
      this.previewVideoUrlRequests = {
        ...this.previewVideoUrlRequests,
        [key]: loadRequest
      };
      return loadRequest;
    },
    handlePreviewDownload(event) {
      if (this.timelineMode) {
        return;
      }
      const payload = event?.detail || event || {};
      const photo = payload.photo;
      if (!photo) {
        return;
      }
      this.downloadSinglePhoto(photo);
    },
    async downloadSinglePhoto(photo) {
      if (photo?.media_type !== "image") {
        showToast({ title: "视频暂不支持下载", icon: "none" });
        return;
      }
      if (!this.isDownloadableAlbumImage(photo)) {
        return;
      }
      await this.downloadPhotos([photo], {
        confirmContent: "将保存这张照片到系统相册，是否继续？"
      });
    },
    async downloadSelectedPhotos() {
      if (this.timelineMode || this.albumBusy || this.selectionModePurpose !== "download") {
        return;
      }
      const selectedIdSet = new Set(this.selectedPhotoIds.map((photoId) => Number(photoId)));
      const photos = this.downloadablePhotos.filter(
        (photo) => selectedIdSet.has(Number(photo.id))
      );
      await this.downloadPhotos(photos, {
        exitSelection: true,
        confirmContent: `将保存所选 ${photos.length} 张照片到系统相册，是否继续？`
      });
    },
    async downloadAllPhotos() {
      if (this.timelineMode || this.albumBusy) {
        return;
      }
      await this.downloadPhotos(this.downloadablePhotos, {
        exitSelection: this.selectionMode && this.selectionModePurpose === "download",
        confirmContent: `将保存我的相册中 ${this.downloadablePhotos.length} 张照片到系统相册，是否继续？`
      });
    },
    confirmDownloadPhotos(content) {
      return new Promise((resolve) => {
        showModal({
          title: "确认下载",
          content,
          confirmText: "下载",
          cancelText: "取消",
          success(result) {
            resolve(Boolean(result.confirm));
          },
          fail() {
            resolve(false);
          }
        });
      });
    },
    async downloadPhotos(photos, options = {}) {
      if (this.timelineMode || this.albumBusy) {
        return;
      }
      const targets = (photos || []).filter(
        (photo) =>
          this.isCurrentPublishedAlbumMedia(photo) &&
          isApprovedAlbumImageDownloadCandidate(photo, this.mediaUrlForPhoto(photo, "download"))
      );
      if (targets.length === 0) {
        showToast({ title: "暂无可下载照片", icon: "none" });
        return;
      }
      const confirmed = await this.confirmDownloadPhotos(
        options.confirmContent || `将保存 ${targets.length} 张照片到系统相册，是否继续？`
      );
      if (!confirmed) {
        if (options.exitSelection) {
          this.cancelSelectionMode({ force: true });
        }
        return;
      }
      if (this.albumBusy) {
        return;
      }
      this.downloading = true;
      let savedCount = 0;
      let failedCount = 0;
      try {
        const allowed = await this.ensurePhotosAlbumPermission();
        if (!allowed) {
          this.statusText = "未获得相册保存权限。";
          showToast({ title: "未获得保存权限", icon: "none" });
          return;
        }
        for (const [index, photo] of targets.entries()) {
          this.downloadProgressText = `正在保存 ${index + 1}/${photos.length} 张照片...`;
          try {
            if (!this.isCurrentPublishedAlbumMedia(photo)) {
              throw albumMediaError("MEDIA_NOT_PUBLISHED", contentModerationStatusText("review"));
            }
            const cachedPreview = this.visiblePhotoMedia[photo.id]?.preview || photo.display_url;
            const filePath = cachedPreview || (await this.downloadAlbumImage(photo, "download"));
            if (!filePath || !this.isCurrentPublishedAlbumMedia(photo)) {
              throw new Error("album photo unavailable");
            }
            await this.saveAlbumImageToPhotosAlbum(filePath);
            savedCount += 1;
          } catch (error) {
            failedCount += 1;
          }
        }
        this.statusText = "";
        if (options.exitSelection) {
          this.cancelSelectionMode({ force: true });
        }
        if (savedCount > 0 && failedCount === 0) {
          showToast({ title: `已保存 ${savedCount} 张`, icon: "none" });
          return;
        }
        if (savedCount > 0) {
          showToast({ title: "部分照片保存失败", icon: "none" });
          return;
        }
        showToast({ title: "下载照片失败", icon: "none" });
      } finally {
        this.downloading = false;
        this.downloadProgressText = "";
      }
    },
    goPrivacy() {
      if (this.timelineMode || this.albumBusy) {
        return;
      }
      uni.navigateTo({ url: `/pages/session/albumPrivacy?id=${this.sessionId}` });
    },
    openTagSheet(photo) {
      if (this.timelineMode || this.albumBusy || !photo.can_tag) {
        return;
      }
      this.tagSheetPhoto = photo;
      this.selectedTagKeys = (photo.tags || []).map((tag) => tag.key);
    },
    openDownloadSelectionMode() {
      if (this.timelineMode || this.albumBusy) {
        return;
      }
      if (this.downloadablePhotos.length === 0) {
        showToast({ title: "暂无可下载照片", icon: "none" });
        return;
      }
      this.closePhotoPreview();
      this.tagSheetPhoto = null;
      this.bulkTagging = false;
      this.selectedTagKeys = [];
      this.selectionMode = true;
      this.selectionModePurpose = "download";
      this.selectedPhotoIds = [];
      this.topActionsFloating = false;
    },
    openShareSelectionMode() {
      if (this.timelineMode || this.albumBusy) {
        return;
      }
      if (this.shareSelectableMedia.length === 0) {
        showToast({ title: "暂无可分享内容", icon: "none" });
        return;
      }
      this.closePhotoPreview();
      this.tagSheetPhoto = null;
      this.bulkTagging = false;
      this.selectedTagKeys = [];
      this.selectionMode = true;
      this.selectionModePurpose = "share";
      this.selectedPhotoIds = [];
      this.topActionsFloating = false;
    },
    openTagSelectionMode() {
      if (this.timelineMode || this.albumBusy) {
        return;
      }
      if (this.taggablePhotos.length === 0) {
        showToast({ title: "暂无可标注照片", icon: "none" });
        return;
      }
      this.closePhotoPreview();
      this.tagSheetPhoto = null;
      this.bulkTagging = false;
      this.selectedTagKeys = [];
      this.selectionMode = true;
      this.selectionModePurpose = "tag";
      this.selectedPhotoIds = [];
      this.topActionsFloating = false;
    },
    beginRecruitInviteRequest() {
      const authorityRequest = this.recruitInviteAuthority.begin({
        sessionId: this.sessionId,
        userId: this.currentUserId,
        mediaVersion: this.mediaLoadSerial
      });
      if (!authorityRequest) {
        return null;
      }
      return {
        authorityRequest,
        sessionId: String(this.sessionId || ""),
        userId: String(this.currentUserId || ""),
        generation: this.recruitInviteGeneration
      };
    },
    isCurrentRecruitInviteRequest(requestContext) {
      return Boolean(
        requestContext &&
          !this.timelineMode &&
          requestContext.sessionId === String(this.sessionId || "") &&
          requestContext.userId === String(this.currentUserId || "") &&
          requestContext.generation === this.recruitInviteGeneration &&
          this.recruitInviteAuthority.isCurrent(requestContext.authorityRequest)
      );
    },
    invalidateRecruitInviteShare() {
      this.recruitInviteGeneration += 1;
      this.recruitInviteToken = "";
      this.recruitInvitePromise = null;
      this.recruitInviteAuthority.invalidate();
    },
    prepareRecruitInvite() {
      if (
        this.timelineMode ||
        !this.sessionId ||
        !this.currentUserId
      ) {
        return Promise.resolve("");
      }
      const requestContext = this.beginRecruitInviteRequest();
      if (!requestContext) {
        return Promise.resolve("");
      }
      if (this.recruitInviteToken) {
        return Promise.resolve(this.recruitInviteToken);
      }
      if (this.recruitInvitePromise) {
        return this.recruitInvitePromise;
      }

      let requestPromise;
      requestPromise = request({
        url: `/api/sessions/${this.sessionId}/join-invite-token`,
        method: "POST",
        data: {}
      })
        .then((response) => {
          if (!this.isCurrentRecruitInviteRequest(requestContext)) {
            return "";
          }
          const token = typeof dataOf(response)?.token === "string"
            ? dataOf(response).token.trim()
            : "";
          this.recruitInviteToken = token;
          return token;
        })
        .catch(() => {
          if (this.isCurrentRecruitInviteRequest(requestContext)) {
            this.recruitInviteToken = "";
          }
          return "";
        })
        .finally(() => {
          if (
            this.isCurrentRecruitInviteRequest(requestContext) &&
            this.recruitInvitePromise === requestPromise
          ) {
            this.recruitInvitePromise = null;
          }
        });
      this.recruitInvitePromise = requestPromise;
      return requestPromise;
    },
    beginDefaultAlbumShareRequest() {
      const authorityRequest = this.defaultAlbumShareAuthority.begin({
        sessionId: this.sessionId,
        userId: this.currentUserId,
        mediaVersion: this.mediaLoadSerial
      });
      if (!authorityRequest) return null;
      return {
        authorityRequest,
        sessionId: String(this.sessionId || ""),
        userId: String(this.currentUserId || ""),
        generation: this.defaultAlbumShareGeneration
      };
    },
    isCurrentDefaultAlbumShareRequest(requestContext) {
      return Boolean(
        requestContext &&
          !this.timelineMode &&
          requestContext.sessionId === String(this.sessionId || "") &&
          requestContext.userId === String(this.currentUserId || "") &&
          requestContext.generation === this.defaultAlbumShareGeneration &&
          this.defaultAlbumShareAuthority.isCurrent(requestContext.authorityRequest)
      );
    },
    clearDefaultAlbumShareState({ hideMenus = false } = {}) {
      this.defaultAlbumShareToken = "";
      this.defaultAlbumShareTimelineCoverUrl = "";
      this.defaultAlbumShareTimelineCoverPrepared = false;
      this.defaultAlbumShareSubject = null;
      this.defaultAlbumShareCounts = { total: 0, photos: 0, videos: 0 };
      this.defaultAlbumSharePromise = null;
      this.defaultAlbumShareKey = "";
      if (hideMenus) this.showShareMenus();
    },
    invalidateDefaultAlbumShare({ hideMenus = false } = {}) {
      this.defaultAlbumShareGeneration += 1;
      this.defaultAlbumShareAuthority.invalidate();
      this.clearDefaultAlbumShareState({ hideMenus });
    },
    primeAlbumShareEntries() {
      if (this.timelineMode || !this.sessionId || !this.currentUserId) {
        return;
      }
      this.prepareRecruitInvite();
      if (this.shareSelectableMedia.length === 0) {
        this.invalidateDefaultAlbumShare({ hideMenus: true });
        return;
      }
      this.prepareDefaultAlbumShare();
    },
    prepareDefaultAlbumShare() {
      if (
        this.timelineMode ||
        !this.sessionId ||
        !this.currentUserId ||
        this.shareSelectableMedia.length === 0
      ) {
        return Promise.resolve("");
      }
      const requestContext = this.beginDefaultAlbumShareRequest();
      if (!requestContext) return Promise.resolve("");
      const requestKey = requestContext.authorityRequest.key;
      if (this.defaultAlbumShareKey === requestKey) {
        if (this.defaultAlbumShareToken) return Promise.resolve(this.defaultAlbumShareToken);
        if (this.defaultAlbumSharePromise) return this.defaultAlbumSharePromise;
      }

      this.clearDefaultAlbumShareState();
      this.defaultAlbumShareGeneration += 1;
      requestContext.generation = this.defaultAlbumShareGeneration;
      this.defaultAlbumShareKey = requestKey;

      let requestPromise;
      requestPromise = request({
        url: `/api/sessions/${this.sessionId}/album/share-token`,
        method: "POST",
        data: { scope: "all" }
      })
        .then(async (response) => {
          if (!this.isCurrentDefaultAlbumShareRequest(requestContext)) return "";
          const data = dataOf(response) || {};
          const token = typeof data.token === "string" ? data.token.trim() : "";
          if (!token) return "";
          this.installDefaultAlbumShareSnapshot(data, token);
          this.applyDefaultAlbumShareTimelineImage(
            this.selectAlbumShareTimelineImage(data)
          );
          this.showShareMenus();
          return token;
        })
        .catch(() => {
          if (this.isCurrentDefaultAlbumShareRequest(requestContext)) {
            this.clearDefaultAlbumShareState({ hideMenus: true });
          }
          return "";
        })
        .finally(() => {
          if (
            this.isCurrentDefaultAlbumShareRequest(requestContext) &&
            this.defaultAlbumSharePromise === requestPromise
          ) {
            this.defaultAlbumSharePromise = null;
          }
        });
      this.defaultAlbumSharePromise = requestPromise;
      return requestPromise;
    },
    handleRecruitShareTap() {
      if (this.timelineMode || !this.sessionId || this.recruitInviteToken) {
        return;
      }
      this.prepareRecruitInvite();
      showToast({ title: "正在准备招募分享，请稍后再点", icon: "none" });
    },
    toggleSelectionMode() {
      if (this.timelineMode || this.albumBusy) {
        return;
      }
      if (!this.selectionMode) {
        this.openTagSelectionMode();
        return;
      }
      this.cancelSelectionMode();
    },
    cancelSelectionMode({ force = false, preserveActiveShare = false } = {}) {
      if (this.timelineMode || (!force && this.albumBusy)) {
        return;
      }
      this.selectionMode = false;
      this.selectionModePurpose = "tag";
      this.selectedPhotoIds = [];
      this.tagSheetPhoto = null;
      this.selectedTagKeys = [];
      this.bulkTagging = false;
      this.updateTopActionsFloating();
      if (!preserveActiveShare) {
        this.clearActiveAlbumShareState({ hideMenus: true });
      }
    },
    canSelectPhoto(photo) {
      if (!this.selectionMode) {
        return false;
      }
      if (this.selectionModePurpose === "download") {
        return this.isDownloadableAlbumImage(photo);
      }
      if (this.selectionModePurpose === "share") {
        return this.shareSelectableMedia.some((item) => Number(item.id) === Number(photo?.id));
      }
      return Boolean(photo.can_tag);
    },
    isPhotoSelected(photo) {
      return this.selectedPhotoIds.includes(Number(photo.id));
    },
    togglePhotoSelection(photo) {
      if (this.timelineMode || !this.selectionMode || this.albumBusy || !this.canSelectPhoto(photo)) {
        return;
      }
      const photoId = Number(photo.id);
      if (this.selectedPhotoIds.includes(photoId)) {
        this.selectedPhotoIds = this.selectedPhotoIds.filter((id) => id !== photoId);
        return;
      }
      this.selectedPhotoIds = [...this.selectedPhotoIds, photoId];
    },
    async shareAllAlbumMedia() {
      if (this.timelineMode || this.albumBusy || this.selectionModePurpose !== "share") {
        return;
      }
      await this.prepareAlbumShareSnapshot({ scope: "all" });
    },
    async shareSelectedAlbumMedia() {
      if (
        this.timelineMode ||
        this.albumBusy ||
        this.selectionModePurpose !== "share" ||
        this.selectedPhotoCount === 0
      ) {
        return;
      }
      const mediaIds = [...this.selectedPhotoIds];
      await this.prepareAlbumShareSnapshot({ mediaIds });
    },
    async prepareAlbumShareSnapshot(payload) {
      if (this.timelineMode || this.albumBusy || !this.sessionId) {
        return;
      }
      const shareRequest = this.beginAlbumShareSnapshotRequest();
      this.albumSharePreparing = true;
      this.statusText = "正在准备分享...";
      this.clearActiveAlbumShareState({ hideMenus: true, invalidateRequest: false });
      try {
        const response = await request({
          url: `/api/sessions/${this.sessionId}/album/share-token`,
          method: "POST",
          data: payload
        });
        if (!this.isCurrentAlbumShareSnapshotRequest(shareRequest)) {
          return;
        }
        const data = dataOf(response) || {};
        const token = typeof data.token === "string" ? data.token.trim() : "";
        if (!token) {
          throw albumMediaError("ALBUM_PUBLIC_SHARE_RESPONSE_INVALID", "分享准备失败，请稍后重试。");
        }
        this.installActiveAlbumShareSnapshot(data, {
          token,
          scope: payload.scope === "all" ? "all" : "selected"
        });
        this.applyActiveAlbumShareTimelineImage(
          this.selectAlbumShareTimelineImage(data)
        );
        this.cancelSelectionMode({ force: true, preserveActiveShare: true });
        this.showShareMenus();
        if (!this.isCurrentAlbumShareSnapshotRequest(shareRequest)) {
          return;
        }
        this.statusText = "";
      } catch (error) {
        if (!this.isCurrentAlbumShareSnapshotRequest(shareRequest)) {
          return;
        }
        this.clearActiveAlbumShareState({ hideMenus: true, invalidateRequest: false });
        this.statusText = "";
        showToast({ title: error?.userMessage || "分享准备失败，请稍后重试", icon: "none" });
      } finally {
        if (this.isCurrentAlbumShareSnapshotRequest(shareRequest)) {
          this.albumSharePreparing = false;
        }
      }
    },
    openBulkTagSheet() {
      if (
        this.timelineMode ||
        this.albumBusy ||
        this.selectionModePurpose !== "tag" ||
        this.selectedTaggablePhotoIds.length === 0
      ) {
        return;
      }
      this.bulkTagging = true;
      this.tagSheetPhoto = { id: null };
      this.selectedTagKeys = [];
    },
    closeTagSheet(options = {}) {
      if (this.savingTags && !options.force) {
        return;
      }
      this.tagSheetPhoto = null;
      this.selectedTagKeys = [];
      this.bulkTagging = false;
    },
    handleTagSheetPopupVisibleChange(event = {}) {
      if (event.detail?.visible === false) {
        this.closeTagSheet();
      }
    },
    togglePerson(key) {
      if (this.selectedTagKeys.includes(key)) {
        this.selectedTagKeys = this.selectedTagKeys.filter((item) => item !== key);
        return;
      }
      this.selectedTagKeys = [...this.selectedTagKeys, key];
    },
    async saveTags() {
      if (this.timelineMode || !this.tagSheetPhoto || this.albumBusy) {
        return;
      }
      const targetPhotoIds = this.bulkTagging
        ? [...this.selectedTaggablePhotoIds]
        : [Number(this.tagSheetPhoto.id)];
      if (targetPhotoIds.length === 0) {
        return;
      }
      this.savingTags = true;
      let failedCount = 0;
      try {
        for (const photoId of targetPhotoIds) {
          try {
            await request({
              url: `/api/session-album/photos/${photoId}/tags`,
              method: "PUT",
              data: { tagKeys: this.selectedTagKeys }
            });
          } catch (error) {
            failedCount += 1;
          }
        }
        const allFailed = failedCount === targetPhotoIds.length;
        this.closeTagSheet({ force: true });
        this.cancelSelectionMode({ force: true });
        await this.loadAlbum();
        if (allFailed) {
          showToast({ title: "标注保存失败", icon: "none" });
          return;
        }
        if (failedCount > 0) {
          showToast({ title: "部分照片标注失败", icon: "none" });
        }
      } finally {
        this.savingTags = false;
      }
    }
  }
};
</script>

<style scoped>

.preview-untagged-share-note {
  position: fixed;
  top: 116rpx;
  left: 50%;
  z-index: 10020;
  max-width: 560rpx;
  padding: 12rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(22, 28, 26, 0.82);
  color: #ffffff;
  font-size: 22rpx;
  line-height: 1.4;
  text-align: center;
  transform: translateX(-50%);
}

.album-page {
  overflow-x: hidden;
  box-sizing: border-box;
}

.album-head {
  padding: 30rpx 32rpx 28rpx;
  border-color: rgba(222, 215, 202, 0.74);
  border-radius: 20rpx;
  background: rgba(255, 255, 252, 0.96);
  box-shadow: 0 14rpx 36rpx rgba(42, 58, 49, 0.05);
}

.public-share-head {
  padding: 28rpx 30rpx;
  border: 1rpx solid rgba(222, 215, 202, 0.76);
  border-radius: 20rpx;
  background: rgba(255, 255, 252, 0.97);
}

.public-share-owner {
  display: flex;
  align-items: center;
  gap: 18rpx;
}

.public-share-avatar {
  flex: 0 0 72rpx;
  width: 72rpx;
  height: 72rpx;
  overflow: hidden;
  border-radius: 50%;
  background: #eef2ee;
}

.public-share-owner-copy {
  flex: 1;
  min-width: 0;
}

.public-share-owner-name {
  color: #153f34;
  font-size: 27rpx;
  font-weight: 650;
}

.public-share-role {
  margin-top: 5rpx;
  color: #718078;
  font-size: 22rpx;
}

.public-share-script {
  margin-top: 24rpx;
  color: #142f29;
  font-family: STKaiti, KaiTi, serif;
  font-size: 38rpx;
  font-weight: 700;
}

.public-share-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx 18rpx;
  margin-top: 12rpx;
  color: #7a857d;
  font-size: 22rpx;
}

.public-share-intro {
  margin-top: 18rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid #eee9df;
  color: #8d7b55;
  font-size: 22rpx;
  line-height: 1.45;
}

.notice {
  margin-top: 14rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  background: #eef7f4;
  color: #1f7a68;
  font-size: 24rpx;
  line-height: 1.5;
}

.album-notice {
  margin-top: 18rpx;
  padding: 14rpx 16rpx;
  border-radius: 10rpx;
  font-size: 23rpx;
}

.album-privacy-note {
  margin-top: 14rpx;
  color: #9b8d70;
  font-size: 22rpx;
  line-height: 1.4;
}

.album-actions-shell {
  margin: 0 0 20rpx;
}

.album-actions-shell.floating {
  min-height: 430rpx;
}

.album-actions {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 14rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.9);
  border-radius: 14rpx;
  background: rgba(255, 255, 252, 0.98);
  box-shadow: 0 12rpx 28rpx rgba(32, 44, 38, 0.12);
  box-sizing: border-box;
}

.album-sticky-actions.floating {
  position: fixed;
  top: 0;
  right: 20rpx;
  left: 20rpx;
  z-index: 900;
  max-height: 64vh;
  overflow-y: auto;
}

.album-primary-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 78rpx;
  gap: 12rpx;
}

.album-action-primary,
.album-privacy-action {
  height: 78rpx;
  margin: 0;
  border-radius: 12rpx;
  font-size: 26rpx;
}

.album-action-primary {
  background: #1f6f5b;
  color: #ffffff;
  box-shadow: 0 12rpx 24rpx rgba(31, 111, 91, 0.18);
}

.album-upload-button-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  width: 100%;
  min-width: 0;
}

.album-upload-label {
  min-width: 0;
  overflow: hidden;
  color: #ffffff;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.album-upload-icon {
  width: 48rpx;
  height: 48rpx;
  flex-shrink: 0;
}

.album-privacy-action {
  width: 78rpx;
  min-width: 78rpx;
  height: 78rpx;
  padding: 0;
}

.album-privacy-button-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  width: 100%;
  min-width: 0;
}

.album-privacy-icon {
  width: 36rpx;
  height: 36rpx;
  flex-shrink: 0;
}

.album-action-groups {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8rpx;
  min-width: 0;
  min-height: 52rpx;
}

.album-command {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
  height: 52rpx;
  min-height: 52rpx;
  margin: 0;
  padding: 0 10rpx;
  border: 1rpx solid rgba(210, 199, 181, 0.96);
  border-radius: 10rpx;
  background: rgba(255, 255, 255, 0.72);
  color: #253f3b;
  font-size: 23rpx;
  font-weight: 600;
  line-height: 52rpx;
  box-shadow: none;
}

.album-command::after {
  border: 0;
}

.album-command + .album-command {
  border-radius: 10rpx;
}

.album-command[disabled] {
  color: #9aa39c;
}

.album-command-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.album-command-icon {
  width: 30rpx;
  height: 30rpx;
  flex-shrink: 0;
}

.album-command-label {
  flex: 0 0 auto;
  color: inherit;
  white-space: nowrap;
}

.album-tag-command {
  grid-column: 4;
  border-color: #1f6f5b;
  background: #1f6f5b;
  color: #ffffff;
  font-weight: 700;
}

.album-tag-command-icon {
  opacity: 0.96;
}

.album-filter-panel {
  margin-bottom: 20rpx;
  padding: 18rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.82);
  border-radius: 12rpx;
  background: rgba(255, 255, 252, 0.8);
}

.album-toolbar-filter-panel {
  margin: 2rpx 0 0;
  padding: 14rpx 0 0;
  border: 0;
  border-top: 1rpx solid rgba(223, 216, 204, 0.9);
  border-radius: 0;
  background: transparent;
}

.filter-row {
  display: block;
  width: 100%;
  min-width: 0;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  margin: 0;
  padding: 10rpx 18rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.92);
  border-radius: 8rpx;
  background: rgba(255, 255, 252, 0.96);
  color: #607068;
  font-size: 23rpx;
  line-height: 1.2;
}

.filter-chip.active {
  border-color: #1f6f5b;
  background: #eef5ef;
  color: #1f6f5b;
  font-weight: 600;
}

.filter-count {
  color: inherit;
  font-size: 20rpx;
  opacity: 0.74;
}

.role-filter-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 16rpx;
}

.role-filter-label {
  flex-shrink: 0;
  color: #607068;
  font-size: 23rpx;
}

.role-filter-row picker {
  flex: 1;
  min-width: 0;
}

.role-filter-picker {
  overflow: hidden;
  padding: 14rpx 18rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.92);
  border-radius: 8rpx;
  background: rgba(255, 255, 252, 0.96);
  color: #153f34;
  font-size: 24rpx;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-filter-picker.disabled {
  color: #9aa39c;
  background: #f7f4ee;
}

.photo-waterfall {
  display: flex;
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
  box-sizing: border-box;
  align-items: flex-start;
}

.public-share-page-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  padding: 28rpx 32rpx 40rpx;
  color: #7b7f82;
  font-size: 26rpx;
}

.public-share-page-status.error {
  color: #a35e4d;
}

.waterfall-column {
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  min-width: 0;
  box-sizing: border-box;
}

.waterfall-photo-card {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.photo-card {
  overflow: hidden;
  min-width: 0;
  margin-bottom: 14rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.88);
  border-radius: 10rpx;
  background: rgba(255, 255, 252, 0.96);
}

.photo-card.selectable {
  border-color: rgba(31, 111, 91, 0.45);
}

.photo-card.selected {
  border-color: #1f6f5b;
  box-shadow: 0 0 0 3rpx rgba(31, 111, 91, 0.12);
}

.photo-card.disabled {
  opacity: 0.62;
}

.photo-image-shell {
  position: relative;
  overflow: hidden;
  width: 100%;
  background: #eef5ef;
}

.photo-image-shell.video {
  background: #15201d;
}

.photo-image-shell.failed {
  background: #3b2424;
}

.photo-image {
  display: block;
  width: 100%;
  height: 100%;
}

.photo-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(145deg, #eef5ef 0%, #f7f4ee 100%);
}

.photo-loading-dot {
  width: 34rpx;
  height: 34rpx;
  border: 4rpx solid rgba(31, 122, 104, 0.18);
  border-top-color: rgba(31, 122, 104, 0.72);
  border-radius: 999rpx;
  animation: album-spin 0.9s linear infinite;
}

.video-placeholder {
  background: linear-gradient(145deg, #1f2c29 0%, #28352f 100%);
}

.video-placeholder-copy {
  max-width: 82%;
  color: #ffffff;
  font-size: 25rpx;
  font-weight: 700;
  line-height: 1.45;
  text-align: center;
}

.moderation-placeholder-copy {
  max-width: 82%;
  color: #7b5d2e;
  font-size: 25rpx;
  font-weight: 700;
  line-height: 1.45;
  text-align: center;
}

.video-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.video-play-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 76rpx;
  height: 76rpx;
  border: 3rpx solid rgba(255, 255, 255, 0.92);
  border-radius: 999rpx;
  background: rgba(15, 23, 42, 0.42);
  color: #ffffff;
  font-size: 34rpx;
  line-height: 76rpx;
}

.video-state-badge {
  position: absolute;
  right: 12rpx;
  bottom: 12rpx;
  max-width: calc(100% - 24rpx);
  border-radius: 8rpx;
  background: rgba(15, 23, 42, 0.68);
  color: #ffffff;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 1.35;
  padding: 6rpx 10rpx;
  text-align: center;
  white-space: normal;
}

.selection-checkbox {
  position: absolute;
  top: 12rpx;
  right: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52rpx;
  height: 52rpx;
  border-radius: 10rpx;
  background: rgba(15, 23, 42, 0.32);
}

.selection-checkbox-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34rpx;
  height: 34rpx;
  border: 3rpx solid rgba(255, 255, 255, 0.96);
  border-radius: 7rpx;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 26rpx;
  font-weight: 700;
  line-height: 34rpx;
}

.selection-checkbox.selected {
  background: #1f6f5b;
}

.selection-checkbox.selected .selection-checkbox-box {
  border-color: #ffffff;
  background: #1f6f5b;
}

.selection-checkbox.disabled {
  background: rgba(148, 163, 184, 0.64);
}

.selection-checkbox.disabled .selection-checkbox-box {
  background: rgba(255, 255, 255, 0.1);
}

.photo-meta {
  padding: 14rpx 14rpx 12rpx;
}

@keyframes album-spin {
  to {
    transform: rotate(360deg);
  }
}

.photo-caption-body {
  min-width: 0;
}

.photo-caption-title {
  overflow: hidden;
  color: #163f35;
  font-size: 23rpx;
  font-weight: 700;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.photo-caption-title.pending {
  color: #9c7440;
}

.photo-moderation-status {
  color: #8a5a23;
  font-size: 23rpx;
  font-weight: 700;
  line-height: 1.5;
  white-space: normal;
  word-break: break-all;
}

.photo-actions-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  column-gap: 12rpx;
  margin-top: 10rpx;
}

.photo-actions-row.has-danger {
  grid-template-columns: auto minmax(0, 1fr) 64rpx;
  column-gap: 12rpx;
}

.photo-status-slot {
  display: flex;
  align-items: center;
  min-width: 54rpx;
}

.photo-source-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5rpx;
  width: 54rpx;
  height: 40rpx;
  border-radius: 999rpx;
  background: rgba(31, 122, 104, 0.09);
  color: #1f7a68;
}

.photo-source-icon {
  width: 20rpx;
  height: 20rpx;
}

.photo-source-label {
  color: #1f7a68;
  font-size: 19rpx;
  font-weight: 600;
  line-height: 1;
}

.photo-safe-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12rpx;
  min-width: 0;
}

.photo-action-text {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 50rpx;
  height: 42rpx;
  margin: 0;
  padding: 0 6rpx;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #2c7f6e;
  font-size: 20rpx;
  font-weight: 600;
  line-height: 1.2;
  box-shadow: none;
}

.photo-action-text::after {
  border: 0;
}

.photo-action-text.primary {
  color: #0f5f50;
}

.photo-action-text.danger {
  width: 64rpx;
  padding: 0;
  color: #c44a42;
  font-weight: 600;
}

.photo-action-text[disabled] {
  color: #9aa39c;
}

.empty-section {
  text-align: center;
}

.empty-title {
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
}

.empty-text {
  margin-top: 12rpx;
  color: #7a857d;
  font-size: 25rpx;
  line-height: 1.5;
}

.empty-upload-button {
  width: 520rpx;
  max-width: 88vw;
  margin: 22rpx auto 0;
}

.album-page.selection-active {
  padding-bottom: 224rpx;
}

.album-floating-toolbar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 12000;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  min-height: 172rpx;
  padding: 14rpx 20rpx 16rpx;
  padding-bottom: env(safe-area-inset-bottom);
  border-top: 1rpx solid #dfd8cc;
  border-radius: 16rpx 16rpx 0 0;
  background-color: #fffefc;
  box-shadow: 0 -12rpx 30rpx rgba(15, 23, 42, 0.12);
  box-sizing: border-box;
}

.floating-toolbar-button {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
  height: 76rpx;
  border-radius: 12rpx;
  background-color: #1f6f5b;
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 500;
  line-height: 1.2;
  text-align: center;
  box-sizing: border-box;
}

.floating-toolbar-button.secondary {
  border: 1rpx solid rgba(31, 111, 91, 0.34);
  background-color: #eef7f4;
  color: #1f6f5b;
  --td-button-default-bg-color: #eef7f4;
  --td-button-default-color: #1f6f5b;
  --td-button-default-border-color: rgba(31, 111, 91, 0.34);
}

.floating-toolbar-button.disabled {
  background-color: #d7dbd6;
  color: #7a857d;
  opacity: 1;
}

.bulk-count {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex: 1;
  min-width: 0;
  height: 48rpx;
  color: #334155;
  font-size: 25rpx;
  line-height: 1.2;
  text-align: center;
}

.album-toolbar-state,
.album-toolbar-business {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
}

.album-toolbar-state {
  gap: 16rpx;
}

.album-toolbar-business {
  gap: 12rpx;
}

.floating-toolbar-cancel {
  flex: 0 0 auto;
  padding: 8rpx 4rpx;
  color: #1f6f5b;
  font-size: 25rpx;
  line-height: 1.2;
}

.floating-toolbar-cancel.disabled {
  color: #9aa39c;
}

.album-share-ready-layer {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 12000;
  padding: 28rpx 30rpx calc(28rpx + env(safe-area-inset-bottom));
  border-top: 1rpx solid #dfd8cc;
  border-radius: 20rpx 20rpx 0 0;
  background: #fffefc;
  box-shadow: 0 -12rpx 30rpx rgba(15, 23, 42, 0.12);
  text-align: center;
  box-sizing: border-box;
}

.album-share-ready-title {
  color: #153f34;
  font-size: 32rpx;
  font-weight: 700;
}

.album-share-ready-count,
.album-share-ready-hint {
  margin-top: 10rpx;
  color: #718078;
  font-size: 24rpx;
  line-height: 1.45;
}

.album-share-ready-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 80rpx;
  padding: 0;
  margin-top: 24rpx;
  border-color: #1f6f5b;
  border-radius: 12rpx;
  background: #1f6f5b;
  color: #ffffff;
  font-size: 27rpx;
  font-weight: 700;
  line-height: 80rpx;
  box-sizing: border-box;
}

.album-share-ready-button::after {
  border: 0;
}

.album-share-ready-close {
  margin-top: 22rpx;
  color: #6f7d74;
  font-size: 24rpx;
}

.tag-mask {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: flex-end;
  background: rgba(15, 23, 42, 0.34);
}

.tag-sheet {
  width: 100%;
  max-height: 78vh;
  overflow-y: auto;
  padding: 18rpx 30rpx 38rpx;
  border-radius: 24rpx 24rpx 0 0;
  background: #fffefb;
  box-sizing: border-box;
}

.sheet-bar {
  width: 72rpx;
  height: 8rpx;
  margin: 0 auto 24rpx;
  border-radius: 999rpx;
  background: #ded8ca;
}

.sheet-title {
  color: #153f34;
  font-size: 32rpx;
  font-weight: 600;
}

.sheet-note,
.privacy-impact,
.selected-empty {
  margin-top: 8rpx;
  color: #7a857d;
  font-size: 24rpx;
  line-height: 1.45;
}

.selected-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  min-height: 54rpx;
  margin-top: 20rpx;
}

.selected-chip {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  padding: 9rpx 14rpx;
  border-radius: 8rpx;
  background: #eef5ef;
  color: #1f6f5b;
  font-size: 23rpx;
}

.npc-gender-mark {
  padding: 1rpx 8rpx;
  border-radius: 999rpx;
  background: #ecefec;
  color: #747b74;
  font-size: 20rpx;
  font-weight: 700;
  line-height: 1.35;
}

.npc-gender-mark.male {
  background: #e5f1ee;
  color: #316f62;
}

.npc-gender-mark.female {
  background: #fae7ef;
  color: #b34c75;
}

.privacy-impact {
  margin-top: 24rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  background: #f7f4ee;
  color: #8d7b55;
}

.sheet-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14rpx;
  margin-top: 24rpx;
}
</style>
