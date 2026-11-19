// 整合測試：真的開一個 Socket.IO 伺服器（記憶體 store），兩個客戶端連進來玩。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket } from 'socket.io-client';
import { createGameServer } from '../server/io';
import { MemoryStore } from '../server/store/memory';
import { SOCKET_PATH, type ChatMessage, type ClientToServerEvents, type JoinResult, type RoomState, type ServerToClientEvents } from '../shared/protocol';

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

/** 每條連線有頻率限制（連發 10 次、每秒回補 5 次），連續好幾個測試之間先讓它回補 */
const rest = () => new Promise((r) => setTimeout(r, 2100));

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

  it('沒開道具不能遣返；房主開道具後，強制遣返會重算並發系統訊息', async () => {
    const champ = joinB.boards[0][2];
    expect(await b.emitWithAck('item:recall', { champion: champ })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(await b.emitWithAck('settings:update', { items: true })).toMatchObject({ ok: false, code: 'NOT_HOST' });
    const on = nextState(b, (s) => s.settings.items);
    expect(await a.emitWithAck('settings:update', { items: true })).toMatchObject({ ok: true });
    expect((await on).players.every((p) => p.hasBomb && p.hasRecall)).toBe(true);

    const st = nextState(b, (s) => s.calls.length === 4);
    const msg = new Promise<ChatMessage>((res) => a.once('chat:message', res));
    expect(await b.emitWithAck('item:recall', { champion: champ })).toMatchObject({ ok: true });
    const s = await st;
    const me = s.players.find((p) => p.id === joinB.playerId)!;
    expect(me.lines).toBe(0);
    expect(me.bingo).toBe(false);
    expect(me.hasRecall).toBe(false);
    expect((await msg).text).toContain('強制遣返');
    expect(await b.emitWithAck('item:recall', { champion: joinB.boards[0][0] })).toMatchObject({ ok: false });
  });

  it('炸彈：只更新自己的盤面標記', async () => {
    await rest();
    const mine = new Promise<{ marks: number[][] }>((res) => b.once('me:boards', res));
    let aGotBoards = false;
    a.once('me:boards', () => (aGotBoards = true));
    const st = nextState(a, (s) => !s.players.find((p) => p.id === joinB.playerId)!.hasBomb);
    expect(await b.emitWithAck('item:bomb', { board: 0, cell: 12 })).toMatchObject({ ok: true });
    expect((await mine).marks[0]).toEqual([6, 7, 8, 11, 12, 13, 16, 17, 18]);
    await st;
    expect(aGotBoards).toBe(false);
  });

  it('改張數：只有房主能改，全房都收到新盤面', async () => {
    expect(await b.emitWithAck('boards:setCount', { count: 6 })).toMatchObject({ ok: false, code: 'NOT_HOST' });
    const boardsA = new Promise<{ boards: string[][] }>((res) => a.once('me:boards', res));
    const boardsB = new Promise<{ boards: string[][]; marks: number[][] }>((res) => b.once('me:boards', res));
    expect(await a.emitWithAck('boards:setCount', { count: 6 })).toMatchObject({ ok: true });
    expect((await boardsA).boards).toHaveLength(6);
    const nb = await boardsB;
    expect(nb.boards).toHaveLength(6);
    expect(nb.marks.flat()).toEqual([]);
  });

  it('聊天：全房收到，重新進房拿得到歷史', async () => {
    await rest();
    const got = new Promise<ChatMessage>((res) => {
      const h = (m: ChatMessage) => {
        if (m.kind === 'user') {
          a.off('chat:message', h);
          res(m);
        }
      };
      a.on('chat:message', h);
    });
    expect(await b.emitWithAck('chat:send', { text: '  大家好  ' })).toMatchObject({ ok: true });
    expect(await b.emitWithAck('chat:send', { text: '' })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(await b.emitWithAck('chat:send', { text: 'x'.repeat(101) })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    const m = await got;
    expect(m).toMatchObject({ nick: '小B', text: '大家好', playerId: joinB.playerId });
    const c = await connect();
    expect(await c.emitWithAck('chat:send', { text: 'hi' })).toMatchObject({ ok: false, code: 'NOT_IN_ROOM' });
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
    expect(r.chat.some((m) => m.kind === 'user' && m.text === '大家好')).toBe(true);
    expect(r.chat.some((m) => m.kind === 'system' && m.text.includes('小B 加入'))).toBe(true);
    b = b2;
  });

  it('開新的一局（房主）：道具補滿', async () => {
    await rest();
    const st = nextState(b, (s) => s.round === 2);
    expect(await a.emitWithAck('round:new', {})).toMatchObject({ ok: true });
    const s = await st;
    expect(s.calls).toEqual([]);
    expect(s.players.every((p) => !p.bingo)).toBe(true);
    expect(s.players.every((p) => p.hasBomb && p.hasRecall)).toBe(true);
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
