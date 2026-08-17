import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  convertScanItem,
  dedupeByLegacyId,
  needsMigration,
  normalizeOrder,
  normalizePop,
  resolveCreatedAt,
  runMigration,
  timestampFromLegacyId,
} from './migrate';
import {
  createMemoryBackend,
  getCollection,
  hasCollection,
  readRaw,
  setStorageBackend,
  type StorageBackend,
} from './storage';
import { KEYS, LEGACY_KEYS } from './types';

/**
 * 合成フィクスチャ。実データを模した形だが、実在の個人名・電話番号・APIキーは含まない。
 * 実データでの追加検証は最後の describe（存在すれば実行）で行う。
 */

const MIGRATED_AT = '2026-08-17T00:00:00.000Z';

/** v1 の id 形式: Date.now() + random36(5)、接頭辞付きもある */
const TS_A = 1_755_000_000_000; // 2025-08-12 頃
const TS_B = 1_760_000_000_000;

let backend: StorageBackend;

function seed(key: string, value: unknown): void {
  backend.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
}

beforeEach(() => {
  backend = createMemoryBackend();
  setStorageBackend(backend);
});

// ---------------------------------------------------------------- 単体

describe('timestampFromLegacyId', () => {
  it('接頭辞付き id から13桁タイムスタンプを取り出す', () => {
    const expected = new Date(TS_A).toISOString();
    expect(timestampFromLegacyId(`${TS_A}abc12`)).toBe(expected);
    expect(timestampFromLegacyId(`comp${TS_A}xy9zz`)).toBe(expected);
    expect(timestampFromLegacyId(`cust_auto${TS_A}q1w2e`)).toBe(expected);
    expect(timestampFromLegacyId(`rem${TS_A}`)).toBe(expected);
    expect(timestampFromLegacyId(`sh${TS_A}ab1c`)).toBe(expected);
    expect(timestampFromLegacyId(TS_A)).toBe(expected); // 数値 id（comp/cust/return）
  });

  it('13桁が無ければ null', () => {
    expect(timestampFromLegacyId('imp')).toBeNull();
    expect(timestampFromLegacyId('')).toBeNull();
    expect(timestampFromLegacyId(undefined)).toBeNull();
    expect(timestampFromLegacyId('0000000000001')).toBeNull(); // 範囲外
  });
});

describe('resolveCreatedAt', () => {
  it('dateStr + timeStr を最優先でローカル日時として使う', () => {
    const r = resolveCreatedAt(
      { id: `${TS_A}abc12`, time: '14:32', dateStr: '2026-03-05', timeStr: '09:07' },
      MIGRATED_AT,
    );
    expect(r.iso).toBe(new Date(2026, 2, 5, 9, 7).toISOString());
    expect(r.approx).toBe(false);
  });

  it("time が 'YYYY-MM-DD HH:MM' 形式ならそれを使う", () => {
    const r = resolveCreatedAt({ id: `${TS_A}abc12`, time: '2026-08-17 14:32' }, MIGRATED_AT);
    expect(r.iso).toBe(new Date(2026, 7, 17, 14, 32).toISOString());
    expect(r.approx).toBe(false);
  });

  it("time が 'HH:MM' のみなら id のタイムスタンプで復元する", () => {
    const r = resolveCreatedAt({ id: `${TS_A}abc12`, time: '14:32' }, MIGRATED_AT);
    expect(r.iso).toBe(new Date(TS_A).toISOString());
    expect(r.approx).toBe(false);
  });

  it('どれも復元できなければ migratedAt を充当して approx にする', () => {
    const r = resolveCreatedAt({ id: 'imp', time: '14:32' }, MIGRATED_AT);
    expect(r.iso).toBe(MIGRATED_AT);
    expect(r.approx).toBe(true);
  });

  it('存在しない日付（2/31）は採用しない', () => {
    const r = resolveCreatedAt({ id: 'imp', dateStr: '2026-02-31', timeStr: '10:00' }, MIGRATED_AT);
    expect(r.approx).toBe(true);
  });
});

