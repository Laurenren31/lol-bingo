<script setup lang="ts">
import { game } from '../game';
</script>

<template>
  <div v-if="game.winOpen" class="overlay" @click.self="game.winOpen = false">
    <div class="dialog">
      <div class="banner">BINGO!</div>
      <p>你的盤面合計 {{ game.winLines }} 條線，大聲喊出來！<br />已經通知房間裡的所有人。</p>
      <button class="btn primary" @click="game.winOpen = false">繼續</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 35;
  padding: 20px;
}
.dialog {
  background: var(--panel);
  border: 2px solid var(--gold);
  border-radius: 12px;
  padding: 24px 22px;
  max-width: 340px;
  width: 100%;
  text-align: center;
}
.banner {
  font-size: 46px;
  font-weight: 900;
  letter-spacing: 6px;
  color: var(--gold);
  text-shadow: 0 0 24px rgba(240, 230, 210, 0.6);
  animation: pop 0.5s ease;
}
p {
  margin: 10px 0 18px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.7;
}
.btn {
  width: 100%;
}
</style>
