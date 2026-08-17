/**
 * スキャン入力の合流点。カメラ / ウェッジ / 手入力をここで1本にまとめ、
 * 意図（ScanIntent）の切り替えは `@scanner/session` のステートマシンに委譲する。
 *
 * 責務分担:
 * - `@scanner/session` … intent の遷移・field の one-shot 復帰・期限提案の保留（純ロジック）
 * - `@scanner/camera`  … BarcodeDetector / html5-qrcode のアダプタ
 * - `@scanner/wedge`   … Bluetooth リーダーの keydown 組み立て
 * - このモジュール      … 上記3つと本体UI（signal / store）の結線だけ
 */
import { signal } from '@preact/signals';
import type { CodeSource, ResolvedCode, ScanIntent, ScannerAdapter, Settings } from '@core/types';
import { createScanner, type ScannerOptions } from '@scanner/camera';
import {
  createScanSession,
  type ExpiryCommitCause,
  type ExpiryPending,
  type ExpiryScanResult,
  type FieldScanEvent,
  type FieldTarget,
  type RejectEvent,
  type ScanEvent,
  type ScanInputResult,
} from '@scanner/session';
import { startWedgeListener } from '@scanner/wedge';
import { lookupJan, startLookupAutoFlush } from '@lookup/index';
import { boxJanLookup, isDuplicateJan, learnProduct, products, settings } from './store';

export const VIDEO_CONTAINER_ID = 'tb-camera';

export type CameraState = 'idle' | 'starting' | 'running' | 'unavailable';

export const cameraState = signal<CameraState>('idle');
export const cameraError = signal<string>('');
/** 現在のスキャン意図。モードチップと連動する（更新は setScanIntent 経由） */
export const scanIntent = signal<ScanIntent>('capture');
/** 期限モードで「次のスキャンで確定される」提案。UI が確定待ちを表示するために公開する */
export const pendingExpiry = signal<ExpiryPending | null>(null);

/**
 * 読み取り結果の受け口。期限モードのときだけ戻り値（次スキャンで確定する提案）を見る。
 * それ以外の intent では戻り値は無視される。
 */
export type CodeHandler = (r: ResolvedCode, source: CodeSource) => ExpiryScanResult | void;

let adapter: ScannerAdapter | null = null;
let handler: CodeHandler | null = null;
let duplicateHandler: ((r: ResolvedCode, source: CodeSource) => void) | null = null;
let expiryCommitHandler: ((pending: ExpiryPending, cause: ExpiryCommitCause) => void) | null = null;
let fieldHandler: ((ev: FieldScanEvent) => void) | null = null;
let rejectHandler: ((ev: RejectEvent) => void) | null = null;

// ---------------------------------------------------------------- セッション

/** intent 別の受け口はすべて同じハンドラへ流す（振り分けはタブ側が intent を見て行う） */
function forward(ev: ScanEvent): void {
  handler?.(ev.resolved, ev.source);
}

const session = createScanSession(
  {
    boxJanLookup,
    lookupProduct: (jan) => products.value[jan] ?? null,
    // 重複弾きはセッション側に集約する（履歴へ積む intent だけが対象）
    isDuplicate: (jan) => isDuplicateJan(jan),
    onCapture: forward,
    onExpiry: (ev) => handler?.(ev.resolved, ev.source) as ExpiryScanResult | undefined,
    onPop: forward,
    onOrder: forward,
    onCompCheck: forward,
    onField: (ev) => fieldHandler?.(ev),
    onDuplicate: (ev) => duplicateHandler?.(ev.resolved, ev.source),
    onExpiryCommit: (pendingItem, cause) => {
      expiryCommitHandler?.(pendingItem, cause);
      pendingExpiry.value = null;
    },
    onReject: (ev) => rejectHandler?.(ev),
    onIntentChange: (next) => {
      scanIntent.value = next;
      pendingExpiry.value = session.pendingExpiry;
    },
  },
  // v1 は1件読むごとにカメラを止めていたが、v2 は camera.ts の deduper が
  // 同一コードの連投を抑えるので流し読みを続けられる（止めたいときはタップで停止）
  { continuous: true, duplicateGuardIntents: ['capture', 'expiry', 'pop'] },
);

