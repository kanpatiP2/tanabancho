/**
 * スキャン画面の「下書き」状態と登録処理。
 * 描画（tsx）からは signal を読むだけにし、データ変更はこのモジュールのアクション経由にする。
 */
import { computed, signal } from '@preact/signals';
import { addDays, diffDays, nowIso, todayLocal } from '@core/datetime';
import { suggestExpiryOffset } from '@core/dict';
import type { PopDetail, PopEnlarge, ResolvedCode, ScanItem } from '@core/types';
import { lookupUnknownJan } from '../scan-bridge';
import {
  addScan,
  bumpOrderLine,
  emptyScan,
  ensureActiveOrderList,
  isDuplicateJan,
  learnExpiryOffset,
  learnProduct,
  orderLists,
  products,
  scans,
  stamp,
  touchProduct,
  updateScan,
} from '../store';

// ---------------------------------------------------------------- 通常モードの下書き

export interface CaptureDraft {
  name: string;
  end: boolean;
  order: string[];
  genre: string;
  memo: string;
  /** 📌 維持: 登録後も内容を保持する */
  keep: boolean;
}

export const captureDraft = signal<CaptureDraft>({
  name: '',
  end: false,
  order: [],
  genre: '',
  memo: '',
  keep: false,
});

export function patchCapture(patch: Partial<CaptureDraft>): void {
  captureDraft.value = { ...captureDraft.value, ...patch };
}

export function toggleCaptureOrder(type: string): void {
  const cur = captureDraft.value.order;
  patchCapture({ order: cur.includes(type) ? cur.filter((o) => o !== type) : [...cur, type] });
}

function resetCaptureAfterRegister(): void {
  const d = captureDraft.value;
  if (d.keep) {
    // 維持モード: 商品名だけクリア（legacy と同じ挙動）
    captureDraft.value = { ...d, name: '' };
  } else {
    captureDraft.value = { name: '', end: false, order: [], genre: '', memo: '', keep: false };
  }
}

// ---------------------------------------------------------------- POP モードの下書き

export const popDraft = signal<PopDetail[]>([]);

export function togglePopSize(size: string): void {
  const cur = popDraft.value;
  const found = cur.find((p) => p.size === size);
  if (found) popDraft.value = cur.filter((p) => p.size !== size);
  else popDraft.value = [...cur, { size, qty: 1, lami: false, enlarge: '', assignee: '' }];
}

export function patchPop(size: string, patch: Partial<PopDetail>): void {
  popDraft.value = popDraft.value.map((p) => (p.size === size ? { ...p, ...patch } : p));
}

export function setPopAll(details: PopDetail[]): void {
  popDraft.value = details.map((p) => ({ ...p }));
}

export function clearPop(): void {
  popDraft.value = [];
}

/** 現在の組合せの 1 行サマリ */
export const popSummary = computed(() => {
  const d = popDraft.value;
  if (!d.length) return '未選択';
  return d
    .map((p) => {
      const parts = [p.qty > 1 ? `${p.size}x${p.qty}` : p.size];
      if (p.lami) parts.push('ラミ');
      if (p.enlarge) parts.push(p.enlarge);
      if (p.assignee) parts.push(`→${p.assignee}`);
      return parts.join(' ');
    })
    .join(' / ');
});

// ---------------------------------------------------------------- 直近スキャン結果

export interface FlashResult {
  jan: string;
  raw: string;
  name: string;
  /** 辞書ヒット */
  known: boolean;
  scanId: string;
  fromBoxJan: boolean;
  fromItf: boolean;
  at: string;
}

export const flash = signal<FlashResult | null>(null);

/** 期限モードの「直前と同じ」用 */
export const lastExpiry = signal<string>('');

// ---------------------------------------------------------------- 登録

export interface RegisterOptions {
  expiry?: string;
  pop?: PopDetail[];
  genreOverride?: string;
  nameOverride?: string;
}

/**
 * 履歴へ 1 件登録する。重複 JAN はスキップして null を返す。
 * 学習辞書への反映（名前・箱JAN・期限オフセット）もここで行う。
 */
