import { describe, expect, test } from 'vitest';
import type { CustomerOrder, Note } from '@core/types';
import { sortCustomerOrders, sortNotes } from './sorting';

function cust(patch: Partial<CustomerOrder>): CustomerOrder {
  return {
    id: 'x',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    jan: '111',
    name: '',
    qty: 1,
    caseQty: 0,
    ordered: false,
    arrivalDate: '',
    deliveryDate: '',
    deliveryTime: '',
    phone: '',
    willCall: false,
    called: false,
    memo: '',
    dismissedArrival: false,
    dismissedDelivery: false,
    addedToHistory: false,
    ...patch,
  };
}

function note(patch: Partial<Note>): Note {
  return {
    id: 'x',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    title: '',
    text: '',
    color: '#ffffff',
    pinned: false,
    ...patch,
  };
}

describe('sortCustomerOrders', () => {
  const items = [
    cust({ id: 'b', arrivalDate: '2026-08-20', deliveryDate: '2026-08-18' }),
    cust({ id: 'a', arrivalDate: '2026-08-17', deliveryDate: '2026-08-25' }),
    cust({ id: 'c' }),
  ];

  test('納品日順（未設定は末尾）', () => {
    expect(sortCustomerOrders(items, 'arrival').map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  test('受渡日順（未設定は末尾）', () => {
    expect(sortCustomerOrders(items, 'delivery').map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  test('元配列を破壊しない', () => {
    sortCustomerOrders(items, 'delivery');
    expect(items.map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('sortNotes', () => {
  test('ピン留めが先頭、その中で更新が新しい順', () => {
    const items = [
      note({ id: 'a', updatedAt: '2026-08-10T00:00:00.000Z' }),
      note({ id: 'b', updatedAt: '2026-08-01T00:00:00.000Z', pinned: true }),
      note({ id: 'c', updatedAt: '2026-08-17T00:00:00.000Z' }),
      note({ id: 'd', updatedAt: '2026-08-16T00:00:00.000Z', pinned: true }),
    ];
    expect(sortNotes(items).map((i) => i.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  test('空配列', () => {
    expect(sortNotes([])).toEqual([]);
  });
});
