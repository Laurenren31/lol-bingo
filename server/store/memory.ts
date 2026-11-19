// 記憶體版 store：本機開發（沒設定 REDIS_URL）與測試用。只適合單一程序。
import type { RoomData } from '../game';
import { CHAT_HISTORY, type ChatMessage } from '../../shared/protocol';
import { ROOM_TTL_SECONDS, type Store } from './types';

interface Entry {
  json: string;
  expiresAt: number;
}

export class MemoryStore implements Store {
  private rooms = new Map<string, Entry>();
  private seen = new Map<string, { data: Record<string, number>; expiresAt: number }>();
  private chat = new Map<string, { list: ChatMessage[]; expiresAt: number }>();

  constructor(
    private now: () => number = Date.now,
    private ttlMs = ROOM_TTL_SECONDS * 1000,
  ) {}

  private read(code: string): RoomData | null {
    const e = this.rooms.get(code);
    if (!e) return null;
    if (e.expiresAt <= this.now()) {
      this.rooms.delete(code);
      this.seen.delete(code);
      this.chat.delete(code);
      return null;
    }
    return JSON.parse(e.json) as RoomData;
  }

  private write(room: RoomData) {
    this.rooms.set(room.code, { json: JSON.stringify(room), expiresAt: this.now() + this.ttlMs });
  }

  async get(code: string) {
    return this.read(code);
  }

  async create(room: RoomData) {
    if (this.read(room.code)) return false;
    room.v = 1;
    room.updatedAt = this.now();
    this.write(room);
    return true;
  }

  async update<T>(code: string, fn: (room: RoomData) => T) {
    const room = this.read(code);
    if (!room) return null;
    const result = fn(room);
    room.v += 1;
    room.updatedAt = this.now();
    this.write(room);
    return { room, result };
  }

  async delete(code: string) {
    this.rooms.delete(code);
    this.seen.delete(code);
    this.chat.delete(code);
  }

  async pushChat(code: string, msg: ChatMessage) {
    const c = this.chat.get(code);
    const list = c && c.expiresAt > this.now() ? c.list : [];
    list.push(msg);
    if (list.length > CHAT_HISTORY) list.splice(0, list.length - CHAT_HISTORY);
    this.chat.set(code, { list, expiresAt: this.now() + this.ttlMs });
  }

  async getChat(code: string) {
    const c = this.chat.get(code);
    if (!c || c.expiresAt <= this.now()) return [];
    return c.list.map((m) => ({ ...m }));
  }

  private seenOf(code: string) {
    let s = this.seen.get(code);
    if (!s || s.expiresAt <= this.now()) {
      s = { data: {}, expiresAt: 0 };
      this.seen.set(code, s);
    }
    s.expiresAt = this.now() + this.ttlMs;
    return s.data;
  }

  async touchSeen(code: string, fields: Record<string, number>) {
    Object.assign(this.seenOf(code), fields);
  }

  async editSeen(code: string, remove: string[], set: Record<string, number> = {}) {
    const d = this.seenOf(code);
    for (const f of remove) delete d[f];
    Object.assign(d, set);
  }

  async getSeen(code: string) {
    const s = this.seen.get(code);
    if (!s || s.expiresAt <= this.now()) return {};
    return { ...s.data };
  }
}
