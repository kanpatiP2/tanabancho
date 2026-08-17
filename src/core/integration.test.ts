/**
 * 一気通貫の統合テスト（P2）。
 *
 *   v1 実データ相当の合成フィクスチャ
 *     → bootMigration()（v1 → v2 移行）
 *     → getScans / getProducts … で件数と中身を検証
 *     → exportBackup()（v2 バックアップ書き出し）
 *     → 空の端末へ importBackup()（取込）
 *     → 元の端末と同じ状態になることを確認
 *
 * 個々の変換規則は migrate.test.ts / backup.test.ts が担当する。
 * ここは「モジュールを跨いだときに落ちない」ことだけを見る。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, importBackup } from './backup';
import { __resetBootMigrationForTest, bootMigration, lastMigrationReport, needsMigration } from './migrate';
import {
  createMemoryBackend,
  getCollection,
  getComp,
  getCust,
  getNotes,
  getProducts,
  getReturns,
  getScans,
  getShareRecv,
  getShiwake,
  setStorageBackend,
  type StorageBackend,
} from './storage';
import { LEGACY_KEYS } from './types';

// ---------------------------------------------------------------- フィクスチャ

/** v1 の localStorage を模した合成データ（実データは test-fixtures-local/ 側で検証する） */
const V1_DUMP: Record<string, string> = {
  [LEGACY_KEYS.list]: JSON.stringify([
    {
      id: '1755400000000abc',
      code: '4901234567894',
      productName: 'ドンベエ 天ぷらそば',
      memo: 'エンド用',
      genre: '麺類',
      end: true,
      popDetails: [{ size: '3号', qty: 2, lami: true, enlarge: 'A3', assignee: '山田' }],
      order: ['本発注', '追加'],
      expiry: '2026-09-30',
      boxJan: '14901234567891',
      isProtected: true,
      isNoLearn: false,
      dateStr: '2026-08-16',
      timeStr: '10:30',
    },
    {
      id: '1755400001111def',
      code: '4900000000005',
      productName: '',
      memo: '',
      genre: '',
      popSize: '5号',
      order: 'false',
      time: '2026-08-16 11:00',
    },
    // REMINDER 疑似アイテムは破棄される
    { id: 'rem1755400002222', code: 'REMINDER', productName: 'リマインダー' },
    // 日付を復元できない行（_approxDate になる）
    { id: 'x', code: '4912345678904', productName: '謎の商品' },
  ]),
  [LEGACY_KEYS.db]: JSON.stringify({
    '4901234567894': { name: 'ドンベエ 天ぷらそば', boxJan: '14901234567891', lastUsed: 1755400000000 },
    '4900000000005': 'カップヌードル', // 旧形式（文字列だけ）
  }),
  [LEGACY_KEYS.comp]: JSON.stringify([
    {
      id: 'comp1755400003333',
      date: '2026-08-18',
      jan: '4901234567894',
      name: 'ドンベエ',
      reason: '売価変更',
      memo: '98円',
      dismissed: false,
    },
  ]),
  [LEGACY_KEYS.return]: JSON.stringify([
    {
      id: '1755400004444ghi',
      jan: '4900000000005',
      start: '2026-08-01',
      end: '2026-08-31',
      returnDate: '2026-09-05',
      memo: '棚替え',
    },
  ]),
  [LEGACY_KEYS.cust]: JSON.stringify([
    {
      id: 'cust1755400005555',
      jan: '4912345678904',
      name: '取り寄せ商品',
      qty: 3,
      caseQty: 1,
      ordered: true,
      arrivalDate: '2026-08-20',
      deliveryDate: '2026-08-21',
      deliveryTime: '午前',
      phone: '090-0000-0000',
      willCall: true,
      called: false,
      memo: '要連絡',
    },
  ]),
  [LEGACY_KEYS.reminders]: JSON.stringify([
    { id: 'rem1755400006666', datetime: '2026-08-20T09:00', memo: '棚替え確認', fired: false },
  ]),
  [LEGACY_KEYS.notes]: JSON.stringify([
    { id: 'note1755400007777', title: '引継ぎ', text: '夜勤へ', color: '#fff9c4', pinned: true, updated: 1755400007777 },
  ]),
  [LEGACY_KEYS.shareTanabancho]: JSON.stringify([
    { id: 'sh1', code: '4901234567894', time: '14:09' },
    { id: 'sh2', code: '4900000000005', time: '14:10' },
  ]),
  [LEGACY_KEYS.shareSellfloor]: JSON.stringify([{ id: 'sf1', code: '4912345678904', time: '09:00' }]),
  [LEGACY_KEYS.sbItems]: JSON.stringify([
    { name: 'ドンベエ', code: '14901234567891', jan: '', qty_per_case: 12, cases: 2, cartIndex: 0, memo: '' },
    { name: 'カップヌードル', code: '4900000000005', qty_per_case: null, cases: 1, cartIndex: 1, memo: '' },
  ]),
  [LEGACY_KEYS.sbCarts]: JSON.stringify([
    { index: 0, label: '仕器A 本店', delivery_date: '2026-08-17' },
    { index: 1, label: '仕器B', delivery_date: null },
  ]),
  [LEGACY_KEYS.sbAlertWords]: JSON.stringify(['どんべえ']),
  [LEGACY_KEYS.sbGlobalMemo]: '22時便は要冷蔵あり',
  [LEGACY_KEYS.sbMemoHistory]: JSON.stringify([{ date: '2026/8/16 10:00', text: '前便メモ' }]),
};

