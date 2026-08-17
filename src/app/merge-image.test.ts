import { describe, expect, test } from 'vitest';
import type { PopDetail, ScanItem } from '@core/types';
import {
  EMPTY_FILTER,
  MAX_ITEMS_PER_IMAGE,
  altInfoText,
  applyMergeFilter,
  buildBadges,
  canvasHeightFor,
  chunkItems,
  chunkTitle,
  displayNumber,
  formatPopDetails,
  mergedFileName,
} from './merge-image';

function item(patch: Partial<ScanItem> = {}): ScanItem {
  return {
    id: patch.id ?? Math.random().toString(36).slice(2),
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    jan: '4901234567894',
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

const pop = (patch: Partial<PopDetail> = {}): PopDetail => ({
  size: '7号',
  qty: 1,
  lami: false,
  enlarge: '',
  assignee: '',
  ...patch,
});

describe('formatPopDetails', () => {
  test('空なら空文字', () => {
    expect(formatPopDetails([])).toBe('');
  });

  test('枚数1は数量を省く', () => {
    expect(formatPopDetails([pop()])).toBe('(7号)');
  });

  test('枚数2以上は x付き', () => {
    expect(formatPopDetails([pop({ qty: 3 })])).toBe('(7号x3)');
  });

  test('競合は数量を付けない', () => {
    expect(formatPopDetails([pop({ size: '競合', qty: 5 })])).toBe('(競合)');
  });

  test('ラミ・拡大・委託先を角括弧で添える', () => {
    expect(formatPopDetails([pop({ lami: true, enlarge: 'A3', assignee: '田中' })])).toBe(
      '(7号[ラミ/A3/田中])',
    );
  });
});

describe('applyMergeFilter', () => {
  const items = [
    item({ id: 'a', genre: '1番', order: ['発注(上げ)'] }),
    item({ id: 'b', genre: '2番', pop: [pop()] }),
    item({ id: 'c', genre: '1番', memo: '棚替え' }),
  ];

  test('既定では全件', () => {
    expect(applyMergeFilter(items, EMPTY_FILTER)).toHaveLength(3);
  });

  test('ジャンル絞り込み', () => {
    expect(applyMergeFilter(items, { ...EMPTY_FILTER, genre: '1番' }).map((i) => i.id)).toEqual([
      'a',
      'c',
    ]);
  });

  test('コメント絞り込み', () => {
    expect(applyMergeFilter(items, { ...EMPTY_FILTER, memo: '棚替え' }).map((i) => i.id)).toEqual(['c']);
  });

  test('発注種別絞り込み', () => {
    expect(applyMergeFilter(items, { ...EMPTY_FILTER, order: '発注(上げ)' }).map((i) => i.id)).toEqual([
      'a',
    ]);
  });

  test('POPのみ', () => {
    expect(applyMergeFilter(items, { ...EMPTY_FILTER, popOnly: true }).map((i) => i.id)).toEqual(['b']);
  });

  test('発注/指数のみ', () => {
    expect(applyMergeFilter(items, { ...EMPTY_FILTER, orderOnly: true }).map((i) => i.id)).toEqual(['a']);
  });

  test('任意選択', () => {
    const ids = new Set(['b', 'c']);
    expect(applyMergeFilter(items, { ...EMPTY_FILTER, selectedIds: ids }).map((i) => i.id)).toEqual([
      'b',
      'c',
    ]);
  });

  test('ジャンル順ソート', () => {
    const out = applyMergeFilter(items, { ...EMPTY_FILTER, sortByGenre: true });
    expect(out.map((i) => i.genre)).toEqual(['1番', '1番', '2番']);
  });

  test('元配列を破壊しない', () => {
    applyMergeFilter(items, { ...EMPTY_FILTER, sortByGenre: true });
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('チャンク分割', () => {
  test('20件ごとに分ける', () => {
    const items = Array.from({ length: 45 }, (_, i) => item({ id: String(i) }));
    const chunks = chunkItems(items);
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 5]);
    expect(MAX_ITEMS_PER_IMAGE).toBe(20);
  });

  test('空配列はチャンク0', () => {
    expect(chunkItems([])).toEqual([]);
  });

  test('通し番号は枚をまたいで連続する', () => {
    expect(displayNumber(0, 0)).toBe(1);
    expect(displayNumber(1, 0)).toBe(21);
    expect(displayNumber(2, 4)).toBe(45);
  });

  test('複数枚のときだけタイトルに枚数が付く', () => {
    expect(chunkTitle('棚替え', 0, 1)).toBe('棚替え');
    expect(chunkTitle('棚替え', 0, 3)).toBe('棚替え (1/3)');
    expect(chunkTitle('', 1, 3)).toBe('(2/3)');
  });

  test('canvas 高さは件数に比例する', () => {
    expect(canvasHeightFor(0)).toBe(80 + 22 + 8);
    expect(canvasHeightFor(2)).toBe(80 + 22 + 155 * 2 + 8);
  });
});

describe('バッジ', () => {
  test('発注種別ごとに色が付く', () => {
    const badges = buildBadges(item({ order: ['発注(上げ)', '発注(下げ)'] }));
    expect(badges.map((b) => b.text)).toEqual(['発注(上げ)', '発注(下げ)']);
    expect(badges[0]!.bg).not.toBe(badges[1]!.bg);
  });

  test('未知の発注種別も既定色で出る', () => {
    const badges = buildBadges(item({ order: ['独自区分'] }));
    expect(badges[0]!.text).toBe('独自区分');
    expect(badges[0]!.bg).toBeTruthy();
  });

  test('競合POPは別色になる', () => {
    const normal = buildBadges(item({ pop: [pop()] }))[0]!;
    const comp = buildBadges(item({ pop: [pop({ size: '競合' })] }))[0]!;
    expect(normal.bg).not.toBe(comp.bg);
  });

  test('何も無ければ空', () => {
    expect(buildBadges(item())).toEqual([]);
  });
});

describe('altInfoText', () => {
  test('商品名未設定時の代替情報を連結する', () => {
    const text = altInfoText(item({ genre: '1番', end: true, memo: 'メモ', order: ['発注(上げ)'] }));
    expect(text).toBe('1番 / 発注(上げ) / エンド / メモ');
  });

  test('情報が無ければ空文字', () => {
    expect(altInfoText(item())).toBe('');
  });
});

describe('mergedFileName', () => {
  test('1枚ならサフィックス無し', () => {
    expect(mergedFileName('棚替え', 0, 1)).toMatch(/^棚替え_\d{4}-\d{2}-\d{2}\.jpg$/);
  });

  test('複数枚なら連番が付く', () => {
    expect(mergedFileName('棚替え', 1, 3)).toMatch(/_2\.jpg$/);
  });

  test('タイトル未入力なら barcodes', () => {
    expect(mergedFileName('  ', 0, 1)).toMatch(/^barcodes_/);
  });
});
