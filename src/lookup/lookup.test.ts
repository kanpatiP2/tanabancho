import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupProvider, LookupResult } from '@core/types';
import { NEGATIVE_TTL_MS, POSITIVE_TTL_MS, readCache, writeCache } from './cache';
import { createMemoryKv, setLookupKv } from './kv';
import { readQueue } from './queue';
import { buildProviders, flushLookupQueue, lookupJan } from './index';
import { JANCODE_LOOKUP } from './providers/jancodelookup';
import { OPEN_FOOD_FACTS } from './providers/openfoodfacts';

const JAN = '4901777018686';

function hit(jan: string, name: string, provider = 'stub'): LookupResult {
  return { jan, name, provider };
}

/** 呼び出し回数を数えるスタブプロバイダ */
function stubProvider(
  name: string,
  impl: (jan: string) => Promise<LookupResult | null>,
): LookupProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    calls,
    async lookup(jan) {
      calls.push(jan);
      return impl(jan);
    },
  };
}

beforeEach(() => {
  setLookupKv(createMemoryKv());
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLookupKv(null);
});

describe('lookupJan — キャッシュ', () => {
  it('ヒットをキャッシュし、2回目はプロバイダを呼ばない', async () => {
    const p = stubProvider('stub', async (jan) => hit(jan, 'サントリー天然水'));

    const first = await lookupJan(JAN, { providers: [p] });
    expect(first?.name).toBe('サントリー天然水');

    const second = await lookupJan(JAN, { providers: [p] });
    expect(second?.name).toBe('サントリー天然水');
    expect(p.calls).toHaveLength(1);
  });

  it('確定ミスは negative cache に載り、2回目はプロバイダを呼ばない', async () => {
    const p = stubProvider('stub', async () => null);

    expect(await lookupJan(JAN, { providers: [p] })).toBeNull();
    expect(await lookupJan(JAN, { providers: [p] })).toBeNull();
    expect(p.calls).toHaveLength(1);

    const entry = await readCache(JAN);
    expect(entry?.result).toBeNull();
    expect(entry?.ttl).toBe(NEGATIVE_TTL_MS);
  });

  it('ヒットの TTL はミスより長い（180日 / 7日）', async () => {
    await writeCache(JAN, hit(JAN, 'あ'), 0);
    expect((await readCache(JAN, 0))?.ttl).toBe(POSITIVE_TTL_MS);
    await writeCache('4900000000000', null, 0);
    expect((await readCache('4900000000000', 0))?.ttl).toBe(NEGATIVE_TTL_MS);
  });

  it('negative cache は7日で切れ、切れたら再照会する', async () => {
    const p = stubProvider('stub', async () => null);
    const t0 = 1_700_000_000_000;

    await lookupJan(JAN, { providers: [p], now: t0 });
    expect(p.calls).toHaveLength(1);

    // 6日後: まだ有効なので再照会しない
    await lookupJan(JAN, { providers: [p], now: t0 + 6 * 24 * 3600_000 });
    expect(p.calls).toHaveLength(1);

    // 7日+1ms 後: 期限切れなのでもう一度だけ聞きに行く
    await lookupJan(JAN, { providers: [p], now: t0 + NEGATIVE_TTL_MS + 1 });
    expect(p.calls).toHaveLength(2);
  });

  it('ヒットは180日以内なら再照会しない', async () => {
    const p = stubProvider('stub', async (jan) => hit(jan, 'コーラ'));
    const t0 = 1_700_000_000_000;

    await lookupJan(JAN, { providers: [p], now: t0 });
    await lookupJan(JAN, { providers: [p], now: t0 + POSITIVE_TTL_MS - 1 });
    expect(p.calls).toHaveLength(1);

    await lookupJan(JAN, { providers: [p], now: t0 + POSITIVE_TTL_MS + 1 });
    expect(p.calls).toHaveLength(2);
  });

  it('空 JAN は何もしない', async () => {
    const p = stubProvider('stub', async (jan) => hit(jan, 'x'));
    expect(await lookupJan('', { providers: [p] })).toBeNull();
    expect(await lookupJan('   ', { providers: [p] })).toBeNull();
    expect(p.calls).toHaveLength(0);
  });
});

describe('lookupJan — プロバイダのフォールバック順', () => {
  it('先頭がヒットしたら後続を呼ばない', async () => {
    const first = stubProvider('first', async (jan) => hit(jan, '一番目', 'first'));
    const second = stubProvider('second', async (jan) => hit(jan, '二番目', 'second'));

    const r = await lookupJan(JAN, { providers: [first, second] });
    expect(r?.provider).toBe('first');
    expect(second.calls).toHaveLength(0);
  });

  it('先頭が例外を投げたら次のプロバイダへフォールバックする', async () => {
    const broken = stubProvider('broken', async () => {
      throw new Error('429');
    });
    const backup = stubProvider('backup', async (jan) => hit(jan, '予備', 'backup'));

    const r = await lookupJan(JAN, { providers: [broken, backup] });
    expect(r?.provider).toBe('backup');
    expect(broken.calls).toHaveLength(1);
    expect(backup.calls).toHaveLength(1);
  });

  it('先頭が「確定ミス」でも次を試し、そこでヒットすれば採用する', async () => {
    const empty = stubProvider('empty', async () => null);
    const backup = stubProvider('backup', async (jan) => hit(jan, '予備', 'backup'));

    const r = await lookupJan(JAN, { providers: [empty, backup] });
    expect(r?.provider).toBe('backup');
  });

  it('全プロバイダが例外なら negative cache に載せない（キューへ回す）', async () => {
    const broken = stubProvider('broken', async () => {
      throw new Error('network');
    });

    expect(await lookupJan(JAN, { providers: [broken] })).toBeNull();
    // 通信失敗は「見つからなかった」ではないのでキャッシュしない
    expect(await readCache(JAN)).toBeNull();
    expect(await readQueue()).toEqual([JAN]);
  });

  it('1つでも確定ミスを返せば negative cache に載せる', async () => {
    const broken = stubProvider('broken', async () => {
      throw new Error('network');
    });
    const empty = stubProvider('empty', async () => null);

    expect(await lookupJan(JAN, { providers: [broken, empty] })).toBeNull();
    expect((await readCache(JAN))?.result).toBeNull();
    expect(await readQueue()).toEqual([]);
  });
});

