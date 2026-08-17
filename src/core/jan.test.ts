import { describe, expect, it } from 'vitest';
import {
  barcodeFormat,
  digitsOnly,
  ean8CheckDigit,
  isValidJan,
  itfToJan,
  janCheckDigit,
  resolveCode,
} from './jan';

describe('janCheckDigit', () => {
  it('実在 JAN のチェックデジットを再現する', () => {
    // 4901777018686（サントリー）/ 4912345678904（GS1 説明用）/ 4902102072618
    expect(janCheckDigit('490177701868')).toBe(6);
    expect(janCheckDigit('491234567890')).toBe(4);
    expect(janCheckDigit('490210207261')).toBe(8);
  });

  it('合計が10の倍数なら 0', () => {
    expect(janCheckDigit('000000000000')).toBe(0);
  });

  it('12桁でなければ例外', () => {
    expect(() => janCheckDigit('12345')).toThrow(RangeError);
    expect(() => janCheckDigit('49017770186')).toThrow(RangeError);
    expect(() => janCheckDigit('49017770186a')).toThrow(RangeError);
  });
});

describe('ean8CheckDigit', () => {
  it('EAN-8 の重み（3,1,3,...）で計算する', () => {
    expect(ean8CheckDigit('9638507')).toBe(4); // 96385074
    expect(ean8CheckDigit('4512345')).toBe(0); // 45123450
  });

  it('7桁でなければ例外', () => {
    expect(() => ean8CheckDigit('963850')).toThrow(RangeError);
  });
});

describe('isValidJan', () => {
  it('正しい JAN13 を受理する', () => {
    expect(isValidJan('4901777018686')).toBe(true);
    expect(isValidJan('4912345678904')).toBe(true);
    expect(isValidJan('4902102072618')).toBe(true);
  });

  it('チェックデジット違いの JAN13 を弾く', () => {
    expect(isValidJan('4901777018680')).toBe(false);
    expect(isValidJan('4912345678900')).toBe(false);
  });

  it('EAN-8 を検証する', () => {
    expect(isValidJan('96385074')).toBe(true);
    expect(isValidJan('45123450')).toBe(true);
    expect(isValidJan('96385070')).toBe(false);
    expect(isValidJan('45123456')).toBe(false);
  });

  it('不正な桁数・非数字は false', () => {
    expect(isValidJan('')).toBe(false);
    expect(isValidJan('49017770186')).toBe(false); // 11桁
    expect(isValidJan('490177701868')).toBe(false); // 12桁（UPC-A は対象外）
    expect(isValidJan('14901777018683')).toBe(false); // 14桁（ITF）
    expect(isValidJan('490177701868a')).toBe(false);
  });
});

describe('itfToJan', () => {
  it('ITF-14 → JAN13（先頭1桁落とし+チェックデジット再計算）', () => {
    expect(itfToJan('14901777018683')).toBe('4901777018686');
    expect(itfToJan('24901777018680')).toBe('4901777018686'); // インジケータ違いでも同じバラJAN
    expect(itfToJan('04912345678904')).toBe('4912345678904');
  });

  it('生成した JAN13 は必ずチェックデジット検証を通る', () => {
    for (const indicator of ['0', '1', '2', '5', '9']) {
      const jan = itfToJan(`${indicator}490210207261${indicator}`);
      expect(jan).not.toBeNull();
      expect(isValidJan(jan!)).toBe(true);
    }
  });

  it('区切り文字を含んでいても数字だけ拾う', () => {
    expect(itfToJan('1-4901777-018683')).toBe('4901777018686');
  });

  it('13桁/12桁/8桁は仕分番長 v1 と同じ正規化', () => {
    expect(itfToJan('4901777018686')).toBe('4901777018686');
    expect(itfToJan('490177701868')).toBe('0490177701868'); // UPC-A → 先頭0補完
    expect(itfToJan('96385074')).toBe('96385074');
  });

  it('扱えない桁数は null', () => {
    expect(itfToJan('')).toBeNull();
    expect(itfToJan('12345')).toBeNull();
    expect(itfToJan('123456789012345')).toBeNull();
  });
});

describe('digitsOnly', () => {
  it('数字以外を除去する', () => {
    expect(digitsOnly(' 4901-777 018686 ')).toBe('4901777018686');
    expect(digitsOnly('abc')).toBe('');
  });
});

describe('resolveCode', () => {
  it('通常の JAN13 はそのまま通る', () => {
    const r = resolveCode('4901777018686');
    expect(r).toEqual({
      jan: '4901777018686',
      raw: '4901777018686',
      fromItf: false,
      fromBoxJan: false,
      leadingZero: false,
    });
  });

  it('14桁は ITF 変換して fromItf を立てる', () => {
    const r = resolveCode('14901777018683');
    expect(r.jan).toBe('4901777018686');
    expect(r.fromItf).toBe(true);
    expect(r.fromBoxJan).toBe(false);
    expect(r.raw).toBe('14901777018683');
  });

  it('箱JAN 学習からバラJAN に置換する', () => {
    const lookup = (code: string) => (code === '4901777018686' ? '4902102072618' : null);
    const r = resolveCode('4901777018686', lookup);
    expect(r.jan).toBe('4902102072618');
    expect(r.fromBoxJan).toBe(true);
    expect(r.fromItf).toBe(false);
  });

  it('ITF 変換 → 箱JAN 置換 の順に適用される', () => {
    const lookup = (code: string) => (code === '4901777018686' ? '4902102072618' : null);
    const r = resolveCode('14901777018683', lookup);
    expect(r.jan).toBe('4902102072618');
    expect(r.fromItf).toBe(true);
    expect(r.fromBoxJan).toBe(true);
  });

  it('lookup が同じコードを返した場合は fromBoxJan を立てない', () => {
    const r = resolveCode('4901777018686', (c) => c);
    expect(r.fromBoxJan).toBe(false);
  });

  it('先頭 0 を検出する', () => {
    expect(resolveCode('0490177701868').leadingZero).toBe(true);
    expect(resolveCode('4901777018686').leadingZero).toBe(false);
  });

  it('convertItf:false で ITF 変換を抑制できる（箱JAN 欄への流し込み用）', () => {
    const r = resolveCode('14901777018683', undefined, { convertItf: false });
    expect(r.jan).toBe('14901777018683');
    expect(r.fromItf).toBe(false);
  });

  it('数字以外を除去する', () => {
    expect(resolveCode(' 4901 777-018686 ').jan).toBe('4901777018686');
  });

  it('数字を含まないコードは生のまま返す（社内コードを壊さない）', () => {
    const r = resolveCode('ABC-XYZ');
    expect(r.jan).toBe('ABC-XYZ');
  });
});

describe('barcodeFormat', () => {
  it('桁数でフォーマットを判定する', () => {
    expect(barcodeFormat('4901777018686')).toBe('EAN13');
    expect(barcodeFormat('96385074')).toBe('EAN8');
    expect(barcodeFormat('490177701868')).toBe('UPC');
    expect(barcodeFormat('ABC123')).toBe('CODE128');
  });
});
