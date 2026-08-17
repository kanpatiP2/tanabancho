import { describe, expect, test } from 'vitest';
import type { Competitor, CustomerOrder, Note, ReturnItem, ScanItem } from '@core/types';
import { buildTodayFeed, idsCreatedBefore, sortScans } from './derived';

const NOW = new Date('2026-08-17T09:00:00');
const TODAY = '2026-08-17';
const TOMORROW = '2026-08-18';

function scan(patch: Partial<ScanItem> = {}): ScanItem {
  return {
    id: patch.id ?? Math.random().toString(36).slice(2),
    createdAt: '2026-08-17T01:00:00.000Z',
    updatedAt: '2026-08-17T01:00:00.000Z',
    jan: '111',
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
    ...patch,
  };
}

function cust(patch: Partial<CustomerOrder> = {}): CustomerOrder {
  return {
    id: patch.id ?? 'c1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    jan: '222',
    name: '客注商品',
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

function comp(patch: Partial<Competitor> = {}): Competitor {
  return {
    id: patch.id ?? 'k1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    date: TODAY,
    jan: '333',
    name: '競合商品',
    reason: 'ヘッダー変更',
    memo: '',
    dismissed: false,
    ...patch,
  };
}

function ret(patch: Partial<ReturnItem> = {}): ReturnItem {
  return {
    id: patch.id ?? 'r1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    jan: '444',
    start: '',
    end: TODAY,
    returnDate: '',
    memo: '',
    dismissed: false,
    ...patch,
  };
}

function note(patch: Partial<Note> = {}): Note {
  return {
    id: patch.id ?? 'n1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    title: 'メモ',
    text: '',
    color: '#ffffff',
    pinned: false,
    ...patch,
  };
}

const EMPTY = { scans: [], cust: [], comp: [], returns: [], notes: [] };

describe('今日フィード', () => {
  test('何も無ければ空', () => {
    expect(buildTodayFeed(EMPTY, NOW).entries).toEqual([]);
  });

  test('期限切れと明日期限を分類する', () => {
    const feed = buildTodayFeed(
      { ...EMPTY, scans: [scan({ expiry: '2026-08-01' }), scan({ expiry: TOMORROW })] },
      NOW,
    );
    expect(feed.counts.expired).toBe(1);
    expect(feed.counts['expiry-soon']).toBe(1);
  });

  test('本日期限も expiry-soon に入る', () => {
    const feed = buildTodayFeed({ ...EMPTY, scans: [scan({ expiry: TODAY })] }, NOW);
    expect(feed.counts['expiry-soon']).toBe(1);
    expect(feed.counts.expired).toBe(0);
  });

  test('客注は納品と受渡でそれぞれ出る', () => {
    const feed = buildTodayFeed(
      { ...EMPTY, cust: [cust({ arrivalDate: TODAY, deliveryDate: TODAY })] },
      NOW,
    );
    expect(feed.counts['cust-arrival']).toBe(1);
    expect(feed.counts['cust-delivery']).toBe(1);
  });

  test('競合は今日と明日のみ', () => {
    const feed = buildTodayFeed(
      { ...EMPTY, comp: [comp({ date: TODAY }), comp({ id: 'k2', date: TOMORROW }), comp({ id: 'k3', date: '2026-09-01' })] },
      NOW,
    );
    expect(feed.counts.comp).toBe(2);
  });

  test('返品は受付終了間近を拾う', () => {
    const feed = buildTodayFeed({ ...EMPTY, returns: [ret({ end: '2026-08-19' })] }, NOW);
    expect(feed.counts.return).toBe(1);
  });

  test('遠い返品は拾わない', () => {
    const feed = buildTodayFeed({ ...EMPTY, returns: [ret({ end: '2026-12-01' })] }, NOW);
    expect(feed.counts.return).toBe(0);
  });

  test('remindAt 到来分だけリマインダーになる', () => {
    const feed = buildTodayFeed(
      {
        ...EMPTY,
        notes: [
          note({ id: 'n1', remindAt: new Date('2026-08-17T08:00:00').toISOString() }),
          note({ id: 'n2', remindAt: '2099-01-01T00:00:00.000Z' }),
          note({ id: 'n3' }),
        ],
      },
      NOW,
    );
    expect(feed.counts.reminder).toBe(1);
  });

  test('フィードは副作用を持たない（入力配列を変えない）', () => {
    const scans = [scan({ expiry: '2026-08-01' })];
    buildTodayFeed({ ...EMPTY, scans }, NOW);
    expect(scans).toHaveLength(1);
  });

  test('期限切れが期限間近より前に並ぶ', () => {
    const feed = buildTodayFeed(
      { ...EMPTY, scans: [scan({ expiry: TOMORROW }), scan({ expiry: '2026-08-01' })] },
      NOW,
    );
    expect(feed.entries[0]!.kind).toBe('expired');
  });
});

describe('sortScans', () => {
  const items = [
    scan({ id: 'a', createdAt: '2026-08-15T00:00:00.000Z', genre: 'ぼ', name: 'いろは' }),
    scan({ id: 'b', createdAt: '2026-08-17T00:00:00.000Z', genre: 'あ', name: 'ろはに' }),
  ];

  test('新しい順が既定', () => {
    expect(sortScans(items, 'newest').map((i) => i.id)).toEqual(['b', 'a']);
  });

  test('古い順', () => {
    expect(sortScans(items, 'oldest').map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('ジャンル順', () => {
    expect(sortScans(items, 'genre').map((i) => i.id)).toEqual(['b', 'a']);
  });

  test('商品名順', () => {
    expect(sortScans(items, 'name').map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('元配列を破壊しない', () => {
    sortScans(items, 'oldest');
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('idsCreatedBefore', () => {
  test('createdAt 基準で境界日より前を選ぶ（旧 id パースに依存しない）', () => {
    const items = [
      scan({ id: 'old', createdAt: new Date('2026-08-16T23:00:00').toISOString() }),
      scan({ id: 'today', createdAt: new Date('2026-08-17T09:00:00').toISOString() }),
    ];
    expect(idsCreatedBefore(items, TODAY)).toEqual(['old']);
  });

  test('全部が当日なら空', () => {
    const items = [scan({ createdAt: new Date('2026-08-17T10:00:00').toISOString() })];
    expect(idsCreatedBefore(items, TODAY)).toEqual([]);
  });
});
