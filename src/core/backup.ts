/**
 * バックアップ I/O。
 *
 * - exportBackup: v2 の全コレクションを1ファイルに書き出す
 *   （v1 の exportData は list/db/comp/return/cust しか出さず、
 *    リマインダー・メモ・設定が失われていた。v2 では網羅する）
 * - importBackup: v2 形式はバリデーションして結合、v1 形式は migrate の変換関数を
 *   再利用して v2 化してから結合する。既存データは消さない（_legacyId / id で重複除外）
 */

import { nowIso } from './datetime';
import { mergeProduct } from './dict';
import {
  convertCompetitor,
  convertCustomerOrder,
  convertNote,
  convertProducts,
  convertReturnItem,
  convertScanList,
  dedupeByLegacyId,
  newId,
  normalizeOrder,
  normalizePop,
  toArray,
  toBool,
  toNum,
  toRecord,
  toStr,
  dateOnly,
} from './migrate';
import {
  collectionEntry,
  getCollection,
  writeBatch,
  type CollectionName,
  type StorageSchema,
} from './storage';
import type {
  BackupV2,
  Competitor,
  CustomerOrder,
  Entity,
  ISODateTime,
  Note,
  OrderLine,
  OrderList,
  PopDetail,
  Product,
  ReturnItem,
  ScanItem,
  Settings,
  ShiwakeState,
} from './types';
import { NOTE_COLORS } from './types';

// ---------------------------------------------------------------- 書き出し

export function exportBackup(exportedAt: ISODateTime = nowIso()): BackupV2 {
  return {
    formatVersion: 2,
    exportedAt,
    scans: getCollection('scans'),
    products: getCollection('products'),
    comp: getCollection('comp'),
    returns: getCollection('returns'),
    cust: getCollection('cust'),
    notes: getCollection('notes'),
    orders: getCollection('orders'),
    settings: getCollection('settings'),
    shiwake: getCollection('shiwake'),
  };
}

// ---------------------------------------------------------------- 取込レポート

export interface ImportCollectionReport {
  target: string;
  /** ファイル内の件数 */
  incoming: number;
  /** 実際に追加された件数 */
  added: number;
  /** 重複・不正で取り込まなかった件数 */
  skipped: number;
}

export interface ImportReport {
  ok: boolean;
  /** 判別した形式。判別できなければ null */
  formatDetected: 1 | 2 | null;
  collections: ImportCollectionReport[];
  totals: { incoming: number; added: number; skipped: number };
  /** 設定を上書きしたか */
  settingsApplied: boolean;
  errors: string[];
  /** 致命的ではない注意（仕分番長の取込スキップ等） */
  warnings: string[];
}

function emptyReport(): ImportReport {
  return {
    ok: false,
    formatDetected: null,
    collections: [],
    totals: { incoming: 0, added: 0, skipped: 0 },
    settingsApplied: false,
    errors: [],
    warnings: [],
  };
}

// ---------------------------------------------------------------- 結合

/** 既存に無いものだけ追加する（id / _legacyId のどちらかが一致したら重複扱い） */
function mergeEntities<T extends Entity>(
  existing: T[],
  incoming: T[],
): { merged: T[]; added: number; skipped: number } {
  const seen = new Set<string>();
  for (const it of existing) {
    if (it.id) seen.add(`id:${it.id}`);
    if (it._legacyId) seen.add(`lg:${it._legacyId}`);
  }
  const added: T[] = [];
  let skipped = 0;
  for (const it of incoming) {
    const idKey = it.id ? `id:${it.id}` : null;
    const lgKey = it._legacyId ? `lg:${it._legacyId}` : null;
    if ((idKey && seen.has(idKey)) || (lgKey && seen.has(lgKey))) {
      skipped++;
      continue;
    }
    if (idKey) seen.add(idKey);
    if (lgKey) seen.add(lgKey);
    added.push(it);
  }
  return { merged: [...existing, ...added], added: added.length, skipped };
}

