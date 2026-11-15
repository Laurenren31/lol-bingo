<script setup lang="ts">
import { ref } from 'vue';
import { CHAMPION_NAMES, isChampion } from '../../shared/champions';
import { callChampion } from '../game';
import { toast } from '../ui';

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
  <form class="callrow" @submit.prevent="submit">
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
</style>
