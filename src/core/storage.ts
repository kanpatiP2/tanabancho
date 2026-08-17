/**
 * 永続化層。P1-A が migrate/backup と合わせて拡張する。
 * localStorage を直接触るのはこのモジュールだけ（テストでは backend を差し替える）。
 */

import { DEFAULT_SETTINGS } from './profile';
import type {
  Competitor,
  CustomerOrder,
  MetaV2,
  Note,
  OrderList,
  Product,
  ReturnItem,
  ScanItem,
  Settings,
  ShiwakeState,
} from './types';
import { KEYS } from './types';

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let backend: StorageBackend =
  typeof localStorage !== 'undefined' ? localStorage : createMemoryBackend();

export function setStorageBackend(b: StorageBackend): void {
  backend = b;
}

export function createMemoryBackend(): StorageBackend {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

// ---------------------------------------------------------------- 容量超過の通知

export type QuotaHandler = (key: string, error: unknown) => void;

let quotaHandler: QuotaHandler | null = null;

/**
 * QuotaExceeded 発生時のフック（トースト表示などに使う）。
 * writeJson は従来どおり false を返すので、呼び出し側で個別に扱うことも可能。
 */
export function setQuotaHandler(h: QuotaHandler | null): void {
  quotaHandler = h;
}

// ---------------------------------------------------------------- 低レベル I/O

/** 破損データは null 扱い（起動不能を防ぐ） */
export function readJson<T>(key: string): T | null {
  const raw = backend.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** QuotaExceeded 時は false を返す（呼び出し側でトースト表示） */
export function writeJson(key: string, value: unknown): boolean {
  try {
    backend.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    quotaHandler?.(key, e);
    return false;
  }
}

export function readRaw(key: string): string | null {
  return backend.getItem(key);
}

export function removeKey(key: string): void {
  backend.removeItem(key);
}

export function hasKey(key: string): boolean {
  return backend.getItem(key) !== null;
}

// ---------------------------------------------------------------- コレクション

/** KEYS の各キーに保存される値の型。 */
export interface StorageSchema {
  meta: MetaV2;
  settings: Settings;
  scans: ScanItem[];
  products: Record<string, Product>;
  comp: Competitor[];
  returns: ReturnItem[];
  cust: CustomerOrder[];
  notes: Note[];
  orders: OrderList[];
  shiwake: ShiwakeState;
  shiwakeMeta: MetaV2;
  shareRecv: ScanItem[];
}

export type CollectionName = keyof StorageSchema;

export function emptyMeta(): MetaV2 {
  return { schemaVersion: 2, migratedAt: '', migratedFrom: [] };
}

export function emptyShiwakeState(): ShiwakeState {
  return { items: [], carts: [], alertWords: [], updatedAt: '' };
}

/** 未保存/破損時に返す既定値。毎回新しいオブジェクトを作る（共有変更事故を防ぐ） */
const DEFAULTS: { [K in CollectionName]: () => StorageSchema[K] } = {
  meta: emptyMeta,
  settings: () => ({ ...DEFAULT_SETTINGS }),
  scans: () => [],
  products: () => ({}),
  comp: () => [],
  returns: () => [],
  cust: () => [],
  notes: () => [],
  orders: () => [],
  shiwake: emptyShiwakeState,
  shiwakeMeta: emptyMeta,
  shareRecv: () => [],
};

/** 期待する JSON の器。合わなければ破損とみなして既定値を返す */
const KIND: Record<CollectionName, 'array' | 'object'> = {
  meta: 'object',
  settings: 'object',
  scans: 'array',
  products: 'object',
  comp: 'array',
  returns: 'array',
  cust: 'array',
  notes: 'array',
  orders: 'array',
  shiwake: 'object',
  shiwakeMeta: 'object',
  shareRecv: 'array',
};

function matchesKind(value: unknown, kind: 'array' | 'object'): boolean {
  if (kind === 'array') return Array.isArray(value);
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 型付き読み出し。未保存・破損・器違いはすべて既定値にフォールバックする。
 * settings のみ、欠けたフィールドを DEFAULT_SETTINGS で補完する。
 */
export function getCollection<K extends CollectionName>(name: K): StorageSchema[K] {
  const parsed = readJson<unknown>(KEYS[name]);
  if (parsed === null || !matchesKind(parsed, KIND[name])) return DEFAULTS[name]();
  if (name === 'settings') {
    return { ...DEFAULT_SETTINGS, ...(parsed as Partial<Settings>) } as StorageSchema[K];
  }
  return parsed as StorageSchema[K];
}

/** 型付き書き込み。QuotaExceeded 時は false（呼び出し側で通知） */
export function setCollection<K extends CollectionName>(
  name: K,
  value: StorageSchema[K],
): boolean {
  return writeJson(KEYS[name], value);
}

export function hasCollection(name: CollectionName): boolean {
  return hasKey(KEYS[name]);
}

export function removeCollection(name: CollectionName): void {
  removeKey(KEYS[name]);
}

// ---------------------------------------------------------------- 名前付きアクセサ

export const getMeta = (): MetaV2 => getCollection('meta');
export const setMeta = (v: MetaV2): boolean => setCollection('meta', v);

export const getSettings = (): Settings => getCollection('settings');
export const setSettings = (v: Settings): boolean => setCollection('settings', v);

export const getScans = (): ScanItem[] => getCollection('scans');
export const setScans = (v: ScanItem[]): boolean => setCollection('scans', v);

export const getProducts = (): Record<string, Product> => getCollection('products');
export const setProducts = (v: Record<string, Product>): boolean => setCollection('products', v);

export const getComp = (): Competitor[] => getCollection('comp');
export const setComp = (v: Competitor[]): boolean => setCollection('comp', v);

export const getReturns = (): ReturnItem[] => getCollection('returns');
export const setReturns = (v: ReturnItem[]): boolean => setCollection('returns', v);

export const getCust = (): CustomerOrder[] => getCollection('cust');
export const setCust = (v: CustomerOrder[]): boolean => setCollection('cust', v);

export const getNotes = (): Note[] => getCollection('notes');
export const setNotes = (v: Note[]): boolean => setCollection('notes', v);

export const getOrders = (): OrderList[] => getCollection('orders');
export const setOrders = (v: OrderList[]): boolean => setCollection('orders', v);

export const getShiwake = (): ShiwakeState => getCollection('shiwake');
export const setShiwake = (v: ShiwakeState): boolean => setCollection('shiwake', v);

export const getShiwakeMeta = (): MetaV2 => getCollection('shiwakeMeta');
export const setShiwakeMeta = (v: MetaV2): boolean => setCollection('shiwakeMeta', v);

export const getShareRecv = (): ScanItem[] => getCollection('shareRecv');
export const setShareRecv = (v: ScanItem[]): boolean => setCollection('shareRecv', v);

// ---------------------------------------------------------------- 一括書き込み

export interface BatchResult {
  ok: boolean;
  /** 失敗したキー（ok=false のとき） */
  failedKey?: string;
}

/**
 * 全件成功か、1件も書かないかのどちらか（migrate / importBackup 用）。
 * 途中で失敗したら、書き込み前の生の値へ巻き戻す（元が無ければ削除）。
 */
export function writeBatch(entries: { key: string; value: unknown }[]): BatchResult {
  const snapshot = new Map<string, string | null>();
  for (const { key, value } of entries) {
    if (!snapshot.has(key)) snapshot.set(key, backend.getItem(key));
    if (!writeJson(key, value)) {
      rollback(snapshot);
      return { ok: false, failedKey: key };
    }
  }
  return { ok: true };
}

function rollback(snapshot: Map<string, string | null>): void {
  for (const [key, prev] of snapshot) {
    try {
      if (prev === null) backend.removeItem(key);
      else backend.setItem(key, prev);
    } catch {
      // 巻き戻し自体が失敗しても、これ以上できることはない
    }
  }
}

/** 一括書き込み用のエントリを型安全に組み立てる */
export function collectionEntry<K extends CollectionName>(
  name: K,
  value: StorageSchema[K],
): { key: string; value: unknown } {
  return { key: KEYS[name], value };
}
