// 房間的純邏輯（不碰網路、不碰 Redis），方便單元測試。
// 所有函式都直接修改傳入的 room（呼叫端傳的是複本）。
import { bombArea, generateBoards, isCellIndex, totalLines, type Board, type BoardCount, type RandInt } from '../shared/board';
import type { BingoAnnounce, ErrorCode, PublicPlayer, RoomState } from '../shared/protocol';
import { TARGET_DEFAULT } from '../shared/validate';

export const DEFAULT_BOARD_COUNT: BoardCount = 4;
/** 判定為「在線」：最近一次心跳在 45 秒內 */
export const ONLINE_TTL_MS = 45_000;
/** 房主離線超過 60 秒就換人 */
export const HOST_GRACE_MS = 60_000;

export interface PlayerData {
  nick: string;
  boardCount: number;
  joinOrder: number;
  joinedAt: number;
  secretHash: string;
  /** 這一局已經用掉炸彈／強制遣返（舊資料沒有這些欄位，視為 false） */
  bombUsed?: boolean;
  recallUsed?: boolean;
  /** 炸彈標記：marks[i] 是第 i 張被炸到的格子 */
  marks?: number[][];
}

export interface CallData {
  champion: string;
  by: string;
  byNick: string;
  seq: number;
}

export interface RoomData {
  code: string;
  v: number;
  hostId: string;
  target: number;
  freeCenter: boolean;
  /** 開啟道具 */
  items: boolean;
  /** 全房統一的盤面張數 */
  boardCount: BoardCount;
  round: number;
  createdAt: number;
  updatedAt: number;
  /** 喊叫流水號 */
  seq: number;
  nextJoinOrder: number;
  players: Record<string, PlayerData>;
  boards: Record<string, Board[]>;
  /** 依 seq 由小到大 */
  calls: CallData[];
  /** 目前已達 BINGO 的玩家（用來判斷「剛剛才 BINGO」，只廣播一次） */
  bingo: string[];
}

export class GameError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function newRoom(code: string, now: number): RoomData {
  return {
    code,
    v: 0,
    hostId: '',
    target: TARGET_DEFAULT,
    freeCenter: false,
    items: false,
    boardCount: DEFAULT_BOARD_COUNT,
    round: 1,
    createdAt: now,
    updatedAt: now,
    seq: 0,
    nextJoinOrder: 0,
    players: {},
    boards: {},
    calls: [],
    bingo: [],
  };
}

export function addPlayer(room: RoomData, id: string, nick: string, secretHash: string, now: number, rand: RandInt) {
  room.players[id] = {
    nick,
    boardCount: room.boardCount,
    joinOrder: room.nextJoinOrder++,
    joinedAt: now,
    secretHash,
  };
  room.boards[id] = generateBoards(room.boardCount, rand);
  if (!room.hostId || !room.players[room.hostId]) room.hostId = id;
}

export function requirePlayer(room: RoomData, id: string): PlayerData {
  const p = room.players[id];
  if (!p) throw new GameError('NOT_IN_ROOM', '你已經不在這個房間了');
  return p;
}

export function requireHost(room: RoomData, id: string) {
  requirePlayer(room, id);
  if (room.hostId !== id) throw new GameError('NOT_HOST', '只有房主可以修改設定');
}

export function calledSet(room: RoomData): Set<string> {
  return new Set(room.calls.map((c) => c.champion));
}

export function linesOf(room: RoomData, id: string, called = calledSet(room)): number {
  return totalLines(room.boards[id] ?? [], called, room.freeCenter, room.players[id]?.marks);
}

export function marksOf(room: RoomData, id: string): number[][] {
  const n = room.boards[id]?.length ?? 0;
  const m = room.players[id]?.marks ?? [];
  return Array.from({ length: n }, (_, i) => m[i] ?? []);
}

export function hasBomb(room: RoomData, id: string) {
  return room.items && !!room.players[id] && !room.players[id].bombUsed;
}
export function hasRecall(room: RoomData, id: string) {
  return room.items && !!room.players[id] && !room.players[id].recallUsed;
}

