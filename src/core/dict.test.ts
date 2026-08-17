import { beforeEach, describe, expect, it } from 'vitest';

import {
  getProduct,
  learnFromScan,
  learnName,
  mergeProduct,
  pushExpiryOffset,
  suggestExpiryDate,
  suggestExpiryOffset,
  upsertProduct,
} from './dict';
import { createMemoryBackend, getCollection, setStorageBackend } from './storage';
import type { Product, ScanItem } from './types';

const AT = '2026-08-17T00:00:00.000Z';

beforeEach(() => {
  setStorageBackend(createMemoryBackend());
});

function product(over: Partial<Product> = {}): Product {
  return {
    jan: '4901234567894',
    name: 'テスト商品',
    nameSource: 'manual',
    boxJan: '',
    expiryOffsets: [],
    lastUsedAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function scan(over: Partial<ScanItem> = {}): ScanItem {
  return {
    id: 's1',
    createdAt: '2026-08-17T03:00:00.000Z',
    updatedAt: '2026-08-17T03:00:00.000Z',
    jan: '4901234567894',
    name: 'テスト商品',
    memo: '',
    genre: '',
    end: false,
    pop: [],
    order: [],
    expiry: '',
    boxJan: '',
    protected: false,
    noLearn: false,
    ...over,
  };
}

describe('mergeProduct（既存の優先度規則）', () => {
  it('manual は gemini / ext に上書きされない', () => {
    const merged = mergeProduct(
      product({ name: '手入力', nameSource: 'manual' }),
      product({ name: '外部', nameSource: 'ext' }),
    );
    expect(merged.name).toBe('手入力');
    expect(merged.nameSource).toBe('manual');
  });

  it('ext は manual に上書きされる', () => {
    const merged = mergeProduct(
      product({ name: '外部', nameSource: 'ext' }),
      product({ name: '手入力', nameSource: 'manual' }),
    );
    expect(merged.name).toBe('手入力');
  });
});

describe('pushExpiryOffset / suggestExpiryOffset', () => {
  it('最新5件だけ保持する', () => {
    let o: number[] = [];
    for (const n of [1, 2, 3, 4, 5, 6]) o = pushExpiryOffset(o, n);
    expect(o).toEqual([2, 3, 4, 5, 6]);
  });

  it('最頻値を提案し、空なら null', () => {
    expect(suggestExpiryOffset([3, 7, 3])).toBe(3);
    expect(suggestExpiryOffset([])).toBeNull();
  });
});

describe('保存連携', () => {
  it('upsertProduct は辞書へマージして保存する', () => {
    expect(upsertProduct(product())).toBe(true);
    expect(getProduct('4901234567894')!.name).toBe('テスト商品');
    expect(Object.keys(getCollection('products'))).toEqual(['4901234567894']);

    upsertProduct(product({ name: '外部名', nameSource: 'ext', boxJan: '14901234567891' }));
    const p = getProduct('4901234567894')!;
    expect(p.name).toBe('テスト商品'); // manual を維持
    expect(p.boxJan).toBe('14901234567891'); // 空欄は補完
  });

  it('learnName は名前だけを学習する', () => {
    upsertProduct(product({ name: '', nameSource: 'ext', boxJan: '14901234567891' }));
    expect(learnName('4901234567894', 'Gemini の名前', 'gemini')).toBe(true);
    const p = getProduct('4901234567894')!;
    expect(p.name).toBe('Gemini の名前');
    expect(p.nameSource).toBe('gemini');
    expect(p.boxJan).toBe('14901234567891'); // 既存を壊さない
  });

  it('learnFromScan は noLearn の項目を学習しない', () => {
    expect(learnFromScan(scan({ noLearn: true }))).toBe(false);
    expect(getCollection('products')).toEqual({});
  });

  it('learnFromScan は期限オフセットと POP プリセットを学習する', () => {
    // createdAt のローカル日付 + 4日 を期限にする
    const created = new Date('2026-08-17T03:00:00.000Z');
    const y = created.getFullYear();
    const m = String(created.getMonth() + 1).padStart(2, '0');
    const d = created.getDate();
    const base = new Date(y, created.getMonth(), d);
    const target = new Date(base);
    target.setDate(target.getDate() + 4);
    const expiry = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(
      target.getDate(),
    ).padStart(2, '0')}`;
    void m;

    learnFromScan(
      scan({
        expiry,
        pop: [{ size: '7号', qty: 2, lami: true, enlarge: 'A3', assignee: '' }],
        boxJan: '14901234567891',
      }),
    );

    const p = getProduct('4901234567894')!;
    expect(p.expiryOffsets).toEqual([4]);
    expect(p.popPreset).toHaveLength(1);
    expect(p.popPreset![0]!.size).toBe('7号');
    expect(p.boxJan).toBe('14901234567891');

    // 2回目も積む（最新5件）
    learnFromScan(scan({ id: 's2', expiry }));
    expect(getProduct('4901234567894')!.expiryOffsets).toEqual([4, 4]);
  });

  it('名前が空のスキャンで既存の名前を消さない', () => {
    upsertProduct(product({ name: '既存の名前' }));
    learnFromScan(scan({ name: '' }));
    expect(getProduct('4901234567894')!.name).toBe('既存の名前');
  });

  it('suggestExpiryDate は学習オフセットから日付を返す', () => {
    upsertProduct(product({ expiryOffsets: [4, 4, 7] }));
    expect(suggestExpiryDate('4901234567894', '2026-08-17')).toBe('2026-08-21');
    expect(suggestExpiryDate('9999999999999', '2026-08-17')).toBeNull();
  });
});
