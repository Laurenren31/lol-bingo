import type { RoomData } from '../game';
import type { ChatMessage } from '../../shared/protocol';

/** 房間 6 小時沒動靜自動刪除 */
export const ROOM_TTL_SECONDS = 6 * 60 * 60;

export interface Store {
  get(code: string): Promise<RoomData | null>;
  /** 只有房號未被使用時才寫入；成功回傳 true */
  create(room: RoomData): Promise<boolean>;
  /**
   * 讀出房間 → 交給 fn 修改複本 → 版本沒變才寫回（樂觀鎖，衝突自動重試）。
   * fn 丟出例外就不寫入。房間不存在回傳 null。
   */
  update<T>(code: string, fn: (room: RoomData) => T): Promise<{ room: RoomData; result: T } | null>;
  delete(code: string): Promise<void>;

  /** 在線心跳：寫入 seen hash 的欄位 */
  touchSeen(code: string, fields: Record<string, number>): Promise<void>;
  /** 刪除 seen 欄位，並可同時寫入其他欄位（例如斷線時間） */
  editSeen(code: string, remove: string[], set?: Record<string, number>): Promise<void>;
  getSeen(code: string): Promise<Record<string, number>>;

  /** 聊天：新增一則並只保留最近 CHAT_HISTORY 則 */
  pushChat(code: string, msg: ChatMessage): Promise<void>;
  /** 聊天：由舊到新 */
  getChat(code: string): Promise<ChatMessage[]>;
}