/** 読み取り結果の受け口を差し替える（タブ側が useEffect で登録する） */
export function setCodeHandler(fn: CodeHandler | null): void {
  handler = fn;
}

/** 重複で弾いたときの通知先（無言で捨てないための受け口） */
export function setDuplicateHandler(
  fn: ((r: ResolvedCode, source: CodeSource) => void) | null,
): void {
  duplicateHandler = fn;
}

/** 期限モードの保留提案が自動確定されたときの受け口 */
export function setExpiryCommitHandler(
  fn: ((pending: ExpiryPending, cause: ExpiryCommitCause) => void) | null,
): void {
  expiryCommitHandler = fn;
}

/** 保留中の期限提案を今すぐ確定する（モード終了・画面離脱時） */
export function flushPendingExpiry(): void {
  session.flushPendingExpiry();
  pendingExpiry.value = session.pendingExpiry;
}

/** 保留中の期限提案を破棄する（ユーザーが期限パッドで手入力したとき） */
export function cancelPendingExpiry(): void {
  session.cancelPendingExpiry();
  pendingExpiry.value = null;
}

/** field（箱JAN 登録・返品/客注/競合の JAN 欄など）の流し込み先 */
export function setFieldHandler(fn: ((ev: FieldScanEvent) => void) | null): void {
  fieldHandler = fn;
}

/** 空文字・URL などで受け付けなかったときの通知先 */
export function setRejectHandler(fn: ((ev: RejectEvent) => void) | null): void {
  rejectHandler = fn;
}

/** モードチップからの intent 切替。signal は onIntentChange 経由で更新される */
export function setScanIntent(intent: ScanIntent, opts?: { sticky?: boolean }): void {
  session.setIntent(intent, opts);
  pendingExpiry.value = session.pendingExpiry;
}

/** 現在のスキャン意図（signal を読めない場所から） */
export function currentScanIntent(): ScanIntent {
  return session.state.intent;
}

/** 1件だけ読み取って直前の intent に戻る流し込みを開始する */
export function beginFieldScan(target: FieldTarget): void {
  session.beginFieldScan(target);
}

export function cancelFieldScan(): void {
  session.cancelFieldScan();
}

/** 読み取り後もスキャナを止めないか（既定 false = 1件ごとに停止） */
export function setContinuousScan(continuous: boolean): void {
  session.setContinuous(continuous);
}

/**
 * 生コードを正規化して現在のハンドラに流す。カメラ・ウェッジ・手入力すべてここを通る。
 *
 * 戻り値は session の判定結果そのもの。`null` は「コードとして解釈できない」入力
 * （空・URL・記号混じり）だけで、重複弾きは `{ ok:false, reason:'duplicate' }` として返る
 * （呼び出し側がメッセージを出し分けられるようにするため）。
 */
export function dispatchCode(raw: string, source: CodeSource): ScanInputResult | null {
  const clean = String(raw ?? '').replace(/\s+/g, '');
  if (!clean) return null;
  // URL/記号混じりは弾く（legacy と同じガード）
  if (/^https?:/i.test(clean) || /[^0-9A-Za-z-]/.test(clean)) return null;
  const result = session.input(clean, source);
  pendingExpiry.value = session.pendingExpiry;
  return result;
}

// ---------------------------------------------------------------- カメラ

/** 設定 → スキャナオプション。プリセットは設定画面が fps/focus に展開済み */
export function cameraOptionsFromSettings(s: Settings): ScannerOptions {
  const fps = Number.isFinite(s.cameraFps) ? Math.min(30, Math.max(1, Math.trunc(s.cameraFps))) : 5;
  return {
    fps,
    focusMode: s.cameraFocusMode === 'continuous' ? 'continuous' : '',
    tall: s.tallBarcodeMode === true,
  };
}

function cameraUsable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof document !== 'undefined'
  );
}

/**
 * カメラが使えるかだけを確認する（起動はしない）。
 * getUserMedia が無い環境では 'unavailable' にして、UI を手入力へ寄せる。
 */
