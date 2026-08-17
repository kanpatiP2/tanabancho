/**
 * 「スキャンで入力」（field intent）の受け渡し。
 *
 * v1 の activeSideScanType / activeCompScan / activeBoxJanScanId に相当する one-shot 入力を、
 * `@scanner/session` の field intent に載せて実現する。責務分担:
 *
 *   1. 各画面の入力欄 … `requestFieldScan()` を呼ぶ（＋ `useFieldScan()` で結果を受け取る）
 *   2. FieldScanSheet  … カメラ/ウェッジ/手入力を受けて `deliverFieldScan()` を呼ぶ
 *   3. session         … 1件読んだら直前の intent へ自動復帰する
 *
 * 画面遷移をせずボトムシートで読むので、呼び出し元の入力途中の状態（客注フォーム等）は保持される。
 * 同じ画面に複数の JAN 欄が同時に出る（客注の新規フォームと行内編集）ため、
 * `kind` は呼び出し側で一意にする（例 `custJan:new` / `custJan:<id>`）。
 */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { FieldScanEvent, FieldTarget } from '@scanner/session';
import { beginFieldScan, cancelFieldScan } from '../scan-bridge';

export interface FieldScanRequest {
  /** 流し込み先の識別子（`useFieldScan` の kind と一致させる） */
  kind: string;
  /** シートの見出しに出す説明。例 '返品のJAN' */
  label: string;
  /** 対象レコードの id（箱JAN 登録など） */
  id?: string;
  /** 14桁を ITF-14 として JAN13 に変換する。既定 true */
  convertItf?: boolean;
  /** 箱JAN→バラJAN の学習置換を適用する。既定 true */
  applyBoxJanLookup?: boolean;
}

export interface FieldScanValue {
  kind: string;
  /** 正規化後のコード（request の convertItf / applyBoxJanLookup に従う） */
  jan: string;
  raw: string;
  /** 同じ値を続けて読んだときも再適用できるようにする通し番号 */
  seq: number;
}

/** 読み取り待ちの要求。非 null の間だけ FieldScanSheet が開く */
export const fieldScanRequest = signal<FieldScanRequest | null>(null);
/** 読み取れた値。対象の画面が消費する（消費したら null に戻す） */
export const fieldScanValue = signal<FieldScanValue | null>(null);

let seq = 0;

/** 入力欄の「📷 スキャン」ボタンから呼ぶ */
export function requestFieldScan(req: FieldScanRequest): void {
  const target: FieldTarget = { kind: req.kind };
  if (req.id !== undefined) target.id = req.id;
  if (req.convertItf !== undefined) target.convertItf = req.convertItf;
  if (req.applyBoxJanLookup !== undefined) target.applyBoxJanLookup = req.applyBoxJanLookup;
  fieldScanValue.value = null;
  fieldScanRequest.value = req;
  beginFieldScan(target);
}

/** session の onField から呼ぶ（FieldScanSheet が結線する） */
export function deliverFieldScan(ev: FieldScanEvent): void {
  seq += 1;
  fieldScanValue.value = { kind: ev.target.kind, jan: ev.jan, raw: ev.raw, seq };
  fieldScanRequest.value = null;
}

/** シートを閉じる/キャンセルする。session の field も畳んで元の intent へ戻す */
export function abortFieldScan(): void {
  if (fieldScanRequest.value) cancelFieldScan();
  fieldScanRequest.value = null;
}

/**
 * 指定 kind への流し込みを受け取る（受け取った値は消費して消す）。
 * `apply` は最新のクロージャが呼ばれるように毎描画で受け直す。
 */
export function useFieldScan(kind: string, apply: (jan: string) => void): void {
  const value = fieldScanValue.value;
  const hit = value && value.kind === kind ? value : null;
  useEffect(() => {
    if (!hit) return;
    fieldScanValue.value = null;
    apply(hit.jan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit?.seq]);
}
