// 前後端共用的事件名稱與資料格式
import type { Board, BoardCount } from './board';

/**
 * 前端連線路徑：直接打 Vercel 函式 api/socket-io.ts 本身。
 * （Vercel 的 rewrites 不會套用到 WebSocket upgrade，所以不能用 /api/socket-io/socket.io 這種子路徑）
 * 伺服器端會把它轉成 Socket.IO 預設的 /socket.io/。客戶端需搭配 addTrailingSlash: false。
 */
export const SOCKET_PATH = '/api/socket-io';

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
  /** 伺服器算的合計連線數 */
  lines: number;
  bingo: boolean;
  online: boolean;
  isHost: boolean;
  /** 這一局還沒用掉的道具（房間沒開道具時兩者都是 false） */
  hasBomb: boolean;
  hasRecall: boolean;
}

export interface ChatMessage {
  id: string;
  /** system：道具使用、房主改設定等系統訊息 */
  kind: 'user' | 'system';
  playerId: string;
  nick: string;
  text: string;
  ts: number;
  /** 系統訊息是否也要跳出提示（進出房間就不跳） */
  notify?: boolean;
}

/** 聊天室保留最近幾則 */
export const CHAT_HISTORY = 50;

export interface PublicCall {
  champion: string;
  byId: string;
  byNick: string;
  seq: number;
}

export interface RoomSettings {
  target: number;
  freeCenter: boolean;
  /** 開啟道具：每局每人一個炸彈、一個強制遣返 */
  items: boolean;
  /** 全房統一的盤面張數（只有房主能改） */
  boardCount: BoardCount;
}

/** 自己的盤面與炸彈標記（marks[i] 是第 i 張被炸到的格子） */
export interface MyBoards {
  boards: Board[];
  marks: number[][];
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
  marks: number[][];
  chat: ChatMessage[];
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
  /** 只有房主能用；全房一起重抽 */
  'boards:setCount': (p: { count: BoardCount }, ack: (r: Ack) => void) => void;
  'call:add': (p: { champion: string }, ack: (r: Ack<CallResult>) => void) => void;
  /** 道具：炸自己第 board 張、以 cell 為中心的 3×3 */
  'item:bomb': (p: { board: number; cell: number }, ack: (r: Ack) => void) => void;
  /** 道具：把一位已喊的英雄從清單拔掉（全房生效） */
  'item:recall': (p: { champion: string }, ack: (r: Ack) => void) => void;
  'settings:update': (p: Partial<Pick<RoomSettings, 'target' | 'freeCenter' | 'items'>>, ack: (r: Ack) => void) => void;
  'round:new': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  'chat:send': (p: { text: string }, ack: (r: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (s: RoomState) => void;
  'me:boards': (p: MyBoards) => void;
  'bingo:announce': (p: BingoAnnounce) => void;
  'chat:message': (m: ChatMessage) => void;
}
