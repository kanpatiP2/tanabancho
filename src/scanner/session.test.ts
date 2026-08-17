import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@core/types';
import {
  createScanSession,
  type ExpiryPending,
  type ScanSession,
  type ScanSessionHandlers,
} from './session';

const JAN_A = '4901777018686';
const JAN_B = '4902102072618';
const ITF_A = '14901777018683'; // → JAN_A
const BOX_JAN = '4900000000005';

function product(jan: string, name: string): Product {
  return {
    jan,
    name,
    nameSource: 'manual',
    boxJan: '',
    expiryOffsets: [],
    lastUsedAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
  };
}

function makeHandlers() {
  return {
    isDuplicate: vi.fn<NonNullable<ScanSessionHandlers['isDuplicate']>>(() => false),
    lookupProduct: vi.fn<NonNullable<ScanSessionHandlers['lookupProduct']>>(() => null),
    boxJanLookup: vi.fn<NonNullable<ScanSessionHandlers['boxJanLookup']>>(() => null),
    onCapture: vi.fn(),
    onExpiry: vi.fn(),
    onPop: vi.fn(),
    onOrder: vi.fn(),
    onCompCheck: vi.fn(),
    onField: vi.fn(),
    onExpiryCommit: vi.fn(),
    onDuplicate: vi.fn(),
    onReject: vi.fn(),
    onIntentChange: vi.fn(),
  };
}

describe('createScanSession — 初期状態', () => {
  it('既定は capture / 非連続 / sticky', () => {
    const s = createScanSession();
    expect(s.state).toEqual({
      intent: 'capture',
      continuous: false,
      fieldTarget: null,
      sticky: true,
      last: null,
    });
    expect(s.pendingExpiry).toBeNull();
  });
});

describe('input — 正規化と合流', () => {
  let h: ReturnType<typeof makeHandlers>;
  let s: ScanSession;

  beforeEach(() => {
    h = makeHandlers();
    s = createScanSession(h);
  });

  it('capture で onCapture を呼び、resolveCode の結果を渡す', () => {
    const r = s.input(JAN_A, 'camera');
    expect(r.ok).toBe(true);
    expect(h.onCapture).toHaveBeenCalledTimes(1);
    const ev = h.onCapture.mock.calls[0]![0];
    expect(ev.jan).toBe(JAN_A);
    expect(ev.raw).toBe(JAN_A);
    expect(ev.source).toBe('camera');
    expect(ev.intent).toBe('capture');
    expect(ev.resolved.fromItf).toBe(false);
  });

  it('ITF-14 は JAN13 に変換されて渡る', () => {
    s.input(ITF_A, 'camera');
    const ev = h.onCapture.mock.calls[0]![0];
    expect(ev.jan).toBe(JAN_A);
    expect(ev.resolved.fromItf).toBe(true);
    expect(ev.raw).toBe(ITF_A);
  });

  it('箱JAN は学習辞書でバラJAN に置換される', () => {
    h.boxJanLookup.mockImplementation((c) => (c === BOX_JAN ? JAN_B : null));
    s.input(BOX_JAN, 'wedge');
    const ev = h.onCapture.mock.calls[0]![0];
    expect(ev.jan).toBe(JAN_B);
    expect(ev.resolved.fromBoxJan).toBe(true);
  });

  it('辞書照合の結果を product として渡す', () => {
    h.lookupProduct.mockImplementation((j) => (j === JAN_A ? product(JAN_A, 'テスト商品') : null));
    s.input(JAN_A, 'manual');
    expect(h.onCapture.mock.calls[0]![0].product?.name).toBe('テスト商品');
    s.input(JAN_B, 'manual');
    expect(h.onCapture.mock.calls[1]![0].product).toBeNull();
  });

  it('leadingZero を surface する（UI が確認シートを出す）', () => {
    s.input('0490177701868', 'camera');
    expect(h.onCapture.mock.calls[0]![0].resolved.leadingZero).toBe(true);
  });

  it('last に直前の入力を残す', () => {
    s.input(ITF_A, 'wedge');
    expect(s.state.last).toMatchObject({ jan: JAN_A, raw: ITF_A, source: 'wedge', intent: 'capture' });
    expect(typeof s.state.last?.at).toBe('string');
  });

  it('空コードは reject', () => {
    const r = s.input('   ', 'manual');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('empty');
    expect(h.onReject).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'empty', intent: 'capture' }),
    );
    expect(h.onCapture).not.toHaveBeenCalled();
  });

  it('URL の QR は reject（v1 の http/www ガード相当）', () => {
    expect(s.input('https://example.com', 'camera').reason).toBe('url');
    expect(s.input('www.example.com', 'camera').reason).toBe('url');
    expect(h.onCapture).not.toHaveBeenCalled();
  });
});

