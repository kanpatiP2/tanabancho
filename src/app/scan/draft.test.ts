import { beforeEach, describe, expect, test } from 'vitest';
import { createMemoryBackend, setStorageBackend } from '@core/storage';
import { addDays, todayLocal } from '@core/datetime';
import type { Product, ResolvedCode } from '@core/types';
import {
  __resetStoreForTest,
  learnProduct,
  orderLists,
  products,
  scans,
} from '../store';
import {
  activeOrderListId,
  addCompCheckToHistory,
  addToOrder,
  applyExpiry,
  captureDraft,
  clearPop,
  flash,
  lastExpiry,
  patchCapture,
  patchPop,
  popDraft,
  popSummary,
  registerScan,
  suggestExpiryFor,
  toggleCaptureOrder,
  togglePopSize,
} from './draft';
import { searchProducts } from './search';

function code(jan: string, patch: Partial<ResolvedCode> = {}): ResolvedCode {
  return { jan, raw: jan, fromItf: false, fromBoxJan: false, leadingZero: jan.startsWith('0'), ...patch };
}

beforeEach(() => {
  setStorageBackend(createMemoryBackend());
  __resetStoreForTest();
  captureDraft.value = { name: '', end: false, order: [], genre: '', memo: '', keep: false };
  clearPop();
  flash.value = null;
  lastExpiry.value = '';
  activeOrderListId.value = '';
});

describe('registerScan', () => {
  test('下書きの内容が履歴に反映される', () => {
    patchCapture({ name: 'テスト商品', genre: '1番', memo: 'コメント', end: true });
    toggleCaptureOrder('発注(上げ)');
    const item = registerScan(code('4901234567894'));
    expect(item).not.toBeNull();
    expect(item!.name).toBe('テスト商品');
    expect(item!.genre).toBe('1番');
    expect(item!.memo).toBe('コメント');
    expect(item!.end).toBe(true);
    expect(item!.order).toEqual(['発注(上げ)']);
  });

  test('重複JANは登録しない', () => {
    registerScan(code('111'));
    expect(registerScan(code('111'))).toBeNull();
    expect(scans.value).toHaveLength(1);
  });

  test('辞書の商品名を引き継ぐ', () => {
    learnProduct('111', { name: '辞書名', nameSource: 'manual' });
    const item = registerScan(code('111'));
    expect(item!.name).toBe('辞書名');
    expect(flash.value?.known).toBe(true);
  });

  test('未知コードは名称未登録として flash に出る', () => {
    registerScan(code('999'));
    expect(flash.value?.known).toBe(false);
    expect(flash.value?.name).toBe('');
  });

  test('入力した商品名は辞書へ学習される', () => {
    patchCapture({ name: '新商品' });
    registerScan(code('111'));
    expect(products.value['111']?.name).toBe('新商品');
  });

  test('📌維持ONなら下書きが残る（商品名だけクリア）', () => {
    patchCapture({ name: 'あ', genre: '1番', keep: true, end: true });
    registerScan(code('111'));
    expect(captureDraft.value.genre).toBe('1番');
    expect(captureDraft.value.end).toBe(true);
    expect(captureDraft.value.name).toBe('');
  });

  test('📌維持OFFなら下書きが初期化される', () => {
    patchCapture({ name: 'あ', genre: '1番', end: true });
    registerScan(code('111'));
    expect(captureDraft.value).toEqual({ name: '', end: false, order: [], genre: '', memo: '', keep: false });
  });

  test('POP組合せを渡すと履歴に載る', () => {
    togglePopSize('7号');
    patchPop('7号', { qty: 3, lami: true });
    const item = registerScan(code('111'), { pop: popDraft.value });
    expect(item!.pop).toEqual([{ size: '7号', qty: 3, lami: true, enlarge: '', assignee: '' }]);
  });

  test('期限を渡すと lastExpiry が更新される', () => {
    const expiry = addDays(todayLocal(), 5);
    registerScan(code('111'), { expiry });
    expect(lastExpiry.value).toBe(expiry);
  });
});

