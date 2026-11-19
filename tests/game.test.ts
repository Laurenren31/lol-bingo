import { describe, expect, it } from 'vitest';
import {
  HOST_GRACE_MS,
  GameError,
  AUTO_CALLER_NICK,
  addPlayer,
  autoCallTick,
  callChampion,
  evaluateBingo,
  linesOf,
  newRoom,
  newRound,
  presenceFromSeen,
  removePlayer,
  seenField,
  setBoardCount,
  startRound,
  toPublicState,
  transferHostIfNeeded,
  updateSettings,
  useBomb,
  useRecall,
  type RoomData,
} from '../server/game';
import { DEFAULT_ORDER, bombArea, generateBoard, isValidBoard } from '../shared/board';
import { CHAMPION_NAMES } from '../shared/champions';
import { AUTO_CALL_MS } from '../shared/protocol';
import { ROOM_CODE_ALPHABET, generateRoomCode, normalizeChat, normalizeNickname, normalizeRoomCode } from '../shared/validate';

const rand = (n: number) => Math.floor(Math.random() * n);
const T0 = 1_000_000;

function roomWith(...nicks: string[]): RoomData {
  const r = newRoom('ABC234', T0);
  nicks.forEach((n, i) => addPlayer(r, `p${i}aaaaaaaa`, n, 'x', T0 + i, rand));
  return r;
}
const P = (i: number) => `p${i}aaaaaaaa`;
/** 房主按「開始」 */
const start = (r: RoomData) => startRound(r, P(0), T0);

/** 只保留某位玩家、不含炸彈標記的複本，用來比較條數 */
function roomWithBoards(r: RoomData, pid: string): RoomData {
  const c = structuredClone(r);
  c.players = { [pid]: { ...c.players[pid], marks: [] } };
  return c;
}

function callLine(r: RoomData, pid: string, board = 0, cells = [0, 1, 2, 3, 4]) {
  for (const i of cells) callChampion(r, pid, r.boards[pid][board][i]);
}

describe('房號與暱稱', () => {
  it('房號 6 碼、不含 0/O/1/I', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[0O1I]/);
    for (let i = 0; i < 500; i++) {
      const c = generateRoomCode(rand);
      expect(c).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
      expect(normalizeRoomCode(c.toLowerCase())).toBe(c);
    }
    expect(normalizeRoomCode('ABC10O')).toBeNull();
    expect(normalizeRoomCode('ABC23')).toBeNull();
    expect(normalizeRoomCode(123456)).toBeNull();
  });

  it('暱稱 1–12 字、去頭尾空白、擋控制字元', () => {
    expect(normalizeNickname('  小明  ')).toBe('小明');
    expect(normalizeNickname('一二三四五六七八九十一二')).toBe('一二三四五六七八九十一二');
    expect(normalizeNickname('一二三四五六七八九十一二三')).toBeNull();
    expect(normalizeNickname('   ')).toBeNull();
    expect(normalizeNickname('a​b')).toBeNull();
    expect(normalizeNickname('a\nb')).toBe('a b');
    expect(normalizeNickname('a\u0007b')).toBeNull();
    expect(normalizeNickname(null)).toBeNull();
  });
});

