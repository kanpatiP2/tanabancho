/**
 * 本体UIの状態管理（薄い store 層）。
 *
 * 方針:
 * - localStorage への読み書きは `@core/storage` 経由に一本化し、このモジュールだけが呼ぶ
 * - 「コレクション読込 → signal → 保存」の一方向。描画側は signal を読むだけ
 * - データ変更は必ずここのミューテータ経由（描画関数内での保存・追加は禁止）
 */
import { computed, signal } from '@preact/signals';
import { DEFAULT_SETTINGS, PROFILES } from '@core/profile';
import { readRaw, readJson, writeJson } from '@core/storage';
import { nowIso } from '@core/datetime';
import { mergeProduct, pushExpiryOffset } from '@core/dict';
import {
  KEYS,
  type Competitor,
  type CustomerOrder,
  type Entity,
  type ISODateTime,
  type Note,
  type NameSource,
  type OrderList,
  type Product,
  type Profile,
  type ReturnItem,
  type ScanItem,
  type Settings,
} from '@core/types';

// ---------------------------------------------------------------- 基盤

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 新規エンティティの共通フィールド */
export function stamp(): Pick<Entity, 'id' | 'createdAt' | 'updatedAt'> {
  const now = nowIso();
  return { id: newId(), createdAt: now, updatedAt: now };
}

/** 容量超過などの保存失敗を UI に伝えるフック（App が toast を接続する） */
let storageErrorHandler: ((message: string) => void) | null = null;
export function setStorageErrorHandler(fn: ((message: string) => void) | null): void {
  storageErrorHandler = fn;
}

function persist(key: string, value: unknown): void {
  if (!writeJson(key, value)) {
    storageErrorHandler?.('保存容量が上限に達しました。古い履歴を削除してください');
  }
}

// ---------------------------------------------------------------- signals

export const settings = signal<Settings>({ ...DEFAULT_SETTINGS });
export const scans = signal<ScanItem[]>([]);
export const products = signal<Record<string, Product>>({});
export const competitors = signal<Competitor[]>([]);
export const returns = signal<ReturnItem[]>([]);
export const customerOrders = signal<CustomerOrder[]>([]);
export const notes = signal<Note[]>([]);
export const orderLists = signal<OrderList[]>([]);

export const profile = computed<Profile>(() => PROFILES[settings.value.profile] ?? PROFILES.generic);

/** 一覧描画で使う辞書引き（jan → 商品名） */
export const productName = computed(() => {
  const db = products.value;
  return (jan: string): string => db[jan]?.name ?? '';
});

// ---------------------------------------------------------------- 読込

function normalizeSettings(raw: Partial<Settings> | null): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...raw };
}

/** 起動時に一度だけ呼ぶ。破損データは既定値で起動する（起動不能を防ぐ） */
export function loadAll(): void {
  settings.value = normalizeSettings(readJson<Partial<Settings>>(KEYS.settings));
  scans.value = readJson<ScanItem[]>(KEYS.scans) ?? [];
  products.value = readJson<Record<string, Product>>(KEYS.products) ?? {};
  competitors.value = readJson<Competitor[]>(KEYS.comp) ?? [];
  returns.value = readJson<ReturnItem[]>(KEYS.returns) ?? [];
  customerOrders.value = readJson<CustomerOrder[]>(KEYS.cust) ?? [];
  notes.value = readJson<Note[]>(KEYS.notes) ?? [];
  orderLists.value = readJson<OrderList[]>(KEYS.orders) ?? [];
}

// ---------------------------------------------------------------- 設定

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
  persist(KEYS.settings, settings.value);
}

// ---------------------------------------------------------------- 履歴（ScanItem）

export function emptyScan(jan: string): ScanItem {
  return {
    ...stamp(),
    jan,
    name: '',
    memo: '',
    genre: '',
    end: false,
    pop: [],
    order: [],
    expiry: '',
    boxJan: '',
    protected: false,
    noLearn: false,
  };
}

function commitScans(next: ScanItem[]): void {
  scans.value = next;
  persist(KEYS.scans, next);
}

/** 新しいものが先頭。戻り値は登録された item */
export function addScan(item: ScanItem): ScanItem {
  commitScans([item, ...scans.value]);
  return item;
}

/** 一覧の先頭に戻す用（Undo）。index を指定するとその位置に差し戻す */
export function restoreScan(item: ScanItem, index: number): void {
  const next = [...scans.value];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  commitScans(next);
}

export function updateScan(id: string, patch: Partial<ScanItem>): void {
  commitScans(
    scans.value.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: nowIso() } : s)),
  );
}

/** 削除した item と元の index を返す（Undo トースト用）。保護中は削除しない */
export function deleteScan(id: string): { item: ScanItem; index: number } | null {
  const index = scans.value.findIndex((s) => s.id === id);
  const item = index >= 0 ? scans.value[index] : undefined;
  if (!item || item.protected) return null;
  commitScans(scans.value.filter((s) => s.id !== id));
  return { item, index };
}

