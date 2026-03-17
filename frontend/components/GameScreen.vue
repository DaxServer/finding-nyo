<template>
  <div class="h-screen flex flex-col overflow-hidden">
    <AppHeader :right="`${currentIndex + 1} / ${queue.length}`" :location="stopName" />

    <!-- Content: scrollable column on mobile, side-by-side row on desktop -->
    <div class="flex-1 flex flex-col overflow-y-auto sm:flex-row sm:overflow-hidden bg-gray-900">
      <!-- Images: stacked on mobile, 2×2 grid on desktop -->
      <div class="flex flex-col gap-1 p-1 sm:flex-1 sm:grid sm:grid-cols-2 sm:grid-rows-2">
        <!-- Skeleton tiles while API call is in flight -->
        <template v-if="loading">
          <div
            v-for="i in 4" :key="`sk-${i}`"
            class="aspect-video sm:aspect-auto skeleton"
          />
        </template>
        <template v-else>
          <div v-for="(img, i) in images" :key="img.url" class="relative overflow-hidden bg-gray-700">
            <img
              :src="img.url" class="w-full aspect-video sm:aspect-auto sm:h-full object-cover"
              :alt="`Street view ${i + 1}`"
              @load="onImageLoad(i)"
            >
            <div v-if="!loadedIndices.has(i)" class="skeleton absolute inset-0" />
            <span v-if="loadedIndices.has(i)" class="absolute bottom-1 right-1 bg-black/60 text-xs px-1 rounded">
              {{ img.distance_m.toFixed(0) }}m
            </span>
          </div>
          <!-- Placeholder cells when fewer than 4 images -->
          <div
            v-for="i in Math.max(0, 4 - images.length)" :key="`ph-${i}`"
            class="aspect-video sm:aspect-auto bg-gray-600 flex flex-col items-center justify-center gap-2 text-gray-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8">
              <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V9.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
            </svg>
            <span class="text-sm">No nearby images</span>
          </div>
        </template>
      </div>

      <!-- Mini-map: bottom of scroll on mobile, sidebar on desktop -->
      <div ref="miniMapWrapEl" class="h-48 mt-1 sm:mt-0 sm:h-auto sm:w-64 sm:shrink-0 bg-gray-800">
        <div ref="miniMapEl" class="w-full h-full" />
      </div>
    </div>

    <!-- Footer -->
    <div class="bg-gray-800 flex shrink-0">
      <button class="flex-1 py-5 sm:py-3 bg-red-700 hover:bg-red-600 font-semibold text-base sm:text-sm" @click="skip">
        ✕ Not this one <span class="hidden sm:inline">[N]</span>
      </button>
      <button
        class="flex-1 py-5 sm:py-3 bg-green-700 hover:bg-green-600 font-semibold text-base sm:text-sm"
        @click="match"
      >
        ✓ This is it! <span class="hidden sm:inline">[Y]</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import L from "leaflet";
import { api } from "../api";
import type { Stop } from "../../src/models/response";
import { useInitOnResize } from "../composables/useInitOnResize";
import AppHeader from "./AppHeader.vue";

const props = defineProps<{ queue: number[] }>();
const emit = defineEmits<{ done: [matchedIds: number[]] }>();

const currentIndex = ref(0);
const stopName = ref("Loading…");
const images = ref<{ url: string; distance_m: number }[]>([]);
const loading = ref(true);
const loadedIndices = ref(new Set<number>());
const matchedIds = ref<number[]>([]);
const miniMapEl = ref<HTMLDivElement | null>(null);
const miniMapWrapEl = ref<HTMLDivElement | null>(null);
const currentStopLat = ref<number | null>(null);
const currentStopLng = ref<number | null>(null);

let miniMap: L.Map | null = null;
let stopMarker: L.Marker | null = null;
let prefetchAborted = false;

// Cache for prefetched stop data
const prefetchCache = new Map<number, { data: Stop; timestamp: number }>();
const inFlightRequests = new Map<number, Promise<void>>();

useInitOnResize(
  () => miniMapWrapEl.value!,
  () => miniMapEl.value!,
  () => {
    miniMap = L.map(miniMapEl.value!, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      keyboard: false,
    }).setView([51.0, 4.3], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(miniMap);
    window.addEventListener("keydown", onKey);
    syncMiniMapToCurrentStop();
  },
);

onMounted(() => {
  void loadStop();
  void prefetchAll();
});

onUnmounted(() => {
  prefetchAborted = true;
  window.removeEventListener("keydown", onKey);
  miniMap?.remove();
  prefetchCache.clear();
  inFlightRequests.clear();
});

watch(currentIndex, loadStop);

function syncMiniMapToCurrentStop() {
  if (!miniMap || currentStopLat.value === null || currentStopLng.value === null) return;
  miniMap.setView([currentStopLat.value, currentStopLng.value], 15);
  stopMarker?.remove();
  stopMarker = L.marker([currentStopLat.value, currentStopLng.value]).addTo(miniMap);
}

async function loadStop() {
  const id = props.queue[currentIndex.value];
  if (!id) return;

  stopName.value = "Loading…";
  images.value = [];
  loading.value = true;
  loadedIndices.value = new Set();

  // Check cache first (30 second TTL)
  const cached = prefetchCache.get(id);
  if (cached && Date.now() - cached.timestamp < 30000) {
    const { data } = cached;
    stopName.value = data.name;
    images.value = data.images;
    currentStopLat.value = data.lat;
    currentStopLng.value = data.lng;
    loading.value = false;
    syncMiniMapToCurrentStop();
    return;
  }

  // Not in cache, fetch it
  const stopRes = await api.stops({ id }).get();

  // Discard response if user has already moved to a different stop
  if (props.queue[currentIndex.value] !== id) return;

  if (stopRes.data) {
    const { name, lat, lng, images: imgs } = stopRes.data;
    stopName.value = name;
    images.value = imgs;
    currentStopLat.value = lat;
    currentStopLng.value = lng;
    syncMiniMapToCurrentStop();
  }
  loading.value = false;
}

async function prefetchAll() {
  for (let i = 1; i < props.queue.length; i++) {
    if (prefetchAborted) return;
    const id = props.queue[i];
    if (!id || prefetchCache.has(id) || inFlightRequests.has(id)) continue;

    const promise = api.stops({ id }).get().then((res) => {
      if (res.data) {
        prefetchCache.set(id, { data: res.data, timestamp: Date.now() });
      }
      inFlightRequests.delete(id);
    });

    inFlightRequests.set(id, promise);
    await promise;
  }
}

function onImageLoad(i: number) {
  loadedIndices.value = new Set([...loadedIndices.value, i]);
}

function skip() {
  advance();
}

function match() {
  const id = props.queue[currentIndex.value];
  if (id) matchedIds.value.push(id);
  emit("done", matchedIds.value);
}

function advance() {
  if (currentIndex.value + 1 >= props.queue.length) {
    emit("done", matchedIds.value);
  } else {
    loading.value = true;
    images.value = [];
    loadedIndices.value = new Set();
    currentIndex.value++;
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === "n" || e.key === "N") skip();
  else if (e.key === "y" || e.key === "Y") match();
}
</script>