describe('房間邏輯', () => {
  it('第一位加入的是房主，預設 4 張合法盤面', () => {
    const r = roomWith('A', 'B');
    expect(r.hostId).toBe(P(0));
    expect(r.boards[P(1)]).toHaveLength(4);
    r.boards[P(1)].forEach((b) => expect(isValidBoard(b)).toBe(true));
  });

  it('喊叫：不重複，記錄喊的人與順序', () => {
    const r = roomWith('A', 'B');
    start(r);
    expect(callChampion(r, P(0), '伊瑞莉雅')).toBe(true);
    expect(callChampion(r, P(1), '伊瑞莉雅')).toBe(false);
    expect(callChampion(r, P(1), '亞歷斯塔')).toBe(true);
    expect(r.calls.map((c) => [c.champion, c.byNick, c.seq])).toEqual([
      ['伊瑞莉雅', 'A', 1],
      ['亞歷斯塔', 'B', 2],
    ]);
  });

  it('不在房內的人不能喊', () => {
    const r = roomWith('A');
    start(r);
    expect(() => callChampion(r, 'nobody123', '伊瑞莉雅')).toThrow(GameError);
  });

  it('達到條數就 BINGO，只宣告一次；被遣返後重算', () => {
    const r = roomWith('A', 'B');
    r.target = 1;
    r.items = true;
    start(r);
    callLine(r, P(0));
    const ann = evaluateBingo(r);
    expect(ann.map((a) => a.playerId)).toContain(P(0));
    expect(r.bingo).toContain(P(0));
    expect(evaluateBingo(r).find((a) => a.playerId === P(0))).toBeUndefined(); // 不重複宣告

    const before = linesOf(r, P(0));
    expect(before).toBeGreaterThanOrEqual(1);
    useRecall(r, P(1), r.boards[P(0)][0][2]);
    evaluateBingo(r);
    expect(linesOf(r, P(0))).toBeLessThan(before);
    if (linesOf(r, P(0)) < 1) expect(r.bingo).not.toContain(P(0));
  });

  it('被遣返後重算（固定盤面，結果確定）', () => {
    const r = roomWith('A');
    r.items = true;
    const b = generateBoard(rand);
    r.boards[P(0)] = [b];
    r.target = 2;
    start(r);
    callLine(r, P(0), 0, [0, 1, 2, 3, 4]); // 第 1 橫排
    callLine(r, P(0), 0, [5, 10, 15, 20]); // 第 1 直排（0 已喊）
    expect(evaluateBingo(r)).toHaveLength(1);
    expect(linesOf(r, P(0))).toBe(2);
    useRecall(r, P(0), b[0]); // 角落被遣返變空格，兩條都斷
    evaluateBingo(r);
    expect(linesOf(r, P(0))).toBe(0);
    expect(r.bingo).toEqual([]);
    expect(() => callChampion(r, P(0), b[0])).toThrow(/不能再喊/); // 這一局不能再喊回來
    // 炸彈也蓋不回空格
    useBomb(r, P(0), 0, 6);
    expect(linesOf(r, P(0))).toBe(0);
  });

  it('多張加總才判定 BINGO', () => {
    const r = roomWith('A');
    const a = generateBoard(rand);
    const b = generateBoard(rand);
    r.boards[P(0)] = [a, b];
    r.players[P(0)].boardCount = 2;
    r.target = 2;
    start(r);
    for (const i of [0, 1, 2, 3, 4]) callChampion(r, P(0), a[i]);
    evaluateBingo(r);
    const one = linesOf(r, P(0));
    for (const i of [4, 8, 12, 16, 20]) callChampion(r, P(0), b[i]);
    evaluateBingo(r);
    expect(linesOf(r, P(0))).toBeGreaterThanOrEqual(one + 1);
    expect(r.bingo).toContain(P(0));
  });

  it('免費格設定影響判定', () => {
    const r = roomWith('A');
    const b = generateBoard(rand);
    r.boards[P(0)] = [b];
    r.target = 1;
    start(r);
    for (const i of [10, 11, 13, 14]) callChampion(r, P(0), b[i]);
    expect(evaluateBingo(r)).toHaveLength(0);
    r.freeCenter = true;
    expect(evaluateBingo(r)).toHaveLength(1);
  });

  it('只有房主能改設定與開新局', () => {
    const r = roomWith('A', 'B');
    expect(() => updateSettings(r, P(1), { target: 5 })).toThrow(/房主/);
    expect(() => newRound(r, P(1), rand)).toThrow(/房主/);
    updateSettings(r, P(0), { target: 5 });
    expect(r.target).toBe(5);
  });

  it('開新的一局：清空已喊、遣返與 BINGO；直排順序換一個，盤面依新順序重抽', () => {
    const r = roomWith('A', 'B');
    r.target = 1;
    r.items = true;
    start(r);
    callLine(r, P(0));
    useRecall(r, P(1), r.calls[0].champion);
    evaluateBingo(r);
    for (let k = 0; k < 20; k++) {
      const prev = [...r.columnOrder];
      newRound(r, P(0), rand);
      expect(r.started).toBe(false);
      expect(r.columnOrder).not.toEqual(prev);
      expect([...r.columnOrder].sort()).toEqual(DEFAULT_ORDER);
      for (const id of [P(0), P(1)]) {
        expect(r.boards[id]).toHaveLength(4);
        r.boards[id].forEach((b) => expect(isValidBoard(b, r.columnOrder)).toBe(true));
      }
    }
    expect(r.calls).toEqual([]);
    expect(r.recalled).toEqual([]);
    expect(r.bingo).toEqual([]);
    expect(r.round).toBe(21);
    // 中途加入的人也照這一局的順序
    addPlayer(r, P(2), 'C', 'x', T0, rand);
    r.boards[P(2)].forEach((b) => expect(isValidBoard(b, r.columnOrder)).toBe(true));
  });

  it('改張數：只有房主能改，全房一起重抽，新加入的人也照這個張數', () => {
    const r = roomWith('A', 'B');
    expect(() => setBoardCount(r, P(1), 6, rand)).toThrow(/房主/);
    expect(setBoardCount(r, P(0), 4, rand)).toBe(false); // 沒變
    expect(setBoardCount(r, P(0), 6, rand)).toBe(true);
    expect(r.boardCount).toBe(6);
    expect(r.boards[P(0)]).toHaveLength(6);
    expect(r.boards[P(1)]).toHaveLength(6);
    addPlayer(r, P(2), 'C', 'x', T0, rand);
    expect(r.boards[P(2)]).toHaveLength(6);
  });
});