function mergeProducts(
  existing: Record<string, Product>,
  incoming: Record<string, Product>,
): { merged: Record<string, Product>; added: number; skipped: number } {
  const merged: Record<string, Product> = { ...existing };
  let added = 0;
  let skipped = 0;
  for (const jan of Object.keys(incoming)) {
    const inc = incoming[jan];
    if (!inc) continue;
    const prev = merged[jan];
    // 名前の優先度（manual > gemini > ext）は mergeProduct が守る
    merged[jan] = mergeProduct(prev, inc);
    if (prev) skipped++;
    else added++;
  }
  return { merged, added, skipped };
}

// ---------------------------------------------------------------- v2 バリデーション

function baseEntity(r: Record<string, unknown>, fallbackAt: ISODateTime): Entity {
  const createdAt = toStr(r['createdAt']) || fallbackAt;
  const e: Entity = {
    id: toStr(r['id']) || newId(),
    createdAt,
    updatedAt: toStr(r['updatedAt']) || createdAt,
  };
  const legacy = toStr(r['_legacyId']);
  if (legacy) e._legacyId = legacy;
  if (r['_approxDate'] === true) e._approxDate = true;
  return e;
}

function sanitizePop(v: unknown): PopDetail[] {
  const out: PopDetail[] = [];
  for (const d of toArray(v)) {
    const r = toRecord(d);
    if (!r) continue;
    const qty = Math.trunc(toNum(r['qty'], 1));
    const enlarge = toStr(r['enlarge']);
    out.push({
      size: toStr(r['size']),
      qty: qty > 0 ? qty : 1,
      lami: toBool(r['lami']),
      enlarge: enlarge === 'A4' || enlarge === 'A3' || enlarge === 'A2' ? enlarge : '',
      assignee: toStr(r['assignee']),
    });
  }
  return out;
}

function sanitizeScan(v: unknown, at: ISODateTime): ScanItem | null {
  const r = toRecord(v);
  if (!r) return null;
  return {
    ...baseEntity(r, at),
    jan: toStr(r['jan']),
    name: toStr(r['name']),
    memo: toStr(r['memo']),
    genre: toStr(r['genre']),
    end: toBool(r['end']),
    pop: sanitizePop(r['pop']),
    order: normalizeOrder(r['order']),
    expiry: dateOnly(r['expiry']),
    boxJan: toStr(r['boxJan']),
    protected: toBool(r['protected']),
    noLearn: toBool(r['noLearn']),
  };
}

function sanitizeProducts(v: unknown, at: ISODateTime): Record<string, Product> {
  const src = toRecord(v);
  const out: Record<string, Product> = {};
  if (!src) return out;
  for (const jan of Object.keys(src)) {
    const r = toRecord(src[jan]);
    if (!r) continue;
    const source = toStr(r['nameSource']);
    const offsets = toArray(r['expiryOffsets'])
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
      .slice(-5);
    const p: Product = {
      jan: toStr(r['jan']) || jan,
      name: toStr(r['name']),
      nameSource: source === 'manual' || source === 'gemini' || source === 'ext' ? source : 'manual',
      boxJan: toStr(r['boxJan']),
      expiryOffsets: offsets,
      lastUsedAt: toStr(r['lastUsedAt']) || at,
      updatedAt: toStr(r['updatedAt']) || at,
    };
    const preset = r['popPreset'];
    if (Array.isArray(preset)) p.popPreset = sanitizePop(preset);
    out[jan] = p;
  }
  return out;
}

function sanitizeComp(v: unknown, at: ISODateTime): Competitor | null {
  const r = toRecord(v);
  if (!r) return null;
  const reason = toStr(r['reason']);
  const allowed = ['ヘッダー変更', '売価変更', '新規導入', '廃番', 'その他'];
  return {
    ...baseEntity(r, at),
    date: dateOnly(r['date']),
    jan: toStr(r['jan']),
    name: toStr(r['name']),
    reason: (allowed.includes(reason) ? reason : 'その他') as Competitor['reason'],
    memo: toStr(r['memo']),
    dismissed: toBool(r['dismissed']),
  };
}

