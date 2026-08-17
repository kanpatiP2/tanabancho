import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend, readJson, setStorageBackend, type StorageBackend } from '@core/storage';
import { KEYS, LEGACY_KEYS, type MetaV2, type Note, type ShiwakeState } from '@core/types';
import {
  adoptLegacyApiKey,
  clearApiKey,
  getApiKey,
  isPersisted,
  maskApiKey,
  saveApiKey,
  setApiKeyStores,
} from './apikey';
import {
  BIN_MEMO_HISTORY_MAX,
  BIN_MEMO_TAG,
  loadBinMemoHistory,
  loadShiwakeState,
  pushBinMemoHistory,
  saveShiwakeState,
} from './state';

let store: StorageBackend;
let session: StorageBackend;
let local: StorageBackend;

beforeEach(() => {
  store = createMemoryBackend();
  session = createMemoryBackend();
  local = createMemoryBackend();
  setStorageBackend(store);
  setApiKeyStores(session, local);
});

function seed(key: string, value: unknown): void {
  store.setItem(key, JSON.stringify(value));
}

// ---------------------------------------------------------------- v1 取込

describe('loadShiwakeState', () => {
  it('何も無ければ空の state', () => {
    const { state, importedFromV1 } = loadShiwakeState();
    expect(state.items).toEqual([]);
    expect(importedFromV1).toBe(false);
  });

  it('sb_items / sb_carts / sb_alert_words を初回取込する', () => {
    seed(LEGACY_KEYS.sbItems, [
      { name: 'ドンベエ', code: '14901234567891', jan: '', qty_per_case: 12, cases: 2, cartIndex: 0, memo: 'メモ' },
      { name: 'カップヌードル', code: '4902000000004', qty_per_case: null, cases: 1, cartIndex: 1 },
    ]);
    seed(LEGACY_KEYS.sbCarts, [
      { index: 0, label: '仕器A 本店', delivery_date: '2026/8/17' },
      { index: 1, label: '仕器B', delivery_date: null },
    ]);
    seed(LEGACY_KEYS.sbAlertWords, ['どんべえ']);

    const { state, importedFromV1 } = loadShiwakeState();
    expect(importedFromV1).toBe(true);
    expect(state.items).toHaveLength(2);
    expect(state.items[0]).toMatchObject({ name: 'ドンベエ', jan: '4901234567894', memo: 'メモ', isAlert: true });
    expect(state.items[1]).toMatchObject({ qtyPerCase: null, isAlert: false });
    expect(state.carts[0]!.deliveryDate).toBe('2026-08-17');
    expect(state.carts[1]!.deliveryDate).toBe('');
    expect(state.alertWords).toEqual(['どんべえ']);
  });

  it('取込後は KEYS.shiwake と meta を書き、旧キーは残す', () => {
    seed(LEGACY_KEYS.sbAlertWords, ['UFO']);
    loadShiwakeState();

    expect(readJson<ShiwakeState>(KEYS.shiwake)?.alertWords).toEqual(['UFO']);
    expect(readJson<MetaV2>(KEYS.shiwakeMeta)).toMatchObject({
      schemaVersion: 2,
      migratedFrom: ['sb_items', 'sb_carts', 'sb_alert_words'],
    });
    // 旧キーは残置（v1 を壊さない）
    expect(store.getItem(LEGACY_KEYS.sbAlertWords)).not.toBeNull();
  });

  it('KEYS.shiwake が既にあれば v1 を読まない', () => {
    seed(KEYS.shiwake, { items: [], carts: [], alertWords: ['v2'], updatedAt: '' });
    seed(LEGACY_KEYS.sbAlertWords, ['v1']);
    const { state, importedFromV1 } = loadShiwakeState();
    expect(state.alertWords).toEqual(['v2']);
    expect(importedFromV1).toBe(false);
  });

  it('壊れた JSON でも起動できる', () => {
    store.setItem(KEYS.shiwake, '{broken');
    expect(loadShiwakeState().state.items).toEqual([]);
  });

  it('保存と読み戻しができる', () => {
    const state: ShiwakeState = {
      items: [],
      carts: [{ index: 0, label: '仕器A', deliveryDate: '2026-08-17' }],
      alertWords: ['UFO'],
      updatedAt: '',
    };
    expect(saveShiwakeState(state)).toBe(true);
    expect(loadShiwakeState().state.carts).toEqual(state.carts);
  });
});

// ---------------------------------------------------------------- 便メモ履歴

