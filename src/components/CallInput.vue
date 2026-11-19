<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { CHAMPION_NAMES, isChampion } from '../../shared/champions';
import { autoRunning, callChampion, game, started } from '../game';
import { toast } from '../ui';

const autoMode = computed(() => !!game.state?.settings.autoCall);
const nowTick = ref(Date.now());
const ticker = setInterval(() => (nowTick.value = Date.now()), 250);
onBeforeUnmount(() => clearInterval(ticker));
const secondsLeft = computed(() => Math.max(0, Math.ceil((game.autoAt - nowTick.value) / 1000)));
const lastCall = computed(() => game.state?.calls.at(-1)?.champion ?? '');

const text = ref('');
const busy = ref(false);

async function submit() {
  const v = text.value.trim();
  if (!v || busy.value) return;
  if (!isChampion(v)) return toast(`找不到「${v}」，請從清單選擇`);
  busy.value = true;
  try {
    await callChampion(v);
    text.value = '';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="!started" class="auto" role="status" aria-live="polite">
    <span class="muted">準備中：等房主設定好後按「開始」（{{ autoMode ? '自動叫號' : '手動叫號' }}）</span>
  </div>
  <div v-else-if="autoMode" class="auto" role="status" aria-live="polite">
    <template v-if="autoRunning">
      <span class="pulse"></span>
      <span>自動叫號中，<b>{{ secondsLeft }}</b> 秒後喊下一位</span>
      <span v-if="lastCall" class="last">剛剛：<b>{{ lastCall }}</b></span>
    </template>
    <span v-else class="muted">自動叫號已停止，房主可以按「開新的一局」</span>
  </div>
  <form v-else class="callrow" @submit.prevent="submit">
    <input
      v-model="text"
      class="field"
      type="text"
      list="champion-list"
      placeholder="喊一位英雄（不在你盤面上也可以）"
      autocomplete="off"
      enterkeyhint="send"
    />
    <button class="btn primary" type="submit" :disabled="busy || !text.trim()">喊</button>
    <datalist id="champion-list">
      <option v-for="n in CHAMPION_NAMES" :key="n" :value="n" />
    </datalist>
  </form>
</template>

<style scoped>
.callrow {
  display: flex;
  gap: 8px;
}
.callrow .field {
  flex: 1;
}
.callrow .btn {
  padding: 10px 18px;
}
.auto {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  min-height: 46px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--panel);
  border: 1px solid var(--gold);
  font-size: 14px;
}
.auto b {
  color: var(--gold2);
  font-size: 17px;
}
.last {
  margin-left: auto;
  color: var(--muted);
}
.pulse {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--gold);
  animation: blink 1s ease-in-out infinite;
}
@keyframes blink {
  50% {
    opacity: 0.25;
  }
}
</style>
