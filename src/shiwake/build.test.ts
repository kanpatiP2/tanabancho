import { describe, expect, it } from 'vitest';
import type { GeminiSheet } from './gemini';
import {
  buildFromSheets,
  cartLabel,
  janCheckDigit,
  normalizeDeliveryDate,
  reevaluateAlerts,
  resolveShiwakeCode,
} from './build';

function sheet(over: Partial<GeminiSheet> = {}): GeminiSheet {
  return {
    sheetIndex: 1,
    cartId: '',
    store: '',
    deliveryDate: '',
    items: [{ name: 'ドンベエ', code: '4901234567894', qtyPerCase: 12, cases: 2 }],
    ...over,
  };
}

let seq = 0;
const makeId = () => `id${seq++}`;

describe('janCheckDigit', () => {
  it('JAN13 のチェックデジットを計算する', () => {
    expect(janCheckDigit('490123456789')).toBe('4');
    expect(janCheckDigit('456995111116')).toBe('7');
  });
});

describe('resolveShiwakeCode', () => {
  it('ITF-14 を JAN13 に変換する', () => {
    const r = resolveShiwakeCode('14901234567891');
    expect(r.jan).toBe('4901234567894');
    expect(r.fromItf).toBe(true);
  });

  it('JAN13 はそのまま', () => {
    expect(resolveShiwakeCode('4901234567894')).toEqual({ jan: '4901234567894', fromItf: false });
  });

  it('UPC-A(12桁) は先頭 0 を補って JAN13 にする', () => {
    expect(resolveShiwakeCode('012345678905').jan).toBe('0012345678905');
  });

  it('EAN8 はそのまま', () => {
    expect(resolveShiwakeCode('49123456').jan).toBe('49123456');
  });

  it('全角数字・区切り記号を含む生コードを処理する', () => {
    expect(resolveShiwakeCode('４９０１-２３４-５６７８９４').jan).toBe('4901234567894');
  });

  it('コード無しは空', () => {
    expect(resolveShiwakeCode('')).toEqual({ jan: '', fromItf: false });
    expect(resolveShiwakeCode('なし')).toEqual({ jan: '', fromItf: false });
  });
});

describe('normalizeDeliveryDate', () => {
  const today = new Date(2026, 7, 17);

  it('各種書式を YYYY-MM-DD にする', () => {
    expect(normalizeDeliveryDate('2026-08-17', today)).toBe('2026-08-17');
    expect(normalizeDeliveryDate('2026/8/17', today)).toBe('2026-08-17');
    expect(normalizeDeliveryDate('2026年8月17日', today)).toBe('2026-08-17');
    expect(normalizeDeliveryDate('20260817', today)).toBe('2026-08-17');
  });

  it('年が無ければ今年で補う', () => {
    expect(normalizeDeliveryDate('8/17', today)).toBe('2026-08-17');
    expect(normalizeDeliveryDate('8月17日', today)).toBe('2026-08-17');
  });

  it('解釈できなければ空文字（DateOnly の契約を守る）', () => {
    expect(normalizeDeliveryDate('', today)).toBe('');
    expect(normalizeDeliveryDate('翌日便', today)).toBe('');
  });
});

describe('cartLabel', () => {
  it('仕器NO があれば「仕器XX 店舗」', () => {
    expect(cartLabel(sheet({ cartId: 'A12', store: '本店' }), 0)).toBe('仕器A12 本店');
    expect(cartLabel(sheet({ cartId: 'A12' }), 0)).toBe('仕器A12');
  });

  it('無ければ店舗名、それも無ければ明細N', () => {
    expect(cartLabel(sheet({ store: '本店' }), 0)).toBe('本店');
    expect(cartLabel(sheet({ sheetIndex: 3 }), 2)).toBe('明細3');
  });
});

describe('buildFromSheets', () => {
  it('明細ごとにカートを作り cartIndex を対応付ける', () => {
    const { items, carts } = buildFromSheets(
      [
        sheet({ sheetIndex: 1, cartId: 'A', items: [{ name: 'X', code: '', qtyPerCase: 1, cases: 1 }] }),
        sheet({ sheetIndex: 2, cartId: 'B', items: [{ name: 'Y', code: '', qtyPerCase: 1, cases: 1 }] }),
      ],
      { alertWords: [], makeId },
    );
    expect(carts.map((c) => c.index)).toEqual([0, 1]);
    expect(carts.map((c) => c.label)).toEqual(['仕器A', '仕器B']);
    expect(items.map((i) => [i.name, i.cartIndex])).toEqual([
      ['X', 0],
      ['Y', 1],
    ]);
  });

  it('要注意ワードを判定する', () => {
    const { items } = buildFromSheets([sheet()], { alertWords: ['どんべえ'], makeId });
    expect(items[0]!.isAlert).toBe(true);
  });

  it('ITF-14 の箱コードを boxJanByJan として拾う', () => {
    const { items, boxJanByJan } = buildFromSheets(
      [sheet({ items: [{ name: 'X', code: '14901234567891', qtyPerCase: 6, cases: 1 }] })],
      { alertWords: [], makeId },
    );
    expect(items[0]!.jan).toBe('4901234567894');
    expect(boxJanByJan['4901234567894']).toBe('14901234567891');
  });

  it('qtyPerCase の null をそのまま保持する（表示側でガードする）', () => {
    const { items } = buildFromSheets(
      [sheet({ items: [{ name: 'X', code: '', qtyPerCase: null, cases: 1 }] })],
      { alertWords: [], makeId },
    );
    expect(items[0]!.qtyPerCase).toBeNull();
  });

  it('納品日を DateOnly に正規化する', () => {
    const { carts } = buildFromSheets([sheet({ deliveryDate: '2026/8/17' })], {
      alertWords: [],
      makeId,
      today: new Date(2026, 7, 17),
    });
    expect(carts[0]!.deliveryDate).toBe('2026-08-17');
  });

  it('ID は明細ごとに一意', () => {
    const { items } = buildFromSheets(
      [sheet({ items: [{ name: 'X', code: '', qtyPerCase: 1, cases: 1 }, { name: 'X', code: '', qtyPerCase: 1, cases: 1 }] })],
      { alertWords: [], makeId },
    );
    expect(items[0]!.id).not.toBe(items[1]!.id);
  });
});

describe('reevaluateAlerts', () => {
  it('ワード追加で既存明細が要注意になる', () => {
    const { items } = buildFromSheets([sheet()], { alertWords: [], makeId });
    expect(items[0]!.isAlert).toBe(false);
    const after = reevaluateAlerts(items, ['ドンベエ']);
    expect(after[0]!.isAlert).toBe(true);
  });

  it('ワード削除で要注意が解除される', () => {
    const { items } = buildFromSheets([sheet()], { alertWords: ['ドンベエ'], makeId });
    expect(reevaluateAlerts(items, [])[0]!.isAlert).toBe(false);
  });

  it('変化しない要素は同一参照を返す（再描画を減らす）', () => {
    const { items } = buildFromSheets([sheet()], { alertWords: [], makeId });
    expect(reevaluateAlerts(items, [])[0]).toBe(items[0]);
  });
});