describe('準備中與開始', () => {
  it('準備中可以改設定，但不能喊、不能用道具；只有房主能開始', () => {
    const r = roomWith('A', 'B');
    expect(r.started).toBe(false);
    r.items = true;
    const name = r.boards[P(0)][0][0];
    expect(() => callChampion(r, P(1), name)).toThrow(/還沒開始/);
    expect(() => useBomb(r, P(1), 0, 12)).toThrow(/還沒開始/);
    expect(() => useRecall(r, P(1), name)).toThrow(/還沒開始/);
    expect(updateSettings(r, P(0), { target: 2, freeCenter: true })).toEqual({ target: 2, freeCenter: true });
    expect(setBoardCount(r, P(0), 2, rand)).toBe(true);
    expect(() => startRound(r, P(1), T0)).toThrow(/房主/);
    start(r);
    expect(toPublicState(r, presenceFromSeen({}, T0)).started).toBe(true);
    expect(callChampion(r, P(1), name)).toBe(true);
  });

  it('開始後設定全部鎖定，開新的一局才能再改', () => {
    const r = roomWith('A');
    start(r);
    expect(() => start(r)).toThrow(/已經開始/);
    expect(() => updateSettings(r, P(0), { target: 5 })).toThrow(/已經開始/);
    expect(() => updateSettings(r, P(0), { items: true })).toThrow(/已經開始/);
    expect(() => updateSettings(r, P(0), { autoCall: true })).toThrow(/已經開始/);
    expect(() => updateSettings(r, P(0), { freeCenter: true })).toThrow(/已經開始/);
    expect(() => setBoardCount(r, P(0), 6, rand)).toThrow(/已經開始/);
    expect(r.target).not.toBe(5);
    newRound(r, P(0), rand);
    expect(updateSettings(r, P(0), { target: 5 })).toEqual({ target: 5 });
    expect(setBoardCount(r, P(0), 6, rand)).toBe(true);
  });
});

