import type { ResolvedCode } from './types';

/**
 * バーコード正規化。P1-C が本実装する（スタブ）。
 * - ITF-14 → JAN13（チェックデジット再計算）
 * - 箱JAN → バラJAN（辞書照合は呼び出し側から boxJanLookup を渡す）
 */
export function resolveCode(raw: string, boxJanLookup?: (code: string) => string | null): ResolvedCode {
  const jan = boxJanLookup?.(raw) ?? raw;
  return {
    jan,
    raw,
    fromItf: false,
    fromBoxJan: jan !== raw,
    leadingZero: jan.startsWith('0'),
  };
}

/** JAN13 チェックデジット検証。P1-C が本実装する（スタブ） */
export function isValidJan(code: string): boolean {
  return /^\d{8}$|^\d{13}$/.test(code);
}

/** JsBarcode 用フォーマット判定 */
export function barcodeFormat(code: string): 'EAN13' | 'EAN8' | 'UPC' | 'CODE128' {
  if (/^\d{13}$/.test(code)) return 'EAN13';
  if (/^\d{8}$/.test(code)) return 'EAN8';
  if (/^\d{12}$/.test(code)) return 'UPC';
  return 'CODE128';
}
