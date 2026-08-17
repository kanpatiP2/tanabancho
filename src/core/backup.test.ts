import { beforeEach, describe, expect, it } from 'vitest';

import { exportBackup, importBackup } from './backup';
import {
  createMemoryBackend,
  getCollection,
  setCollection,
  setStorageBackend,
  type StorageBackend,
} from './storage';
import { DEFAULT_SETTINGS } from './profile';
import { KEYS } from './types';
import type { ScanItem } from './types';

const AT = '2026-08-17T00:00:00.000Z';
const TS_A = 1_755_000_000_000;

let backend: StorageBackend;

beforeEach(() => {
  backend = createMemoryBackend();
  setStorageBackend(backend);
});

function scan(over: Partial<ScanItem> = {}): ScanItem {
  return {
    id: 'existing-1',
    createdAt: AT,
    updatedAt: AT,
    jan: '4901234567894',
    name: '既存商品',
    memo: '',
    genre: '',
    end: false,
    pop: [],
    order: [],
    expiry: '',
    boxJan: '',
    protected: false,
    noLearn: false,
    ...over,
  };
}

describe('exportBackup', () => {
  it('v1 で漏れていた notes / settings / orders も含めて全コレクションを書き出す', () => {
    setCollection('scans', [scan()]);
    setCollection('notes', [
      {
        id: 'n1',
        createdAt: AT,
        updatedAt: AT,
        title: 'メモ',
        text: '本文',
        color: '#ffffff',
        pinned: false,
      },
    ]);

    const b = exportBackup(AT);
    expect(b.formatVersion).toBe(2);
    expect(b.exportedAt).toBe(AT);
    expect(Object.keys(b).sort()).toEqual(
      [
        'comp',
        'cust',
        'exportedAt',
        'formatVersion',
        'notes',
        'orders',
        'products',
        'returns',
        'scans',
        'settings',
        'shiwake',
      ].sort(),
    );
    expect(b.scans).toHaveLength(1);
    expect(b.notes).toHaveLength(1);
    expect(b.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('書き出し → 取込 で往復できる（同一データは重複しない）', () => {
    setCollection('scans', [scan(), scan({ id: 'existing-2', jan: '4901234567900' })]);
    const b = exportBackup(AT);

    const report = importBackup(b, AT);
    expect(report.ok).toBe(true);
    expect(report.formatDetected).toBe(2);
    // 既存と同じ id なので1件も増えない
    expect(getCollection('scans')).toHaveLength(2);
    expect(report.collections.find((c) => c.target === 'scans')!.skipped).toBe(2);
  });
});

describe('importBackup — v2 形式', () => {
  it('既存を消さずに結合し、id 重複は除外する', () => {
    setCollection('scans', [scan()]);

    const report = importBackup(
      {
        formatVersion: 2,
        exportedAt: AT,
        scans: [
          scan(), // id 重複
          scan({ id: 'imported-1', jan: '4901234567900', name: '取込商品' }),
        ],
        products: {},
        comp: [],
        returns: [],
        cust: [],
        notes: [],
        orders: [],
        settings: DEFAULT_SETTINGS,
      },
      AT,
    );

    expect(report.ok).toBe(true);
    const scans = getCollection('scans');
    expect(scans).toHaveLength(2);
    expect(scans.map((s) => s.id)).toEqual(['existing-1', 'imported-1']);
    const r = report.collections.find((c) => c.target === 'scans')!;
    expect(r).toMatchObject({ incoming: 2, added: 1, skipped: 1 });
  });

  it('_legacyId が一致する項目も重複として除外する（共有URL往復対策）', () => {
    setCollection('scans', [scan({ id: 'local-uuid', _legacyId: `${TS_A}aaa11` })]);

    const report = importBackup(
      {
        formatVersion: 2,
        exportedAt: AT,
        scans: [scan({ id: 'other-uuid', _legacyId: `${TS_A}aaa11` })],
        products: {},
        comp: [],
        returns: [],
        cust: [],
        notes: [],
        orders: [],
        settings: DEFAULT_SETTINGS,
      },
      AT,
    );

    expect(getCollection('scans')).toHaveLength(1);
    expect(report.collections.find((c) => c.target === 'scans')!.skipped).toBe(1);
  });

  it('辞書は mergeProduct の優先度（manual > gemini > ext）で結合する', () => {
    setCollection('products', {
      '4901234567894': {
        jan: '4901234567894',
        name: '手入力の名前',
        nameSource: 'manual',
        boxJan: '',
        expiryOffsets: [3],
        lastUsedAt: AT,
        updatedAt: AT,
      },
    });

    importBackup(
      {
        formatVersion: 2,
        exportedAt: AT,
        scans: [],
        products: {
          '4901234567894': {
            jan: '4901234567894',
            name: '外部照会の名前',
            nameSource: 'ext',
            boxJan: '14901234567891',
            expiryOffsets: [],
            lastUsedAt: AT,
            updatedAt: AT,
          },
          '4901234567900': {
            jan: '4901234567900',
            name: '新規商品',
            nameSource: 'ext',
            boxJan: '',
            expiryOffsets: [],
            lastUsedAt: AT,
            updatedAt: AT,
          },
        },
        comp: [],
        returns: [],
        cust: [],
        notes: [],
        orders: [],
        settings: DEFAULT_SETTINGS,
      },
      AT,
    );

    const db = getCollection('products');
    // manual は ext に負けない
    expect(db['4901234567894']!.name).toBe('手入力の名前');
    expect(db['4901234567894']!.nameSource).toBe('manual');
    // 空欄の補完は行われる
    expect(db['4901234567894']!.boxJan).toBe('14901234567891');
    expect(db['4901234567894']!.expiryOffsets).toEqual([3]);
    expect(db['4901234567900']!.name).toBe('新規商品');
  });

  it('壊れたレコードは取り込まず警告する', () => {
    const report = importBackup(
      {
        formatVersion: 2,
        exportedAt: AT,
        scans: [scan({ id: 'ok-1' }), null, 'junk', 42],
        products: {},
        comp: [],
        returns: [],
        cust: [],
        notes: [],
        orders: [],
        settings: DEFAULT_SETTINGS,
      },
      AT,
    );
    expect(report.ok).toBe(true);
    expect(getCollection('scans')).toHaveLength(1);
    expect(report.warnings.some((w) => w.includes('3件'))).toBe(true);
  });

  it('仕分番長に作業中データがあれば上書きせず警告する', () => {
    setCollection('shiwake', {
      items: [
        {
          id: 'cur-1',
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
      updatedAt: AT,
    });

    const report = importBackup(
      {
        formatVersion: 2,
        exportedAt: AT,
        scans: [],
        products: {},
        comp: [],
        returns: [],
        cust: [],
        notes: [],
        orders: [],
        settings: DEFAULT_SETTINGS,
        shiwake: { items: [], carts: [], alertWords: ['冷凍'], updatedAt: AT },
      },
      AT,
    );

    expect(getCollection('shiwake').items[0]!.name).toBe('作業中');
    expect(getCollection('shiwake').alertWords).toEqual([]);
    expect(report.warnings.some((w) => w.includes('仕分番長'))).toBe(true);
  });

  it('設定は取り込んで反映する', () => {
    const report = importBackup(
      {
        formatVersion: 2,
        exportedAt: AT,
        scans: [],
        products: {},
        comp: [],
        returns: [],
        cust: [],
        notes: [],
        orders: [],
        settings: { ...DEFAULT_SETTINGS, profile: 'jisha', qrBatchSize: 30 },
      },
      AT,
    );
    expect(report.settingsApplied).toBe(true);
    expect(getCollection('settings').profile).toBe('jisha');
    expect(getCollection('settings').qrBatchSize).toBe(30);
  });
});

describe('importBackup — v1 形式', () => {
  const v1Backup = {
    date: '2026-08-16T12:00:00.000Z',
    list: [
      {
        id: `${TS_A}aaa11`,
        code: '4901234567894',
        time: '14:32',
        productName: 'v1商品A',
        memo: '',
        genre: '1番',
        pop: true,
        popSize: '5号', // 旧形式
        end: false,
        order: 'false',
        expiry: '2026-09-01',
        isNoLearn: false,
        boxJan: '',
        isProtected: false,
      },
      {
        id: `rem${TS_A}`,
        code: 'REMINDER', // 破棄される
        time: '9:00',
        productName: 'リマインダー',
        genre: '⏰リマインダー',
        pop: false,
        end: false,
        order: [],
        expiry: '',
        isNoLearn: true,
        boxJan: '',
        isProtected: false,
      },
    ],
    db: {
      '4901234567894': { name: 'v1商品A', boxJan: '14901234567891', lastUsed: TS_A },
      '4901234567900': 'v1商品B（文字列形式）',
    },
    comp: [
      {
        id: TS_A,
        date: '2026-07-01',
        jan: '4901234567894',
        name: 'v1商品A',
        reason: '売価変更',
        memo: '',
        dismissed: false,
      },
    ],
    return: [],
    cust: [
      {
        id: TS_A,
        jan: '4901234567894',
        arrivalDate: '2026-08-20',
        deliveryDate: '',
        phone: '',
        willCall: false,
        called: false,
        memo: '',
        ordered: false,
        dismissedArrival: false,
        dismissedDelivery: false,
      },
    ],
    notes: [
      {
        id: TS_A,
        title: 'v1メモ',
        text: '本文',
        color: '#fff9c4',
        pinned: false,
        updated: TS_A,
      },
    ],
  };

  it('migrate の変換を再利用して v2 化してから結合する', () => {
    const report = importBackup(v1Backup, AT);

    expect(report.ok).toBe(true);
    expect(report.formatDetected).toBe(1);

    const scans = getCollection('scans');
    expect(scans).toHaveLength(1); // REMINDER は破棄
    expect(scans[0]!.jan).toBe('4901234567894');
    expect(scans[0]!._legacyId).toBe(`${TS_A}aaa11`);
    expect(scans[0]!.createdAt).toBe(new Date(TS_A).toISOString());
    expect(scans[0]!.pop).toEqual([
      { size: '5号', qty: 1, lami: false, enlarge: '', assignee: '' },
    ]);
    expect(scans[0]!.order).toEqual([]);

    const db = getCollection('products');
    expect(Object.keys(db)).toHaveLength(2);
    expect(db['4901234567900']!.name).toBe('v1商品B（文字列形式）');

    expect(getCollection('comp')[0]!.reason).toBe('売価変更');
    expect(getCollection('cust')).toHaveLength(1);
    expect(getCollection('notes')[0]!.title).toBe('v1メモ');
    // v1 バックアップに設定は無い
    expect(report.settingsApplied).toBe(false);
  });

  it('同じ v1 バックアップを2回取り込んでも増えない（_legacyId で除外）', () => {
    importBackup(v1Backup, AT);
    const first = getCollection('scans').length;
    const report = importBackup(v1Backup, AT);
    expect(getCollection('scans')).toHaveLength(first);
    expect(report.collections.find((c) => c.target === 'scans')!.added).toBe(0);
  });

  it('JSON 文字列でも受け付ける', () => {
    const report = importBackup(JSON.stringify(v1Backup), AT);
    expect(report.ok).toBe(true);
    expect(getCollection('scans')).toHaveLength(1);
  });
});

describe('importBackup — エラー', () => {
  it('棚番長のバックアップでなければ形式エラー', () => {
    const report = importBackup({ hello: 'world' }, AT);
    expect(report.ok).toBe(false);
    expect(report.formatDetected).toBeNull();
    expect(report.errors).toHaveLength(1);
  });

  it('JSON でなければ形式エラー', () => {
    expect(importBackup('not json at all', AT).ok).toBe(false);
    expect(importBackup(null, AT).ok).toBe(false);
    expect(importBackup([1, 2, 3], AT).ok).toBe(false);
  });

  it('保存に失敗したら取込前の状態へ巻き戻す', () => {
    setCollection('scans', [scan()]);
    const before = backend.getItem(KEYS.scans);

    const failing: StorageBackend = {
      ...backend,
      setItem(key, value) {
        if (key === KEYS.notes) throw new Error('QuotaExceededError');
        backend.setItem(key, value);
      },
    };
    setStorageBackend(failing);

    const report = importBackup(
      {
        formatVersion: 2,
        exportedAt: AT,
        scans: [scan({ id: 'imported-1' })],
        products: {},
        comp: [],
        returns: [],
        cust: [],
        notes: [],
        orders: [],
        settings: DEFAULT_SETTINGS,
      },
      AT,
    );

    expect(report.ok).toBe(false);
    expect(report.errors).toHaveLength(1);
    setStorageBackend(backend);
    expect(backend.getItem(KEYS.scans)).toBe(before);
    expect(getCollection('scans')).toHaveLength(1);
  });
});
