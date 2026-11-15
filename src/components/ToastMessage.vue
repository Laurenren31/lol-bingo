<script setup lang="ts">
import { toastState } from '../ui';
</script>

<template>
  <div class="toast" :class="{ show: toastState.show, gold: toastState.gold }" role="status" aria-live="polite">
    {{ toastState.text }}
  </div>
</template>

<style scoped>
.toast {
  position: fixed;
  left: 50%;
  bottom: calc(24px + env(safe-area-inset-bottom));
  transform: translateX(-50%) translateY(10px);
  max-width: calc(100vw - 32px);
  background: #1a2533;
  border: 1px solid var(--line);
  color: var(--text);
  padding: 10px 18px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 14px;
  z-index: 40;
  opacity: 0;
  transition: opacity 0.25s, transform 0.25s;
  pointer-events: none;
  text-align: center;
}
.toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.toast.gold {
  background: #3a2e15;
  border-color: var(--gold);
  color: var(--gold2);
}
</style>