export async function probeCamera(): Promise<void> {
  if (cameraState.value !== 'idle') return;
  if (!cameraUsable()) {
    cameraState.value = 'unavailable';
    cameraError.value = 'この端末・ブラウザではカメラを利用できません（HTTPS でない場合もここに来ます）';
  }
}

/**
 * アダプタは画面が隠れると自前で止まる（camera.ts の visibilitychange）。
 * その分 cameraState が 'running' のまま取り残されるとタップ1回目が空振りするので、
 * こちらでも同じイベントを見て状態と adapter 参照を落とす。
 */
let onVisibility: (() => void) | null = null;

function watchVisibility(): void {
  if (onVisibility || typeof document === 'undefined') return;
  onVisibility = () => {
    if (document.hidden) void stopCamera();
  };
  document.addEventListener('visibilitychange', onVisibility);
}

function unwatchVisibility(): void {
  if (!onVisibility || typeof document === 'undefined') return;
  document.removeEventListener('visibilitychange', onVisibility);
  onVisibility = null;
}

/** 直近に使った video コンテナ（restartCamera が同じ器へ戻すため） */
let containerId = VIDEO_CONTAINER_ID;

export async function startCamera(target: string = VIDEO_CONTAINER_ID): Promise<void> {
  if (cameraState.value === 'running' || cameraState.value === 'starting') return;
  containerId = target;
  cameraState.value = 'starting';
  try {
    // 設定を反映するため毎回作り直す（fps / focusMode / 読取枠は生成時に決まる）
    adapter = await createScanner(cameraOptionsFromSettings(settings.value));
    await adapter.start(containerId, (raw) => dispatchCode(raw, 'camera'));
    watchVisibility();
    cameraState.value = 'running';
    cameraError.value = '';
  } catch (e) {
    adapter = null;
    cameraState.value = 'unavailable';
    cameraError.value = e instanceof Error ? e.message : String(e);
  }
}

export async function stopCamera(): Promise<void> {
  const current = adapter;
  adapter = null;
  unwatchVisibility();
  try {
    await current?.stop();
  } catch {
    /* 停止失敗は無視（すでに停止済み等） */
  }
  if (cameraState.value === 'running' || cameraState.value === 'starting') {
    cameraState.value = 'idle';
  }
}

export async function toggleCamera(target: string = VIDEO_CONTAINER_ID): Promise<void> {
  if (cameraState.value === 'running') await stopCamera();
  else await startCamera(target);
}

/** 設定変更（縦長切替・fps・フォーカス）を反映する。停止中なら何もしない */
export async function restartCamera(): Promise<void> {
  if (cameraState.value !== 'running') return;
  const target = containerId;
  await stopCamera();
  await startCamera(target);
}

// ---------------------------------------------------------------- ウェッジ

/** キーボードウェッジ。返り値は解除関数 */
export function attachWedge(): () => void {
  return startWedgeListener((code, source) => {
    dispatchCode(code, source);
  });
}

/** 端末の触覚フィードバック（対応端末のみ） */
export function feedback(ok: boolean): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  navigator.vibrate(ok ? 40 : [40, 60, 40]);
}

/**
 * 外部JAN照会のフック（`@lookup` への唯一の入口）。
 *
 * 失敗・オフライン・未ヒットはすべて null。呼び出し側（scan/draft.ts）は
 * 「名前が取れたときだけ辞書へ ext として学習する」ことだけ考えればよい。
 * オフライン時は `@lookup` 側でキューに積まれ、`attachLookupFlush()` が拾い直す。
 */
export async function lookupUnknownJan(jan: string): Promise<{ name: string } | null> {
  if (!jan) return null;
  try {
    const hit = await lookupJan(jan);
    return hit && hit.name ? { name: hit.name } : null;
  } catch {
    return null;
  }
}

/**
 * オンライン復帰時に照会キューを流す。戻り値は解除関数（App が useEffect で使う）。
 * ヒットした名前は ext として辞書に積む（既存の manual/gemini は上書きしない）。
 */
export function attachLookupFlush(): () => void {
  return startLookupAutoFlush((hits) => {
    for (const h of hits) {
      if (h.name) learnProduct(h.jan, { name: h.name, nameSource: 'ext' });
    }
  });
}
