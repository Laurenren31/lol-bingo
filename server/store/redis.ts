// Upstash Redis 版 store。
//
// Key 設計（{code} 是 Redis hash tag，同一房間的 key 會落在同一個 slot）：
//   bingo:room:{code}          hash  v, code, hostId, target, freeCenter, items, boardCount, autoCall, started, autoRunning, nextAutoAt, columnOrder, recalled, round, createdAt, updatedAt, seq, nextJoinOrder
//   bingo:room:{code}:players  hash  playerId → JSON {nick, boardCount, joinOrder, joinedAt, secretHash, bombUsed, recallUsed, marks}
//   bingo:room:{code}:boards   hash  playerId → JSON Board[]
//   bingo:room:{code}:calls    zset  英雄名（score = 喊叫流水號 seq）
//   bingo:room:{code}:callers  hash  英雄名 → JSON {by, byNick}
//   bingo:room:{code}:bingo    hash  playerId → "1"
//   bingo:room:{code}:seen     hash  `${playerId}|${socketId}` / `${playerId}|last` → 毫秒時間
//   bingo:room:{code}:chat     list  聊天訊息 JSON（只留最近 50 則；不經過 Lua 腳本，自己設 TTL）
// 每次寫入都把所有 key 的 TTL 重設為 6 小時。
//
// 寫入用 Lua 腳本做 compare-and-set（比對 v；不依賴 cjson），讀取用 MULTI 一次讀齊，
// 因此可以安全地共用同一條 ioredis 連線。
import type Redis from 'ioredis';
import type { CallData, PlayerData, RoomData } from '../game';
import { DEFAULT_ORDER, isBoardCount, isColumnOrder, type Board } from '../../shared/board';
import type { RecallData } from '../game';
import { CHAT_HISTORY, type ChatMessage } from '../../shared/protocol';
import { GameError } from '../game';
import { ROOM_TTL_SECONDS, type Store } from './types';

const PREFIX = 'bingo:room:';

export function roomKeys(code: string) {
  const base = `${PREFIX}{${code}}`;
  return {
    room: base,
    players: `${base}:players`,
    boards: `${base}:boards`,
    calls: `${base}:calls`,
    callers: `${base}:callers`,
    bingo: `${base}:bingo`,
    seen: `${base}:seen`,
    chat: `${base}:chat`,
  };
}

function keyList(code: string) {
  const k = roomKeys(code);
  return [k.room, k.players, k.boards, k.calls, k.callers, k.bingo, k.seen];
}

// ARGV: [expectedV, ttl, n1..n6（KEYS[1..6] 各自的元素數量）, ...攤平的元素]
const SAVE_SCRIPT = `
local unpack = unpack or table.unpack
local cur =redis.call('HGET', KEYS[1], 'v')
local expected = ARGV[1]
if expected == '' then
  if cur then return 0 end
elseif cur ~= expected then
  return 0
end
local ttl = tonumber(ARGV[2])
local cmds = {'HSET', 'HSET', 'HSET', 'ZADD', 'HSET', 'HSET'}
local pos = 9
for k = 1, 6 do
  redis.call('DEL', KEYS[k])
  local n = tonumber(ARGV[2 + k])
  local i = 0
  while i < n do
    local m = math.min(1000, n - i)
    redis.call(cmds[k], KEYS[k], unpack(ARGV, pos + i, pos + i + m - 1))
    i = i + m
  end
  pos = pos + n
end
for k = 1, 7 do
  if redis.call('EXISTS', KEYS[k]) == 1 then redis.call('EXPIRE', KEYS[k], ttl) end
end
return 1
`;

type SaveFn = (...args: (string | number)[]) => Promise<number>;

function serialize(room: RoomData) {
  const meta = [
    'v', String(room.v),
    'code', room.code,
    'hostId', room.hostId,
    'target', String(room.target),
    'freeCenter', room.freeCenter ? '1' : '0',
    'items', room.items ? '1' : '0',
    'boardCount', String(room.boardCount),
    'autoCall', room.autoCall ? '1' : '0',
    'started', room.started ? '1' : '0',
    'autoRunning', room.autoRunning ? '1' : '0',
    'nextAutoAt', String(room.nextAutoAt),
    'columnOrder', JSON.stringify(room.columnOrder),
    'recalled', JSON.stringify(room.recalled),
    'round', String(room.round),
    'createdAt', String(room.createdAt),
    'updatedAt', String(room.updatedAt),
    'seq', String(room.seq),
    'nextJoinOrder', String(room.nextJoinOrder),
  ];
  const players = Object.entries(room.players).flatMap(([id, p]) => [id, JSON.stringify(p)]);
  const boards = Object.entries(room.boards).flatMap(([id, b]) => [id, JSON.stringify(b)]);
  const calls = room.calls.flatMap((c) => [String(c.seq), c.champion]);
  const callers = room.calls.flatMap((c) => [c.champion, JSON.stringify({ by: c.by, byNick: c.byNick })]);
  const bingo = room.bingo.flatMap((id) => [id, '1']);
  const parts = [meta, players, boards, calls, callers, bingo];
  return [...parts.map((p) => String(p.length)), ...parts.flat()];
}

function parseJson<T>(s: string): T {
  return JSON.parse(s) as T;
}

