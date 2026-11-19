<script setup lang="ts">
import { computed, ref } from 'vue';
import { createRoom, game, joinRoom, saveNick } from '../game';
import { NICK_MAX, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, normalizeNickname } from '../../shared/validate';
import { toast } from '../ui';

const nick = ref(game.nick);
const code = ref(new URL(location.href).searchParams.get('r')?.toUpperCase().slice(0, ROOM_CODE_LENGTH) ?? '');
const busy = ref(false);

const nickOk = computed(() => normalizeNickname(nick.value) !== null);
const codeOk = computed(() => code.value.length === ROOM_CODE_LENGTH);

function onNick() {
  nick.value = [...nick.value].slice(0, NICK_MAX).join('');
  saveNick(nick.value);
}

/** 只留房號會用到的字元（自動轉大寫，0/O/1/I 直接濾掉） */
function onCode() {
  code.value = code.value
    .toUpperCase()
    .split('')
    .filter((ch) => ROOM_CODE_ALPHABET.includes(ch))
    .join('')
    .slice(0, ROOM_CODE_LENGTH);
}

function checkNick(): string | null {
  const n = normalizeNickname(nick.value);
  if (!n) toast('請先輸入暱稱（1–12 字）');
  return n;
}

async function run(fn: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  try {
    await fn();
  } finally {
    busy.value = false;
  }
}

function onCreate() {
  const n = checkNick();
  if (n) run(() => createRoom(n));
}

function onJoin() {
  const n = checkNick();
  if (!n) return;
  if (!codeOk.value) return toast('請輸入 6 碼房號');
  run(() => joinRoom(code.value, n));
}
</script>

<template>
  <main class="home">
    <h1>英雄聯盟賓果</h1>
    <p class="sub">每一直排一種角色：鬥士、坦克、法師、射手、輔刺（每局順序隨機）<br />大家共用一份已喊清單，連線數達標就 BINGO！</p>

    <section class="panel card">
      <label class="label" for="nick">暱稱</label>
      <input
        id="nick"
        v-model="nick"
        class="field"
        type="text"
        :maxlength="NICK_MAX * 2"
        placeholder="輸入你的暱稱（最多 12 字）"
        autocomplete="nickname"
        @input="onNick"
      />

      <button class="btn primary wide" :disabled="busy || !nickOk" @click="onCreate">建立房間</button>

      <div class="or"><span>或加入朋友的房間</span></div>

      <div class="joinrow">
        <input
          v-model="code"
          class="field code"
          type="text"
          inputmode="text"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          placeholder="6 碼房號"
          @input="onCode"
          @keydown.enter="onJoin"
        />
        <button class="btn" :disabled="busy || !nickOk || !codeOk" @click="onJoin">加入房間</button>
      </div>
      <p v-if="game.conn !== 'connected'" class="conn muted">連線伺服器中…</p>
    </section>

    <section class="how muted">
      <p>📌 點自己盤面上的格子＝喊那位英雄，再點一次可以取消。</p>
      <p>📌 也可以用輸入框喊不在你盤面上的英雄，所有人有他的格子都會蓋章。</p>
      <p>📌 每人可以選 1、2、4 或 6 張，所有盤面的連線數加總達到房主設定的條數就 BINGO。</p>
    </section>
  </main>
</template>

<style scoped>
.home {
  max-width: 440px;
  margin: 0 auto;
  padding: calc(32px + env(safe-area-inset-top)) 16px 0;
}
h1 {
  margin: 0 0 6px;
  text-align: center;
  font-weight: 900;
  font-size: 32px;
  letter-spacing: 4px;
  color: var(--gold2);
  text-shadow: 0 0 18px rgba(200, 170, 110, 0.35);
}
.sub {
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
  margin: 0 0 20px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
}
.label {
  font-size: 13px;
  color: var(--muted);
  font-weight: 700;
}
.wide {
  width: 100%;
  margin-top: 4px;
}
.or {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: 12px;
  margin: 6px 0 2px;
}
.or::before,
.or::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}
.joinrow {
  display: flex;
  gap: 8px;
}
.code {
  flex: 1;
  letter-spacing: 4px;
  font-weight: 700;
  text-transform: uppercase;
}
.code::placeholder {
  letter-spacing: 1px;
  font-weight: 500;
}
.conn {
  font-size: 12px;
  text-align: center;
  margin: 0;
}
.how {
  margin-top: 18px;
  font-size: 13px;
  line-height: 1.6;
}
.how p {
  margin: 0 0 6px;
}
</style>
