import { resolveCode } from '@core/jan';
import type {
  CodeSource,
  DateOnly,
  ISODateTime,
  Product,
  ResolvedCode,
  ScanIntent,
} from '@core/types';

/**
 * スキャン意図（scanIntent）ステートマシン。DOM に依存しない純ロジック。
 *
 * v1 は「グローバル5フラグ」でスキャン先を切り替えていた:
 *   activeSideScanType('return'|'cust') / activeCompScan / activeBoxJanScanId /
 *   isCompCheckMode / どれでもない＝通常登録
 * v2 ではこれを ScanIntent 1本 + field の one-shot ターゲットで表現する。
 *
 * | v1                          | v2                                                        |
 * |-----------------------------|-----------------------------------------------------------|
 * | 通常（フラグなし）           | intent 'capture'                                          |
 * | isCompCheckMode = true      | setIntent('compCheck')（sticky。抜けるまで継続）           |
 * | activeBoxJanScanId = id     | beginFieldScan({ kind:'boxJan', id, applyBoxJanLookup:false }) |
 * | activeCompScan = true       | beginFieldScan({ kind:'compJan' })                        |
 * | activeSideScanType='return' | beginFieldScan({ kind:'returnJan', convertItf:false, applyBoxJanLookup:false }) |
 * | activeSideScanType='cust'   | beginFieldScan({ kind:'custJan', convertItf:false, applyBoxJanLookup:false }) |
 *
 * field は one-shot。1件読み取ると直前の intent へ自動復帰する。
 */

// ---------------------------------------------------------------- ターゲット

/** field スキャンの流し込み先 */
export interface FieldTarget {
  /** 入力先の種別。UI 側の識別子（'boxJan' | 'compJan' | 'returnJan' | 'custJan' など任意） */
  kind: string;
  /** 対象レコードの id（箱JAN 登録時の ScanItem.id 等） */
  id?: string;
  /** 14桁を ITF-14 として JAN13 に変換する。既定 true */
  convertItf?: boolean;
  /** 箱JAN→バラJAN の学習置換を適用する。既定 true（箱JAN 自体を登録する場合は false） */
  applyBoxJanLookup?: boolean;
}

// ---------------------------------------------------------------- イベント

/** intent 別ハンドラに渡る共通ペイロード */
export interface ScanEvent {
  /** 正規化済みコード（= resolved.jan） */
  jan: string;
  /** 読み取った生コード */
  raw: string;
  resolved: ResolvedCode;
  source: CodeSource;
  /** handlers.lookupProduct の結果。未登録なら null */
  product: Product | null;
  /** このスキャンを処理した intent */
  intent: ScanIntent;
  /** 処理後もスキャンを継続してよいか（false ならカメラを止める） */
  continuous: boolean;
}

export interface FieldScanEvent extends ScanEvent {
  intent: 'field';
  target: FieldTarget;
  /** この field スキャン完了後に復帰する intent */
  returnTo: ScanIntent;
}

export interface RejectEvent {
  raw: string;
  source: CodeSource;
  intent: ScanIntent;
  reason: RejectReason;
}

export type RejectReason = 'empty' | 'url' | 'duplicate';

// ---------------------------------------------------------------- 期限モード

/**
 * 期限モードの保留提案。
 * onExpiry がこれを返すと「提案表示中」の状態になり、
 * 次のスキャン（または flushPendingExpiry / intent 変更）で自動確定される。
 */
export interface ExpiryPending {
  /** 対象 ScanItem の id。新規登録前なら '' */
  id: string;
  jan: string;
  /** 提案した期限 'YYYY-MM-DD' */
  expiry: DateOnly;
  /** 提案の根拠（学習オフセット等）。UI 表示用の任意情報 */
  reason?: string;
}

/** 保留提案が自動確定された理由 */
export type ExpiryCommitCause = 'next-scan' | 'intent-change' | 'flush';

/** onExpiry の戻り値。省略（void）は「保留なし」と同じ */
export interface ExpiryScanResult {
  /** 次スキャンで自動確定させたい提案。null / 未指定なら保留しない */
  pending?: ExpiryPending | null;
}

// ---------------------------------------------------------------- ハンドラ

/**
 * UI（P1-D）が実装する差し込み口。すべて任意。
 * lookupProduct / isDuplicate / boxJanLookup は**同期**で呼ばれる。
 */
export interface ScanSessionHandlers {
  /** 既に履歴に存在するか。true なら intent ハンドラを呼ばず onDuplicate だけ呼ぶ */
  isDuplicate?: (jan: string, ev: Omit<ScanEvent, 'product'>) => boolean;
  /** 学習辞書の照合（同期）。未登録なら null / undefined */
  lookupProduct?: (jan: string) => Product | null | undefined;
  /** 箱JAN → バラJAN の逆引き（同期）。無ければ null */
  boxJanLookup?: (code: string) => string | null;

