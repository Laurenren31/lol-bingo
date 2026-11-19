<script setup lang="ts">
import { computed } from 'vue';
import BoardCard from '../components/BoardCard.vue';
import CallInput from '../components/CallInput.vue';
import CalledList from '../components/CalledList.vue';
import PlayerList from '../components/PlayerList.vue';
import HostSettings from '../components/HostSettings.vue';
import ItemBar from '../components/ItemBar.vue';
import ChatPanel from '../components/ChatPanel.vue';
import { blockedSet, calledSet, columnHeads, game, leaveRoom, me } from '../game';
import { clickCell } from '../actions';
import { confirmDialog, toast } from '../ui';

const code = computed(() => game.session?.roomCode ?? '');
const count = computed(() => game.boards.length);
const target = computed(() => game.state?.settings.target ?? 0);
const freeCenter = computed(() => game.state?.settings.freeCenter ?? false);
const myLines = computed(() => me.value?.lines ?? 0);

/** 桌機排版：1 張置中放大；2 張並排；4 張 2×2；6 張 3×2 */
const grid = computed(() => {
  const n = count.value;
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n === 4) return { cols: 2, rows: 2 };
  return { cols: 3, rows: 2 };
});

async function copyLink() {
  const url = `${location.origin}/?r=${code.value}`;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: '英雄聯盟賓果', text: `來玩英雄聯盟賓果！房號 ${code.value}`, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('已複製邀請連結');
  } catch {
    toast(`房號：${code.value}`);
  }
}

async function onLeave() {
  if (await confirmDialog('離開房間？', '離開後你的盤面會被移除；之後可以用房號重新加入。', '離開')) await leaveRoom();
}
</script>

<template>
  <div class="room">
    <header class="top">
      <div class="title">英雄聯盟賓果</div>
      <button class="roomcode" type="button" title="複製邀請連結" @click="copyLink">
        <span class="lbl">房號</span><b>{{ code }}</b><span class="share">分享</span>
      </button>
      <span v-if="game.conn !== 'connected'" class="conn" role="status">
        <span class="spin"></span>重新連線中…
      </span>
      <button class="btn small ghost leave" type="button" @click="onLeave">離開</button>
    </header>

    <div v-if="!game.state" class="loading muted">正在回到房間 {{ code }}…</div>

    <div v-else class="layout">
      <section class="panel status">
        <div class="lines">
          合計 <b>{{ myLines }}</b> 條
          <span class="muted">／目標 {{ target }} 條</span>
          <span v-if="me?.bingo" class="bingo">BINGO!</span>
        </div>
        <span class="muted cntinfo">每人 {{ count }} 張</span>
        <ItemBar />
      </section>

      <div class="call"><CallInput /></div>

      <div
        class="boards"
        :class="'n' + count"
        :style="{ '--cols': grid.cols, '--rows': grid.rows }"
      >
        <BoardCard
          v-for="(b, i) in game.boards"
          :key="i + ':' + b[0]"
          :board="b"
          :index="i"
          :called="calledSet"
          :free-center="freeCenter"
          :marks="game.marks[i]"
          :blocked="blockedSet"
          :heads="columnHeads"
          :aiming="game.itemMode === 'bomb'"
          :recalling="game.itemMode === 'recall'"
          :large="count === 1"
          @cell="(cell, name) => clickCell(i, cell, name)"
        />
      </div>

      <div class="called"><CalledList /></div>
      <div class="chatbox"><ChatPanel /></div>
      <div class="players"><PlayerList /></div>
      <div class="settings"><HostSettings /></div>
    </div>
  </div>
</template>

<style scoped>
.room {
  padding: calc(8px + env(safe-area-inset-top)) 12px 0;
  max-width: 1600px;
  margin: 0 auto;
}
.top {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.title {
  font-weight: 900;
  font-size: 20px;
  letter-spacing: 2px;
  color: var(--gold2);
  text-shadow: 0 0 14px rgba(200, 170, 110, 0.35);
}
.roomcode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--panel);
  border: 1px solid var(--gold);
  color: var(--gold2);
  border-radius: 8px;
  padding: 4px 10px;
  cursor: pointer;
  font: inherit;
}
.roomcode .lbl,
.roomcode .share {
  font-size: 11px;
  color: var(--muted);
}
.roomcode b {
  font-size: 17px;
  letter-spacing: 3px;
}
.conn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 3px 10px;
}
.spin {
  width: 10px;
  height: 10px;
  border: 2px solid var(--muted);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.leave {
  margin-left: auto;
}
.loading {
  text-align: center;
  padding: 60px 0;
}

/* ---------- 手機（預設）：單欄堆疊 ---------- */
.layout {
  display: grid;
  gap: 10px;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas:
    'status'
    'call'
    'boards'
    'called'
    'chatbox'
    'players'
    'settings';
}
.status {
  grid-area: status;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.call {
  grid-area: call;
}
.boards {
  grid-area: boards;
}
.called {
  grid-area: called;
}
.players {
  grid-area: players;
}
.chatbox {
  grid-area: chatbox;
}
.cntinfo {
  font-size: 13px;
}
.settings {
  grid-area: settings;
}

.lines {
  font-size: 15px;
}
.lines b {
  font-size: 26px;
  color: var(--gold);
  margin: 0 3px;
}
.bingo {
  margin-left: 6px;
  font-weight: 900;
  color: var(--gold);
  letter-spacing: 2px;
  text-shadow: 0 0 10px rgba(240, 230, 210, 0.5);
}

.boards {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.boards.n1 {
  grid-template-columns: minmax(0, 1fr);
  width: 100%;
  max-width: 560px;
  justify-self: center;
}

/* ---------- 桌機：左邊盤面盡量一屏放完，右邊側欄 ---------- */
@media (min-width: 960px) {
  .layout {
    grid-template-columns: minmax(0, 1fr) 340px;
    grid-template-rows: auto auto auto auto 1fr;
    grid-template-areas:
      'status call'
      'boards called'
      'boards chatbox'
      'boards players'
      'boards settings';
    align-items: start;
  }
  .boards {
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    /* 依可用高度限制寬度：盤面高度 ≈ 寬度 × 1.12 + 48px */
    width: 100%;
    max-width: calc(
      var(--cols) * (((100dvh - 150px - (var(--rows) - 1) * 8px) / var(--rows) - 48px) / 1.12) + (var(--cols) - 1) * 8px
    );
    justify-self: center;
  }
  .boards.n1 {
    max-width: min(620px, calc((100dvh - 200px) / 1.12));
  }
}
</style>
