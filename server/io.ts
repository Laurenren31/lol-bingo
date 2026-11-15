import http from 'node:http';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import { isChampion } from '../shared/champions';
import { isBoardCount, type RandInt } from '../shared/board';
import {
  MAX_PLAYERS,
  type Ack,
  type BingoAnnounce,
  type ClientToServerEvents,
  type ErrorCode,
  type Failure,
  type JoinResult,
  type ServerToClientEvents,
} from '../shared/protocol';
import {
  generateRoomCode,
  isPlayerId,
  isSecret,
  isTarget,
  normalizeNickname,
  normalizeRoomCode,
} from '../shared/validate';
import {
  GameError,
  SEEN_LAST,
  addPlayer,
  callChampion,
  evaluateBingo,
  newRoom,
  newRound,
  presenceFromSeen,
  removePlayer,
  seenField,
  setBoardCount,
  toPublicState,
  transferHostIfNeeded,
  uncallChampion,
  updateSettings,
  type RoomData,
} from './game';
import { createRateLimiter } from './rateLimit';
import type { Store } from './store/types';

interface SocketData {
  code?: string;
  pid?: string;
}
type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type GSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface GameServerOptions {
  store: Store;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter?: any;
  now?: () => number;
  rand?: RandInt;
  /** 心跳／房主檢查間隔，預設 15 秒 */
  sweepMs?: number;
}

const cryptoRandInt: RandInt = (n) => randomInt(n);
const SEEN_PRUNE_MS = 10 * 60_000;

