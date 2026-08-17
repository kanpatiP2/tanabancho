import { describe, expect, it } from 'vitest';
import type { OrderList } from '@core/types';
import {
  batchCount,
  buildEsp32Payload,
  buildJanLines,
  crc16Ccitt,
  crc16Hex,
  eolChars,
  isFullyExported,
  splitBatches,
  toJanLines,
} from './payload';

function makeList(lines: { jan: string; qty: number }[], exportedBatches: number[] = []): OrderList {
  return {
    id: 'list-1',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    label: '2026-08-17',
    lines,
    exportedBatches,
  };
}

// ---------------------------------------------------------------- 行末

describe('eolChars', () => {
  it('CRLF / LF を制御文字へ', () => {
    expect(eolChars('CRLF')).toBe('\r\n');
    expect(eolChars('LF')).toBe('\n');
  });
});

// ---------------------------------------------------------------- JAN 行

describe('toJanLines', () => {
  const list = makeList([
    { jan: '4901777018686', qty: 3 },
    { jan: '4912345678904', qty: 1 },
  ]);

  it('既定では数量に関係なく1 JAN = 1行', () => {
    expect(toJanLines(list)).toEqual(['4901777018686', '4912345678904']);
  });

  it('repeatByQty で数量分だけ繰り返す', () => {
    expect(toJanLines(list, { repeatByQty: true })).toEqual([
      '4901777018686',
      '4901777018686',
      '4901777018686',
      '4912345678904',
    ]);
  });

  it('スキャン順を保つ', () => {
    const l = makeList([
      { jan: '333', qty: 1 },
      { jan: '111', qty: 1 },
      { jan: '222', qty: 1 },
    ]);
    expect(toJanLines(l)).toEqual(['333', '111', '222']);
  });

  it('空 JAN・数量0以下・不正な数量は捨てる', () => {
    const l = makeList([
      { jan: '', qty: 5 },
      { jan: '  ', qty: 5 },
      { jan: '111', qty: 0 },
      { jan: '222', qty: -1 },
      { jan: '333', qty: Number.NaN },
      { jan: '444', qty: 2 },
    ]);
    expect(toJanLines(l, { repeatByQty: true })).toEqual(['444', '444']);
  });

  it('リストが無い / 空でも落ちない', () => {
    expect(toJanLines(null)).toEqual([]);
    expect(toJanLines(undefined)).toEqual([]);
    expect(toJanLines(makeList([]))).toEqual([]);
  });

  it('繰り返しは 999 回で頭打ち', () => {
    const l = makeList([{ jan: '111', qty: 100000 }]);
    expect(toJanLines(l, { repeatByQty: true })).toHaveLength(999);
  });
});

describe('buildJanLines', () => {
  const list = makeList([
    { jan: '4901777018686', qty: 2 },
    { jan: '4912345678904', qty: 1 },
  ]);

  it('CRLF で連結し、末尾には行末を付けない', () => {
    expect(buildJanLines(list, { eol: 'CRLF' })).toBe('4901777018686\r\n4912345678904');
  });

  it('LF で連結する', () => {
    expect(buildJanLines(list, { eol: 'LF' })).toBe('4901777018686\n4912345678904');
  });

  it('repeatByQty と行末の組合せ', () => {
    expect(buildJanLines(list, { eol: 'LF', repeatByQty: true })).toBe(
      '4901777018686\n4901777018686\n4912345678904',
    );
    expect(buildJanLines(list, { eol: 'CRLF', repeatByQty: true })).toBe(
      '4901777018686\r\n4901777018686\r\n4912345678904',
    );
  });

  it('空リストは空文字列', () => {
    expect(buildJanLines(makeList([]), { eol: 'CRLF' })).toBe('');
  });
});

// ---------------------------------------------------------------- バッチ分割