describe('normalizeOrder', () => {
  it('配列 / 文字列 / false / \'false\' の混在を string[] に畳む', () => {
    expect(normalizeOrder(['発注(上げ)', '指数変更(下げ)'])).toEqual(['発注(上げ)', '指数変更(下げ)']);
    expect(normalizeOrder('発注(下げ)')).toEqual(['発注(下げ)']);
    expect(normalizeOrder(false)).toEqual([]);
    expect(normalizeOrder('false')).toEqual([]);
    expect(normalizeOrder('')).toEqual([]);
    expect(normalizeOrder(undefined)).toEqual([]);
    expect(normalizeOrder(['発注(上げ)', '', 3])).toEqual(['発注(上げ)']);
  });
});

describe('normalizePop', () => {
  it('popDetails（新形式）に v2 の既定値を補完する', () => {
    expect(normalizePop({ pop: true, popDetails: [{ size: '7号', qty: 2 }] })).toEqual([
      { size: '7号', qty: 2, lami: false, enlarge: '', assignee: '' },
    ]);
  });

  it('popSize（旧形式・文字列）は1件の popDetails に変換する', () => {
    expect(normalizePop({ pop: true, popSize: '5号' })).toEqual([
      { size: '5号', qty: 1, lami: false, enlarge: '', assignee: '' },
    ]);
  });

  it('内訳が無く pop フラグだけの場合も「POPあり」を残す', () => {
    expect(normalizePop({ pop: true, popDetails: [] })).toEqual([
      { size: '', qty: 1, lami: false, enlarge: '', assignee: '' },
    ]);
  });

  it('POP 無しは空配列', () => {
    expect(normalizePop({ pop: false, popDetails: [] })).toEqual([]);
  });
});

describe('convertScanItem', () => {
  it("code:'REMINDER' の疑似アイテムは破棄する", () => {
    expect(
      convertScanItem(
        { id: `rem${TS_A}`, code: 'REMINDER', productName: '発注締切', genre: '⏰リマインダー' },
        MIGRATED_AT,
      ),
    ).toBeNull();
  });

  it('旧 id は _legacyId に残し、id は新規採番する', () => {
    const item = convertScanItem(
      { id: `${TS_A}abc12`, code: '4901234567894', time: '14:32', productName: 'テスト商品' },
      MIGRATED_AT,
    );
    expect(item).not.toBeNull();
    expect(item!._legacyId).toBe(`${TS_A}abc12`);
    expect(item!.id).not.toBe(`${TS_A}abc12`);
    expect(item!.id.length).toBeGreaterThan(10);
    expect(item!.jan).toBe('4901234567894');
    expect(item!.name).toBe('テスト商品');
  });
});

// ---------------------------------------------------------------- 移行全体

