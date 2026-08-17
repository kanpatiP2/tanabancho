/**
 * データモデル v2 — 全モジュール共通の「契約書」。
 * 並行実装の基準となるため、変更する場合は必ず全タスクへの影響を確認すること。
 *
 * 共通原則:
 * - id は crypto.randomUUID()。v1 由来のものは _legacyId に旧IDを保持する
 * - 日時はすべて ISO 8601 文字列（createdAt / updatedAt）。表示形式への変換は core/datetime.ts
 * - 日付のみのフィールド（expiry 等）は 'YYYY-MM-DD'。空は ''
 */

// ---------------------------------------------------------------- 基本

export type ISODateTime = string; // '2026-08-17T09:12:34.000Z'
export type DateOnly = string; // '2026-08-17' or ''

export interface Entity {
  id: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** v1 からの移行時のみ。共有URL往復の重複判定に使う */
  _legacyId?: string;
  /** v1 の time フィールドから日付を復元できなかった場合 true */
  _approxDate?: boolean;
}

// ---------------------------------------------------------------- POP

export type PopEnlarge = '' | 'A4' | 'A3' | 'A2';

export interface PopDetail {
  /** 号数。プロファイル語彙（Profile.vocab.popSizes）のいずれか */
  size: string;
  qty: number;
  /** ラミネート有無 */
  lami: boolean;
  /** 拡大印刷 */
  enlarge: PopEnlarge;
  /** 作業委託先。'' = 自分 */
  assignee: string;
}

// ---------------------------------------------------------------- スキャン履歴

export interface ScanItem extends Entity {
  /** 正規化済みバーコード（JAN13/EAN8/その他コード） */
  jan: string;
  name: string;
  memo: string;
  genre: string;
  end: boolean;
  pop: PopDetail[];
  /** 発注種別。プロファイル語彙（Profile.vocab.orderTypes）の部分集合 */
  order: string[];
  /** 消費/賞味期限 */
  expiry: DateOnly;
  boxJan: string;
  protected: boolean;
  /** true なら辞書（Product）へ学習しない */
  noLearn: boolean;
}

// ---------------------------------------------------------------- 学習辞書

export type NameSource = 'manual' | 'gemini' | 'ext';