describe('重複判定', () => {
  let h: ReturnType<typeof makeHandlers>;
  let s: ScanSession;

  beforeEach(() => {
    h = makeHandlers();
    s = createScanSession(h);
  });

  it('capture で重複なら onDuplicate だけ呼び onCapture は呼ばない', () => {
    h.isDuplicate.mockReturnValue(true);
    const r = s.input(JAN_A, 'camera');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('duplicate');
    expect(h.onDuplicate).toHaveBeenCalledTimes(1);
    expect(h.onCapture).not.toHaveBeenCalled();
  });

  it('重複判定は正規化後の JAN で行う', () => {
    h.isDuplicate.mockImplementation((jan) => jan === JAN_A);
    expect(s.input(ITF_A, 'camera').reason).toBe('duplicate');
    expect(h.isDuplicate).toHaveBeenCalledWith(JAN_A, expect.objectContaining({ jan: JAN_A }));
  });

  it('重複でも intent / field は消費しない', () => {
    h.isDuplicate.mockReturnValue(true);
    s.beginFieldScan({ kind: 'boxJan', id: 'x' });
    // field は既定で重複ガード対象外なので通る
    expect(s.input(JAN_A, 'camera').ok).toBe(true);
    expect(s.state.intent).toBe('capture');

    s.setIntent('capture');
    expect(s.input(JAN_A, 'camera').ok).toBe(false);
    expect(s.state.intent).toBe('capture');
  });

  it('既定では field / compCheck は重複ガードの対象外', () => {
    h.isDuplicate.mockReturnValue(true);
    s.setIntent('compCheck');
    expect(s.input(JAN_A, 'camera').ok).toBe(true);
    expect(h.onCompCheck).toHaveBeenCalledTimes(1);
  });

  it('duplicateGuardIntents で対象 intent を広げられる', () => {
    const h2 = makeHandlers();
    const s2 = createScanSession(h2, { duplicateGuardIntents: ['capture', 'compCheck'] });
    h2.isDuplicate.mockReturnValue(true);
    s2.setIntent('compCheck');
    expect(s2.input(JAN_A, 'camera').ok).toBe(false);
    expect(h2.onCompCheck).not.toHaveBeenCalled();
  });
});

describe('setIntent / continuous', () => {
  let h: ReturnType<typeof makeHandlers>;
  let s: ScanSession;

  beforeEach(() => {
    h = makeHandlers();
    s = createScanSession(h);
  });

  it('各 intent が対応するハンドラへ振り分けられる', () => {
    s.setIntent('pop');
    s.input(JAN_A, 'camera');
    s.setIntent('order');
    s.input(JAN_A, 'camera');
    s.setIntent('compCheck');
    s.input(JAN_A, 'camera');
    s.setIntent('capture');
    s.input(JAN_A, 'camera');

    expect(h.onPop).toHaveBeenCalledTimes(1);
    expect(h.onOrder).toHaveBeenCalledTimes(1);
    expect(h.onCompCheck).toHaveBeenCalledTimes(1);
    expect(h.onCapture).toHaveBeenCalledTimes(1);
  });

  it('sticky な intent はスキャン後も維持される', () => {
    s.setIntent('compCheck');
    s.input(JAN_A, 'camera');
    s.input(JAN_B, 'camera');
    expect(s.state.intent).toBe('compCheck');
    expect(h.onCompCheck).toHaveBeenCalledTimes(2);
  });

  it('sticky:false の intent は1件で前の intent に戻る', () => {
    s.setIntent('compCheck');
    s.setIntent('pop', { sticky: false });
    expect(s.state.intent).toBe('pop');
    s.input(JAN_A, 'camera');
    expect(s.state.intent).toBe('compCheck');
    expect(h.onPop).toHaveBeenCalledTimes(1);
  });

  it('onIntentChange が遷移を通知する', () => {
    s.setIntent('expiry');
    expect(h.onIntentChange).toHaveBeenCalledWith('expiry', 'capture');
    s.setIntent('expiry'); // 同じ intent は通知しない
    expect(h.onIntentChange).toHaveBeenCalledTimes(1);
  });

  it("setIntent('field') は禁止（beginFieldScan を使う）", () => {
    expect(() => s.setIntent('field')).toThrow(/beginFieldScan/);
  });

  it('continuous はイベントと結果に反映される', () => {
    expect(s.input(JAN_A, 'camera').continuous).toBe(false);
    s.setContinuous(true);
    const r = s.input(JAN_B, 'camera');
    expect(r.continuous).toBe(true);
    expect(h.onCapture.mock.calls[1]![0].continuous).toBe(true);
    expect(s.state.continuous).toBe(true);
  });

  it('field は continuous 設定に関わらず 1件で止める', () => {
    s.setContinuous(true);
    s.beginFieldScan({ kind: 'compJan' });
    const r = s.input(JAN_A, 'camera');
    expect(r.continuous).toBe(false);
    expect(h.onField.mock.calls[0]![0].continuous).toBe(false);
  });

  it('reset で初期状態に戻る', () => {
    s.setIntent('compCheck');
    s.setContinuous(true);
    s.input(JAN_A, 'camera');
    s.reset();
    expect(s.state).toEqual({
      intent: 'capture',
      continuous: false,
      fieldTarget: null,
      sticky: true,
      last: null,
    });
    expect(h.onIntentChange).toHaveBeenCalledTimes(1); // reset ではハンドラを呼ばない
  });
});

