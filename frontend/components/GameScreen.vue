<template>
  <div class="h-screen flex flex-col overflow-hidden">
    <AppHeader :right="`${currentIndex + 1} / ${queue.length}`" :location="stopName" />

    <!-- Content: scrollable column on mobile, side-by-side row on desktop -->
    <div class="flex-1 flex flex-col overflow-y-auto sm:flex-row sm:overflow-hidden bg-gray-900">
      <!-- Images: stacked on mobile, 2×2 grid on desktop -->
      <div class="flex flex-col gap-1 p-1 sm:flex-1 sm:grid sm:grid-cols-2 sm:grid-rows-2">
        <div v-for="(img, i) in images" :key="i" class="relative overflow-hidden bg-gray-700">
          <img
            :src="img.url" class="w-full aspect-video sm:aspect-auto sm:h-full object-cover"
            :alt="`Street view ${i + 1}`"
          >
          <span class="absolute bottom-1 right-1 bg-black/60 text-xs px-1 rounded">
            {{ img.distance_m.toFixed(0) }}m
          </span>
        </div>
        <!-- Placeholder cells when fewer than 4 images -->
        <div
          v-for="i in Math.max(0, 4 - images.length)" :key="`ph-${i}`"
          class="aspect-video sm:aspect-auto bg-gray-700 flex items-center justify-center text-gray-500 text-sm"
        >
          No image
        </div>
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
import { useInitOnResize } from "../composables/useInitOnResize";
import AppHeader from "./AppHeader.vue";

const props = defineProps<{ queue: string[] }>();
const emit = defineEmits<{ done: [matchedIds: string[]] }>();

const currentIndex = ref(0);
const stopName = ref("Loading…");
const images = ref<{ url: string; distance_m: number }[]>([]);
const matchedIds = ref<string[]>([]);
const miniMapEl = ref<HTMLDivElement | null>(null);
const miniMapWrapEl = ref<HTMLDivElement | null>(null);
const currentStopLat = ref<number | null>(null);
const currentStopLng = ref<number | null>(null);

let miniMap: L.Map | null = null;
let stopMarker: L.Marker | null = null;

// Cache for prefetched stop data
const prefetchCache = new Map<string, { data: { name: string; lat: number; lng: number; images: { url: string; distance_m: number }[] }; timestamp: number }>();
const inFlightRequests = new Map<string, Promise<void>>();

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
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  miniMap?.remove();
  // Clean up caches
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

  // Check cache first (30 second TTL)
  const cached = prefetchCache.get(id);
  if (cached && Date.now() - cached.timestamp < 30000) {
    const { data } = cached;
    stopName.value = data.name;
    images.value = data.images;
    currentStopLat.value = data.lat;
    currentStopLng.value = data.lng;
    syncMiniMapToCurrentStop();

    // Clean up old cache entries
    cleanupCache();

    // Prefetch next stop
    prefetchNext(currentIndex.value + 1);
    return;
  }

  // Not in cache, fetch it
  const stopRes = await api.stops({ id }).get();

  if (stopRes.data) {
    const { name, lat, lng, images: imgs } = stopRes.data;
    stopName.value = name;
    images.value = imgs;
    currentStopLat.value = lat;
    currentStopLng.value = lng;
    syncMiniMapToCurrentStop();
  }

  // Prefetch next stop
  prefetchNext(currentIndex.value + 1);
}

function cleanupCache() {
  const now = Date.now();
  for (const [id, entry] of prefetchCache.entries()) {
    if (now - entry.timestamp > 30000) {
      prefetchCache.delete(id);
    }
  }
}

function prefetchNext(idx: number) {
  const nextId = props.queue[idx];
  if (!nextId) return;

  // Check if already cached or in-flight
  if (prefetchCache.has(nextId) || inFlightRequests.has(nextId)) {
    return;
  }

  // Start prefetch
  const promise = api.stops({ id: nextId }).get().then((res) => {
    if (res.data) {
      const { name, lat, lng, images: imgs } = res.data;
      prefetchCache.set(nextId, {
        data: { name, lat, lng, images: imgs },
        timestamp: Date.now(),
      });
    }
    inFlightRequests.delete(nextId);
  });

  inFlightRequests.set(nextId, promise);
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
    currentIndex.value++;
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === "n" || e.key === "N") skip();
  else if (e.key === "y" || e.key === "Y") match();
}
</script>
