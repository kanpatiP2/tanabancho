/**
 * Gemini APIキーの保管。
 *
 * v1 からの変更点（安全側に倒す）:
 * - 既定は sessionStorage（タブを閉じれば消える）。localStorage への永続保存は
 *   チェックボックスによる **明示的オプトイン**（v1 は confirm の OK が永続だった）
 * - 表示は常にマスク。生のキーを画面や DOM に置かない
 * - 旧 `sb_api_key`（localStorage）があれば初回のみ引き継ぐ（旧キーは消さない）
 */

import type { StorageBackend } from '@core/storage';
import { readLegacyApiKey } from './legacy';

export const API_KEY_STORAGE_KEY = 'sb.v2.apikey';

interface KeyStores {
  session: StorageBackend | null;
  local: StorageBackend | null;
}

function memory(): StorageBackend {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

let stores: KeyStores = {
  session: typeof sessionStorage !== 'undefined' ? sessionStorage : memory(),
  local: typeof localStorage !== 'undefined' ? localStorage : memory(),
};

/** テスト用の差し替え */
export function setApiKeyStores(session: StorageBackend, local: StorageBackend): void {
  stores = { session, local };
}

function safeGet(s: StorageBackend | null, k: string): string | null {
  try {
    return s?.getItem(k) ?? null;
  } catch {
    return null;
  }
}

function safeSet(s: StorageBackend | null, k: string, v: string): void {
  try {
    s?.setItem(k, v);
  } catch {
    /* Quota / プライベートモード。キーは揮発するだけなので握りつぶす */
  }
}

function safeRemove(s: StorageBackend | null, k: string): void {
  try {
    s?.removeItem(k);
  } catch {
    /* noop */
  }
}

/** セッション優先。無ければ永続保存分 */
export function getApiKey(): string {
  return (
    safeGet(stores.session, API_KEY_STORAGE_KEY) ?? safeGet(stores.local, API_KEY_STORAGE_KEY) ?? ''
  );
}

/** localStorage に永続保存されているか（設定画面のチェック状態） */
export function isPersisted(): boolean {
  return safeGet(stores.local, API_KEY_STORAGE_KEY) !== null;
}

export function saveApiKey(key: string, persist: boolean): void {
  const trimmed = key.trim();
  if (!trimmed) return;
  // どちらに保存する場合もセッションには置く（同一タブ内の参照を一本化）
  safeSet(stores.session, API_KEY_STORAGE_KEY, trimmed);
  if (persist) safeSet(stores.local, API_KEY_STORAGE_KEY, trimmed);
  else safeRemove(stores.local, API_KEY_STORAGE_KEY);
}

export function clearApiKey(): void {
  safeRemove(stores.session, API_KEY_STORAGE_KEY);
  safeRemove(stores.local, API_KEY_STORAGE_KEY);
}

/** 表示用マスク。先頭6文字と末尾4文字だけ残す */
export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 12) return '•'.repeat(key.length);
  return `${key.slice(0, 6)}${'•'.repeat(8)}${key.slice(-4)}`;
}

export function isPlausibleKey(key: string): boolean {
  return key.trim().length >= 10;
}

/**
 * 旧 v1 のキーを初回だけ引き継ぐ。v2 キーが既にあれば何もしない。
 * 旧キーは localStorage 永続だったので、引き継ぎ後も永続扱いにする。
 * @returns 引き継いだら true
 */
export function adoptLegacyApiKey(): boolean {
  if (getApiKey()) return false;
  const legacy = readLegacyApiKey();
  if (!legacy) return false;
  saveApiKey(legacy, true);
  return true;
}
