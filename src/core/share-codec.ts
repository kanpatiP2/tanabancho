/**
 * 共有URLプロトコル。リポジトリ内で唯一の encode/decode 実装。
 *
 * 送信形式（v2）:
 *   ScanItem[] → ShareSlimItem[]（キー短縮 c/t/n/m/g/p/pd/e/o/x）
 *   → ShareEnvelopeV2 { v:2, app:'tb', ts, items }
 *   → JSON → lz-string compressToEncodedURIComponent
 *
 * 受信形式は三段フォールバック（decodeShareData 参照）。
 * 復号結果は必ず sanitize を通す（不正値は例外ではなく「除外 + 警告カウント」）。
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { nowIso } from './datetime';
import type { ISODateTime, PopDetail, PopEnlarge, ScanItem, ShareEnvelopeV2, ShareSlimItem } from './types';

// ---------------------------------------------------------------- 上限値

/** バリデーション上限。壊れた/悪意あるURLで UI が破綻しないための防波堤 */
export const SHARE_LIMITS = {
  /** 1URLあたりの最大件数 */
  items: 500,
  code: 64,
  id: 64,
  /** 'HH:MM' */
  time: 5,
  name: 200,
  memo: 200,
  genre: 60,
  orderCount: 12,
  orderLabel: 40,
  popCount: 20,
  popSize: 24,
  popQty: 999,
  assignee: 40,
} as const;

/** LINE等でURLが切られない目安。超過時は UI で警告する */
export const SHARE_URL_LIMIT = 4000;

const POP_ENLARGE: readonly PopEnlarge[] = ['', 'A4', 'A3', 'A2'];

// ---------------------------------------------------------------- 警告収集

/** 除外・切り詰めの記録。例外を投げずに件数だけ積む */
class Warnings {
  count = 0;
  readonly notes: string[] = [];

  add(note: string, n = 1): void {
    this.count += n;
    if (this.notes.length < 20 && !this.notes.includes(note)) this.notes.push(note);
  }
}