const MIGRATED_AT = '2026-08-17T00:00:00.000Z';

function seedV1(backend: StorageBackend): void {
  for (const [k, v] of Object.entries(V1_DUMP)) backend.setItem(k, v);
}

let device: StorageBackend;

beforeEach(() => {
  device = createMemoryBackend();
  setStorageBackend(device);
  __resetBootMigrationForTest();
});

// ---------------------------------------------------------------- 移行

describe('v1 → v2 移行（起動時フック）', () => {
  it('bootMigration は1回だけ走り、2回目以降は同じレポートを返す', () => {
    seedV1(device);
    expect(needsMigration()).toBe(true);

    const first = bootMigration();
    expect(first?.ran).toBe(true);
    expect(first?.errors).toEqual([]);
    expect(bootMigration()).toBe(first);
    expect(lastMigrationReport()).toBe(first);
    expect(needsMigration()).toBe(false);
  });

  it('移行済みの端末では何もしない', () => {
    seedV1(device);
    bootMigration();
    __resetBootMigrationForTest();

    expect(bootMigration()).toBeNull();
    expect(lastMigrationReport()).toBeNull();
  });

  it('全コレクションが v1 の件数どおりに生成される', () => {
    seedV1(device);
    bootMigration();

    // REMINDER 疑似アイテム1件は破棄される
    expect(getScans()).toHaveLength(3);
    expect(Object.keys(getProducts())).toHaveLength(2);
    expect(getComp()).toHaveLength(1);
    expect(getReturns()).toHaveLength(1);
    expect(getCust()).toHaveLength(1);
    // ノート = メモ1 + リマインダー1 + 便メモ履歴1 + 現在の便メモ1
    expect(getNotes()).toHaveLength(4);
    // 共有受信 = 棚番長版2 + 売場版1
    expect(getShareRecv()).toHaveLength(3);
    expect(getShiwake().items).toHaveLength(2);
    expect(getShiwake().carts).toHaveLength(2);
    expect(getShiwake().alertWords).toEqual(['どんべえ']);
    // 便メモの下書きも引き継ぐ
    expect(getCollection('shiwakeMemoDraft')).toBe('22時便は要冷蔵あり');
  });

  it('主要フィールドが v2 の形へ正規化される', () => {
    seedV1(device);
    bootMigration();

    const scan = getScans().find((s) => s.jan === '4901234567894')!;
    expect(scan._legacyId).toBe('1755400000000abc');
    expect(scan.id).not.toBe(scan._legacyId);
    expect(scan.name).toBe('ドンベエ 天ぷらそば');
    expect(scan.order).toEqual(['本発注', '追加']);
    expect(scan.pop[0]).toMatchObject({ size: '3号', qty: 2, lami: true, enlarge: 'A3', assignee: '山田' });
    expect(scan.protected).toBe(true);
    expect(scan.createdAt.startsWith('2026-08-16')).toBe(true);

    // order: 'false' は空配列、popSize（旧形式）は1件の PopDetail に畳まれる
    const legacyShaped = getScans().find((s) => s.jan === '4900000000005')!;
    expect(legacyShaped.order).toEqual([]);
    expect(legacyShaped.pop).toEqual([{ size: '5号', qty: 1, lami: false, enlarge: '', assignee: '' }]);

    // 日付を復元できない行は _approxDate
    expect(getScans().find((s) => s.jan === '4912345678904')!._approxDate).toBe(true);

    // 旧形式（文字列）の辞書も Product になる
    expect(getProducts()['4900000000005']).toMatchObject({ name: 'カップヌードル', nameSource: 'manual' });

    // リマインダーは remindAt 付きの Note
    expect(getNotes().some((n) => n.remindAt && n.text === '棚替え確認')).toBe(true);
    // 便メモは tag:'bin-memo'
    expect(getNotes().filter((n) => n.tag === 'bin-memo')).toHaveLength(2);
  });

  it('v1 のキーは1つも書き換えない', () => {
    seedV1(device);
    bootMigration();

    for (const [k, v] of Object.entries(V1_DUMP)) {
      expect(device.getItem(k)).toBe(v);
    }
  });
});

// ---------------------------------------------------------------- バックアップ往復