describe('beginFieldScan — one-shot', () => {
  let h: ReturnType<typeof makeHandlers>;
  let s: ScanSession;

  beforeEach(() => {
    h = makeHandlers();
    s = createScanSession(h);
  });

  it('field 中は intent が field / fieldTarget が入る', () => {
    s.beginFieldScan({ kind: 'boxJan', id: 'scan-1' });
    expect(s.state.intent).toBe('field');
    expect(s.state.fieldTarget).toEqual({ kind: 'boxJan', id: 'scan-1' });
    expect(s.state.sticky).toBe(false);
  });

  it('1件読むと直前の intent に復帰する', () => {
    s.setIntent('compCheck');
    s.beginFieldScan({ kind: 'compJan' });
    s.input(JAN_A, 'camera');
    expect(h.onField).toHaveBeenCalledTimes(1);
    expect(h.onField.mock.calls[0]![0].returnTo).toBe('compCheck');
    expect(s.state.intent).toBe('compCheck');
    expect(s.state.fieldTarget).toBeNull();

    // 2件目は compCheck として処理される
    s.input(JAN_B, 'camera');
    expect(h.onCompCheck).toHaveBeenCalledTimes(1);
    expect(h.onField).toHaveBeenCalledTimes(1);
  });

  it('field 中にさらに field を始めても復帰先は最初の intent', () => {
    s.setIntent('order');
    s.beginFieldScan({ kind: 'custJan' });
    s.beginFieldScan({ kind: 'returnJan' });
    expect(s.state.fieldTarget?.kind).toBe('returnJan');
    s.input(JAN_A, 'camera');
    expect(s.state.intent).toBe('order');
  });

  it('cancelFieldScan で読まずに復帰できる', () => {
    s.setIntent('pop');
    s.beginFieldScan({ kind: 'boxJan', id: 'a' });
    s.cancelFieldScan();
    expect(s.state.intent).toBe('pop');
    expect(s.state.fieldTarget).toBeNull();
    expect(h.onField).not.toHaveBeenCalled();
  });

  it('applyBoxJanLookup:false で箱JAN 置換を止める（箱JAN 登録時）', () => {
    h.boxJanLookup.mockImplementation(() => JAN_B);
    s.beginFieldScan({ kind: 'boxJan', id: 'a', applyBoxJanLookup: false });
    s.input(BOX_JAN, 'camera');
    const ev = h.onField.mock.calls[0]![0];
    expect(ev.jan).toBe(BOX_JAN);
    expect(ev.resolved.fromBoxJan).toBe(false);
    expect(h.boxJanLookup).not.toHaveBeenCalled();
  });

  it('convertItf:false で ITF 変換を止める（返品/客注の JAN 欄は生コード）', () => {
    s.beginFieldScan({ kind: 'returnJan', convertItf: false, applyBoxJanLookup: false });
    s.input(ITF_A, 'camera');
    expect(h.onField.mock.calls[0]![0].jan).toBe(ITF_A);
  });

  it('既定では field でも ITF 変換 + 箱JAN 置換が効く（v1 の activeCompScan 相当）', () => {
    h.boxJanLookup.mockImplementation((c) => (c === JAN_A ? JAN_B : null));
    s.beginFieldScan({ kind: 'compJan' });
    s.input(ITF_A, 'camera');
    const ev = h.onField.mock.calls[0]![0];
    expect(ev.jan).toBe(JAN_B);
    expect(ev.resolved.fromItf).toBe(true);
    expect(ev.resolved.fromBoxJan).toBe(true);
  });
});