export function registerScan(resolved: ResolvedCode, opts: RegisterOptions = {}): ScanItem | null {
  if (isDuplicateJan(resolved.jan)) return null;

  const draft = captureDraft.value;
  const db = products.value[resolved.jan];
  const name = (opts.nameOverride ?? draft.name).trim() || db?.name || '';

  const item: ScanItem = {
    ...emptyScan(resolved.jan),
    name,
    memo: draft.memo,
    genre: opts.genreOverride ?? draft.genre,
    end: draft.end,
    pop: (opts.pop ?? []).map((p) => ({ ...p })),
    order: [...draft.order],
    expiry: opts.expiry ?? '',
    boxJan: db?.boxJan ?? '',
  };
  addScan(item);

  if (name && !db?.name) learnProduct(resolved.jan, { name, nameSource: 'manual' });
  else touchProduct(resolved.jan);
  if (item.expiry) {
    learnExpiryOffset(resolved.jan, diffDays(todayLocal(new Date(item.createdAt)), item.expiry));
    lastExpiry.value = item.expiry;
  }

  flash.value = {
    jan: resolved.jan,
    raw: resolved.raw,
    name,
    known: Boolean(db?.name || name),
    scanId: item.id,
    fromBoxJan: resolved.fromBoxJan,
    fromItf: resolved.fromItf,
    at: nowIso(),
  };
  resetCaptureAfterRegister();

  // 名前が分からないときだけ外部DBへ投げる（登録自体は待たせない）
  if (!name && externalLookupEnabled()) void resolveNameExternally(item.id, resolved.jan);

  return item;
}

/**
 * 外部照会を走らせてよい環境か。ブラウザでだけ有効にする。
 * 後追いで UI を書き換えるのが目的の機能なので、UI が無い環境
 * （Node のユニットテスト等）で勝手にネットワークへ出ないようにする。
 */
function externalLookupEnabled(): boolean {
  return typeof window !== 'undefined';
}

/**
 * 未知JANの外部照会。スキャン登録の裏で走らせ、取れたら後追いで反映する。
 *
 * 反映先は3つ。いずれも「ユーザーが既に入れた値は壊さない」ことを守る:
 *   1. 学習辞書 … nameSource 'ext'（core/dict.mergeProduct が manual/gemini を守る）
 *   2. 履歴の該当行 … 名前がまだ空のときだけ埋める
 *   3. 結果フラッシュカード … 表示中がその件のままのときだけ差し替える
 */
async function resolveNameExternally(scanId: string, jan: string): Promise<void> {
  let hit: { name: string } | null = null;
  try {
    hit = await lookupUnknownJan(jan);
  } catch {
    return; // 照会失敗は黙って諦める（キュー投入は @lookup 側の責務）
  }
  const name = hit?.name.trim();
  if (!name) return;

  learnProduct(jan, { name, nameSource: 'ext' });

  const current = scans.value.find((s) => s.id === scanId);
  if (current && !current.name.trim()) updateScan(scanId, { name });

  const f = flash.value;
  if (f && f.scanId === scanId && !f.name) {
    flash.value = { ...f, name, known: true };
  }
}

/** 期限だけ後から確定する（期限パッド / 次スキャンでの自動確定） */
export function applyExpiry(scanId: string, expiry: string): void {
  const item = scans.value.find((s) => s.id === scanId);
  if (!item) return;
  updateScan(scanId, { expiry });
  if (!expiry) return;
  lastExpiry.value = expiry;
  // 学習無効の行からはオフセットを学ばない（core/dict.learnFromScan と同じ約束）
  if (item.noLearn) return;
  learnExpiryOffset(item.jan, diffDays(todayLocal(new Date(item.createdAt)), expiry));
}

/** 辞書の学習済みオフセットから期限の提案値を出す。無ければ null */
export function suggestExpiryFor(jan: string, today = todayLocal()): string | null {
  const offsets = products.value[jan]?.expiryOffsets ?? [];
  const off = suggestExpiryOffset(offsets);
  return off === null ? null : addDays(today, off);
}

// ---------------------------------------------------------------- 発注モード

/** 発注モードで操作中のリスト ID */
export const activeOrderListId = signal<string>('');

/**
 * 発注リストを用意して ID を返す（未作成なら当日ラベルで作成）。
 * キャッシュした ID が実在しない場合（削除・バックアップ取込など）は作り直す。
 */
export function ensureOrderList(): string {
  const cached = activeOrderListId.value;
  if (cached && orderLists.value.some((o) => o.id === cached)) return cached;
  const list = ensureActiveOrderList(todayLocal());
  activeOrderListId.value = list.id;
  return list.id;
}

/** 同一 JAN の再スキャンは数量 +1 */
export function addToOrder(jan: string, delta = 1): void {
  bumpOrderLine(ensureOrderList(), jan, delta);
}

// ---------------------------------------------------------------- 競合対抗確認

export interface CompCheckPending {
  jan: string;
  name: string;
  matched: boolean;
  compId: string;
}

export const compPending = signal<CompCheckPending | null>(null);

/** 対抗確認の履歴投入（genre は '競合ヘッダー' 固定） */
export function addCompCheckToHistory(pending: CompCheckPending): ScanItem | null {
  if (isDuplicateJan(pending.jan)) return null;
  const item: ScanItem = {
    ...emptyScan(pending.jan),
    ...stamp(),
    name: pending.name,
    genre: '競合ヘッダー',
  };
  addScan(item);
  compPending.value = null;
  return item;
}
