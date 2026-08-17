import type { ScanItem, ShareEnvelopeV2 } from './types';

/**
 * 共有URLプロトコル。P1-B が本実装する（スタブ）。
 * リポジトリ内で唯一の encode/decode 実装とすること。
 */

export function encodeShareData(_items: ScanItem[]): string {
  throw new Error('not implemented (P1-B)');
}

/** v2 → v1 slim → btoa の三段フォールバック。復号後は必ずバリデーションを通す */
export function decodeShareData(_encoded: string): ShareEnvelopeV2 {
  throw new Error('not implemented (P1-B)');
}
