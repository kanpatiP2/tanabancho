/**
 * 履歴の「画像化」— legacy の createMergedImage を移植したもの。
 *
 * 構成:
 * - 純関数（フィルタ / チャンク分割 / レイアウト計算 / バッジ組み立て）… テスト対象
 * - Canvas 描画（renderChunk / createMergedImages）… ブラウザでのみ動く薄い層
 *
 * legacy との差分:
 * - 進捗はコールバックで返し、DOM を直接触らない（描画と副作用の分離）
 * - フィルタ・チャンク分割・レイアウトを純関数に切り出した
 *
 * 配色について:
 * 生成物は「印刷・共有される画像」でありテーマに追従してはいけない（ダークテーマ端末で
 * 作った画像が白紙に黒で刷れなくなる）。そのため、この module 内の色だけは tokens.css の
 * 変数ではなく印刷向けの固定パレット（PALETTE / buildBadges）を使う。UI 側の色は
 * 従来どおり tokens.css の変数のみを使うこと。
 */
import JsBarcode from 'jsbarcode';
import type { PopDetail, ScanItem } from '@core/types';
import { barcodeFormat } from '@core/jan';

// ---------------------------------------------------------------- フィルタ

export interface MergeFilter {
  /** '' = 全て */
  genre: string;
  memo: string;
  order: string;
  popOnly: boolean;
  orderOnly: boolean;
  /** 任意選択モードで選ばれた id。null なら全件 */
  selectedIds: Set<string> | null;
  sortByGenre: boolean;
}

export const EMPTY_FILTER: MergeFilter = {
  genre: '',
  memo: '',
  order: '',
  popOnly: false,
  orderOnly: false,
  selectedIds: null,
  sortByGenre: false,
};

export function applyMergeFilter(items: ScanItem[], f: MergeFilter): ScanItem[] {
  let out = f.selectedIds ? items.filter((i) => f.selectedIds!.has(i.id)) : [...items];
  if (f.genre) out = out.filter((i) => i.genre === f.genre);
  if (f.memo) out = out.filter((i) => i.memo === f.memo);
  if (f.order) out = out.filter((i) => i.order.includes(f.order));
  if (f.popOnly) out = out.filter((i) => i.pop.length > 0);
  if (f.orderOnly) out = out.filter((i) => i.order.length > 0);
  if (f.sortByGenre) out.sort((a, b) => (a.genre || '').localeCompare(b.genre || '', 'ja'));
  return out;
}

export const MAX_ITEMS_PER_IMAGE = 20;

