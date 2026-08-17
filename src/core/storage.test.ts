import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from './profile';
import {
  createMemoryBackend,
  getCollection,
  getScans,
  hasCollection,
  readJson,
  removeCollection,
  setCollection,
  setQuotaHandler,
  setScans,
  setStorageBackend,
  writeBatch,
  writeJson,
  type StorageBackend,
} from './storage';
import { KEYS } from './types';
import type { ScanItem } from './types';

let backend: StorageBackend;

beforeEach(() => {
  backend = createMemoryBackend();
  setStorageBackend(backend);
  setQuotaHandler(null);
});

const item: ScanItem = {
  id: 'a',
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
  jan: '4901234567894',
  name: 'テスト',
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

describe('コレクション API', () => {
  it('未保存なら既定値を返す', () => {
    expect(getCollection('scans')).toEqual([]);
    expect(getCollection('products')).toEqual({});
    expect(getCollection('settings')).toEqual(DEFAULT_SETTINGS);
    expect(getCollection('meta')).toEqual({ schemaVersion: 2, migratedAt: '', migratedFrom: [] });
    expect(getCollection('shiwake')).toEqual({
      items: [],
      carts: [],
      alertWords: [],
      updatedAt: '',
    });
  });

  it('既定値は毎回新しいオブジェクト（共有変更が起きない）', () => {
    const a = getCollection('scans');
    a.push(item);
    expect(getCollection('scans')).toEqual([]);
  });

  it('KEYS のキーで読み書きする', () => {
    setScans([item]);
    expect(readJson<ScanItem[]>(KEYS.scans)).toHaveLength(1);
    expect(getScans()[0]!.jan).toBe('4901234567894');
  });

  it('破損 JSON・器違いは既定値へフォールバックする', () => {
    backend.setItem(KEYS.scans, '{ broken');
    expect(getCollection('scans')).toEqual([]);

    backend.setItem(KEYS.scans, '{"not":"an array"}');
    expect(getCollection('scans')).toEqual([]);

    backend.setItem(KEYS.products, '["not an object"]');
    expect(getCollection('products')).toEqual({});
  });

  it('settings は欠けたフィールドを既定値で補完する', () => {
    backend.setItem(KEYS.settings, JSON.stringify({ profile: 'jisha' }));
    const s = getCollection('settings');
    expect(s.profile).toBe('jisha');
    expect(s.qrBatchSize).toBe(DEFAULT_SETTINGS.qrBatchSize);
    expect(s.expiryChips).toEqual(DEFAULT_SETTINGS.expiryChips);
  });

  it('hasCollection / removeCollection', () => {
    expect(hasCollection('meta')).toBe(false);
    setCollection('meta', { schemaVersion: 2, migratedAt: 'x', migratedFrom: [] });
    expect(hasCollection('meta')).toBe(true);
    removeCollection('meta');
    expect(hasCollection('meta')).toBe(false);
  });
});

describe('QuotaExceeded', () => {
  it('writeJson は false を返し、ハンドラへ通知する', () => {
    const handler = vi.fn();
    setQuotaHandler(handler);
    setStorageBackend({
      ...backend,
      setItem() {
        throw new Error('QuotaExceededError');
      },
    });

    expect(writeJson(KEYS.scans, [item])).toBe(false);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0]).toBe(KEYS.scans);
  });

  it('setCollection も false を返す', () => {
    setStorageBackend({
      ...backend,
      setItem() {
        throw new Error('QuotaExceededError');
      },
    });
    expect(setCollection('scans', [item])).toBe(false);
  });
});

describe('writeBatch', () => {
  it('全件成功したら true', () => {
    const r = writeBatch([
      { key: KEYS.scans, value: [item] },
      { key: KEYS.notes, value: [] },
    ]);
    expect(r.ok).toBe(true);
    expect(getCollection('scans')).toHaveLength(1);
  });

  it('途中で失敗したら書き込み前の値へ巻き戻す', () => {
    backend.setItem(KEYS.scans, JSON.stringify([item]));
    const before = backend.getItem(KEYS.scans);

    setStorageBackend({
      getItem: (k) => backend.getItem(k),
      removeItem: (k) => backend.removeItem(k),
      setItem(k, v) {
        if (k === KEYS.notes) throw new Error('QuotaExceededError');
        backend.setItem(k, v);
      },
    });

    const r = writeBatch([
      { key: KEYS.scans, value: [] }, // 一度は成功する
      { key: KEYS.notes, value: [] }, // ここで失敗
    ]);

    expect(r.ok).toBe(false);
    expect(r.failedKey).toBe(KEYS.notes);
    // 元の値に戻っている
    expect(backend.getItem(KEYS.scans)).toBe(before);
  });

  it('元が存在しなかったキーは巻き戻しで削除される', () => {
    setStorageBackend({
      getItem: (k) => backend.getItem(k),
      removeItem: (k) => backend.removeItem(k),
      setItem(k, v) {
        if (k === KEYS.meta) throw new Error('QuotaExceededError');
        backend.setItem(k, v);
      },
    });

    const r = writeBatch([
      { key: KEYS.scans, value: [item] },
      { key: KEYS.meta, value: {} },
    ]);

    expect(r.ok).toBe(false);
    expect(backend.getItem(KEYS.scans)).toBeNull();
  });
});
