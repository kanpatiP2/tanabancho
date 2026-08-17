/**
 * 仕分番長のテキスト正規化。
 * v1 の toKatakana / normalizeForSearch をそのまま移植し、
 * 全角数字の正規化（JAN 検索の既知バグ修正）を追加した。
 */

/** ひらがな → カタカナ（U+3041〜U+3096 のみ。「ゝ」等の繰返し記号は対象外） */
export function toKatakana(str: string): string {
  return String(str ?? '').replace(/[ぁ-ゖ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60),
  );
}

/** 全角数字（U+FF10〜U+FF19）→ 半角数字 */
export function normalizeDigits(str: string): string {
  return String(str ?? '').replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

/** 検索用正規化（ひらがな・カタカナ・全角数字・大文字小文字を吸収） */
export function normalizeForSearch(str: string): string {
  return normalizeDigits(toKatakana(str)).toLowerCase();
}

/** 検索クエリから数字だけを抜き出す（JAN 部分一致用。全角数字も拾う） */
export function digitsOnly(str: string): string {
  return normalizeDigits(str).replace(/\D/g, '');
}

/**
 * 要注意ワード照合。商品名・ワードともカタカナ正規化してから部分一致。
 * v1 は toKatakana のみだったが、大小文字も吸収するよう normalizeForSearch に統一した。
 */
export function isAlertName(name: string, alertWords: readonly string[]): boolean {
  if (!alertWords.length) return false;
  const target = normalizeForSearch(name);
  if (!target) return false;
  return alertWords.some((w) => {
    const nw = normalizeForSearch(w);
    return nw !== '' && target.includes(nw);
  });
}
