<script setup lang="ts">
import { computed, ref } from 'vue';
import { CENTER, bombArea, evaluateBoard, type Board } from '../../shared/board';
import { getChampion } from '../../shared/champions';

const props = defineProps<{
  board: Board;
  index: number;
  called: ReadonlySet<string>;
  freeCenter: boolean;
  /** 被炸彈標記的格子 */
  marks?: number[];
  /** 被強制遣返的英雄（那格變空格） */
  blocked?: ReadonlySet<string>;
  /** 直排標題（依這一局的順序） */
  heads: readonly string[];
  /** 正在選炸彈落點 */
  aiming?: boolean;
  /** 正在選要遣返的英雄 */
  recalling?: boolean;
  large?: boolean;
}>();
const emit = defineEmits<{ cell: [cell: number, name: string] }>();

// 只用來決定顯示樣式；合計條數與 BINGO 以伺服器為準
const result = computed(() => evaluateBoard(props.board, props.called, props.freeCenter, props.marks, props.blocked));
const winSet = computed(() => new Set(result.value.winCells));
const bombed = computed(() => new Set(props.marks ?? []));

// 選炸彈落點時，滑鼠移到哪格就預覽那格的 3×3
const hover = ref<number | null>(null);
const aimSet = computed(() => new Set(props.aiming && hover.value !== null ? bombArea(hover.value) : []));

const cells = computed(() =>
  props.board.map((name, i) => {
    const free = props.freeCenter && i === CENTER;
    const gone = !free && !!props.blocked?.has(name);
    return {
      gone,
      name,
      free,
      slug: getChampion(name)?.slug ?? '',
      hit: result.value.marked[i],
      win: winSet.value.has(i),
      bomb: bombed.value.has(i) && !props.called.has(name) && !gone,
      aim: aimSet.value.has(i),
      target: props.recalling && props.called.has(name),
    };
  }),
);

function hideImg(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none';
}
</script>

<template>
  <div class="board" :class="{ won: result.lines > 0, large, aiming }" @mouseleave="hover = null">
    <div class="bhead">
      <span>第 {{ index + 1 }} 張<span v-if="bombed.size" class="boom" title="這張用過炸彈">💣</span></span>
      <span><b>{{ result.lines }}</b> 條</span>
    </div>
    <div class="grid">
      <div v-for="c in heads" :key="c" class="colhead">{{ c }}</div>
      <button
        v-for="(c, i) in cells"
        :key="i"
        type="button"
        class="cell"
        :class="{ hit: c.hit, win: c.win, free: c.free, bomb: c.bomb, aim: c.aim, target: c.target, gone: c.gone }"
        :disabled="c.free && !aiming"
        :aria-pressed="c.hit"
        :aria-label="c.free ? '免費格' : c.name + (c.gone ? '（已遣返，空格）' : c.bomb ? '（炸彈蓋章）' : c.hit ? '（已蓋章）' : '')"
        @mouseenter="hover = i"
        @click="(!c.free || aiming) && emit('cell', i, c.name)"
      >
        <span v-if="c.gone" class="gonemark" aria-hidden="true">✕</span>
        <img v-if="!c.free && !c.gone && c.slug" :src="`/champions/${c.slug}.webp`" alt="" loading="lazy" decoding="async" @error="hideImg" />
        <span class="name">{{ c.free ? '★免費★' : c.name }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.board {
  container-type: inline-size;
  background: linear-gradient(145deg, #1b2838, #0d1520);
  border: 2px solid var(--line);
  border-radius: 10px;
  padding: 5px;
  transition: border-color 0.2s, box-shadow 0.2s;
  min-width: 0;
}
.board.won {
  border-color: var(--gold);
  box-shadow: 0 0 18px rgba(200, 170, 110, 0.35);
}
.bhead {
  display: flex;
  justify-content: space-between;
  font-size: clamp(11px, 4cqi, 14px);
  color: var(--muted);
  margin: 0 2px 4px;
}
.bhead b {
  color: var(--gold);
}
.grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: clamp(2px, 0.8cqi, 5px);
}
.colhead {
  text-align: center;
  font-size: clamp(9px, 3.4cqi, 15px);
  font-weight: 900;
  color: var(--gold);
  padding: 1px 0 2px;
  letter-spacing: 1px;
}

/* ---- 格子：沒蓋章（暗）／已蓋章（亮＋青色印章）／連線（金色） ---- */
.cell {
  position: relative;
  aspect-ratio: 1;
  padding: 0;
  margin: 0;
  overflow: hidden;
  border-radius: clamp(3px, 1.2cqi, 7px);
  border: 1px solid var(--line);
  background: #16212f;
  cursor: pointer;
  user-select: none;
  color: var(--text);
  font: inherit;
  transition: transform 0.08s, border-color 0.15s, box-shadow 0.15s;
}
.cell:active:not(:disabled) {
  transform: scale(0.94);
}
.cell img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: brightness(0.42) saturate(0.4);
  transition: filter 0.2s;
}
/* 底部漸層，讓名字看得清楚 */
.cell::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(to top, rgba(5, 10, 18, 0.92) 0%, rgba(5, 10, 18, 0.35) 50%, transparent 85%);
  pointer-events: none;
}
.name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  padding: 1px 2px 3px;
  font-size: clamp(7px, 3.05cqi, 16px);
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.03em;
  text-align: center;
  word-break: break-all;
  text-shadow: 0 1px 2px #000, 0 0 4px #000;
  color: #cfd8e3;
}

