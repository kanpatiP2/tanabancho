/**
 * 外部JAN照会が使う非同期 KV（既定は IndexedDB / idb-keyval）。
 *
 * localStorage を使わない理由: 照会結果とキューは件数が増えやすく、
 * v2 キーの 5MB 枠（core/storage.ts が見張っている領域）を圧迫したくないため。
 * どちらも「失われても再取得できる」データなので別ストアに逃がしてある。
 *
 * IndexedDB が無い環境（Node のテスト・古い WebView）ではメモリへ自動退避する。
 */
import {
  createStore,
  del as idbDel,
  get as idbGet,
  keys as idbKeys,
  set as idbSet,
  type UseStore,
} from 'idb-keyval';

export interface LookupKv {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export function createMemoryKv(): LookupKv {
  const map = new Map<string, unknown>();
  return {
    async get(key) {
      return map.get(key);
    },
    async set(key, value) {
      map.set(key, value);
    },
    async del(key) {
      map.delete(key);
    },
    async keys() {
      return [...map.keys()];
    },
  };
}

function createIdbKv(): LookupKv | null {
  // createStore は即座に indexedDB.open を呼ぶので、存在確認は必須
  if (typeof indexedDB === 'undefined') return null;
  let store: UseStore;
  try {
    store = createStore('tb-lookup', 'cache');
  } catch {
    return null;
  }
  return {
    get: (key) => idbGet(key, store),
    set: (key, value) => idbSet(key, value, store),
    del: (key) => idbDel(key, store),
    keys: async () => (await idbKeys(store)).map((k) => String(k)),
  };
}

let kv: LookupKv | null = null;

/** キャッシュ・キュー共通のバックエンド */
export function lookupKv(): LookupKv {
  if (!kv) kv = createIdbKv() ?? createMemoryKv();
  return kv;
}

/** テスト・IndexedDB 不使用環境から差し替える。null で既定へ戻す */
export function setLookupKv(next: LookupKv | null): void {
  kv = next;
}
