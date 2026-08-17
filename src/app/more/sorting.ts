/**
 * 「その他」タブで使う並べ替え（純関数）。
 */
import type { CustomerOrder, Note, Settings } from '@core/types';

/** 客注ソート: 納品日順 / 受渡日順（未設定は末尾） */
export function sortCustomerOrders(
  items: CustomerOrder[],
  mode: Settings['custSort'],
): CustomerOrder[] {
  const out = [...items];
  if (mode === 'delivery') {
    return out.sort((a, b) =>
      `${a.deliveryDate || '9999-99-99'}${a.deliveryTime}`.localeCompare(
        `${b.deliveryDate || '9999-99-99'}${b.deliveryTime}`,
      ),
    );
  }
  return out.sort((a, b) =>
    (a.arrivalDate || '9999-99-99').localeCompare(b.arrivalDate || '9999-99-99'),
  );
}

/** ノート: ピン留め優先 → 更新日時の新しい順 */
export function sortNotes(items: Note[]): Note[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}
