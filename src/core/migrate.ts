/**
 * v1 → v2 の一度きり移行。
 *
 * 方針:
 * - 発火条件は KEYS.meta（tb.v2.meta）が無いこと。移行後は二度と走らない
 * - **v1 のキーは絶対に削除しない**（失敗時のやり直し・v1 併用のため）
 * - 全コレクションをメモリ上で変換し終えてから一括書き込み。
 *   1つでも書き込みに失敗したら書いた v2 キーを巻き戻して中断する
 *
 * ここで export している convert* 系は backup.ts（v1 バックアップ取込）からも再利用される。
 */

import { nowIso } from './datetime';
import {
  collectionEntry,
  getCollection,
  hasCollection,
  readJson,
  readRaw,
  writeBatch,
} from './storage';
import type {
  Competitor,
  CompetitorReason,
  CustomerOrder,
  DateOnly,
  DeliveryTime,
  ISODateTime,
  MetaV2,
  Note,
  PopDetail,
  PopEnlarge,
  Product,
  ReturnItem,
  ScanItem,
  ShiwakeCart,
  ShiwakeItem,
  ShiwakeState,
} from './types';
import { LEGACY_KEYS, NOTE_COLORS } from './types';

// ---------------------------------------------------------------- レポート型

export interface MigrationCollectionReport {
  /** v2 側のコレクション名 */
  target: string;
  /** 取り込み元の v1 キー */
  sources: string[];
  /** v1 側の件数 */
  v1Count: number;
  /** v2 側に生成された件数 */
  v2Count: number;
  /** 破棄した件数（REMINDER 疑似アイテム・壊れたレコード等） */
  dropped: number;
  /** 日付を復元できず migratedAt で代用した件数 */
  approxDate: number;
}

export interface MigrationReport {
  /** 実際に移行を行ったか */
  ran: boolean;
  /** ran=false の理由 */
  reason?: 'already-migrated' | 'write-failed';
  migratedAt: ISODateTime;
  collections: MigrationCollectionReport[];
  totals: { v1Count: number; v2Count: number; dropped: number; approxDate: number };
  /** 書き込み失敗などの致命的エラー */
  errors: string[];
}

// ---------------------------------------------------------------- 小道具

export function newId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return fallback;
}

function bool(v: unknown): boolean {
  return v === true || v === 'true';
}

function num(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** 'YYYY-MM-DD' 以外は '' */
export function dateOnly(v: unknown): DateOnly {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/** ローカル時刻として 'YYYY-MM-DD' + 'HH:MM' を ISO 化。不正なら null */
export function localIso(date: string, time: string): ISODateTime | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const y = Number(d[1]);
  const mo = Number(d[2]);
  const day = Number(d[3]);
  const hh = Number(t[1]);
  const mm = Number(t[2]);
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || hh > 23 || mm > 59) return null;
  const dt = new Date(y, mo - 1, day, hh, mm, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  // 2026-02-31 のような存在しない日付を弾く
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== day) return null;
  return dt.toISOString();
}

const MIN_TS = 1_000_000_000_000; // 2001-09-09。13桁数値の下限
const MAX_SKEW_MS = 365 * 86_400_000;

function isoFromEpoch(ms: number): ISODateTime | null {
  if (!Number.isFinite(ms) || ms < MIN_TS || ms > Date.now() + MAX_SKEW_MS) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * v1 の id（`Date.now() + random36(5)`、`comp`/`cust`/`cust_auto`/`chk`/`imp`/`rem`/`sh` 等の
 * 接頭辞付きもある）から生成時刻を復元する。数値 id にも対応。
 */
export function timestampFromLegacyId(id: unknown): ISODateTime | null {
  const m = /\d{13}/.exec(String(id ?? ''));
  return m ? isoFromEpoch(Number(m[0])) : null;
}

/** ja-JP ロケール文字列などを緩くパースする。無理なら null */
export function parseLooseDate(v: unknown): ISODateTime | null {
  const s = str(v).trim();
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : isoFromEpoch(ms);
}

export interface DateResolution {
  iso: ISODateTime;
  /** 復元できず migratedAt で代用した */
  approx: boolean;
}

/**
 * v1 レコードの createdAt を復元する。優先順位:
 *  1. dateStr + timeStr（日付編集した項目のみ存在）をローカル日時として ISO 化
 *  2. time が 'YYYY-MM-DD HH:MM' 形式ならそれ
 *  3. id 先頭の13桁タイムスタンプ（接頭辞は除去）
 *  4. どれも駄目なら migratedAt を充当し _approxDate: true
 */
export function resolveCreatedAt(
  raw: Record<string, unknown>,
  migratedAt: ISODateTime,
): DateResolution {
  const fromParts = localIso(str(raw['dateStr']), str(raw['timeStr']));
  if (fromParts) return { iso: fromParts, approx: false };

  const time = str(raw['time']).trim();
  const full = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})/.exec(time);
  if (full) {
    const iso = localIso(full[1]!, full[2]!);
    if (iso) return { iso, approx: false };
  }

  const fromId = timestampFromLegacyId(raw['id']);
  if (fromId) return { iso: fromId, approx: false };

  return { iso: migratedAt, approx: true };
}