describe('期限の学習と提案', () => {
  test('登録した期限から提案値が出る', () => {
    const expiry = addDays(todayLocal(), 3);
    registerScan(code('111'), { expiry });
    expect(suggestExpiryFor('111')).toBe(expiry);
  });

  test('学習が無ければ null', () => {
    expect(suggestExpiryFor('999')).toBeNull();
  });

  test('applyExpiry で後から期限を付けられる', () => {
    const item = registerScan(code('111'))!;
    const expiry = addDays(todayLocal(), 7);
    applyExpiry(item.id, expiry);
    expect(scans.value[0]!.expiry).toBe(expiry);
    expect(products.value['111']?.expiryOffsets).toEqual([7]);
  });

  test('最頻値が提案される', () => {
    const today = todayLocal();
    registerScan(code('111'), { expiry: addDays(today, 3) });
    const a = registerScan(code('222'))!;
    applyExpiry(a.id, addDays(today, 3));
    // 別JANなので 111 の学習は 1 件のまま
    expect(suggestExpiryFor('111')).toBe(addDays(today, 3));
    expect(suggestExpiryFor('222')).toBe(addDays(today, 3));
  });
});

describe('popSummary', () => {
  test('未選択', () => {
    expect(popSummary.value).toBe('未選択');
  });

  test('組合せを1行で表す', () => {
    togglePopSize('7号');
    patchPop('7号', { qty: 2, lami: true, enlarge: 'A3', assignee: '田中' });
    expect(popSummary.value).toBe('7号x2 ラミ A3 →田中');
  });

  test('トグルで外れる', () => {
    togglePopSize('7号');
    togglePopSize('7号');
    expect(popDraft.value).toEqual([]);
  });
});

describe('発注モード', () => {
  test('同一JANの再スキャンで数量が増える', () => {
    addToOrder('111');
    addToOrder('111');
    const list = orderLists.value[0]!;
    expect(list.lines).toEqual([{ jan: '111', qty: 2 }]);
  });

  test('リストは1つだけ作られる', () => {
    addToOrder('111');
    addToOrder('222');
    expect(orderLists.value).toHaveLength(1);
  });

  test('キャッシュしたリストが消えていたら作り直す', () => {
    addToOrder('111');
    const staleId = activeOrderListId.value;
    // バックアップ取込等でコレクションだけ差し替わった状況
    orderLists.value = [];
    addToOrder('222');
    expect(orderLists.value).toHaveLength(1);
    expect(activeOrderListId.value).not.toBe(staleId);
    expect(orderLists.value[0]!.lines).toEqual([{ jan: '222', qty: 1 }]);
  });
});

describe('競合対抗確認', () => {
  test('履歴に競合ヘッダーとして追加される', () => {
    const item = addCompCheckToHistory({ jan: '111', name: '競合商品', matched: true, compId: 'k1' });
    expect(item!.genre).toBe('競合ヘッダー');
    expect(scans.value).toHaveLength(1);
  });

  test('重複は追加しない', () => {
    addCompCheckToHistory({ jan: '111', name: 'A', matched: true, compId: '' });
    expect(addCompCheckToHistory({ jan: '111', name: 'A', matched: true, compId: '' })).toBeNull();
  });
});

describe('searchProducts', () => {
  const db: Record<string, Product> = {
    '4901234567894': {
      jan: '4901234567894',
      name: 'コーラ 500ml',
      nameSource: 'manual',
      boxJan: '',
      expiryOffsets: [],
      lastUsedAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
    },
    '4909999999999': {
      jan: '4909999999999',
      name: 'お茶 2L',
      nameSource: 'manual',
      boxJan: '',
      expiryOffsets: [],
      lastUsedAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
  };

  test('空文字なら結果なし', () => {
    expect(searchProducts(db, '')).toEqual([]);
  });

  test('コード部分一致', () => {
    expect(searchProducts(db, '49012').map((p) => p.jan)).toEqual(['4901234567894']);
  });

  test('商品名部分一致', () => {
    expect(searchProducts(db, 'お茶').map((p) => p.jan)).toEqual(['4909999999999']);
  });

  test('両方にまたがるとコード一致が先', () => {
    const hits = searchProducts(db, '490');
    expect(hits).toHaveLength(2);
    expect(hits[0]!.jan.startsWith('490')).toBe(true);
  });

  test('件数上限が効く', () => {
    expect(searchProducts(db, '490', 1)).toHaveLength(1);
  });
});