export function chunkItems<T>(items: T[], size = MAX_ITEMS_PER_IMAGE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// ---------------------------------------------------------------- 表示ヘルパ

/** POP 詳細の 1 行表記 '(7号x2, 競合)' */
export function formatPopDetails(details: PopDetail[]): string {
  if (!details.length) return '';
  const parts = details.map((d) => {
    const base = d.qty > 1 && d.size !== '競合' ? `${d.size}x${d.qty}` : d.size;
    const extras = [d.lami ? 'ラミ' : '', d.enlarge, d.assignee].filter(Boolean).join('/');
    return extras ? `${base}[${extras}]` : base;
  });
  return `(${parts.join(', ')})`;
}

export interface ImageBadge {
  text: string;
  bg: string;
  fg: string;
}

/** 画像に載せるバッジ列。白紙に刷る前提の固定色を使う（テーマ非追従） */
export function buildBadges(item: ScanItem): ImageBadge[] {
  const badges: ImageBadge[] = [];
  const orderColors: Record<string, [string, string]> = {
    '発注(上げ)': ['#c0392b', '#ffffff'],
    '発注(下げ)': ['#1f6fd0', '#ffffff'],
    '指数変更(上げ)': ['#b8377a', '#ffffff'],
    '指数変更(下げ)': ['#12869b', '#ffffff'],
  };
  for (const o of item.order) {
    const c = orderColors[o] ?? ['#d1701a', '#ffffff'];
    badges.push({ text: o, bg: c[0], fg: c[1] });
  }
  if (item.end) badges.push({ text: 'エンド', bg: '#b8377a', fg: '#ffffff' });
  if (item.pop.length) {
    const isComp = item.pop.some((p) => p.size === '競合');
    badges.push({
      text: `POP${formatPopDetails(item.pop)}`,
      bg: isComp ? '#1e7e34' : '#e0a800',
      fg: isComp ? '#ffffff' : '#111111',
    });
  }
  if (item.genre) {
    badges.push({
      text: item.genre,
      bg: item.genre === '競合ヘッダー' ? '#1e7e34' : '#5c3fa8',
      fg: '#ffffff',
    });
  }
  if (item.expiry) badges.push({ text: `期限 ${item.expiry}`, bg: '#e9ecef', fg: '#333333' });
  if (item.memo) badges.push({ text: item.memo, bg: '#e9ecef', fg: '#333333' });
  return badges;
}

/** 商品名未設定時の代替表示テキスト */
export function altInfoText(item: ScanItem): string {
  const parts: string[] = [];
  if (item.genre) parts.push(item.genre);
  if (item.pop.length) parts.push(`POP${formatPopDetails(item.pop)}`);
  parts.push(...item.order);
  if (item.end) parts.push('エンド');
  if (item.expiry) parts.push(`期限 ${item.expiry}`);
  if (item.memo) parts.push(item.memo);
  return parts.join(' / ');
}

// ---------------------------------------------------------------- レイアウト

export const LAYOUT = {
  canvasWidth: 900,
  titleHeight: 80,
  headerH: 22,
  itemHeight: 155,
  numColW: 52,
  bcColW: 230,
  bottomPad: 8,
} as const;

export function infoColX(): number {
  return LAYOUT.numColW + LAYOUT.bcColW;
}

export function infoColW(): number {
  return LAYOUT.canvasWidth - infoColX() - 12;
}

export function canvasHeightFor(itemCount: number): number {
  return LAYOUT.titleHeight + LAYOUT.headerH + LAYOUT.itemHeight * itemCount + LAYOUT.bottomPad;
}

/** 1 枚目の 1 件目を 1 として通し番号を振る */
export function displayNumber(chunkIndex: number, indexInChunk: number, chunkSize = MAX_ITEMS_PER_IMAGE): number {
  return chunkIndex * chunkSize + indexInChunk + 1;
}

/** チャンクが複数あるときだけ '(1/3)' を付ける */
export function chunkTitle(userTitle: string, chunkIndex: number, chunkCount: number): string {
  const t = userTitle.trim();
  if (chunkCount <= 1) return t;
  return t ? `${t} (${chunkIndex + 1}/${chunkCount})` : `(${chunkIndex + 1}/${chunkCount})`;
}

// ---------------------------------------------------------------- 描画（ブラウザ専用）

/** 印刷向け固定パレット（テーマに追従させない。理由はファイル冒頭のコメント参照） */
const PALETTE = {
  paper: '#ffffff',
  paperAlt: '#f7f8f9',
  titleBg: '#1a1a2e',
  titleFg: '#ffffff',
  headerBg: '#2e2e2e',
  headerFg: '#bbbbbb',
  rule: '#e0e0e0',
  ink: '#111111',
  inkSub: '#999999',
  inkFaint: '#bbbbbb',
} as const;

function drawBarcode(canvas: HTMLCanvasElement, code: string, background: string): boolean {
  const opts = {
    format: barcodeFormat(code),
    width: 2.2,
    height: 72,
    displayValue: false,
    margin: 0,
    background,
  };
  try {
    JsBarcode(canvas, code, opts);
    return canvas.width > 0;
  } catch {
    try {
      JsBarcode(canvas, code, { ...opts, format: 'CODE128' });
      return canvas.width > 0;
    } catch {
      return false;
    }
  }
}

/** 幅に収まらない文字列を 2 行に割る（legacy と同じ近似分割） */
function fillWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  font1: string,
  font2: string,
  lineGap: number,
): void {
  ctx.font = font1;
  const w = ctx.measureText(text).width;
  if (w <= maxWidth) {
    ctx.fillText(text, x, y + 4);
    return;
  }
  const mid = Math.max(1, Math.floor(text.length * (maxWidth / w)));
  ctx.fillText(text.slice(0, mid), x, y);
  ctx.font = font2;
  ctx.fillText(text.slice(mid), x, y + lineGap);
}

export interface RenderOptions {
  title: string;
  onProgress?: (done: number, total: number) => void;
}

