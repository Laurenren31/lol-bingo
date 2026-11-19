<script setup lang="ts">
import { computed } from 'vue';
import { game } from '../game';

const players = computed(() => game.state?.players ?? []);
const target = computed(() => game.state?.settings.target ?? 0);
const myId = computed(() => game.session?.playerId);
const items = computed(() => !!game.state?.settings.items);
</script>

<template>
  <section class="panel">
    <h2 class="panel-title">
      <span>玩家（{{ players.length }}）</span>
      <span class="hint">目標 {{ target }} 條</span>
    </h2>
    <ul class="list">
      <li v-for="p in players" :key="p.id" class="row" :class="{ me: p.id === myId, bingo: p.bingo, off: !p.online }">
        <span class="dot" :class="{ on: p.online }" :title="p.online ? '在線' : '離線'"></span>
        <span class="nick">
          <span v-if="p.isHost" class="crown" title="房主">👑</span>{{ p.nick }}<span v-if="p.id === myId" class="you">（你）</span>
        </span>
        <span v-if="items" class="meta" title="這一局還沒用的道具">
          <span :class="{ gone: !p.hasBomb }">💣</span><span :class="{ gone: !p.hasRecall }">↩️</span>
        </span>
        <span class="lines"><b>{{ p.lines }}</b> 條</span>
        <span v-if="p.bingo" class="badge">BINGO</span>
        <span v-else-if="!p.online" class="offtext">離線</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.hint {
  font-weight: 500;
  font-size: 12px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--panel2);
  border: 1px solid transparent;
  font-size: 14px;
}
.row.me {
  border-color: rgba(10, 200, 185, 0.5);
}
.row.bingo {
  border-color: var(--gold);
  background: #2a2212;
}
.row.off {
  opacity: 0.6;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #56606c;
  flex: none;
}
.dot.on {
  background: var(--ok);
  box-shadow: 0 0 6px var(--ok);
}
.nick {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}
.crown {
  margin-right: 3px;
}
.you {
  color: var(--blue);
  font-weight: 500;
  font-size: 12px;
}
.meta {
  color: var(--muted);
  font-size: 12px;
}
.gone {
  opacity: 0.2;
  filter: grayscale(1);
}
.lines b {
  color: var(--gold);
  font-size: 16px;
}
.lines {
  font-size: 12px;
  color: var(--muted);
  min-width: 3.2em;
  text-align: right;
}
.badge {
  font-size: 11px;
  font-weight: 900;
  color: #1a1205;
  background: linear-gradient(180deg, #e8d5a8, #c8aa6e);
  border-radius: 4px;
  padding: 1px 6px;
  letter-spacing: 1px;
}
.offtext {
  font-size: 11px;
  color: var(--muted);
}
</style>
