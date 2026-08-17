/**
 * 棚番長本体との連携。
 * - 辞書還流: OCR で読めた商品名を KEYS.products へ nameSource:'gemini' で流す
 *   （mergeProduct が manual > gemini > ext を強制するので、手入力名は壊れない）
 * - 客注照合: 未納品の CustomerOrder と JAN で突き合わせ、明細カードにバッジを出す
 */

import { mergeProduct } from '@core/dict';
import type { CustomerOrder, DateOnly, Product, ShiwakeItem } from '@core/types';

// ---------------------------------------------------------------- 辞書還流

export interface RefluxOptions {
  now: string;
  /** ITF-14 由来の生コード（jan → 箱コード）。あれば boxJan として学習させる */
  boxJanByJan?: Record<string, string>;
}

export interface RefluxResult {
  products: Record<string, Product>;
  /** 実際に書き換わった JAN 数 */
  changed: number;
}

/**
 * 明細の商品を辞書へマージする。
 * 同一 JAN が複数明細に出る場合は最初の 1 件を採用（後続はマージ結果に対して再マージ）。
 */
export function refluxProducts(
  items: readonly ShiwakeItem[],
  existing: Readonly<Record<string, Product>>,
  opts: RefluxOptions,
): RefluxResult {
  const products: Record<string, Product> = { ...existing };
  let changed = 0;

  for (const item of items) {
    const jan = item.jan;
    if (!jan || !item.name) continue;

    const incoming: Product = {
      jan,
      name: item.name,
      nameSource: 'gemini',
      boxJan: opts.boxJanByJan?.[jan] ?? '',
      expiryOffsets: [],
      lastUsedAt: opts.now,
      updatedAt: opts.now,
    };
    const before = products[jan];
    const merged = mergeProduct(before, incoming);
    if (!before || before.name !== merged.name || before.boxJan !== merged.boxJan) changed++;
    products[jan] = merged;
  }

  return { products, changed };
}

/** 辞書に正式名があり、明細名と異なる場合だけ返す（カードに「明細名 → 辞書名」を併記） */
export function dictName(
  item: ShiwakeItem,
  products: Readonly<Record<string, Product>>,
): string | null {
  if (!item.jan) return null;
  const p = products[item.jan];
  if (!p || !p.name) return null;
  return p.name === item.name ? null : p.name;
}

// ---------------------------------------------------------------- 客注照合

/**
 * 未納品の客注か。
 * 「未納品 = addedToHistory:false かつ arrivalDate が今日以前」（入荷予定日を過ぎている＝この便で来るはず）。
 * arrivalDate 未設定（''）は入荷日不明のため対象外とする。
 */
export function isPendingCustomerOrder(o: CustomerOrder, today: DateOnly): boolean {
  if (o.addedToHistory) return false;
  if (!o.arrivalDate) return false;
  return o.arrivalDate <= today;
}

/**
 * 明細 item.id → 該当客注。JAN 完全一致のみ。
 * 同一 JAN に複数の客注がある場合は arrivalDate の古い順（＝待たせている順）で先頭を採用。
 */
export function matchCustomerOrders(
  items: readonly ShiwakeItem[],
  orders: readonly CustomerOrder[],
  today: DateOnly,
): Map<string, CustomerOrder> {
  const pending = orders
    .filter((o) => o.jan && isPendingCustomerOrder(o, today))
    .sort((a, b) => a.arrivalDate.localeCompare(b.arrivalDate));

  const byJan = new Map<string, CustomerOrder>();
  for (const o of pending) if (!byJan.has(o.jan)) byJan.set(o.jan, o);

  const hits = new Map<string, CustomerOrder>();
  for (const item of items) {
    if (!item.jan) continue;
    const hit = byJan.get(item.jan);
    if (hit) hits.set(item.id, hit);
  }
  return hits;
}

/** 照合結果を items に焼き込む（保存対象の custOrderId を更新） */
export function applyCustomerOrderIds(
  items: readonly ShiwakeItem[],
  hits: ReadonlyMap<string, CustomerOrder>,
): ShiwakeItem[] {
  return items.map((it) => {
    const id = hits.get(it.id)?.id;
    if (it.custOrderId === id) return it;
    const next = { ...it };
    if (id) next.custOrderId = id;
    else delete next.custOrderId;
    return next;
  });
}
