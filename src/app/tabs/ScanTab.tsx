/**
 * スキャンタブ（ホーム）。
 * モードチップ [通常][期限][POP][発注][競合確認] + カメラ + 結果フラッシュ + モード別パネル。
 */
import { useEffect, useState } from 'preact/hooks';
import type { CodeSource, ResolvedCode, ScanIntent } from '@core/types';
import { todayLocal } from '@core/datetime';
import { isFullyExported, toJanLines } from '@order-export/payload';
import { Badge, Card, Check, Empty, Field, JanText } from '../components/primitives';
import { toast, toastUndo } from '../components/Toast';
import { ExpiryPad } from '../scan/ExpiryPad';
import { PopPanel } from '../scan/PopPanel';
import { SearchSheet } from '../scan/SearchSheet';
import { OrderListScreen } from '../scan/OrderListScreen';
import {
  VIDEO_CONTAINER_ID,
  attachWedge,
  cameraError,
  cameraState,
  cancelPendingExpiry,
  dispatchCode,
  feedback,
  flushPendingExpiry,
  pendingExpiry,
  probeCamera,
  restartCamera,
  scanIntent,
  setCodeHandler,
  setDuplicateHandler,
  setExpiryCommitHandler,
  setScanIntent,
  stopCamera,
  toggleCamera,
} from '../scan-bridge';
import {
  addCompCheckToHistory,
  applyExpiry,
  captureDraft,
  compPending,
  ensureOrderList,
  flash,
  patchCapture,
  suggestExpiryFor,
  toggleCaptureOrder,
} from '../scan/draft';
import {
  handleDuplicate,
  handleExpiryCommit,
  handleScannedCode,
  type ScanUiHooks,
} from '../scan/handlers';
import {
  competitors,
  deleteScan,
  orderLists,
  profile,
  restoreScan,
  settings,
  updateSettings,
} from '../store';

const MODES: { value: ScanIntent; label: string }[] = [
  { value: 'capture', label: '通常' },
  { value: 'expiry', label: '期限' },
  { value: 'pop', label: 'POP' },
  { value: 'order', label: '発注' },
  { value: 'compCheck', label: '競合確認' },
];