describe('オフラインキュー', () => {
  it('オフライン時はプロバイダを呼ばずキューに積む', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const p = stubProvider('stub', async (jan) => hit(jan, 'x'));

    expect(await lookupJan(JAN, { providers: [p] })).toBeNull();
    expect(p.calls).toHaveLength(0);
    expect(await readQueue()).toEqual([JAN]);
  });

  it('同じ JAN は重複して積まない', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const p = stubProvider('stub', async (jan) => hit(jan, 'x'));

    await lookupJan(JAN, { providers: [p] });
    await lookupJan(JAN, { providers: [p] });
    expect(await readQueue()).toEqual([JAN]);
  });

  it('flushLookupQueue がキューを再照会し、解決したものを外す', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const p = stubProvider('stub', async (jan) => hit(jan, `商品${jan.slice(-1)}`));
    await lookupJan('4900000000001', { providers: [p] });
    await lookupJan('4900000000002', { providers: [p] });
    expect(await readQueue()).toHaveLength(2);

    // オンライン復帰
    vi.stubGlobal('navigator', { onLine: true });
    const hits = await flushLookupQueue({ providers: [p], spacingMs: 0 });

    expect(hits.map((h) => h.jan)).toEqual(['4900000000001', '4900000000002']);
    expect(await readQueue()).toEqual([]);
    // 結果はキャッシュされている
    expect((await readCache('4900000000001'))?.result?.name).toBe('商品1');
  });

  it('flush でまだ失敗するものはキューに残る', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const offlineStub = stubProvider('stub', async (jan) => hit(jan, 'x'));
    await lookupJan('4900000000001', { providers: [offlineStub] });
    await lookupJan('4900000000002', { providers: [offlineStub] });

    vi.stubGlobal('navigator', { onLine: true });
    const flaky = stubProvider('flaky', async (jan) => {
      if (jan === '4900000000002') throw new Error('まだダメ');
      return hit(jan, '取れた');
    });
    const hits = await flushLookupQueue({ providers: [flaky], spacingMs: 0 });

    expect(hits).toHaveLength(1);
    expect(await readQueue()).toEqual(['4900000000002']);
  });

  it('flush 中に確定ミスだったものもキューから外す（ヒット扱いはしない）', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const stub = stubProvider('stub', async (jan) => hit(jan, 'x'));
    await lookupJan(JAN, { providers: [stub] });

    vi.stubGlobal('navigator', { onLine: true });
    const empty = stubProvider('empty', async () => null);
    expect(await flushLookupQueue({ providers: [empty], spacingMs: 0 })).toEqual([]);
    expect(await readQueue()).toEqual([]);
    expect((await readCache(JAN))?.result).toBeNull();
  });

  it('flush は外へ出る照会の間だけ間隔を空ける（OFF のレート制限対策）', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const stub = stubProvider('stub', async (jan) => hit(jan, 'x'));
    await lookupJan('4900000000001', { providers: [stub] });
    await lookupJan('4900000000002', { providers: [stub] });
    await lookupJan('4900000000003', { providers: [stub] });

    vi.stubGlobal('navigator', { onLine: true });
    const waits: number[] = [];
    vi.stubGlobal('setTimeout', ((fn: () => void, ms: number) => {
      waits.push(ms);
      fn();
      return 0;
    }) as unknown as typeof setTimeout);

    const p = stubProvider('p', async (jan) => hit(jan, '取れた'));
    await flushLookupQueue({ providers: [p], spacingMs: 1500 });

    // 3件照会 → 待つのは2回（1件目の前は待たない）
    expect(waits).toEqual([1500, 1500]);
  });

  it('オフラインのまま flush しても何もしない', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const p = stubProvider('stub', async (jan) => hit(jan, 'x'));
    await lookupJan(JAN, { providers: [p] });

    expect(await flushLookupQueue({ providers: [p], spacingMs: 0 })).toEqual([]);
    expect(await readQueue()).toEqual([JAN]);
  });
});

describe('buildProviders', () => {
  it('appId 未設定なら Open Food Facts だけ', () => {
    const ps = buildProviders();
    expect(ps.map((p) => p.name)).toEqual([OPEN_FOOD_FACTS]);
  });

  it('空白だけの appId もスキップする', () => {
    expect(buildProviders({ janLookupAppId: '   ' }).map((p) => p.name)).toEqual([OPEN_FOOD_FACTS]);
  });

  it('appId があれば日本特化を先に置く', () => {
    const ps = buildProviders({ janLookupAppId: 'abc123' });
    expect(ps.map((p) => p.name)).toEqual([JANCODE_LOOKUP, OPEN_FOOD_FACTS]);
  });
});