describe('道具', () => {
  it('沒開道具不能用', () => {
    const r = roomWith('A');
    start(r);
    callChampion(r, P(0), r.boards[P(0)][0][0]);
    expect(() => useBomb(r, P(0), 0, 12)).toThrow(/沒有開啟道具/);
    expect(() => useRecall(r, P(0), r.boards[P(0)][0][0])).toThrow(/沒有開啟道具/);
    expect(toPublicState(r, presenceFromSeen({}, T0)).players[0]).toMatchObject({ hasBomb: false, hasRecall: false });
  });

  it('炸彈範圍：中間 9 格、邊 6 格、角 4 格', () => {
    expect(bombArea(12)).toEqual([6, 7, 8, 11, 12, 13, 16, 17, 18]);
    expect(bombArea(2)).toEqual([1, 2, 3, 6, 7, 8]);
    expect(bombArea(0)).toEqual([0, 1, 5, 6]);
    expect(bombArea(24)).toEqual([18, 19, 23, 24]);
  });

  it('炸彈只標記自己的那張盤面，算進條數，一局一次', () => {
    const r = roomWith('A', 'B');
    r.items = true;
    r.boards[P(0)] = [generateBoard(rand), generateBoard(rand)];
    start(r);
    // 第 2 張：喊第 1 橫排的 0、4，再炸以 7 為中心 → 0–4 全滿＝1 條（另外 1–3、6–8 也被標記）
    callChampion(r, P(1), r.boards[P(0)][1][0]);
    callChampion(r, P(1), r.boards[P(0)][1][4]);
    useBomb(r, P(0), 1, 7);
    expect(r.players[P(0)].marks).toEqual([[], [1, 2, 3, 6, 7, 8, 11, 12, 13]]);
    expect(linesOf(r, P(0))).toBeGreaterThanOrEqual(1);
    expect(r.calls).toHaveLength(2); // 沒加進已喊清單
    expect(linesOf(r, P(1))).toBe(linesOf(roomWithBoards(r, P(1)), P(1))); // B 不受影響
    expect(() => useBomb(r, P(0), 0, 12)).toThrow(/已經用掉/);
    expect(() => useBomb(r, P(1), 9, 12)).toThrow(/找不到這張盤面/);
    expect(() => useBomb(r, P(1), 0, 25)).toThrow(/格子位置/);
    const s = toPublicState(r, presenceFromSeen({}, T0));
    expect(s.players.map((p) => p.hasBomb)).toEqual([false, true]);
  });

  it('強制遣返：拔掉任何人喊的英雄，一局一次；沒喊過的不能遣返', () => {
    const r = roomWith('A', 'B');
    r.items = true;
    start(r);
    callChampion(r, P(0), '伊瑞莉雅');
    callChampion(r, P(0), '亞歷斯塔');
    expect(() => useRecall(r, P(1), '阿璃')).toThrow(/還沒有被喊過/);
    expect(useRecall(r, P(1), '伊瑞莉雅').byNick).toBe('A');
    expect(r.calls.map((c) => c.champion)).toEqual(['亞歷斯塔']);
    expect(r.recalled).toEqual([{ champion: '伊瑞莉雅', by: P(1), byNick: 'B', calledByNick: 'A' }]);
    expect(() => useRecall(r, P(1), '亞歷斯塔')).toThrow(/已經用掉/);
    expect(() => callChampion(r, P(0), '伊瑞莉雅')).toThrow(/不能再喊/);
    expect(toPublicState(r, presenceFromSeen({}, T0)).recalled).toEqual([
      { champion: '伊瑞莉雅', byNick: 'B', calledByNick: 'A' },
    ]);
  });

  it('新的一局道具補滿、炸彈標記清掉', () => {
    const r = roomWith('A');
    r.items = true;
    start(r);
    callChampion(r, P(0), r.boards[P(0)][0][0]);
    useBomb(r, P(0), 0, 12);
    useRecall(r, P(0), r.boards[P(0)][0][0]);
    expect(r.players[P(0)]).toMatchObject({ bombUsed: true, recallUsed: true });
    newRound(r, P(0), rand);
    expect(r.players[P(0)]).toMatchObject({ bombUsed: false, recallUsed: false, marks: [] });
  });

  it('房主開關道具，有變才回報', () => {
    const r = roomWith('A');
    expect(updateSettings(r, P(0), { items: true })).toEqual({ items: true });
    expect(updateSettings(r, P(0), { items: true, target: 3 })).toEqual({});
  });
});

