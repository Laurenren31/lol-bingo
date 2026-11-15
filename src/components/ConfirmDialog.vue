<script setup lang="ts">
import { confirmState, closeConfirm } from '../ui';
</script>

<template>
  <div v-if="confirmState.open" class="overlay" @click.self="closeConfirm(false)">
    <div class="dialog" role="dialog" aria-modal="true">
      <h2>{{ confirmState.title }}</h2>
      <p v-if="confirmState.message">{{ confirmState.message }}</p>
      <div class="btns">
        <button class="btn" @click="closeConfirm(false)">取消</button>
        <button class="btn primary" @click="closeConfirm(true)">{{ confirmState.okText }}</button>
      </div>
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
  z-index: 30;
  padding: 20px;
}
.dialog {
  background: var(--panel);
  border: 2px solid var(--gold);
  border-radius: 12px;
  padding: 22px;
  max-width: 340px;
  width: 100%;
  text-align: center;
}
h2 {
  margin: 0 0 8px;
  color: var(--gold2);
  font-size: 19px;
}
p {
  margin: 0 0 18px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.6;
}
.btns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
</style>
