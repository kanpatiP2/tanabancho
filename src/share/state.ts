/**
 * 共有ビューの状態。UI から localStorage / URL を直接触らないための唯一の窓口。
 *
 * 軽量維持のため import 可能なのは preact / @preact/signals / @core/* のみ。
 * （gemini・lookup・order-export は共有ビューに載せない）
 */
import { signal } from '@preact/signals';
import { resolveCode } from '@core/jan';
import { decodeShareDataDetailed, extractDataParam } from '@core/share-codec';
import { getCollection, readJson, writeJson } from '@core/storage';
import type { ScanItem, Settings, ShareEnvelopeV2 } from '@core/types';

// ---------------------------------------------------------------- キー

/** 共有ビューが自前でスキャンした分。本体の受信キャッシュ（KEYS.shareRecv）とは別物 */
export const SHARE_SCAN_KEY = 'tb.share.v2.scanned';
/** カメラ詳細設定（共有ビュー専用。本体の tb.v2.settings は上書きしない） */
export const SHARE_CAMERA_KEY = 'tb.share.v2.camera';

interface ScannedStore {
  v: 1;
  /** v1 由来のスキャン（migrate が KEYS.shareRecv へ変換したもの）を引き継ぎ済みか */
  legacyImported: boolean;
  items: ScanItem[];
}

// ---------------------------------------------------------------- 型

export type ShareTab = 'scan' | 'send' | 'recv';

export interface ShareCameraSettings {
  preset: Settings['cameraPreset'];
  fps: Settings['cameraFps'];
  focusMode: Settings['cameraFocusMode'];
  /** 縦長バーコード向けの読取枠 */
  tall: Settings['tallBarcodeMode'];
}

export const CAMERA_PRESETS: Record<
  Settings['cameraPreset'],
  { label: string; desc: string; fps: number; focusMode: Settings['cameraFocusMode'] }
> = {
  default: { label: 'デフォルト', desc: 'FPS: 5 / AF: 指定なし（ライブラリ既定値）', fps: 5, focusMode: '' },
  fast: { label: '読取最優先', desc: 'FPS: 10 / AF: continuous（ピンボケ改善・読取速度アップ）', fps: 10, focusMode: 'continuous' },
  custom: { label: 'カスタム', desc: '', fps: 10, focusMode: 'continuous' },
};

// ---------------------------------------------------------------- シグナル

export const tab = signal<ShareTab>('scan');
export const scanned = signal<ScanItem[]>([]);
export const received = signal<ShareEnvelopeV2 | null>(null);
export const receiveError = signal<string>('');
export const receiveWarnings = signal<number>(0);
export const camera = signal<ShareCameraSettings>({ preset: 'default', fps: 5, focusMode: '', tall: false });
export const isLineOnIos = signal<boolean>(false);

// ---------------------------------------------------------------- トースト（confirm/alert の代替）

export interface ToastState {
  key: number;
  message: string;
  tone: 'info' | 'warn';
  undoLabel?: string;
  onUndo?: () => void;
}

export const toast = signal<ToastState | null>(null);
let toastKey = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string, opts: { tone?: 'info' | 'warn'; undoLabel?: string; onUndo?: () => void } = {}): void {
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastKey += 1;
  toast.value = {
    key: toastKey,
    message,
    tone: opts.tone ?? 'info',
    undoLabel: opts.undoLabel,
    onUndo: opts.onUndo,
  };
  const ms = opts.onUndo ? 7000 : 2800;
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, ms);
}

export function dismissToast(): void {
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toast.value = null;
}

