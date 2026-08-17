import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJanCodeLookupProvider } from './providers/jancodelookup';
import { openFoodFactsProvider } from './providers/openfoodfacts';

/** fetch を差し替えて、渡された URL と返す応答を制御する */
function mockFetch(reply: (url: string) => { status?: number; body?: unknown; text?: string }) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (input: string) => {
    urls.push(String(input));
    const r = reply(String(input));
    const status = r.status ?? 200;
    const text = r.text ?? JSON.stringify(r.body ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return JSON.parse(text);
      },
      async text() {
        return text;
      },
    };
  });
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Open Food Facts プロバイダ', () => {
  it('日本語名を最優先で拾う', async () => {
    mockFetch(() => ({
      body: {
        status: 1,
        product: { product_name_ja: 'コカ・コーラ 500ml', product_name: 'Coca-Cola', brands: '日本コカ・コーラ' },
      },
    }));

    const r = await openFoodFactsProvider.lookup('4902102072618');
    expect(r).toEqual({
      jan: '4902102072618',
      name: 'コカ・コーラ 500ml',
      provider: 'openfoodfacts',
      maker: '日本コカ・コーラ',
    });
  });

  it('日本語名が無ければ既定名 → 英語名の順に落ちる', async () => {
    mockFetch(() => ({ body: { status: 1, product: { product_name_en: 'Green Tea' } } }));
    expect((await openFoodFactsProvider.lookup('49'))?.name).toBe('Green Tea');
  });

  it('必要な列だけを要求する（既定の巨大レスポンスを避ける）', async () => {
    const urls = mockFetch(() => ({ status: 404 }));
    await openFoodFactsProvider.lookup('4901777018686');
    expect(urls[0]).toContain('/api/v2/product/4901777018686.json?fields=');
    expect(urls[0]).toContain('product_name_ja');
  });

  it('404 は「確定ミス」として null', async () => {
    mockFetch(() => ({ status: 404 }));
    expect(await openFoodFactsProvider.lookup('4900000000000')).toBeNull();
  });

  it('status:0 も確定ミス', async () => {
    mockFetch(() => ({ body: { status: 0, status_verbose: 'product not found' } }));
    expect(await openFoodFactsProvider.lookup('4900000000000')).toBeNull();
  });

  it('登録はあるが名前が空ならミス扱い', async () => {
    mockFetch(() => ({ body: { status: 1, product: { product_name: '  ', brands: 'なにか' } } }));
    expect(await openFoodFactsProvider.lookup('4900000000000')).toBeNull();
  });

  it('429 は throw する（negative cache に載せずキューへ回すため）', async () => {
    mockFetch(() => ({ status: 429 }));
    await expect(openFoodFactsProvider.lookup('4901777018686')).rejects.toThrow('429');
  });

  it('5xx も throw する', async () => {
    mockFetch(() => ({ status: 503 }));
    await expect(openFoodFactsProvider.lookup('4901777018686')).rejects.toThrow('503');
  });

  it('商品名に混ざる HTML エンティティを戻す（実測で &quot; が出た）', async () => {
    mockFetch(() => ({
      body: { status: 1, product: { product_name: 'gogo no kocha &quot;kirin&quot; &amp; tea' } },
    }));
    expect((await openFoodFactsProvider.lookup('49'))?.name).toBe('gogo no kocha "kirin" & tea');
  });

  it('brands が無ければ maker を付けない', async () => {
    mockFetch(() => ({ body: { status: 1, product: { product_name_ja: 'お茶' } } }));
    const r = await openFoodFactsProvider.lookup('49');
    expect(r).not.toHaveProperty('maker');
  });
});

describe('JANCODE LOOKUP プロバイダ', () => {
  const provider = createJanCodeLookupProvider('APPID123');

  it('appId と JAN を type=code で投げる', async () => {
    const urls = mockFetch(() => ({ body: { product: [] } }));
    await provider.lookup('4901777018686');
    expect(urls[0]).toContain('appId=APPID123');
    expect(urls[0]).toContain('query=4901777018686');
    expect(urls[0]).toContain('type=code');
  });

  it('product[0] から商品名とメーカーを拾う', async () => {
    mockFetch(() => ({
      body: {
        product: [{ codeNumber: '4901777018686', itemName: 'サントリー天然水', makerName: 'サントリー' }],
      },
    }));
    expect(await provider.lookup('4901777018686')).toEqual({
      jan: '4901777018686',
      name: 'サントリー天然水',
      provider: 'jancodelookup',
      maker: 'サントリー',
    });
  });

  it('makerName が無ければ brandName で代替する', async () => {
    mockFetch(() => ({ body: { product: [{ itemName: 'お茶', brandName: '伊藤園' }] } }));
    expect((await provider.lookup('49'))?.maker).toBe('伊藤園');
  });

  it('product が空なら確定ミス', async () => {
    mockFetch(() => ({ body: { product: [] } }));
    expect(await provider.lookup('4900000000000')).toBeNull();
  });

  it('HTML（ドメインパーキング）が返ったら throw する', async () => {
    mockFetch(() => ({ text: '<html lang="en"><head><title>Redirecting...</title></head></html>' }));
    await expect(provider.lookup('4901777018686')).rejects.toThrow('サービス停止');
  });
});
