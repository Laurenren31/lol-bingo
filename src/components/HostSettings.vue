<script setup lang="ts">
import { computed } from 'vue';
import { game, isHost, newRound, setBoardCount, updateSettings } from '../game';
import { confirmDialog } from '../ui';
import { TARGET_MAX, TARGET_MIN } from '../../shared/validate';
import { BOARD_COUNTS, type BoardCount } from '../../shared/board';

const settings = computed(() => game.state?.settings ?? { target: 3, freeCenter: false, items: false, boardCount: 4 });
const targets = Array.from({ length: TARGET_MAX - TARGET_MIN + 1 }, (_, i) => TARGET_MIN + i);

function onTarget(e: Event) {
  updateSettings({ target: Number((e.target as HTMLSelectElement).value) });
}
function onFree(e: Event) {
  updateSettings({ freeCenter: (e.target as HTMLInputElement).checked });
}
function onItems(e: Event) {
  updateSettings({ items: (e.target as HTMLInputElement).checked });
}
async function onCount(n: BoardCount) {
  if (!isHost.value || n === settings.value.boardCount) return;
  const ok = await confirmDialog(
    `全房改成 ${n} 張？`,
    '所有人的盤面都會重新抽，已喊清單不受影響。用過的炸彈會退還（強制遣返不退）。',
    '重抽',
  );
  if (ok) await setBoardCount(n);
}
async function onNewRound() {
  const extra = settings.value.items ? '每個人的道具會補滿，' : '';
  if (await confirmDialog('開新的一局？', `已喊清單和所有人的 BINGO 狀態都會清空，${extra}盤面不變。`, '開新的一局')) await newRound();
}
</script>

<template>
  <section class="panel">
    <h2 class="panel-title">
      <span>房間設定</span>
      <span v-if="!isHost" class="hint">只有房主可以修改</span>
    </h2>
    <div class="rows">
      <label class="row">
        <span>合計幾條算 BINGO</span>
        <select class="field sel" :value="settings.target" :disabled="!isHost" @change="onTarget">
          <option v-for="t in targets" :key="t" :value="t">{{ t }} 條</option>
        </select>
      </label>
      <div class="row">
        <span>每人盤面張數</span>
        <div class="counts" role="group" aria-label="盤面張數">
          <button
            v-for="n in BOARD_COUNTS"
            :key="n"
            type="button"
            class="cnt"
            :class="{ on: n === settings.boardCount }"
            :aria-pressed="n === settings.boardCount"
            :disabled="!isHost"
            @click="onCount(n)"
          >
            {{ n }}
          </button>
        </div>
      </div>
      <label class="row">
        <span>
          可用道具
          <small class="muted sub">每人每局 💣 炸彈、↩️ 強制遣返各一個</small>
        </span>
        <input type="checkbox" class="toggle" :checked="settings.items" :disabled="!isHost" @change="onItems" />
      </label>
      <label class="row">
        <span>中間為免費格</span>
        <input type="checkbox" class="toggle" :checked="settings.freeCenter" :disabled="!isHost" @change="onFree" />
      </label>
      <button class="btn primary" :disabled="!isHost" @click="onNewRound">開新的一局</button>
    </div>
  </section>
</template>

<style scoped>
.hint {
  font-weight: 500;
  font-size: 12px;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
}
.sub {
  display: block;
  font-size: 11px;
}
.counts {
  display: flex;
  gap: 4px;
}
.cnt {
  width: 34px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--panel2);
  color: var(--text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.cnt.on {
  border-color: var(--gold);
  background: #3a2e15;
  color: var(--gold2);
}
.cnt:disabled {
  cursor: not-allowed;
}
.cnt:disabled:not(.on) {
  opacity: 0.55;
}
.sel {
  padding: 6px 10px;
  font-size: 15px;
}
.sel:disabled,
.toggle:disabled {
  opacity: 0.55;
}
.toggle {
  appearance: none;
  width: 44px;
  height: 24px;
  border-radius: 999px;
  background: var(--panel2);
  border: 1px solid var(--line);
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
  flex: none;
}
.toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--muted);
  transition: transform 0.2s, background 0.2s;
}
.toggle:checked {
  background: #3a2e15;
  border-color: var(--gold);
}
.toggle:checked::after {
  transform: translateX(20px);
  background: var(--gold);
}
.toggle:disabled {
  cursor: not-allowed;
}
</style>
