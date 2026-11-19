import { describe, expect, it } from 'vitest';
import {
  CENTER,
  LINES,
  evaluateBoard,
  generateBoard,
  generateBoards,
  isValidBoard,
  randomColumnOrder,
  totalLines,
  type Board,
} from '../shared/board';
import { CHAMPIONS, COLUMN_NAMES, POOLS, columnOf } from '../shared/champions';

/** 固定種子的亂數，讓測試可重現 */
function seeded(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s % n;
  };
}

/** 依 index 清單建立「已喊」集合 */
function calledAt(board: Board, idx: number[]) {
  return new Set(idx.map((i) => board[i]));
}

describe('champions.json', () => {
  it('173 位英雄、5 欄', () => {
    expect(CHAMPIONS).toHaveLength(173);
    expect(COLUMN_NAMES).toEqual(['鬥士', '坦克', '法師', '射手', '輔刺']);
    expect(POOLS.reduce((s, p) => s + p.length, 0)).toBe(173);
    POOLS.forEach((p) => expect(p.length).toBeGreaterThanOrEqual(5));
  });
});

describe('盤面產生', () => {
  it('每一直排都是該欄的角色、同一張不重複', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const b = generateBoard(seeded(seed));
      expect(b).toHaveLength(25);
      b.forEach((name, i) => expect(columnOf(name)).toBe(i % 5));
      expect(new Set(b).size).toBe(25);
      expect(isValidBoard(b)).toBe(true);
    }
  });

  it('用 Math.random 也正確', () => {
    for (let k = 0; k < 200; k++) expect(isValidBoard(generateBoard())).toBe(true);
  });

  it('多張盤面數量正確，且每張都合法', () => {
    for (const n of [1, 2, 4, 6]) {
      const boards = generateBoards(n, seeded(n));
      expect(boards).toHaveLength(n);
      boards.forEach((b) => expect(isValidBoard(b)).toBe(true));
    }
  });

  it('指定直排順序：第 c 直排用 order[c] 那一欄', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const order = randomColumnOrder(seeded(seed));
      expect([...order].sort()).toEqual([0, 1, 2, 3, 4]);
      const b = generateBoard(seeded(seed + 1000), order);
      b.forEach((name, i) => expect(columnOf(name)).toBe(order[i % 5]));
      expect(isValidBoard(b, order)).toBe(true);
      if (order.join() !== '0,1,2,3,4') expect(isValidBoard(b)).toBe(false);
      expect(randomColumnOrder(seeded(seed), order)).not.toEqual(order);
    }
  });

  it('遣返的格子變空格：不算蓋章、免費格除外', () => {
    const b = generateBoard(seeded(3));
    const called = new Set(b.slice(0, 5)); // 第 1 橫排
    expect(evaluateBoard(b, called, false).lines).toBe(1);
    expect(evaluateBoard(b, called, false, [0, 1, 2, 3, 4], new Set([b[2]])).lines).toBe(0);
    const mid = new Set([b[10], b[11], b[13], b[14]]);
    expect(evaluateBoard(b, mid, true, undefined, new Set([b[12]])).lines).toBe(1);
  });

  it('isValidBoard 能擋下錯欄與重複', () => {
    const b = generateBoard(seeded(7));
    const wrongCol = b.slice();
    [wrongCol[0], wrongCol[1]] = [wrongCol[1], wrongCol[0]];
    expect(isValidBoard(wrongCol)).toBe(false);
    const dup = b.slice();
    dup[5] = dup[0];
    expect(isValidBoard(dup)).toBe(false);
  });
});

describe('連線計算', () => {
  const board = generateBoard(seeded(42));

  it('共 12 條線', () => {
    expect(LINES).toHaveLength(12);
  });

  it('沒喊任何人 = 0 條', () => {
    expect(evaluateBoard(board, new Set(), false).lines).toBe(0);
  });

  it('橫線、直線、兩條斜線', () => {
    expect(evaluateBoard(board, calledAt(board, [0, 1, 2, 3, 4]), false).lines).toBe(1);
    expect(evaluateBoard(board, calledAt(board, [2, 7, 12, 17, 22]), false).lines).toBe(1);
    expect(evaluateBoard(board, calledAt(board, [0, 6, 12, 18, 24]), false).lines).toBe(1);
    expect(evaluateBoard(board, calledAt(board, [4, 8, 12, 16, 20]), false).lines).toBe(1);
  });

  it('四缺一不算', () => {
    expect(evaluateBoard(board, calledAt(board, [0, 1, 2, 3]), false).lines).toBe(0);
  });

  it('交叉的線各算一條，winCells 正確', () => {
    const r = evaluateBoard(board, calledAt(board, [0, 1, 2, 3, 4, 0, 5, 10, 15, 20]), false);
    expect(r.lines).toBe(2);
    expect(r.winCells).toEqual([0, 1, 2, 3, 4, 5, 10, 15, 20]);
  });

  it('全部喊完 = 12 條', () => {
    expect(evaluateBoard(board, new Set(board), false).lines).toBe(12);
  });

  it('免費格：中間算已蓋，四格就能連成過中心的線', () => {
    const called = calledAt(board, [10, 11, 13, 14]); // 第 3 橫排扣掉中間
    expect(evaluateBoard(board, called, false).lines).toBe(0);
    const r = evaluateBoard(board, called, true);
    expect(r.lines).toBe(1);
    expect(r.marked[CENTER]).toBe(true);
  });

  it('免費格：中間格英雄有沒有被喊都一樣', () => {
    const called = calledAt(board, [0, 6, 18, 24]);
    expect(evaluateBoard(board, called, true).lines).toBe(1);
    called.add(board[CENTER]);
    expect(evaluateBoard(board, called, true).lines).toBe(1);
  });

  it('免費格：完全沒喊時只有中間蓋，0 條', () => {
    const r = evaluateBoard(board, new Set(), true);
    expect(r.lines).toBe(0);
    expect(r.marked.filter(Boolean)).toHaveLength(1);
  });
});

describe('多張加總', () => {
  it('每張的條數加起來', () => {
    const boards = generateBoards(4, seeded(99));
    // 第 1 張連第 1 橫排；第 3 張連兩條斜線
    const called = new Set([
      ...[0, 1, 2, 3, 4].map((i) => boards[0][i]),
      ...[0, 6, 12, 18, 24, 4, 8, 16, 20].map((i) => boards[2][i]),
    ]);
    const per = boards.map((b) => evaluateBoard(b, called, false).lines);
    expect(per[0]).toBeGreaterThanOrEqual(1);
    expect(per[2]).toBeGreaterThanOrEqual(2);
    expect(totalLines(boards, called, false)).toBe(per.reduce((a, b) => a + b, 0));
  });

  it('同一位英雄在多張盤面上，一次喊叫全部蓋章', () => {
    const a = generateBoard(seeded(1));
    const b = a.slice(); // 兩張一模一樣
    const called = calledAt(a, [0, 1, 2, 3, 4]);
    expect(totalLines([a, b], called, false)).toBe(2);
  });

  it('沒有盤面 = 0', () => {
    expect(totalLines([], new Set(['伊瑞莉雅']), true)).toBe(0);
  });
});
