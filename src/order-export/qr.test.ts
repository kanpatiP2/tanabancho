import { describe, expect, it } from 'vitest';
import { QR_QUIET_ZONE, buildQrMatrix, toQrRects, type QrMatrix } from './qr';
import { buildJanLines, splitBatches, toJanLines } from './payload';
import type { OrderList } from '@core/types';

function janList(n: number): OrderList {
  return {
    id: 'l',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    label: '2026-08-17',
    lines: Array.from({ length: n }, (_, i) => ({
      jan: `49012345678${String(i).padStart(2, '0')}`,
      qty: 1,
    })),
    exportedBatches: [],
  };
}

/** rects からセル格子を復元する（描画結果が cells と一致することの検算用） */
function rectsToGrid(m: QrMatrix): boolean[][] {
  const grid = Array.from({ length: m.size }, () => new Array<boolean>(m.size).fill(false));
  for (const r of toQrRects(m)) {
    for (let x = r.x; x < r.x + r.w; x++) {
      for (let y = r.y; y < r.y + r.h; y++) grid[y]![x] = true;
    }
  }
  return grid;
}

describe('buildQrMatrix', () => {
  it('JAN1件は型番1（21モジュール）', () => {
    const m = buildQrMatrix('4901777018686');
    expect(m.typeNumber).toBe(1);
    expect(m.count).toBe(21);
    expect(m.ecc).toBe('L');
  });

  it('モジュール数は 4 * 型番 + 17 を満たす', () => {
    for (const n of [1, 2, 5, 20, 50]) {
      const m = buildQrMatrix(buildJanLines(janList(n), { eol: 'CRLF' }));
      expect(m.count).toBe(4 * m.typeNumber + 17);
      expect(Number.isInteger(m.typeNumber)).toBe(true);
      expect(m.typeNumber).toBeGreaterThanOrEqual(1);
      expect(m.typeNumber).toBeLessThanOrEqual(40);
    }
  });

  it('cells は count x count の正方で、真偽値だけを持つ', () => {
    const m = buildQrMatrix('4901777018686\r\n4912345678904');
    expect(m.cells).toHaveLength(m.count);
    for (const row of m.cells) {
      expect(row).toHaveLength(m.count);
      for (const cell of row) expect(typeof cell).toBe('boolean');
    }
  });

  it('静寂域は既定 4 モジュール、size = count + margin * 2', () => {
    const m = buildQrMatrix('4901777018686');
    expect(m.margin).toBe(QR_QUIET_ZONE);
    expect(m.margin).toBe(4);
    expect(m.size).toBe(m.count + 8);
  });

  it('静寂域は指定できる（0 も可）', () => {
    const m0 = buildQrMatrix('4901777018686', { margin: 0 });
    expect(m0.margin).toBe(0);
    expect(m0.size).toBe(m0.count);

    const m8 = buildQrMatrix('4901777018686', { margin: 8 });
    expect(m8.size).toBe(m8.count + 16);
    // 静寂域を変えてもデータ部は同一
    expect(m8.cells).toEqual(m0.cells);
  });

  it('左上に位置検出パターン（7x7 のファインダ）がある', () => {
    const c = buildQrMatrix('4901777018686').cells;
    const finder = [
      '#######',
      '#     #',
      '# ### #',
      '# ### #',
      '# ### #',
      '#     #',
      '#######',
    ];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 7; col++) {
        expect(c[row]![col]).toBe(finder[row]![col] === '#');
      }
    }
  });

  it('タイミングパターン（6行目）が交互に並ぶ', () => {
    const m = buildQrMatrix('4901777018686');
    for (let col = 8; col <= m.count - 9; col++) {
      expect(m.cells[6]![col]).toBe(col % 2 === 0);
    }
  });

  it('同じ入力からは同じマトリクスが出る（決定的）', () => {
    const text = buildJanLines(janList(20), { eol: 'CRLF' });
    expect(buildQrMatrix(text)).toEqual(buildQrMatrix(text));
  });

  it('入力が変われば内容も変わる', () => {
    const a = buildQrMatrix('4901777018686');
    const b = buildQrMatrix('4901777018687');
    expect(a.count).toBe(b.count);
    expect(a.cells).not.toEqual(b.cells);
  });

  it('行末の違いはサイズに出る（CRLF の方がバイト数が多い）', () => {
    const lines = toJanLines(janList(50));
    const crlf = buildQrMatrix(lines.join('\r\n'));
    const lf = buildQrMatrix(lines.join('\n'));
    expect(crlf.count).toBeGreaterThanOrEqual(lf.count);
  });

  it('バッチ 20 / 30 / 50 件はすべて型番40以内に収まる', () => {
    const lines = toJanLines(janList(50));
    for (const size of [20, 30, 50] as const) {
      for (const batch of splitBatches(lines, size)) {
        const m = buildQrMatrix(batch.join('\r\n'));
        expect(m.typeNumber).toBeLessThanOrEqual(40);
        expect(m.count).toBeGreaterThan(0);
      }
    }
  });

  it('空文字列でも生成できる', () => {
    const m = buildQrMatrix('');
    expect(m.count).toBeGreaterThan(0);
  });

  it('容量を超える入力は分かりやすい Error にする', () => {
    expect(() => buildQrMatrix('4901777018686\r\n'.repeat(400))).toThrow(/QRに収まりません/);
  });
});

