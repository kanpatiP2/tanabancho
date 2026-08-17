/**
 * 外部JAN照会の入口。
 *
 * 流れ:
 *   キャッシュ（IndexedDB） → プロバイダを順に試す → ヒットで保存+返却
 *   確定ミスは negative cache（7日）、通信失敗はキューに積んで後で再試行
 *
 * 「確定ミス（そのDBに無い）」と「通信失敗（分からない）」を区別するのが要点。
 * 前者だけを negative cache に載せ、後者はキューへ回す。
 */
import type { LookupProvider, LookupResult } from '@core/types';
import { getSettings } from '@core/storage';
import { readCache, writeCache } from './cache';
import { buildProviders } from './providers';
import { enqueue, readQueue, removeFromQueue } from './queue';

export { clearLookupCache, NEGATIVE_TTL_MS, POSITIVE_TTL_MS } from './cache';
export { createMemoryKv, setLookupKv, type LookupKv } from './kv';
export { buildProviders } from './providers';
export { clearQueue, readQueue, QUEUE_LIMIT } from './queue';

/**
 * キュー一括フラッシュ時の照会間隔（ms）。
 *
 * 実測（docs/lookup-spike.md）: Open Food Facts は 300ms 間隔だと 187件中151件が 429 になり、
 * 一度 429 に入るとしばらく 429 が返り続ける。1500ms 間隔ならほぼ通る。
 * 単発スキャンでは制限に当たらないので、間隔を空けるのはフラッシュのときだけ。
 */
export const FLUSH_SPACING_MS = 1500;

export interface LookupOptions {
  /** 省略時は設定（janLookupAppId）から組み立てる。テストで差し替える */
  providers?: LookupProvider[];
  now?: number;
  /** フラッシュ時の照会間隔。テストでは 0 にする */
  spacingMs?: number;
}

/** 設定を読んで既定のプロバイダ列を作る */
function defaultProviders(): LookupProvider[] {
  try {
    return buildProviders({ janLookupAppId: getSettings().janLookupAppId });
  } catch {
    return buildProviders();
  }
}

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 通信失敗（キューへ回すべき状態）を表す番兵 */
const UNRESOLVED = Symbol('unresolved');

/**
 * プロバイダを順に試す。
 * - ヒット → その結果
 * - 全プロバイダが「確定ミス」→ null（negative cache に載せる）
 * - 1件も確定せず全部が例外 → UNRESOLVED（キューへ）
 */
async function runProviders(
  jan: string,
  providers: LookupProvider[],
): Promise<LookupResult | null | typeof UNRESOLVED> {
  let decided = false;
  for (const p of providers) {
    try {
      const hit = await p.lookup(jan);
      decided = true;
      if (hit && hit.name) return hit;
    } catch {
      // このプロバイダは今回使えない。次を試す
    }
  }
  return decided ? null : UNRESOLVED;
}

/**
 * JAN 1件を外部DBへ照会する。呼び出し側から見て「失敗」は常に null。
 * オフライン・通信失敗のときは自動でキューに積まれる。
 */
export async function lookupJan(jan: string, opts: LookupOptions = {}): Promise<LookupResult | null> {
  const code = String(jan ?? '').trim();
  if (!code) return null;

  const now = opts.now ?? Date.now();
  const cached = await readCache(code, now);
  // entry があれば result が null（ミス記録）でもそれが答え
  if (cached) return cached.result;

  if (offline()) {
    await enqueue(code);
    return null;
  }

  const providers = opts.providers ?? defaultProviders();
  if (!providers.length) return null;

  const outcome = await runProviders(code, providers);
  if (outcome === UNRESOLVED) {
    await enqueue(code);
    return null;
  }
  await writeCache(code, outcome, now);
  return outcome;
}

/**
 * キューに溜まった JAN を再照会する。オンライン復帰時に呼ぶ。
 * 解決できた（ヒット/確定ミス）ものだけキューから外す。
 * @returns 名前が取れたものだけの配列（呼び出し側が辞書へ学習させる）
 */
export async function flushLookupQueue(opts: LookupOptions = {}): Promise<LookupResult[]> {
  if (offline()) return [];
  const pending = await readQueue();
  if (!pending.length) return [];

  const providers = opts.providers ?? defaultProviders();
  if (!providers.length) return [];

  const now = opts.now ?? Date.now();
  const spacing = opts.spacingMs ?? FLUSH_SPACING_MS;
  const resolved: string[] = [];
  const hits: LookupResult[] = [];
  let queried = 0;

  for (const code of pending) {
    const cached = await readCache(code, now);
    if (cached) {
      resolved.push(code);
      if (cached.result) hits.push(cached.result);
      continue;
    }
    // 実際に外へ出る回数だけ間隔を空ける（キャッシュで済んだ分は待たない）
    if (queried > 0 && spacing > 0) await sleep(spacing);
    queried++;

    const outcome = await runProviders(code, providers);
    if (outcome === UNRESOLVED) continue; // まだダメ。キューに残す
    await writeCache(code, outcome, now);
    resolved.push(code);
    if (outcome) hits.push(outcome);
  }

  await removeFromQueue(resolved);
  return hits;
}

/**
 * `online` イベントで自動フラッシュする。戻り値は解除関数。
 * ヒットした結果は onHits に渡す（辞書学習は呼び出し側の責務）。
 */
export function startLookupAutoFlush(
  onHits: (hits: LookupResult[]) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (): void => {
    void flushLookupQueue()
      .then((hits) => {
        if (hits.length) onHits(hits);
      })
      .catch(() => {
        /* 再試行は次の online イベントで */
      });
  };
  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}
