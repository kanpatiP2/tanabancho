/**
 * スキャン入力の薄い呼び出し層。
 *
 * P1-C の `src/scanner/session.ts`（ステートマシン本体）がまだ無いため、
 * `@core/types` の ScanIntent / OnCodeInput / ScannerAdapter だけに依存した
 * 差し替え可能なブリッジをここに置く。session.ts が入ったら
 * `attachCamera` / `dispatchCode` の中身を委譲に置き換えるだけで済む。
 *
 * - createScanner() は現在 throw する（P1-C 未実装）→ 例外を握って
 *   `cameraState` を 'unavailable' にし、UI はプレースホルダ＋手入力に落ちる
 */
import { signal } from '@preact/signals';
import type { CodeSource, ResolvedCode, ScanIntent, ScannerAdapter } from '@core/types';
import { resolveCode } from '@core/jan';
import { createScanner } from '@scanner/camera';
import { startWedgeListener } from '@scanner/wedge';
import { boxJanLookup } from './store';

export const VIDEO_CONTAINER_ID = 'tb-camera';

export type CameraState = 'idle' | 'starting' | 'running' | 'unavailable';

export const cameraState = signal<CameraState>('idle');
export const cameraError = signal<string>('');
/** 現在のスキャン意図。モードチップと連動する */
export const scanIntent = signal<ScanIntent>('capture');

let adapter: ScannerAdapter | null = null;
let handler: ((r: ResolvedCode, source: CodeSource) => void) | null = null;

/** 読み取り結果の受け口を差し替える（タブ側が useEffect で登録する） */
export function setCodeHandler(fn: ((r: ResolvedCode, source: CodeSource) => void) | null): void {
  handler = fn;
}

/** 生コードを正規化して現在のハンドラに流す。手入力もここを通す */
export function dispatchCode(raw: string, source: CodeSource): ResolvedCode | null {
  const clean = raw.replace(/\s+/g, '');
  if (!clean) return null;
  // URL/記号混じりは弾く（legacy と同じガード）
  if (/^https?:/i.test(clean) || /[^0-9A-Za-z-]/.test(clean)) return null;
  const resolved = resolveCode(clean, boxJanLookup);
  handler?.(resolved, source);
  return resolved;
}

/**
 * カメラが使えるかだけを確認する（起動はしない）。
 * P1-C 未実装のうちは createScanner が throw するので 'unavailable' になり、
 * UI は最初からプレースホルダ＋手入力を出せる。
 */
export async function probeCamera(): Promise<void> {
  if (cameraState.value !== 'idle' || adapter) return;
  try {
    adapter = await createScanner();
  } catch (e) {
    cameraState.value = 'unavailable';
    cameraError.value = e instanceof Error ? e.message : String(e);
  }
}

export async function startCamera(): Promise<void> {
  if (cameraState.value === 'running' || cameraState.value === 'starting') return;
  cameraState.value = 'starting';
  try {
    adapter = adapter ?? (await createScanner());
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
  try {
    await adapter?.stop();
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

/** キーボードウェッジ。返り値は解除関数 */
export function attachWedge(): () => void {
  return startWedgeListener(((code: string, source: CodeSource) => {
    dispatchCode(code, source);
  }) as Parameters<typeof startWedgeListener>[0]);
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
