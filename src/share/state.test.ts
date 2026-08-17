import { beforeAll, describe, expect, it } from 'vitest';
import { buildShareUrl, encodeShareData } from '@core/share-codec';
import { createMemoryBackend, setStorageBackend } from '@core/storage';
import { LEGACY_KEYS } from '@core/types';
import {
  SHARE_SCAN_KEY,
  addCode,
  clearScanned,
  dismissToast,
  initShareState,
  readUrlPayload,
  receiveError,
  received,
  scanned,
  tab,
  toast,
} from './state';

const backend = createMemoryBackend();

beforeAll(() => {
  setStorageBackend(backend);
  // v1 の共有ツールが残したキー（自社版・汎用版の両方）
  backend.setItem(
    LEGACY_KEYS.shareTanabancho,
    JSON.stringify([
      { id: 'sh1', code: '4901234567894', time: '14:09' },
      { id: 'sh2', code: '4900000000005', time: '14:10' },
    ]),
  );
  backend.setItem(LEGACY_KEYS.shareSellfloor, JSON.stringify([{ id: 'sf1', code: '4901234567894', time: '09:00' }]));
});

describe('initShareState', () => {
  it('旧キーを初回のみ取り込み、重複コードは1件にまとめる', () => {
    initShareState();
    expect(scanned.value.map((i) => i.jan)).toEqual(['4901234567894', '4900000000005']);
    expect(scanned.value[0]!._legacyId).toBe('sh1');
    expect(scanned.value[0]!._approxDate).toBe(true);
    // 旧キーは読むだけ（書き戻さない）
    expect(JSON.parse(backend.getItem(LEGACY_KEYS.shareTanabancho)!)).toHaveLength(2);
  });

  it('取り込み結果は共有ビュー専用キーに保存され、取り込み済みフラグが立つ', () => {
    const stored = JSON.parse(backend.getItem(SHARE_SCAN_KEY)!) as { legacyImported: boolean; items: unknown[] };
    expect(stored.legacyImported).toBe(true);
    expect(stored.items).toHaveLength(2);
  });

  it('2回目以降は何もしない（冪等）', () => {
    const before = scanned.value;
    initShareState();
    expect(scanned.value).toBe(before);
  });
});

describe('addCode', () => {
  it('新しいコードを先頭に積む', () => {
    const r = addCode('4912345678904');
    expect(r.ok).toBe(true);
    expect(scanned.value[0]!.jan).toBe('4912345678904');
    expect(scanned.value[0]!.noLearn).toBe(true);
  });

  it('重複は拒否する', () => {
    const n = scanned.value.length;
    expect(addCode('4912345678904')).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(scanned.value).toHaveLength(n);
  });

  it('空・URL・記号混じりは弾く', () => {
    expect(addCode('   ')).toMatchObject({ ok: false, reason: 'empty' });
    expect(addCode('https://example.com/share.html')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(addCode('4901-2345')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('空白は詰めて登録する', () => {
    expect(addCode(' 4900000000012 ')).toMatchObject({ ok: true, jan: '4900000000012' });
  });
});

describe('clearScanned', () => {
  it('全消去は Undo 付きトーストで取り消せる（confirm を使わない）', () => {
    const before = scanned.value;
    expect(before.length).toBeGreaterThan(0);

    clearScanned();
    expect(scanned.value).toEqual([]);
    expect(toast.value?.onUndo).toBeTypeOf('function');

    toast.value!.onUndo!();
    expect(scanned.value).toEqual(before);
    dismissToast();
  });

  it('空の状態では警告トーストのみ', () => {
    scanned.value = [];
    clearScanned();
    expect(toast.value?.tone).toBe('warn');
    dismissToast();
  });
});

function resetReceive(): void {
  received.value = null;
  receiveError.value = '';
}

describe('readUrlPayload', () => {
  it('?data= を復号して受信タブを開く', () => {
    resetReceive();
    const url = buildShareUrl(
      'https://example.com/tanabancho/share.html',
      encodeShareData([
        {
          id: 'x',
          createdAt: '2026-08-17T05:09:00.000Z',
          updatedAt: '2026-08-17T05:09:00.000Z',
          jan: '4901234567894',
          name: '受信テスト',
          memo: '',
          genre: '',
          end: false,
          pop: [],
          order: [],
          expiry: '',
          boxJan: '',
          protected: false,
          noLearn: true,
        },
      ]),
      'main',
    );

    readUrlPayload(url);
    expect(receiveError.value).toBe('');
    expect(received.value?.items[0]?.n).toBe('受信テスト');
    expect(tab.value).toBe('recv');
  });

  it('壊れた data= はエラーメッセージにする（例外を投げない）', () => {
    resetReceive();
    readUrlPayload('https://example.com/share.html?data=!!!!&from=main');
    expect(received.value).toBeNull();
    expect(receiveError.value).not.toBe('');
  });

  it('data= が無ければ何もしない', () => {
    resetReceive();
    readUrlPayload('https://example.com/share.html');
    expect(received.value).toBeNull();
    expect(receiveError.value).toBe('');
  });
});
