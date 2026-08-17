/**
 * 永続化層。P1-A が migrate/backup と合わせて拡張する。
 * localStorage を直接触るのはこのモジュールだけ（テストでは backend を差し替える）。
 */

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let backend: StorageBackend =
  typeof localStorage !== 'undefined' ? localStorage : createMemoryBackend();

export function setStorageBackend(b: StorageBackend): void {
  backend = b;
}

export function createMemoryBackend(): StorageBackend {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** 破損データは null 扱い（起動不能を防ぐ） */
export function readJson<T>(key: string): T | null {
  const raw = backend.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** QuotaExceeded 時は false を返す（呼び出し側でトースト表示） */
export function writeJson(key: string, value: unknown): boolean {
  try {
    backend.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readRaw(key: string): string | null {
  return backend.getItem(key);
}
