// 本機開發用的 Socket.IO 伺服器（與 Vercel 上的 api/socket-io.ts 共用同一份邏輯）。
try {
  process.loadEnvFile('.env.local');
} catch {
  /* 沒有 .env.local 就用記憶體模式 */
}

import { createGameServer } from './io';
import { createRuntimeFromEnv } from './runtime';

const port = Number(process.env.API_PORT ?? 3001);
const { store, adapter, mode } = createRuntimeFromEnv();
const { httpServer } = createGameServer({ store, adapter });

httpServer.listen(port, () => {
  console.log(`[api] Socket.IO 伺服器 http://localhost:${port}（儲存：${mode === 'redis' ? 'Redis' : '記憶體'}）`);
});
