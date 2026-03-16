<template>
  <div class="h-screen flex flex-col">
    <!-- Title -->
    <AppHeader :right="headerRight" />

    <!-- Map -->
    <div ref="mapWrapEl" class="flex-1 relative">
      <div ref="mapEl" class="w-full h-full" />
    </div>

    <!-- Controls -->
    <div class="bg-gray-800 p-4 flex flex-col gap-3">
      <div class="flex items-center gap-4">
        <label class="text-sm text-gray-300 shrink-0 w-36">
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
        <label class="text-sm text-gray-300 shrink-0 w-36">
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
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-sm text-gray-400 flex-1 min-w-0">
          {{ pin ? `Pin: ${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}` : "Click the map to place a pin" }}
        </span>
        <div class="flex gap-3 shrink-0">
          <button
            class="px-6 py-2 bg-gray-600 hover:bg-gray-500 disabled:opacity-40 disabled:cursor-not-allowed rounded font-semibold"
            :disabled="!pin && radiusM === 10000 && minTramM === 100"
            @click="reset"
          >
            Reset
          </button>
          <button
            class="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded font-semibold"
            :disabled="!pin || loading || (!!pin && stopCount === 0)"
            @click="startGame"
          >
            {{ loading ? "Loading…" : "Start" }}
          </button>
        </div>
      </div>
      <p v-if="error" class="text-red-400 text-sm">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from "vue";
import AppHeader from "./AppHeader.vue";
import L from "leaflet";
import "leaflet.markercluster";
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

type Location = { lat: number; lng: number; nearest_tram_stop_m: number | null };

let map: L.Map | null = null;
let marker: L.Marker | null = null;
let circle: L.Circle | null = null;
let clusterGroup: L.MarkerClusterGroup | null = null;
let allLocations: Location[] = [];

const stopCount = ref(0);
const locationsLoaded = ref(false);
const headerRight = computed(() => {
  if (!locationsLoaded.value) return undefined;
  if (pin.value && stopCount.value === 0) return "No stops in this area";
  return `${stopCount.value.toLocaleString()} stops`;
});

function refreshCluster() {
  if (!clusterGroup) return;
  clusterGroup.clearLayers();

  let filtered = allLocations;
  const p = pin.value;
  if (p) {
    const pinLatLng = L.latLng(p.lat, p.lng);
    const r = radiusM.value;
    const tramMin = minTramM.value;
    filtered = allLocations.filter((loc) => {
      const dist = pinLatLng.distanceTo([loc.lat, loc.lng]);
      return dist <= r && (loc.nearest_tram_stop_m ?? Infinity) >= tramMin;
    });
  }

  stopCount.value = filtered.length;
  clusterGroup.addLayers(filtered.map((loc) => L.circleMarker([loc.lat, loc.lng], { radius: 4 })));
}

function pinIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:#ef4444;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.5)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

useInitOnResize(
  () => mapWrapEl.value!,
  () => mapEl.value!,
  async () => {
    map = L.map(mapEl.value!, { zoomControl: true }).setView([51.0, 4.3], 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 20,
    }).addTo(map);
    map.on("click", (e) => {
      pin.value = { lat: e.latlng.lat, lng: e.latlng.lng };
    });

    const { data } = await api.api.stops.locations.get();
    if (!data || !map) return;

    allLocations = data.locations;
    locationsLoaded.value = true;
    clusterGroup = L.markerClusterGroup({ chunkedLoading: true });
    refreshCluster();
    clusterGroup.addTo(map);
    fitAll();
  },
);

onUnmounted(() => {
  map?.remove();
});

watch([pin, radiusM], ([p, r]) => {
  if (!map) return;

  if (marker) { marker.remove(); marker = null; }
  if (circle) { circle.remove(); circle = null; }

  if (!p) return;

  marker = L.marker([p.lat, p.lng], { icon: pinIcon() }).addTo(map);
  circle = L.circle([p.lat, p.lng], { radius: r, color: "#3b82f6", fillOpacity: 0.1 }).addTo(map);

  const bounds = circle.getBounds();
  const zoom = Math.floor(map.getBoundsZoom(bounds));
  map.setView([p.lat, p.lng], zoom);
});

watch([pin, radiusM, minTramM], refreshCluster);

function fitAll() {
  if (!map || allLocations.length === 0) return;
  const bounds = L.latLngBounds(allLocations.map((loc) => [loc.lat, loc.lng] as [number, number]));
  map.fitBounds(bounds, { padding: [20, 20] });
}

function reset() {
  pin.value = null;
  radiusM.value = 10000;
  minTramM.value = 100;
  error.value = "";
  fitAll();
}

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