function seedFullV1(): void {
  seed(LEGACY_KEYS.list, [
    {
      id: `${TS_A}aaa11`,
      code: '4901234567894',
      time: '14:32',
      productName: '合成テスト商品A',
      memo: 'メモA',
      genre: '1番',
      pop: true,
      popDetails: [{ size: '7号', qty: 2 }],
      end: false,
      order: ['発注(上げ)'],
      expiry: '2026-09-01',
      isNoLearn: false,
      boxJan: '14901234567891',
      initialEdit: false,
      isProtected: true,
    },
    {
      id: `chk${TS_A + 1000}bbb22`,
      code: '4901234567900',
      time: '2026-08-17 09:05',
      productName: '合成テスト商品B',
      memo: '',
      genre: '2番',
      pop: true,
      popSize: '5号', // 旧形式
      end: true,
      order: 'false', // 文字列 false
      expiry: '',
      isNoLearn: true,
      boxJan: '',
      initialEdit: false,
      isProtected: false,
    },
    {
      id: `imp${TS_A + 2000}ccc33`,
      code: '4901234567917',
      time: '10:15',
      dateStr: '2026-05-20', // 日付編集済み
      timeStr: '10:15',
      productName: '合成テスト商品C',
      memo: '',
      genre: '',
      pop: false,
      popDetails: [],
      end: false,
      order: false, // boolean false
      expiry: '2026-12-31',
      isNoLearn: false,
      boxJan: '',
      initialEdit: false,
      isProtected: false,
    },
    {
      id: 'brokenid', // タイムスタンプ復元不能 → _approxDate
      code: '4901234567924',
      time: '08:00',
      productName: '合成テスト商品D',
      memo: '',
      genre: '',
      pop: false,
      end: false,
      order: '指数変更(下げ)', // 文字列1件
      expiry: '',
      isNoLearn: false,
      boxJan: '',
      initialEdit: false,
      isProtected: false,
    },
    {
      id: `rem${TS_A + 3000}`,
      code: 'REMINDER', // 疑似アイテム → 破棄
      time: '8/17 09:00',
      productName: 'リマインダー本文',
      genre: '⏰リマインダー',
      pop: false,
      end: false,
      order: [],
      expiry: '',
      isNoLearn: true,
      boxJan: '',
      isProtected: false,
    },
  ]);

  seed(LEGACY_KEYS.db, {
    '4901234567894': { name: '合成テスト商品A', boxJan: '14901234567891', lastUsed: TS_A },
    '4901234567900': { name: '合成テスト商品B', lastUsed: TS_B }, // boxJan 無し
    '4901234567917': '合成テスト商品C', // 文字列だけの旧形式
  });

  seed(LEGACY_KEYS.comp, [
    {
      id: TS_A,
      date: '2026-07-01',
      jan: '4901234567894',
      name: '合成テスト商品A',
      reason: 'ヘッダー変更',
      memo: '',
      dismissed: false,
    },
    {
      id: TS_B,
      date: '2026-07-02',
      jan: '4901234567900',
      name: '合成テスト商品B',
      reason: '謎の理由', // 未知 → その他
      memo: '',
      dismissed: true,
    },
  ]);

  seed(LEGACY_KEYS.return, [
    {
      id: TS_A,
      jan: '4901234567894',
      start: '2026-06-01',
      end: '2026-06-30',
      returnDate: '2026-07-05',
      memo: '',
      dismissed: false,
    },
  ]);

  seed(LEGACY_KEYS.cust, [
    {
      id: TS_A,
      jan: '4901234567894',
      arrivalDate: '2026-08-20',
      deliveryDate: '2026-08-21',
      phone: '000-0000-0000',
      willCall: true,
      called: false,
      memo: '',
      ordered: true,
      dismissedArrival: false,
      dismissedDelivery: false,
      // name / qty / caseQty / deliveryTime / addedToHistory は v1 に無い
    },
  ]);

  seed(LEGACY_KEYS.reminders, [
    { id: TS_A, datetime: '2026-08-18T09:00', memo: '棚替え確認', fired: false },
    { id: TS_B, datetime: '2026-08-10T18:30', memo: '発注締切', fired: true },
  ]);

  seed(LEGACY_KEYS.notes, [
    {
      id: TS_A,
      title: '引継ぎ',
      text: '合成テストのメモ本文',
      color: '#fff9c4',
      pinned: true,
      updated: TS_A,
    },
    {
      id: TS_B,
      title: '色不正',
      text: '未知の色は既定に丸める',
      color: '#123456',
      pinned: false,
      updated: TS_B,
    },
  ]);

  seed(LEGACY_KEYS.shareTanabancho, [
    { id: `sh${TS_A}dd44`, code: '4901234567931', time: '11:00' },
    { id: `sh${TS_A + 10}ee55`, code: '4901234567948', time: '11:05' },
  ]);
  seed(LEGACY_KEYS.shareSellfloor, [
    { id: `sh${TS_A}dd44`, code: '4901234567931', time: '11:00' }, // 重複（同一 _legacyId）
    { id: `sh${TS_A + 20}ff66`, code: '4901234567955', time: '11:10' },
  ]);

  seed(LEGACY_KEYS.sbItems, [
    {
      id: TS_A,
      name: '合成明細A',
      code: '14901234567891',
      jan: '4901234567894',
      qty_per_case: 12, // スネークケース
      cases: 2,
      cartIndex: 0,
      cartLabel: 'カート1',
      memo: '',
      isAlert: false,
    },
    {
      id: TS_B,
      name: '合成明細B',
      code: '',
      jan: '4901234567900',
      qty_per_case: null,
      cases: 1,
      cartIndex: 1,
      cartLabel: 'カート2',
      memo: '要冷蔵',
      isAlert: true,
    },
  ]);
  seed(LEGACY_KEYS.sbCarts, [
    { index: 0, label: 'カート1', delivery_date: '2026-08-18' }, // スネークケース
    { index: 1, label: 'カート2', delivery_date: '2026-08-19' },
  ]);
  seed(LEGACY_KEYS.sbAlertWords, ['冷蔵', '冷凍']);
  seed(LEGACY_KEYS.sbGlobalMemo, '今夜の便メモ本文'); // 素の文字列（JSON ではない）
  seed(LEGACY_KEYS.sbMemoHistory, [
    { date: '2026/8/16 20:15:00', text: '前回の便メモ' }, // パース可能なロケール文字列
    { date: '令和8年8月15日 20:15', text: 'パース不能な日付' },
  ]);
}