/** 舊資料沒有這個欄位或格式不對時用預設值 */
function parseOr<T>(s: string | undefined, ok: (v: unknown) => boolean, fallback: T): T {
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return ok(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function deserialize(
  meta: Record<string, string>,
  players: Record<string, string>,
  boards: Record<string, string>,
  calls: string[],
  callers: Record<string, string>,
  bingo: Record<string, string>,
): RoomData {
  const callList: CallData[] = [];
  for (let i = 0; i < calls.length; i += 2) {
    const champion = calls[i];
    const who = callers[champion] ? parseJson<{ by: string; byNick: string }>(callers[champion]) : { by: '', byNick: '' };
    callList.push({ champion, seq: Number(calls[i + 1]), by: who.by, byNick: who.byNick });
  }
  return {
    code: meta.code,
    v: Number(meta.v),
    hostId: meta.hostId ?? '',
    target: Number(meta.target),
    freeCenter: meta.freeCenter === '1',
    items: meta.items === '1',
    boardCount: isBoardCount(Number(meta.boardCount)) ? (Number(meta.boardCount) as 1 | 2 | 4 | 6) : 4,
    autoCall: meta.autoCall === '1',
    // 舊資料沒有這個欄位：當作已經開始（不打斷正在玩的房間）
    started: meta.started === undefined ? true : meta.started === '1',
    autoRunning: meta.autoRunning === '1',
    nextAutoAt: Number(meta.nextAutoAt) || 0,
    columnOrder: parseOr(meta.columnOrder, isColumnOrder, [...DEFAULT_ORDER]),
    recalled: parseOr(meta.recalled, Array.isArray, [] as RecallData[]),
    round: Number(meta.round),
    createdAt: Number(meta.createdAt),
    updatedAt: Number(meta.updatedAt),
    seq: Number(meta.seq),
    nextJoinOrder: Number(meta.nextJoinOrder),
    players: Object.fromEntries(Object.entries(players).map(([id, s]) => [id, parseJson<PlayerData>(s)])),
    boards: Object.fromEntries(Object.entries(boards).map(([id, s]) => [id, parseJson<Board[]>(s)])),
    calls: callList,
    bingo: Object.keys(bingo),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RedisStore implements Store {
  private save: SaveFn;

  constructor(
    private redis: Redis,
    private now: () => number = Date.now,
  ) {
    if (!(redis as unknown as Record<string, unknown>).bingoSave) {
      redis.defineCommand('bingoSave', { numberOfKeys: 7, lua: SAVE_SCRIPT });
    }
    const r = redis as unknown as { bingoSave: SaveFn };
    this.save = (...args) => r.bingoSave(...args);
  }

  async get(code: string): Promise<RoomData | null> {
    const k = roomKeys(code);
    const res = await this.redis
      .multi()
      .hgetall(k.room)
      .hgetall(k.players)
      .hgetall(k.boards)
      .zrange(k.calls, 0, -1, 'WITHSCORES')
      .hgetall(k.callers)
      .hgetall(k.bingo)
      .exec();
    if (!res) throw new GameError('BUSY', '伺服器忙碌，請再試一次');
    for (const [err] of res) if (err) throw err;
    const [meta, players, boards, calls, callers, bingo] = res.map(([, v]) => v) as [
      Record<string, string>,
      Record<string, string>,
      Record<string, string>,
      string[],
      Record<string, string>,
      Record<string, string>,
    ];
    if (!meta || !meta.v) return null;
    return deserialize(meta, players, boards, calls, callers, bingo);
  }

  private async cas(expected: number | null, room: RoomData): Promise<boolean> {
    const ok = await this.save(
      ...keyList(room.code),
      expected === null ? '' : String(expected),
      String(ROOM_TTL_SECONDS),
      ...serialize(room),
    );
    return ok === 1;
  }

  async create(room: RoomData) {
    room.v = 1;
    room.updatedAt = this.now();
    return this.cas(null, room);
  }

  async update<T>(code: string, fn: (room: RoomData) => T) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const room = await this.get(code);
      if (!room) return null;
      const prevV = room.v;
      const result = fn(room);
      room.v = prevV + 1;
      room.updatedAt = this.now();
      if (await this.cas(prevV, room)) return { room, result };
      await sleep(5 + Math.random() * 25 * (attempt + 1));
    }
    throw new GameError('BUSY', '同時操作的人太多，請再試一次');
  }

  async delete(code: string) {
    await this.redis.del(...keyList(code), roomKeys(code).chat);
  }

  async pushChat(code: string, msg: ChatMessage) {
    const key = roomKeys(code).chat;
    const res = await this.redis
      .multi()
      .rpush(key, JSON.stringify(msg))
      .ltrim(key, -CHAT_HISTORY, -1)
      .expire(key, ROOM_TTL_SECONDS)
      .exec();
    for (const [err] of res ?? []) if (err) throw err;
  }

  async getChat(code: string) {
    const raw = await this.redis.lrange(roomKeys(code).chat, 0, -1);
    const out: ChatMessage[] = [];
    for (const s of raw) {
      try {
        out.push(JSON.parse(s) as ChatMessage);
      } catch {
        /* 壞掉的資料就跳過 */
      }
    }
    return out;
  }

  async touchSeen(code: string, fields: Record<string, number>) {
    if (!Object.keys(fields).length) return;
    const key = roomKeys(code).seen;
    await this.redis
      .multi()
      .hset(key, Object.fromEntries(Object.entries(fields).map(([f, t]) => [f, String(t)])))
      .expire(key, ROOM_TTL_SECONDS)
      .exec();
  }

  async editSeen(code: string, remove: string[], set: Record<string, number> = {}) {
    const key = roomKeys(code).seen;
    const m = this.redis.multi();
    if (remove.length) m.hdel(key, ...remove);
    if (Object.keys(set).length) m.hset(key, Object.fromEntries(Object.entries(set).map(([f, t]) => [f, String(t)])));
    m.expire(key, ROOM_TTL_SECONDS);
    await m.exec();
  }

  async getSeen(code: string) {
    const raw = await this.redis.hgetall(roomKeys(code).seen);
    return Object.fromEntries(Object.entries(raw).map(([f, t]) => [f, Number(t)]));
  }
}