export function ScanTab() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [padTarget, setPadTarget] = useState<{ scanId: string; jan: string; name: string } | null>(null);
  /** 期限モード: 次スキャンで提案値を自動確定する */
  const [autoExpiry, setAutoExpiry] = useState(true);

  const mode = scanIntent.value;

  // ---- intent 別の処理は scan/handlers.ts。ここは UI 副作用（トースト・パッド・触覚）だけ渡す
  const ui: ScanUiHooks = {
    intent: () => scanIntent.value,
    autoExpiry: () => autoExpiry,
    feedback,
    openExpiryPad: setPadTarget,
    notify: (n) =>
      toast(n.message, {
        tone: n.tone,
        ...(n.revise
          ? {
              action: {
                label: '今すぐ変更',
                onAct: () => {
                  cancelPendingExpiry(); // 自動確定を止めて手入力に切り替える
                  setPadTarget(n.revise!);
                },
              },
            }
          : {}),
      }),
  };

  // ---- コード受け口（scan-bridge 経由で camera/wedge/手入力が集約される）
  useEffect(() => {
    setCodeHandler((resolved: ResolvedCode, _source: CodeSource) => handleScannedCode(resolved, ui));
    setDuplicateHandler((resolved) => handleDuplicate(resolved, ui));
    return () => {
      setCodeHandler(null);
      setDuplicateHandler(null);
    };
  }, [autoExpiry]);

  // ---- 期限モードの「次スキャンで自動確定」。モード離脱・画面離脱でも取りこぼさない
  useEffect(() => {
    setExpiryCommitHandler((p) => handleExpiryCommit(p, ui));
    return () => {
      flushPendingExpiry(); // ハンドラを外す前に確定させる
      setExpiryCommitHandler(null);
    };
  }, []);

  // ---- ウェッジ（settings.inputSource === 'wedge' のとき有効）。カメラとは排他
  useEffect(() => {
    if (settings.value.inputSource !== 'wedge') return;
    void stopCamera();
    return attachWedge();
  }, [settings.value.inputSource]);

  // ---- 起動時にカメラの可用性だけ確認し、離脱時は止める
  useEffect(() => {
    void probeCamera();
    return () => void stopCamera();
  }, []);

  // ---- カメラ設定（プリセット / fps / フォーカス / 縦長）の変更を稼働中のカメラへ反映
  useEffect(() => {
    void restartCamera();
  }, [
    settings.value.cameraPreset,
    settings.value.cameraFps,
    settings.value.cameraFocusMode,
    settings.value.tallBarcodeMode,
  ]);

  const activeOrder = orderLists.value.find((o) => o.id === ensureOrderListIdSafe());

  return (
    <>
      <div class="topbar">
        <span class="topbar__title">
          スキャン <span class="topbar__sub">{profile.value.label}</span>
        </span>
        <button
          type="button"
          class="btn btn--icon btn--sm"
          aria-label="手入力・辞書検索"
          onClick={() => setSearchOpen(true)}
        >
          🔍
        </button>
      </div>

      <ModeChips />
      <CameraBox />
      <FlashCard />

      {mode === 'capture' ? <CapturePanel /> : null}
      {mode === 'expiry' ? (
        <Card title="期限モード">
          <p class="muted">
            スキャンすると期限パッドが開きます。学習済みの提案値があるときは自動確定できます。
          </p>
          <Check
            label="次スキャンで提案値を自動確定する"
            checked={autoExpiry}
            onChange={setAutoExpiry}
          />
          {pendingExpiry.value ? (
            <div class="row" style={{ marginTop: '8px' }}>
              <span class="grow muted">
                確定待ち: <JanText jan={pendingExpiry.value.jan} /> → {pendingExpiry.value.expiry}
              </span>
              <button type="button" class="btn btn--sm" onClick={flushPendingExpiry}>
                今すぐ確定
              </button>
              <button type="button" class="btn btn--sm btn--ghost" onClick={cancelPendingExpiry}>
                取消
              </button>
            </div>
          ) : null}
        </Card>
      ) : null}
      {mode === 'pop' ? (
        <Card title="POPモード">
          <PopPanel />
        </Card>
      ) : null}
      {mode === 'order' ? (
        <Card title="発注モード">
          <p>
            現在のリスト: <strong>{activeOrder?.label ?? '未作成'}</strong> /{' '}
            <strong>{activeOrder?.lines.length ?? 0}件</strong>{' '}
            {isFullyExported(
              activeOrder?.exportedBatches,
              toJanLines(activeOrder).length,
              settings.value.qrBatchSize,
            ) ? (
              <Badge tone="teal">出力済</Badge>
            ) : null}
          </p>
          <button
            type="button"
            class="btn btn--primary btn--block"
            onClick={() => {
              ensureOrderList();
              setOrderOpen(true);
            }}
          >
            リストを見る
          </button>
        </Card>
      ) : null}
      {mode === 'compCheck' ? <CompCheckPanel /> : null}

      <SearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPick={(code) => {
          setSearchOpen(false);
          // 重複は setDuplicateHandler が通知するので、ここでは解釈できない入力だけ拾う
          if (!dispatchCode(code, 'manual')) {
            toast('コードとして解釈できません', { tone: 'warn' });
          }
        }}
      />

      <ExpiryPad
        open={Boolean(padTarget)}
        subject={padTarget ? padTarget.name || padTarget.jan : ''}
        suggestion={padTarget ? suggestExpiryFor(padTarget.jan) : null}
        onClose={() => setPadTarget(null)}
        onCommit={(expiry) => {
          if (padTarget) {
            applyExpiry(padTarget.scanId, expiry);
            toast(expiry ? `期限 ${expiry} を設定しました` : '期限なしで登録しました', { tone: 'ok' });
          }
          setPadTarget(null);
        }}
      />

      <OrderListScreen
        listId={ensureOrderListIdSafe()}
        open={orderOpen}
        onClose={() => setOrderOpen(false)}
      />
    </>
  );
}

/** 描画中に発注リストを新規作成しないための読み取り専用ヘルパ */
function ensureOrderListIdSafe(): string {
  const label = todayLocal();
  return orderLists.value.find((o) => o.label === label)?.id ?? orderLists.value[0]?.id ?? '';
}

