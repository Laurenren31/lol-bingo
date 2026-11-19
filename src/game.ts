// 用戶端狀態與連線：伺服器為準，這裡只保存最新收到的狀態並負責顯示。
import { computed, reactive } from 'vue';
import { io, type Socket } from 'socket.io-client';
import type { Board, BoardCount } from '../shared/board';
import {
  CHAT_HISTORY,
  SOCKET_PATH,
  type Ack,
  type ChatMessage,
  type ClientToServerEvents,
  type JoinResult,
  type RoomState,
  type ServerToClientEvents,
} from '../shared/protocol';
import { normalizeRoomCode } from '../shared/validate';
import { COLUMN_NAMES } from '../shared/champions';
import { toast } from './ui';

const NICK_KEY = 'lolbingo.nick';
const SESSION_KEY = 'lolbingo.session';

interface Session {
  roomCode: string;
  playerId: string;
  secret: string;
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 私密模式等情況下忽略 */
  }
}

function loadSession(): Session | null {
  try {
    const s = JSON.parse(lsGet(SESSION_KEY) ?? 'null');
    if (s && typeof s.roomCode === 'string' && typeof s.playerId === 'string' && typeof s.secret === 'string') return s;
  } catch {
    /* ignore */
  }
  return null;
}

export type ConnStatus = 'connecting' | 'connected' | 'reconnecting';
/** 正在選道具的目標 */
export type ItemMode = null | 'bomb' | 'recall';

export const game = reactive({
  nick: lsGet(NICK_KEY) ?? '',
  session: loadSession(),
  conn: 'connecting' as ConnStatus,
  /** 正在恢復房間（進房前的載入畫面） */
  resuming: false,
  state: null as RoomState | null,
  boards: [] as Board[],
  /** 自己每張盤面被炸彈標記的格子 */
  marks: [] as number[][],
  chat: [] as ChatMessage[],
  itemMode: null as ItemMode,
  /** 下一次自動叫號的本機時間（毫秒）；沒在自動叫號時為 0 */
  autoAt: 0,
  /** 自己剛達成 BINGO 時顯示的大視窗 */
  winLines: 0,
  winOpen: false,
});

export const inRoom = computed(() => !!game.session);
export const me = computed(() => game.state?.players.find((p) => p.id === game.session?.playerId) ?? null);
export const isHost = computed(() => !!game.state && game.state.hostId === game.session?.playerId);
export const calledSet = computed(() => new Set(game.state?.calls.map((c) => c.champion) ?? []));
export const itemsOn = computed(() => !!game.state?.settings.items);
export const blockedSet = computed(() => new Set(game.state?.recalled.map((r) => r.champion) ?? []));
export const autoRunning = computed(() => !!game.state?.auto.running);
/** 直排標題，依這一局的順序 */
export const columnHeads = computed(() => (game.state?.columnOrder ?? [0, 1, 2, 3, 4]).map((i) => COLUMN_NAMES[i]));

export function saveNick(nick: string) {
  game.nick = nick;
  lsSet(NICK_KEY, nick);
}

function setSession(s: Session | null) {
  game.session = s;
  lsSet(SESSION_KEY, s ? JSON.stringify(s) : null);
  const url = new URL(location.href);
  if (s) url.searchParams.set('r', s.roomCode);
  else url.searchParams.delete('r');
  history.replaceState(null, '', url);
}

function leaveLocal(message?: string) {
  setSession(null);
  game.state = null;
  game.boards = [];
  game.marks = [];
  game.chat = [];
  game.itemMode = null;
  game.resuming = false;
  game.winOpen = false;
  if (message) toast(message);
}

// ---------- Socket ----------

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  path: SOCKET_PATH,
  addTrailingSlash: false,
  transports: ['websocket'], // Vercel 上必須只用 WebSocket
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
  timeout: 10_000,
});

type Payload<E extends keyof ClientToServerEvents> = Parameters<ClientToServerEvents[E]>[0];
type Reply<E extends keyof ClientToServerEvents> = Parameters<Parameters<ClientToServerEvents[E]>[1]>[0];

async function request<E extends keyof ClientToServerEvents>(event: E, payload: Payload<E>): Promise<Reply<E>> {
  if (!socket.connected) {
    return { ok: false, code: 'TIMEOUT', message: '連線中斷，正在重新連線…' } as Reply<E>;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (socket.timeout(8000) as any).emitWithAck(event, payload)) as Reply<E>;
  } catch {
    return { ok: false, code: 'TIMEOUT', message: '伺服器沒有回應，請再試一次' } as Reply<E>;
  }
}

/** 共通錯誤處理：被踢出房間或房間消失時回首頁 */
function handleFailure(r: Ack<object>): boolean {
  if (r.ok) return true;
  if (r.code === 'NOT_IN_ROOM' || r.code === 'ROOM_NOT_FOUND') leaveLocal(r.message);
  else toast(r.message);
  return false;
}

/** 伺服器給的是「還有幾毫秒」，換成本機時間，避免兩邊時鐘不一致 */
function setState(s: RoomState) {
  game.state = s;
  game.autoAt = s.auto.running && s.auto.nextInMs !== null ? Date.now() + s.auto.nextInMs : 0;
}

