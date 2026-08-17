/**
 * 辞書検索のロジック（純関数）。UI は SearchSheet.tsx。
 */
import type { Product } from '@core/types';

export const SUGGEST_LIMIT = 10;

/**
 * コード部分一致を先に、次に商品名部分一致（最終利用が新しい順）で最大 limit 件返す。
 */
export function searchProducts(
  db: Record<string, Product>,
  keyword: string,
  limit = SUGGEST_LIMIT,
): Product[] {
  const q = keyword.trim().toLowerCase();
  if (!q) return [];
  const byCode: Product[] = [];
  const byName: Product[] = [];
  for (const p of Object.values(db)) {
    if (p.jan.includes(q)) byCode.push(p);
    else if (p.name.toLowerCase().includes(q)) byName.push(p);
  }
  byCode.sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt));
  byName.sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt));
  return [...byCode, ...byName].slice(0, limit);
}
