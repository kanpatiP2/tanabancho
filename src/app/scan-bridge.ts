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
  type FieldScanEvent,
  type FieldTarget,
  type RejectEvent,
  type ScanEvent,
} from '@scanner/session';
import { startWedgeListener } from '@scanner/wedge';
import { boxJanLookup, products, settings } from './store';

export const VIDEO_CONTAINER_ID = 'tb-camera';

export type CameraState = 'idle' | 'starting' | 'running' | 'unavailable';

export const cameraState = signal<CameraState>('idle');
export const cameraError = signal<string>('');
/** 現在のスキャン意図。モードチップと連動する（更新は setScanIntent 経由） */
export const scanIntent = signal<ScanIntent>('capture');

let adapter: ScannerAdapter | null = null;
let handler: ((r: ResolvedCode, source: CodeSource) => void) | null = null;
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
    onCapture: forward,
    onExpiry: forward,
    onPop: forward,
    onOrder: forward,
    onCompCheck: forward,
    onField: (ev) => fieldHandler?.(ev),
    onReject: (ev) => rejectHandler?.(ev),
    onIntentChange: (next) => {
      scanIntent.value = next;
    },
  },
  // v1 は1件読むごとにカメラを止めていたが、v2 は camera.ts の deduper が
  // 同一コードの連投を抑えるので流し読みを続けられる（止めたいときはタップで停止）
  { continuous: true },
);

/** 読み取り結果の受け口を差し替える（タブ側が useEffect で登録する） */
export function setCodeHandler(fn: ((r: ResolvedCode, source: CodeSource) => void) | null): void {
  handler = fn;
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

/** 生コードを正規化して現在のハンドラに流す。カメラ・ウェッジ・手入力すべてここを通る */
export function dispatchCode(raw: string, source: CodeSource): ResolvedCode | null {
  const clean = String(raw ?? '').replace(/\s+/g, '');
  if (!clean) return null;
  // URL/記号混じりは弾く（legacy と同じガード）
  if (/^https?:/i.test(clean) || /[^0-9A-Za-z-]/.test(clean)) return null;
  const result = session.input(clean, source);
  return result.ok ? result.resolved : null;
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

export async function startCamera(): Promise<void> {
  if (cameraState.value === 'running' || cameraState.value === 'starting') return;
  cameraState.value = 'starting';
  try {
    // 設定を反映するため毎回作り直す（fps / focusMode / 読取枠は生成時に決まる）
    adapter = await createScanner(cameraOptionsFromSettings(settings.value));
    await adapter.start(VIDEO_CONTAINER_ID, (raw) => dispatchCode(raw, 'camera'));
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
  try {
    await current?.stop();
  } catch {
    /* 停止失敗は無視（すでに停止済み等） */
  }
  if (cameraState.value === 'running' || cameraState.value === 'starting') {
    cameraState.value = 'idle';
  }
}

export async function toggleCamera(): Promise<void> {
  if (cameraState.value === 'running') await stopCamera();
  else await startCamera();
}

/** 設定変更（縦長切替・fps・フォーカス）を反映する。停止中なら何もしない */
export async function restartCamera(): Promise<void> {
  if (cameraState.value !== 'running') return;
  await stopCamera();
  await startCamera();
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
 * 外部JAN照会のフック。P3 の `src/lookup/` が入ったらここを差し替える。
 * 現状は常に null（未登録のまま）を返す。
 */
export async function lookupUnknownJan(_jan: string): Promise<{ name: string } | null> {
  return null;
}