function applyJoin(r: JoinResult) {
  setSession({ roomCode: r.roomCode, playerId: r.playerId, secret: r.secret });
  setState(r.state);
  game.boards = r.boards;
  game.marks = r.marks;
  game.chat = r.chat;
  game.resuming = false;
}

let resumeTimer: ReturnType<typeof setTimeout> | undefined;
async function resume() {
  const s = game.session;
  if (!s || !socket.connected) return;
  game.resuming = !game.state;
  const r = await request('room:resume', s);
  if (game.session !== s) return; // 期間已經離開
  if (r.ok) return applyJoin(r);
  if (r.code === 'ROOM_NOT_FOUND' || r.code === 'AUTH' || r.code === 'BAD_INPUT') {
    leaveLocal(r.code === 'ROOM_NOT_FOUND' ? '房間已不存在（6 小時沒有動靜會自動刪除）' : '無法回到原本的房間');
    return;
  }
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(resume, 2000);
}

socket.on('connect', () => {
  game.conn = 'connected';
  void resume();
});
socket.on('disconnect', () => {
  game.conn = 'reconnecting';
});
socket.io.on('reconnect_attempt', () => {
  game.conn = 'reconnecting';
});

socket.on('room:state', (s) => {
  if (!game.session || s.code !== game.session.roomCode) return;
  if (game.state && s.v < game.state.v) return; // 較舊的狀態
  if (!s.players.some((p) => p.id === game.session!.playerId)) {
    leaveLocal('你已經離開這個房間');
    return;
  }
  if (game.state && s.round > game.state.round) {
    game.winOpen = false;
    game.itemMode = null;
    toast('新的一局開始了！已喊清單已清空', { gold: true });
  }
  setState(s);
  // 道具被關掉或已經用掉，就離開選目標模式
  const mine = s.players.find((p) => p.id === game.session!.playerId);
  if ((game.itemMode === 'bomb' && !mine?.hasBomb) || (game.itemMode === 'recall' && !mine?.hasRecall)) game.itemMode = null;
});

socket.on('me:boards', ({ boards, marks }) => {
  game.boards = boards;
  game.marks = marks;
});

socket.on('chat:message', (m) => {
  if (!game.session || game.chat.some((x) => x.id === m.id)) return;
  game.chat.push(m);
  if (game.chat.length > CHAT_HISTORY) game.chat.splice(0, game.chat.length - CHAT_HISTORY);
  if (m.kind === 'system' && m.notify) toast(m.text, { ms: 3500 });
});

socket.on('bingo:announce', (a) => {
  if (a.playerId === game.session?.playerId) {
    game.winLines = a.lines;
    game.winOpen = true;
  } else {
    toast(`🎉 ${a.nick} BINGO 了！（${a.lines} 條）`, { gold: true, ms: 4000 });
  }
});

if (game.session) game.resuming = true;

// ---------- 動作 ----------

export async function createRoom(nick: string) {
  saveNick(nick);
  const r = await request('room:create', { nick });
  if (handleFailure(r) && r.ok) applyJoin(r);
}

export async function joinRoom(code: string, nick: string) {
  saveNick(nick);
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) return toast('房號是 6 碼英數字');
  const prev = loadSession();
  const reuse = prev && prev.roomCode === roomCode ? { playerId: prev.playerId, secret: prev.secret } : {};
  const r = await request('room:join', { roomCode, nick, ...reuse });
  if (r.ok) applyJoin(r);
  else toast(r.message);
}

export async function leaveRoom() {
  const r = await request('room:leave', {});
  if (!r.ok && r.code !== 'NOT_IN_ROOM' && r.code !== 'ROOM_NOT_FOUND') {
    // 斷線時也讓玩家能回首頁，伺服器那邊會在之後判定離線
    if (r.code !== 'TIMEOUT') return toast(r.message);
  }
  leaveLocal();
}

export async function callChampion(champion: string) {
  if (autoRunning.value) return toast('自動叫號中，不能手動喊');
  if (blockedSet.value.has(champion)) return toast(`「${champion}」被強制遣返了，這一局不能再喊`);
  if (calledSet.value.has(champion)) return toast(`「${champion}」已經喊過了`);
  const r = await request('call:add', { champion });
  if (handleFailure(r) && r.ok && !r.changed) toast(`「${champion}」已經喊過了`);
}

export async function useBomb(board: number, cell: number) {
  const r = await request('item:bomb', { board, cell });
  if (handleFailure(r)) game.itemMode = null;
}

export async function useRecall(champion: string) {
  const r = await request('item:recall', { champion });
  if (handleFailure(r)) game.itemMode = null;
}

export async function sendChat(text: string): Promise<boolean> {
  const r = await request('chat:send', { text });
  return handleFailure(r);
}

export async function setBoardCount(count: BoardCount) {
  const r = await request('boards:setCount', { count });
  handleFailure(r);
}

export async function updateSettings(patch: { target?: number; freeCenter?: boolean; items?: boolean; autoCall?: boolean }) {
  const r = await request('settings:update', patch);
  handleFailure(r);
}

export async function newRound() {
  const r = await request('round:new', {});
  handleFailure(r);
}