describe('toQrRects', () => {
  it('矩形は静寂域ぶんだけオフセットされ、高さは常に1', () => {
    const m = buildQrMatrix('4901777018686');
    const rects = toQrRects(m);
    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      expect(r.h).toBe(1);
      expect(r.w).toBeGreaterThan(0);
      expect(r.x).toBeGreaterThanOrEqual(m.margin);
      expect(r.y).toBeGreaterThanOrEqual(m.margin);
      expect(r.x + r.w).toBeLessThanOrEqual(m.margin + m.count);
      expect(r.y + r.h).toBeLessThanOrEqual(m.margin + m.count);
    }
  });

  it('座標・幅はすべて整数（拡大しても量子化ズレが出ない）', () => {
    const m = buildQrMatrix(buildJanLines(janList(20), { eol: 'CRLF' }));
    for (const r of toQrRects(m)) {
      expect(Number.isInteger(r.x)).toBe(true);
      expect(Number.isInteger(r.y)).toBe(true);
      expect(Number.isInteger(r.w)).toBe(true);
      expect(Number.isInteger(r.h)).toBe(true);
    }
  });

  it('矩形の面積合計が暗モジュール数と一致する（過不足なし）', () => {
    for (const n of [1, 20, 50]) {
      const m = buildQrMatrix(buildJanLines(janList(n), { eol: 'CRLF' }));
      const dark = m.cells.flat().filter(Boolean).length;
      const area = toQrRects(m).reduce((a, r) => a + r.w * r.h, 0);
      expect(area).toBe(dark);
    }
  });

  it('矩形から復元した格子が cells と一致する', () => {
    const m = buildQrMatrix(buildJanLines(janList(20), { eol: 'CRLF' }));
    const grid = rectsToGrid(m);
    for (let row = 0; row < m.count; row++) {
      for (let col = 0; col < m.count; col++) {
        expect(grid[row + m.margin]![col + m.margin]).toBe(m.cells[row]![col]);
      }
    }
  });

  it('静寂域は必ず白のまま', () => {
    const m = buildQrMatrix('4901777018686');
    const grid = rectsToGrid(m);
    for (let y = 0; y < m.size; y++) {
      for (let x = 0; x < m.size; x++) {
        const inside = x >= m.margin && x < m.margin + m.count && y >= m.margin && y < m.margin + m.count;
        if (!inside) expect(grid[y]![x]).toBe(false);
      }
    }
  });

  it('横方向のランはまとめられる（1セル1矩形より少ない）', () => {
    const m = buildQrMatrix(buildJanLines(janList(20), { eol: 'CRLF' }));
    const dark = m.cells.flat().filter(Boolean).length;
    expect(toQrRects(m).length).toBeLessThan(dark);
  });
});