describe('期限モード — 次スキャンで前回提案を自動確定', () => {
  let h: ReturnType<typeof makeHandlers>;
  let s: ScanSession;

  const pendingFor = (jan: string, expiry: string): ExpiryPending => ({ id: `i-${jan}`, jan, expiry });

  beforeEach(() => {
    h = makeHandlers();
    s = createScanSession(h);
    s.setIntent('expiry');
  });

  it('onExpiry が pending を返すと保留になる', () => {
    h.onExpiry.mockReturnValue({ pending: pendingFor(JAN_A, '2026-09-01') });
    s.input(JAN_A, 'camera');
    expect(s.pendingExpiry).toEqual({ id: `i-${JAN_A}`, jan: JAN_A, expiry: '2026-09-01' });
    expect(h.onExpiryCommit).not.toHaveBeenCalled();
  });

  it('次のスキャンで前回の提案が自動確定される', () => {
    h.onExpiry
      .mockReturnValueOnce({ pending: pendingFor(JAN_A, '2026-09-01') })
      .mockReturnValueOnce({ pending: pendingFor(JAN_B, '2026-09-15') });

    s.input(JAN_A, 'camera');
    s.input(JAN_B, 'camera');

    expect(h.onExpiryCommit).toHaveBeenCalledTimes(1);
    expect(h.onExpiryCommit).toHaveBeenCalledWith(
      { id: `i-${JAN_A}`, jan: JAN_A, expiry: '2026-09-01' },
      'next-scan',
    );
    expect(s.pendingExpiry?.jan).toBe(JAN_B);

    // 自動確定は onExpiry の呼び出しより前に起きる
    expect(h.onExpiryCommit.mock.invocationCallOrder[0]!).toBeLessThan(
      h.onExpiry.mock.invocationCallOrder[1]!,
    );
    // 3件連続でも 1件ずつ確定される
    h.onExpiry.mockReturnValueOnce({ pending: null });
    s.input(JAN_A, 'camera');
    expect(h.onExpiryCommit).toHaveBeenCalledTimes(2);
    expect(s.pendingExpiry).toBeNull();
  });

  it('onExpiry が何も返さなければ保留しない', () => {
    h.onExpiry.mockReturnValue(undefined);
    s.input(JAN_A, 'camera');
    s.input(JAN_B, 'camera');
    expect(s.pendingExpiry).toBeNull();
    expect(h.onExpiryCommit).not.toHaveBeenCalled();
  });

  it('期限モードを抜けるときに保留を確定する', () => {
    h.onExpiry.mockReturnValue({ pending: pendingFor(JAN_A, '2026-09-01') });
    s.input(JAN_A, 'camera');
    s.setIntent('capture');
    expect(h.onExpiryCommit).toHaveBeenCalledWith(expect.objectContaining({ jan: JAN_A }), 'intent-change');
    expect(s.pendingExpiry).toBeNull();
  });

  it('flushPendingExpiry で即確定できる', () => {
    h.onExpiry.mockReturnValue({ pending: pendingFor(JAN_A, '2026-09-01') });
    s.input(JAN_A, 'camera');
    s.flushPendingExpiry();
    expect(h.onExpiryCommit).toHaveBeenCalledWith(expect.objectContaining({ jan: JAN_A }), 'flush');
    s.flushPendingExpiry(); // 二重確定しない
    expect(h.onExpiryCommit).toHaveBeenCalledTimes(1);
  });

  it('cancelPendingExpiry は確定せず破棄する', () => {
    h.onExpiry.mockReturnValue({ pending: pendingFor(JAN_A, '2026-09-01') });
    s.input(JAN_A, 'camera');
    s.cancelPendingExpiry();
    expect(s.pendingExpiry).toBeNull();
    s.input(JAN_B, 'camera');
    expect(h.onExpiryCommit).not.toHaveBeenCalled();
  });

  it('期限モード中の field 割り込みは保留を確定しない（復帰後も生きている）', () => {
    h.onExpiry.mockReturnValue({ pending: pendingFor(JAN_A, '2026-09-01') });
    s.input(JAN_A, 'camera');
    s.beginFieldScan({ kind: 'boxJan', id: 'x' });
    expect(h.onExpiryCommit).not.toHaveBeenCalled();
    s.input(JAN_B, 'camera');
    expect(s.state.intent).toBe('expiry');
    expect(s.pendingExpiry?.jan).toBe(JAN_A);
  });
});

