<template>
  <div class="h-screen flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="bg-gray-800 px-4 py-2 flex items-center justify-between shrink-0">
      <span class="font-semibold text-lg">{{ stopName }}</span>
      <span class="text-gray-400 text-sm">{{ currentIndex + 1 }} / {{ queue.length }}</span>
    </div>

    <!-- Main content: photos + mini-map -->
    <div class="flex flex-1 overflow-hidden">
      <!-- 2×2 photo grid -->
      <div class="flex-1 grid grid-cols-2 grid-rows-2 gap-1 bg-gray-900 p-1">
        <div
          v-for="(img, i) in images"
          :key="i"
          class="relative overflow-hidden bg-gray-700"
        >
          <img
            :src="img.url"
            class="w-full h-full object-cover"
            :alt="`Street view ${i + 1}`"
          >
          <span class="absolute bottom-1 right-1 bg-black/60 text-xs px-1 rounded">
            {{ img.distance_m.toFixed(0) }}m
          </span>
        </div>
        <!-- Placeholder cells when fewer than 4 images -->
        <div
          v-for="i in Math.max(0, 4 - images.length)"
          :key="`ph-${i}`"
          class="bg-gray-700 flex items-center justify-center text-gray-500 text-sm"
        >
          No image
        </div>
      </div>

      <!-- Mini-map sidebar -->
      <div ref="miniMapWrapEl" class="w-64 shrink-0 bg-gray-800">
        <div ref="miniMapEl" class="w-full h-full" />
      </div>
    </div>

    <!-- Footer -->
    <div class="bg-gray-800 flex shrink-0">
      <button
        class="flex-1 py-3 bg-red-700 hover:bg-red-600 font-semibold text-sm"
        @click="skip"
      >
        ✕ Not this one [N]
      </button>
      <button
        class="flex-1 py-3 bg-green-700 hover:bg-green-600 font-semibold text-sm"
        @click="match"
      >
        ✓ This is it! [Y]
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import L from "leaflet";
import { api } from "../api";
import { useInitOnResize } from "../composables/useInitOnResize";

const props = defineProps<{ queue: string[] }>();
const emit = defineEmits<{ done: [matchedIds: string[]] }>();

const currentIndex = ref(0);
const stopName = ref("Loading…");
const images = ref<{ url: string; distance_m: number }[]>([]);
const matchedIds = ref<string[]>([]);
const miniMapEl = ref<HTMLDivElement | null>(null);
const miniMapWrapEl = ref<HTMLDivElement | null>(null);

let miniMap: L.Map | null = null;
let stopMarker: L.Marker | null = null;

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
    loadStop();
  },
);

onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  miniMap?.remove();
});

watch(currentIndex, loadStop);

async function loadStop() {
  const id = props.queue[currentIndex.value];
  if (!id) return;

  stopName.value = "Loading…";
  images.value = [];

  const [stopRes, imgRes] = await Promise.all([
    api.api.stops({ id }).get(),
    api.api.stops({ id }).images.get(),
  ]);

  if (stopRes.data) {
    stopName.value = stopRes.data.name;
    const { lat, lng } = stopRes.data;

    if (miniMap) {
      miniMap.setView([lat, lng], 15);
      stopMarker?.remove();
      stopMarker = L.marker([lat, lng]).addTo(miniMap);
    }
  }

  if (imgRes.data) {
    images.value = imgRes.data.images;
  }

  // Prefetch next stop's images while user decides
  const nextId = props.queue[currentIndex.value + 1];
  if (nextId) {
    api.api.stops({ id: nextId }).images.get();
  }
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
