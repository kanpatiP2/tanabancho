import type { ScannerAdapter } from '@core/types';

/**
 * カメラスキャナ。P1-C が本実装する（スタブ）。
 * BarcodeDetector（Android Chrome）→ html5-qrcode フォールバックのアダプタを返す。
 */
export async function createScanner(): Promise<ScannerAdapter> {
  throw new Error('not implemented (P1-C)');
}
