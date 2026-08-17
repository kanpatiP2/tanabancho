import { describe, expect, it } from 'vitest';
import { compressToEncodedURIComponent } from 'lz-string';
import {
  SHARE_LIMITS,
  buildShareUrl,
  decodeShareData,
  decodeShareDataDetailed,
  encodeShareData,
  envelopeToScanItems,
  extractDataParam,
  toShareTime,
} from './share-codec';
import type { ScanItem } from './types';

// ---------------------------------------------------------------- フィクスチャ

function scan(over: Partial<ScanItem> = {}): ScanItem {
  const iso = '2026-08-17T05:09:00.000Z';
  return {
    id: 'id-1',
    createdAt: iso,
    updatedAt: iso,
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
    ...over,
  };
}

/** v1（legacy/share.html・legacy/index.html の encodeShareData）が出力していた slim 配列 */
const V1_SLIM = [
  {
    id: 'sh1755412345678abcd',
    c: '4901234567894',
    t: '14:09',
    n: 'テスト商品A',
    m: '棚下段',
    g: '菓子',
    p: 1,
    pd: [{ size: '6号', qty: 2, lami: true, enlarge: 'A3', assignee: '' }],
    e: 1,
    o: ['発注(上げ)'],
  },
  {
    id: 'sh1755412399999efgh',
    c: '4900000000005',
    t: '14:10',
    n: '',
    m: '',
    g: '',
    p: 0,
    pd: [],
    e: 0,
    o: [],
  },
];

/** v1 の btoa 旧形式（LZ導入前） */
function legacyBtoa(value: unknown): string {
  return btoa(encodeURIComponent(JSON.stringify(value)));
}

// ---------------------------------------------------------------- encode/decode

describe('encodeShareData / decodeShareData (v2)', () => {
  it('v2 エンベロープでラウンドトリップする', () => {
    const items = [
      scan({
        id: 'a',
        jan: '4901234567894',
        name: 'テスト商品A',
        memo: 'めも',
        genre: '菓子',
        end: true,
        pop: [{ size: '6号', qty: 2, lami: true, enlarge: 'A3', assignee: '山田' }],
        order: ['発注(上げ)', '指数変更(下げ)'],
        expiry: '2026-09-01',
      }),
      scan({ id: 'b', jan: '4900000000005' }),
    ];

    const r = decodeShareDataDetailed(encodeShareData(items));
    expect(r.format).toBe('v2');
    expect(r.warnings).toBe(0);
    expect(r.envelope.v).toBe(2);
    expect(r.envelope.app).toBe('tb');
    expect(r.envelope.items).toHaveLength(2);

    const first = r.envelope.items[0]!;
    expect(first).toMatchObject({
      id: 'a',
      c: '4901234567894',
      n: 'テスト商品A',
      m: 'めも',
      g: '菓子',
      p: 1,
      e: 1,
      o: ['発注(上げ)', '指数変更(下げ)'],
      x: '2026-09-01',
    });
    expect(first.pd).toEqual([{ size: '6号', qty: 2, lami: true, enlarge: 'A3', assignee: '山田' }]);
    expect(first.t).toMatch(/^\d{2}:\d{2}$/);

    // 空フィールドは載せない（URL短縮）
    const second = r.envelope.items[1]!;
    expect(second.n).toBeUndefined();
    expect(second.pd).toBeUndefined();
    expect(second.o).toBeUndefined();
    expect(second.x).toBeUndefined();
  });

  it('t は createdAt から HH:MM を導出する', () => {
    const local = new Date(2026, 7, 17, 9, 5).toISOString();
    expect(toShareTime(local)).toBe('09:05');
    expect(toShareTime('not-a-date')).toBe('');
  });

  it('空配列も往復できる', () => {
    const r = decodeShareDataDetailed(encodeShareData([]));
    expect(r.envelope.items).toEqual([]);
    expect(r.warnings).toBe(0);
  });

  it('envelopeToScanItems で ScanItem に戻せる（_legacyId を保持）', () => {
    const env = decodeShareData(encodeShareData([scan({ id: 'orig', name: 'あ', end: true })]));
    const [item] = envelopeToScanItems(env);
    expect(item).toBeDefined();
    expect(item!._legacyId).toBe('orig');
    expect(item!.jan).toBe('4901234567894');
    expect(item!.name).toBe('あ');
    expect(item!.end).toBe(true);
    expect(item!.noLearn).toBe(true);
  });
});