// ---------------------------------------------------------------- フィールド正規化

/** v1 の order は 配列 / 文字列 / false / 'false' が混在する（v1 実装と同じ規則で畳む） */
export function normalizeOrder(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((o): o is string => typeof o === 'string' && o !== '');
  }
  if (typeof raw === 'string' && raw !== '' && raw !== 'false') return [raw];
  return [];
}

function normalizeEnlarge(v: unknown): PopEnlarge {
  const s = str(v);
  return s === 'A4' || s === 'A3' || s === 'A2' ? s : '';
}

/**
 * POP の正規化。popDetails（新形式）を優先し、無ければ popSize（旧形式・文字列）を1件に畳む。
 * v2 で追加された lami / enlarge / assignee は既定値で補完する。
 */
export function normalizePop(raw: Record<string, unknown>): PopDetail[] {
  const details = asArray(raw['popDetails']);
  const out: PopDetail[] = [];
  for (const d of details) {
    const r = asRecord(d);
    if (!r) continue;
    const qty = Math.trunc(num(r['qty'], 1));
    out.push({
      size: str(r['size']),
      qty: qty > 0 ? qty : 1,
      lami: bool(r['lami']),
      enlarge: normalizeEnlarge(r['enlarge']),
      assignee: str(r['assignee']),
    });
  }
  if (out.length) return out;

  const popSize = str(raw['popSize']).trim();
  if (popSize) return [{ size: popSize, qty: 1, lami: false, enlarge: '', assignee: '' }];

  // pop フラグだけ立っていて内訳が無い場合、「POPあり」の情報だけは残す
  if (raw['pop'] === true) return [{ size: '', qty: 1, lami: false, enlarge: '', assignee: '' }];
  return [];
}

function normalizeColor(v: unknown): string {
  const s = str(v);
  return (NOTE_COLORS as readonly string[]).includes(s) ? s : NOTE_COLORS[0];
}

const COMP_REASONS: readonly CompetitorReason[] = [
  'ヘッダー変更',
  '売価変更',
  '新規導入',
  '廃番',
  'その他',
];

function normalizeReason(v: unknown): CompetitorReason {
  const s = str(v);
  return (COMP_REASONS as readonly string[]).includes(s) ? (s as CompetitorReason) : 'その他';
}

const DELIVERY_WORDS = ['開店', '午前', '午後', '夕方', '夜'];

function normalizeDeliveryTime(v: unknown): DeliveryTime {
  const s = str(v).trim();
  if (DELIVERY_WORDS.includes(s)) return s as DeliveryTime;
  if (/^\d{1,2}:\d{2}$/.test(s)) return s as DeliveryTime;
  return '';
}

// ---------------------------------------------------------------- コレクション変換

export interface Converted<T> {
  items: T[];
  dropped: number;
  approxDate: number;
}

function emptyConverted<T>(): Converted<T> {
  return { items: [], dropped: 0, approxDate: 0 };
}

/** v1 スキャン履歴 1件 → ScanItem。REMINDER 疑似アイテムと壊れたレコードは null */
export function convertScanItem(raw: unknown, migratedAt: ISODateTime): ScanItem | null {
  const r = asRecord(raw);
  if (!r) return null;
  // 'REMINDER' はリマインダー発火時に生成される疑似アイテム。
  // 本体は barcode_master_reminders 側から Note として拾うのでここでは捨てる
  if (str(r['code']) === 'REMINDER') return null;

  const { iso, approx } = resolveCreatedAt(r, migratedAt);
  const item: ScanItem = {
    id: newId(),
    createdAt: iso,
    updatedAt: iso,
    jan: str(r['code']),
    name: str(r['productName']),
    memo: str(r['memo']),
    genre: str(r['genre']),
    end: bool(r['end']),
    pop: normalizePop(r),
    order: normalizeOrder(r['order']),
    expiry: dateOnly(r['expiry']),
    boxJan: str(r['boxJan']),
    protected: bool(r['isProtected']),
    noLearn: bool(r['isNoLearn']),
  };
  const legacyId = str(r['id']);
  if (legacyId) item._legacyId = legacyId;
  if (approx) item._approxDate = true;
  return item;
}

