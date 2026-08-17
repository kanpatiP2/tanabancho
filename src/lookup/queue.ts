/**
 * オフライン/失敗時の再試行キュー。
 *
 * 売場は電波が悪いことが多く、スキャン中に照会が落ちるのは日常。
 * 落ちた JAN をここに積んでおき、オンライン復帰時に `flushLookupQueue()` で拾い直す。
 * キャッシュと同じストアに 1 キー（配列・投入順）で置く。
 */
import { lookupKv } from './kv';

const QUEUE_KEY = 'queue';
/** 溜まりすぎ防止。古いものから捨てる */
export const QUEUE_LIMIT = 200;

export async function readQueue(): Promise<string[]> {
  try {
    const raw = await lookupKv().get(QUEUE_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter((v): v is string => typeof v === 'string' && v !== '');
  } catch {
    return [];
  }
}

async function writeQueue(jans: string[]): Promise<void> {
  try {
    await lookupKv().set(QUEUE_KEY, jans.slice(-QUEUE_LIMIT));
  } catch {
    /* 保存できなくても致命的ではない（次のスキャンで再度積まれる） */
  }
}

/** 重複は積まない。戻り値は実際に積んだか */
export async function enqueue(jan: string): Promise<boolean> {
  if (!jan) return false;
  const current = await readQueue();
  if (current.includes(jan)) return false;
  await writeQueue([...current, jan]);
  return true;
}

export async function removeFromQueue(jans: Iterable<string>): Promise<void> {
  const drop = new Set(jans);
  if (!drop.size) return;
  const current = await readQueue();
  const next = current.filter((j) => !drop.has(j));
  if (next.length !== current.length) await writeQueue(next);
}

export async function clearQueue(): Promise<void> {
  try {
    await lookupKv().del(QUEUE_KEY);
  } catch {
    /* noop */
  }
}
