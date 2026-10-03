/**
 * 主動搭話節流（純函數）：頻率上限 + 勿擾時段。
 * - 勿擾：config.disturb.quietHours "23:00-08:00"（跨日相容）
 * - 需閒置 ≥idleMin 分鐘、上次主動 ≥gapMin 分鐘前
 * - 使用者剛離開/道別不觸發（由呼叫方傳 canProactive=false；不做情緒勒索）
 */
export interface ProactiveInput {
  now: Date;
  lastUserAt: number | null;
  lastProactiveAt: number | null;
  quietHours: string;
  disturbEnabled: boolean;
  canProactive: boolean;
  gapMin?: number;
  idleMin?: number;
}

function parseHM(s: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (m?.[1] === undefined || m?.[2] === undefined) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return { h, m: mm };
}

export function inQuietHours(now: Date, range: string): boolean {
  const [a, b] = range.split('-').map((s) => s.trim());
  const start = parseHM(a ?? '');
  const end = parseHM(b ?? '');
  if (start === null || end === null) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = start.h * 60 + start.m;
  const e = end.h * 60 + end.m;
  if (s <= e) return cur >= s && cur < e;
  return cur >= s || cur < e; // 跨日
}

export function shouldProactive(input: ProactiveInput): boolean {
  if (!input.canProactive) return false;
  const gapMin = input.gapMin ?? 45;
  const idleMin = input.idleMin ?? 10;
  const nowMs = input.now.getTime();
  if (input.disturbEnabled && inQuietHours(input.now, input.quietHours)) return false;
  if (input.lastUserAt !== null && nowMs - input.lastUserAt < idleMin * 60000) return false;
  if (input.lastProactiveAt !== null && nowMs - input.lastProactiveAt < gapMin * 60000) return false;
  return true;
}