describe('runMigration', () => {
  it('KEYS.meta が無ければ発火し、あれば発火しない', () => {
    expect(needsMigration()).toBe(true);
    seedFullV1();

    const first = runMigration(MIGRATED_AT);
    expect(first.ran).toBe(true);
    expect(needsMigration()).toBe(false);

    const second = runMigration(MIGRATED_AT);
    expect(second.ran).toBe(false);
    expect(second.reason).toBe('already-migrated');
  });

  it('v1 のキーを一切削除しない', () => {
    seedFullV1();
    const before = Object.values(LEGACY_KEYS).map((k) => readRaw(k));
    runMigration(MIGRATED_AT);
    const after = Object.values(LEGACY_KEYS).map((k) => readRaw(k));
    expect(after).toEqual(before);
  });

  it('スキャン履歴: REMINDER を破棄して件数が一致する', () => {
    seedFullV1();
    const report = runMigration(MIGRATED_AT);
    const scans = getCollection('scans');

    expect(scans).toHaveLength(4); // 5件中 REMINDER 1件を破棄
    const scanReport = report.collections.find((c) => c.target === 'scans')!;
    expect(scanReport.v1Count).toBe(5);
    expect(scanReport.v2Count).toBe(4);
    expect(scanReport.dropped).toBe(1);
    expect(scanReport.approxDate).toBe(1);
    expect(scans.some((s) => s.jan === 'REMINDER')).toBe(false);
  });

  it('スキャン履歴: createdAt の各復元パターン', () => {
    seedFullV1();
    runMigration(MIGRATED_AT);
    const scans = getCollection('scans');
    const byName = (n: string) => scans.find((s) => s.name === n)!;

    // 'HH:MM' のみ → id のタイムスタンプ
    expect(byName('合成テスト商品A').createdAt).toBe(new Date(TS_A).toISOString());
    expect(byName('合成テスト商品A')._approxDate).toBeUndefined();

    // 'YYYY-MM-DD HH:MM'
    expect(byName('合成テスト商品B').createdAt).toBe(new Date(2026, 7, 17, 9, 5).toISOString());

    // dateStr + timeStr が最優先
    expect(byName('合成テスト商品C').createdAt).toBe(new Date(2026, 4, 20, 10, 15).toISOString());

    // 復元不能 → migratedAt + _approxDate
    expect(byName('合成テスト商品D').createdAt).toBe(MIGRATED_AT);
    expect(byName('合成テスト商品D')._approxDate).toBe(true);
  });

  it('スキャン履歴: POP と order が正規化される', () => {
    seedFullV1();
    runMigration(MIGRATED_AT);
    const scans = getCollection('scans');
    const byName = (n: string) => scans.find((s) => s.name === n)!;

    expect(byName('合成テスト商品A').pop).toEqual([
      { size: '7号', qty: 2, lami: false, enlarge: '', assignee: '' },
    ]);
    expect(byName('合成テスト商品B').pop).toEqual([
      { size: '5号', qty: 1, lami: false, enlarge: '', assignee: '' },
    ]);
    expect(byName('合成テスト商品C').pop).toEqual([]);

    expect(byName('合成テスト商品A').order).toEqual(['発注(上げ)']);
    expect(byName('合成テスト商品B').order).toEqual([]); // 'false'
    expect(byName('合成テスト商品C').order).toEqual([]); // false
    expect(byName('合成テスト商品D').order).toEqual(['指数変更(下げ)']);

    expect(byName('合成テスト商品A').protected).toBe(true);
    expect(byName('合成テスト商品B').noLearn).toBe(true);
  });

  it('学習辞書: 文字列だけの旧形式も Product になる', () => {
    seedFullV1();
    runMigration(MIGRATED_AT);
    const products = getCollection('products');

    expect(Object.keys(products)).toHaveLength(3);
    expect(products['4901234567917']).toEqual({
      jan: '4901234567917',
      name: '合成テスト商品C',
      nameSource: 'manual',
      boxJan: '',
      expiryOffsets: [],
      lastUsedAt: MIGRATED_AT, // 文字列形式には lastUsed が無い
      updatedAt: MIGRATED_AT,
    });
    expect(products['4901234567894']!.boxJan).toBe('14901234567891');
    expect(products['4901234567894']!.lastUsedAt).toBe(new Date(TS_A).toISOString());
    expect(products['4901234567900']!.boxJan).toBe('');
  });

  it('競合・返品・客注が移行される（欠けたフィールドは既定値で補完）', () => {
    seedFullV1();
    runMigration(MIGRATED_AT);

    const comp = getCollection('comp');
    expect(comp).toHaveLength(2);
    expect(comp[0]!.reason).toBe('ヘッダー変更');
    expect(comp[1]!.reason).toBe('その他'); // 未知の理由
    expect(comp[0]!._legacyId).toBe(String(TS_A));

    expect(getCollection('returns')).toHaveLength(1);

    const cust = getCollection('cust');
    expect(cust).toHaveLength(1);
    expect(cust[0]!.name).toBe('');
    expect(cust[0]!.qty).toBe(1);
    expect(cust[0]!.caseQty).toBe(0);
    expect(cust[0]!.deliveryTime).toBe('');
    expect(cust[0]!.addedToHistory).toBe(false);
    expect(cust[0]!.arrivalDate).toBe('2026-08-20');
  });

  it('リマインダー・メモ・便メモが Note に統合される', () => {
    seedFullV1();
    runMigration(MIGRATED_AT);
    const notes = getCollection('notes');

    // メモ2 + リマインダー2 + 便メモ（現在1 + 履歴2）= 7
    expect(notes).toHaveLength(7);

    const reminder = notes.find((n) => n.text === '棚替え確認')!;
    expect(reminder.remindAt).toBe(new Date(2026, 7, 18, 9, 0).toISOString());
    expect(reminder.firedAt).toBeUndefined();

    const fired = notes.find((n) => n.text === '発注締切')!;
    expect(fired.remindAt).toBe(new Date(2026, 7, 10, 18, 30).toISOString());
    expect(fired.firedAt).toBe(MIGRATED_AT); // fired → firedAt = migratedAt

    const memo = notes.find((n) => n.title === '引継ぎ')!;
    expect(memo.color).toBe('#fff9c4');
    expect(memo.pinned).toBe(true);
    expect(memo.createdAt).toBe(new Date(TS_A).toISOString());

    expect(notes.find((n) => n.title === '色不正')!.color).toBe('#ffffff'); // 未知色は既定へ

    const binMemos = notes.filter((n) => n.tag === 'bin-memo');
    expect(binMemos).toHaveLength(3);
    expect(binMemos.some((n) => n.text === '今夜の便メモ本文')).toBe(true);
    // ロケール文字列がパースできた履歴は _approxDate が付かない
    expect(binMemos.find((n) => n.text === '前回の便メモ')!._approxDate).toBeUndefined();
    // パース不能な履歴は _approxDate
    expect(binMemos.find((n) => n.text === 'パース不能な日付')!._approxDate).toBe(true);
  });

  it('仕分番長: スネークケースのフィールドを取り込む', () => {
    seedFullV1();
    runMigration(MIGRATED_AT);
    const sb = getCollection('shiwake');

    expect(sb.items).toHaveLength(2);
    expect(sb.items[0]!.qtyPerCase).toBe(12); // qty_per_case
    expect(sb.items[1]!.qtyPerCase).toBeNull();
    expect(sb.items[1]!.isAlert).toBe(true);
    expect(sb.carts).toHaveLength(2);
    expect(sb.carts[0]!.deliveryDate).toBe('2026-08-18'); // delivery_date
    expect(sb.alertWords).toEqual(['冷蔵', '冷凍']);
    expect(getCollection('shiwakeMeta').schemaVersion).toBe(2);
  });

  it('共有キャッシュ: 2キーを統合し _legacyId 重複を除外する', () => {
    seedFullV1();
    runMigration(MIGRATED_AT);
    const share = getCollection('shareRecv');
    expect(share).toHaveLength(3); // 2+2 のうち1件が重複
    expect(new Set(share.map((s) => s._legacyId)).size).toBe(3);
  });

  it('meta に移行元キーと日時を記録する', () => {
    seedFullV1();
    runMigration(MIGRATED_AT);
    const meta = getCollection('meta');
    expect(meta.schemaVersion).toBe(2);
    expect(meta.migratedAt).toBe(MIGRATED_AT);
    expect(meta.migratedFrom).toContain(LEGACY_KEYS.list);
    expect(meta.migratedFrom).toContain(LEGACY_KEYS.sbGlobalMemo);
  });

  it('v1 データが無くても空の v2 を作って完了する', () => {
    const report = runMigration(MIGRATED_AT);
    expect(report.ran).toBe(true);
    expect(report.totals.v2Count).toBe(0);
    expect(getCollection('scans')).toEqual([]);
    expect(getCollection('meta').migratedFrom).toEqual([]);
  });

  it('書き込みに失敗したら v2 キーを1つも残さず中断する', () => {
    seedFullV1();
    const failing: StorageBackend = {
      ...backend,
      setItem(key, value) {
        // meta の1つ手前で失敗させる
        if (key === KEYS.shiwake) throw new Error('QuotaExceededError');
        backend.setItem(key, value);
      },
    };
    setStorageBackend(failing);

    const report = runMigration(MIGRATED_AT);
    expect(report.ran).toBe(false);
    expect(report.reason).toBe('write-failed');
    expect(report.errors).toHaveLength(1);

    // 巻き戻されて v2 キーは残っていない
    setStorageBackend(backend);
    for (const name of ['meta', 'scans', 'products', 'notes', 'shiwake'] as const) {
      expect(hasCollection(name)).toBe(false);
    }
    // v1 は無傷
    expect(readRaw(LEGACY_KEYS.list)).not.toBeNull();
  });

  it('レポートの合計が各コレクションの合計と一致する', () => {
    seedFullV1();
    const report = runMigration(MIGRATED_AT);
    const sum = (f: 'v1Count' | 'v2Count' | 'dropped' | 'approxDate') =>
      report.collections.reduce((a, c) => a + c[f], 0);
    expect(report.totals.v1Count).toBe(sum('v1Count'));
    expect(report.totals.v2Count).toBe(sum('v2Count'));
    expect(report.totals.dropped).toBe(sum('dropped'));
    expect(report.totals.approxDate).toBe(sum('approxDate'));
  });
});

