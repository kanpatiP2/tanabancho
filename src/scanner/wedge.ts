import type { OnCodeInput } from '@core/types';

/**
 * キーボードウェッジ入力。P1-C が本実装する（スタブ）。
 * document keydown をバッファし、Enter または 80ms 無入力+8桁以上で確定。
 * 先頭キーから 500ms 以内完結を要求して人間のタイプを除外。
 * input/textarea フォーカス中は無効。
 */
export function startWedgeListener(_onCode: OnCodeInput): () => void {
  return () => {};
}