function ModeChips() {
  return (
    <div class="chiprow" style={{ margin: '8px 0' }}>
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          class="chip"
          aria-pressed={scanIntent.value === m.value}
          onClick={() => {
            setScanIntent(m.value);
            compPending.value = null;
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function CameraBox() {
  const state = cameraState.value;
  const tall = settings.value.tallBarcodeMode;
  const wedge = settings.value.inputSource === 'wedge';

  return (
    <div
      class={tall ? 'camerabox camerabox--tall' : 'camerabox'}
      onClick={() => {
        if (state === 'unavailable') return;
        void toggleCamera();
      }}
    >
      {/* スキャナが video / canvas を差し込む器。Preact は中身に触らない */}
      <div class="camerabox__view" id={VIDEO_CONTAINER_ID} />
      {state === 'running' ? null : (
        <div class="camerabox__hint">
          {state === 'unavailable' ? (
            <>
              <p>カメラを開始できませんでした</p>
              <p class="muted">{cameraError.value}</p>
              <p class="muted">🔍 から手入力できます</p>
            </>
          ) : state === 'starting' ? (
            <p>起動中…</p>
          ) : wedge ? (
            <>
              <p>ウェッジ入力モード</p>
              <p class="muted">リーダーで読み取ると登録されます（タップでカメラも使えます）</p>
            </>
          ) : (
            <p>タップでカメラ開始 / 停止</p>
          )}
        </div>
      )}
      <div class="camerabox__tools" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          class="btn btn--sm btn--icon"
          aria-pressed={tall}
          title="縦長バーコードモード"
          onClick={() => updateSettings({ tallBarcodeMode: !tall })}
        >
          📐
        </button>
        <button
          type="button"
          class="btn btn--sm btn--icon"
          aria-pressed={wedge}
          title="ウェッジ入力切替"
          onClick={() => updateSettings({ inputSource: wedge ? 'camera' : 'wedge' })}
        >
          ⌨
        </button>
      </div>
    </div>
  );
}

function FlashCard() {
  const f = flash.value;
  if (!f) return null;
  return (
    <div class={f.known ? 'flashcard flashcard--hit' : 'flashcard flashcard--unknown'}>
      <div class="flashcard__name">{f.known ? f.name : '名称未登録'}</div>
      <div class="flashcard__code">
        <JanText jan={f.jan} />
        {f.fromItf ? ' / ITF変換' : ''}
        {f.fromBoxJan ? ' / 箱JAN変換' : ''}
      </div>
      <div class="row" style={{ marginTop: '6px' }}>
        <button
          type="button"
          class="btn btn--sm"
          onClick={() => {
            const removed = deleteScan(f.scanId);
            flash.value = null;
            if (removed) {
              toastUndo('登録を取り消しました', () => restoreScan(removed.item, removed.index));
            }
          }}
        >
          取り消し
        </button>
        <button type="button" class="btn btn--sm btn--ghost" onClick={() => (flash.value = null)}>
          閉じる
        </button>
      </div>
    </div>
  );
}

function CapturePanel() {
  const d = captureDraft.value;
  const vocab = profile.value.vocab;
  return (
    <Card title="通常モード">
      <div class="stack">
        <Field label="商品名（スキャン前に入力すると学習されます）">
          <input
            class="input"
            value={d.name}
            onInput={(e) => patchCapture({ name: (e.currentTarget as HTMLInputElement).value })}
          />
        </Field>

        <div class="row">
          <Check label="エンド" checked={d.end} onChange={(end) => patchCapture({ end })} />
          <Check label="📌 維持" checked={d.keep} onChange={(keep) => patchCapture({ keep })} />
        </div>

        <div>
          <div class="field__label">発注</div>
          <div class="row row--tight">
            {vocab.orderTypes.map((t) => (
              <Check
                key={t}
                label={t}
                checked={d.order.includes(t)}
                onChange={() => toggleCaptureOrder(t)}
              />
            ))}
          </div>
        </div>

        <div>
          <div class="field__label">品切カテゴリ（ジャンルにセット）</div>
          <div class="chiprow">
            {vocab.shortageCategories.map((c) => (
              <button
                key={c}
                type="button"
                class="chip chip--sm"
                aria-pressed={d.genre === c}
                onClick={() => patchCapture({ genre: d.genre === c ? '' : c })}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div class="row">
          <Field label="ジャンル" style={{ flex: '1' }}>
            <input
              class="input"
              value={d.genre}
              onInput={(e) => patchCapture({ genre: (e.currentTarget as HTMLInputElement).value })}
            />
          </Field>
          <Field label="コメント" style={{ flex: '1' }}>
            <input
              class="input"
              value={d.memo}
              onInput={(e) => patchCapture({ memo: (e.currentTarget as HTMLInputElement).value })}
            />
          </Field>
        </div>
      </div>
    </Card>
  );
}

function CompCheckPanel() {
  const pending = compPending.value;
  const todayComp = competitors.value.filter((c) => c.date === todayLocal());
  return (
    <Card title="競合対抗確認">
      <div class="summary-line" style={{ marginBottom: '8px' }}>
        本日の競合予定 {todayComp.length}件 / 登録済み {competitors.value.length}件
      </div>
      {!pending ? (
        <Empty>商品をスキャンしてください…</Empty>
      ) : (
        <div class="stack">
          <div>
            <div class="histrow__code">
              <JanText jan={pending.jan} />
            </div>
            <div class="flashcard__name">{pending.name}</div>
            {pending.matched ? <span class="badge badge--red">競合対象</span> : null}
          </div>
          <div class="row">
            <button
              type="button"
              class="btn btn--primary grow"
              onClick={() => {
                const added = addCompCheckToHistory(pending);
                toast(added ? '履歴に追加しました' : '既に履歴に存在します', {
                  tone: added ? 'ok' : 'warn',
                });
              }}
            >
              📋 履歴に追加
            </button>
            <button type="button" class="btn" onClick={() => (compPending.value = null)}>
              キャンセル
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