.cell.hit {
  border: 2px solid var(--blue);
}
.cell.hit img {
  filter: none;
}
.cell.hit .name {
  color: #fff;
}
/* 蓋章：青色圓圈 */
.cell.hit::after {
  content: '';
  position: absolute;
  inset: 10%;
  z-index: 2;
  border: clamp(2px, 0.8cqi, 4px) solid rgba(10, 200, 185, 0.9);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(10, 200, 185, 0.22), transparent 70%);
  box-shadow: 0 0 6px rgba(10, 200, 185, 0.6);
  pointer-events: none;
}

.cell.win {
  border: 2px solid var(--gold2);
  box-shadow: 0 0 10px rgba(240, 230, 210, 0.55);
}
.cell.win::before {
  background: linear-gradient(to top, rgba(120, 90, 40, 0.95) 0%, rgba(168, 137, 79, 0.45) 50%, rgba(200, 170, 110, 0.18) 100%);
}
.cell.win::after {
  border-color: rgba(255, 236, 190, 0.95);
  background: radial-gradient(circle, rgba(240, 210, 150, 0.25), transparent 70%);
  box-shadow: 0 0 8px rgba(240, 230, 210, 0.7);
}
.cell.win .name {
  color: #fff6dd;
}

.cell.free {
  cursor: default;
  background: linear-gradient(145deg, #3a2e15, #1b2838);
}
.cell.free .name {
  top: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--gold2);
}
.cell.free.win {
  background: linear-gradient(145deg, #a8894f, #785a28);
}
/* 被遣返：空格，不能連線 */
.cell.gone {
  background: repeating-linear-gradient(135deg, #0b1119 0 6px, #111a26 6px 12px);
  border: 1px dashed #4a5566;
  cursor: default;
}
.cell.gone::before {
  display: none;
}
.cell.gone .name {
  color: #5c6878;
  text-decoration: line-through;
}
.gonemark {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-bottom: 14%;
  font-size: clamp(14px, 9cqi, 40px);
  font-weight: 900;
  color: rgba(232, 115, 92, 0.55);
}

/* 炸彈蓋的章：橘色 */
.cell.bomb:not(.win) {
  border-color: #e8935c;
}
.cell.bomb::after {
  border-color: rgba(240, 140, 70, 0.95);
  background: radial-gradient(circle, rgba(240, 140, 70, 0.25), transparent 70%);
  box-shadow: 0 0 6px rgba(240, 140, 70, 0.6);
}
.boom {
  margin-left: 4px;
}

/* 選炸彈落點：整張盤面外框變橘色，滑過的 3×3 亮起來 */
.board.aiming {
  border-color: #e8935c;
  box-shadow: 0 0 14px rgba(232, 147, 92, 0.35);
}
.board.aiming .cell {
  cursor: crosshair;
}
.cell.aim {
  border: 2px solid #ffb27a;
  box-shadow: inset 0 0 0 999px rgba(255, 140, 60, 0.28);
}
.cell.aim img {
  filter: brightness(0.8);
}
/* 選遣返目標：已喊的格子閃一下提示可以點 */
.cell.target {
  border: 2px solid var(--danger);
  animation: pulse 1.1s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    box-shadow: 0 0 10px rgba(232, 115, 92, 0.8);
  }
}
.cell:focus-visible {
  outline: 2px solid var(--gold2);
  outline-offset: 1px;
}
</style>