/** 複数削除。保護中は残す。戻り値は削除された item 群（Undo 用） */
export function deleteScans(ids: Iterable<string>): ScanItem[] {
  const target = new Set(ids);
  const removed: ScanItem[] = [];
  const kept = scans.value.filter((s) => {
    if (!target.has(s.id) || s.protected) return true;
    removed.push(s);
    return false;
  });
  if (removed.length) commitScans(kept);
  return removed;
}

/** Undo: まとめて戻す（順序は createdAt の新しい順で先頭に積み直す） */
export function restoreScans(items: ScanItem[]): void {
  if (!items.length) return;
  const merged = [...items, ...scans.value].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  commitScans(merged);
}

export function isDuplicateJan(jan: string): boolean {
  return scans.value.some((s) => s.jan === jan);
}

// ---------------------------------------------------------------- 学習辞書（Product）

function commitProducts(next: Record<string, Product>): void {
  products.value = next;
  persist(KEYS.products, next);
}

export function emptyProduct(jan: string): Product {
  const now = nowIso();
  return {
    jan,
    name: '',
    nameSource: 'manual',
    boxJan: '',
    expiryOffsets: [],
    lastUsedAt: now,
    updatedAt: now,
  };
}

/** 名前の学習。優先度は core/dict.mergeProduct が強制する */
export function learnProduct(jan: string, patch: Partial<Product> & { nameSource?: NameSource }): void {
  if (!jan) return;
  const existing = products.value[jan];
  const incoming: Product = {
    ...emptyProduct(jan),
    ...existing,
    ...patch,
    jan,
    nameSource: patch.nameSource ?? existing?.nameSource ?? 'manual',
    lastUsedAt: nowIso(),
    updatedAt: nowIso(),
  };
  commitProducts({ ...products.value, [jan]: mergeProduct(existing, incoming) });
}

export function touchProduct(jan: string): void {
  const existing = products.value[jan];
  if (!existing) return;
  commitProducts({ ...products.value, [jan]: { ...existing, lastUsedAt: nowIso() } });
}

/** 期限入力の学習（記録日からのオフセット日数を最新5件保持） */
export function learnExpiryOffset(jan: string, offsetDays: number): void {
  if (!jan || !Number.isFinite(offsetDays)) return;
  const existing = products.value[jan] ?? emptyProduct(jan);
  const next: Product = {
    ...existing,
    expiryOffsets: pushExpiryOffset(existing.expiryOffsets, offsetDays),
    updatedAt: nowIso(),
  };
  commitProducts({ ...products.value, [jan]: next });
}

export function deleteProducts(jans: Iterable<string>): number {
  const target = new Set(jans);
  const next: Record<string, Product> = {};
  let removed = 0;
  for (const [jan, p] of Object.entries(products.value)) {
    if (target.has(jan)) removed++;
    else next[jan] = p;
  }
  if (removed) commitProducts(next);
  return removed;
}

export function deleteUnnamedProducts(): number {
  const jans = Object.entries(products.value)
    .filter(([, p]) => !p.name.trim())
    .map(([jan]) => jan);
  return deleteProducts(jans);
}

/** 箱JAN → バラJAN の逆引き（core/jan.resolveCode に渡す） */
export function boxJanLookup(code: string): string | null {
  for (const [jan, p] of Object.entries(products.value)) {
    if (p.boxJan && p.boxJan === code) return jan;
  }
  return null;
}

// ---------------------------------------------------------------- 競合

function commitCompetitors(next: Competitor[]): void {
  competitors.value = next;
  persist(KEYS.comp, next);
}

export function addCompetitor(item: Competitor): void {
  commitCompetitors([item, ...competitors.value]);
}

export function updateCompetitor(id: string, patch: Partial<Competitor>): void {
  commitCompetitors(
    competitors.value.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: nowIso() } : c)),
  );
}

export function deleteCompetitor(id: string): void {
  commitCompetitors(competitors.value.filter((c) => c.id !== id));
}

// ---------------------------------------------------------------- 返品

function commitReturns(next: ReturnItem[]): void {
  returns.value = next;
  persist(KEYS.returns, next);
}

export function addReturn(item: ReturnItem): void {
  commitReturns([item, ...returns.value]);
}

export function updateReturn(id: string, patch: Partial<ReturnItem>): void {
  commitReturns(returns.value.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: nowIso() } : r)));
}

export function deleteReturn(id: string): void {
  commitReturns(returns.value.filter((r) => r.id !== id));
}

// ---------------------------------------------------------------- 客注

function commitCust(next: CustomerOrder[]): void {
  customerOrders.value = next;
  persist(KEYS.cust, next);
}

export function addCustomerOrder(item: CustomerOrder): void {
  commitCust([item, ...customerOrders.value]);
}

