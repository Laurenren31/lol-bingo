// RedisStore（Lua compare-and-set、序列化、TTL）用 ioredis-mock 測試
import { describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import { RedisStore, roomKeys } from '../server/store/redis';
import { addPlayer, callChampion, evaluateBingo, newRoom, newRound, setBoardCount, useBomb, useRecall } from '../server/game';
import { isValidBoard } from '../shared/board';

const rand = (n: number) => Math.floor(Math.random() * n);
const A = 'aaaaaaaaaaaa';
const B = 'bbbbbbbbbbbb';

async function setup(code: string) {
  const redis = new RedisMock() as Redis;
  const store = new RedisStore(redis);
  const room = newRoom(code, Date.now());
  addPlayer(room, A, '小A', 'h', Date.now(), rand);
  addPlayer(room, B, '小B', 'h', Date.now(), rand);
  expect(await store.create(room)).toBe(true);
  return { redis, store, room };
}

describe('RedisStore', () => {
  it('建立、重複房號擋下、讀回內容一致', async () => {
    const { store, room } = await setup('RDS234');
    expect(await store.create(room)).toBe(false);
    const got = (await store.get('RDS234'))!;
    expect(got.v).toBe(1);
    expect(got.boards).toEqual(room.boards);
    expect(got.players[A].nick).toBe('小A');
    expect(got.hostId).toBe(A);
  });

  it('更新：喊叫順序、喊的人、BINGO 狀態都能存回', async () => {
    const { store } = await setup('RDS235');
    const b = (await store.get('RDS235'))!.boards[B][0];
    for (const i of [0, 1, 2, 3, 4]) {
      await store.update('RDS235', (r) => {
        r.target = 1;
        callChampion(r, A, b[i]);
        return evaluateBingo(r);
      });
    }
    const r = (await store.get('RDS235'))!;
    expect(r.v).toBe(6);
    expect(r.calls.map((c) => c.champion)).toEqual(b.slice(0, 5));
    expect(r.calls.map((c) => c.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(r.calls[0].byNick).toBe('小A');
    expect(r.bingo).toContain(B);
  });

  it('道具設定、張數、炸彈標記都能存回', async () => {
    const { store } = await setup('RDS23A');
    await store.update('RDS23A', (r) => {
      r.items = true;
      setBoardCount(r, A, 2, rand);
      useBomb(r, B, 1, 0);
    });
    const r = (await store.get('RDS23A'))!;
    expect(r.items).toBe(true);
    expect(r.boardCount).toBe(2);
    expect(r.boards[B]).toHaveLength(2);
    expect(r.players[B]).toMatchObject({ bombUsed: true, marks: [[], [0, 1, 5, 6]] });
  });

  it('直排順序、遣返清單、自動叫號狀態都能存回', async () => {
    const { store } = await setup('RDS23C');
    await store.update('RDS23C', (r) => {
      r.items = true;
      r.autoCall = true;
      newRound(r, A, rand, 5000);
      r.autoRunning = false;
      callChampion(r, A, '安妮');
      useRecall(r, B, '安妮');
      r.autoRunning = true;
    });
    const before = (await store.get('RDS23C'))!;
    expect(before.autoCall).toBe(true);
    expect(before.autoRunning).toBe(true);
    expect(before.nextAutoAt).toBe(15000);
    expect(before.recalled).toEqual([{ champion: '安妮', by: B, byNick: '小B', calledByNick: '小A' }]);
    expect([...before.columnOrder].sort()).toEqual([0, 1, 2, 3, 4]);
    before.boards[A].forEach((b) => expect(isValidBoard(b, before.columnOrder)).toBe(true));
  });

  it('聊天：只留最近 50 則，刪房一起刪', async () => {
    const { redis, store } = await setup('RDS23B');
    for (let i = 0; i < 55; i++) {
      await store.pushChat('RDS23B', { id: String(i), kind: 'user', playerId: A, nick: '小A', text: '訊息' + i, ts: i });
    }
    const chat = await store.getChat('RDS23B');
    expect(chat).toHaveLength(50);
    expect(chat[0].text).toBe('訊息5');
    expect(chat.at(-1)!.text).toBe('訊息54');
    expect(await redis.ttl(roomKeys('RDS23B').chat)).toBeGreaterThan(0);
    await store.delete('RDS23B');
    expect(await store.getChat('RDS23B')).toEqual([]);
  });

  it('同時更新不會互相蓋掉（樂觀鎖重試）', async () => {
    const { store } = await setup('RDS236');
    const names = ['伊瑞莉雅', '亞歷斯塔', '安妮', '艾希', '索娜', '慎'];
    await Promise.all(names.map((n) => store.update('RDS236', (r) => callChampion(r, B, n))));
    const r = (await store.get('RDS236'))!;
    expect(r.calls.map((c) => c.champion).sort()).toEqual([...names].sort());
  });

  it('fn 丟錯就不寫入', async () => {
    const { store } = await setup('RDS237');
    await expect(store.update('RDS237', (r) => newRound(r, B, rand, Date.now()))).rejects.toThrow(/房主/);
    expect((await store.get('RDS237'))!.v).toBe(1);
  });

  it('清空的清單也能正確存回；TTL 6 小時；刪除', async () => {
    const { store, redis } = await setup('RDS238');
    await store.update('RDS238', (r) => callChampion(r, A, '安妮'));
    await store.update('RDS238', (r) => newRound(r, A, rand, Date.now()));
    const r = (await store.get('RDS238'))!;
    expect(r.calls).toEqual([]);
    expect(r.round).toBe(2);
    const ttl = await redis.ttl(roomKeys('RDS238').players);
    expect(ttl).toBeGreaterThan(21000);
    expect(ttl).toBeLessThanOrEqual(21600);
    await store.delete('RDS238');
    expect(await store.get('RDS238')).toBeNull();
  });

  it('在線 seen 欄位', async () => {
    const { store } = await setup('RDS239');
    await store.touchSeen('RDS239', { [`${A}|s1`]: 123 });
    await store.editSeen('RDS239', [`${A}|s1`], { [`${A}|last`]: 456 });
    expect(await store.getSeen('RDS239')).toEqual({ [`${A}|last`]: 456 });
  });

  it('房號不存在回傳 null', async () => {
    const store = new RedisStore(new RedisMock() as Redis);
    expect(await store.get('NOPE22')).toBeNull();
    expect(await store.update('NOPE22', () => 1)).toBeNull();
  });
});