describe('v1 の5フラグの再現', () => {
  let h: ReturnType<typeof makeHandlers>;
  let s: ScanSession;

  beforeEach(() => {
    h = makeHandlers();
    s = createScanSession(h);
  });

  it('① 通常（フラグなし）= intent capture', () => {
    s.input(JAN_A, 'camera');
    expect(h.onCapture).toHaveBeenCalledTimes(1);
    expect(s.state.intent).toBe('capture');
  });

  it('② activeSideScanType = field(returnJan / custJan)：変換なしで欄に入れて復帰', () => {
    for (const kind of ['returnJan', 'custJan']) {
      s.beginFieldScan({ kind, convertItf: false, applyBoxJanLookup: false });
      s.input(ITF_A, 'camera');
      expect(h.onField).toHaveBeenLastCalledWith(
        expect.objectContaining({ target: expect.objectContaining({ kind }), jan: ITF_A }),
      );
      expect(s.state.intent).toBe('capture');
    }
    expect(h.onField).toHaveBeenCalledTimes(2);
  });

  it('③ activeCompScan = field(compJan)：ITF変換 + 箱JAN置換ありで欄に入れて復帰', () => {
    h.boxJanLookup.mockImplementation((c) => (c === BOX_JAN ? JAN_B : null));
    s.beginFieldScan({ kind: 'compJan' });
    s.input(BOX_JAN, 'camera');
    expect(h.onField.mock.calls[0]![0].jan).toBe(JAN_B);
    expect(s.state.intent).toBe('capture');
  });

  it('④ activeBoxJanScanId = field(boxJan, id)：ITF変換のみ、箱JAN置換なし', () => {
    h.boxJanLookup.mockImplementation(() => JAN_B);
    s.beginFieldScan({ kind: 'boxJan', id: 'scan-42', applyBoxJanLookup: false });
    s.input(ITF_A, 'camera');
    const ev = h.onField.mock.calls[0]![0];
    expect(ev.target).toEqual({ kind: 'boxJan', id: 'scan-42', applyBoxJanLookup: false });
    expect(ev.jan).toBe(JAN_A); // ITF は変換、バラJAN 置換はしない
    expect(s.state.intent).toBe('capture');
  });

  it('⑤ isCompCheckMode = intent compCheck：解除するまで継続', () => {
    s.setIntent('compCheck');
    s.input(JAN_A, 'camera');
    s.input(JAN_B, 'camera');
    expect(h.onCompCheck).toHaveBeenCalledTimes(2);
    expect(h.onCapture).not.toHaveBeenCalled();
    s.setIntent('capture'); // exitCompCheckMode 相当
    s.input(JAN_A, 'camera');
    expect(h.onCapture).toHaveBeenCalledTimes(1);
  });

  it('compCheck 中に箱JAN 登録を割り込ませても compCheck に戻る（v1 の優先順位）', () => {
    s.setIntent('compCheck');
    s.beginFieldScan({ kind: 'boxJan', id: 'scan-9', applyBoxJanLookup: false });
    s.input(JAN_A, 'camera');
    expect(h.onField).toHaveBeenCalledTimes(1);
    expect(h.onCompCheck).not.toHaveBeenCalled();
    expect(s.state.intent).toBe('compCheck');
    s.input(JAN_B, 'camera');
    expect(h.onCompCheck).toHaveBeenCalledTimes(1);
  });
});