// ---------------------------------------------------------------- 小道具

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `sh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeScanItem(jan: string, createdAt: string, legacyId?: string, approx = false): ScanItem {
  return {
    id: newId(),
    createdAt,
    updatedAt: createdAt,
    ...(legacyId ? { _legacyId: legacyId } : {}),
    ...(approx ? { _approxDate: true } : {}),
    jan,
    name: '',
    memo: '',
    genre: '',
    end: false,
    pop: [],
    order: [],
    expiry: '',
    boxJan: '',
    protected: false,
    noLearn: true,
  };
}

// ---------------------------------------------------------------- 永続化

function persistScanned(legacyImported = true): void {
  const store: ScannedStore = { v: 1, legacyImported, items: scanned.value };
  if (!writeJson(SHARE_SCAN_KEY, store)) {
    showToast('保存容量が足りません。不要な件数を消去してください', { tone: 'warn' });
  }
}

/**
 * v1 の共有ツールが書いていたキー（tanabancho_share / sellfloor_share）は
 * **core/migrate.ts が KEYS.shareRecv へ変換済み**。ここではその結果を読むだけで、
 * LEGACY_KEYS には一切触れない（取込の実装を二重に持たない）。
 */
function inheritedScans(): ScanItem[] {
  const out: ScanItem[] = [];
  const seen = new Set<string>();
  for (const item of getCollection('shareRecv')) {
    const jan = typeof item?.jan === 'string' ? item.jan.trim() : '';
    if (!jan || seen.has(jan)) continue;
    seen.add(jan);
    const createdAt =
      typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : new Date().toISOString();
    out.push(makeScanItem(jan, createdAt, item._legacyId, item._approxDate === true));
  }
  return out;
}

let initialized = false;

/** 起動時の読み込み。冪等 */
export function initShareState(): void {
  if (initialized) return;
  initialized = true;

  const store = readJson<ScannedStore>(SHARE_SCAN_KEY);
  const items = store && Array.isArray(store.items) ? store.items.filter(isScanItemLike) : [];
  scanned.value = items;

  if (!store || store.legacyImported !== true) {
    const existing = new Set(items.map((i) => i.jan));
    const fresh = inheritedScans().filter((i) => !existing.has(i.jan));
    if (fresh.length > 0) {
      scanned.value = [...fresh, ...items];
      showToast(`旧バージョンのスキャン ${fresh.length}件を引き継ぎました`);
    }
    persistScanned(true);
  }

  const stored = readJson<Partial<ShareCameraSettings>>(SHARE_CAMERA_KEY);
  if (stored) {
    const preset = stored.preset === 'fast' || stored.preset === 'custom' ? stored.preset : 'default';
    camera.value = {
      preset,
      fps: typeof stored.fps === 'number' && stored.fps >= 3 && stored.fps <= 30 ? Math.trunc(stored.fps) : CAMERA_PRESETS[preset].fps,
      focusMode: stored.focusMode === 'continuous' ? 'continuous' : '',
      tall: stored.tall === true,
    };
  }

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  isLineOnIos.value = /iPhone|iPad|iPod/.test(ua) && /Line\//.test(ua);
}

function isScanItemLike(v: unknown): v is ScanItem {
  return typeof v === 'object' && v !== null && typeof (v as ScanItem).jan === 'string' && (v as ScanItem).jan !== '';
}

// ---------------------------------------------------------------- URL 受信（同期・localStorage 不要）

/** モジュール読み込み時に URL を解釈しておく（初期タブ判定に使う） */
export function readUrlPayload(href: string): void {
  const query = href.includes('?') ? href.slice(href.indexOf('?')) : '';
  const encoded = extractDataParam(query);
  const from = /[?&]from=(main|share)/.exec(query)?.[1] ?? '';
  if (!encoded) return;
  try {
    const r = decodeShareDataDetailed(encoded);
    received.value = r.envelope;
    receiveWarnings.value = r.warnings;
  } catch {
    receiveError.value = 'データの読み込みに失敗しました。URLが途中で切れていないか確認してください';
  }
  if (from === 'main' || received.value || receiveError.value) tab.value = 'recv';
}

// ---------------------------------------------------------------- スキャン操作

export type AddResult =
  | { ok: true; jan: string; fromItf: boolean }
  | { ok: false; reason: 'empty' | 'invalid' | 'duplicate'; jan: string };

/**
 * 読み取ったコードを蓄積する。ITF→JAN の正規化は @core/jan の resolveCode に委ねる。
 * 同一 JAN は拒否（v1 と同じ挙動）。
 */
export function addCode(raw: string): AddResult {
  const code = (raw ?? '').replace(/\s+/g, '');
  if (!code) return { ok: false, reason: 'empty', jan: '' };
  if (/^https?:/i.test(code) || /[^0-9A-Za-z]/.test(code)) return { ok: false, reason: 'invalid', jan: code };

  const { jan, fromItf } = resolveCode(code);
  if (scanned.value.some((i) => i.jan === jan)) return { ok: false, reason: 'duplicate', jan };

  scanned.value = [makeScanItem(jan, new Date().toISOString()), ...scanned.value];
  persistScanned();
  return { ok: true, jan, fromItf };
}

export function removeScanned(id: string): void {
  const before = scanned.value;
  const item = before.find((i) => i.id === id);
  scanned.value = before.filter((i) => i.id !== id);
  persistScanned();
  showToast(item ? `${item.jan} を削除しました` : '削除しました', {
    undoLabel: '元に戻す',
    onUndo: () => {
      scanned.value = before;
      persistScanned();
    },
  });
}

/** 全消去（confirm は使わず Undo 付きトーストで取り消す） */
export function clearScanned(): void {
  const before = scanned.value;
  if (before.length === 0) {
    showToast('スキャン済みデータがありません', { tone: 'warn' });
    return;
  }
  scanned.value = [];
  persistScanned();
  showToast(`${before.length}件を消去しました`, {
    undoLabel: '元に戻す',
    onUndo: () => {
      scanned.value = before;
      persistScanned();
      showToast('消去を取り消しました');
    },
  });
}

// ---------------------------------------------------------------- カメラ設定

export function setCamera(patch: Partial<ShareCameraSettings>): void {
  camera.value = { ...camera.value, ...patch };
  writeJson(SHARE_CAMERA_KEY, camera.value);
}

export function selectPreset(preset: Settings['cameraPreset']): void {
  const p = CAMERA_PRESETS[preset];
  setCamera(preset === 'custom' ? { preset } : { preset, fps: p.fps, focusMode: p.focusMode });
}

export function cameraSummary(c: ShareCameraSettings = camera.value): string {
  if (c.preset === 'custom') return `カスタム FPS:${c.fps} / AF:${c.focusMode === 'continuous' ? 'continuous' : '指定なし'}`;
  return CAMERA_PRESETS[c.preset].label;
}
