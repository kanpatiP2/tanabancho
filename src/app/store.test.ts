import { beforeEach, describe, expect, test } from 'vitest';
import { createMemoryBackend, setStorageBackend } from '@core/storage';
import { KEYS, type ScanItem } from '@core/types';
import {
  __resetStoreForTest,
  addScan,
  bumpOrderLine,
  deleteScan,
  deleteScans,
  deleteUnnamedProducts,
  emptyScan,
  ensureActiveOrderList,
  isDuplicateJan,
  learnExpiryOffset,
  learnProduct,
  loadAll,
  measureStorage,
  orderLists,
  products,
  removeOrderLine,
  resetExportedBatches,
  restoreScan,
  restoreScans,
  scans,
  setBatchExported,
  settings,
  stamp,
  updateScan,
  updateSettings,
} from './store';

beforeEach(() => {
  setStorageBackend(createMemoryBackend());
  __resetStoreForTest();
});

function scanWith(jan: string, patch: Partial<ScanItem> = {}): ScanItem {
  return { ...emptyScan(jan), ...patch };
}

describe('履歴', () => {
  test('新しいものが先頭に積まれる', () => {
    addScan(scanWith('111'));
    addScan(scanWith('222'));
    expect(scans.value.map((s) => s.jan)).toEqual(['222', '111']);
  });

  test('重複JANを検出できる', () => {
    addScan(scanWith('111'));
    expect(isDuplicateJan('111')).toBe(true);
    expect(isDuplicateJan('222')).toBe(false);
  });

  test('保護中は単体削除されない', () => {
    const item = addScan(scanWith('111', { protected: true }));
    expect(deleteScan(item.id)).toBeNull();
    expect(scans.value).toHaveLength(1);
  });

  test('削除と Undo で元の位置に戻る', () => {
    addScan(scanWith('111'));
    const mid = addScan(scanWith('222'));
    addScan(scanWith('333'));
    const removed = deleteScan(mid.id);
    expect(removed).not.toBeNull();
    expect(scans.value.map((s) => s.jan)).toEqual(['333', '111']);
    restoreScan(removed!.item, removed!.index);
    expect(scans.value.map((s) => s.jan)).toEqual(['333', '222', '111']);
  });

  test('一括削除は保護中を残す', () => {
    const a = addScan(scanWith('111'));
    const b = addScan(scanWith('222', { protected: true }));
    const c = addScan(scanWith('333'));
    const removed = deleteScans([a.id, b.id, c.id]);
    expect(removed.map((s) => s.jan).sort()).toEqual(['111', '333']);
    expect(scans.value.map((s) => s.jan)).toEqual(['222']);
    restoreScans(removed);
    expect(scans.value).toHaveLength(3);
  });

  test('更新すると updatedAt が進む', () => {
    const item = addScan(scanWith('111'));
    updateScan(item.id, { name: 'テスト商品' });
    const after = scans.value[0]!;
    expect(after.name).toBe('テスト商品');
    expect(Date.parse(after.updatedAt)).toBeGreaterThanOrEqual(Date.parse(item.updatedAt));
  });
});

describe('永続化', () => {
  test('保存した内容を loadAll で復元できる', () => {
    addScan(scanWith('4901234567894', { name: 'ほげ' }));
    updateSettings({ theme: 'dark' });
    __resetStoreForTest();
    expect(scans.value).toHaveLength(0);
    loadAll();
    expect(scans.value[0]?.name).toBe('ほげ');
    expect(settings.value.theme).toBe('dark');
  });

  test('壊れた JSON があっても既定値で起動する', () => {
    const backend = createMemoryBackend();
    backend.setItem(KEYS.scans, '{壊れている');
    setStorageBackend(backend);
    loadAll();
    expect(scans.value).toEqual([]);
    expect(settings.value.theme).toBe('auto');
  });

  test('未知のキーが増えても既定値でマージされる', () => {
    const backend = createMemoryBackend();
    backend.setItem(KEYS.settings, JSON.stringify({ theme: 'dark' }));
    setStorageBackend(backend);
    loadAll();
    expect(settings.value.theme).toBe('dark');
    expect(settings.value.qrBatchSize).toBe(50);
  });

  test('ストレージ計測は全 v2 キーを対象にする', () => {
    addScan(scanWith('111'));
    const usage = measureStorage();
    expect(usage.slices.some((s) => s.key === KEYS.scans)).toBe(true);
    expect(usage.total).toBeGreaterThan(0);
  });
});

