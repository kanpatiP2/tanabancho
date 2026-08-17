import { describe, expect, it } from 'vitest';
import { addDays, diffDays, formatDateOnly, parseExpiryDigits, todayLocal } from './datetime';

describe('parseExpiryDigits', () => {
  const today = new Date(2026, 7, 17); // 2026-08-17

  it('4桁 MMDD は直近未来として解釈する', () => {
    expect(parseExpiryDigits('0821', today)).toBe('2026-08-21');
    expect(parseExpiryDigits('0110', today)).toBe('2027-01-10'); // 過ぎた月日は翌年
  });

  it('2桁 DD は当月/翌月で解釈する', () => {
    expect(parseExpiryDigits('21', today)).toBe('2026-08-21');
    expect(parseExpiryDigits('05', today)).toBe('2026-09-05'); // 過ぎた日は翌月
    expect(parseExpiryDigits('17', today)).toBe('2026-08-17'); // 当日は当日
  });

  it('不正入力は null', () => {
    expect(parseExpiryDigits('1332', today)).toBeNull();
    expect(parseExpiryDigits('0231', today)).toBeNull();
    expect(parseExpiryDigits('abc', today)).toBeNull();
  });
});

describe('date helpers', () => {
  it('addDays / diffDays', () => {
    expect(addDays('2026-08-17', 4)).toBe('2026-08-21');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(diffDays('2026-08-17', '2026-08-21')).toBe(4);
  });

  it('formatDateOnly / todayLocal', () => {
    expect(formatDateOnly('2026-08-05')).toBe('8/5');
    expect(todayLocal(new Date(2026, 0, 3))).toBe('2026-01-03');
  });
});
