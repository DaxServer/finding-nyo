<template>
  <div class="h-screen flex flex-col">
    <!-- Title -->
    <AppHeader />

    <!-- Map -->
    <div ref="mapWrapEl" class="flex-1 relative">
      <div ref="mapEl" class="w-full h-full" />
    </div>

    <!-- Controls -->
    <div class="bg-gray-800 p-4 flex flex-col gap-3">
      <div class="flex items-center gap-4">
        <label class="text-sm text-gray-300 w-64">
          Radius: {{ (radiusM / 1000).toFixed(1) }} km
        </label>
        <input
          v-model.number="radiusM"
          type="range"
          min="500"
          max="50000"
          step="500"
          class="flex-1"
        >
      </div>
      <div class="flex items-center gap-4">
        <label class="text-sm text-gray-300 w-64">
          Min tram dist: {{ minTramM }} m
        </label>
        <input
          v-model.number="minTramM"
          type="range"
          min="0"
          max="5000"
          step="100"
          class="flex-1"
        >
      </div>
      <div class="flex items-center gap-4">
        <span class="text-sm text-gray-400 flex-1">
          {{ pin ? `Pin: ${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}` : "Click the map to place a pin" }}
        </span>
        <button
          class="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded font-semibold"
          :disabled="!pin || loading"
          @click="startGame"
        >
          {{ loading ? "Loading…" : "Start" }}
        </button>
      </div>
      <p v-if="error" class="text-red-400 text-sm">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import AppHeader from "./AppHeader.vue";
import L from "leaflet";
import { api } from "../api";
import { useInitOnResize } from "../composables/useInitOnResize";

const emit = defineEmits<{ start: [stops: string[]] }>();

const mapEl = ref<HTMLDivElement | null>(null);
const mapWrapEl = ref<HTMLDivElement | null>(null);
const radiusM = ref(10000);
const minTramM = ref(100);
const pin = ref<{ lat: number; lng: number } | null>(null);
const loading = ref(false);
const error = ref("");

let map: L.Map | null = null;
let marker: L.Marker | null = null;
let circle: L.Circle | null = null;

useInitOnResize(
  () => mapWrapEl.value!,
  () => mapEl.value!,
  () => {
    map = L.map(mapEl.value!, { zoomControl: true }).setView([51.0, 4.3], 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 20,
    }).addTo(map);
    map.on("click", (e) => {
      pin.value = { lat: e.latlng.lat, lng: e.latlng.lng };
    });
  },
);

onUnmounted(() => {
  map?.remove();
});

watch(
  [pin, radiusM],
  ([p, r]) => {
    if (!map || !p) return;

    if (marker) marker.remove();
    if (circle) circle.remove();

    marker = L.marker([p.lat, p.lng]).addTo(map);
    circle = L.circle([p.lat, p.lng], { radius: r, color: "#3b82f6", fillOpacity: 0.1 }).addTo(map);
  }
);

async function startGame() {
  if (!pin.value) return;
  loading.value = true;
  error.value = "";

  const { data, error: err } = await api.api.queue.get({
    query: {
      lat: String(pin.value.lat),
      lng: String(pin.value.lng),
      radius_m: String(radiusM.value),
      min_tram_m: String(minTramM.value),
    },
  });

  loading.value = false;

  if (err || !data) {
    error.value = "Failed to load stops. Try again.";
    return;
  }

  if (data.stops.length === 0) {
    error.value = "No stops found in this area with these filters.";
    return;
  }

  emit("start", data.stops);
}
</script>
