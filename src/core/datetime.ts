import type { DateOnly, ISODateTime } from './types';

export function nowIso(): ISODateTime {
  return new Date().toISOString();
}

/** ローカル日付の 'YYYY-MM-DD' */
export function todayLocal(d: Date = new Date()): DateOnly {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ISO → 表示用 'H:MM'（ローカル） */
export function formatTime(iso: ISODateTime): string {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** ISO → 表示用 'M/D H:MM'（ローカル） */
export function formatDateTime(iso: ISODateTime): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${formatTime(iso)}`;
}

/** 'YYYY-MM-DD' → 表示用 'M/D' */
export function formatDateOnly(date: DateOnly): string {
  if (!date) return '';
  const [, m, d] = date.split('-');
  if (!m || !d) return date;
  return `${Number(m)}/${Number(d)}`;
}

/** 'YYYY-MM-DD' 同士の日数差（b - a） */
export function diffDays(a: DateOnly, b: DateOnly): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** today + n 日の 'YYYY-MM-DD' */
export function addDays(date: DateOnly, n: number): DateOnly {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return todayLocal(d);
}

/**
 * 期限パッドのテンキー入力を日付に解釈する。
 * - 4桁 'MMDD' → 直近未来のその月日（過ぎていれば翌年）
 * - 2桁 'DD'   → 今日以降なら当月、過ぎていれば翌月
 * 解釈できなければ null。
 */
export function parseExpiryDigits(digits: string, today: Date = new Date()): DateOnly | null {
  if (!/^\d{2}$|^\d{4}$/.test(digits)) return null;
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (digits.length === 4) {
    const m = Number(digits.slice(0, 2));
    const d = Number(digits.slice(2));
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    let candidate = new Date(base.getFullYear(), m - 1, d);
    if (candidate.getMonth() !== m - 1) return null; // 存在しない日付（2/31等）
    if (candidate < base) candidate = new Date(base.getFullYear() + 1, m - 1, d);
    return todayLocal(candidate);
  }
  const d = Number(digits);
  if (d < 1 || d > 31) return null;
  let candidate = new Date(base.getFullYear(), base.getMonth(), d);
  if (candidate < base || candidate.getDate() !== d) {
    candidate = new Date(base.getFullYear(), base.getMonth() + 1, d);
    if (candidate.getDate() !== d) return null;
  }
  return todayLocal(candidate);
}
