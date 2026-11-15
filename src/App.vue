<script setup lang="ts">
import HomeView from './views/HomeView.vue';
import RoomView from './views/RoomView.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import ToastMessage from './components/ToastMessage.vue';
import WinDialog from './components/WinDialog.vue';
import { inRoom } from './game';
</script>

<template>
  <RoomView v-if="inRoom" />
  <HomeView v-else />
  <footer class="legal">
    本站為粉絲自製作品，未經 Riot Games 認可，亦不代表 Riot Games 或任何參與製作、管理英雄聯盟之官方人員的觀點。
    英雄聯盟、英雄名稱與圖片皆為 Riot Games, Inc. 的商標或註冊商標。
  </footer>
  <ConfirmDialog />
  <WinDialog />
  <ToastMessage />
</template>

<style scoped>
.legal {
  max-width: 760px;
  margin: 24px auto 0;
  padding: 0 16px 28px;
  font-size: 11px;
  line-height: 1.6;
  color: #5d6d82;
  text-align: center;
}
</style>