function binNote(i: number): Note {
  return {
    id: `n${i}`,
    // 「今」より必ず過去になる日付（新規メモが先頭に来ることを確かめるため）
    createdAt: `2020-01-${String(i).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: '',
    title: `便メモ ${i}`,
    text: `memo ${i}`,
    color: '#ffffff',
    pinned: false,
    tag: BIN_MEMO_TAG,
  };
}

describe('pushBinMemoHistory', () => {
  it('KEYS.notes に tag=bin-memo で積む', () => {
    const history = pushBinMemoHistory('夜間依頼あり');
    expect(history[0]).toMatchObject({ text: '夜間依頼あり', tag: BIN_MEMO_TAG });
    expect(readJson<Note[]>(KEYS.notes)).toHaveLength(1);
  });

  it('空メモは積まない', () => {
    expect(pushBinMemoHistory('   ')).toEqual([]);
    expect(readJson<Note[]>(KEYS.notes)).toBeNull();
  });

  it('上限を正しく丸める（v1 は pop 1回で 20件超が残るバグがあった）', () => {
    // 既に 25 件ある状態から 1 件足しても 20 件に収まること
    seed(KEYS.notes, Array.from({ length: 25 }, (_, i) => binNote(i + 1)));
    const history = pushBinMemoHistory('新しいメモ');
    expect(history).toHaveLength(BIN_MEMO_HISTORY_MAX);
    expect(history[0]!.text).toBe('新しいメモ');
    expect(readJson<Note[]>(KEYS.notes)!.filter((n) => n.tag === BIN_MEMO_TAG)).toHaveLength(20);
  });

  it('bin-memo 以外の Note には触らない', () => {
    const other: Note = { ...binNote(1), id: 'other', tag: undefined, text: '通常メモ' };
    seed(KEYS.notes, [other, ...Array.from({ length: 25 }, (_, i) => binNote(i + 1))]);
    pushBinMemoHistory('新');
    const all = readJson<Note[]>(KEYS.notes)!;
    expect(all.find((n) => n.id === 'other')).toEqual(other);
  });

  it('新しい順に並ぶ', () => {
    seed(KEYS.notes, [binNote(1), binNote(5), binNote(3)]);
    const history = loadBinMemoHistory();
    expect(history.map((n) => n.id)).toEqual(['n5', 'n3', 'n1']);
  });

  it('v2 履歴が無ければ v1 の sb_memo_history を表示に使う', () => {
    seed(LEGACY_KEYS.sbMemoHistory, [{ date: '2026/8/16 10:00', text: '旧メモ' }, { date: '', text: '' }]);
    const history = loadBinMemoHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ title: '2026/8/16 10:00', text: '旧メモ' });
  });
});

// ---------------------------------------------------------------- APIキー

describe('APIキー', () => {
  it('既定はセッションのみ（永続しない）', () => {
    saveApiKey('AIzaSyTESTKEY123456', false);
    expect(getApiKey()).toBe('AIzaSyTESTKEY123456');
    expect(isPersisted()).toBe(false);
    expect(local.getItem('sb.v2.apikey')).toBeNull();
    expect(session.getItem('sb.v2.apikey')).toBe('AIzaSyTESTKEY123456');
  });

  it('オプトインしたときだけ localStorage に永続保存する', () => {
    saveApiKey('AIzaSyTESTKEY123456', true);
    expect(isPersisted()).toBe(true);
    expect(local.getItem('sb.v2.apikey')).toBe('AIzaSyTESTKEY123456');
  });

  it('永続 → セッションのみへ切り替えると永続分を消す', () => {
    saveApiKey('AIzaSyTESTKEY123456', true);
    saveApiKey('AIzaSyTESTKEY123456', false);
    expect(isPersisted()).toBe(false);
    expect(getApiKey()).toBe('AIzaSyTESTKEY123456');
  });

  it('clearApiKey で両方消える', () => {
    saveApiKey('AIzaSyTESTKEY123456', true);
    clearApiKey();
    expect(getApiKey()).toBe('');
  });

  it('マスク表示（先頭6文字と末尾4文字のみ）', () => {
    expect(maskApiKey('AIzaSyTESTKEY123456')).toBe('AIzaSy••••••••3456');
    expect(maskApiKey('short')).toBe('•••••');
    expect(maskApiKey('')).toBe('');
  });

  it('旧 sb_api_key を初回のみ引き継ぐ（永続扱い・旧キーは残す）', () => {
    store.setItem(LEGACY_KEYS.sbApiKey, 'AIzaSyLEGACYKEY0001');
    expect(adoptLegacyApiKey()).toBe(true);
    expect(getApiKey()).toBe('AIzaSyLEGACYKEY0001');
    expect(isPersisted()).toBe(true);
    expect(store.getItem(LEGACY_KEYS.sbApiKey)).toBe('AIzaSyLEGACYKEY0001');
    // 2回目は何もしない
    expect(adoptLegacyApiKey()).toBe(false);
  });

  it('v2 キーがあれば旧キーで上書きしない', () => {
    saveApiKey('AIzaSyNEWKEY0000001', false);
    store.setItem(LEGACY_KEYS.sbApiKey, 'AIzaSyLEGACYKEY0001');
    expect(adoptLegacyApiKey()).toBe(false);
    expect(getApiKey()).toBe('AIzaSyNEWKEY0000001');
  });
});