describe('splitBatches', () => {
  const lines = Array.from({ length: 45 }, (_, i) => String(i));

  it('端数は最後のバッチに残る', () => {
    const batches = splitBatches(lines, 20);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(20);
    expect(batches[1]).toHaveLength(20);
    expect(batches[2]).toHaveLength(5);
    expect(batches.flat()).toEqual(lines);
  });

  it('ちょうど割り切れるときは端数バッチを作らない', () => {
    expect(splitBatches(lines.slice(0, 40), 20)).toHaveLength(2);
    expect(splitBatches(lines.slice(0, 30), 30)).toHaveLength(1);
  });

  it('バッチサイズより少なければ1バッチ', () => {
    expect(splitBatches(['a', 'b'], 50)).toEqual([['a', 'b']]);
  });

  it('空配列は空', () => {
    expect(splitBatches([], 20)).toEqual([]);
    expect(splitBatches([], 50)).toEqual([]);
  });

  it('元の配列を破壊しない', () => {
    const src = ['a', 'b', 'c'];
    splitBatches(src, 20);
    expect(src).toEqual(['a', 'b', 'c']);
  });
});

describe('batchCount', () => {
  it('splitBatches の件数と一致する', () => {
    for (const n of [0, 1, 19, 20, 21, 45, 100]) {
      const lines = Array.from({ length: n }, (_, i) => String(i));
      for (const size of [20, 30, 50] as const) {
        expect(batchCount(n, size)).toBe(splitBatches(lines, size).length);
      }
    }
  });

  it('負数は 0', () => {
    expect(batchCount(-5, 20)).toBe(0);
  });
});

describe('isFullyExported', () => {
  it('全バッチが読取済なら true', () => {
    expect(isFullyExported([0, 1, 2], 45, 20)).toBe(true);
  });

  it('欠けがあれば false', () => {
    expect(isFullyExported([0, 2], 45, 20)).toBe(false);
    expect(isFullyExported([], 45, 20)).toBe(false);
  });

  it('余計な番号が入っていても判定は変わらない', () => {
    expect(isFullyExported([0, 1, 2, 7], 45, 20)).toBe(true);
  });

  it('0件のリストは「出力済」にしない', () => {
    expect(isFullyExported([0], 0, 20)).toBe(false);
    expect(isFullyExported(undefined, 0, 20)).toBe(false);
  });

  it('バッチサイズを変えると判定も変わる', () => {
    expect(isFullyExported([0, 1, 2], 45, 50)).toBe(true); // 45件は50なら1バッチ
    expect(isFullyExported([0], 45, 20)).toBe(false);
  });
});

// ---------------------------------------------------------------- CRC16

/** 検算用のテーブル駆動 CRC-16/CCITT-FALSE（本体とは別アルゴリズムで独立に計算する） */
function crc16Table(s: string): number {
  const table: number[] = [];
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let bit = 0; bit < 8; bit++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    table[i] = c;
  }
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(s)) {
    crc = ((crc << 8) & 0xffff) ^ table[((crc >> 8) ^ byte) & 0xff]!;
  }
  return crc;
}

describe('crc16Ccitt', () => {
  it('既知ベクタ（CRC-16/CCITT-FALSE）', () => {
    // 規格の検査値: '123456789' → 0x29B1。空文字列は初期値そのまま
    expect(crc16Ccitt('123456789')).toBe(0x29b1);
    expect(crc16Ccitt('')).toBe(0xffff);
    expect(crc16Ccitt('A')).toBe(0xb915);
  });

  it('テーブル駆動の独立実装と一致する', () => {
    const samples = [
      '',
      'A',
      '123456789',
      '4901777018686',
      '4901777018686\r\n4912345678904',
      '4901777018686\n4912345678904\n4902102072618',
      '#TB1 BEGIN n=0 eol=ENTER ikd=15 ild=120',
      '4901777018686\r\n'.repeat(50),
    ];
    for (const s of samples) {
      expect(crc16Ccitt(s)).toBe(crc16Table(s));
    }
  });

  it('Uint8Array でも同じ結果', () => {
    const bytes = new Uint8Array([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]);
    expect(crc16Ccitt(bytes)).toBe(0x29b1);
  });

  it('16bit に収まる', () => {
    const long = '4901777018686\r\n'.repeat(200);
    const crc = crc16Ccitt(long);
    expect(crc).toBeGreaterThanOrEqual(0);
    expect(crc).toBeLessThanOrEqual(0xffff);
  });

  it('1文字違えば値が変わる', () => {
    expect(crc16Ccitt('4901777018686')).not.toBe(crc16Ccitt('4901777018687'));
  });

  it('行末の違いを検出する', () => {
    expect(crc16Ccitt('111\r\n222')).not.toBe(crc16Ccitt('111\n222'));
  });
});