describe('自動叫號', () => {
  it('開啟後要按開始才會叫；每 10 秒喊一位沒喊過的；期間不能手動喊', () => {
    const r = roomWith('A', 'B');
    updateSettings(r, P(0), { autoCall: true });
    expect(r.autoRunning).toBe(false);
    expect(autoCallTick(r, T0 + 99_999, rand)).toBeNull();
    newRound(r, P(0), rand);
    expect(r.autoRunning).toBe(false); // 準備中還不會叫
    start(r);
    expect(r.autoRunning).toBe(true);
    expect(r.nextAutoAt).toBe(T0 + AUTO_CALL_MS);
    expect(autoCallTick(r, T0 + AUTO_CALL_MS - 1, rand)).toBeNull(); // 還沒到
    const res = autoCallTick(r, T0 + AUTO_CALL_MS, rand)!;
    expect(CHAMPION_NAMES).toContain(res.champion);
    expect(r.calls).toEqual([expect.objectContaining({ champion: res.champion, byNick: AUTO_CALLER_NICK })]);
    expect(r.nextAutoAt).toBe(T0 + 2 * AUTO_CALL_MS);
    expect(() => callChampion(r, P(1), '安妮')).toThrow(/自動叫號中/);
    // 很久沒人在（錯過很多輪）只喊一位，從現在重新計時
    autoCallTick(r, T0 + 100 * AUTO_CALL_MS, rand);
    expect(r.calls).toHaveLength(2);
    expect(r.nextAutoAt).toBe(T0 + 101 * AUTO_CALL_MS);
    const s = toPublicState(r, presenceFromSeen({}, T0), T0 + 100.5 * AUTO_CALL_MS);
    expect(s.auto).toEqual({ running: true, nextInMs: AUTO_CALL_MS / 2 });
    expect(s.settings.autoCall).toBe(true);
  });

  it('不會喊到已喊或被遣返的；有人 BINGO 就停；開新的一局也停', () => {
    const r = roomWith('A');
    r.items = true;
    r.target = 1;
    updateSettings(r, P(0), { autoCall: true });
    start(r);
    const b = r.boards[P(0)][0];
    // 先把第 1 橫排以外、除了 b[4] 的英雄都塞進已喊，讓自動叫號只剩 b[4] 和 b[3] 可抽
    r.autoRunning = false;
    callChampion(r, P(0), b[0]);
    callChampion(r, P(0), b[1]);
    callChampion(r, P(0), b[2]);
    callChampion(r, P(0), b[3]);
    useRecall(r, P(0), b[3]); // b[3] 被遣返
    for (const n of CHAMPION_NAMES) if (n !== b[4] && n !== b[3]) callChampion(r, P(0), n);
    r.autoRunning = true;
    r.nextAutoAt = T0;
    const res = autoCallTick(r, T0, rand)!;
    expect(res.champion).toBe(b[4]); // 唯一能抽的
    expect(r.autoRunning).toBe(false); // 沒得抽了

    const r2 = roomWith('A');
    r2.target = 1;
    updateSettings(r2, P(0), { autoCall: true });
    startRound(r2, P(0), T0);
    const b2 = r2.boards[P(0)][0];
    r2.autoRunning = false;
    for (const i of [0, 1, 2, 3]) callChampion(r2, P(0), b2[i]);
    r2.autoRunning = true;
    // 讓亂數一定抽到 b2[4]
    const pick = (n: number) => {
      const pool = CHAMPION_NAMES.filter((x) => !r2.calls.some((c) => c.champion === x));
      expect(pool).toHaveLength(n);
      return pool.indexOf(b2[4]);
    };
    const hit = autoCallTick(r2, T0 + AUTO_CALL_MS, pick)!;
    expect(hit.announces.map((a) => a.nick)).toEqual(['A']);
    expect(r2.autoRunning).toBe(false);

    const r3 = roomWith('A');
    updateSettings(r3, P(0), { autoCall: true });
    startRound(r3, P(0), T0);
    expect(r3.autoRunning).toBe(true);
    newRound(r3, P(0), rand); // 開新的一局就停，回到準備中
    expect(r3.autoRunning).toBe(false);
    expect(autoCallTick(r3, T0 + AUTO_CALL_MS, rand)).toBeNull();
  });
});

