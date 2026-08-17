import { describe, expect, it } from 'vitest';
import { digitsOnly, isAlertName, normalizeDigits, normalizeForSearch, toKatakana } from './text';

describe('toKatakana', () => {
  it('ひらがなをカタカナに変換する', () => {
    expect(toKatakana('どん兵衛')).toBe('ドン兵衛');
    expect(toKatakana('やきそば')).toBe('ヤキソバ');
  });

  it('濁点・小書き文字も変換する', () => {
    expect(toKatakana('ぎゅうにゅう')).toBe('ギュウニュウ');
    expect(toKatakana('ぱん')).toBe('パン');
  });

  it('カタカナ・英数字・漢字はそのまま', () => {
    expect(toKatakana('UFO 焼そば 123')).toBe('UFO 焼ソバ 123');
    expect(toKatakana('カップヌードル')).toBe('カップヌードル');
  });

  it('空文字を壊さない', () => {
    expect(toKatakana('')).toBe('');
  });
});

describe('normalizeDigits', () => {
  it('全角数字を半角にする', () => {
    expect(normalizeDigits('４９０１７７７')).toBe('4901777');
  });
  it('半角はそのまま', () => {
    expect(normalizeDigits('4901777')).toBe('4901777');
  });
});

describe('normalizeForSearch', () => {
  it('ひらがな・大文字・全角数字を吸収する', () => {
    expect(normalizeForSearch('どんべえ')).toBe(normalizeForSearch('ドンベエ'));
    expect(normalizeForSearch('UFO')).toBe(normalizeForSearch('ufo'));
    expect(normalizeForSearch('４９０')).toBe('490');
  });
});

describe('digitsOnly', () => {
  it('全角込みの入力から数字だけを抜く', () => {
    expect(digitsOnly('JAN ４９０-１２３')).toBe('490123');
    expect(digitsOnly('なし')).toBe('');
  });
});

describe('isAlertName', () => {
  it('ひらがな登録でカタカナ商品名にヒットする', () => {
    expect(isAlertName('日清 ドンベエ きつね', ['どんべえ'])).toBe(true);
  });

  it('カタカナ登録でひらがな商品名にもヒットする', () => {
    expect(isAlertName('にっしん どんべえ', ['ドンベエ'])).toBe(true);
  });

  it('大文字小文字を区別しない', () => {
    expect(isAlertName('日清焼そば ufo', ['UFO'])).toBe(true);
  });

  it('無関係な商品はヒットしない', () => {
    expect(isAlertName('カップヌードル', ['どんべえ', 'UFO'])).toBe(false);
  });

  it('ワード未登録・空ワードでは常に false', () => {
    expect(isAlertName('どんべえ', [])).toBe(false);
    expect(isAlertName('どんべえ', ['', '  '])).toBe(false);
  });
});
