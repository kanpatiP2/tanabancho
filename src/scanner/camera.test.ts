import { describe, expect, it } from 'vitest';
import {
  BD_FORMATS,
  DEFAULT_DEDUPE_MS,
  buildVideoConstraints,
  createDeduper,
  frameIntervalMs,
  qrboxDimensions,
  shouldSample,
} from './camera';

describe('frameIntervalMs', () => {
  it('fps から 1フレームの間隔を出す', () => {
    expect(frameIntervalMs(5)).toBe(200);
    expect(frameIntervalMs(10)).toBe(100);
  });

  it('不正な fps は毎フレーム扱い（0ms）', () => {
    expect(frameIntervalMs(0)).toBe(0);
    expect(frameIntervalMs(-3)).toBe(0);
    expect(frameIntervalMs(Number.NaN)).toBe(0);
  });
});

describe('shouldSample', () => {
  it('初回は必ずサンプルする', () => {
    expect(shouldSample(null, 0, 5)).toBe(true);
  });

  it('fps=5 なら 200ms 未満は間引く', () => {
    expect(shouldSample(1000, 1100, 5)).toBe(false);
    expect(shouldSample(1000, 1199, 5)).toBe(false);
    expect(shouldSample(1000, 1200, 5)).toBe(true);
    expect(shouldSample(1000, 1500, 5)).toBe(true);
  });

  it('fps=10 なら 100ms 間隔', () => {
    expect(shouldSample(1000, 1099, 10)).toBe(false);
    expect(shouldSample(1000, 1100, 10)).toBe(true);
  });
});

describe('qrboxDimensions', () => {
  it('横長モードは 85% x 40%', () => {
    expect(qrboxDimensions(400, 300, false)).toEqual({ width: 340, height: 120 });
  });

  it('縦長モードは 40% x 85%', () => {
    expect(qrboxDimensions(400, 300, true)).toEqual({ width: 160, height: 255 });
  });
});

describe('createDeduper', () => {
  it('同一コードは既定 1.5秒 弾く', () => {
    const d = createDeduper();
    expect(DEFAULT_DEDUPE_MS).toBe(1500);
    expect(d.accept('4901777018686', 0)).toBe(true);
    expect(d.accept('4901777018686', 500)).toBe(false);
    expect(d.accept('4901777018686', 1499)).toBe(false);
    expect(d.accept('4901777018686', 1500)).toBe(true);
  });

  it('読み続けても期限は延長されない（離して読み直せる）', () => {
    const d = createDeduper(1000);
    expect(d.accept('A', 0)).toBe(true);
    expect(d.accept('A', 400)).toBe(false);
    expect(d.accept('A', 800)).toBe(false);
    expect(d.accept('A', 1000)).toBe(true);
  });

  it('別コードは即座に受理する', () => {
    const d = createDeduper(1500);
    expect(d.accept('A', 0)).toBe(true);
    expect(d.accept('B', 10)).toBe(true);
    expect(d.accept('A', 20)).toBe(true); // 直前が B なので A は通る
  });

  it('reset で履歴を捨てる', () => {
    const d = createDeduper(1500);
    expect(d.accept('A', 0)).toBe(true);
    expect(d.accept('A', 100)).toBe(false);
    d.reset();
    expect(d.accept('A', 100)).toBe(true);
  });
});

describe('buildVideoConstraints', () => {
  it('背面カメラを既定にする', () => {
    expect(buildVideoConstraints({})).toEqual({ facingMode: 'environment' });
  });

  it('focusMode 指定時のみ advanced constraints を積む', () => {
    expect(buildVideoConstraints({ focusMode: 'continuous' })).toEqual({
      facingMode: 'environment',
      advanced: [{ focusMode: 'continuous' }],
    });
    expect(buildVideoConstraints({ focusMode: '' })).toEqual({ facingMode: 'environment' });
  });
});

describe('BD_FORMATS', () => {
  it('v1 と同じ 4 フォーマット', () => {
    expect([...BD_FORMATS]).toEqual(['ean_13', 'ean_8', 'code_128', 'itf']);
  });
});