describe('聊天', () => {
  it('1–100 字，換行變空白，拿掉控制字元但保留 emoji', () => {
    expect(normalizeChat('  嗨\n大家  ')).toBe('嗨 大家');
    expect(normalizeChat('a\u200Bb\u0007')).toBe('ab');
    expect(normalizeChat('👨\u200D👩\u200D👧')).toBe('👨\u200D👩\u200D👧');
    expect(normalizeChat('字'.repeat(100))).not.toBeNull();
    expect(normalizeChat('字'.repeat(101))).toBeNull();
    expect(normalizeChat('   ')).toBeNull();
    expect(normalizeChat(5)).toBeNull();
  });
});

describe('房主交接與在線', () => {
  it('房主在線不換', () => {
    const r = roomWith('A', 'B');
    const t = T0 + 10 * 60_000;
    const pres = presenceFromSeen({ [seenField(P(0), 's1')]: t - 1000, [seenField(P(1), 's2')]: t - 1000 }, t);
    expect(transferHostIfNeeded(r, pres, t)).toBe(false);
  });

  it('房主離線未滿 60 秒不換、超過就換給下一位在線玩家', () => {
    const r = roomWith('A', 'B', 'C');
    const left = T0 + 5 * 60_000;
    const seen = {
      [seenField(P(0), 'last')]: left,
      [seenField(P(2), 's3')]: left + 50_000,
    };
    const t1 = left + HOST_GRACE_MS - 1000;
    expect(transferHostIfNeeded(r, presenceFromSeen(seen, t1), t1)).toBe(false);
    const t2 = left + HOST_GRACE_MS + 1000;
    seen[seenField(P(2), 's3')] = t2 - 1000;
    expect(transferHostIfNeeded(r, presenceFromSeen(seen, t2), t2)).toBe(true);
    expect(r.hostId).toBe(P(2)); // B 不在線，跳過
  });

  it('沒有人在線就不換', () => {
    const r = roomWith('A', 'B');
    const t = T0 + 60 * 60_000;
    expect(transferHostIfNeeded(r, presenceFromSeen({}, t), t)).toBe(false);
    expect(r.hostId).toBe(P(0));
  });

  it('心跳超過 45 秒視為離線', () => {
    const t = T0 + 100_000;
    const pres = presenceFromSeen({ [seenField(P(0), 's')]: t - 46_000, [seenField(P(1), 's')]: t - 10_000 }, t);
    expect(pres.online.has(P(0))).toBe(false);
    expect(pres.online.has(P(1))).toBe(true);
  });

  it('房主主動離開：立刻交給下一位；最後一人離開房間就空了', () => {
    const r = roomWith('A', 'B');
    expect(removePlayer(r, P(0)).empty).toBe(false);
    expect(r.hostId).toBe(P(1));
    expect(r.boards[P(0)]).toBeUndefined();
    expect(removePlayer(r, P(1)).empty).toBe(true);
  });

  it('公開狀態含條數、BINGO、在線、房主', () => {
    const r = roomWith('A', 'B');
    r.target = 1;
    start(r);
    callLine(r, P(1));
    evaluateBingo(r);
    const t = T0 + 1000;
    const s = toPublicState(r, presenceFromSeen({ [seenField(P(1), 'x')]: t }, t));
    const a = s.players.find((p) => p.id === P(0))!;
    const b = s.players.find((p) => p.id === P(1))!;
    expect(a).toMatchObject({ isHost: true, online: false });
    expect(s.settings).toMatchObject({ boardCount: 4, items: false });
    expect(b).toMatchObject({ isHost: false, online: true, bingo: true });
    expect(b.lines).toBeGreaterThanOrEqual(1);
    expect(s.calls).toHaveLength(5);
    expect(JSON.stringify(s)).not.toContain('secretHash');
  });
});
