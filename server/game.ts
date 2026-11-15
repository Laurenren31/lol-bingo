// 房間的純邏輯（不碰網路、不碰 Redis），方便單元測試。
// 所有函式都直接修改傳入的 room（呼叫端傳的是複本）。
import { generateBoards, totalLines, type Board, type BoardCount, type RandInt } from '../shared/board';
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
    boardCount: DEFAULT_BOARD_COUNT,
    joinOrder: room.nextJoinOrder++,
    joinedAt: now,
    secretHash,
  };
  room.boards[id] = generateBoards(DEFAULT_BOARD_COUNT, rand);
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
  return totalLines(room.boards[id] ?? [], called, room.freeCenter);
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

export function uncallChampion(room: RoomData, playerId: string, champion: string): boolean {
  requirePlayer(room, playerId);
  const before = room.calls.length;
  room.calls = room.calls.filter((c) => c.champion !== champion);
  return room.calls.length !== before;
}

export function setBoardCount(room: RoomData, playerId: string, count: BoardCount, rand: RandInt) {
  const p = requirePlayer(room, playerId);
  p.boardCount = count;
  room.boards[playerId] = generateBoards(count, rand);
}

export function updateSettings(room: RoomData, playerId: string, patch: { target?: number; freeCenter?: boolean }) {
  requireHost(room, playerId);
  if (patch.target !== undefined) room.target = patch.target;
  if (patch.freeCenter !== undefined) room.freeCenter = patch.freeCenter;
}

/** 開新的一局：清空已喊清單與 BINGO 狀態，盤面不變 */
export function newRound(room: RoomData, playerId: string) {
  requireHost(room, playerId);
  room.calls = [];
  room.bingo = [];
  room.round += 1;
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
    boardCount: p.boardCount,
    lines: linesOf(room, id, called),
    bingo: bingo.has(id),
    online: presence.online.has(id),
    isHost: id === room.hostId,
  }));
  return {
    code: room.code,
    v: room.v,
    hostId: room.hostId,
    settings: { target: room.target, freeCenter: room.freeCenter },
    round: room.round,
    calls: room.calls.map((c) => ({ champion: c.champion, byId: c.by, byNick: c.byNick, seq: c.seq })),
    players,
  };
}
