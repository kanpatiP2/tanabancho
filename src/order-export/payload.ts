/**
 * 発注リストの「PCへの流し込み」ペイロード生成（純ロジック）。
 *
 * 職場PCは USB ストレージがブロックされているため、発注データは
 *   (a) 改行入りQRコード → 2Dスキャナがキーボード入力として打鍵
 *   (b) ESP32 HIDブリッジ（BLE受信 → USBキーボードとして打鍵）
 * の2経路で渡す。どちらも「1行 = 1 JAN」のプレーンテキストが土台。
 *
 * このモジュールは DOM にも store にも触らない（テスト対象）。
 */
import type { Esp32Payload, OrderList } from '@core/types';

// ---------------------------------------------------------------- 行末

export type Eol = 'CRLF' | 'LF';

/** 行末トークン → 実際の制御文字 */
export function eolChars(eol: Eol): string {
  return eol === 'CRLF' ? '\r\n' : '\n';
}

// ---------------------------------------------------------------- JAN 行

export interface JanLinesOptions {
  eol: Eol;
  /**
   * true なら数量分だけ同じ JAN を繰り返す。
   * 既定（false）は数量に関係なく 1 JAN = 1行。
   * 発注端末は「JANを打つ → 個数を別途入力」という操作系が普通のため。
   */
  repeatByQty?: boolean;
}

/** 1行に許す最大繰り返し数（qty の異常値でペイロードが爆発するのを防ぐ） */
const MAX_REPEAT = 999;

/**
 * OrderList → JAN の行配列。
 *
 * - jan が空の行は捨てる
 * - qty <= 0 の行は捨てる（store 側で 0 になった行は削除されるが念のため）
 * - 並び順は list.lines のまま（スキャン順 = 売場を歩いた順なので保つ）
 * - OrderList.lines は jan 一意（store.bumpOrderLine が保証）なので重複排除はしない
 */
export function toJanLines(list: OrderList | null | undefined, opts: { repeatByQty?: boolean } = {}): string[] {
  const lines: string[] = [];
  for (const line of list?.lines ?? []) {
    const jan = String(line?.jan ?? '').trim();
    const qty = Number(line?.qty ?? 0);
    if (!jan || !Number.isFinite(qty) || qty <= 0) continue;
    const times = opts.repeatByQty ? Math.min(MAX_REPEAT, Math.floor(qty)) : 1;
    for (let i = 0; i < times; i++) lines.push(jan);
  }
  return lines;
}

/**
 * OrderList → 改行区切りのプレーンテキスト（QR に載せる本体）。
 *
 * 末尾に行末は付けない。最終行の確定はスキャナ側のサフィックス（Enter）や
 * ESP32 の 1行ごと ENTER 打鍵に任せる。
 */
export function buildJanLines(list: OrderList | null | undefined, opts: JanLinesOptions): string {
  return toJanLines(list, opts).join(eolChars(opts.eol));
}

// ---------------------------------------------------------------- バッチ分割

export type BatchSize = 20 | 30 | 50;

/** 1バッチあたりの行数で分割する。空配列なら [] */
export function splitBatches(lines: readonly string[], size: BatchSize): string[][] {
  const step = Math.max(1, Math.floor(size));
  const out: string[][] = [];
  for (let i = 0; i < lines.length; i += step) {
    out.push(lines.slice(i, i + step));
  }
  return out;
}

/** 行数からバッチ数を求める（splitBatches を作らずに件数だけ知りたい場合） */
export function batchCount(lineCount: number, size: BatchSize): number {
  const step = Math.max(1, Math.floor(size));
  return Math.max(0, Math.ceil(Math.max(0, lineCount) / step));
}

/**
 * 全バッチが読取済みか（発注リストの「出力済」表示に使う）。
 * 行が 0 件のときは false（出力していないので「出力済」ではない）。
 */
export function isFullyExported(
  exportedBatches: readonly number[] | undefined,
  lineCount: number,
  size: BatchSize,
): boolean {
  const total = batchCount(lineCount, size);
  if (total === 0) return false;
  const done = new Set(exportedBatches ?? []);
  for (let i = 0; i < total; i++) {
    if (!done.has(i)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- CRC16-CCITT

/** UTF-8 バイト列へ（ペイロードは ASCII のみだが、想定外の入力でも壊れないように） */
function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * CRC-16/CCITT-FALSE（多項式 0x1021 / 初期値 0xFFFF / 反転なし / 最終XORなし）。
 *
 * 既知ベクタ: '123456789' → 0x29B1 / '' → 0xFFFF / 'A' → 0xB915
 */
export function crc16Ccitt(input: string | Uint8Array): number {
  const bytes = typeof input === 'string' ? utf8Bytes(input) : input;
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= (byte & 0xff) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/** CRC 値 → ヘッダに載せる大文字4桁 hex */
export function crc16Hex(input: string | Uint8Array): string {
  return crc16Ccitt(input).toString(16).toUpperCase().padStart(4, '0');
}

// ---------------------------------------------------------------- ESP32 HID ペイロード

export interface Esp32Options {
  eol: Eol;
  /** inter-key delay: 1キーごとの待ち時間 ms（既定 15） */
  ikd?: number;
  /** inter-line delay: 1行打ち終わってからの待ち時間 ms（既定 120） */
  ild?: number;
}

export const ESP32_DEFAULT_IKD = 15;
export const ESP32_DEFAULT_ILD = 120;

/** ヘッダ/フッタのマジック（プロトコル v1） */
export const ESP32_MAGIC = '#TB1';

/**
 * ESP32 HIDブリッジ向けペイロード。
 *
 * ```
 * #TB1 BEGIN n=<件数> eol=ENTER ikd=15 ild=120 crc=<CRC16-CCITT 4hex>
 * <JAN>
 * ...
 * #TB1 END
 * ```
 *
 * - 全体の行区切りは opts.eol（CRLF / LF）。
 * - `eol=ENTER` は「1行打ち終わるごとに Enter キーを打鍵する」という
 *   ファーム側への指示であって、テキストの行区切り種別ではない。
 * - crc は **本文（JAN行を eol で連結した文字列）** に対する CRC16-CCITT。
 *   BEGIN行の行末直後から END行の直前の行末までの生バイトがそのまま対象になるので、
 *   ファーム側は受信バッファをそのまま CRC すれば検証できる。
 * - 0件のときも BEGIN/END は出す（n=0 / crc=FFFF = 空文字列の CRC）。
 */
export function buildEsp32Payload(lines: readonly string[], opts: Esp32Options): Esp32Payload {
  const sep = eolChars(opts.eol);
  const body = lines.join(sep);
  const crc = crc16Hex(body);
  const ikd = Math.max(0, Math.floor(opts.ikd ?? ESP32_DEFAULT_IKD));
  const ild = Math.max(0, Math.floor(opts.ild ?? ESP32_DEFAULT_ILD));
  const header = `${ESP32_MAGIC} BEGIN n=${lines.length} eol=ENTER ikd=${ikd} ild=${ild} crc=${crc}`;
  const footer = `${ESP32_MAGIC} END`;
  const text = [header, ...lines, footer].join(sep);
  return { text, crc, lineCount: lines.length };
}