describe('exportBackup → importBackup ラウンドトリップ', () => {
  it('別端末へ取り込むと同じ内容が復元される', () => {
    seedV1(device);
    bootMigration();

    const source = {
      scans: getScans(),
      products: getProducts(),
      comp: getComp(),
      returns: getReturns(),
      cust: getCust(),
      notes: getNotes(),
      shiwake: getShiwake(),
    };
    // JSON ファイルを経由するので文字列化して往復させる
    const file = JSON.stringify(exportBackup());

    // --- 新しい端末（空）へ取込
    const fresh = createMemoryBackend();
    setStorageBackend(fresh);
    const report = importBackup(file);

    expect(report.ok).toBe(true);
    expect(report.formatDetected).toBe(2);
    expect(report.errors).toEqual([]);
    expect(report.settingsApplied).toBe(true);

    expect(getScans()).toEqual(source.scans);
    expect(getProducts()).toEqual(source.products);
    expect(getComp()).toEqual(source.comp);
    expect(getReturns()).toEqual(source.returns);
    expect(getCust()).toEqual(source.cust);
    expect(getNotes()).toEqual(source.notes);
    expect(getShiwake()).toEqual(source.shiwake);

    // 取込件数の内訳も一致する
    const scansRow = report.collections.find((c) => c.target === 'scans')!;
    expect(scansRow).toMatchObject({ incoming: 3, added: 3, skipped: 0 });
  });

  it('同じバックアップを2回取り込んでも増えない（id / _legacyId で重複除外）', () => {
    seedV1(device);
    bootMigration();
    const file = JSON.stringify(exportBackup());

    const before = getScans().length;
    const report = importBackup(file);

    expect(report.ok).toBe(true);
    expect(report.totals.added).toBe(0);
    expect(getScans()).toHaveLength(before);
    expect(getNotes()).toHaveLength(4);
  });

  it('作業中の仕分データは上書きせず警告する', () => {
    seedV1(device);
    bootMigration();
    const file = JSON.stringify(exportBackup());

    // 仕分番長に作業中データがある端末へ取り込む
    const other = createMemoryBackend();
    setStorageBackend(other);
    other.setItem(
      'sb.v2.state',
      JSON.stringify({
        items: [
          {
            id: 'working',
            name: '作業中',
            code: '',
            jan: '',
            qtyPerCase: null,
            cases: 1,
            cartIndex: 0,
            memo: '',
            isAlert: false,
          },
        ],
        carts: [],
        alertWords: [],
        updatedAt: '',
      }),
    );

    const report = importBackup(file);
    expect(report.ok).toBe(true);
    expect(report.warnings.some((w) => w.includes('仕分番長'))).toBe(true);
    expect(getShiwake().items).toHaveLength(1);
    expect(getShiwake().items[0]!.id).toBe('working');
  });

  it('v1 形式のバックアップファイルも取り込める', () => {
    // v1 の exportData 相当（list / db / comp / return / cust / notes）
    const v1File = JSON.stringify({
      date: '2026-08-16',
      title: '棚番長バックアップ',
      list: JSON.parse(V1_DUMP[LEGACY_KEYS.list]!),
      db: JSON.parse(V1_DUMP[LEGACY_KEYS.db]!),
      comp: JSON.parse(V1_DUMP[LEGACY_KEYS.comp]!),
      return: JSON.parse(V1_DUMP[LEGACY_KEYS.return]!),
      cust: JSON.parse(V1_DUMP[LEGACY_KEYS.cust]!),
      notes: JSON.parse(V1_DUMP[LEGACY_KEYS.notes]!),
    });

    const report = importBackup(v1File, MIGRATED_AT);
    expect(report.formatDetected).toBe(1);
    expect(report.ok).toBe(true);
    expect(getScans()).toHaveLength(3); // REMINDER は破棄
    expect(Object.keys(getProducts())).toHaveLength(2);
    expect(getCust()).toHaveLength(1);
  });

  // 実運用ではこの順序にならない（起動時に必ず移行してから取込画面に入れる）が、
  // 万一この順序になっても「v1 を正として作り直す」ことを固定しておく
  it('未移行の端末へ取り込んだ場合は、後から走る移行が v1 を正としてやり直す', () => {
    seedV1(device);
    bootMigration();
    const file = JSON.stringify(exportBackup());

    // v1 データを持ったまま未移行の端末（機種変更の途中など）
    const other = createMemoryBackend();
    setStorageBackend(other);
    seedV1(other);
    __resetBootMigrationForTest();

    expect(importBackup(file).ok).toBe(true);
    const afterImport = getScans().length;

    // 取込では meta を書かないので移行はこの後に走る
    expect(needsMigration()).toBe(true);
    bootMigration();

    // 移行は v1 を読み直して書き直すため、件数は v1 由来の3件に収束する
    expect(afterImport).toBe(3);
    expect(getScans()).toHaveLength(3);
    expect(getScans().every((s) => s._legacyId)).toBe(true);
  });
});