function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex');
}
function secretMatches(secret: string, hash: string) {
  const a = Buffer.from(sha256(secret), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
function newPlayerId() {
  return randomBytes(8).toString('hex');
}
function newSecret() {
  return randomBytes(16).toString('hex');
}

function fail(code: ErrorCode, message: string): Failure {
  return { ok: false, code, message };
}
function bad(message: string): never {
  throw new GameError('BAD_INPUT', message);
}
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 不管 Vercel 傳進來的是 /api/socket-io/socket.io/?EIO=4… 還是改寫後的 /api/socket-io?EIO=4…，
 * 都轉成 Socket.IO 預設的 /socket.io/?EIO=4…
 */
function normalizeSocketPath(req: http.IncomingMessage) {
  const url = req.url ?? '/';
  const q = url.indexOf('?');
  const path = q >= 0 ? url.slice(0, q) : url;
  if (path.startsWith('/api/socket-io')) req.url = '/socket.io/' + (q >= 0 ? url.slice(q) : '');
}

export function createGameServer(opts: GameServerOptions) {
  const store = opts.store;
  const now = opts.now ?? Date.now;
  const rand = opts.rand ?? cryptoRandInt;

  const httpServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('lol-bingo socket server');
  });

  const io: IO = new Server(httpServer, {
    path: '/socket.io',
    transports: ['websocket'],
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });
  if (opts.adapter) io.adapter(opts.adapter);
  // 要排在 engine.io 的 listener 前面
  httpServer.prependListener('request', normalizeSocketPath);
  httpServer.prependListener('upgrade', normalizeSocketPath);

  const playerRoom = (code: string, pid: string) => `p:${code}:${pid}`;
  const lastSig = new Map<string, string>();

  async function broadcast(code: string, room?: RoomData | null) {
    room ??= await store.get(code);
    if (!room) return;
    const presence = presenceFromSeen(await store.getSeen(code), now());
    const state = toPublicState(room, presence);
    lastSig.set(code, signature(state.hostId, presence.online));
    io.to(code).emit('room:state', state);
  }

  function signature(hostId: string, online: Set<string>) {
    return hostId + '#' + [...online].sort().join(',');
  }

  function announce(code: string, list: BingoAnnounce[]) {
    for (const a of list) io.to(code).emit('bingo:announce', a);
  }

  async function publicStateOf(room: RoomData) {
    return toPublicState(room, presenceFromSeen(await store.getSeen(room.code), now()));
  }

  /** 檢查房主是否該換人；需要時寫入並回傳 true */
  async function checkHost(code: string): Promise<boolean> {
    const room = await store.get(code);
    if (!room) return false;
    const t = now();
    const presence = presenceFromSeen(await store.getSeen(code), t);
    if (!transferHostIfNeeded(structuredClone(room), presence, t)) return false;
    const res = await store.update(code, (r) => transferHostIfNeeded(r, presence, t));
    if (res?.result) await broadcast(code, res.room);
    return !!res?.result;
  }

  async function attach(socket: GSocket, code: string, pid: string) {
    if (socket.data.code && (socket.data.code !== code || socket.data.pid !== pid)) await detach(socket, false);
    socket.data.code = code;
    socket.data.pid = pid;
    await socket.join([code, playerRoom(code, pid)]);
    await store.touchSeen(code, { [seenField(pid, socket.id)]: now() });
  }

  async function detach(socket: GSocket, removeAll: boolean) {
    const { code, pid } = socket.data;
    if (!code || !pid) return;
    socket.data.code = undefined;
    socket.data.pid = undefined;
    await socket.leave(code);
    await socket.leave(playerRoom(code, pid));
    if (removeAll) {
      const seen = await store.getSeen(code);
      await store.editSeen(code, Object.keys(seen).filter((f) => f.startsWith(pid + '|')));
    } else {
      await store.editSeen(code, [seenField(pid, socket.id)], { [seenField(pid, SEEN_LAST)]: now() });
    }
  }

  function member(socket: GSocket) {
    const { code, pid } = socket.data;
    if (!code || !pid) throw new GameError('NOT_IN_ROOM', '你還沒有加入房間');
    return { code, pid };
  }

  async function mutate<T>(code: string, fn: (room: RoomData) => T) {
    const res = await store.update(code, fn);
    if (!res) throw new GameError('ROOM_NOT_FOUND', '房間不存在或已經過期');
    return res;
  }

  async function joinResult(socket: GSocket, room: RoomData, pid: string, secret: string): Promise<Ack<JoinResult>> {
    await attach(socket, room.code, pid);
    return {
      ok: true,
      roomCode: room.code,
      playerId: pid,
      secret,
      state: await publicStateOf(room),
      boards: room.boards[pid] ?? [],
    };
  }

  io.on('connection', (socket: GSocket) => {
    const allow = createRateLimiter({ capacity: 10, refillPerSecond: 5, now });

    function on(event: keyof ClientToServerEvents, impl: (p: Record<string, unknown>) => Promise<unknown>) {
      socket.on(event, (async (payload: unknown, ack: unknown) => {
        const reply = typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {};
        if (!allow()) return reply(fail('RATE_LIMIT', '操作太頻繁，請稍候再試'));
        try {
          reply(await impl(isObject(payload) ? payload : {}));
        } catch (e) {
          if (e instanceof GameError) return reply(fail(e.code, e.message));
          console.error(`[socket] ${event} failed`, e);
          reply(fail('INTERNAL', '伺服器發生錯誤，請再試一次'));
        }
      }) as never);
    }

    on('room:create', async (p) => {
      const nick = normalizeNickname(p.nick) ?? bad('暱稱需為 1–12 個字，且不可含特殊控制字元');
      const pid = newPlayerId();
      const secret = newSecret();
      for (let i = 0; i < 8; i++) {
        const room = newRoom(generateRoomCode(rand), now());
        addPlayer(room, pid, nick, sha256(secret), now(), rand);
        if (await store.create(room)) return joinResult(socket, room, pid, secret);
      }
      throw new GameError('BUSY', '建立房間失敗，請再試一次');
    });

    on('room:join', async (p) => {
      const code = normalizeRoomCode(p.roomCode) ?? bad('房號是 6 碼英數字');
      const nick = normalizeNickname(p.nick) ?? bad('暱稱需為 1–12 個字，且不可含特殊控制字元');
      const reuse = isPlayerId(p.playerId) && isSecret(p.secret) ? { pid: p.playerId, secret: p.secret } : null;
      const { room, result } = await mutate(code, (r) => {
        if (reuse && r.players[reuse.pid] && secretMatches(reuse.secret, r.players[reuse.pid].secretHash)) {
          r.players[reuse.pid].nick = nick;
          return { ...reuse, announces: [] as BingoAnnounce[] };
        }
        if (Object.keys(r.players).length >= MAX_PLAYERS) throw new GameError('ROOM_FULL', `房間已滿（最多 ${MAX_PLAYERS} 人）`);
        const pid = newPlayerId();
        const secret = newSecret();
        addPlayer(r, pid, nick, sha256(secret), now(), rand);
        return { pid, secret, announces: evaluateBingo(r) };
      });
      const ack = await joinResult(socket, room, result.pid, result.secret);
      announce(code, result.announces);
      if (!(await checkHost(code))) await broadcast(code, room);
      return ack;
    });

    on('room:resume', async (p) => {
      const code = normalizeRoomCode(p.roomCode) ?? bad('房號格式不正確');
      if (!isPlayerId(p.playerId) || !isSecret(p.secret)) throw new GameError('AUTH', '找不到你的玩家資料');
      const room = await store.get(code);
      if (!room) throw new GameError('ROOM_NOT_FOUND', '房間不存在或已經過期');
      const player = room.players[p.playerId];
      if (!player || !secretMatches(p.secret, player.secretHash)) throw new GameError('AUTH', '找不到你的玩家資料');
      const ack = await joinResult(socket, room, p.playerId, p.secret);
      if (!(await checkHost(code))) await broadcast(code, room);
      return ack;
    });

    on('room:leave', async () => {
      const { code, pid } = member(socket);
      const presence = presenceFromSeen(await store.getSeen(code), now());
      presence.online.delete(pid);
      const res = await store.update(code, (r) => removePlayer(r, pid, presence));
      // 同一位玩家的其他分頁也一起踢出
      io.in(playerRoom(code, pid)).socketsLeave([code, playerRoom(code, pid)]);
      await detach(socket, true);
      if (res?.result.empty) await store.delete(code);
      else if (res) await broadcast(code, res.room);
      return { ok: true };
    });

    on('boards:setCount', async (p) => {
      const { code, pid } = member(socket);
      if (!isBoardCount(p.count)) bad('張數只能是 1、2、4 或 6');
      const { room, result } = await mutate(code, (r) => {
        setBoardCount(r, pid, p.count as 1 | 2 | 4 | 6, rand);
        return evaluateBingo(r);
      });
      io.to(playerRoom(code, pid)).emit('me:boards', { boards: room.boards[pid] });
      announce(code, result);
      await broadcast(code, room);
      return { ok: true };
    });

    on('call:add', async (p) => {
      const { code, pid } = member(socket);
      if (!isChampion(p.champion)) bad('找不到這位英雄');
      const champion = p.champion as string;
      const { room, result } = await mutate(code, (r) => {
        const changed = callChampion(r, pid, champion);
        return { changed, announces: evaluateBingo(r) };
      });
      if (result.changed) {
        announce(code, result.announces);
        await broadcast(code, room);
      }
      return { ok: true, changed: result.changed };
    });

    on('call:remove', async (p) => {
      const { code, pid } = member(socket);
      if (!isChampion(p.champion)) bad('找不到這位英雄');
      const champion = p.champion as string;
      const { room, result } = await mutate(code, (r) => {
        const changed = uncallChampion(r, pid, champion);
        evaluateBingo(r);
        return changed;
      });
      if (result) await broadcast(code, room);
      return { ok: true, changed: result };
    });

    on('settings:update', async (p) => {
      const { code, pid } = member(socket);
      const patch: { target?: number; freeCenter?: boolean } = {};
      if (p.target !== undefined) {
        if (!isTarget(p.target)) bad('條數需為 1–10');
        patch.target = p.target as number;
      }
      if (p.freeCenter !== undefined) {
        if (typeof p.freeCenter !== 'boolean') bad('免費格設定不正確');
        patch.freeCenter = p.freeCenter;
      }
      const { room, result } = await mutate(code, (r) => {
        updateSettings(r, pid, patch);
        return evaluateBingo(r);
      });
      announce(code, result);
      await broadcast(code, room);
      return { ok: true };
    });

    on('round:new', async () => {
      const { code, pid } = member(socket);
      const { room } = await mutate(code, (r) => {
        newRound(r, pid);
      });
      await broadcast(code, room);
      return { ok: true };
    });

    socket.on('disconnect', () => {
      const { code } = socket.data;
      if (!code) return;
      detach(socket, false)
        .then(() => broadcast(code))
        .catch((e) => console.error('[socket] disconnect cleanup failed', e));
    });
  });

  /** 定期：替本 instance 上的連線寫心跳、檢查房主、在線狀態有變就廣播 */
  async function sweep() {
    const byRoom = new Map<string, Record<string, number>>();
    const t = now();
    for (const s of io.of('/').sockets.values()) {
      const { code, pid } = s.data;
      if (!code || !pid) continue;
      const fields = byRoom.get(code) ?? {};
      fields[seenField(pid, s.id)] = t;
      byRoom.set(code, fields);
    }
    for (const code of [...lastSig.keys()]) if (!byRoom.has(code)) lastSig.delete(code);
    for (const [code, fields] of byRoom) {
      try {
        await store.touchSeen(code, fields);
        const seen = await store.getSeen(code);
        const stale = Object.entries(seen)
          .filter(([, ts]) => t - ts > SEEN_PRUNE_MS)
          .map(([f]) => f);
        if (stale.length) await store.editSeen(code, stale);
        if (await checkHost(code)) continue;
        const room = await store.get(code);
        if (!room) continue;
        const presence = presenceFromSeen(seen, t);
        if (lastSig.get(code) !== signature(room.hostId, presence.online)) await broadcast(code, room);
      } catch (e) {
        console.error('[sweep] failed for room', code, e);
      }
    }
  }

  let sweeping = false;
  const timer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    sweep().finally(() => (sweeping = false));
  }, opts.sweepMs ?? 15_000);
  timer.unref();

  return {
    httpServer,
    io,
    sweep,
    async close() {
      clearInterval(timer);
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