/** 道具：炸自己第 boardIndex 張盤面，以 cell 為中心的 3×3 */
export function useBomb(room: RoomData, playerId: string, boardIndex: number, cell: number) {
  const p = requirePlayer(room, playerId);
  if (!room.items) throw new GameError('BAD_INPUT', '這個房間沒有開啟道具');
  if (p.bombUsed) throw new GameError('BAD_INPUT', '這一局的炸彈已經用掉了');
  const boards = room.boards[playerId] ?? [];
  if (!Number.isInteger(boardIndex) || boardIndex < 0 || boardIndex >= boards.length) {
    throw new GameError('BAD_INPUT', '找不到這張盤面');
  }
  if (!isCellIndex(cell)) throw new GameError('BAD_INPUT', '格子位置不正確');
  const marks = marksOf(room, playerId);
  marks[boardIndex] = [...new Set([...marks[boardIndex], ...bombArea(cell)])].sort((a, b) => a - b);
  p.marks = marks;
  p.bombUsed = true;
}

/** 道具：把一位已喊的英雄拔掉（全房生效）。回傳被拔掉的那筆 */
export function useRecall(room: RoomData, playerId: string, champion: string): CallData {
  const p = requirePlayer(room, playerId);
  if (!room.items) throw new GameError('BAD_INPUT', '這個房間沒有開啟道具');
  if (p.recallUsed) throw new GameError('BAD_INPUT', '這一局的強制遣返已經用掉了');
  const call = room.calls.find((c) => c.champion === champion);
  if (!call) throw new GameError('BAD_INPUT', `「${champion}」還沒有被喊過`);
  room.calls = room.calls.filter((c) => c !== call);
  p.recallUsed = true;
  return call;
}

/** 清掉道具使用紀錄與炸彈標記（新的一局、重抽盤面時） */
function resetItems(room: RoomData) {
  for (const p of Object.values(room.players)) {
    p.bombUsed = false;
    p.recallUsed = false;
    p.marks = [];
  }
}

/** 重新判定所有人的 BINGO，回傳「這次才剛達成」的玩家 */
export function evaluateBingo(room: RoomData): BingoAnnounce[] {
  const called = calledSet(room);
  const before = new Set(room.bingo);
  const now: string[] = [];
  const announces: BingoAnnounce[] = [];
  for (const [id, p] of Object.entries(room.players)) {
    const lines = linesOf(room, id, called);
    if (lines >= room.target) {
      now.push(id);
      if (!before.has(id)) announces.push({ playerId: id, nick: p.nick, lines });
    }
  }
  room.bingo = now;
  return announces;
}

export function callChampion(room: RoomData, playerId: string, champion: string): boolean {
  const p = requirePlayer(room, playerId);
  if (room.calls.some((c) => c.champion === champion)) return false;
  room.seq += 1;
  room.calls.push({ champion, by: playerId, byNick: p.nick, seq: room.seq });
  return true;
}

/**
 * 房主改張數：全房一起重抽盤面。炸彈標記跟著舊盤面消失，所以炸彈退還；
 * 強制遣返已經影響到全房的已喊清單，不退還。回傳張數是否有變。
 */
export function setBoardCount(room: RoomData, playerId: string, count: BoardCount, rand: RandInt): boolean {
  requireHost(room, playerId);
  if (room.boardCount === count) return false;
  room.boardCount = count;
  for (const [id, p] of Object.entries(room.players)) {
    p.boardCount = count;
    p.bombUsed = false;
    p.marks = [];
    room.boards[id] = generateBoards(count, rand);
  }
  return true;
}

export type SettingsPatch = { target?: number; freeCenter?: boolean; items?: boolean };

/** 回傳實際有變動的欄位 */
export function updateSettings(room: RoomData, playerId: string, patch: SettingsPatch): SettingsPatch {
  requireHost(room, playerId);
  const changed: SettingsPatch = {};
  if (patch.target !== undefined && patch.target !== room.target) room.target = changed.target = patch.target;
  if (patch.freeCenter !== undefined && patch.freeCenter !== room.freeCenter) {
    room.freeCenter = changed.freeCenter = patch.freeCenter;
  }
  if (patch.items !== undefined && patch.items !== room.items) room.items = changed.items = patch.items;
  return changed;
}

/** 開新的一局：清空已喊清單、BINGO 狀態與炸彈標記，道具補滿，盤面不變 */
export function newRound(room: RoomData, playerId: string) {
  requireHost(room, playerId);
  room.calls = [];
  room.bingo = [];
  room.round += 1;
  resetItems(room);
}