export function updateCustomerOrder(id: string, patch: Partial<CustomerOrder>): void {
  commitCust(
    customerOrders.value.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: nowIso() } : c)),
  );
}

export function deleteCustomerOrder(id: string): void {
  commitCust(customerOrders.value.filter((c) => c.id !== id));
}

// ---------------------------------------------------------------- ノート

function commitNotes(next: Note[]): void {
  notes.value = next;
  persist(KEYS.notes, next);
}

export function addNote(item: Note): void {
  commitNotes([item, ...notes.value]);
}

export function updateNote(id: string, patch: Partial<Note>): void {
  commitNotes(notes.value.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: nowIso() } : n)));
}

export function deleteNote(id: string): { item: Note; index: number } | null {
  const index = notes.value.findIndex((n) => n.id === id);
  const item = index >= 0 ? notes.value[index] : undefined;
  if (!item) return null;
  commitNotes(notes.value.filter((n) => n.id !== id));
  return { item, index };
}

export function restoreNote(item: Note, index: number): void {
  const next = [...notes.value];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  commitNotes(next);
}

// ---------------------------------------------------------------- 発注リスト

function commitOrderLists(next: OrderList[]): void {
  orderLists.value = next;
  persist(KEYS.orders, next);
}

/** 「今日の」発注リスト。無ければ作る（副作用あり — 描画からは呼ばない） */
export function ensureActiveOrderList(label: string): OrderList {
  const found = orderLists.value.find((o) => o.label === label);
  if (found) return found;
  const created: OrderList = { ...stamp(), label, lines: [], exportedBatches: [] };
  commitOrderLists([created, ...orderLists.value]);
  return created;
}

/** 同一JANの再スキャンは数量 +delta */
export function bumpOrderLine(listId: string, jan: string, delta: number): void {
  commitOrderLists(
    orderLists.value.map((o) => {
      if (o.id !== listId) return o;
      const idx = o.lines.findIndex((l) => l.jan === jan);
      let lines = [...o.lines];
      if (idx < 0) {
        if (delta <= 0) return o;
        lines = [...lines, { jan, qty: delta }];
      } else {
        const cur = lines[idx]!;
        const qty = cur.qty + delta;
        if (qty <= 0) lines.splice(idx, 1);
        else lines[idx] = { ...cur, qty };
      }
      return { ...o, lines, updatedAt: nowIso() };
    }),
  );
}

export function removeOrderLine(listId: string, jan: string): void {
  commitOrderLists(
    orderLists.value.map((o) =>
      o.id === listId ? { ...o, lines: o.lines.filter((l) => l.jan !== jan), updatedAt: nowIso() } : o,
    ),
  );
}

export function restoreOrderLine(listId: string, jan: string, qty: number, index: number): void {
  commitOrderLists(
    orderLists.value.map((o) => {
      if (o.id !== listId) return o;
      const lines = [...o.lines];
      lines.splice(Math.max(0, Math.min(index, lines.length)), 0, { jan, qty });
      return { ...o, lines, updatedAt: nowIso() };
    }),
  );
}

export function deleteOrderList(id: string): void {
  commitOrderLists(orderLists.value.filter((o) => o.id !== id));
}

// ---------------------------------------------------------------- ストレージ計測

export interface StorageSlice {
  key: string;
  label: string;
  bytes: number;
}

const STORAGE_LABELS: Record<string, string> = {
  [KEYS.meta]: 'メタ',
  [KEYS.settings]: '設定',
  [KEYS.scans]: '履歴',
  [KEYS.products]: '学習辞書',
  [KEYS.comp]: '競合',
  [KEYS.returns]: '返品',
  [KEYS.cust]: '客注',
  [KEYS.notes]: 'ノート',
  [KEYS.orders]: '発注リスト',
  [KEYS.shiwake]: '仕分番長',
  [KEYS.shiwakeMeta]: '仕分メタ',
  [KEYS.shareRecv]: '共有受信',
};

/** 全 v2 キーの使用量（UTF-16 = 2bytes/char 換算） */
export function measureStorage(): { slices: StorageSlice[]; total: number; limit: number } {
  const slices = Object.values(KEYS).map((key) => ({
    key,
    label: STORAGE_LABELS[key] ?? key,
    bytes: (readRaw(key) ?? '').length * 2,
  }));
  return {
    slices: slices.filter((s) => s.bytes > 0),
    total: slices.reduce((a, s) => a + s.bytes, 0),
    limit: 5 * 1024 * 1024,
  };
}

// ---------------------------------------------------------------- テスト用

/** テストから状態をリセットする（本番コードからは呼ばない） */
export function __resetStoreForTest(): void {
  settings.value = { ...DEFAULT_SETTINGS };
  scans.value = [];
  products.value = {};
  competitors.value = [];
  returns.value = [];
  customerOrders.value = [];
  notes.value = [];
  orderLists.value = [];
}

export type { ISODateTime };
