import { describe, expect, it, vi } from 'vitest';
import {
  buildRequestBody,
  extractText,
  GEMINI_ENDPOINT,
  GeminiError,
  MAX_OUTPUT_TOKENS,
  parseGeminiResponse,
  runOcr,
} from './gemini';
import type { SelectedImage } from './images';

const img = (n: number): SelectedImage => ({
  dataUrl: `data:image/jpeg;base64,IMG${n}`,
  name: `${n}.jpg`,
});

function ok(sheets: unknown, finishReason = 'STOP') {
  return { candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify({ sheets }) }] } }] };
}

const SHEET_A = [
  {
    sheet_index: 1,
    cart_id: 'A12',
    store: '本店',
    delivery_date: '2026-08-17',
    items: [{ name: 'ドンベエ', code: '14901234567894', qty_per_case: 12, cases: 2 }],
  },
];

// ---------------------------------------------------------------- リクエスト

describe('buildRequestBody', () => {
  it('画像を順番どおり inline_data + ラベルで並べる', () => {
    const body = buildRequestBody([img(1), img(2)]) as {
      contents: { parts: { text?: string; inline_data?: { mime_type: string; data: string } }[] }[];
    };
    const parts = body.contents[0]!.parts;
    expect(parts[0]!.inline_data).toEqual({ mime_type: 'image/jpeg', data: 'IMG1' });
    expect(parts[1]!.text).toBe('[明細書 1枚目]');
    expect(parts[2]!.inline_data).toEqual({ mime_type: 'image/jpeg', data: 'IMG2' });
    expect(parts[3]!.text).toBe('[明細書 2枚目]');
    expect(parts[4]!.text).toContain('2枚の納品明細書');
  });

  it('構造化出力を要求する（コードフェンス手動除去の廃止）', () => {
    const body = buildRequestBody([img(1)]) as {
      generationConfig: { responseMimeType: string; maxOutputTokens: number; responseSchema: unknown };
    };
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    expect(MAX_OUTPUT_TOKENS).toBe(16384);
    expect(body.generationConfig.responseSchema).toMatchObject({ type: 'OBJECT' });
  });
});

// ---------------------------------------------------------------- パース

describe('parseGeminiResponse', () => {
  it('正常なレスポンスを正規化する', () => {
    const sheets = parseGeminiResponse(ok(SHEET_A));
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toMatchObject({ sheetIndex: 1, cartId: 'A12', store: '本店' });
    expect(sheets[0]!.items[0]).toEqual({
      name: 'ドンベエ',
      code: '14901234567894',
      qtyPerCase: 12,
      cases: 2,
    });
  });

  it('複数パートに割れた text を連結して解釈する', () => {
    const json = JSON.stringify({ sheets: SHEET_A });
    const payload = {
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: json.slice(0, 20) }, { text: json.slice(20) }] },
        },
      ],
    };
    expect(parseGeminiResponse(payload)).toHaveLength(1);
  });

  it('配列だけを返す旧形式も受け付ける', () => {
    const payload = {
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(SHEET_A) }] } }],
    };
    expect(parseGeminiResponse(payload)).toHaveLength(1);
  });

  it('API エラーは kind=api', () => {
    expect(() => parseGeminiResponse({ error: { message: 'API key not valid' } })).toThrowError(
      expect.objectContaining({ kind: 'api', message: 'API key not valid' }),
    );
  });

  it('MAX_TOKENS は kind=truncated（分割フォールバックの発火点）', () => {
    expect(() => parseGeminiResponse(ok(SHEET_A, 'MAX_TOKENS'))).toThrowError(
      expect.objectContaining({ kind: 'truncated' }),
    );
  });

  it('途中で切れた JSON は kind=truncated', () => {
    const payload = {
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"sheets":[{"items":[{"name":"ド' }] } }],
    };
    expect(() => parseGeminiResponse(payload)).toThrowError(
      expect.objectContaining({ kind: 'truncated' }),
    );
  });

  it('スキーマ外れ（sheets が配列でない）は kind=parse', () => {
    const payload = {
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"sheets":"nope"}' }] } }],
    };
    expect(() => parseGeminiResponse(payload)).toThrowError(expect.objectContaining({ kind: 'parse' }));
  });

  it('JSON ですらない文字列は kind=parse', () => {
    const payload = {
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'すみません読めません' }] } }],
    };
    expect(() => parseGeminiResponse(payload)).toThrowError(expect.objectContaining({ kind: 'parse' }));
  });

  it('商品ゼロは kind=empty', () => {
    expect(() => parseGeminiResponse(ok([{ sheet_index: 1, items: [] }]))).toThrowError(
      expect.objectContaining({ kind: 'empty' }),
    );
  });

  it('SAFETY 等で本文が無い場合は kind=api', () => {
    const payload = { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] };
    expect(() => parseGeminiResponse(payload)).toThrowError(expect.objectContaining({ kind: 'api' }));
  });

  it('欠損フィールドを安全側に埋める（qty_per_case null / cart_id 空）', () => {
    const sheets = parseGeminiResponse(
      ok([{ sheet_index: 1, items: [{ name: 'A', cases: 1 }, { name: '', cases: 3 }] }]),
    );
    expect(sheets[0]!.cartId).toBe('');
    expect(sheets[0]!.items).toHaveLength(1); // 名前なし行は捨てる
    expect(sheets[0]!.items[0]).toEqual({ name: 'A', code: '', qtyPerCase: null, cases: 1 });
  });

  it('数値が文字列で返っても数値化する', () => {
    const sheets = parseGeminiResponse(
      ok([{ sheet_index: '2', items: [{ name: 'A', qty_per_case: '24', cases: '3' }] }]),
    );
    expect(sheets[0]!.sheetIndex).toBe(2);
    expect(sheets[0]!.items[0]).toMatchObject({ qtyPerCase: 24, cases: 3 });
  });

  it('sheet_index 欠損時は並び順で補う', () => {
    const sheets = parseGeminiResponse(ok([{ items: [{ name: 'A', cases: 1 }] }, { items: [{ name: 'B', cases: 1 }] }]));
    expect(sheets.map((s) => s.sheetIndex)).toEqual([1, 2]);
  });
});