describe('学習辞書', () => {
  test('manual は ext より優先される', () => {
    learnProduct('111', { name: '手入力名', nameSource: 'manual' });
    learnProduct('111', { name: '外部名', nameSource: 'ext' });
    expect(products.value['111']?.name).toBe('手入力名');
  });

  test('期限オフセットは最新5件だけ残る', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) learnExpiryOffset('111', n);
    expect(products.value['111']?.expiryOffsets).toEqual([2, 3, 4, 5, 6]);
  });

  test('名称未設定のみ削除できる', () => {
    learnProduct('111', { name: 'あり', nameSource: 'manual' });
    learnProduct('222', { name: '', nameSource: 'manual' });
    expect(deleteUnnamedProducts()).toBe(1);
    expect(Object.keys(products.value)).toEqual(['111']);
  });
});

describe('発注リスト', () => {
  test('同一JANの再スキャンで数量が増える', () => {
    const list = ensureActiveOrderList('2026-08-17');
    bumpOrderLine(list.id, '111', 1);
    bumpOrderLine(list.id, '111', 1);
    bumpOrderLine(list.id, '222', 1);
    const after = orderLists.value.find((o) => o.id === list.id)!;
    expect(after.lines).toEqual([
      { jan: '111', qty: 2 },
      { jan: '222', qty: 1 },
    ]);
  });

  test('数量が0以下になると行ごと消える', () => {
    const list = ensureActiveOrderList('2026-08-17');
    bumpOrderLine(list.id, '111', 1);
    bumpOrderLine(list.id, '111', -1);
    expect(orderLists.value.find((o) => o.id === list.id)!.lines).toEqual([]);
  });

  test('同名ラベルのリストは作り直さない', () => {
    const a = ensureActiveOrderList('2026-08-17');
    const b = ensureActiveOrderList('2026-08-17');
    expect(a.id).toBe(b.id);
    expect(orderLists.value).toHaveLength(1);
  });

  test('行を削除できる', () => {
    const list = ensureActiveOrderList('2026-08-17');
    bumpOrderLine(list.id, '111', 3);
    removeOrderLine(list.id, '111');
    expect(orderLists.value.find((o) => o.id === list.id)!.lines).toEqual([]);
  });
});

describe('QR出力のバッチ読取済', () => {
  const batchesOf = (id: string) => orderLists.value.find((o) => o.id === id)!.exportedBatches;

  test('マークの付け外しができ、番号は昇順に保たれる', () => {
    const list = ensureActiveOrderList('2026-08-17');
    setBatchExported(list.id, 2, true);
    setBatchExported(list.id, 0, true);
    expect(batchesOf(list.id)).toEqual([0, 2]);

    setBatchExported(list.id, 0, false);
    expect(batchesOf(list.id)).toEqual([2]);
  });

  test('同じマークを二重に付けても重複しない', () => {
    const list = ensureActiveOrderList('2026-08-17');
    setBatchExported(list.id, 1, true);
    setBatchExported(list.id, 1, true);
    expect(batchesOf(list.id)).toEqual([1]);
  });

  test('付いていないマークを外しても落ちない', () => {
    const list = ensureActiveOrderList('2026-08-17');
    setBatchExported(list.id, 3, false);
    expect(batchesOf(list.id)).toEqual([]);
  });

  test('不正な番号・存在しないリストは無視する', () => {
    const list = ensureActiveOrderList('2026-08-17');
    setBatchExported(list.id, -1, true);
    setBatchExported(list.id, 1.5, true);
    setBatchExported('no-such-list', 0, true);
    expect(batchesOf(list.id)).toEqual([]);
  });

  test('リセットは外した件数を返す（何もなければ 0）', () => {
    const list = ensureActiveOrderList('2026-08-17');
    setBatchExported(list.id, 0, true);
    setBatchExported(list.id, 1, true);
    expect(resetExportedBatches(list.id)).toBe(2);
    expect(batchesOf(list.id)).toEqual([]);
    expect(resetExportedBatches(list.id)).toBe(0);
  });

  test('永続化される（読み直しても残る）', () => {
    const list = ensureActiveOrderList('2026-08-17');
    bumpOrderLine(list.id, '111', 1);
    setBatchExported(list.id, 0, true);
    __resetStoreForTest();
    loadAll();
    expect(batchesOf(list.id)).toEqual([0]);
  });
});

describe('stamp', () => {
  test('id と日時が入る', () => {
    const s = stamp();
    expect(s.id).toBeTruthy();
    expect(Number.isNaN(Date.parse(s.createdAt))).toBe(false);
    expect(s.createdAt).toBe(s.updatedAt);
  });
});
