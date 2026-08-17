/**
 * v1 仕分番長（sb_* キー）からの初回取込。**読み取り専用**。旧キーは残置する。
 *
 * NOTE: ARCHITECTURE.md では LEGACY_KEYS の読み取りは core/migrate.ts 経由と定めているが、
 * migrate.ts は P1-A の作業中でまだ存在しない。仕分番長固有の sb_* だけをここで扱い、
 * migrate.ts 完成後に P1-A へ移管する想定（読み取りのみ・破壊操作なし）。
 */

import { readJson, readRaw } from '@core/storage';
import { LEGACY_KEYS, type ShiwakeCart, type ShiwakeItem, type ShiwakeState } from '@core/types';
import { nowIso } from '@core/datetime';
import { normalizeDeliveryDate, resolveShiwakeCode } from './build';
import { digitsOnly, isAlertName } from './text';

interface LegacyItem {
  name?: unknown;
  code?: unknown;
  jan?: unknown;
  qty_per_case?: unknown;
  cases?: unknown;
  cartIndex?: unknown;
  memo?: unknown;
}

interface LegacyCart {
  index?: unknown;
  label?: unknown;
  delivery_date?: unknown;
}

export interface LegacyMemoEntry {
  date: string;
  text: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `si_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** 旧 localStorage の Gemini APIキー（永続保存分のみ） */
export function readLegacyApiKey(): string | null {
  const raw = readRaw(LEGACY_KEYS.sbApiKey);
  return raw && raw.trim() ? raw.trim() : null;
}

export function readLegacyBinMemo(): string {
  return readRaw(LEGACY_KEYS.sbGlobalMemo) ?? '';
}

export function readLegacyMemoHistory(): LegacyMemoEntry[] {
  const raw = readJson<unknown>(LEGACY_KEYS.sbMemoHistory);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => {
      const r = e as Record<string, unknown> | null;
      return { date: str(r?.['date']), text: str(r?.['text']) };
    })
    .filter((e) => e.text !== '');
}

/**
 * sb_items / sb_carts / sb_alert_words から ShiwakeState を組み立てる。
 * 取り込むものが何も無ければ null。
 */
export function readLegacyShiwakeState(makeId: () => string = newId): ShiwakeState | null {
  const rawItems = readJson<unknown>(LEGACY_KEYS.sbItems);
  const rawCarts = readJson<unknown>(LEGACY_KEYS.sbCarts);
  const rawWords = readJson<unknown>(LEGACY_KEYS.sbAlertWords);

  const alertWords = Array.isArray(rawWords)
    ? [...new Set(rawWords.map(str).filter((w) => w !== ''))]
    : [];

  const carts: ShiwakeCart[] = Array.isArray(rawCarts)
    ? rawCarts.map((c, i) => {
        const r = c as LegacyCart | null;
        return {
          index: num(r?.index) ?? i,
          label: str(r?.label) || `明細${i + 1}`,
          deliveryDate: normalizeDeliveryDate(str(r?.delivery_date)),
        };
      })
    : [];

  const items: ShiwakeItem[] = Array.isArray(rawItems)
    ? rawItems
        .map((it) => {
          const r = it as LegacyItem | null;
          const name = str(r?.name);
          if (!name) return null;
          const code = digitsOnly(str(r?.code));
          const jan = digitsOnly(str(r?.jan)) || resolveShiwakeCode(code).jan;
          return {
            id: makeId(),
            name,
            code,
            jan,
            qtyPerCase: num(r?.qty_per_case),
            cases: num(r?.cases) ?? 0,
            cartIndex: num(r?.cartIndex) ?? 0,
            memo: str(r?.memo),
            isAlert: isAlertName(name, alertWords),
          } satisfies ShiwakeItem;
        })
        .filter((i): i is ShiwakeItem => i !== null)
    : [];

  if (!items.length && !carts.length && !alertWords.length) return null;
  return { items, carts, alertWords, updatedAt: nowIso() };
}
