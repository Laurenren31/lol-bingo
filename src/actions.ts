// 點格子、用道具等需要判斷或確認的操作
import { autoRunning, blockedSet, calledSet, callChampion, game, useBomb, useRecall } from './game';
import { confirmDialog, toast } from './ui';

export async function askRecall(name: string) {
  if (!calledSet.value.has(name)) return toast(`「${name}」還沒有被喊過，請選一位已喊的英雄`);
  const ok = await confirmDialog(
    `對「${name}」使用強制遣返？`,
    '會把它從已喊清單拔掉，所有人盤面上的這一格變成空格，不能再連線，這一局也不能再喊。強制遣返每局只能用一次。',
    '遣返',
  );
  if (ok) await useRecall(name);
}

export async function askBomb(board: number, cell: number, name: string) {
  const ok = await confirmDialog(
    `在第 ${board + 1} 張丟炸彈？`,
    `以「${name}」為中心的 3×3 會直接蓋章（只影響你自己這張，不會加進已喊清單）。這一局只能用一次。`,
    '丟炸彈',
  );
  if (ok) await useBomb(board, cell);
}

/** 點盤面格子：一般＝喊這位英雄；選道具目標時＝對這格使用道具 */
export async function clickCell(board: number, cell: number, name: string) {
  if (game.itemMode === 'bomb') return askBomb(board, cell, name);
  if (game.itemMode === 'recall') return askRecall(name);
  if (blockedSet.value.has(name)) return toast(`「${name}」被遣返了，這格是空格`);
  if (autoRunning.value) return toast('自動叫號中，等系統喊就好');
  if (calledSet.value.has(name)) return toast(`「${name}」已經喊過了`);
  await callChampion(name);
}
