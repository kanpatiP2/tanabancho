// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isEditableTarget, isWedgeChar, startWedgeListener } from './wedge';

/** 現在の仮想時刻（vi.setSystemTime + advanceTimersByTime に追随する） */
const now = () => Date.now();

/** 1打鍵。gap ms だけ時間を進めてから keydown を投げる */
function press(key: string, gap = 0, target: EventTarget = document.body) {
  if (gap > 0) vi.advanceTimersByTime(gap);
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** 文字列を一定間隔で打鍵する */
function type(text: string, gap: number, target: EventTarget = document.body) {
  for (const ch of text) press(ch, gap, target);
}

describe('isWedgeChar', () => {
  it('英数字1文字だけを受ける', () => {
    expect(isWedgeChar('4')).toBe(true);
    expect(isWedgeChar('a')).toBe(true);
    expect(isWedgeChar('Z')).toBe(true);
    expect(isWedgeChar('Enter')).toBe(false);
    expect(isWedgeChar('-')).toBe(false);
    expect(isWedgeChar('Shift')).toBe(false);
  });
});

describe('isEditableTarget', () => {
  it('入力系要素を検出する', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const div = document.createElement('div');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');

    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(textarea)).toBe(true);
    expect(isEditableTarget(select)).toBe(true);
    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(editable)).toBe(true);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('startWedgeListener', () => {
  let onCode: ReturnType<typeof vi.fn>;
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T00:00:00.000Z'));
    document.body.innerHTML = '';
    onCode = vi.fn();
    stop = startWedgeListener(onCode, { now });
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('速い打鍵 + Enter は採用する', () => {
    type('4901777018686', 5);
    press('Enter', 5);
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(onCode).toHaveBeenCalledWith('4901777018686', 'wedge');
  });

  it('Enter が無くても 80ms 無入力 + 8桁以上で確定する', () => {
    type('4901777018686', 5);
    expect(onCode).not.toHaveBeenCalled();
    vi.advanceTimersByTime(80);
    expect(onCode).toHaveBeenCalledWith('4901777018686', 'wedge');
  });

  it('8桁未満はタイムアウト確定しない（破棄）', () => {
    type('4901', 5);
    vi.advanceTimersByTime(200);
    expect(onCode).not.toHaveBeenCalled();
  });

  it('遅い打鍵（人間のタイプ）は破棄する', () => {
    type('4901777018686', 120); // 1文字 120ms → 500ms を大幅超過
    vi.advanceTimersByTime(200);
    expect(onCode).not.toHaveBeenCalled();
  });

  it('タイムアウトは免れても 500ms を超えた入力は Enter でも破棄する', () => {
    // 45ms 間隔 = 80ms の無入力タイムアウトには掛からないが、13桁で 540ms かかる
    type('4901777018686', 45);
    press('Enter', 5);
    expect(onCode).not.toHaveBeenCalled();
  });

  it('誤打鍵1文字 + Enter は拾わない', () => {
    press('9');
    press('Enter', 10);
    expect(onCode).not.toHaveBeenCalled();
  });

  it('input にフォーカスがあるときは素通し（手入力欄を邪魔しない）', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    type('4901777018686', 5, input);
    press('Enter', 5, input);
    vi.advanceTimersByTime(200);
    expect(onCode).not.toHaveBeenCalled();
  });

  it('textarea / contenteditable も素通し', () => {
    const ta = document.createElement('textarea');
    const ce = document.createElement('div');
    ce.setAttribute('contenteditable', 'true');
    document.body.append(ta, ce);
    type('49017770186', 5, ta);
    vi.advanceTimersByTime(200);
    type('49017770186', 5, ce);
    vi.advanceTimersByTime(200);
    expect(onCode).not.toHaveBeenCalled();
  });

  it('英数字以外のキーは無視してバッファを壊さない', () => {
    press('4');
    press('Shift', 5);
    press('ArrowLeft', 5);
    type('901777018686', 5);
    press('Enter', 5);
    expect(onCode).toHaveBeenCalledWith('4901777018686', 'wedge');
  });

  it('修飾キー付き（Ctrl+C 等）は拾わない', () => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }),
    );
    type('4901777018686', 5);
    press('Enter', 5);
    expect(onCode).toHaveBeenCalledWith('4901777018686', 'wedge');
  });

  it('連続スキャンを取りこぼさない', () => {
    type('4901777018686', 5);
    press('Enter', 5);
    vi.advanceTimersByTime(300);
    type('4902102072618', 5);
    press('Enter', 5);
    expect(onCode.mock.calls.map((c) => c[0])).toEqual(['4901777018686', '4902102072618']);
  });

  it('英字混じり（CODE128）も通す', () => {
    type('AB1234567', 5);
    press('Enter', 5);
    expect(onCode).toHaveBeenCalledWith('AB1234567', 'wedge');
  });

  it('解除関数を呼ぶと以後反応しない', () => {
    stop();
    type('4901777018686', 5);
    press('Enter', 5);
    vi.advanceTimersByTime(200);
    expect(onCode).not.toHaveBeenCalled();
  });

  it('解除後に保留中のタイマーが発火しない', () => {
    type('4901777018686', 5);
    stop();
    vi.advanceTimersByTime(200);
    expect(onCode).not.toHaveBeenCalled();
  });

  it('オプションで閾値を変更できる', () => {
    stop();
    const cb = vi.fn();
    stop = startWedgeListener(cb, { now, idleMs: 30, minLength: 4, maxSpanMs: 200 });
    type('1234', 5);
    vi.advanceTimersByTime(30);
    expect(cb).toHaveBeenCalledWith('1234', 'wedge');
  });
});