  /** 通常登録 */
  onCapture?: (ev: ScanEvent) => void;
  /** 期限入力モード。戻り値で次スキャン自動確定の提案を預ける */
  onExpiry?: (ev: ScanEvent) => ExpiryScanResult | void;
  /** POP 一括付与モード */
  onPop?: (ev: ScanEvent) => void;
  /** 発注リスト積み上げモード */
  onOrder?: (ev: ScanEvent) => void;
  /** 競合対抗確認モード */
  onCompCheck?: (ev: ScanEvent) => void;
  /** 単発のフィールド流し込み（箱JAN 登録・返品/客注/競合の JAN 欄など） */
  onField?: (ev: FieldScanEvent) => void;

  /** 保留していた期限提案の自動確定 */
  onExpiryCommit?: (pending: ExpiryPending, cause: ExpiryCommitCause) => void;
  /** 重複で弾いたとき */
  onDuplicate?: (ev: ScanEvent) => void;
  /** 空文字・URL などで受け付けなかったとき */
  onReject?: (ev: RejectEvent) => void;
  /** intent が変わったとき（UI のモードバー更新用） */
  onIntentChange?: (intent: ScanIntent, previous: ScanIntent) => void;
}

// ---------------------------------------------------------------- 状態

export interface ScanSessionLast {
  jan: string;
  raw: string;
  source: CodeSource;
  intent: ScanIntent;
  at: ISODateTime;
}

export interface ScanSessionState {
  intent: ScanIntent;
  /** 読み取り後もスキャナを止めないか */
  continuous: boolean;
  /** field 中のみ非 null */
  fieldTarget: FieldTarget | null;
  /** 読み取り後も intent を保持するか（false なら1件で前の intent に戻る） */
  sticky: boolean;
  /** 直前に受理した入力 */
  last: ScanSessionLast | null;
}

export interface ScanSessionOptions {
  /** 初期 intent。既定 'capture' */
  intent?: ScanIntent;
  /** 初期の連続スキャン設定。既定 false（v1 は1件ごとにカメラ停止） */
  continuous?: boolean;
  /** 重複判定を働かせる intent。既定 ['capture']（v1 の checkAndRegister 相当） */
  duplicateGuardIntents?: ScanIntent[];
  /** テスト用の時計 */
  now?: () => Date;
}

export interface ScanInputResult {
  /** intent ハンドラまで到達したか */
  ok: boolean;
  reason?: RejectReason;
  jan: string;
  resolved: ResolvedCode;
  /** 処理した intent（復帰前の値） */
  intent: ScanIntent;
  /** 処理後もスキャンを続けてよいか */
  continuous: boolean;
}

export interface ScanSession {
  /** 現在状態のスナップショット */
  readonly state: Readonly<ScanSessionState>;
  /** 保留中の期限提案 */
  readonly pendingExpiry: ExpiryPending | null;
  /** カメラ/ウェッジ/手入力すべての合流点 */
  input(code: string, source: CodeSource): ScanInputResult;
  setIntent(intent: ScanIntent, opts?: { sticky?: boolean }): void;
  /** one-shot のフィールド流し込みを開始。完了で直前の intent へ復帰 */
  beginFieldScan(target: FieldTarget): void;
  /** field を中断して復帰する */
  cancelFieldScan(): void;
  setContinuous(continuous: boolean): void;
  /** 保留中の期限提案を今すぐ確定する（モード終了ボタン等） */
  flushPendingExpiry(): void;
  /** 保留中の期限提案を破棄する */
  cancelPendingExpiry(): void;
  /** 初期状態へ戻す（ハンドラは呼ばない） */
  reset(): void;
}

const URL_LIKE = /^(https?:|www\.)/i;

