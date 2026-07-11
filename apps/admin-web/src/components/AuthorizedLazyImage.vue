<template>
  <div ref="root" class="authorized-lazy-image" :style="ratioStyle">
    <img v-if="objectUrl" :src="objectUrl" :alt="alt" @load="emit('loaded')" />
    <span v-else-if="failed" class="lazy-image-state">加载失败</span>
    <span v-else class="lazy-image-state loading"></span>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { fetchAuthorizedMediaObjectUrl } from "../api";
import { shouldReloadAuthorizedImage } from "../albumMedia";

const props = defineProps({
  src: { type: String, default: "" },
  mediaKey: { type: [String, Number], default: "" },
  alt: { type: String, default: "" },
  ratio: { type: Number, default: 1 }
});

const emit = defineEmits(["loaded", "error"]);

const root = ref(null);
const objectUrl = ref("");
const failed = ref(false);
const loading = ref(false);
let observer = null;
let sourceSerial = 0;

const ratioStyle = computed(() => ({
  aspectRatio: Number.isFinite(props.ratio) && props.ratio > 0 ? String(props.ratio) : "1"
}));

function revokeObjectUrl() {
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value);
    objectUrl.value = "";
  }
}

function disconnectObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

async function loadImage() {
  const source = props.src;
  if (!source || loading.value || objectUrl.value) {
    return;
  }
  const requestId = ++sourceSerial;
  loading.value = true;
  failed.value = false;
  try {
    const nextObjectUrl = await fetchAuthorizedMediaObjectUrl(source);
    if (requestId !== sourceSerial || source !== props.src) {
      URL.revokeObjectURL(nextObjectUrl);
      return;
    }
    objectUrl.value = nextObjectUrl;
  } catch (error) {
    if (requestId !== sourceSerial || source !== props.src) {
      return;
    }
    failed.value = true;
    emit("error", {
      status: Number(error?.status || 0),
      code: error?.code || "",
      message: error?.message || "",
      requestId: error?.requestId || error?.details?.requestId || "",
      src: source
    });
  } finally {
    if (requestId === sourceSerial) {
      loading.value = false;
    }
  }
}

function observeImage() {
  disconnectObserver();
  if (!props.src) {
    return;
  }
  if (typeof IntersectionObserver === "undefined" || !root.value) {
    loadImage();
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        disconnectObserver();
        loadImage();
      }
    },
    { rootMargin: "360px 0px" }
  );
  observer.observe(root.value);
}

watch(
  () => [props.mediaKey, props.src],
  ([nextKey], [previousKey]) => {
    sourceSerial += 1;
    loading.value = false;
    if (nextKey !== previousKey) {
      revokeObjectUrl();
      failed.value = false;
      observeImage();
      return;
    }
    if (shouldReloadAuthorizedImage({
      mediaKeyChanged: false,
      hasObjectUrl: Boolean(objectUrl.value),
      failed: failed.value
    })) {
      failed.value = false;
      observeImage();
    }
  }
);

onMounted(observeImage);
onBeforeUnmount(() => {
  disconnectObserver();
  revokeObjectUrl();
});
</script>

<style scoped>
.authorized-lazy-image {
  position: relative;
  overflow: hidden;
  width: 100%;
  background: #eef1ef;
}

.authorized-lazy-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  animation: lazy-image-fade 180ms ease-out;
}

.lazy-image-state {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--admin-muted);
  font-size: 12px;
}

.lazy-image-state.loading::before {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(33, 117, 94, 0.18);
  border-top-color: rgba(33, 117, 94, 0.72);
  border-radius: 999px;
  content: "";
  animation: lazy-image-spin 0.9s linear infinite;
}

@keyframes lazy-image-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes lazy-image-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
