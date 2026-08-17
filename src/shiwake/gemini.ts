/**
 * Gemini 明細OCR。複数画像を 1 リクエストで処理する。
 *
 * v1 からの変更点:
 * - APIキーを URL クエリ `?key=` ではなく `x-goog-api-key` ヘッダで送る
 *   （URL はリファラ・プロキシログ・ブラウザ履歴に残るため）
 * - `responseMimeType: 'application/json'` + `responseSchema` による構造化出力を使い、
 *   コードフェンス除去の手動パースを廃止
 * - maxOutputTokens 8192 → 16384。それでも MAX_TOKENS で切れた場合は
 *   画像を半分に分けて再試行する（分割フォールバック）
 */

import { splitDataUrl, type SelectedImage } from './images';

export const GEMINI_MODEL = 'gemini-2.5-flash';
export const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
export const MAX_OUTPUT_TOKENS = 16384;

// ---------------------------------------------------------------- 型

export interface GeminiItem {
  name: string;
  /** 明細上の生コード（ITF-14 等）。無ければ '' */
  code: string;
  qtyPerCase: number | null;
  cases: number;
}

export interface GeminiSheet {
  sheetIndex: number;
  cartId: string;
  store: string;
  deliveryDate: string;
  items: GeminiItem[];
}

export type GeminiErrorKind = 'api' | 'parse' | 'truncated' | 'empty' | 'network';

export class GeminiError extends Error {
  readonly kind: GeminiErrorKind;
  constructor(kind: GeminiErrorKind, message: string) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind;
  }
}

export interface OcrResult {
  sheets: GeminiSheet[];
  /** 実際に投げた API リクエスト数（1 なら分割フォールバック未発動） */
  requests: number;
}

// ---------------------------------------------------------------- リクエスト組み立て

/** Gemini 構造化出力スキーマ（OpenAPI サブセット） */
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sheets: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          sheet_index: { type: 'INTEGER' },
          cart_id: { type: 'STRING', nullable: true },
          store: { type: 'STRING', nullable: true },
          delivery_date: { type: 'STRING', nullable: true },
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                code: { type: 'STRING', nullable: true },
                qty_per_case: { type: 'INTEGER', nullable: true },
                cases: { type: 'INTEGER' },
              },
              propertyOrdering: ['name', 'code', 'qty_per_case', 'cases'],
              required: ['name', 'cases'],
            },
          },
        },
        propertyOrdering: ['sheet_index', 'cart_id', 'store', 'delivery_date', 'items'],
        required: ['sheet_index', 'items'],
      },
    },
  },
  required: ['sheets'],
} as const;

export function buildPrompt(count: number): string {
  return `上記の${count}枚の納品明細書画像を読み取ってください。
- 画像は渡された順に「明細書 1枚目」「明細書 2枚目」…です。sheet_index はこの順番（1起点）で必ず埋めてください。
- 明細書ごとに 1 要素の sheets を作り、その明細書に載っている全商品を items に入れてください。
- name: 商品名（カタカナ・略称は明細の表記そのまま）
- code: 商品コード／JAN／ITF の数字のみ。読めなければ空文字
- qty_per_case: 入数（1ケースあたりの個数）。読めなければ null
- cases: ケース数
- cart_id: 仕器NO／カートID。無ければ空文字
- store: 店舗名。無ければ空文字
- delivery_date: 納品日（YYYY-MM-DD 形式が読み取れればその形式、無ければ空文字）
推測で商品を増やさず、明細に印字されている行だけを返してください。`;
}

export function buildRequestBody(images: readonly SelectedImage[]): unknown {
  const parts: unknown[] = [];
  images.forEach((img, i) => {
    const { mimeType, data } = splitDataUrl(img.dataUrl);
    parts.push({ inline_data: { mime_type: mimeType, data } });
    parts.push({ text: `[明細書 ${i + 1}枚目]` });
  });
  parts.push({ text: buildPrompt(images.length) });
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };
}

// ---------------------------------------------------------------- レスポンス解析

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) && v.trim() !== '' ? n : null;
  }
  return null;
}

/** candidates[0] の全 text パートを連結する（構造化出力でも複数パートに割れることがある） */
export function extractText(payload: unknown): string {
  const root = asRecord(payload);
  const candidates = root?.['candidates'];
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const content = asRecord(asRecord(candidates[0])?.['content']);
  const parts = content?.['parts'];
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => toStr(asRecord(p)?.['text'])).join('');
}

export function finishReasonOf(payload: unknown): string {
  const root = asRecord(payload);
  const candidates = root?.['candidates'];
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  return toStr(asRecord(candidates[0])?.['finishReason']);
}

function normalizeItem(raw: unknown): GeminiItem | null {
  const r = asRecord(raw);
  if (!r) return null;
  const name = toStr(r['name']);
  if (!name) return null;
  const code = toStr(r['code']).replace(/\D/g, '');
  const qty = toNum(r['qty_per_case']);
  const cases = toNum(r['cases']);
  return {
    name,
    code,
    qtyPerCase: qty !== null && qty > 0 ? Math.round(qty) : null,
    cases: cases !== null && cases > 0 ? Math.round(cases) : 0,
  };
}

