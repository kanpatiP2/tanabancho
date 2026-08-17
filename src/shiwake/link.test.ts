import { describe, expect, it } from 'vitest';
import type { CustomerOrder, Product, ShiwakeItem } from '@core/types';
import {
  applyCustomerOrderIds,
  dictName,
  isPendingCustomerOrder,
  matchCustomerOrders,
  refluxProducts,
} from './link';

const NOW = '2026-08-17T00:00:00.000Z';

function item(over: Partial<ShiwakeItem> = {}): ShiwakeItem {
  return {
    id: 'i1',
    name: 'ドンベエ',
    code: '4901234567894',
    jan: '4901234567894',
    qtyPerCase: 12,
    cases: 2,
    cartIndex: 0,
    memo: '',
    isAlert: false,
    ...over,
  };
}

function product(over: Partial<Product> = {}): Product {
  return {
    jan: '4901234567894',
    name: '日清 どん兵衛 きつねうどん',
    nameSource: 'manual',
    boxJan: '',
    expiryOffsets: [3, 4],
    lastUsedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function order(over: Partial<CustomerOrder> = {}): CustomerOrder {
  return {
    id: 'c1',
    createdAt: NOW,
    updatedAt: NOW,
    jan: '4901234567894',
    name: 'どん兵衛',
    qty: 3,
    caseQty: 0,
    ordered: true,
    arrivalDate: '2026-08-17',
    deliveryDate: '2026-08-18',
    deliveryTime: '午前',
    phone: '090-0000-0000',
    willCall: true,
    called: false,
    memo: '',
    dismissedArrival: false,
    dismissedDelivery: false,
    addedToHistory: false,
    ...over,
  };
}

// ---------------------------------------------------------------- 辞書還流

describe('refluxProducts', () => {
  it('新規 JAN を nameSource=gemini で登録する', () => {
    const { products, changed } = refluxProducts([item()], {}, { now: NOW });
    expect(changed).toBe(1);
    expect(products['4901234567894']).toMatchObject({
      name: 'ドンベエ',
      nameSource: 'gemini',
      lastUsedAt: NOW,
    });
  });

  it('既存の manual 名を gemini が上書きしない（最重要）', () => {
    const existing = { '4901234567894': product({ nameSource: 'manual' }) };
    const { products } = refluxProducts([item({ name: 'ドンベエ' })], existing, { now: NOW });
    expect(products['4901234567894']!.name).toBe('日清 どん兵衛 きつねうどん');
    expect(products['4901234567894']!.nameSource).toBe('manual');
  });

  it('既存の ext 名は gemini が上書きする', () => {
    const existing = { '4901234567894': product({ nameSource: 'ext', name: '外部DB名' }) };
    const { products } = refluxProducts([item({ name: 'ドンベエ' })], existing, { now: NOW });
    expect(products['4901234567894']!.name).toBe('ドンベエ');
    expect(products['4901234567894']!.nameSource).toBe('gemini');
  });

  it('既存の gemini 名は新しい gemini 名で更新される（同格は新しい方が勝つ）', () => {
    const existing = { '4901234567894': product({ nameSource: 'gemini', name: '旧名' }) };
    const { products } = refluxProducts([item({ name: '新名' })], existing, { now: NOW });
    expect(products['4901234567894']!.name).toBe('新名');
  });

  it('expiryOffsets / popPreset など既存の学習結果を壊さない', () => {
    const existing = { '4901234567894': product({ expiryOffsets: [5, 5, 6] }) };
    const { products } = refluxProducts([item()], existing, { now: NOW });
    expect(products['4901234567894']!.expiryOffsets).toEqual([5, 5, 6]);
  });

  it('ITF-14 由来の箱コードを boxJan として学習する', () => {
    const { products } = refluxProducts([item()], {}, {
      now: NOW,
      boxJanByJan: { '4901234567894': '14901234567891' },
    });
    expect(products['4901234567894']!.boxJan).toBe('14901234567891');
  });

  it('JAN 無し・名前無しの行は還流しない', () => {
    const { products, changed } = refluxProducts(
      [item({ id: 'a', jan: '' }), item({ id: 'b', name: '' })],
      {},
      { now: NOW },
    );
    expect(Object.keys(products)).toHaveLength(0);
    expect(changed).toBe(0);
  });

  it('入力の products オブジェクトを破壊しない', () => {
    const existing = {};
    refluxProducts([item()], existing, { now: NOW });
    expect(Object.keys(existing)).toHaveLength(0);
  });
});

describe('dictName', () => {
  it('辞書名が明細名と異なるときだけ返す', () => {
    const products = { '4901234567894': product() };
    expect(dictName(item(), products)).toBe('日清 どん兵衛 きつねうどん');
    expect(dictName(item({ name: '日清 どん兵衛 きつねうどん' }), products)).toBeNull();
    expect(dictName(item({ jan: '' }), products)).toBeNull();
    expect(dictName(item({ jan: '9999999999999' }), products)).toBeNull();
  });
});

// ---------------------------------------------------------------- 客注照合

describe('isPendingCustomerOrder', () => {
  it('未納品かつ入荷日が今日以前なら対象', () => {
    expect(isPendingCustomerOrder(order({ arrivalDate: '2026-08-17' }), '2026-08-17')).toBe(true);
    expect(isPendingCustomerOrder(order({ arrivalDate: '2026-08-10' }), '2026-08-17')).toBe(true);
  });

  it('納品済（addedToHistory）は対象外', () => {
    expect(isPendingCustomerOrder(order({ addedToHistory: true }), '2026-08-17')).toBe(false);
  });

  it('入荷予定が未来・未設定なら対象外', () => {
    expect(isPendingCustomerOrder(order({ arrivalDate: '2026-08-20' }), '2026-08-17')).toBe(false);
    expect(isPendingCustomerOrder(order({ arrivalDate: '' }), '2026-08-17')).toBe(false);
  });
});

describe('matchCustomerOrders', () => {
  it('JAN 一致した明細に客注を紐付ける', () => {
    const hits = matchCustomerOrders([item()], [order()], '2026-08-17');
    expect(hits.get('i1')?.id).toBe('c1');
  });

  it('JAN が違えばヒットしない', () => {
    const hits = matchCustomerOrders([item({ jan: '4900000000000' })], [order()], '2026-08-17');
    expect(hits.size).toBe(0);
  });

  it('JAN 無しの明細はヒットしない', () => {
    const hits = matchCustomerOrders([item({ jan: '' })], [order({ jan: '' })], '2026-08-17');
    expect(hits.size).toBe(0);
  });

  it('同一 JAN に複数客注があれば入荷日の古い方（＝待たせている方）を採る', () => {
    const hits = matchCustomerOrders(
      [item()],
      [order({ id: 'new', arrivalDate: '2026-08-17' }), order({ id: 'old', arrivalDate: '2026-08-01' })],
      '2026-08-17',
    );
    expect(hits.get('i1')?.id).toBe('old');
  });

  it('未納品でない客注は無視する', () => {
    const hits = matchCustomerOrders([item()], [order({ addedToHistory: true })], '2026-08-17');
    expect(hits.size).toBe(0);
  });

  it('同じ JAN の明細が複数あれば全部にバッジが付く', () => {
    const hits = matchCustomerOrders([item({ id: 'a' }), item({ id: 'b' })], [order()], '2026-08-17');
    expect([...hits.keys()].sort()).toEqual(['a', 'b']);
  });
});

describe('applyCustomerOrderIds', () => {
  it('ヒットした明細にだけ custOrderId を入れる', () => {
    const items = [item({ id: 'a' }), item({ id: 'b', jan: '4900000000000' })];
    const hits = matchCustomerOrders(items, [order()], '2026-08-17');
    const applied = applyCustomerOrderIds(items, hits);
    expect(applied[0]!.custOrderId).toBe('c1');
    expect('custOrderId' in applied[1]!).toBe(false);
  });

  it('ヒットが消えたら custOrderId を落とす', () => {
    const items = [item({ custOrderId: 'c1' })];
    const applied = applyCustomerOrderIds(items, new Map());
    expect('custOrderId' in applied[0]!).toBe(false);
  });
});