describe('decodeShareData の後方互換', () => {
  it('v1 slim 配列（LZ）をエンベロープに包む', () => {
    const encoded = compressToEncodedURIComponent(JSON.stringify(V1_SLIM));
    const r = decodeShareDataDetailed(encoded);
    expect(r.format).toBe('v1-slim');
    expect(r.warnings).toBe(0);
    expect(r.envelope.v).toBe(2);
    expect(r.envelope.items).toHaveLength(2);

    const a = r.envelope.items[0]!;
    expect(a.id).toBe('sh1755412345678abcd');
    expect(a.c).toBe('4901234567894');
    expect(a.t).toBe('14:09');
    expect(a.n).toBe('テスト商品A');
    expect(a.pd).toEqual([{ size: '6号', qty: 2, lami: true, enlarge: 'A3', assignee: '' }]);
    expect(a.e).toBe(1);
    expect(a.o).toEqual(['発注(上げ)']);

    // v1 の空値は落として持ち回らない
    const b = r.envelope.items[1]!;
    expect(b.p).toBe(0);
    expect(b.n).toBeUndefined();
    expect(b.pd).toBeUndefined();
    expect(b.o).toBeUndefined();
  });

  it('btoa 旧形式（LZ失敗）にフォールバックする', () => {
    const r = decodeShareDataDetailed(legacyBtoa(V1_SLIM));
    expect(r.format).toBe('legacy-btoa');
    expect(r.envelope.items).toHaveLength(2);
    expect(r.envelope.items[0]!.c).toBe('4901234567894');
  });

  it('btoa 形式の v2 エンベロープも読める', () => {
    const env = { v: 2, app: 'tb', ts: '2026-08-17T05:00:00.000Z', items: V1_SLIM };
    const r = decodeShareDataDetailed(legacyBtoa(env));
    expect(r.envelope.ts).toBe('2026-08-17T05:00:00.000Z');
    expect(r.envelope.items).toHaveLength(2);
  });

  it("クエリ経由で '+' が空白に化けても復号できる", () => {
    const encoded = encodeShareData([scan({ name: 'あいうえお'.repeat(20) })]);
    const mangled = encoded.replace(/\+/g, ' ');
    expect(decodeShareData(mangled).items).toHaveLength(1);
  });

  it('復号不能なら例外', () => {
    expect(() => decodeShareData('')).toThrow();
    expect(() => decodeShareData('!!!!!!!!')).toThrow();
  });
});

// ---------------------------------------------------------------- バリデーション

describe('バリデーション', () => {
  function encodeRaw(value: unknown): string {
    return compressToEncodedURIComponent(JSON.stringify(value));
  }

  it('長すぎる文字列は切り詰めて警告する', () => {
    const longName = 'あ'.repeat(500);
    const r = decodeShareDataDetailed(encodeRaw([{ id: 'x', c: '4901234567894', t: '10:00', n: longName, m: longName }]));
    expect(r.envelope.items[0]!.n).toHaveLength(SHARE_LIMITS.name);
    expect(r.envelope.items[0]!.m).toHaveLength(SHARE_LIMITS.memo);
    expect(r.warnings).toBe(2);
  });

  it('不正な型のフィールドは除外する（例外にしない）', () => {
    const r = decodeShareDataDetailed(
      encodeRaw([
        {
          id: 123,
          c: '4901234567894',
          t: { bad: true },
          n: ['配列'],
          g: 42,
          p: 'yes',
          e: null,
          o: 'not-an-array',
          pd: { not: 'array' },
          x: '2026/09/01',
        },
      ]),
    );
    const item = r.envelope.items[0]!;
    expect(item.c).toBe('4901234567894');
    expect(typeof item.id).toBe('string');
    expect(item.id).not.toBe('123');
    expect(item.t).toBe('');
    expect(item.n).toBeUndefined();
    expect(item.g).toBeUndefined();
    expect(item.p).toBeUndefined();
    expect(item.o).toBeUndefined();
    expect(item.pd).toBeUndefined();
    expect(item.x).toBeUndefined();
    expect(r.warnings).toBeGreaterThanOrEqual(6);
  });

  it('コードが無い項目・オブジェクトでない項目は除外する', () => {
    const r = decodeShareDataDetailed(
      encodeRaw([{ id: 'a', c: '4901234567894', t: '' }, { id: 'b', t: '' }, 'ただの文字列', null, 42]),
    );
    expect(r.envelope.items).toHaveLength(1);
    expect(r.warnings).toBe(4);
  });

  it(`巨大配列は ${SHARE_LIMITS.items} 件で打ち切る`, () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ id: `i${i}`, c: `49012345678${String(i).padStart(2, '0')}`, t: '10:00' }));
    const r = decodeShareDataDetailed(encodeRaw(many));
    expect(r.envelope.items).toHaveLength(SHARE_LIMITS.items);
    expect(r.warnings).toBe(100);
  });

  it('encode 側も上限件数で切り捨てる', () => {
    const many = Array.from({ length: 600 }, (_, i) => scan({ id: `i${i}`, jan: `490000000000${i % 10}` }));
    expect(decodeShareData(encodeShareData(many)).items).toHaveLength(SHARE_LIMITS.items);
  });

  it('pop 明細の不正値は既定値に丸める', () => {
    const r = decodeShareDataDetailed(
      encodeRaw([
        {
          id: 'a',
          c: '4901234567894',
          t: '10:00',
          pd: [{ size: 5, qty: 'たくさん', lami: 'yes', enlarge: 'A0', assignee: 7 }, 'ゴミ'],
        },
      ]),
    );
    expect(r.envelope.items[0]!.pd).toEqual([{ size: '', qty: 1, lami: false, enlarge: '', assignee: '' }]);
    expect(r.envelope.items[0]!.p).toBe(1);
    expect(r.warnings).toBeGreaterThan(0);
  });

  it('order は件数と長さで制限する', () => {
    const r = decodeShareDataDetailed(
      encodeRaw([
        { id: 'a', c: '4901234567894', t: '10:00', o: [...Array.from({ length: 20 }, () => 'x'), 'あ'.repeat(80)] },
      ]),
    );
    expect(r.envelope.items[0]!.o).toHaveLength(SHARE_LIMITS.orderCount);
  });

  it('envelope.items が配列でなければ空として扱う', () => {
    const r = decodeShareDataDetailed(encodeRaw({ v: 2, app: 'tb', ts: '', items: 'こわれた' }));
    expect(r.envelope.items).toEqual([]);
    expect(r.warnings).toBe(1);
    expect(r.envelope.ts).not.toBe('');
  });
});