describe('extractText', () => {
  it('候補が無ければ空文字', () => {
    expect(extractText({})).toBe('');
    expect(extractText({ candidates: [] })).toBe('');
  });
});

// ---------------------------------------------------------------- 実行・分割

function mockFetch(responder: (body: unknown, call: number) => unknown) {
  let call = 0;
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const payload = responder(body, call++);
    return { json: async () => payload } as unknown as Response;
  });
  return fn as unknown as typeof fetch & { mock: { calls: unknown[][] } };
}

function sheetFor(names: string[], index: number) {
  return { sheet_index: index, cart_id: '', store: '', delivery_date: '', items: names.map((n) => ({ name: n, code: '', qty_per_case: 1, cases: 1 })) };
}

describe('runOcr', () => {
  it('APIキーは x-goog-api-key ヘッダで送り URL には載せない', async () => {
    const fetchFn = mockFetch(() => ok(SHEET_A));
    await runOcr([img(1)], { apiKey: 'SECRET', fetchFn });

    const [url, init] = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe(GEMINI_ENDPOINT);
    expect(url).not.toContain('SECRET');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('SECRET');
  });

  it('1リクエストで完了すれば requests=1', async () => {
    const fetchFn = mockFetch(() => ok(SHEET_A));
    const res = await runOcr([img(1), img(2)], { apiKey: 'k', fetchFn });
    expect(res.requests).toBe(1);
    expect(res.sheets).toHaveLength(1);
  });

  it('MAX_TOKENS なら画像を半分に割って2リクエストに分割する', async () => {
    const onSplit = vi.fn();
    const fetchFn = mockFetch((body) => {
      const parts = (body as { contents: { parts: { inline_data?: unknown }[] }[] }).contents[0]!.parts;
      const imageCount = parts.filter((p) => p.inline_data).length;
      if (imageCount === 4) return ok(SHEET_A, 'MAX_TOKENS');
      return ok([sheetFor([`chunk${imageCount}`], 1)]);
    });

    const res = await runOcr([img(1), img(2), img(3), img(4)], { apiKey: 'k', fetchFn, onSplit });

    expect(onSplit).toHaveBeenCalledWith(2);
    expect(res.requests).toBe(3); // 全体1回 + 前半 + 後半
    expect(res.sheets).toHaveLength(2);
    // 分割後も sheet_index は通し番号で振り直される
    expect(res.sheets.map((s) => s.sheetIndex)).toEqual([1, 2]);
  });

  it('分割は maxSplitDepth まで（無限再帰しない）', async () => {
    const fetchFn = mockFetch(() => ok(SHEET_A, 'MAX_TOKENS'));
    await expect(runOcr([img(1), img(2), img(3), img(4)], { apiKey: 'k', fetchFn, maxSplitDepth: 1 })).rejects.toThrow(
      GeminiError,
    );
    // 全体1回 + 前半1回（ここで深さ上限）→ 例外
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
  });

  it('1枚しか無ければ分割できず truncated のまま失敗する', async () => {
    const fetchFn = mockFetch(() => ok(SHEET_A, 'MAX_TOKENS'));
    await expect(runOcr([img(1)], { apiKey: 'k', fetchFn })).rejects.toThrowError(
      expect.objectContaining({ kind: 'truncated' }),
    );
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it('API エラーでは分割せず即座に失敗する', async () => {
    const fetchFn = mockFetch(() => ({ error: { message: 'quota' } }));
    await expect(runOcr([img(1), img(2)], { apiKey: 'k', fetchFn })).rejects.toThrowError(
      expect.objectContaining({ kind: 'api' }),
    );
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it('通信例外は kind=network', async () => {
    const fetchFn = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(runOcr([img(1)], { apiKey: 'k', fetchFn })).rejects.toThrowError(
      expect.objectContaining({ kind: 'network' }),
    );
  });

  it('画像ゼロは empty', async () => {
    await expect(runOcr([], { apiKey: 'k' })).rejects.toThrowError(expect.objectContaining({ kind: 'empty' }));
  });
});