export function convertScanList(raw: unknown, migratedAt: ISODateTime): Converted<ScanItem> {
  const out = emptyConverted<ScanItem>();
  for (const entry of asArray(raw)) {
    const item = convertScanItem(entry, migratedAt);
    if (!item) {
      out.dropped++;
      continue;
    }
    if (item._approxDate) out.approxDate++;
    out.items.push(item);
  }
  return out;
}

/**
 * v1 学習辞書 → Product。値が文字列だけの旧形式にも対応する。
 * v1 には名前の出所が無いので、手入力扱い（manual）として引き継ぐ。
 */
export function convertProducts(
  raw: unknown,
  migratedAt: ISODateTime,
): { products: Record<string, Product>; dropped: number; v1Count: number } {
  const db = asRecord(raw);
  const products: Record<string, Product> = {};
  let dropped = 0;
  let v1Count = 0;
  if (!db) return { products, dropped, v1Count };

  for (const jan of Object.keys(db)) {
    v1Count++;
    const value = db[jan];
    let name = '';
    let boxJan = '';
    let lastUsedAt = migratedAt;

    if (typeof value === 'string') {
      name = value;
    } else {
      const r = asRecord(value);
      if (!r) {
        dropped++;
        continue;
      }
      name = str(r['name']);
      boxJan = str(r['boxJan']);
      lastUsedAt = isoFromEpoch(num(r['lastUsed'], NaN)) ?? migratedAt;
    }
    products[jan] = {
      jan,
      name,
      nameSource: 'manual',
      boxJan,
      expiryOffsets: [],
      lastUsedAt,
      updatedAt: migratedAt,
    };
  }
  return { products, dropped, v1Count };
}

export function convertCompetitor(raw: unknown, migratedAt: ISODateTime): Competitor | null {
  const r = asRecord(raw);
  if (!r) return null;
  const date = dateOnly(r['date']);
  const iso = timestampFromLegacyId(r['id']) ?? (date ? localIso(date, '0:00') : null);
  const item: Competitor = {
    id: newId(),
    createdAt: iso ?? migratedAt,
    updatedAt: iso ?? migratedAt,
    date,
    jan: str(r['jan']),
    name: str(r['name']),
    reason: normalizeReason(r['reason']),
    memo: str(r['memo']),
    dismissed: bool(r['dismissed']),
  };
  const legacyId = str(r['id']);
  if (legacyId) item._legacyId = legacyId;
  if (!iso) item._approxDate = true;
  return item;
}

export function convertReturnItem(raw: unknown, migratedAt: ISODateTime): ReturnItem | null {
  const r = asRecord(raw);
  if (!r) return null;
  const start = dateOnly(r['start'] ?? r['startDate']);
  const iso = timestampFromLegacyId(r['id']) ?? (start ? localIso(start, '0:00') : null);
  const item: ReturnItem = {
    id: newId(),
    createdAt: iso ?? migratedAt,
    updatedAt: iso ?? migratedAt,
    jan: str(r['jan']),
    start,
    end: dateOnly(r['end'] ?? r['endDate']),
    returnDate: dateOnly(r['returnDate']),
    memo: str(r['memo']),
    dismissed: bool(r['dismissed']),
  };
  const legacyId = str(r['id']);
  if (legacyId) item._legacyId = legacyId;
  if (!iso) item._approxDate = true;
  return item;
}

