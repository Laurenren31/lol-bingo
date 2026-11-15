import type { RandInt } from './board';

/** 不易混淆的英數：去掉 0 / O / 1 / I */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function generateRoomCode(rand: RandInt): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[rand(ROOM_CODE_ALPHABET.length)];
  return s;
}

/** 轉大寫、去空白後驗證；不合法回傳 null */
export function normalizeRoomCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.replace(/\s+/g, '').toUpperCase();
  return ROOM_CODE_RE.test(s) ? s : null;
}

export const NICK_MAX = 12;

/**
 * 暱稱：1–12 個字（以 Unicode 字元計），不可含控制字元、零寬字元等不可見字元。
 * 連續空白會合併成一個。不合法回傳 null。
 */
export function normalizeNickname(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (!s) return null;
  if ([...s].length > NICK_MAX) return null;
  if (/[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}]/u.test(s)) return null;
  return s;
}

export const TARGET_MIN = 1;
export const TARGET_MAX = 10;
export const TARGET_DEFAULT = 3;

export function isTarget(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= TARGET_MIN && v <= TARGET_MAX;
}

const ID_RE = /^[a-z0-9]{8,32}$/;
const SECRET_RE = /^[a-f0-9]{32}$/;
export function isPlayerId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v);
}
export function isSecret(v: unknown): v is string {
  return typeof v === 'string' && SECRET_RE.test(v);
}
