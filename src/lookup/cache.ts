/**
 * 外部JAN照会の永続キャッシュ。
 *
 * ヒットは長め・ミスは短め（negative cache）の TTL を持たせる。
 * 未登録JANを毎スキャン問い合わせに行かせないための negative cache が主目的。
 */
import type { LookupResult } from '@core/types';
import { lookupKv } from './kv';

/** ヒットの保持期間。商品名はそう変わらないので長め */
export const POSITIVE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** ミスの保持期間（negative cache）。7日後にもう一度だけ試す */
export const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CACHE_PREFIX = 'jan:';

export interface CacheEntry {
  jan: string;
  /** null = そのJANは「見つからなかった」ことの記録（negative cache） */
  result: LookupResult | null;
  /** 記録時刻（epoch ms） */
  at: number;
  /** 有効期間（ms） */
  ttl: number;
}

function isEntry(v: unknown): v is CacheEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Partial<CacheEntry>;
  return typeof e.jan === 'string' && typeof e.at === 'number' && typeof e.ttl === 'number';
}

/**
 * キャッシュを読む。未登録・期限切れは null（期限切れは掃除する）。
 * 「ミスが記録されている」場合は `result: null` を持つ entry が返るので、
 * 呼び出し側は null（キャッシュ無し）との違いで再照会の要否を判断できる。
 */
export async function readCache(jan: string, now = Date.now()): Promise<CacheEntry | null> {
  if (!jan) return null;
  let raw: unknown;
  try {
    raw = await lookupKv().get(CACHE_PREFIX + jan);
  } catch {
    return null; // ストレージ障害は「キャッシュ無し」として扱う
  }
  if (!isEntry(raw)) return null;
  if (now - raw.at >= raw.ttl) {
    try {
      await lookupKv().del(CACHE_PREFIX + jan);
    } catch {
      /* 掃除できなくても致命的ではない */
    }
    return null;
  }
  return raw;
}

/** ヒット/ミスを記録する。result が null ならミス（TTL 7日） */
export async function writeCache(
  jan: string,
  result: LookupResult | null,
  now = Date.now(),
): Promise<void> {
  if (!jan) return;
  const entry: CacheEntry = {
    jan,
    result,
    at: now,
    ttl: result ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS,
  };
  try {
    await lookupKv().set(CACHE_PREFIX + jan, entry);
  } catch {
    /* 保存できなくても照会自体は成功しているので握りつぶす */
  }
}

/** 設定画面などから手動で捨てる用。捨てた件数を返す */
export async function clearLookupCache(): Promise<number> {
  try {
    const kv = lookupKv();
    const targets = (await kv.keys()).filter((k) => k.startsWith(CACHE_PREFIX));
    await Promise.all(targets.map((k) => kv.del(k)));
    return targets.length;
  } catch {
    return 0;
  }
}