export function convertCustomerOrder(raw: unknown, migratedAt: ISODateTime): CustomerOrder | null {
  const r = asRecord(raw);
  if (!r) return null;
  const iso = timestampFromLegacyId(r['id']);
  const item: CustomerOrder = {
    id: newId(),
    createdAt: iso ?? migratedAt,
    updatedAt: iso ?? migratedAt,
    jan: str(r['jan']),
    name: str(r['name']),
    qty: Math.trunc(num(r['qty'], 1)),
    caseQty: Math.trunc(num(r['caseQty'], 0)),
    ordered: bool(r['ordered']),
    arrivalDate: dateOnly(r['arrivalDate']),
    deliveryDate: dateOnly(r['deliveryDate']),
    deliveryTime: normalizeDeliveryTime(r['deliveryTime']),
    phone: str(r['phone']),
    willCall: bool(r['willCall']),
    called: bool(r['called']),
    memo: str(r['memo']),
    dismissedArrival: bool(r['dismissedArrival']),
    dismissedDelivery: bool(r['dismissedDelivery']),
    addedToHistory: bool(r['addedToHistory']),
  };
  const legacyId = str(r['id']);
  if (legacyId) item._legacyId = legacyId;
  if (!iso) item._approxDate = true;
  return item;
}

/** v1 リマインダー → Note（remindAt 付き）。fired は firedAt=migratedAt に畳む */
export function convertReminder(raw: unknown, migratedAt: ISODateTime): Note | null {
  const r = asRecord(raw);
  if (!r) return null;
  const dt = str(r['datetime']);
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})/.exec(dt);
  const remindAt = m ? localIso(m[1]!, m[2]!) : null;
  const iso = timestampFromLegacyId(r['id']);

  const note: Note = {
    id: newId(),
    createdAt: iso ?? migratedAt,
    updatedAt: iso ?? migratedAt,
    title: '',
    text: str(r['memo']),
    color: NOTE_COLORS[0],
    pinned: false,
  };
  if (remindAt) note.remindAt = remindAt;
  // v1 は発火時刻を保持していないため、移行時刻を発火済みの印として使う
  if (bool(r['fired'])) note.firedAt = migratedAt;
  const legacyId = str(r['id']);
  if (legacyId) note._legacyId = legacyId;
  if (!iso) note._approxDate = true;
  return note;
}

export function convertNote(raw: unknown, migratedAt: ISODateTime): Note | null {
  const r = asRecord(raw);
  if (!r) return null;
  const iso = isoFromEpoch(num(r['updated'], NaN)) ?? timestampFromLegacyId(r['id']);
  const note: Note = {
    id: newId(),
    createdAt: iso ?? migratedAt,
    updatedAt: iso ?? migratedAt,
    title: str(r['title']),
    text: str(r['text']),
    color: normalizeColor(r['color']),
    pinned: bool(r['pinned']),
  };
  const legacyId = str(r['id']);
  if (legacyId) note._legacyId = legacyId;
  if (!iso) note._approxDate = true;
  return note;
}

/** 仕分番長の便メモ（sb_global_memo / sb_memo_history）→ tag:'bin-memo' の Note */
export function convertBinMemos(
  globalMemo: string | null,
  history: unknown,
  migratedAt: ISODateTime,
): Converted<Note> {
  const out = emptyConverted<Note>();

  const current = (globalMemo ?? '').trim();
  if (current) {
    out.items.push({
      id: newId(),
      createdAt: migratedAt,
      updatedAt: migratedAt,
      title: '便メモ',
      text: current,
      color: NOTE_COLORS[0],
      pinned: false,
      tag: 'bin-memo',
      _approxDate: true,
    });
    out.approxDate++;
  }

  for (const entry of asArray(history)) {
    const r = asRecord(entry);
    if (!r) {
      out.dropped++;
      continue;
    }
    const text = str(r['text']).trim();
    if (!text) {
      out.dropped++;
      continue;
    }
    // v1 は toLocaleString('ja-JP') で保存しているためパースできないことがある
    const iso = parseLooseDate(r['date']);
    const note: Note = {
      id: newId(),
      createdAt: iso ?? migratedAt,
      updatedAt: iso ?? migratedAt,
      title: '便メモ',
      text,
      color: NOTE_COLORS[0],
      pinned: false,
      tag: 'bin-memo',
    };
    if (!iso) {
      note._approxDate = true;
      out.approxDate++;
    }
    out.items.push(note);
  }
  return out;
}

