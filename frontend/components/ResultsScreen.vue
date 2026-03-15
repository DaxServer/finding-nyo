<template>
  <div class="h-screen flex flex-col items-center justify-center gap-6 px-8">
    <h1 class="text-2xl font-bold">Results</h1>

    <div v-if="stopNames.length === 0" class="text-gray-400">No matches found.</div>
    <ul v-else class="w-full max-w-lg space-y-2">
      <li
        v-for="(name, i) in stopNames"
        :key="i"
        class="bg-gray-800 rounded px-4 py-2"
      >
        {{ name }}
      </li>
    </ul>

    <button
      class="px-8 py-3 bg-blue-600 hover:bg-blue-500 rounded font-semibold"
      @click="emit('restart')"
    >
      Start Over
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../api";

const props = defineProps<{ matchIds: string[] }>();
const emit = defineEmits<{ restart: [] }>();

const stopNames = ref<string[]>([]);

onMounted(async () => {
  const names = await Promise.all(
    props.matchIds.map(async (id) => {
      const { data } = await api.api.stops({ id }).get();
      return data?.name ?? id;
    })
  );
  stopNames.value = names;
});
</script>
