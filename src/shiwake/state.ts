/**
 * 仕分番長の永続化。localStorage への直接アクセスはせず core/storage 経由。
 */

import { readJson, writeJson } from '@core/storage';
import { formatDateTime, nowIso } from '@core/datetime';
import {
  KEYS,
  NOTE_COLORS,
  type CustomerOrder,
  type MetaV2,
  type Note,
  type Product,
  type ShiwakeState,
} from '@core/types';
import { readLegacyBinMemo, readLegacyMemoHistory, readLegacyShiwakeState } from './legacy';

/** 便メモの下書き。KEYS に無い仕分番長ローカルのキー（統合時に KEYS へ昇格を依頼する） */
export const BIN_MEMO_DRAFT_KEY = 'sb.v2.memo';

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
 * 保存済み state を読む。無ければ v1（sb_*）から初回取込する。
 * @returns state と、v1 から取り込んだかどうか
 */
export function loadShiwakeState(): { state: ShiwakeState; importedFromV1: boolean } {
  const existing = sanitize(readJson<unknown>(KEYS.shiwake));
  if (existing) return { state: existing, importedFromV1: false };

  const legacy = readLegacyShiwakeState();
  if (legacy) {
    writeJson(KEYS.shiwake, legacy);
    const meta: MetaV2 = {
      schemaVersion: 2,
      migratedAt: nowIso(),
      migratedFrom: ['sb_items', 'sb_carts', 'sb_alert_words'],
    };
    writeJson(KEYS.shiwakeMeta, meta);
    return { state: legacy, importedFromV1: true };
  }
  return { state: emptyShiwakeState(), importedFromV1: false };
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
  const v2 = readJson<string>(BIN_MEMO_DRAFT_KEY);
  if (typeof v2 === 'string') return v2;
  return readLegacyBinMemo();
}

export function saveBinMemoDraft(text: string): boolean {
  return writeJson(BIN_MEMO_DRAFT_KEY, text);
}

function loadNotes(): Note[] {
  const raw = readJson<Note[]>(KEYS.notes);
  return Array.isArray(raw) ? raw : [];
}

/** 便メモ履歴（新しい順） */
export function loadBinMemoHistory(): Note[] {
  const notes = loadNotes().filter((n) => n?.tag === BIN_MEMO_TAG);
  if (notes.length) {
    return [...notes].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }
  // v2 に履歴が無ければ v1 の sb_memo_history を表示用に読み込む（書き戻しはしない）
  return readLegacyMemoHistory().map((e, i) => ({
    id: `legacy-memo-${i}`,
    createdAt: '',
    updatedAt: '',
    title: e.date,
    text: e.text,
    color: NOTE_COLORS[0],
    pinned: false,
    tag: BIN_MEMO_TAG,
  }));
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
