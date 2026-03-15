<template>
  <div class="bg-gray-900 px-4 py-3 flex items-center gap-3 shrink-0">
    <span class="text-2xl">🚌</span>
    <span class="text-lg font-bold text-white">Finding Nyo</span>
    <span class="text-gray-400 text-sm">Nyo sent a photo. 30,000+ stops. One is the one. But which one?</span>
    <span v-if="right" class="ml-auto text-sm text-gray-300">{{ right }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{ right?: string }>();
</script>
