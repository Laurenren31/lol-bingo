/** 單一連線的 token bucket 頻率限制：預設最多連發 10 次，之後每秒回補 5 次 */
export function createRateLimiter({
  capacity = 10,
  refillPerSecond = 5,
  now = Date.now,
}: { capacity?: number; refillPerSecond?: number; now?: () => number } = {}) {
  let tokens = capacity;
  let last = now();
  return function allow(): boolean {
    const t = now();
    tokens = Math.min(capacity, tokens + ((t - last) / 1000) * refillPerSecond);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}