/** 仕分番長 sb_items / sb_carts / sb_alert_words → ShiwakeState */
export function convertShiwake(
  itemsRaw: unknown,
  cartsRaw: unknown,
  alertWordsRaw: unknown,
  migratedAt: ISODateTime,
): { state: ShiwakeState; dropped: number; v1Count: number } {
  const items: ShiwakeItem[] = [];
  const carts: ShiwakeCart[] = [];
  let dropped = 0;
  let v1Count = 0;

  for (const entry of asArray(itemsRaw)) {
    v1Count++;
    const r = asRecord(entry);
    if (!r) {
      dropped++;
      continue;
    }
    // v1 は qty_per_case（スネークケース）。未設定は null
    const rawQty = r['qty_per_case'] ?? r['qtyPerCase'];
    const qtyPerCase =
      rawQty === null || rawQty === undefined || rawQty === '' ? null : num(rawQty, NaN);
    items.push({
      id: newId(),
      name: str(r['name']),
      code: str(r['code']),
      jan: str(r['jan']),
      qtyPerCase: qtyPerCase !== null && Number.isFinite(qtyPerCase) ? qtyPerCase : null,
      cases: Math.trunc(num(r['cases'], 0)),
      cartIndex: Math.trunc(num(r['cartIndex'], 0)),
      memo: str(r['memo']),
      isAlert: bool(r['isAlert']),
    });
  }

  for (const entry of asArray(cartsRaw)) {
    v1Count++;
    const r = asRecord(entry);
    if (!r) {
      dropped++;
      continue;
    }
    carts.push({
      index: Math.trunc(num(r['index'], carts.length)),
      label: str(r['label']),
      // v1 は delivery_date（スネークケース）
      deliveryDate: dateOnly(r['delivery_date'] ?? r['deliveryDate']),
    });
  }

  const alertWords = asArray(alertWordsRaw).filter(
    (w): w is string => typeof w === 'string' && w !== '',
  );
  v1Count += alertWords.length;

  return { state: { items, carts, alertWords, updatedAt: migratedAt }, dropped, v1Count };
}

// ---------------------------------------------------------------- 移行本体

export function needsMigration(): boolean {
  return !hasCollection('meta');
}

function report(
  target: string,
  sources: string[],
  v1Count: number,
  v2Count: number,
  dropped: number,
  approxDate: number,
): MigrationCollectionReport {
  return { target, sources, v1Count, v2Count, dropped, approxDate };
}

/**
 * v1 → v2 の移行を実行する。KEYS.meta が既にあれば何もしない。
 * v1 のキーは読むだけで、削除も書き換えもしない。
 */
