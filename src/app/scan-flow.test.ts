// @vitest-environment jsdom
/**
 * スキャン経路の通し（統合）テスト。
 *
 * 対象は「入力 → scan-bridge（session）→ intent 別ハンドラ → draft/store」の一本道。
 * DOM を持つ部分（トースト・期限パッド・カメラ映像）はフック（ScanUiHooks）で差し替え、
 * それ以外は本番と同じモジュールをそのまま結線する:
 *
 *   dispatchCode() → session.input() → resolveCode() → 重複判定 → 辞書照合
 *                  → handleScannedCode() → registerScan() / addToOrder() / …
 *
 * ウェッジ経路は document への KeyboardEvent で、手入力経路は dispatchCode(_, 'manual') で、
 * カメラ経路は camera アダプタの onDetect と同じ dispatchCode(_, 'camera') で再現する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, todayLocal } from '@core/datetime';
import { createMemoryBackend, setStorageBackend } from '@core/storage';
import { createMemoryKv, setLookupKv } from '@lookup/index';
import type { ResolvedCode } from '@core/types';
import {
  attachWedge,
  cancelPendingExpiry,
  dispatchCode,
  flushPendingExpiry,
  pendingExpiry,
  scanIntent,
  setCodeHandler,
  setDuplicateHandler,
  setExpiryCommitHandler,
  setFieldHandler,
  setScanIntent,
} from './scan-bridge';
import {
  handleDuplicate,
  handleExpiryCommit,
  handleScannedCode,
  type ExpiryPadTarget,
  type ScanNotice,
  type ScanUiHooks,
} from './scan/handlers';
import {
  abortFieldScan,
  deliverFieldScan,
  fieldScanRequest,
  fieldScanValue,
  requestFieldScan,
} from './scan/field-scan';
import {
  activeOrderListId,
  addCompCheckToHistory,
  captureDraft,
  compPending,
  flash,
  lastExpiry,
  patchCapture,
  popDraft,
} from './scan/draft';
import {
  __resetStoreForTest,
  addCompetitor,
  competitors,
  learnExpiryOffset,
  learnProduct,
  orderLists,
  products,
  scans,
  stamp,
} from './store';

/** ITF-14（箱） → JAN13。1 + 490123456789 + ITFのCD、変換後は CD 再計算で末尾 4 */
const ITF14 = '14901234567893';
const ITF14_AS_JAN = '4901234567894';
const JAN_A = '4901111111116';
const JAN_B = '4902222222225';

// ---------------------------------------------------------------- UI フック（トースト等の代役）

let notices: ScanNotice[] = [];
let padOpened: ExpiryPadTarget[] = [];
let feedbacks: boolean[] = [];
let autoExpiry = true;

const ui: ScanUiHooks = {
  intent: () => scanIntent.value,
  autoExpiry: () => autoExpiry,
  feedback: (ok) => void feedbacks.push(ok),
  notify: (n) => void notices.push(n),
  openExpiryPad: (t) => void padOpened.push(t),
};

/** ScanTab が useEffect でやっている結線と同じもの */
function wireScanTab(): void {
  setCodeHandler((resolved: ResolvedCode) => handleScannedCode(resolved, ui));
  setDuplicateHandler((resolved) => handleDuplicate(resolved, ui));
  setExpiryCommitHandler((p) => handleExpiryCommit(p, ui));
}

/** FieldScanSheet が開いている間の結線と同じもの */
function wireFieldSheet(): void {
  setFieldHandler((ev) => deliverFieldScan(ev));
}

function messages(): string[] {
  return notices.map((n) => n.message);
}

beforeEach(() => {
  setStorageBackend(createMemoryBackend());
  setLookupKv(createMemoryKv());
  __resetStoreForTest();

  // 外部JAN照会が実際に外へ出ないようにする（オフライン扱い＋fetch 封じ）
  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network disabled in test');
    }),
  );

  // モジュールローカルな signal / session を初期状態へ
  captureDraft.value = { name: '', end: false, order: [], genre: '', memo: '', keep: false };
  popDraft.value = [];
  compPending.value = null;
  flash.value = null;
  lastExpiry.value = '';
  activeOrderListId.value = '';
  cancelPendingExpiry();
  abortFieldScan();
  setScanIntent('capture');

  notices = [];
  padOpened = [];
  feedbacks = [];
  autoExpiry = true;
  wireScanTab();
});

