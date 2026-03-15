<template>
  <SetupScreen v-if="screen === 'setup'" @start="onStart" />
  <GameScreen v-else-if="screen === 'game'" :queue="queue" @done="onDone" />
  <ResultsScreen v-else :match-ids="matches" @restart="onRestart" />
</template>

<script setup lang="ts">
import { ref } from "vue";
import SetupScreen from "./components/SetupScreen.vue";
import GameScreen from "./components/GameScreen.vue";
import ResultsScreen from "./components/ResultsScreen.vue";

type Screen = "setup" | "game" | "results";

const screen = ref<Screen>("setup");
const queue = ref<string[]>([]);
const matches = ref<string[]>([]);

function onStart(stops: string[]) {
  queue.value = stops;
  matches.value = [];
  screen.value = "game";
}

function onDone(matchedIds: string[]) {
  matches.value = matchedIds;
  screen.value = "results";
}

function onRestart() {
  screen.value = "setup";
}
</script>
