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
const queue = ref<number[]>([]);
const matches = ref<number[]>([]);

function onStart(stops: number[]) {
  queue.value = stops;
  matches.value = [];
  screen.value = "game";
}

function onDone(matchedIds: number[]) {
  matches.value = matchedIds;
  screen.value = "results";
}

function onRestart() {
  screen.value = "setup";
}
</script>
