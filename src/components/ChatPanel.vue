<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { game, sendChat } from '../game';
import { CHAT_MAX } from '../../shared/validate';

const text = ref('');
const sending = ref(false);
const listEl = ref<HTMLElement | null>(null);
const myId = computed(() => game.session?.playerId);

/** 使用者在看舊訊息時不要硬捲到底 */
function nearBottom() {
  const el = listEl.value;
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}
function scrollToBottom() {
  const el = listEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(
  () => game.chat.length,
  async () => {
    const stick = nearBottom();
    await nextTick();
    if (stick) scrollToBottom();
  },
);
watch(listEl, (el) => el && scrollToBottom());

async function submit() {
  const t = text.value.trim();
  if (!t || sending.value) return;
  sending.value = true;
  const ok = await sendChat(t);
  sending.value = false;
  if (ok) {
    text.value = '';
    await nextTick();
    scrollToBottom();
  }
}

function time(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<template>
  <section class="panel chat">
    <h2 class="panel-title"><span>聊天室</span></h2>
    <div ref="listEl" class="msgs" aria-live="polite">
      <p v-if="!game.chat.length" class="empty muted">還沒有訊息，跟大家打聲招呼吧</p>
      <template v-for="m in game.chat" :key="m.id">
        <div v-if="m.kind === 'system'" class="sys">{{ m.text }}</div>
        <div v-else class="msg" :class="{ me: m.playerId === myId }">
          <span class="who">{{ m.nick }}</span>
          <span class="txt">{{ m.text }}</span>
          <span class="ts">{{ time(m.ts) }}</span>
        </div>
      </template>
    </div>
    <form class="send" @submit.prevent="submit">
      <input
        v-model="text"
        class="field"
        type="text"
        :maxlength="CHAT_MAX"
        placeholder="輸入訊息…"
        aria-label="聊天訊息"
        enterkeyhint="send"
        autocomplete="off"
      />
      <button class="btn primary small" type="submit" :disabled="!text.trim() || sending">送出</button>
    </form>
  </section>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
}
.msgs {
  height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 2px 6px;
  overscroll-behavior: contain;
}
.empty {
  font-size: 13px;
  margin: 0;
}
.sys {
  align-self: center;
  max-width: 100%;
  font-size: 11px;
  color: var(--muted);
  background: var(--panel2);
  border-radius: 999px;
  padding: 2px 10px;
  text-align: center;
}
.msg {
  align-self: flex-start;
  max-width: 88%;
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 10px 10px 10px 2px;
  padding: 4px 8px;
  font-size: 14px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.msg.me {
  align-self: flex-end;
  border-radius: 10px 10px 2px 10px;
  border-color: rgba(10, 200, 185, 0.5);
  background: #0f2a2c;
}
.who {
  display: block;
  font-size: 11px;
  font-weight: 700;
  color: var(--gold);
}
.msg.me .who {
  display: none;
}
.ts {
  margin-left: 6px;
  font-size: 10px;
  color: var(--muted);
}
.send {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.send .field {
  flex: 1;
  min-width: 0;
}
</style>
