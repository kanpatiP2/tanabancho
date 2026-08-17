import { diffDays, nowIso, todayLocal } from './datetime';
import { getProducts, setProducts } from './storage';
import type { DateOnly, NameSource, Product, ScanItem } from './types';

const PRIORITY: Record<NameSource, number> = { manual: 3, gemini: 2, ext: 1 };

/**
 * 学習辞書へのマージ。P1-A が保存連携を本実装する。
 * 名前の上書きは優先度 manual > gemini > ext を守る（同格は新しい方が勝つ）。
 */
export function mergeProduct(existing: Product | undefined, incoming: Product): Product {
  if (!existing) return incoming;
  const keepExistingName =
    existing.name !== '' && PRIORITY[existing.nameSource] > PRIORITY[incoming.nameSource];
  return {
    ...existing,
    ...incoming,
    name: keepExistingName ? existing.name : incoming.name,
    nameSource: keepExistingName ? existing.nameSource : incoming.nameSource,
    boxJan: incoming.boxJan || existing.boxJan,
    expiryOffsets: incoming.expiryOffsets.length ? incoming.expiryOffsets : existing.expiryOffsets,
    popPreset: incoming.popPreset ?? existing.popPreset,
  };
}

/** 期限オフセット学習: 最新5件保持 */
export function pushExpiryOffset(offsets: number[], offset: number): number[] {
  return [...offsets, offset].slice(-5);
}

/** 期限提案: 最頻値（同数なら最新優先）。空なら null */
export function suggestExpiryOffset(offsets: number[]): number | null {
  if (!offsets.length) return null;
  const counts = new Map<number, number>();
  for (const o of offsets) counts.set(o, (counts.get(o) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (let i = offsets.length - 1; i >= 0; i--) {
    const o = offsets[i]!;
    const c = counts.get(o)!;
    if (c > bestCount) {
      best = o;
      bestCount = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------- 保存連携

export function loadProducts(): Record<string, Product> {
  return getProducts();
}

/** QuotaExceeded 時は false（呼び出し側でトースト表示） */
export function saveProducts(db: Record<string, Product>): boolean {
  return setProducts(db);
}

export function getProduct(jan: string): Product | undefined {
  return jan ? getProducts()[jan] : undefined;
}

/** 辞書に1件マージして保存する。保存できたら true */
export function upsertProduct(incoming: Product): boolean {
  if (!incoming.jan) return false;
  const db = getProducts();
  db[incoming.jan] = mergeProduct(db[incoming.jan], incoming);
  return saveProducts(db);
}

/** 名前だけを学習させる（外部照会・Gemini 結果の取り込み用） */
export function learnName(
  jan: string,
  name: string,
  nameSource: NameSource,
  at = nowIso(),
): boolean {
  if (!jan || !name) return false;
  const prev = getProduct(jan);
  return upsertProduct({
    jan,
    name,
    nameSource,
    boxJan: prev?.boxJan ?? '',
    expiryOffsets: prev?.expiryOffsets ?? [],
    ...(prev?.popPreset ? { popPreset: prev.popPreset } : {}),
    lastUsedAt: at,
    updatedAt: at,
  });
}

/**
 * スキャン確定時の学習。noLearn の項目は辞書に触れない。
 * 期限が入っていれば (expiry - 記録日) をオフセットとして積む（最新5件）。
 */
export function learnFromScan(scan: ScanItem, nameSource: NameSource = 'manual'): boolean {
  if (scan.noLearn || !scan.jan) return false;
  const prev = getProduct(scan.jan);
  const at = scan.updatedAt || scan.createdAt || nowIso();

  let expiryOffsets = prev?.expiryOffsets ?? [];
  if (scan.expiry) {
    const recordedOn = todayLocal(new Date(scan.createdAt));
    const offset = diffDays(recordedOn, scan.expiry);
    if (Number.isFinite(offset) && offset >= 0) {
      expiryOffsets = pushExpiryOffset(expiryOffsets, offset);
    }
  }

  const incoming: Product = {
    jan: scan.jan,
    name: scan.name,
    nameSource,
    boxJan: scan.boxJan,
    expiryOffsets,
    lastUsedAt: at,
    updatedAt: at,
  };
  // 名前が空のスキャンで既存の名前を消さない
  if (!scan.name && prev) {
    incoming.name = prev.name;
    incoming.nameSource = prev.nameSource;
  }
  if (scan.pop.length) incoming.popPreset = scan.pop;
  else if (prev?.popPreset) incoming.popPreset = prev.popPreset;

  return upsertProduct(incoming);
}

/** 学習済みオフセットから期限日を提案する。学習が無ければ null */
export function suggestExpiryDate(jan: string, from: DateOnly = todayLocal()): DateOnly | null {
  const offset = suggestExpiryOffset(getProduct(jan)?.expiryOffsets ?? []);
  if (offset === null) return null;
  const d = new Date(`${from}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + offset);
  return todayLocal(d);
}
