// 需要確認視窗的操作
import { calledSet, callChampion, uncallChampion } from './game';
import { confirmDialog } from './ui';

export async function askUncall(name: string) {
  const ok = await confirmDialog(`取消「${name}」？`, '所有人盤面上的這一格都會取消蓋章。', '取消喊叫');
  if (ok) await uncallChampion(name);
}

/** 點盤面格子：沒喊過＝喊；喊過＝確認後取消 */
export async function toggleCell(name: string) {
  if (calledSet.value.has(name)) await askUncall(name);
  else await callChampion(name);
}
