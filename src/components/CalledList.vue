<script setup lang="ts">
import { computed } from 'vue';
import { game } from '../game';
import { askRecall } from '../actions';

const calls = computed(() => game.state?.calls ?? []);
const mine = computed(() => new Set(game.boards.flat()));
const latestSeq = computed(() => calls.value.at(-1)?.seq ?? -1);
const recalling = computed(() => game.itemMode === 'recall');
</script>

<template>
  <section class="panel">
    <h2 class="panel-title">
      <span>已喊的英雄（{{ calls.length }}）</span>
      <span v-if="recalling" class="hint pick">點一位英雄把它遣返</span>
    </h2>
    <p v-if="!calls.length" class="empty muted">還沒有人喊</p>
    <ol v-else class="list">
      <li v-for="(c, i) in calls" :key="c.champion">
        <button
          type="button"
          class="chip call"
          :class="{ latest: c.seq === latestSeq, mine: mine.has(c.champion), target: recalling }"
          :title="`${c.byNick} 喊的`"
          :disabled="!recalling"
          @click="askRecall(c.champion)"
        >
          <span class="no">{{ i + 1 }}</span>
          <span class="nm">{{ c.champion }}</span>
          <span class="by">{{ c.byNick }}</span>
        </button>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.hint {
  font-weight: 500;
  font-size: 12px;
}
.empty {
  font-size: 13px;
  margin: 0;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.call {
  cursor: default;
  font-family: inherit;
  color: inherit;
}
.call:disabled {
  opacity: 1;
}
.pick {
  color: var(--danger);
}
.call.target {
  cursor: pointer;
  border-color: var(--danger);
  animation: pulse 1.1s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    box-shadow: 0 0 10px rgba(232, 115, 92, 0.8);
  }
}
.no {
  font-size: 11px;
  color: var(--muted);
}
.by {
  font-size: 11px;
  color: var(--muted);
  max-width: 7em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.by::before {
  content: '・';
}
.call.mine {
  border-color: var(--blue);
}
.call.mine .nm {
  color: #bff5ef;
}
.call.latest {
  border-color: var(--gold);
  background: #3a2e15;
  box-shadow: 0 0 10px rgba(200, 170, 110, 0.5);
  animation: pop 0.4s ease;
}
.call.latest .nm {
  color: var(--gold2);
}
</style>
