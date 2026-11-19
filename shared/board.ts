import { POOLS, columnOf } from './champions';

export const SIZE = 5;
export const CELLS = SIZE * SIZE;
export const CENTER = 12;

/** 一張盤面：長度 25，依列優先（index = row * 5 + col） */
export type Board = string[];

/** 回傳 [0, maxExclusive) 的整數 */
export type RandInt = (maxExclusive: number) => number;
export const mathRandInt: RandInt = (n) => Math.floor(Math.random() * n);

export const BOARD_COUNTS = [1, 2, 4, 6] as const;
export type BoardCount = (typeof BOARD_COUNTS)[number];
export function isBoardCount(v: unknown): v is BoardCount {
  return typeof v === 'number' && (BOARD_COUNTS as readonly number[]).includes(v);
}

/** 12 條線：5 橫、5 直、2 斜 */
export const LINES: readonly (readonly number[])[] = (() => {
  const lines: number[][] = [];
  for (let i = 0; i < SIZE; i++) {
    lines.push(Array.from({ length: SIZE }, (_, j) => i * SIZE + j)); // 橫
    lines.push(Array.from({ length: SIZE }, (_, j) => j * SIZE + i)); // 直
  }
  lines.push(Array.from({ length: SIZE }, (_, j) => j * SIZE + j));
  lines.push(Array.from({ length: SIZE }, (_, j) => j * SIZE + (SIZE - 1 - j)));
  return lines;
})();

function sample<T>(pool: readonly T[], k: number, rand: RandInt): T[] {
  const a = pool.slice();
  for (let i = 0; i < k; i++) {
    const j = i + rand(a.length - i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

/** 第 c 直排從 POOLS[c] 隨機抽 5 位（同一張不重複） */
export function generateBoard(rand: RandInt = mathRandInt): Board {
  const board = new Array<string>(CELLS);
  POOLS.forEach((pool, c) => {
    sample(pool, SIZE, rand).forEach((name, r) => {
      board[r * SIZE + c] = name;
    });
  });
  return board;
}

export function generateBoards(count: number, rand: RandInt = mathRandInt): Board[] {
  return Array.from({ length: count }, () => generateBoard(rand));
}

export function isValidBoard(b: unknown): b is Board {
  return (
    Array.isArray(b) &&
    b.length === CELLS &&
    b.every((n, i) => typeof n === 'string' && columnOf(n) === i % SIZE) &&
    new Set(b).size === CELLS
  );
}

export interface BoardResult {
  lines: number;
  marked: boolean[];
  winCells: number[];
}

/** 炸彈範圍：以 center 為中心的 3×3（超出盤面的部分不算） */
export function bombArea(center: number): number[] {
  const r0 = Math.floor(center / SIZE);
  const c0 = center % SIZE;
  const out: number[] = [];
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) out.push(r * SIZE + c);
    }
  }
  return out;
}

export function isCellIndex(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) < CELLS;
}

/** extra：這張盤面上被炸彈標記的格子 */
export function isMarked(
  board: Board,
  i: number,
  called: ReadonlySet<string>,
  freeCenter: boolean,
  extra?: ReadonlySet<number>,
): boolean {
  return (freeCenter && i === CENTER) || called.has(board[i]) || !!extra?.has(i);
}

export function evaluateBoard(
  board: Board,
  called: ReadonlySet<string>,
  freeCenter: boolean,
  extra?: readonly number[],
): BoardResult {
  const ex = extra?.length ? new Set(extra) : undefined;
  const marked = board.map((_, i) => isMarked(board, i, called, freeCenter, ex));
  const win = new Set<number>();
  let lines = 0;
  for (const line of LINES) {
    if (line.every((i) => marked[i])) {
      lines++;
      line.forEach((i) => win.add(i));
    }
  }
  return { lines, marked, winCells: [...win].sort((a, b) => a - b) };
}

/** 多張盤面的連線數加總；marks[i] 是第 i 張被炸彈標記的格子 */
export function totalLines(
  boards: readonly Board[],
  called: ReadonlySet<string>,
  freeCenter: boolean,
  marks?: readonly (readonly number[] | undefined)[],
): number {
  return boards.reduce((sum, b, i) => sum + evaluateBoard(b, called, freeCenter, marks?.[i]).lines, 0);
}
