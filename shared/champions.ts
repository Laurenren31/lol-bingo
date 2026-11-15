// 唯一的英雄資料來源：shared/champions.json（原檔照抄，不在程式裡改名或改分欄）。
import data from './champions.json';

export interface Champion {
  name: string;
  slug: string;
  column: string;
  /** 欄位索引：0 鬥士、1 坦克、2 法師、3 射手、4 輔助 */
  col: number;
}

/** 欄名，順序即盤面直排順序 */
export const COLUMN_NAMES: readonly string[] = data.columns;

export const CHAMPIONS: readonly Champion[] = data.champions.map((c) => {
  const col = data.columns.indexOf(c.column);
  if (col < 0) throw new Error(`champions.json：${c.name} 的 column「${c.column}」不在 columns 內`);
  return { name: c.name, slug: c.slug, column: c.column, col };
});

export const CHAMPION_NAMES: readonly string[] = CHAMPIONS.map((c) => c.name);

const BY_NAME = new Map(CHAMPIONS.map((c) => [c.name, c]));

/** 每一欄可抽的英雄名單 */
export const POOLS: readonly (readonly string[])[] = COLUMN_NAMES.map((_, i) =>
  CHAMPIONS.filter((c) => c.col === i).map((c) => c.name),
);

export function isChampion(value: unknown): value is string {
  return typeof value === 'string' && BY_NAME.has(value);
}

export function getChampion(name: string): Champion | undefined {
  return BY_NAME.get(name);
}

export function columnOf(name: string): number {
  return BY_NAME.get(name)?.col ?? -1;
}