export interface Product {
  jan: string;
  name: string;
  /** 上書き優先度: manual > gemini > ext（core/dict.ts の mergeProduct が強制する） */
  nameSource: NameSource;
  boxJan: string;
  /** 期限入力の学習: (expiry - 記録日) の日数。最新5件保持、提案は最頻値 */
  expiryOffsets: number[];
  /** この商品の前回 POP 組合せ */
  popPreset?: PopDetail[];
  lastUsedAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ---------------------------------------------------------------- 客注・競合・返品

export type DeliveryTime = '' | '開店' | '午前' | '午後' | '夕方' | '夜' | `${number}:${number}`;

export interface CustomerOrder extends Entity {
  jan: string;
  name: string;
  qty: number;
  caseQty: number;
  /** 発注登録済 */
  ordered: boolean;
  arrivalDate: DateOnly;
  deliveryDate: DateOnly;
  deliveryTime: DeliveryTime;
  phone: string;
  willCall: boolean;
  called: boolean;
  memo: string;
  dismissedArrival: boolean;
  dismissedDelivery: boolean;
  addedToHistory: boolean;
}

export type CompetitorReason = 'ヘッダー変更' | '売価変更' | '新規導入' | '廃番' | 'その他';

export interface Competitor extends Entity {
  date: DateOnly;
  jan: string;
  name: string;
  reason: CompetitorReason;
  memo: string;
  dismissed: boolean;
}

export interface ReturnItem extends Entity {
  jan: string;
  start: DateOnly;
  end: DateOnly;
  returnDate: DateOnly;
  memo: string;
  dismissed: boolean;
}

// ---------------------------------------------------------------- ノート（メモ+リマインダー+便メモ統合）

export interface Note extends Entity {
  title: string;
  text: string;
  /** NOTE_COLORS のいずれか */
  color: string;
  pinned: boolean;
  /** 設定すると「今日」フィードにリマインダーとして浮上する */
  remindAt?: ISODateTime;
  /** リマインダー発火済み日時 */
  firedAt?: ISODateTime;
  /** 'bin-memo' = 仕分番長の便メモ由来 */
  tag?: string;
}

export const NOTE_COLORS = ['#ffffff', '#fff9c4', '#d4edda', '#d1ecf1', '#f8d7da', '#e2d9f3'] as const;

// ---------------------------------------------------------------- 発注リスト

export interface OrderLine {
  jan: string;
  qty: number;
}

export interface OrderList extends Entity {
  /** 表示名（既定は作成日 'YYYY-MM-DD'） */
  label: string;
  lines: OrderLine[];
  /** QR出力で「読取済」にしたバッチ番号（0起点） */
  exportedBatches: number[];
}

// ---------------------------------------------------------------- 仕分番長

export interface ShiwakeItem {
  id: string;
  name: string;
  /** 明細上の生コード（ITF-14等）。null 相当は '' */
  code: string;
  jan: string;
  qtyPerCase: number | null;
  cases: number;
  cartIndex: number;
  memo: string;
  isAlert: boolean;
  /** 客注照合ヒット時に該当 CustomerOrder.id */
  custOrderId?: string;
}

export interface ShiwakeCart {
  index: number;
  label: string;
  deliveryDate: DateOnly;
}

export interface ShiwakeState {
  items: ShiwakeItem[];
  carts: ShiwakeCart[];
  alertWords: string[];
  updatedAt: ISODateTime;
}

// ---------------------------------------------------------------- 設定・プロファイル

export type ProfileKey = 'generic' | 'jisha';

export interface Profile {
  key: ProfileKey;
  label: string;
  vocab: {
    popSizes: string[];
    shortageCategories: string[];
    orderTypes: string[];
  };
  features: {
    leadingZeroHighlight: boolean;
    notes: boolean;
  };
}

export type CameraPresetKey = 'default' | 'fast' | 'custom';

export interface Settings {
  profile: ProfileKey;
  theme: 'auto' | 'light' | 'dark';
  cameraPreset: CameraPresetKey;
  cameraFps: number;
  cameraFocusMode: '' | 'continuous';
  tallBarcodeMode: boolean;
  /** 起動時の入力モード */
  inputSource: 'camera' | 'wedge';
  /** 期限パッドのオフセットチップ構成（日数） */
  expiryChips: number[];
  /** POP プリセット（名前付き組合せ） */
  popPresets: { label: string; pop: PopDetail[] }[];
  /** 委託先候補 */
  assignees: string[];
  /** QR/ESP32 出力の行末 */
  exportEol: 'CRLF' | 'LF';
  /** QR バッチサイズ */
  qrBatchSize: 20 | 30 | 50;
  historySort: 'newest' | 'oldest' | 'genre' | 'name';
  custSort: 'arrival' | 'delivery';
  lastBackupAt: ISODateTime | '';
}

export interface MetaV2 {
  schemaVersion: 2;
  migratedAt: ISODateTime | '';
  migratedFrom: string[];
}

// ---------------------------------------------------------------- ストレージキー

/** v2 キー。値の型は各コレクションの配列/オブジェクト（JSON化して保存） */
export const KEYS = {
  meta: 'tb.v2.meta', // MetaV2
  settings: 'tb.v2.settings', // Settings
  scans: 'tb.v2.scans', // ScanItem[]
  products: 'tb.v2.products', // Record<jan, Product>
  comp: 'tb.v2.comp', // Competitor[]
  returns: 'tb.v2.returns', // ReturnItem[]
  cust: 'tb.v2.cust', // CustomerOrder[]
  notes: 'tb.v2.notes', // Note[]
  orders: 'tb.v2.orders', // OrderList[]
  shiwake: 'sb.v2.state', // ShiwakeState
  shiwakeMeta: 'sb.v2.meta', // MetaV2
  shareRecv: 'tb.share.v2', // share ビューの受信キャッシュ ScanItem[]
} as const;

/** v1 キー（読み取り専用。migrate 後も削除しない） */
export const LEGACY_KEYS = {
  list: 'barcode_master_list',
  db: 'barcode_master_db',
  comp: 'barcode_master_comp',
  return: 'barcode_master_return',
  cust: 'barcode_master_cust',
  reminders: 'barcode_master_reminders',
  notes: 'barcode_master_notes',
  shareTanabancho: 'tanabancho_share',
  shareSellfloor: 'sellfloor_share',
  sbItems: 'sb_items',
  sbCarts: 'sb_carts',
  sbAlertWords: 'sb_alert_words',
  sbGlobalMemo: 'sb_global_memo',
  sbMemoHistory: 'sb_memo_history',
  sbApiKey: 'sb_api_key',
} as const;

// ---------------------------------------------------------------- スキャン

export type ScanIntent = 'capture' | 'expiry' | 'pop' | 'order' | 'compCheck' | 'field';
export type CodeSource = 'camera' | 'wedge' | 'manual';

/** バーコード正規化の結果（core/jan.ts resolveCode） */
export interface ResolvedCode {
  /** 正規化済み（ITF-14→JAN13 変換・箱JAN→バラJAN 置換適用後） */
  jan: string;
  /** 読み取った生コード */
  raw: string;
  /** ITF-14 から変換された場合 true */
  fromItf: boolean;
  /** 箱JAN 学習から置換された場合 true */
  fromBoxJan: boolean;
  leadingZero: boolean;
}

/** カメラ/ウェッジ/手入力の統一コールバック */
export type OnCodeInput = (code: string, source: CodeSource) => void;

export interface ScannerAdapter {
  /** 'bd' = BarcodeDetector, 'h5' = html5-qrcode */
  readonly kind: 'bd' | 'h5';
  start(videoContainerId: string, onDetect: (raw: string) => void): Promise<void>;
  stop(): Promise<void>;
  readonly running: boolean;
}

// ---------------------------------------------------------------- 外部JAN照会

export interface LookupResult {
  jan: string;
  name: string;
  maker?: string;
  provider: string;
}

export interface LookupProvider {
  readonly name: string;
  /** 見つからなければ null。ネットワーク/レート制限エラーは throw */
  lookup(jan: string): Promise<LookupResult | null>;
}

// ---------------------------------------------------------------- 共有プロトコル

/** URL に載せる短縮形式（v1 互換のキー名を維持しつつ v2 で拡張） */
export interface ShareSlimItem {
  id: string;
  c: string; // code/jan
  t: string; // 表示時刻 'HH:MM'（v2 では createdAt から導出して格納）
  n?: string; // name
  m?: string; // memo
  g?: string; // genre
  p?: 0 | 1; // pop有無
  pd?: PopDetail[];
  e?: 0 | 1; // end
  o?: string[]; // order
  x?: string; // expiry（v2 追加）
}

export interface ShareEnvelopeV2 {
  v: 2;
  app: 'tb';
  ts: ISODateTime;
  items: ShareSlimItem[];
}

// ---------------------------------------------------------------- バックアップ

export interface BackupV2 {
  formatVersion: 2;
  exportedAt: ISODateTime;
  scans: ScanItem[];
  products: Record<string, Product>;
  comp: Competitor[];
  returns: ReturnItem[];
  cust: CustomerOrder[];
  notes: Note[];
  orders: OrderList[];
  settings: Settings;
  shiwake?: ShiwakeState;
}

/** v1 バックアップ（exportData 出力）。取込時は migrate 経由で v2 化する */
export interface BackupV1 {
  list?: unknown[];
  db?: Record<string, unknown>;
  comp?: unknown[];
  return?: unknown[];
  cust?: unknown[];
  notes?: unknown[];
  date?: string;
  title?: string;
}

// ---------------------------------------------------------------- 発注エクスポート

export interface Esp32Payload {
  /** '#TB1 BEGIN n=.. eol=.. ikd=.. ild=.. crc=..' 形式の全文 */
  text: string;
  crc: string;
  lineCount: number;
}