export function createScanSession(
  handlers: ScanSessionHandlers = {},
  options: ScanSessionOptions = {},
): ScanSession {
  const initialIntent: ScanIntent = options.intent ?? 'capture';
  const initialContinuous = options.continuous ?? false;
  const duplicateGuard = new Set<ScanIntent>(options.duplicateGuardIntents ?? ['capture']);
  const now = options.now ?? (() => new Date());

  let intent: ScanIntent = initialIntent;
  let continuous = initialContinuous;
  let sticky = true;
  let fieldTarget: FieldTarget | null = null;
  let returnTo: ScanIntent = initialIntent;
  let last: ScanSessionLast | null = null;
  let pendingExpiry: ExpiryPending | null = null;

  function snapshot(): ScanSessionState {
    return {
      intent,
      continuous,
      fieldTarget: fieldTarget ? { ...fieldTarget } : null,
      sticky,
      last: last ? { ...last } : null,
    };
  }

  function commitPendingExpiry(cause: ExpiryCommitCause): void {
    const p = pendingExpiry;
    if (!p) return;
    pendingExpiry = null;
    handlers.onExpiryCommit?.(p, cause);
  }

  function changeIntent(next: ScanIntent): void {
    if (next === intent) return;
    const previous = intent;
    // 期限モードから完全に抜けるときは保留提案を確定しておく（v1 の「次で自動確定」の外周）。
    // field は一時的な割り込みなので、行きも帰りも確定しない。
    if (next !== 'expiry' && next !== 'field') commitPendingExpiry('intent-change');
    intent = next;
    handlers.onIntentChange?.(next, previous);
  }

  function setIntent(next: ScanIntent, opts?: { sticky?: boolean }): void {
    if (next === 'field') {
      throw new Error("createScanSession: use beginFieldScan() instead of setIntent('field')");
    }
    const nextSticky = opts?.sticky ?? true;
    // sticky:false は「1件だけこの intent で読んで元に戻る」なので、復帰先は現在の intent
    returnTo = nextSticky ? next : intent === 'field' ? returnTo : intent;
    fieldTarget = null;
    sticky = nextSticky;
    changeIntent(next);
  }

  function beginFieldScan(target: FieldTarget): void {
    // field 中に別の field を始めても復帰先は最初の intent を保つ
    if (intent !== 'field') returnTo = intent;
    fieldTarget = { ...target };
    sticky = false;
    changeIntent('field');
  }

  function restoreFromField(): void {
    fieldTarget = null;
    sticky = true;
    changeIntent(returnTo);
  }

  function cancelFieldScan(): void {
    if (intent !== 'field') return;
    restoreFromField();
  }

  function reject(raw: string, source: CodeSource, reason: RejectReason, resolved: ResolvedCode): ScanInputResult {
    handlers.onReject?.({ raw, source, intent, reason });
    return { ok: false, reason, jan: resolved.jan, resolved, intent, continuous };
  }

  function input(code: string, source: CodeSource): ScanInputResult {
    const raw = String(code ?? '').replace(/\s+/g, '');
    const processedIntent = intent;
    const target = fieldTarget;

    if (!raw) {
      const empty: ResolvedCode = { jan: '', raw, fromItf: false, fromBoxJan: false, leadingZero: false };
      return reject(raw, source, 'empty', empty);
    }
    if (URL_LIKE.test(raw)) {
      const urlish: ResolvedCode = { jan: raw, raw, fromItf: false, fromBoxJan: false, leadingZero: false };
      return reject(raw, source, 'url', urlish);
    }

    // --- 1. 正規化（field は流し込み先に応じて変換を抑制できる）
    const convertItf = processedIntent === 'field' ? target?.convertItf !== false : true;
    const useBoxJan = processedIntent === 'field' ? target?.applyBoxJanLookup !== false : true;
    const resolved = resolveCode(raw, useBoxJan ? handlers.boxJanLookup : undefined, { convertItf });

    const baseEvent = {
      jan: resolved.jan,
      raw,
      resolved,
      source,
      intent: processedIntent,
      continuous: processedIntent === 'field' ? false : continuous,
    };

    // --- 2. 重複判定
    if (duplicateGuard.has(processedIntent) && handlers.isDuplicate?.(resolved.jan, baseEvent)) {
      const product = handlers.lookupProduct?.(resolved.jan) ?? null;
      handlers.onDuplicate?.({ ...baseEvent, product });
      // 重複でも intent / field は消費しない（同じモードのまま読み直せる）
      return { ok: false, reason: 'duplicate', jan: resolved.jan, resolved, intent: processedIntent, continuous };
    }

    // --- 3. 辞書照合（同期）
    const product = handlers.lookupProduct?.(resolved.jan) ?? null;
    const ev: ScanEvent = { ...baseEvent, product };

    // --- 4. intent 別に振り分け
    if (processedIntent === 'field') {
      const t: FieldTarget = target ?? { kind: '' };
      const fieldEvent: FieldScanEvent = { ...ev, intent: 'field', target: t, returnTo };
      handlers.onField?.(fieldEvent);
      last = { jan: resolved.jan, raw, source, intent: 'field', at: now().toISOString() };
      restoreFromField(); // one-shot
      return { ok: true, jan: resolved.jan, resolved, intent: 'field', continuous: false };
    }

    switch (processedIntent) {
      case 'capture':
        handlers.onCapture?.(ev);
        break;
      case 'expiry': {
        // 前回の提案をこのスキャンで自動確定してから、新しいコードを処理する
        commitPendingExpiry('next-scan');
        const result = handlers.onExpiry?.(ev);
        pendingExpiry = result?.pending ?? null;
        break;
      }
      case 'pop':
        handlers.onPop?.(ev);
        break;
      case 'order':
        handlers.onOrder?.(ev);
        break;
      case 'compCheck':
        handlers.onCompCheck?.(ev);
        break;
    }

    last = { jan: resolved.jan, raw, source, intent: processedIntent, at: now().toISOString() };

    if (!sticky) {
      sticky = true;
      changeIntent(returnTo);
    }

    return { ok: true, jan: resolved.jan, resolved, intent: processedIntent, continuous: ev.continuous };
  }

  return {
    get state() {
      return snapshot();
    },
    get pendingExpiry() {
      return pendingExpiry ? { ...pendingExpiry } : null;
    },
    input,
    setIntent,
    beginFieldScan,
    cancelFieldScan,
    setContinuous(v: boolean) {
      continuous = v;
    },
    flushPendingExpiry() {
      commitPendingExpiry('flush');
    },
    cancelPendingExpiry() {
      pendingExpiry = null;
    },
    reset() {
      intent = initialIntent;
      continuous = initialContinuous;
      sticky = true;
      fieldTarget = null;
      returnTo = initialIntent;
      last = null;
      pendingExpiry = null;
    },
  };
}
