// 依環境變數決定用 Redis 或記憶體。
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { MemoryStore } from './store/memory';
import { RedisStore } from './store/redis';
import type { Store } from './store/types';

export function createRuntimeFromEnv(): { store: Store; adapter?: unknown; mode: 'redis' | 'memory' } {
  const url = process.env.REDIS_URL || process.env.KV_URL;
  if (!url) {
    if (process.env.VERCEL) {
      console.error(
        '[lol-bingo] 沒有設定 REDIS_URL（或 KV_URL）！目前改用記憶體暫存，不同 instance 之間不會同步。請到 Vercel 專案連結 Upstash Redis。',
      );
    }
    return { store: new MemoryStore(), mode: 'memory' };
  }
  const pub = new Redis(url, { maxRetriesPerRequest: 3, enableReadyCheck: true });
  const sub = pub.duplicate();
  for (const [name, c] of [['pub', pub], ['sub', sub]] as const) {
    c.on('error', (e) => console.error(`[redis:${name}]`, e.message));
  }
  return {
    store: new RedisStore(pub),
    adapter: createAdapter(pub, sub, { key: 'bingo:sio' }),
    mode: 'redis',
  };
}
