/**
 * 仕分番長 v2 のルートコンポーネント。
 * 明細OCR / 要注意 / メモ の3タブ + 辞書還流 + 客注照合。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { nowIso, todayLocal } from '@core/datetime';
import type { CustomerOrder, Note, Product, ShiwakeItem, ShiwakeState } from '@core/types';
import './shiwake.css';

import { adoptLegacyApiKey, clearApiKey, getApiKey, isPersisted, saveApiKey } from './apikey';
import { buildFromSheets, reevaluateAlerts } from './build';
import { GeminiError, runOcr } from './gemini';
import type { SelectedImage } from './images';
import { applyCustomerOrderIds, matchCustomerOrders, refluxProducts } from './link';
import {
  emptyShiwakeState,
  loadBinMemoDraft,
  loadBinMemoHistory,
  loadCustomerOrders,
  loadProducts,
  loadShiwakeState,
  pushBinMemoHistory,
  saveBinMemoDraft,
  saveProducts,
  saveShiwakeState,
} from './state';

import { AlertTab } from './components/AlertTab';
import { ApiKeyScreen } from './components/ApiKeyScreen';
import { ImagePicker } from './components/ImagePicker';
import { MemoTab } from './components/MemoTab';
import { BottomSheet, Toast, type ToastState } from './components/Overlays';
import { ProgressCard, type ProgressStep } from './components/ProgressCard';
import { ResultView, type CartFilter } from './components/ResultView';

type Tab = 'meisai' | 'alert' | 'memo';
type Phase = 'idle' | 'loading' | 'result';

const MEMO_DEBOUNCE_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errorMessage(e: unknown): string {
  if (e instanceof GeminiError) {
    switch (e.kind) {
      case 'truncated':
        return '明細が多すぎて読み切れませんでした。枚数を減らしてもう一度お試しください';
      case 'parse':
        return '読み取り結果を解釈できませんでした。写真を撮り直してお試しください';
      case 'empty':
        return '明細から商品を読み取れませんでした。ピント・明るさをご確認ください';
      case 'network':
        return `通信に失敗しました（${e.message}）`;
      default:
        return `Gemini エラー: ${e.message}`;
    }
  }
  return e instanceof Error ? e.message : '不明なエラーが発生しました';
}

export function ShiwakeApp() {
  const [tab, setTab] = useState<Tab>('meisai');
  const [phase, setPhase] = useState<Phase>('idle');
  const [showKeyScreen, setShowKeyScreen] = useState(false);

  const [apiKey, setApiKey] = useState('');
  const [persisted, setPersisted] = useState(false);

  const [state, setState] = useState<ShiwakeState>(emptyShiwakeState);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [custOrders, setCustOrders] = useState<CustomerOrder[]>([]);

  const [images, setImages] = useState<SelectedImage[]>([]);
  const [percent, setPercent] = useState(0);
  const [steps, setSteps] = useState<ProgressStep[]>([]);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CartFilter>('all');
  const [openBarcodes, setOpenBarcodes] = useState<ReadonlySet<string>>(new Set());
  const [openMemos, setOpenMemos] = useState<ReadonlySet<string>>(new Set());

  const [memoDraft, setMemoDraft] = useState('');
  const [memoSaved, setMemoSaved] = useState(false);
  const [memoHistory, setMemoHistory] = useState<Note[]>([]);

  const [toast, setToast] = useState<ToastState | null>(null);
  const [custSheet, setCustSheet] = useState<CustomerOrder | null>(null);

  const memoTimer = useRef<number | undefined>(undefined);
  const savedTimer = useRef<number | undefined>(undefined);
  const creepTimer = useRef<number | undefined>(undefined);

  // ---------------------------------------------------------------- 初期化
  useEffect(() => {
    adoptLegacyApiKey();
    const key = getApiKey();
    setApiKey(key);
    setPersisted(isPersisted());
    setShowKeyScreen(!key);

    const { state: loaded, importedFromV1 } = loadShiwakeState();
    setState(loaded);
    setProducts(loadProducts());
    setCustOrders(loadCustomerOrders());
    setMemoDraft(loadBinMemoDraft());
    setMemoHistory(loadBinMemoHistory());
    if (importedFromV1) {
      setToast({ message: `旧バージョンのデータを引き継ぎました（${loaded.items.length}商品）` });
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(
    () => () => {
      window.clearTimeout(memoTimer.current);
      window.clearTimeout(savedTimer.current);
      window.clearInterval(creepTimer.current);
    },
    [],
  );

  const custHits = useMemo(
    () => matchCustomerOrders(state.items, custOrders, todayLocal()),
    [state.items, custOrders],
  );

  const commitState = useCallback((next: ShiwakeState) => {
    setState(next);
    if (!saveShiwakeState(next)) {
      setToast({ message: '保存に失敗しました（端末の空き容量をご確認ください）' });
    }
  }, []);

  // ---------------------------------------------------------------- APIキー
  const onSaveKey = (key: string, persist: boolean) => {
    saveApiKey(key, persist);
    setApiKey(getApiKey());
    setPersisted(isPersisted());
    setShowKeyScreen(false);
    setToast({ message: persist ? 'キーをこの端末に保存しました' : 'キーをこのタブのみで保持します' });
  };

  const onClearKey = () => {
    clearApiKey();
    setApiKey('');
    setPersisted(false);
    setToast({ message: 'APIキーを削除しました' });
  };

  // ---------------------------------------------------------------- OCR
  const analyze = async () => {
    if (!apiKey) {
      setShowKeyScreen(true);
      return;
    }
    if (!images.length) return;

    setPhase('loading');
    setPercent(8);
    setSteps([{ text: `⏳ ${images.length}枚の明細書を1リクエストで解析中...`, tone: 'active' }]);

    // 疑似進捗（応答時間が読めないので 90% で頭打ちにする）
    window.clearInterval(creepTimer.current);
    creepTimer.current = window.setInterval(() => {
      setPercent((p) => (p < 90 ? p + Math.max(1, Math.round((90 - p) / 12)) : p));
    }, 400);

    try {
      const result = await runOcr(images, {
        apiKey,
        onSplit: (n) =>
          setSteps((s) => [
            ...s,
            { text: `⚙ 出力が長すぎたため ${n}枚ずつに分割して再試行します`, tone: 'active' },
          ]),
      });
      window.clearInterval(creepTimer.current);

      const built = buildFromSheets(result.sheets, { alertWords: state.alertWords });

      // 辞書へ還流（manual 名は mergeProduct が守る）。
      // 棚番長本体が別タブで書き換えている可能性があるので、直前に読み直してからマージする
      const reflux = refluxProducts(built.items, loadProducts(), {
        now: nowIso(),
        boxJanByJan: built.boxJanByJan,
      });
      setProducts(reflux.products);
      saveProducts(reflux.products);

      // 客注照合（同じ理由で読み直す）
      const freshOrders = loadCustomerOrders();
      setCustOrders(freshOrders);
      const hits = matchCustomerOrders(built.items, freshOrders, todayLocal());
      const items = applyCustomerOrderIds(built.items, hits);

      commitState({ items, carts: built.carts, alertWords: state.alertWords, updatedAt: nowIso() });
      setFilter('all');
      setQuery('');
      setOpenBarcodes(new Set());
      setOpenMemos(new Set());

      setPercent(100);
      setSteps((s) => [
        ...s,
        {
          text: `✅ ${built.carts.length}枚・計${items.length}商品を読み取りました${
            result.requests > 1 ? `（${result.requests}リクエスト）` : ''
          }`,
          tone: 'done',
        },
        ...(reflux.changed ? [{ text: `📚 辞書に${reflux.changed}件反映しました`, tone: 'done' as const }] : []),
        ...(hits.size ? [{ text: `🧾 客注 ${hits.size}件が含まれています`, tone: 'done' as const }] : []),
      ]);
      await sleep(500);
      setPhase('result');
    } catch (e) {
      window.clearInterval(creepTimer.current);
      setPercent(100);
      setSteps((s) => [...s, { text: `⚠ ${errorMessage(e)}`, tone: 'error' }]);
      await sleep(200);
      setPhase('idle');
      setToast({ message: errorMessage(e) });
    }
  };

  // ---------------------------------------------------------------- 明細操作
  const restoreLastSession = () => {
    const items = reevaluateAlerts(state.items, state.alertWords);
    const hits = matchCustomerOrders(items, custOrders, todayLocal());
    commitState({ ...state, items: applyCustomerOrderIds(items, hits), updatedAt: nowIso() });
    setPhase('result');
  };

  const resetSession = () => {
    const previous = state;
    const previousDraft = memoDraft;
    if (memoDraft.trim()) setMemoHistory(pushBinMemoHistory(memoDraft));
    setMemoDraft('');
    saveBinMemoDraft('');
    commitState({ items: [], carts: [], alertWords: state.alertWords, updatedAt: nowIso() });
    setImages([]);
    setFilter('all');
    setQuery('');
    setOpenBarcodes(new Set());
    setOpenMemos(new Set());
    setPhase('idle');
    setToast({
      message: '次の便へ切り替えました',
      undo: () => {
        commitState(previous);
        setMemoDraft(previousDraft);
        saveBinMemoDraft(previousDraft);
        setPhase(previous.items.length ? 'result' : 'idle');
      },
    });
  };

  const updateItem = (id: string, patch: Partial<ShiwakeItem>) => {
    commitState({
      ...state,
      items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      updatedAt: nowIso(),
    });
  };

  const toggle = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  // ---------------------------------------------------------------- 要注意ワード
  const applyAlertWords = (words: string[]) => {
    commitState({
      ...state,
      alertWords: words,
      items: reevaluateAlerts(state.items, words),
      updatedAt: nowIso(),
    });
  };

  const addAlertWord = (word: string) => {
    if (state.alertWords.includes(word)) {
      setToast({ message: 'すでに登録されています' });
      return;
    }
    applyAlertWords([...state.alertWords, word]);
  };

  const deleteAlertWord = (word: string) => {
    const before = state.alertWords;
    applyAlertWords(before.filter((w) => w !== word));
    setToast({ message: `「${word}」を削除しました`, undo: () => applyAlertWords(before) });
  };

  // ---------------------------------------------------------------- 便メモ
  const onMemoInput = (text: string) => {
    setMemoDraft(text);
    window.clearTimeout(memoTimer.current);
    memoTimer.current = window.setTimeout(() => {
      saveBinMemoDraft(text);
      setMemoSaved(true);
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setMemoSaved(false), 1500);
    }, MEMO_DEBOUNCE_MS);
  };

  // ---------------------------------------------------------------- 描画
  const alertCount = state.items.filter((i) => i.isAlert).length;
  const badge = phase === 'loading' ? 'checking' : phase === 'result' ? 'done' : 'waiting';
  const badgeText = phase === 'loading' ? '読み取り中' : phase === 'result' ? '確認中' : '待機中';
  const showSearch = !showKeyScreen && tab === 'meisai' && phase === 'result';

  return (
    <div class="sw-root">
      <header class="sw-topbar">
        <div class="sw-topbar-row">
          <h1>🗂 仕分番長</h1>
          <div class="sw-topbar-right">
            {!showKeyScreen ? (
              <button class="sw-key-btn" onClick={() => setShowKeyScreen(true)}>
                🔑 APIキー
              </button>
            ) : null}
            <span class="sw-badge" data-state={badge}>
              {badgeText}
            </span>
          </div>
        </div>
        {showSearch ? (
          <input
            class="sw-search"
            type="search"
            value={query}
            placeholder="商品名・JANコードで検索（ひらがな可）..."
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          />
        ) : null}
      </header>

      {showKeyScreen ? (
        <ApiKeyScreen
          currentKey={apiKey}
          currentPersisted={persisted}
          onSave={onSaveKey}
          onCancel={apiKey ? () => setShowKeyScreen(false) : null}
          onClear={apiKey ? onClearKey : null}
        />
      ) : (
        <main class="sw-content">
          {tab === 'meisai' ? (
            <>
              {phase === 'idle' ? (
                <div class="sw-stack">
                  <ImagePicker
                    images={images}
                    onChange={setImages}
                    active={tab === 'meisai' && phase === 'idle'}
                    onError={(message) => setToast({ message })}
                  />
                  <button class="sw-btn-primary" disabled={!images.length} onClick={() => void analyze()}>
                    📋{' '}
                    {images.length
                      ? `${images.length}枚を1リクエストで読み取る`
                      : '明細書を読み取る'}
                  </button>
                  {state.items.length ? (
                    <button class="sw-btn-ghost" onClick={restoreLastSession}>
                      🕐 前回の読み取り結果を復元（{state.items.length}商品）
                    </button>
                  ) : null}
                </div>
              ) : null}

              {phase === 'loading' ? <ProgressCard percent={percent} steps={steps} /> : null}

              {phase === 'result' ? (
                <ResultView
                  items={state.items}
                  carts={state.carts}
                  filter={filter}
                  query={query}
                  products={products}
                  custHits={custHits}
                  openBarcodes={openBarcodes}
                  openMemos={openMemos}
                  onFilter={setFilter}
                  onToggleBarcode={(id) => setOpenBarcodes((s) => toggle(s, id))}
                  onToggleMemo={(id) => setOpenMemos((s) => toggle(s, id))}
                  onMemoInput={(id, memo) => updateItem(id, { memo })}
                  onShowCustOrder={setCustSheet}
                  onReset={resetSession}
                />
              ) : null}
            </>
          ) : null}

          {tab === 'alert' ? (
            <AlertTab words={state.alertWords} onAdd={addAlertWord} onDelete={deleteAlertWord} />
          ) : null}

          {tab === 'memo' ? (
            <MemoTab draft={memoDraft} saved={memoSaved} history={memoHistory} onInput={onMemoInput} />
          ) : null}
        </main>
      )}

      {!showKeyScreen ? (
        <nav class="sw-nav">
          <button aria-current={tab === 'meisai' ? 'page' : undefined} onClick={() => setTab('meisai')}>
            <span class="sw-nav-icon" aria-hidden="true">
              📋
            </span>
            <span>明細</span>
          </button>
          <button aria-current={tab === 'alert' ? 'page' : undefined} onClick={() => setTab('alert')}>
            <span class="sw-nav-icon" aria-hidden="true">
              ⚠️
            </span>
            <span>
              要注意
              {alertCount ? <span class="sw-nav-count">{alertCount}</span> : null}
            </span>
          </button>
          <button aria-current={tab === 'memo' ? 'page' : undefined} onClick={() => setTab('memo')}>
            <span class="sw-nav-icon" aria-hidden="true">
              📝
            </span>
            <span>メモ</span>
          </button>
        </nav>
      ) : null}

      {custSheet ? (
        <BottomSheet title="客注あり" onClose={() => setCustSheet(null)}>
          <dl class="sw-kv">
            <dt>商品</dt>
            <dd>{custSheet.name || '（名称未登録）'}</dd>
            <dt>数量</dt>
            <dd>
              {custSheet.qty}点{custSheet.caseQty ? `（${custSheet.caseQty}ケース）` : ''}
            </dd>
            <dt>受渡</dt>
            <dd>
              {custSheet.deliveryDate || '未定'} {custSheet.deliveryTime}
            </dd>
            <dt>電話</dt>
            <dd>{custSheet.phone || '—'}</dd>
            {custSheet.memo ? (
              <>
                <dt>メモ</dt>
                <dd>{custSheet.memo}</dd>
              </>
            ) : null}
          </dl>
        </BottomSheet>
      ) : null}

      {toast ? <Toast state={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