function sanitizeReturn(v: unknown, at: ISODateTime): ReturnItem | null {
  const r = toRecord(v);
  if (!r) return null;
  return {
    ...baseEntity(r, at),
    jan: toStr(r['jan']),
    start: dateOnly(r['start']),
    end: dateOnly(r['end']),
    returnDate: dateOnly(r['returnDate']),
    memo: toStr(r['memo']),
    dismissed: toBool(r['dismissed']),
  };
}

function sanitizeCust(v: unknown, at: ISODateTime): CustomerOrder | null {
  const r = toRecord(v);
  if (!r) return null;
  const dt = toStr(r['deliveryTime']).trim();
  const words = ['開店', '午前', '午後', '夕方', '夜'];
  return {
    ...baseEntity(r, at),
    jan: toStr(r['jan']),
    name: toStr(r['name']),
    qty: Math.trunc(toNum(r['qty'], 1)),
    caseQty: Math.trunc(toNum(r['caseQty'], 0)),
    ordered: toBool(r['ordered']),
    arrivalDate: dateOnly(r['arrivalDate']),
    deliveryDate: dateOnly(r['deliveryDate']),
    deliveryTime: (words.includes(dt) || /^\d{1,2}:\d{2}$/.test(dt)
      ? dt
      : '') as CustomerOrder['deliveryTime'],
    phone: toStr(r['phone']),
    willCall: toBool(r['willCall']),
    called: toBool(r['called']),
    memo: toStr(r['memo']),
    dismissedArrival: toBool(r['dismissedArrival']),
    dismissedDelivery: toBool(r['dismissedDelivery']),
    addedToHistory: toBool(r['addedToHistory']),
  };
}

function sanitizeNote(v: unknown, at: ISODateTime): Note | null {
  const r = toRecord(v);
  if (!r) return null;
  const color = toStr(r['color']);
  const note: Note = {
    ...baseEntity(r, at),
    title: toStr(r['title']),
    text: toStr(r['text']),
    color: (NOTE_COLORS as readonly string[]).includes(color) ? color : NOTE_COLORS[0],
    pinned: toBool(r['pinned']),
  };
  const remindAt = toStr(r['remindAt']);
  if (remindAt) note.remindAt = remindAt;
  const firedAt = toStr(r['firedAt']);
  if (firedAt) note.firedAt = firedAt;
  const tag = toStr(r['tag']);
  if (tag) note.tag = tag;
  return note;
}

function sanitizeOrderList(v: unknown, at: ISODateTime): OrderList | null {
  const r = toRecord(v);
  if (!r) return null;
  const lines: OrderLine[] = [];
  for (const l of toArray(r['lines'])) {
    const lr = toRecord(l);
    if (!lr) continue;
    lines.push({ jan: toStr(lr['jan']), qty: Math.trunc(toNum(lr['qty'], 0)) });
  }
  return {
    ...baseEntity(r, at),
    label: toStr(r['label']),
    lines,
    exportedBatches: toArray(r['exportedBatches']).filter(
      (n): n is number => typeof n === 'number' && Number.isFinite(n),
    ),
  };
}

function sanitizeShiwake(v: unknown, at: ISODateTime): ShiwakeState | null {
  const r = toRecord(v);
  if (!r) return null;
  const items = [];
  for (const i of toArray(r['items'])) {
    const ir = toRecord(i);
    if (!ir) continue;
    const q = ir['qtyPerCase'];
    const qn = q === null || q === undefined || q === '' ? null : toNum(q, NaN);
    const item: ShiwakeState['items'][number] = {
      id: toStr(ir['id']) || newId(),
      name: toStr(ir['name']),
      code: toStr(ir['code']),
      jan: toStr(ir['jan']),
      qtyPerCase: qn !== null && Number.isFinite(qn) ? qn : null,
      cases: Math.trunc(toNum(ir['cases'], 0)),
      cartIndex: Math.trunc(toNum(ir['cartIndex'], 0)),
      memo: toStr(ir['memo']),
      isAlert: toBool(ir['isAlert']),
    };
    const co = toStr(ir['custOrderId']);
    if (co) item.custOrderId = co;
    items.push(item);
  }
  const carts = [];
  for (const c of toArray(r['carts'])) {
    const cr = toRecord(c);
    if (!cr) continue;
    carts.push({
      index: Math.trunc(toNum(cr['index'], carts.length)),
      label: toStr(cr['label']),
      deliveryDate: dateOnly(cr['deliveryDate']),
    });
  }
  return {
    items,
    carts,
    alertWords: toArray(r['alertWords']).filter(
      (w): w is string => typeof w === 'string' && w !== '',
    ),
    updatedAt: toStr(r['updatedAt']) || at,
  };
}

