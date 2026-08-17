/**
 * 仕分番長の永続化。localStorage への直接アクセスはせず core/storage 経由。
 *
 * v1（sb_* キー）からの取込は **core/migrate.ts が唯一の実装**。
 * 起動時に `bootMigration()` が KEYS.shiwake / KEYS.notes / KEYS.shiwakeMemoDraft を
 * 書き終えているので、このモジュールは v2 キーを読むだけでよい。
 */

import { getCollection, readJson, setCollection, writeJson } from '@core/storage';
import { formatDateTime, nowIso } from '@core/datetime';
import {
  KEYS,
  NOTE_COLORS,
  type CustomerOrder,
  type Note,
  type Product,
  type ShiwakeItem,
  type ShiwakeState,
} from '@core/types';
import { reevaluateAlerts, resolveShiwakeCode } from './build';

export const BIN_MEMO_TAG = 'bin-memo';
export const BIN_MEMO_HISTORY_MAX = 20;

export function emptyShiwakeState(): ShiwakeState {
  return { items: [], carts: [], alertWords: [], updatedAt: nowIso() };
}

function sanitize(raw: unknown): ShiwakeState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<ShiwakeState>;
  if (!Array.isArray(r.items) || !Array.isArray(r.carts)) return null;
  return {
    items: r.items,
    carts: r.carts,
    alertWords: Array.isArray(r.alertWords) ? r.alertWords : [],
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : nowIso(),
  };
}

/**
 * 仕分番長ドメインの補完。
 *
 * migrate.ts は「v1 の値をそのまま v2 の器へ移す」だけなので、
 * 仕分番長固有の派生値（明細コード → JAN の解決、要注意ワード判定、
 * ラベル未設定の明細名）はここで整える。冪等なので毎回の読み込みで通してよい。
 */
function normalize(state: ShiwakeState): ShiwakeState {
  const alertWords = [...new Set(state.alertWords.filter((w) => typeof w === 'string' && w !== ''))];

  const items: ShiwakeItem[] = state.items
    .filter((i): i is ShiwakeItem => Boolean(i && i.name))
    .map((i) => (i.jan ? i : { ...i, jan: resolveShiwakeCode(i.code).jan }));

  const carts = state.carts.map((c, i) => ({
    ...c,
    label: c.label || `明細${i + 1}`,
  }));

  return { ...state, items: reevaluateAlerts(items, alertWords), carts, alertWords };
}

/** 保存済み state を読む（v1 取込は起動時の migrate が済ませている） */
export function loadShiwakeState(): ShiwakeState {
  const existing = sanitize(readJson<unknown>(KEYS.shiwake));
  return existing ? normalize(existing) : emptyShiwakeState();
}

export function saveShiwakeState(state: ShiwakeState): boolean {
  return writeJson(KEYS.shiwake, { ...state, updatedAt: nowIso() });
}

// ---------------------------------------------------------------- 辞書 / 客注

export function loadProducts(): Record<string, Product> {
  const raw = readJson<Record<string, Product>>(KEYS.products);
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

export function saveProducts(products: Record<string, Product>): boolean {
  return writeJson(KEYS.products, products);
}

export function loadCustomerOrders(): CustomerOrder[] {
  const raw = readJson<CustomerOrder[]>(KEYS.cust);
  return Array.isArray(raw) ? raw : [];
}

// ---------------------------------------------------------------- 便メモ

export function loadBinMemoDraft(): string {
  return getCollection('shiwakeMemoDraft');
}

export function saveBinMemoDraft(text: string): boolean {
  return setCollection('shiwakeMemoDraft', text);
}

function loadNotes(): Note[] {
  const raw = readJson<Note[]>(KEYS.notes);
  return Array.isArray(raw) ? raw : [];
}

/** 便メモ履歴（新しい順）。v1 の sb_memo_history は migrate が Note へ変換済み */
export function loadBinMemoHistory(): Note[] {
  return loadNotes()
    .filter((n) => n?.tag === BIN_MEMO_TAG)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `note_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * 便メモを履歴（KEYS.notes / tag='bin-memo'）へ確定する。
 * v1 は `unshift` 後 `pop()` 1回だけで 20件を超えたまま残るバグがあったため、slice で正しく丸める。
 * 他タグの Note には触らない。
 */
export function pushBinMemoHistory(text: string): Note[] {
  const trimmed = text.trim();
  if (!trimmed) return loadBinMemoHistory();

  const now = nowIso();
  const note: Note = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    title: `便メモ ${formatDateTime(now)}`,
    text: trimmed,
    color: NOTE_COLORS[0],
    pinned: false,
    tag: BIN_MEMO_TAG,
  };

  const all = loadNotes();
  const others = all.filter((n) => n?.tag !== BIN_MEMO_TAG);
  const mine = [note, ...all.filter((n) => n?.tag === BIN_MEMO_TAG)]
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, BIN_MEMO_HISTORY_MAX);

  writeJson(KEYS.notes, [...mine, ...others]);
  return mine;
}
