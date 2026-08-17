import type { ResolvedCode } from './types';

/**
 * バーコード（JAN/EAN/ITF）正規化ユーティリティ。
 *
 * v1 の `tryConvertITFtoJAN`（legacy/index.html）と `itfToJan` / `janCheck`
 * （legacy/shiwake/index.html）を統合したもの。桁数の扱いは仕分番長版が正。
 */

/** 数字以外を除去する */
export function digitsOnly(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '');
}

/**
 * JAN13 / EAN-13 のチェックデジット（モジュラス10 ウェイト3）。
 * 先頭12桁を渡す。左から奇数桁が ×1、偶数桁が ×3。
 * 12桁の数字でない場合は例外を投げる。
 */
export function janCheckDigit(digits12: string): number {
  if (!/^\d{12}$/.test(digits12)) {
    throw new RangeError(`janCheckDigit expects 12 digits, got: ${digits12}`);
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(digits12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * EAN-8 のチェックデジット（モジュラス10 ウェイト3）。
 * 先頭7桁を渡す。左から ×3, ×1, ×3, ... の順（JAN13 とは位相が逆）。
 */
export function ean8CheckDigit(digits7: string): number {
  if (!/^\d{7}$/.test(digits7)) {
    throw new RangeError(`ean8CheckDigit expects 7 digits, got: ${digits7}`);
  }
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += Number(digits7[i]) * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * JAN/EAN のチェックデジット検証。
 * - 13桁: JAN13/EAN-13 として検証
 * - 8桁 : EAN-8 として検証
 * - それ以外の桁数・数字以外を含む文字列は false
 */
export function isValidJan(code: string): boolean {
  const c = String(code ?? '');
  if (/^\d{13}$/.test(c)) {
    return janCheckDigit(c.slice(0, 12)) === Number(c[12]);
  }
  if (/^\d{8}$/.test(c)) {
    return ean8CheckDigit(c.slice(0, 7)) === Number(c[7]);
  }
  return false;
}

/**
 * ITF-14（集合包装用商品コード）→ JAN13。
 *
 * 14桁は先頭1桁（インジケータ）を落とした12桁にチェックデジットを再計算して付す。
 * 仕分番長 v1 と同じく、それ以外の桁数も実用上の正規化として受ける:
 * - 13桁 → そのまま（既に JAN13）
 * - 12桁 → 先頭に '0' を補って JAN13（UPC-A）
 * - 8桁  → そのまま（EAN-8）
 * - 上記以外 → null
 */
export function itfToJan(code14: string): string | null {
  const c = digitsOnly(code14);
  if (c.length === 14) {
    const base = c.slice(1, 13);
    return base + String(janCheckDigit(base));
  }
  if (c.length === 13) return c;
  if (c.length === 12) return '0' + c;
  if (c.length === 8) return c;
  return null;
}

/** resolveCode の挙動調整（既定はすべて有効） */
export interface ResolveCodeOptions {
  /** 14桁を ITF-14 とみなして JAN13 に変換する（既定 true）。箱JAN そのものを登録したい場合も true 想定 */
  convertItf?: boolean;
}

/**
 * カメラ / ウェッジ / 手入力から来た生コードを正規化する。合流点はここ一箇所。
 *
 * 1. 数字以外を除去
 * 2. 14桁なら ITF-14 → JAN13 変換（fromItf）
 * 3. boxJanLookup があれば 箱JAN → バラJAN 置換（fromBoxJan）
 * 4. 先頭が '0' かを判定（leadingZero。v1 で確認ダイアログを出していた条件）
 *
 * 数字が1桁も含まれない場合は生コードをそのまま jan として返す（英数字の社内コード等を壊さないため）。
 */
export function resolveCode(
  raw: string,
  boxJanLookup?: (code: string) => string | null,
  opts?: ResolveCodeOptions,
): ResolvedCode {
  const rawStr = String(raw ?? '');
  const digits = digitsOnly(rawStr);

  let jan = digits || rawStr.trim();
  let fromItf = false;
  let fromBoxJan = false;

  if (opts?.convertItf !== false && digits.length === 14) {
    const converted = itfToJan(digits);
    if (converted) {
      jan = converted;
      fromItf = true;
    }
  }

  if (boxJanLookup) {
    const linked = boxJanLookup(jan);
    if (linked && linked !== jan) {
      jan = linked;
      fromBoxJan = true;
    }
  }

  return {
    jan,
    raw: rawStr,
    fromItf,
    fromBoxJan,
    leadingZero: jan.startsWith('0'),
  };
}

/** JsBarcode 用フォーマット判定 */
export function barcodeFormat(code: string): 'EAN13' | 'EAN8' | 'UPC' | 'CODE128' {
  if (/^\d{13}$/.test(code)) return 'EAN13';
  if (/^\d{8}$/.test(code)) return 'EAN8';
  if (/^\d{12}$/.test(code)) return 'UPC';
  return 'CODE128';
}