// ---------------------------------------------------------------- 小道具

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `sh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** ISO日時 → 共有用の表示時刻 'HH:MM'（ローカル） */
export function toShareTime(iso: ISODateTime): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function sanitizeString(value: unknown, max: number, label: string, w: Warnings): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    w.add(`${label}: 文字列でないため除外`);
    return undefined;
  }
  if (value.length > max) {
    w.add(`${label}: ${max}文字を超えたため切り詰め`);
    return value.slice(0, max);
  }
  return value;
}

function sanitizeFlag(value: unknown, label: string, w: Warnings): 0 | 1 | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value ? 1 : 0;
  w.add(`${label}: 真偽値でないため除外`);
  return undefined;
}

function sanitizeDateOnly(value: unknown, label: string, w: Warnings): string | undefined {
  const s = sanitizeString(value, 10, label, w);
  if (s === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    w.add(`${label}: 日付形式でないため除外`);
    return undefined;
  }
  return s;
}

function sanitizeOrder(value: unknown, w: Warnings): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    w.add('o: 配列でないため除外');
    return undefined;
  }
  const out: string[] = [];
  for (const entry of value) {
    if (out.length >= SHARE_LIMITS.orderCount) {
      w.add(`o: ${SHARE_LIMITS.orderCount}件を超えたため除外`);
      break;
    }
    const s = sanitizeString(entry, SHARE_LIMITS.orderLabel, 'o[]', w);
    if (s !== undefined) out.push(s);
  }
  return out.length > 0 ? out : undefined;
}

function sanitizePopDetail(value: unknown, w: Warnings): PopDetail | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    w.add('pd[]: オブジェクトでないため除外');
    return null;
  }
  const o = value as Record<string, unknown>;

  let qty = 1;
  if (typeof o.qty === 'number' && Number.isFinite(o.qty)) {
    qty = Math.min(SHARE_LIMITS.popQty, Math.max(0, Math.trunc(o.qty)));
  } else if (o.qty !== undefined && o.qty !== null) {
    w.add('pd[].qty: 数値でないため既定値に置換');
  }

  const enlargeRaw = o.enlarge;
  let enlarge: PopEnlarge = '';
  if (typeof enlargeRaw === 'string' && POP_ENLARGE.includes(enlargeRaw as PopEnlarge)) {
    enlarge = enlargeRaw as PopEnlarge;
  } else if (enlargeRaw !== undefined && enlargeRaw !== null && enlargeRaw !== '') {
    w.add('pd[].enlarge: 未知の値のため除外');
  }

  return {
    size: sanitizeString(o.size, SHARE_LIMITS.popSize, 'pd[].size', w) ?? '',
    qty,
    lami: o.lami === true,
    enlarge,
    assignee: sanitizeString(o.assignee, SHARE_LIMITS.assignee, 'pd[].assignee', w) ?? '',
  };
}

function sanitizePop(value: unknown, w: Warnings): PopDetail[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    w.add('pd: 配列でないため除外');
    return undefined;
  }
  const out: PopDetail[] = [];
  for (const entry of value) {
    if (out.length >= SHARE_LIMITS.popCount) {
      w.add(`pd: ${SHARE_LIMITS.popCount}件を超えたため除外`);
      break;
    }
    const d = sanitizePopDetail(entry, w);
    if (d) out.push(d);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * 1件分の slim を正規化する。encode/decode の両方向でこれを通すため、
 * 「送れるもの」と「受け取れるもの」が常に一致する。
 * 復元不能（コードが無い等）なら null。
 */
function sanitizeSlim(value: unknown, w: Warnings): ShareSlimItem | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    w.add('項目: オブジェクトでないため除外');
    return null;
  }
  const o = value as Record<string, unknown>;

  const c = sanitizeString(o.c, SHARE_LIMITS.code, 'c', w);
  if (c === undefined || c.trim() === '') {
    w.add('項目: コード(c)が無いため除外');
    return null;
  }

  const item: ShareSlimItem = {
    id: sanitizeString(o.id, SHARE_LIMITS.id, 'id', w) ?? newId(),
    c,
    t: sanitizeString(o.t, SHARE_LIMITS.time, 't', w) ?? '',
  };

  const n = sanitizeString(o.n, SHARE_LIMITS.name, 'n', w);
  if (n !== undefined) item.n = n;
  const m = sanitizeString(o.m, SHARE_LIMITS.memo, 'm', w);
  if (m !== undefined) item.m = m;
  const g = sanitizeString(o.g, SHARE_LIMITS.genre, 'g', w);
  if (g !== undefined) item.g = g;

  const pd = sanitizePop(o.pd, w);
  if (pd !== undefined) item.pd = pd;

  const p = sanitizeFlag(o.p, 'p', w);
  if (p !== undefined) item.p = p;
  else if (pd !== undefined) item.p = 1;

  const e = sanitizeFlag(o.e, 'e', w);
  if (e !== undefined) item.e = e;

  const order = sanitizeOrder(o.o, w);
  if (order !== undefined) item.o = order;

  const x = sanitizeDateOnly(o.x, 'x', w);
  if (x !== undefined) item.x = x;

  return item;
}

// ---------------------------------------------------------------- encode

/** ScanItem → ShareSlimItem（空フィールドは載せない = URL を短く保つ） */
function toSlimItem(item: ScanItem, w: Warnings): ShareSlimItem | null {
  const hasPop = Array.isArray(item.pop) && item.pop.length > 0;
  return sanitizeSlim(
    {
      id: item.id,
      c: item.jan,
      t: toShareTime(item.createdAt),
      n: item.name || undefined,
      m: item.memo || undefined,
      g: item.genre || undefined,
      p: hasPop ? 1 : undefined,
      pd: hasPop ? item.pop : undefined,
      e: item.end ? 1 : undefined,
      o: Array.isArray(item.order) && item.order.length > 0 ? item.order : undefined,
      x: item.expiry || undefined,
    },
    w,
  );
}

/** ScanItem[] → 送信エンベロープ（上限超過分は切り捨てる） */
export function buildEnvelope(items: readonly ScanItem[], ts: ISODateTime = nowIso()): ShareEnvelopeV2 {
  const w = new Warnings();
  const src = Array.isArray(items) ? items.slice(0, SHARE_LIMITS.items) : [];
  const slim: ShareSlimItem[] = [];
  for (const item of src) {
    const s = toSlimItem(item, w);
    if (s) slim.push(s);
  }
  return { v: 2, app: 'tb', ts, items: slim };
}

/** ScanItem[] → URL に載せる圧縮文字列 */
export function encodeShareData(items: readonly ScanItem[]): string {
  return compressToEncodedURIComponent(JSON.stringify(buildEnvelope(items)));
}

// ---------------------------------------------------------------- decode

export type ShareFormat = 'v2' | 'v1-slim' | 'legacy-btoa';

export interface ShareDecodeResult {
  envelope: ShareEnvelopeV2;
  /** どの経路で復号できたか */
  format: ShareFormat;
  /** 除外・切り詰めの発生回数（0 なら完全に妥当なデータ） */
  warnings: number;
  /** 警告の内訳（重複は畳み、最大20種） */
  notes: string[];
}

/**
 * URLパラメータの揺れを吸収する。
 * - lz-string の URI-safe アルファベットには '+' が含まれるため、
 *   クエリ経由で ' ' に化けたものを戻す
 * - 二重にパーセントエンコードされた場合はデコードする
 */
function normalizeEncoded(raw: string): string {
  let s = raw.trim();
  if (s.includes('%')) {
    try {
      s = decodeURIComponent(s);
    } catch {
      /* 壊れたエスケープはそのまま扱う */
    }
  }
  return s.replace(/ /g, '+');
}

function tryLz(s: string): unknown | null {
  let json: string | null = null;
  try {
    json = decompressFromEncodedURIComponent(s) as string | null;
  } catch {
    return null;
  }
  if (!json) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

/** v1 以前の `btoa(encodeURIComponent(json))` 形式 */
function tryBtoa(s: string): unknown {
  let bin: string;
  try {
    bin = atob(s);
  } catch {
    throw new Error('共有データを解析できませんでした');
  }
  let json = bin;
  try {
    json = decodeURIComponent(bin);
  } catch {
    /* エンコードされていない旧々形式 */
  }
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new Error('共有データを解析できませんでした');
  }
}

function isEnvelopeLike(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && ('items' in v || 'v' in v);
}

/**
 * 三段フォールバックで復号し、バリデーション結果まで返す。
 *   1. LZ解凍 → JSON → v2 エンベロープ
 *   2. LZ解凍 → JSON → 配列（v1 slim）→ エンベロープに包む
 *   3. LZ失敗 → decodeURIComponent(atob(...)) の旧形式
 * どの経路でも復号できない場合のみ例外を投げる。
 */
export function decodeShareDataDetailed(encoded: string): ShareDecodeResult {
  if (typeof encoded !== 'string' || encoded.trim() === '') {
    throw new Error('共有データが空です');
  }
  const s = normalizeEncoded(encoded);

  let parsed: unknown;
  let format: ShareFormat;
  const lz = tryLz(s);
  if (lz !== null) {
    parsed = lz;
    format = isEnvelopeLike(lz) ? 'v2' : 'v1-slim';
  } else {
    parsed = tryBtoa(s);
    format = 'legacy-btoa';
  }

  const w = new Warnings();
  let rawItems: unknown[];
  let ts: ISODateTime;

  if (isEnvelopeLike(parsed)) {
    const env = parsed;
    ts = typeof env.ts === 'string' && env.ts !== '' ? env.ts : nowIso();
    if (Array.isArray(env.items)) {
      rawItems = env.items;
    } else {
      w.add('items: 配列でないため空として扱う');
      rawItems = [];
    }
  } else if (Array.isArray(parsed)) {
    ts = nowIso();
    rawItems = parsed;
  } else {
    throw new Error('共有データの形式が不正です');
  }

  if (rawItems.length > SHARE_LIMITS.items) {
    const over = rawItems.length - SHARE_LIMITS.items;
    w.add(`件数が上限 ${SHARE_LIMITS.items} を超えたため超過分を除外`, over);
    rawItems = rawItems.slice(0, SHARE_LIMITS.items);
  }

  const items: ShareSlimItem[] = [];
  for (const raw of rawItems) {
    const item = sanitizeSlim(raw, w);
    if (item) items.push(item);
  }

  return {
    envelope: { v: 2, app: 'tb', ts, items },
    format,
    warnings: w.count,
    notes: w.notes,
  };
}

/** v2 → v1 slim → btoa の三段フォールバック。復号後は必ずバリデーションを通す */
export function decodeShareData(encoded: string): ShareEnvelopeV2 {
  return decodeShareDataDetailed(encoded).envelope;
}

/** 受信エンベロープ → 本体で扱える ScanItem[]（往復重複判定用に _legacyId を残す） */
export function envelopeToScanItems(env: ShareEnvelopeV2, now: ISODateTime = nowIso()): ScanItem[] {
  return env.items.map((s) => ({
    id: newId(),
    createdAt: now,
    updatedAt: now,
    _legacyId: s.id,
    _approxDate: true,
    jan: s.c,
    name: s.n ?? '',
    memo: s.m ?? '',
    genre: s.g ?? '',
    end: s.e === 1,
    pop: s.pd ?? [],
    order: s.o ?? [],
    expiry: s.x ?? '',
    boxJan: '',
    protected: false,
    noLearn: true,
  }));
}

// ---------------------------------------------------------------- URL ヘルパー

/**
 * 共有URLを組み立てる。baseUrl の既存クエリ・フラグメントは捨てる。
 * from='main' は本体からの送信（受信タブを自動で開く）、'share' は共有ビューからの送信。
 */
export function buildShareUrl(baseUrl: string, encoded: string, from: 'main' | 'share'): string {
  const base = baseUrl.trim().split('#')[0]!.split('?')[0]!;
  return `${base}?data=${encoded}&from=${from}`;
}

/**
 * URL 文字列（または生の data 値）から data パラメータを取り出す。
 * `URLSearchParams` は使わない — lz-string の '+' が空白に化けるため。
 * 取り出せない場合は ''。
 */
export function extractDataParam(urlOrRaw: string): string {
  if (typeof urlOrRaw !== 'string') return '';
  const s = urlOrRaw.trim();
  if (s === '') return '';
  const m = s.match(/[?&]data=([^&#\s]+)/);
  if (m) return m[1] ?? '';
  // data= が無い URL は「データなし」。URL でなければ生データとして受け入れる
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.includes('?')) return '';
  return s;
}