describe('crc16Hex', () => {
  it('大文字4桁ゼロ埋め', () => {
    expect(crc16Hex('123456789')).toBe('29B1');
    expect(crc16Hex('')).toBe('FFFF');
    expect(crc16Hex('A')).toBe('B915');
  });

  it('4桁未満の値もゼロ埋めされる', () => {
    // 値そのものは実装依存なので、桁数と文字種だけ検証する
    for (const s of ['1', '22', '333', '4444', '55555']) {
      expect(crc16Hex(s)).toMatch(/^[0-9A-F]{4}$/);
    }
  });
});

// ---------------------------------------------------------------- ESP32

describe('buildEsp32Payload', () => {
  const lines = ['4901777018686', '4912345678904', '4902102072618'];

  it('BEGIN / 本文 / END の順に並ぶ', () => {
    const p = buildEsp32Payload(lines, { eol: 'CRLF' });
    const rows = p.text.split('\r\n');
    expect(rows[0]).toMatch(/^#TB1 BEGIN /);
    expect(rows.slice(1, 4)).toEqual(lines);
    expect(rows[4]).toBe('#TB1 END');
    expect(rows).toHaveLength(5);
  });

  it('ヘッダの書式（n / eol / ikd / ild / crc）', () => {
    const p = buildEsp32Payload(lines, { eol: 'LF' });
    const header = p.text.split('\n')[0]!;
    expect(header).toBe(`#TB1 BEGIN n=3 eol=ENTER ikd=15 ild=120 crc=${p.crc}`);
    expect(p.crc).toMatch(/^[0-9A-F]{4}$/);
    expect(p.lineCount).toBe(3);
  });

  it('crc は「本文を eol で連結した文字列」の CRC16-CCITT', () => {
    const p = buildEsp32Payload(lines, { eol: 'CRLF' });
    expect(p.crc).toBe(crc16Hex(lines.join('\r\n')));

    const q = buildEsp32Payload(lines, { eol: 'LF' });
    expect(q.crc).toBe(crc16Hex(lines.join('\n')));
    expect(q.crc).not.toBe(p.crc);
  });

  it('BEGIN行の直後から END行の直前までが CRC 対象バイトと一致する', () => {
    const p = buildEsp32Payload(lines, { eol: 'CRLF' });
    const head = p.text.indexOf('\r\n') + 2;
    const tail = p.text.lastIndexOf('\r\n#TB1 END');
    expect(crc16Hex(p.text.slice(head, tail))).toBe(p.crc);
  });

  it('ikd / ild を上書きできる', () => {
    const p = buildEsp32Payload(lines, { eol: 'LF', ikd: 5, ild: 300 });
    expect(p.text.split('\n')[0]).toContain('ikd=5 ild=300');
  });

  it('ikd / ild は非負整数に丸める', () => {
    const p = buildEsp32Payload(lines, { eol: 'LF', ikd: -3, ild: 12.9 });
    expect(p.text.split('\n')[0]).toContain('ikd=0 ild=12');
  });

  it('0件でも BEGIN/END を出す（n=0 / crc=FFFF）', () => {
    const p = buildEsp32Payload([], { eol: 'CRLF' });
    expect(p.lineCount).toBe(0);
    expect(p.crc).toBe('FFFF');
    expect(p.text).toBe('#TB1 BEGIN n=0 eol=ENTER ikd=15 ild=120 crc=FFFF\r\n#TB1 END');
  });

  it('1件の場合', () => {
    const p = buildEsp32Payload(['4901777018686'], { eol: 'LF' });
    expect(p.text.split('\n')).toEqual([
      `#TB1 BEGIN n=1 eol=ENTER ikd=15 ild=120 crc=${crc16Hex('4901777018686')}`,
      '4901777018686',
      '#TB1 END',
    ]);
  });

  it('buildJanLines → splitBatches → buildEsp32Payload が繋がる', () => {
    const list = makeList(Array.from({ length: 25 }, (_, i) => ({ jan: `49012345678${i}`, qty: 1 })));
    const all = toJanLines(list);
    const batches = splitBatches(all, 20);
    expect(batches).toHaveLength(2);
    const p = buildEsp32Payload(batches[1]!, { eol: 'CRLF' });
    expect(p.lineCount).toBe(5);
    expect(p.text.split('\r\n')).toHaveLength(7); // BEGIN + 5 + END
  });
});