export function runMigration(migratedAt: ISODateTime = nowIso()): MigrationReport {
  const base: MigrationReport = {
    ran: false,
    migratedAt,
    collections: [],
    totals: { v1Count: 0, v2Count: 0, dropped: 0, approxDate: 0 },
    errors: [],
  };

  if (!needsMigration()) return { ...base, reason: 'already-migrated' };

  const migratedFrom: string[] = [];
  const touched = (key: string, present: boolean): void => {
    if (present) migratedFrom.push(key);
  };

  // ---- 読み取り（v1 キーは読むだけ） ----
  const rawList = readJson<unknown>(LEGACY_KEYS.list);
  const rawDb = readJson<unknown>(LEGACY_KEYS.db);
  const rawComp = readJson<unknown>(LEGACY_KEYS.comp);
  const rawReturn = readJson<unknown>(LEGACY_KEYS.return);
  const rawCust = readJson<unknown>(LEGACY_KEYS.cust);
  const rawReminders = readJson<unknown>(LEGACY_KEYS.reminders);
  const rawNotes = readJson<unknown>(LEGACY_KEYS.notes);
  const rawShareTb = readJson<unknown>(LEGACY_KEYS.shareTanabancho);
  const rawShareSf = readJson<unknown>(LEGACY_KEYS.shareSellfloor);
  const rawSbItems = readJson<unknown>(LEGACY_KEYS.sbItems);
  const rawSbCarts = readJson<unknown>(LEGACY_KEYS.sbCarts);
  const rawSbWords = readJson<unknown>(LEGACY_KEYS.sbAlertWords);
  // 便メモは JSON ではなく素の文字列で保存されている
  const rawSbMemo = readRaw(LEGACY_KEYS.sbGlobalMemo);
  const rawSbMemoHist = readJson<unknown>(LEGACY_KEYS.sbMemoHistory);

  // ---- 変換（すべてメモリ上で完了させる） ----
  const scans = convertScanList(rawList, migratedAt);
  touched(LEGACY_KEYS.list, rawList !== null);
  base.collections.push(
    report(
      'scans',
      [LEGACY_KEYS.list],
      asArray(rawList).length,
      scans.items.length,
      scans.dropped,
      scans.approxDate,
    ),
  );

  const products = convertProducts(rawDb, migratedAt);
  touched(LEGACY_KEYS.db, rawDb !== null);
  base.collections.push(
    report(
      'products',
      [LEGACY_KEYS.db],
      products.v1Count,
      Object.keys(products.products).length,
      products.dropped,
      0,
    ),
  );

  const comp = convertMany(rawComp, migratedAt, convertCompetitor);
  touched(LEGACY_KEYS.comp, rawComp !== null);
  base.collections.push(
    report(
      'comp',
      [LEGACY_KEYS.comp],
      asArray(rawComp).length,
      comp.items.length,
      comp.dropped,
      comp.approxDate,
    ),
  );

  const returns = convertMany(rawReturn, migratedAt, convertReturnItem);
  touched(LEGACY_KEYS.return, rawReturn !== null);
  base.collections.push(
    report(
      'returns',
      [LEGACY_KEYS.return],
      asArray(rawReturn).length,
      returns.items.length,
      returns.dropped,
      returns.approxDate,
    ),
  );

  const cust = convertMany(rawCust, migratedAt, convertCustomerOrder);
  touched(LEGACY_KEYS.cust, rawCust !== null);
  base.collections.push(
    report(
      'cust',
      [LEGACY_KEYS.cust],
      asArray(rawCust).length,
      cust.items.length,
      cust.dropped,
      cust.approxDate,
    ),
  );

  // notes = v1 メモ + リマインダー + 仕分番長の便メモ
  const reminderNotes = convertMany(rawReminders, migratedAt, convertReminder);
  const plainNotes = convertMany(rawNotes, migratedAt, convertNote);
  const binMemos = convertBinMemos(rawSbMemo, rawSbMemoHist, migratedAt);
  touched(LEGACY_KEYS.reminders, rawReminders !== null);
  touched(LEGACY_KEYS.notes, rawNotes !== null);
  touched(LEGACY_KEYS.sbGlobalMemo, (rawSbMemo ?? '').trim() !== '');
  touched(LEGACY_KEYS.sbMemoHistory, rawSbMemoHist !== null);
  const notes = [...plainNotes.items, ...reminderNotes.items, ...binMemos.items];
  base.collections.push(
    report(
      'notes',
      [
        LEGACY_KEYS.notes,
        LEGACY_KEYS.reminders,
        LEGACY_KEYS.sbGlobalMemo,
        LEGACY_KEYS.sbMemoHistory,
      ],
      asArray(rawNotes).length +
        asArray(rawReminders).length +
        asArray(rawSbMemoHist).length +
        ((rawSbMemo ?? '').trim() ? 1 : 0),
      notes.length,
      plainNotes.dropped + reminderNotes.dropped + binMemos.dropped,
      plainNotes.approxDate + reminderNotes.approxDate + binMemos.approxDate,
    ),
  );

  // 共有ビューの受信キャッシュ（棚番長版 / 売場版の2キーを統合）
  const shareTb = convertScanList(rawShareTb, migratedAt);
  const shareSf = convertScanList(rawShareSf, migratedAt);
  touched(LEGACY_KEYS.shareTanabancho, rawShareTb !== null);
  touched(LEGACY_KEYS.shareSellfloor, rawShareSf !== null);
  const shareRecv = dedupeByLegacyId([...shareTb.items, ...shareSf.items]);
  base.collections.push(
    report(
      'shareRecv',
      [LEGACY_KEYS.shareTanabancho, LEGACY_KEYS.shareSellfloor],
      asArray(rawShareTb).length + asArray(rawShareSf).length,
      shareRecv.length,
      shareTb.dropped + shareSf.dropped + (shareTb.items.length + shareSf.items.length - shareRecv.length),
      shareTb.approxDate + shareSf.approxDate,
    ),
  );

  const shiwake = convertShiwake(rawSbItems, rawSbCarts, rawSbWords, migratedAt);
  touched(LEGACY_KEYS.sbItems, rawSbItems !== null);
  touched(LEGACY_KEYS.sbCarts, rawSbCarts !== null);
  touched(LEGACY_KEYS.sbAlertWords, rawSbWords !== null);
  base.collections.push(
    report(
      'shiwake',
      [LEGACY_KEYS.sbItems, LEGACY_KEYS.sbCarts, LEGACY_KEYS.sbAlertWords],
      shiwake.v1Count,
      shiwake.state.items.length + shiwake.state.carts.length + shiwake.state.alertWords.length,
      shiwake.dropped,
      0,
    ),
  );

  for (const c of base.collections) {
    base.totals.v1Count += c.v1Count;
    base.totals.v2Count += c.v2Count;
    base.totals.dropped += c.dropped;
    base.totals.approxDate += c.approxDate;
  }

  const meta: MetaV2 = { schemaVersion: 2, migratedAt, migratedFrom };

  // 便メモの「現在の下書き」は履歴（notes）に加えて下書きキーにも引き継ぐ。
  // v1 は sb_global_memo が編集中テキストそのものだったので、これが無いと
  // 移行直後にメモ欄が空になってしまう（履歴には残るがユーザー体験としては後退）。
  const memoDraft = (rawSbMemo ?? '').trim();

  // ---- 一括書き込み（meta は最後。失敗したら全部巻き戻す） ----
  const result = writeBatch([
    collectionEntry('settings', getCollection('settings')),
    collectionEntry('scans', scans.items),
    collectionEntry('products', products.products),
    collectionEntry('comp', comp.items),
    collectionEntry('returns', returns.items),
    collectionEntry('cust', cust.items),
    collectionEntry('notes', notes),
    collectionEntry('orders', []),
    collectionEntry('shareRecv', shareRecv),
    collectionEntry('shiwake', shiwake.state),
    collectionEntry('shiwakeMeta', meta),
    ...(memoDraft ? [collectionEntry('shiwakeMemoDraft', memoDraft)] : []),
    collectionEntry('meta', meta),
  ]);

  if (!result.ok) {
    base.errors.push(
      `保存に失敗しました（${result.failedKey ?? '不明なキー'}）。容量不足の可能性があります。v1 のデータはそのまま残っています。`,
    );
    return { ...base, reason: 'write-failed' };
  }

  base.ran = true;
  return base;
}