// ---------------------------------------------------------------- 取込

interface Staged {
  scans: ScanItem[];
  products: Record<string, Product>;
  comp: Competitor[];
  returns: ReturnItem[];
  cust: CustomerOrder[];
  notes: Note[];
  orders: OrderList[];
  settings: Settings | null;
  shiwake: ShiwakeState | null;
}

function sanitizeList<T>(v: unknown, at: ISODateTime, fn: (v: unknown, at: ISODateTime) => T | null): {
  items: T[];
  dropped: number;
} {
  const items: T[] = [];
  let dropped = 0;
  for (const entry of toArray(v)) {
    const it = fn(entry, at);
    if (!it) {
      dropped++;
      continue;
    }
    items.push(it);
  }
  return { items, dropped };
}

function stageV2(obj: Record<string, unknown>, at: ISODateTime): { staged: Staged; dropped: number } {
  const scans = sanitizeList(obj['scans'], at, sanitizeScan);
  const comp = sanitizeList(obj['comp'], at, sanitizeComp);
  const returns = sanitizeList(obj['returns'], at, sanitizeReturn);
  const cust = sanitizeList(obj['cust'], at, sanitizeCust);
  const notes = sanitizeList(obj['notes'], at, sanitizeNote);
  const orders = sanitizeList(obj['orders'], at, sanitizeOrderList);
  const settingsRaw = toRecord(obj['settings']);
  return {
    staged: {
      scans: scans.items,
      products: sanitizeProducts(obj['products'], at),
      comp: comp.items,
      returns: returns.items,
      cust: cust.items,
      notes: notes.items,
      orders: orders.items,
      settings: settingsRaw
        ? ({ ...getCollection('settings'), ...settingsRaw } as Settings)
        : null,
      shiwake: sanitizeShiwake(obj['shiwake'], at),
    },
    dropped:
      scans.dropped + comp.dropped + returns.dropped + cust.dropped + notes.dropped + orders.dropped,
  };
}

/** v1 バックアップ（{list, db, comp, return, cust, notes?, date}）を migrate の変換で v2 化する */
function stageV1(obj: Record<string, unknown>, at: ISODateTime): { staged: Staged; dropped: number } {
  const scans = convertScanList(obj['list'], at);
  const products = convertProducts(obj['db'], at);

  const conv = <T>(v: unknown, fn: (raw: unknown, at: ISODateTime) => T | null) => {
    const items: T[] = [];
    let dropped = 0;
    for (const e of toArray(v)) {
      const it = fn(e, at);
      if (!it) {
        dropped++;
        continue;
      }
      items.push(it);
    }
    return { items, dropped };
  };

  const comp = conv(obj['comp'], convertCompetitor);
  const returns = conv(obj['return'], convertReturnItem);
  const cust = conv(obj['cust'], convertCustomerOrder);
  const notes = conv(obj['notes'], convertNote);

  return {
    staged: {
      scans: scans.items,
      products: products.products,
      comp: comp.items,
      returns: returns.items,
      cust: cust.items,
      notes: notes.items,
      orders: [],
      settings: null,
      shiwake: null,
    },
    dropped:
      scans.dropped + products.dropped + comp.dropped + returns.dropped + cust.dropped + notes.dropped,
  };
}

/**
 * バックアップを取り込んで既存データに結合する。
 * v2（formatVersion:2）と v1（exportData 出力）の両方を受け付ける。
 * 書き込みは全件成功か1件も書かないかのどちらか。
 */
