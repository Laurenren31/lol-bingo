// 整合測試：真的開一個 Socket.IO 伺服器（記憶體 store），兩個客戶端連進來玩。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket } from 'socket.io-client';
import { createGameServer } from '../server/io';
import { MemoryStore } from '../server/store/memory';
import { SOCKET_PATH, type ClientToServerEvents, type JoinResult, type RoomState, type ServerToClientEvents } from '../shared/protocol';

type C = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: ReturnType<typeof createGameServer>;
let url = '';
const clients: C[] = [];

beforeAll(async () => {
  server = createGameServer({ store: new MemoryStore(), sweepMs: 60_000 });
  await new Promise<void>((r) => server.httpServer.listen(0, r));
  url = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  clients.forEach((c) => c.disconnect());
  await server.close();
});

async function connect(): Promise<C> {
  const c: C = ioc(url, { path: SOCKET_PATH, addTrailingSlash: false, transports: ['websocket'], forceNew: true });
  clients.push(c);
  await new Promise<void>((res, rej) => {
    c.once('connect', () => res());
    c.once('connect_error', rej);
  });
  return c;
}

function nextState(c: C, pred: (s: RoomState) => boolean = () => true) {
  return new Promise<RoomState>((res) => {
    const h = (s: RoomState) => {
      if (pred(s)) {
        c.off('room:state', h);
        res(s);
      }
    };
    c.on('room:state', h);
  });
}

describe('Socket.IO 流程', () => {
  let a: C;
  let b: C;
  let joinA: JoinResult;
  let joinB: JoinResult;

  it('建立房間、另一人加入', async () => {
    a = await connect();
    b = await connect();
    const ra = await a.emitWithAck('room:create', { nick: '小A' });
    expect(ra.ok).toBe(true);
    if (!ra.ok) return;
    joinA = ra;
    expect(ra.roomCode).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect(ra.boards).toHaveLength(4);

    const seenByA = nextState(a, (s) => s.players.length === 2);
    const rb = await b.emitWithAck('room:join', { roomCode: ra.roomCode.toLowerCase(), nick: '小B' });
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    joinB = rb;
    const s = await seenByA;
    expect(s.players.map((p) => p.nick)).toEqual(['小A', '小B']);
    expect(s.players[0].isHost).toBe(true);
  });

  it('驗證輸入', async () => {
    const c = await connect();
    expect(await c.emitWithAck('room:create', { nick: '' })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(await c.emitWithAck('room:join', { roomCode: 'OOOOOO', nick: 'x' })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(await c.emitWithAck('room:join', { roomCode: 'ZZZZZZ', nick: 'x' })).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(await c.emitWithAck('call:add', { champion: '伊瑞莉雅' })).toMatchObject({ ok: false, code: 'NOT_IN_ROOM' });
    expect(await b.emitWithAck('call:add', { champion: '不存在的英雄' })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(await b.emitWithAck('settings:update', { target: 5 })).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect(await a.emitWithAck('settings:update', { target: 11 })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(
      await c.emitWithAck('room:resume', { roomCode: joinA.roomCode, playerId: joinA.playerId, secret: '0'.repeat(32) }),
    ).toMatchObject({ ok: false, code: 'AUTH' });
  });

  it('喊英雄：全房同步，B 盤面上的格子也算進去', async () => {
    const target = joinB.boards[0];
    const stateA = nextState(a, (s) => s.calls.length === 5);
    for (const i of [0, 1, 2, 3, 4]) {
      const r = await a.emitWithAck('call:add', { champion: target[i] });
      expect(r.ok).toBe(true);
    }
    const s = await stateA;
    expect(s.calls.map((c) => c.byNick)).toEqual(Array(5).fill('小A'));
    expect(s.players.find((p) => p.id === joinB.playerId)!.lines).toBeGreaterThanOrEqual(1);
    const again = await b.emitWithAck('call:add', { champion: target[0] });
    expect(again).toMatchObject({ ok: true, changed: false });
  });

  it('房主調低條數 → 廣播 BINGO', async () => {
    const ann = new Promise<{ nick: string }>((res) => a.once('bingo:announce', res));
    expect(await a.emitWithAck('settings:update', { target: 1 })).toMatchObject({ ok: true });
    expect((await ann).nick).toBe('小B');
  });

  it('取消喊叫後重算', async () => {
    const st = nextState(b, (s) => s.calls.length === 4);
    expect(await b.emitWithAck('call:remove', { champion: joinB.boards[0][2] })).toMatchObject({ ok: true, changed: true });
    const s = await st;
    const me = s.players.find((p) => p.id === joinB.playerId)!;
    expect(me.lines).toBe(0);
    expect(me.bingo).toBe(false);
  });

  it('改張數：收到新盤面', async () => {
    const boards = new Promise<{ boards: string[][] }>((res) => b.once('me:boards', res));
    expect(await b.emitWithAck('boards:setCount', { count: 6 })).toMatchObject({ ok: true });
    expect((await boards).boards).toHaveLength(6);
  });

  it('斷線重連：用 playerId + secret 回到原房間', async () => {
    b.disconnect();
    const b2 = await connect();
    const r = await b2.emitWithAck('room:resume', {
      roomCode: joinB.roomCode,
      playerId: joinB.playerId,
      secret: joinB.secret,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.boards).toHaveLength(6);
    expect(r.state.calls).toHaveLength(4);
    b = b2;
  });

  it('開新的一局（房主）', async () => {
    const st = nextState(b, (s) => s.round === 2);
    expect(await a.emitWithAck('round:new', {})).toMatchObject({ ok: true });
    const s = await st;
    expect(s.calls).toEqual([]);
    expect(s.players.every((p) => !p.bingo)).toBe(true);
  });

  it('頻率限制', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => b.emitWithAck('call:add', { champion: '伊瑞莉雅' })),
    );
    expect(results.some((r) => !r.ok && r.code === 'RATE_LIMIT')).toBe(true);
  });

  it('房主離開：房主交給 B', async () => {
    const st = nextState(b, (s) => s.players.length === 1);
    expect(await a.emitWithAck('room:leave', {})).toMatchObject({ ok: true });
    const s = await st;
    expect(s.hostId).toBe(joinB.playerId);
  });
});
