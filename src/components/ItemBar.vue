<script setup lang="ts">
import { computed } from 'vue';
import { game, itemsOn, me, type ItemMode } from '../game';
import { toast } from '../ui';

const hasBomb = computed(() => !!me.value?.hasBomb);
const hasRecall = computed(() => !!me.value?.hasRecall);
const noCalls = computed(() => !game.state?.calls.length);

function pick(mode: Exclude<ItemMode, null>) {
  if (game.itemMode === mode) {
    game.itemMode = null;
    return;
  }
  if (mode === 'recall' && noCalls.value) return toast('還沒有人喊，沒有可以遣返的英雄');
  game.itemMode = mode;
}

const hint = computed(() =>
  game.itemMode === 'bomb'
    ? '點自己盤面上的一格，以它為中心炸 3×3'
    : game.itemMode === 'recall'
      ? '點一位已喊的英雄（盤面上或已喊清單裡），把它拔掉'
      : '',
);
</script>

<template>
  <div v-if="itemsOn" class="items" role="group" aria-label="道具">
    <button
      type="button"
      class="item"
      :class="{ on: game.itemMode === 'bomb', used: !hasBomb }"
      :disabled="!hasBomb"
      :aria-pressed="game.itemMode === 'bomb'"
      @click="pick('bomb')"
    >
      <span class="ico">💣</span>炸彈<span class="left">{{ hasBomb ? '×1' : '已用' }}</span>
    </button>
    <button
      type="button"
      class="item"
      :class="{ on: game.itemMode === 'recall', used: !hasRecall }"
      :disabled="!hasRecall"
      :aria-pressed="game.itemMode === 'recall'"
      @click="pick('recall')"
    >
      <span class="ico">↩️</span>強制遣返<span class="left">{{ hasRecall ? '×1' : '已用' }}</span>
    </button>
    <div v-if="game.itemMode" class="hint" role="status">
      {{ hint }}
      <button type="button" class="cancel" @click="game.itemMode = null">取消</button>
    </div>
  </div>
</template>

<style scoped>
.items {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--panel2);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.ico {
  font-size: 15px;
}
.left {
  font-size: 11px;
  color: var(--muted);
  font-weight: 500;
}
.item.on {
  border-color: #e8935c;
  background: #3a2414;
  box-shadow: 0 0 10px rgba(232, 147, 92, 0.45);
}
.item.used {
  opacity: 0.45;
  cursor: not-allowed;
}
.hint {
  flex: 1 1 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: #ffd2b0;
  background: #2a1a10;
  border: 1px solid #6b3f22;
  border-radius: 8px;
  padding: 5px 8px;
}
.cancel {
  flex: none;
  border: 1px solid #6b3f22;
  background: transparent;
  color: #ffd2b0;
  border-radius: 6px;
  padding: 2px 8px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
</style>