export function importBackup(json: unknown, at: ISODateTime = nowIso()): ImportReport {
  const report = emptyReport();

  let obj = toRecord(json);
  if (!obj && typeof json === 'string') {
    try {
      obj = toRecord(JSON.parse(json));
    } catch {
      obj = null;
    }
  }
  if (!obj) {
    report.errors.push('バックアップの形式が読み取れません（JSON オブジェクトではありません）。');
    return report;
  }

  let staged: Staged;
  let droppedInvalid: number;
  if (toNum(obj['formatVersion'], 0) === 2) {
    report.formatDetected = 2;
    ({ staged, dropped: droppedInvalid } = stageV2(obj, at));
  } else if ('list' in obj || 'db' in obj) {
    report.formatDetected = 1;
    ({ staged, dropped: droppedInvalid } = stageV1(obj, at));
  } else {
    report.errors.push('形式エラー: 棚番長のバックアップファイルではないようです。');
    return report;
  }

  // ファイル内の重複（同じ _legacyId）を先に潰す
  staged.scans = dedupeByLegacyId(staged.scans);
  staged.comp = dedupeByLegacyId(staged.comp);
  staged.returns = dedupeByLegacyId(staged.returns);
  staged.cust = dedupeByLegacyId(staged.cust);
  staged.notes = dedupeByLegacyId(staged.notes);

  const entries: { key: string; value: unknown }[] = [];
  const push = <K extends CollectionName>(name: K, value: StorageSchema[K]): void => {
    entries.push(collectionEntry(name, value));
  };

  const record = (target: string, incoming: number, added: number, skipped: number): void => {
    report.collections.push({ target, incoming, added, skipped });
    report.totals.incoming += incoming;
    report.totals.added += added;
    report.totals.skipped += skipped;
  };

  const scans = mergeEntities(getCollection('scans'), staged.scans);
  push('scans', scans.merged);
  record('scans', staged.scans.length, scans.added, scans.skipped);

  const products = mergeProducts(getCollection('products'), staged.products);
  push('products', products.merged);
  record('products', Object.keys(staged.products).length, products.added, products.skipped);

  const comp = mergeEntities(getCollection('comp'), staged.comp);
  push('comp', comp.merged);
  record('comp', staged.comp.length, comp.added, comp.skipped);

  const returns = mergeEntities(getCollection('returns'), staged.returns);
  push('returns', returns.merged);
  record('returns', staged.returns.length, returns.added, returns.skipped);

  const cust = mergeEntities(getCollection('cust'), staged.cust);
  push('cust', cust.merged);
  record('cust', staged.cust.length, cust.added, cust.skipped);

  const notes = mergeEntities(getCollection('notes'), staged.notes);
  push('notes', notes.merged);
  record('notes', staged.notes.length, notes.added, notes.skipped);

  const orders = mergeEntities(getCollection('orders'), staged.orders);
  push('orders', orders.merged);
  record('orders', staged.orders.length, orders.added, orders.skipped);

  if (staged.settings) {
    push('settings', staged.settings);
    report.settingsApplied = true;
  }

  if (staged.shiwake) {
    const current = getCollection('shiwake');
    if (current.items.length === 0 && current.carts.length === 0) {
      push('shiwake', staged.shiwake);
      record('shiwake', staged.shiwake.items.length, staged.shiwake.items.length, 0);
    } else {
      // 仕分番長は「今の便」の作業状態。取り違えを防ぐため、作業中は上書きしない
      report.warnings.push('仕分番長に作業中のデータがあるため、バックアップ内の仕分データは取り込みませんでした。');
      record('shiwake', staged.shiwake.items.length, 0, staged.shiwake.items.length);
    }
  }

  if (droppedInvalid > 0) {
    report.totals.skipped += droppedInvalid;
    report.warnings.push(`${droppedInvalid}件のレコードは形式が不正なため取り込みませんでした。`);
  }

  const result = writeBatch(entries);
  if (!result.ok) {
    report.errors.push(
      `保存に失敗しました（${result.failedKey ?? '不明なキー'}）。容量不足の可能性があります。データは取込前の状態に戻しました。`,
    );
    return report;
  }

  report.ok = true;
  return report;
}
