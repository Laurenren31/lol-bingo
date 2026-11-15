import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

const API_PORT = Number(process.env.API_PORT ?? 3001);

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    host: true, // 讓同一個 Wi-Fi 的手機也能連進來測試
    proxy: {
      // 本機開發：把 Socket.IO 的 WebSocket 轉給 server/dev.ts
      '/api/socket-io': {
        target: `http://localhost:${API_PORT}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
