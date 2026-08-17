import type { OnCodeInput } from '@core/types';

/**
 * キーボードウェッジ（Bluetooth バーコードリーダー）入力。
 *
 * リーダーは「英数字を高速に連打して Enter」という挙動なので、
 * 人間のタイプと区別するために時間で足切りする:
 * - 先頭キーから `maxSpanMs`(既定 500ms) 以内に完結しなければ破棄
 * - Enter で確定、または `idleMs`(既定 80ms) 無入力 かつ `minLength`(既定 8)桁以上で確定
 * - input / textarea / select / contenteditable にフォーカスがあるときは素通し
 */

export interface WedgeOptions {
  /** 無入力タイムアウト(ms)。既定 80 */
  idleMs?: number;
  /** 先頭キーから確定までの許容時間(ms)。既定 500 */
  maxSpanMs?: number;
  /** タイムアウト確定に必要な最小桁数。既定 8 */
  minLength?: number;
  /**
   * Enter 確定に必要な最小桁数。既定 4。
   * Enter は明示的な終端なので緩めるが、単発の誤打鍵 + Enter を拾わないよう下限は設ける。
   */
  minLengthOnEnter?: number;
  /** keydown を購読する対象。既定 document */
  target?: Pick<Document, 'addEventListener' | 'removeEventListener'>;
  /** テスト用の時計。既定 Date.now */
  now?: () => number;
}

export const WEDGE_DEFAULTS = {
  idleMs: 80,
  maxSpanMs: 500,
  minLength: 8,
  minLengthOnEnter: 4,
} as const;

/** 文字入力中の要素にフォーカスがあるか（あればウェッジは介入しない） */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Partial<HTMLElement>).tagName !== 'string') return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  // jsdom や古い環境で isContentEditable が未実装の場合の保険
  return el.getAttribute?.('contenteditable') === '' || el.getAttribute?.('contenteditable') === 'true';
}

/** ウェッジがバッファに積む文字か（英数字1文字のみ） */
export function isWedgeChar(key: string): boolean {
  return key.length === 1 && /[0-9A-Za-z]/.test(key);
}

/**
 * document keydown を購読してバーコードを組み立てる。
 * 確定すると `onCode(code, 'wedge')` を呼ぶ。戻り値は解除関数。
 */
export function startWedgeListener(onCode: OnCodeInput, opts: WedgeOptions = {}): () => void {
  const idleMs = opts.idleMs ?? WEDGE_DEFAULTS.idleMs;
  const maxSpanMs = opts.maxSpanMs ?? WEDGE_DEFAULTS.maxSpanMs;
  const minLength = opts.minLength ?? WEDGE_DEFAULTS.minLength;
  const minLengthOnEnter = opts.minLengthOnEnter ?? WEDGE_DEFAULTS.minLengthOnEnter;
  const now = opts.now ?? (() => Date.now());
  const target = opts.target ?? (typeof document !== 'undefined' ? document : null);
  if (!target) return () => {};

  let buffer = '';
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const discard = () => {
    clearTimer();
    buffer = '';
    startedAt = 0;
  };

  const commit = () => {
    const code = buffer;
    discard();
    if (code) onCode(code, 'wedge');
  };

  /** 無入力タイムアウト: minLength 以上かつ制限時間内なら確定、でなければ破棄 */
  const onIdle = () => {
    timer = null;
    if (buffer.length >= minLength && now() - startedAt <= maxSpanMs) {
      commit();
    } else {
      discard();
    }
  };

  const armIdle = () => {
    clearTimer();
    timer = setTimeout(onIdle, idleMs);
  };

  const handler = (ev: Event) => {
    const e = ev as KeyboardEvent;
    if (isEditableTarget(e.target)) return; // 素通し
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const t = now();

    if (e.key === 'Enter') {
      if (!buffer) return;
      const inTime = t - startedAt <= maxSpanMs;
      if (inTime && buffer.length >= minLengthOnEnter) {
        e.preventDefault();
        commit();
      } else {
        discard();
      }
      return;
    }

    if (!isWedgeChar(e.key)) return; // Shift / Tab / 矢印などは無視

    // 制限時間を超えていたら、このキーを新しい入力の先頭として仕切り直す
    if (buffer && t - startedAt > maxSpanMs) discard();

    if (!buffer) startedAt = t;
    buffer += e.key;
    armIdle();
  };

  target.addEventListener('keydown', handler, true); // capture でフォーム前に拾う

  return () => {
    clearTimer();
    buffer = '';
    target.removeEventListener('keydown', handler, true);
  };
}