/** 1 チャンク分の canvas を描く */
export async function renderChunk(
  chunk: ScanItem[],
  chunkIndex: number,
  chunkCount: number,
  opts: RenderOptions & { totalItems: number; doneBefore: number },
): Promise<HTMLCanvasElement> {
  const { canvasWidth, titleHeight, headerH, itemHeight, numColW, bcColW } = LAYOUT;
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeightFor(chunk.length);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context を取得できませんでした');

  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // タイトルバー
  ctx.fillStyle = PALETTE.titleBg;
  ctx.fillRect(0, 0, canvasWidth, titleHeight);
  const title = chunkTitle(opts.title, chunkIndex, chunkCount);
  if (title) {
    ctx.fillStyle = PALETTE.titleFg;
    ctx.font = '500 32px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, 14, 50);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = 'normal 13px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(new Date().toLocaleDateString('ja-JP'), canvasWidth - 10, titleHeight - 9);

  // カラムヘッダー
  ctx.fillStyle = PALETTE.headerBg;
  ctx.fillRect(0, titleHeight, canvasWidth, headerH);
  ctx.fillStyle = PALETTE.headerFg;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('NO.', numColW / 2, titleHeight + 15);
  ctx.fillText('バーコード', numColW + bcColW / 2, titleHeight + 15);
  ctx.textAlign = 'left';
  ctx.fillText('商品情報', infoColX() + 12, titleHeight + 15);

  const rowStartY = titleHeight + headerH;
  const ix = infoColX() + 12;
  const iw = infoColW();

  for (let index = 0; index < chunk.length; index++) {
    const item = chunk[index]!;
    const yBase = rowStartY + index * itemHeight;
    const bg = index % 2 === 0 ? PALETTE.paper : PALETTE.paperAlt;

    ctx.fillStyle = bg;
    ctx.fillRect(0, yBase, canvasWidth, itemHeight);

    ctx.strokeStyle = PALETTE.rule;
    ctx.lineWidth = 0.8;
    for (const gx of [numColW, infoColX()]) {
      ctx.beginPath();
      ctx.moveTo(gx, yBase);
      ctx.lineTo(gx, yBase + itemHeight);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, yBase);
    ctx.lineTo(canvasWidth, yBase);
    ctx.stroke();

    // 番号
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.inkSub;
    ctx.font = 'normal 9px sans-serif';
    ctx.fillText('NO.', numColW / 2, yBase + 18);
    ctx.fillStyle = PALETTE.titleBg;
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(String(displayNumber(chunkIndex, index)).padStart(3, '0'), numColW / 2, yBase + 48);

    // バーコード
    const bc = document.createElement('canvas');
    if (drawBarcode(bc, item.jan, bg)) {
      ctx.drawImage(bc, numColW + (bcColW - bc.width) / 2, yBase + 12);
      ctx.fillStyle = PALETTE.ink;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(item.jan, numColW + bcColW / 2, yBase + 12 + bc.height + 14);
    }

    // 情報列
    ctx.textAlign = 'left';
    const hasName = item.name.trim() !== '';
    if (hasName) {
      ctx.fillStyle = PALETTE.ink;
      fillWrapped(ctx, item.name, ix, yBase + 28, iw, '500 20px sans-serif', '500 17px sans-serif', 22);
    } else {
      ctx.fillStyle = PALETTE.inkFaint;
      ctx.font = 'normal 10px sans-serif';
      ctx.fillText('商品名未設定', ix, yBase + 16);
      const alt = altInfoText(item);
      if (alt) {
        ctx.fillStyle = '#222222';
        fillWrapped(ctx, alt, ix, yBase + 36, iw, 'bold 19px sans-serif', 'bold 16px sans-serif', 22);
      }
    }

    if (hasName) {
      ctx.font = 'bold 12px sans-serif';
      let bx = ix;
      let row = 0;
      const by0 = yBase + 62;
      const bh = 22;
      for (const b of buildBadges(item)) {
        const text = b.text.length > 16 ? `${b.text.slice(0, 16)}…` : b.text;
        const bw = ctx.measureText(text).width + 16;
        if (bx + bw > canvasWidth - 8) {
          bx = ix;
          row++;
        }
        const by = by0 + row * 28;
        ctx.fillStyle = b.bg;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, bw, bh, 4);
        else ctx.rect(bx, by, bw, bh);
        ctx.fill();
        ctx.fillStyle = b.fg;
        ctx.fillText(text, bx + 8, by + 15);
        bx += bw + 5;
      }
    }

    opts.onProgress?.(opts.doneBefore + index + 1, opts.totalItems);
    if (index % 5 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  return canvas;
}

export interface MergedImage {
  url: string;
  index: number;
}

/** 全チャンクを描いて Blob URL を返す。呼び出し側で revokeObjectURL すること */
export async function createMergedImages(
  items: ScanItem[],
  opts: RenderOptions,
): Promise<MergedImage[]> {
  const chunks = chunkItems(items);
  const out: MergedImage[] = [];
  let done = 0;
  for (let c = 0; c < chunks.length; c++) {
    const canvas = await renderChunk(chunks[c]!, c, chunks.length, {
      ...opts,
      totalItems: items.length,
      doneBefore: done,
    });
    done += chunks[c]!.length;
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
    if (blob) out.push({ url: URL.createObjectURL(blob), index: c });
  }
  return out;
}

/** ファイル名 'タイトル_2026-08-17_1.jpg' */
export function mergedFileName(title: string, index: number, total: number): string {
  const base = title.trim() || 'barcodes';
  const date = new Date().toISOString().slice(0, 10);
  const suffix = total > 1 ? `_${index + 1}` : '';
  return `${base}_${date}${suffix}.jpg`;
}