function playersByOrder(room: RoomData): [string, PlayerData][] {
  return Object.entries(room.players).sort((a, b) => a[1].joinOrder - b[1].joinOrder);
}

/** 依加入順序，從 afterOrder 之後循環找下一位；preferOnline 時優先找在線的 */
function nextPlayer(room: RoomData, afterOrder: number, exclude: string, online?: ReadonlySet<string>): string | null {
  const list = playersByOrder(room).filter(([id]) => id !== exclude);
  const rotated = [...list.filter(([, p]) => p.joinOrder > afterOrder), ...list.filter(([, p]) => p.joinOrder <= afterOrder)];
  if (online) return rotated.find(([id]) => online.has(id))?.[0] ?? null;
  return rotated[0]?.[0] ?? null;
}

/** 玩家主動離開。回傳房間是否已經沒人 */
export function removePlayer(room: RoomData, playerId: string, presence?: Presence): { empty: boolean } {
  const p = room.players[playerId];
  if (!p) return { empty: Object.keys(room.players).length === 0 };
  delete room.players[playerId];
  delete room.boards[playerId];
  room.bingo = room.bingo.filter((id) => id !== playerId);
  if (room.hostId === playerId) {
    room.hostId =
      (presence && nextPlayer(room, p.joinOrder, playerId, presence.online)) ??
      nextPlayer(room, p.joinOrder, playerId) ??
      '';
  }
  return { empty: Object.keys(room.players).length === 0 };
}

// ---------- 在線狀態 ----------

/**
 * seen hash 的欄位：
 *   `${playerId}|${socketId}` = 該連線最後一次心跳時間
 *   `${playerId}|last`        = 最後一次斷線時間
 */
export const SEEN_LAST = 'last';
export function seenField(playerId: string, socketId: string) {
  return `${playerId}|${socketId}`;
}

export interface Presence {
  online: Set<string>;
  /** 每位玩家最後一次出現的時間 */
  lastSeen: Map<string, number>;
}

export function presenceFromSeen(seen: Record<string, number>, now: number): Presence {
  const online = new Set<string>();
  const lastSeen = new Map<string, number>();
  for (const [field, ts] of Object.entries(seen)) {
    const bar = field.indexOf('|');
    if (bar < 0 || !Number.isFinite(ts)) continue;
    const pid = field.slice(0, bar);
    const kind = field.slice(bar + 1);
    if (kind !== SEEN_LAST && now - ts < ONLINE_TTL_MS) online.add(pid);
    lastSeen.set(pid, Math.max(lastSeen.get(pid) ?? 0, ts));
  }
  return { online, lastSeen };
}

/** 房主離線超過 60 秒（或已不在房內）就把房主交給下一位在線玩家 */
export function transferHostIfNeeded(room: RoomData, presence: Presence, now: number): boolean {
  const host = room.players[room.hostId];
  if (host) {
    if (presence.online.has(room.hostId)) return false;
    const last = Math.max(presence.lastSeen.get(room.hostId) ?? 0, host.joinedAt);
    if (now - last <= HOST_GRACE_MS) return false;
  }
  const next = nextPlayer(room, host?.joinOrder ?? -1, room.hostId, presence.online);
  if (!next) return false;
  room.hostId = next;
  return true;
}

export function toPublicState(room: RoomData, presence: Presence): RoomState {
  const called = calledSet(room);
  const bingo = new Set(room.bingo);
  const players: PublicPlayer[] = playersByOrder(room).map(([id, p]) => ({
    id,
    nick: p.nick,
    lines: linesOf(room, id, called),
    bingo: bingo.has(id),
    online: presence.online.has(id),
    isHost: id === room.hostId,
    hasBomb: hasBomb(room, id),
    hasRecall: hasRecall(room, id),
  }));
  return {
    code: room.code,
    v: room.v,
    hostId: room.hostId,
    settings: { target: room.target, freeCenter: room.freeCenter, items: room.items, boardCount: room.boardCount },
    round: room.round,
    calls: room.calls.map((c) => ({ champion: c.champion, byId: c.by, byNick: c.byNick, seq: c.seq })),
    players,
  };
}