describe('dedupeByLegacyId', () => {
  it('_legacyId の重複を先勝ちで落とし、無いものは残す', () => {
    const out = dedupeByLegacyId([
      { _legacyId: 'a', n: 1 },
      { _legacyId: 'a', n: 2 },
      { n: 3 },
      { n: 4 },
    ]);
    expect(out.map((o) => o.n)).toEqual([1, 3, 4]);
  });
});

// ---------------------------------------------------------------- 実データ（あれば）

/**
 * 実データ（test-fixtures-local/）は gitignore 済み・コミット禁止。
 * 個人情報と API キーを含むため、内容は一切出力せず、構造と件数のみ検証する。
 */
const DUMP_PATH = resolve(process.cwd(), 'test-fixtures-local/tanabancho_localStorage_dump.json');
const hasDump = existsSync(DUMP_PATH);

describe.skipIf(!hasDump)('runMigration（実データ）', () => {
  let dump: Record<string, string>;

  beforeEach(() => {
    dump = JSON.parse(readFileSync(DUMP_PATH, 'utf8')) as Record<string, string>;
    for (const [k, v] of Object.entries(dump)) {
      backend.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  });

  function legacyCount(key: string): number {
    const raw = dump[key];
    if (raw === undefined) return 0;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.length;
      if (parsed && typeof parsed === 'object') return Object.keys(parsed).length;
      return 0;
    } catch {
      return 0;
    }
  }

  it('移行が完了し、v1 のキーが残っている', () => {
    const before = Object.keys(dump).map((k) => readRaw(k));
    const report = runMigration(MIGRATED_AT);
    expect(report.ran).toBe(true);
    expect(report.errors).toEqual([]);
    expect(Object.keys(dump).map((k) => readRaw(k))).toEqual(before);
  });

  it('件数が v1 と整合する', () => {
    runMigration(MIGRATED_AT);

    // REMINDER 疑似アイテムを除いた件数になる
    const v1List = JSON.parse(dump[LEGACY_KEYS.list] ?? '[]') as { code?: string }[];
    const reminderCount = v1List.filter((i) => i.code === 'REMINDER').length;
    expect(getCollection('scans')).toHaveLength(v1List.length - reminderCount);

    expect(Object.keys(getCollection('products'))).toHaveLength(legacyCount(LEGACY_KEYS.db));
    expect(getCollection('comp')).toHaveLength(legacyCount(LEGACY_KEYS.comp));
    expect(getCollection('returns')).toHaveLength(legacyCount(LEGACY_KEYS.return));
    expect(getCollection('cust')).toHaveLength(legacyCount(LEGACY_KEYS.cust));
    expect(getCollection('shiwake').items).toHaveLength(legacyCount(LEGACY_KEYS.sbItems));
    expect(getCollection('shiwake').carts).toHaveLength(legacyCount(LEGACY_KEYS.sbCarts));

    // ノートは メモ + リマインダー + 便メモ履歴 (+ 現在の便メモ)
    const binMemo = (dump[LEGACY_KEYS.sbGlobalMemo] ?? '').trim() ? 1 : 0;
    expect(getCollection('notes')).toHaveLength(
      legacyCount(LEGACY_KEYS.notes) +
        legacyCount(LEGACY_KEYS.reminders) +
        legacyCount(LEGACY_KEYS.sbMemoHistory) +
        binMemo,
    );
  });

  it('生成された全レコードが v2 の不変条件を満たす', () => {
    runMigration(MIGRATED_AT);
    const isIso = (s: string) => !Number.isNaN(Date.parse(s)) && s.includes('T');

    for (const s of getCollection('scans')) {
      expect(isIso(s.createdAt)).toBe(true);
      expect(isIso(s.updatedAt)).toBe(true);
      expect(s.id).not.toBe(s._legacyId);
      expect(Array.isArray(s.order)).toBe(true);
      expect(Array.isArray(s.pop)).toBe(true);
      expect(s.expiry === '' || /^\d{4}-\d{2}-\d{2}$/.test(s.expiry)).toBe(true);
      expect(s.jan).not.toBe('REMINDER');
    }
    for (const p of Object.values(getCollection('products'))) {
      expect(p.nameSource).toBe('manual');
      expect(isIso(p.lastUsedAt)).toBe(true);
      expect(Array.isArray(p.expiryOffsets)).toBe(true);
    }
    for (const n of getCollection('notes')) {
      expect(isIso(n.createdAt)).toBe(true);
      expect(typeof n.text).toBe('string');
      if (n.remindAt !== undefined) expect(isIso(n.remindAt)).toBe(true);
    }
    for (const c of getCollection('cust')) {
      expect(isIso(c.createdAt)).toBe(true);
      expect(typeof c.qty).toBe('number');
    }
    for (const i of getCollection('shiwake').items) {
      expect(i.qtyPerCase === null || typeof i.qtyPerCase === 'number').toBe(true);
      expect(typeof i.cartIndex).toBe('number');
    }
  });

  it('APIキーなど v2 の対象外のキーは v2 側へ持ち込まない', () => {
    runMigration(MIGRATED_AT);
    const serialized = Object.values(KEYS)
      .map((k) => readRaw(k) ?? '')
      .join('');
    const apiKey = dump[LEGACY_KEYS.sbApiKey];
    if (apiKey && apiKey.length > 8) {
      expect(serialized.includes(apiKey)).toBe(false);
    }
  });
});
