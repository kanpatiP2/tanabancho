/**
 * Gemini の読み取り結果 → ShiwakeState（items / carts）への変換。
 */

import { resolveCode } from '@core/jan';
import type { DateOnly, ShiwakeCart, ShiwakeItem } from '@core/types';
import { digitsOnly, isAlertName } from './text';
import type { GeminiSheet } from './gemini';

/** JAN13 チェックデジット */
export function janCheckDigit(base12: string): string {
  let sum = 0;
  for (let i = 0; i < base12.length; i++) {
    sum += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

/**
 * 明細上の生コード → JAN。
 *
 * 正規化の本実装は core/jan.ts（P1-C 担当）。まずそちらへ委譲し、
 * ITF-14 変換が未実装の間だけここでフォールバックする（v1 の itfToJan 相当）。
 * P1-C が resolveCode に ITF 変換を入れれば、このフォールバックは自然に無効化される。
 */
export function resolveShiwakeCode(raw: string): { jan: string; fromItf: boolean } {
  const digits = digitsOnly(raw);
  if (!digits) return { jan: '', fromItf: false };

  const resolved = resolveCode(digits);
  if (resolved.fromItf) return { jan: resolved.jan, fromItf: true };
  if (resolved.jan && resolved.jan !== digits) return { jan: resolved.jan, fromItf: false };

  if (digits.length === 14) {
    const base = digits.slice(1, 13);
    return { jan: base + janCheckDigit(base), fromItf: true };
  }
  if (digits.length === 12) return { jan: `0${digits}`, fromItf: false };
  return { jan: digits, fromItf: false };
}

/** Gemini が返す自由書式の納品日 → DateOnly（'YYYY-MM-DD' / 解釈不能は ''） */
export function normalizeDeliveryDate(raw: string, today: Date = new Date()): DateOnly {
  const s = digitsOnlyPreservingSeparators(raw);
  if (!s) return '';
  const pad = (n: number) => String(n).padStart(2, '0');

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;

  m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return `${today.getFullYear()}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;

  m = /^(\d{8})$/.exec(s);
  if (m) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

  return '';
}

function digitsOnlyPreservingSeparators(raw: string): string {
  return String(raw ?? '')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[年月]/g, '/')
    .replace(/日/g, '')
    .replace(/\s/g, '')
    .replace(/\/$/, '');
}

export function cartLabel(sheet: GeminiSheet, index: number): string {
  if (sheet.cartId) return `仕器${sheet.cartId}${sheet.store ? ` ${sheet.store}` : ''}`;
  if (sheet.store) return sheet.store;
  return `明細${sheet.sheetIndex || index + 1}`;
}

export interface BuildOptions {
  alertWords: readonly string[];
  /** テスト用の ID 生成差し替え */
  makeId?: () => string;
  today?: Date;
}

export interface BuiltSheets {
  items: ShiwakeItem[];
  carts: ShiwakeCart[];
  /** ITF-14 由来のコード（jan → 箱JAN の生コード）。辞書還流で boxJan として学習させる */
  boxJanByJan: Record<string, string>;
}

function defaultId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `si_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function buildFromSheets(sheets: readonly GeminiSheet[], opts: BuildOptions): BuiltSheets {
  const makeId = opts.makeId ?? defaultId;
  const items: ShiwakeItem[] = [];
  const carts: ShiwakeCart[] = [];
  const boxJanByJan: Record<string, string> = {};

  sheets.forEach((sheet, i) => {
    carts.push({
      index: i,
      label: cartLabel(sheet, i),
      deliveryDate: normalizeDeliveryDate(sheet.deliveryDate, opts.today),
    });
    for (const raw of sheet.items) {
      const { jan, fromItf } = resolveShiwakeCode(raw.code);
      if (fromItf && jan) boxJanByJan[jan] = digitsOnly(raw.code);
      items.push({
        id: makeId(),
        name: raw.name,
        code: digitsOnly(raw.code),
        jan,
        qtyPerCase: raw.qtyPerCase,
        cases: raw.cases,
        cartIndex: i,
        memo: '',
        isAlert: isAlertName(raw.name, opts.alertWords),
      });
    }
  });

  return { items, carts, boxJanByJan };
}

/** 要注意ワードの追加/削除後に既存の明細を再判定する */
export function reevaluateAlerts(items: readonly ShiwakeItem[], alertWords: readonly string[]): ShiwakeItem[] {
  return items.map((it) => {
    const isAlert = isAlertName(it.name, alertWords);
    return isAlert === it.isAlert ? it : { ...it, isAlert };
  });
}
