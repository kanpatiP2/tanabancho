import type { NameSource, Product } from './types';

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