function normalizeSheet(raw: unknown, fallbackIndex: number): GeminiSheet | null {
  const r = asRecord(raw);
  if (!r) return null;
  const rawItems = r['items'];
  const items = Array.isArray(rawItems)
    ? rawItems.map(normalizeItem).filter((i): i is GeminiItem => i !== null)
    : [];
  const idx = toNum(r['sheet_index']);
  return {
    sheetIndex: idx !== null && idx > 0 ? Math.round(idx) : fallbackIndex + 1,
    cartId: toStr(r['cart_id']),
    store: toStr(r['store']),
    deliveryDate: toStr(r['delivery_date']),
    items,
  };
}

/**
 * Gemini のレスポンス JSON 全体から sheets を取り出す。
 * - `error` があれば GeminiError('api')
 * - finishReason が MAX_TOKENS なら GeminiError('truncated')（分割フォールバックの発火点）
 * - JSON として読めない／sheets が配列でないなら GeminiError('parse')
 * - 商品が 1 件も取れなければ GeminiError('empty')
 */
export function parseGeminiResponse(payload: unknown): GeminiSheet[] {
  const root = asRecord(payload);
  const err = asRecord(root?.['error']);
  if (err) throw new GeminiError('api', toStr(err['message']) || 'Gemini API エラー');

  const finish = finishReasonOf(payload);
  const text = extractText(payload);

  if (finish === 'MAX_TOKENS') {
    throw new GeminiError('truncated', '出力が長すぎて途中で切れました');
  }
  if (finish && finish !== 'STOP' && !text) {
    throw new GeminiError('api', `Gemini が応答を返しませんでした（${finish}）`);
  }
  if (!text.trim()) throw new GeminiError('empty', '読み取り結果が空でした');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 構造化出力でも稀に途中で切れることがある。切断か純粋な形式崩れかを見分ける
    throw new GeminiError(
      /[,{[]\s*$|"[^"]*$/.test(text.trim()) ? 'truncated' : 'parse',
      '読み取り結果を解釈できませんでした',
    );
  }

  const rawSheets = Array.isArray(parsed) ? parsed : asRecord(parsed)?.['sheets'];
  if (!Array.isArray(rawSheets)) {
    throw new GeminiError('parse', '読み取り結果の形式が想定と異なります');
  }

  const sheets = rawSheets
    .map((s, i) => normalizeSheet(s, i))
    .filter((s): s is GeminiSheet => s !== null);

  if (!sheets.some((s) => s.items.length > 0)) {
    throw new GeminiError('empty', '明細から商品を読み取れませんでした');
  }
  return sheets;
}

// ---------------------------------------------------------------- 実行

export interface RunOcrOptions {
  apiKey: string;
  /** テスト用に差し替え可能 */
  fetchFn?: typeof fetch;
  /** 分割フォールバックの最大深さ（既定 2 = 最大 4 リクエストまで） */
  maxSplitDepth?: number;
  /** 分割フォールバック発動の通知 */
  onSplit?: (chunkSize: number) => void;
  signal?: AbortSignal;
}

async function requestOnce(images: readonly SelectedImage[], opts: RunOcrOptions): Promise<GeminiSheet[]> {
  const doFetch = opts.fetchFn ?? globalThis.fetch;
  let payload: unknown;
  try {
    const res = await doFetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': opts.apiKey,
      },
      body: JSON.stringify(buildRequestBody(images)),
      signal: opts.signal,
    });
    payload = await res.json();
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    throw new GeminiError('network', e instanceof Error ? e.message : '通信に失敗しました');
  }
  return parseGeminiResponse(payload);
}

/** 分割した結果を結合し、sheet_index を通し番号で振り直す */
function mergeSheets(groups: GeminiSheet[][]): GeminiSheet[] {
  const out: GeminiSheet[] = [];
  for (const g of groups) {
    for (const s of g) out.push({ ...s, sheetIndex: out.length + 1 });
  }
  return out;
}

/**
 * OCR 本体。MAX_TOKENS で切れたら画像を半分に割って再帰的に再試行する。
 * 1枚まで割っても切れる場合は truncated のまま throw（呼び出し側でメッセージ表示）。
 */
export async function runOcr(images: readonly SelectedImage[], opts: RunOcrOptions): Promise<OcrResult> {
  if (!images.length) throw new GeminiError('empty', '画像が選択されていません');
  const maxDepth = opts.maxSplitDepth ?? 2;

  const run = async (chunk: readonly SelectedImage[], depth: number): Promise<OcrResult> => {
    try {
      return { sheets: await requestOnce(chunk, opts), requests: 1 };
    } catch (e) {
      const canSplit = e instanceof GeminiError && e.kind === 'truncated' && chunk.length >= 2 && depth < maxDepth;
      if (!canSplit) throw e;
      const mid = Math.ceil(chunk.length / 2);
      opts.onSplit?.(mid);
      const head = await run(chunk.slice(0, mid), depth + 1);
      const tail = await run(chunk.slice(mid), depth + 1);
      return {
        sheets: mergeSheets([head.sheets, tail.sheets]),
        // 切れて捨てた 1 回分も「投げたリクエスト」として数える
        requests: head.requests + tail.requests + 1,
      };
    }
  };

  return run(images, 0);
}