afterEach(() => {
  setCodeHandler(null);
  setDuplicateHandler(null);
  setExpiryCommitHandler(null);
  setFieldHandler(null);
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------- 入力経路

describe('入力経路の合流', () => {
  it('カメラ・ウェッジ・手入力のどれから来ても同じ1本に合流する', () => {
    dispatchCode(JAN_A, 'camera');
    dispatchCode(JAN_B, 'manual');

    const detach = attachWedge();
    typeWedge('4903333333334');
    detach();

    expect(scans.value.map((s) => s.jan)).toEqual([
      '4903333333334', // 新しいものが先頭
      JAN_B,
      JAN_A,
    ]);
  });

  it('ウェッジは入力欄にフォーカスがあるときは介入しない（素通し）', () => {
    const detach = attachWedge();
    const input = document.createElement('input');
    document.body.appendChild(input);
    typeWedge(JAN_A, input);
    detach();
    input.remove();

    expect(scans.value).toHaveLength(0);
  });

  it('URL・記号混じり・空文字はコードとして解釈しない', () => {
    expect(dispatchCode('https://example.com/x', 'camera')).toBeNull();
    expect(dispatchCode('', 'manual')).toBeNull();
    expect(dispatchCode('49012#4567894', 'manual')).toBeNull();
    expect(scans.value).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- 正規化

describe('正規化（resolveCode）', () => {
  it('ITF-14 は JAN13 に変換して登録される', () => {
    const result = dispatchCode(ITF14, 'camera');

    expect(result?.ok).toBe(true);
    expect(result?.resolved.jan).toBe(ITF14_AS_JAN);
    expect(result?.resolved.fromItf).toBe(true);
    expect(scans.value[0]?.jan).toBe(ITF14_AS_JAN);
    expect(flash.value?.fromItf).toBe(true);
  });

  it('箱JAN（本体で登録した変換後13桁）はバラJANに置換される', () => {
    learnProduct(JAN_A, { name: 'バラ商品', boxJan: ITF14_AS_JAN });

    const result = dispatchCode(ITF14, 'camera');

    expect(result?.resolved.jan).toBe(JAN_A);
    expect(result?.resolved.fromBoxJan).toBe(true);
    expect(scans.value[0]?.jan).toBe(JAN_A);
    expect(scans.value[0]?.name).toBe('バラ商品');
  });

  it('箱JAN（仕分番長が還流した生 ITF-14）でもバラJANに置換される', () => {
    learnProduct(JAN_B, { name: '明細由来', boxJan: ITF14 });

    const result = dispatchCode(ITF14, 'camera');

    expect(result?.resolved.jan).toBe(JAN_B);
    expect(result?.resolved.fromBoxJan).toBe(true);
  });

  it('先頭0のコードは leadingZero を立てて渡す（UIの注意表示用）', () => {
    const result = dispatchCode('0490123456789', 'manual');
    expect(result?.resolved.leadingZero).toBe(true);
  });
});

// ---------------------------------------------------------------- capture

describe('intent: capture（通常登録）', () => {
  it('スキャン前設定が履歴に載り、辞書へ名前が学習される', () => {
    patchCapture({ name: 'テスト商品', genre: '菓子', memo: 'メモ', end: true, order: ['本部'] });

    dispatchCode(JAN_A, 'camera');

    const item = scans.value[0]!;
    expect(item).toMatchObject({
      jan: JAN_A,
      name: 'テスト商品',
      genre: '菓子',
      memo: 'メモ',
      end: true,
      order: ['本部'],
    });
    expect(products.value[JAN_A]).toMatchObject({ name: 'テスト商品', nameSource: 'manual' });
    expect(flash.value).toMatchObject({ jan: JAN_A, name: 'テスト商品', known: true });
  });

  it('📌維持 OFF なら下書きは全消去、ON なら商品名だけ消える', () => {
    patchCapture({ name: 'A商品', genre: '菓子', memo: 'メモ', end: true, keep: false });
    dispatchCode(JAN_A, 'camera');
    expect(captureDraft.value).toMatchObject({ name: '', genre: '', memo: '', end: false });

    patchCapture({ name: 'B商品', genre: '飲料', memo: '棚下', end: true, keep: true });
    dispatchCode(JAN_B, 'camera');
    expect(captureDraft.value).toMatchObject({
      name: '',
      genre: '飲料',
      memo: '棚下',
      end: true,
      keep: true,
    });
  });

  it('辞書に名前があればスキャンだけで名前が入る', () => {
    learnProduct(JAN_A, { name: '学習済み商品' });
    dispatchCode(JAN_A, 'manual');
    expect(scans.value[0]?.name).toBe('学習済み商品');
  });
});

// ---------------------------------------------------------------- 重複

describe('重複弾き', () => {
  it('2回目は履歴に積まれず、ユーザーに通知される（無言で捨てない）', () => {
    dispatchCode(JAN_A, 'camera');
    const second = dispatchCode(JAN_A, 'camera');

    expect(scans.value).toHaveLength(1);
    expect(second?.ok).toBe(false);
    expect(second?.reason).toBe('duplicate');
    expect(messages().some((m) => m.includes('リストに存在する'))).toBe(true);
    expect(feedbacks).toContain(false);
  });

  it('重複判定は正規化後のJANで行う（ITF と バラJAN は同一視）', () => {
    learnProduct(JAN_A, { name: 'バラ商品', boxJan: ITF14_AS_JAN });
    dispatchCode(JAN_A, 'manual');

    const second = dispatchCode(ITF14, 'camera');

    expect(second?.reason).toBe('duplicate');
    expect(scans.value).toHaveLength(1);
  });

  it('重複でもモードは消費されない（同じモードのまま読み直せる）', () => {
    setScanIntent('pop');
    dispatchCode(JAN_A, 'camera');
    dispatchCode(JAN_A, 'camera');
    expect(scanIntent.value).toBe('pop');
  });

  it('発注モードは重複ガードの対象外（同じJANを何度でも読める）', () => {
    setScanIntent('order');
    dispatchCode(JAN_A, 'camera');
    dispatchCode(JAN_A, 'camera');
    const list = orderLists.value[0]!;
    expect(list.lines).toEqual([{ jan: JAN_A, qty: 2 }]);
  });
});

// ---------------------------------------------------------------- expiry

describe('intent: expiry（期限モード）', () => {
  it('提案値は次のスキャンで自動確定され、そのスキャンの提案が保留になる', () => {
    learnExpiryOffset(JAN_A, 5);
    learnExpiryOffset(JAN_B, 10);
    const today = todayLocal();
    setScanIntent('expiry');

    // 1回目: 期限は空のまま登録し、提案は保留
    dispatchCode(JAN_A, 'camera');
    expect(scans.value[0]).toMatchObject({ jan: JAN_A, expiry: '' });
    expect(pendingExpiry.value).toMatchObject({ jan: JAN_A, expiry: addDays(today, 5) });
    expect(padOpened).toHaveLength(0);

    // 2回目: 1回目の提案がここで確定し、2回目の提案が保留になる
    dispatchCode(JAN_B, 'camera');
    expect(scans.value.find((s) => s.jan === JAN_A)?.expiry).toBe(addDays(today, 5));
    expect(pendingExpiry.value).toMatchObject({ jan: JAN_B, expiry: addDays(today, 10) });

    // モードを抜けると残りも確定する
    setScanIntent('capture');
    expect(scans.value.find((s) => s.jan === JAN_B)?.expiry).toBe(addDays(today, 10));
    expect(pendingExpiry.value).toBeNull();
  });

  it('flushPendingExpiry で即確定できる', () => {
    learnExpiryOffset(JAN_A, 3);
    setScanIntent('expiry');
    dispatchCode(JAN_A, 'camera');

    flushPendingExpiry();

    expect(scans.value[0]?.expiry).toBe(addDays(todayLocal(), 3));
    expect(pendingExpiry.value).toBeNull();
  });

  it('cancelPendingExpiry（「今すぐ変更」）なら自動確定しない', () => {
    learnExpiryOffset(JAN_A, 3);
    setScanIntent('expiry');
    dispatchCode(JAN_A, 'camera');

    cancelPendingExpiry();
    dispatchCode(JAN_B, 'camera');

    expect(scans.value.find((s) => s.jan === JAN_A)?.expiry).toBe('');
  });

  it('学習が無いJANは提案を出さず、その場で期限パッドを開く', () => {
    setScanIntent('expiry');
    dispatchCode(JAN_A, 'camera');

    expect(pendingExpiry.value).toBeNull();
    expect(padOpened[0]).toMatchObject({ jan: JAN_A });
  });

  it('自動確定 OFF なら提案があってもパッドを開く', () => {
    autoExpiry = false;
    learnExpiryOffset(JAN_A, 7);
    setScanIntent('expiry');

    dispatchCode(JAN_A, 'camera');

    expect(pendingExpiry.value).toBeNull();
    expect(padOpened[0]).toMatchObject({ jan: JAN_A });
  });

  it('確定した期限は辞書のオフセットとして学習される', () => {
    learnExpiryOffset(JAN_A, 5);
    setScanIntent('expiry');
    dispatchCode(JAN_A, 'camera');
    flushPendingExpiry();

    expect(products.value[JAN_A]?.expiryOffsets).toEqual([5, 5]);
    expect(lastExpiry.value).toBe(addDays(todayLocal(), 5));
  });
});

// ---------------------------------------------------------------- pop / order / compCheck

describe('intent: pop', () => {
  it('現在の組合せが登録に即適用され、組合せは次のスキャンにも残る', () => {
    popDraft.value = [{ size: '5号', qty: 2, lami: true, enlarge: '', assignee: '' }];
    setScanIntent('pop');

    dispatchCode(JAN_A, 'camera');
    dispatchCode(JAN_B, 'camera');

    expect(scans.value[0]?.pop).toEqual([{ size: '5号', qty: 2, lami: true, enlarge: '', assignee: '' }]);
    expect(scans.value[1]?.pop).toHaveLength(1);
    expect(popDraft.value).toHaveLength(1);
  });
});

describe('intent: order', () => {
  it('当日ラベルのリストが作られ、同一JANの再スキャンで +1 される', () => {
    setScanIntent('order');

    dispatchCode(JAN_A, 'camera');
    dispatchCode(JAN_B, 'camera');
    dispatchCode(JAN_A, 'camera');

    const list = orderLists.value[0]!;
    expect(list.label).toBe(todayLocal());
    expect(list.lines).toEqual([
      { jan: JAN_A, qty: 2 },
      { jan: JAN_B, qty: 1 },
    ]);
    // 発注モードは履歴に積まない
    expect(scans.value).toHaveLength(0);
  });
});

describe('intent: compCheck', () => {
  it('競合登録との照合結果を出し、履歴へは押したときだけ積む', () => {
    addCompetitor({
      ...stamp(),
      date: todayLocal(),
      jan: JAN_A,
      name: '対抗商品',
      reason: 'ヘッダー変更',
      memo: '',
      dismissed: false,
    });
    setScanIntent('compCheck');

    dispatchCode(JAN_A, 'camera');

    expect(compPending.value).toMatchObject({ jan: JAN_A, name: '対抗商品', matched: true });
    expect(scans.value).toHaveLength(0);

    const added = addCompCheckToHistory(compPending.value!);
    expect(added?.genre).toBe('競合ヘッダー');
    expect(scans.value[0]?.jan).toBe(JAN_A);
    expect(compPending.value).toBeNull();
    expect(competitors.value).toHaveLength(1);
  });

  it('競合登録に無いJANは matched:false で出る', () => {
    setScanIntent('compCheck');
    dispatchCode(JAN_B, 'camera');
    expect(compPending.value).toMatchObject({ jan: JAN_B, matched: false });
  });
});

// ---------------------------------------------------------------- field（スキャンで入力）

describe('intent: field（one-shot のスキャンで入力）', () => {
  beforeEach(() => {
    wireFieldSheet();
  });

  it('箱JAN: ITF変換あり・箱JAN置換なしで値が返り、履歴には積まれない', () => {
    learnProduct(JAN_A, { name: 'バラ商品', boxJan: ITF14_AS_JAN });
    requestFieldScan({ kind: 'boxJan:item1', label: '箱JAN', id: 'item1', applyBoxJanLookup: false });
    expect(scanIntent.value).toBe('field');

    dispatchCode(ITF14, 'camera');

    expect(fieldScanValue.value).toMatchObject({ kind: 'boxJan:item1', jan: ITF14_AS_JAN });
    expect(scans.value).toHaveLength(0);
    expect(fieldScanRequest.value).toBeNull();
    expect(scanIntent.value).toBe('capture'); // one-shot で復帰
  });

  it('返品・客注: 生コードのまま返る（ITF変換なし・箱JAN置換なし）', () => {
    learnProduct(JAN_A, { name: 'バラ商品', boxJan: ITF14_AS_JAN });

    requestFieldScan({
      kind: 'returnJan',
      label: '返品のJAN',
      convertItf: false,
      applyBoxJanLookup: false,
    });
    dispatchCode(ITF14, 'camera');
    expect(fieldScanValue.value).toMatchObject({ kind: 'returnJan', jan: ITF14 });

    requestFieldScan({
      kind: 'custJan:new',
      label: '客注のJAN',
      convertItf: false,
      applyBoxJanLookup: false,
    });
    dispatchCode(ITF14, 'manual');
    expect(fieldScanValue.value).toMatchObject({ kind: 'custJan:new', jan: ITF14 });
  });

  it('競合: ITF変換と箱JAN置換がどちらも効く', () => {
    learnProduct(JAN_A, { name: 'バラ商品', boxJan: ITF14_AS_JAN });

    requestFieldScan({ kind: 'compJan', label: '競合商品のJAN' });
    dispatchCode(ITF14, 'camera');

    expect(fieldScanValue.value).toMatchObject({ kind: 'compJan', jan: JAN_A });
  });

  it('割り込み後は元の intent に戻る（競合確認モード中でも）', () => {
    setScanIntent('compCheck');
    requestFieldScan({ kind: 'compJan', label: '競合商品のJAN' });

    dispatchCode(JAN_B, 'camera');

    expect(scanIntent.value).toBe('compCheck');
  });

  it('キャンセルすると読まずに復帰する', () => {
    setScanIntent('order');
    requestFieldScan({ kind: 'compJan', label: '競合商品のJAN' });

    abortFieldScan();

    expect(scanIntent.value).toBe('order');
    expect(fieldScanRequest.value).toBeNull();
    expect(fieldScanValue.value).toBeNull();
  });

  it('期限モードの保留は field 割り込みでは確定されない', () => {
    learnExpiryOffset(JAN_A, 4);
    setScanIntent('expiry');
    dispatchCode(JAN_A, 'camera');

    requestFieldScan({ kind: 'compJan', label: '競合商品のJAN' });
    dispatchCode(JAN_B, 'camera');

    expect(scanIntent.value).toBe('expiry');
    expect(pendingExpiry.value).toMatchObject({ jan: JAN_A });
    expect(scans.value.find((s) => s.jan === JAN_A)?.expiry).toBe('');
  });
});

// ---------------------------------------------------------------- ヘルパ

/** ウェッジ（Bluetoothリーダー）の打鍵を再現する。Enter で確定 */
function typeWedge(code: string, target: EventTarget = document.body): void {
  for (const ch of code) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
  }
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}
