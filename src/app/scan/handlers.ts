/**
 * スキャン1件を intent 別に処理する本体（DOM 非依存）。
 *
 * `scan-bridge`（＝ camera / wedge / 手入力の合流点）から渡ってくる正規化済みコードを、
 * 現在の intent に応じて draft / store のアクションへ振り分ける。UI 側の副作用
 * （トースト・期限パッド・触覚フィードバック）は `ScanUiHooks` として外から渡す。
 *
 * スキャンタブ（tsx）は「フックの実装」だけを持ち、判断はここに集約する。
 */
import { todayLocal } from '@core/datetime';
import type { ResolvedCode, ScanIntent } from '@core/types';
import type { ExpiryPending, ExpiryScanResult } from '@scanner/session';
import { competitors, products } from '../store';
import {
  addToOrder,
  applyExpiry,
  compPending,
  popDraft,
  registerScan,
  suggestExpiryFor,
} from './draft';

/** 期限パッドの対象 */
export interface ExpiryPadTarget {
  scanId: string;
  jan: string;
  name: string;
}

export interface ScanNotice {
  message: string;
  tone: 'ok' | 'warn';
  /** 指定があれば「今すぐ変更」導線（保留提案を取り消して期限パッドを開く）を出す */
  revise?: ExpiryPadTarget;
}

export interface ScanUiHooks {
  /** このスキャンを処理する intent（scan-bridge の signal を読む） */
  intent(): ScanIntent;
  /** 期限モード: 提案値を次スキャンで自動確定するか */
  autoExpiry(): boolean;
  feedback(ok: boolean): void;
  notify(notice: ScanNotice): void;
  openExpiryPad(target: ExpiryPadTarget): void;
}

/**
 * 1件のスキャンを処理する。戻り値は期限モードのときだけ意味を持ち、
 * 「次のスキャンで自動確定させたい提案」を session に預ける。
 */
export function handleScannedCode(
  resolved: ResolvedCode,
  ui: ScanUiHooks,
): ExpiryScanResult | void {
  switch (ui.intent()) {
    case 'expiry':
      return handleExpiryScan(resolved, ui);

    case 'pop': {
      const item = registerScan(resolved, { pop: popDraft.value });
      if (!item) return rejectDuplicate(ui);
      ui.feedback(true);
      ui.notify({ message: `POP付きで登録: ${item.jan}`, tone: 'ok' });
      return;
    }

    case 'order': {
      addToOrder(resolved.jan, 1);
      ui.feedback(true);
      ui.notify({ message: `発注リストに追加: ${resolved.jan}`, tone: 'ok' });
      return;
    }

    case 'compCheck': {
      const match = competitors.value.find((c) => c.jan === resolved.jan);
      const name = match?.name || products.value[resolved.jan]?.name || '';
      compPending.value = {
        jan: resolved.jan,
        name: name || '商品名不明',
        matched: Boolean(match),
        compId: match?.id ?? '',
      };
      ui.feedback(true);
      return;
    }

    default: {
      const item = registerScan(resolved);
      if (!item) return rejectDuplicate(ui);
      ui.feedback(true);
      return;
    }
  }
}

/**
 * 期限モード。期限は入れずに登録し、学習済みの提案値は「次のスキャンで確定」として預ける。
 * 提案が無い（または自動確定 OFF）ときは、その場で期限パッドを開く。
 */
function handleExpiryScan(resolved: ResolvedCode, ui: ScanUiHooks): ExpiryScanResult | void {
  const suggestion = suggestExpiryFor(resolved.jan, todayLocal());
  const item = registerScan(resolved, { expiry: '' });
  if (!item) return rejectDuplicate(ui);

  ui.feedback(true);
  const target: ExpiryPadTarget = { scanId: item.id, jan: item.jan, name: item.name };

  if (!ui.autoExpiry() || !suggestion) {
    ui.openExpiryPad(target);
    return;
  }

  ui.notify({ message: `提案 ${suggestion}（次のスキャンで確定）`, tone: 'ok', revise: target });
  return { pending: { id: item.id, jan: item.jan, expiry: suggestion, reason: '学習オフセット' } };
}

/**
 * 保留していた期限提案の自動確定（次スキャン / モード離脱 / 明示フラッシュ）。
 * session が呼ぶので、ここでは履歴への反映と通知だけ行う。
 */
export function handleExpiryCommit(pending: ExpiryPending, ui: ScanUiHooks): void {
  if (!pending.id || !pending.expiry) return;
  applyExpiry(pending.id, pending.expiry);
  ui.notify({ message: `期限 ${pending.expiry} を確定しました`, tone: 'ok' });
}

/** 重複で弾かれたとき（session の onDuplicate 経由）。無言で捨てない */
export function handleDuplicate(resolved: ResolvedCode, ui: ScanUiHooks): void {
  ui.feedback(false);
  ui.notify({ message: `リストに存在するコードです: ${resolved.jan}`, tone: 'warn' });
}

/** session の重複ガードをすり抜けた場合の保険（store 側の重複判定で null が返る） */
function rejectDuplicate(ui: ScanUiHooks): void {
  ui.feedback(false);
  ui.notify({ message: 'リストに存在するコードです', tone: 'warn' });
}