// ---------------------------------------------------------------- 起動時フック

let bootReport: MigrationReport | null = null;

/**
 * 各エントリ（本体 / 共有 / 仕分番長）の起動時に **描画前** へ1回だけ呼ぶ。
 * 必要なときだけ移行を実行し、結果を保持する。同一セッション内では冪等。
 *
 * @returns 実際に移行したときだけレポート。不要（移行済み）なら null
 */
export function bootMigration(): MigrationReport | null {
  if (bootReport) return bootReport;
  if (!needsMigration()) return null;
  bootReport = runMigration();
  return bootReport;
}

/** bootMigration の結果を後から参照する（描画後のシート/トースト表示用） */
export function lastMigrationReport(): MigrationReport | null {
  return bootReport;
}

/** テスト用。bootMigration のキャッシュを捨てる */
export function __resetBootMigrationForTest(): void {
  bootReport = null;
}

/**
 * 旧 `sb_api_key`（v1 仕分番長の Gemini APIキー）。
 * バックアップにも v2 コレクションにも載せない値なので移行対象外だが、
 * LEGACY_KEYS を読むのは migrate.ts だけ、という規約を守るためここに置く。
 */
export function readLegacyApiKey(): string | null {
  const raw = readRaw(LEGACY_KEYS.sbApiKey);
  return raw && raw.trim() ? raw.trim() : null;
}

function convertMany<T>(
  raw: unknown,
  migratedAt: ISODateTime,
  fn: (raw: unknown, migratedAt: ISODateTime) => T | null,
): Converted<T & { _approxDate?: boolean }> {
  const out = emptyConverted<T & { _approxDate?: boolean }>();
  for (const entry of asArray(raw)) {
    const item = fn(entry, migratedAt) as (T & { _approxDate?: boolean }) | null;
    if (!item) {
      out.dropped++;
      continue;
    }
    if (item._approxDate) out.approxDate++;
    out.items.push(item);
  }
  return out;
}

/** 型強制ヘルパー。backup.ts の取込バリデーションでも使う */
export { asRecord as toRecord, asArray as toArray, str as toStr, bool as toBool, num as toNum };

/** _legacyId の重複を落とす（先勝ち）。_legacyId が無いものは常に残す */
export function dedupeByLegacyId<T extends { _legacyId?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const key = it._legacyId;
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(it);
  }
  return out;
}
