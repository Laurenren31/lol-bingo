// 前後端共用的事件名稱與資料格式
import type { Board, BoardCount } from './board';

/** 前端連線路徑（Vercel 函式 api/socket-io.ts + Socket.IO 預設的 /socket.io） */
export const SOCKET_PATH = '/api/socket-io/socket.io';

export const MAX_PLAYERS = 20;

export type ErrorCode =
  | 'BAD_INPUT'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'AUTH'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'RATE_LIMIT'
  | 'BUSY'
  | 'TIMEOUT'
  | 'INTERNAL';

export type Failure = { ok: false; code: ErrorCode; message: string };
export type Ack<T = object> = ({ ok: true } & T) | Failure;

export interface PublicPlayer {
  id: string;
  nick: string;
  boardCount: number;
  /** 伺服器算的合計連線數 */
  lines: number;
  bingo: boolean;
  online: boolean;
  isHost: boolean;
}

export interface PublicCall {
  champion: string;
  byId: string;
  byNick: string;
  seq: number;
}

export interface RoomSettings {
  target: number;
  freeCenter: boolean;
}

export interface RoomState {
  code: string;
  /** 資料版本，越大越新；前端忽略比手上舊的狀態 */
  v: number;
  hostId: string;
  settings: RoomSettings;
  round: number;
  /** 依喊的順序排列（seq 由小到大） */
  calls: PublicCall[];
  players: PublicPlayer[];
}

export interface JoinResult {
  roomCode: string;
  playerId: string;
  secret: string;
  state: RoomState;
  boards: Board[];
}

export interface CallResult {
  changed: boolean;
}

export interface BingoAnnounce {
  playerId: string;
  nick: string;
  lines: number;
}

export interface ClientToServerEvents {
  'room:create': (p: { nick: string }, ack: (r: Ack<JoinResult>) => void) => void;
  'room:join': (
    p: { roomCode: string; nick: string; playerId?: string; secret?: string },
    ack: (r: Ack<JoinResult>) => void,
  ) => void;
  'room:resume': (p: { roomCode: string; playerId: string; secret: string }, ack: (r: Ack<JoinResult>) => void) => void;
  'room:leave': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  'boards:setCount': (p: { count: BoardCount }, ack: (r: Ack) => void) => void;
  'call:add': (p: { champion: string }, ack: (r: Ack<CallResult>) => void) => void;
  'call:remove': (p: { champion: string }, ack: (r: Ack<CallResult>) => void) => void;
  'settings:update': (p: Partial<RoomSettings>, ack: (r: Ack) => void) => void;
  'round:new': (p: Record<string, never>, ack: (r: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (s: RoomState) => void;
  'me:boards': (p: { boards: Board[] }) => void;
  'bingo:announce': (p: BingoAnnounce) => void;
}