describe('XSS 的ペイロード', () => {
  const payloads = [
    '<img src=x onerror="alert(1)">',
    '<script>alert(document.cookie)</script>',
    '"><svg/onload=alert(1)>',
    'javascript:alert(1)',
  ];

  it('エスケープも除去もせず文字列のまま保持する（描画側が JSX で無害化する）', () => {
    const items = payloads.map((p, i) => scan({ id: `p${i}`, jan: `490000000000${i}`, name: p, memo: p, genre: p }));
    const r = decodeShareDataDetailed(encodeShareData(items));
    expect(r.warnings).toBe(0);
    r.envelope.items.forEach((item, i) => {
      expect(item.n).toBe(payloads[i]);
      expect(item.m).toBe(payloads[i]);
    });
  });

  it('order / pop の中の危険文字列もそのまま', () => {
    const r = decodeShareDataDetailed(
      encodeShareData([
        scan({ order: ['<b>発注</b>'], pop: [{ size: '<i>6号</i>', qty: 1, lami: false, enlarge: '', assignee: '<u>x</u>' }] }),
      ]),
    );
    expect(r.envelope.items[0]!.o).toEqual(['<b>発注</b>']);
    expect(r.envelope.items[0]!.pd![0]!.size).toBe('<i>6号</i>');
  });
});

// ---------------------------------------------------------------- URL ヘルパー

describe('buildShareUrl', () => {
  it('data と from を付ける', () => {
    expect(buildShareUrl('https://example.com/tanabancho/share.html', 'ABC', 'main')).toBe(
      'https://example.com/tanabancho/share.html?data=ABC&from=main',
    );
  });

  it('既存のクエリ・フラグメントは捨てる', () => {
    expect(buildShareUrl('https://example.com/share.html?data=OLD&from=share#x', 'NEW', 'share')).toBe(
      'https://example.com/share.html?data=NEW&from=share',
    );
  });
});

describe('extractDataParam', () => {
  it('完全URLから取り出す', () => {
    expect(extractDataParam('https://example.com/share.html?data=ABC123&from=main')).toBe('ABC123');
    expect(extractDataParam('https://example.com/share.html?from=main&data=ABC123')).toBe('ABC123');
  });

  it('フラグメントより手前で切る', () => {
    expect(extractDataParam('https://example.com/share.html?data=ABC#frag')).toBe('ABC');
  });

  it('生データ（data= なし）はそのまま受ける', () => {
    const encoded = encodeShareData([scan()]);
    expect(extractDataParam(encoded)).toBe(encoded);
    expect(extractDataParam('  N4IgLg  ')).toBe('N4IgLg');
  });

  it('data パラメータの無い URL は空', () => {
    expect(extractDataParam('https://example.com/share.html?from=main')).toBe('');
    expect(extractDataParam('https://example.com/share.html')).toBe('');
    expect(extractDataParam('')).toBe('');
  });

  it('extractDataParam → decodeShareData が繋がる', () => {
    const url = buildShareUrl('https://example.com/share.html', encodeShareData([scan({ name: '結合テスト' })]), 'main');
    expect(decodeShareData(extractDataParam(url)).items[0]!.n).toBe('結合テスト');
  });
});
