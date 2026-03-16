<template>
  <div class="bg-gray-900 px-4 py-3 shrink-0">
    <!-- Desktop: single row -->
    <div class="hidden sm:flex items-center gap-3">
      <span class="text-2xl">🚌</span>
      <span class="text-lg font-bold text-white">Finding Nyo</span>
      <span class="text-gray-400 text-sm">Nyo sent us a photo. 30,000+ stops. One is the one. But which one?</span>
      <div v-if="right" class="ml-auto flex items-center gap-2 text-sm text-gray-300 shrink-0">
        <span v-if="location">{{ location }}</span>
        <span v-if="location && right" class="text-gray-600">·</span>
        <span>{{ right }}</span>
      </div>
    </div>
    <!-- Mobile: two rows -->
    <div class="flex flex-col gap-1 sm:hidden">
      <div class="flex items-center gap-3">
        <span class="text-2xl">🚌</span>
        <span class="text-lg font-bold text-white">Finding Nyo</span>
        <span v-if="right" class="ml-auto text-sm text-gray-300">{{ right }}</span>
      </div>
      <span class="text-gray-400 text-sm">{{ location ?? "Nyo sent us a photo. 30,000+ stops. One is the one. But which one?" }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ right?: string; location?: string }>();
</script>
