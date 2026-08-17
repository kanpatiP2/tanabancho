/**
 * リストタブ（履歴）。ソート / バッジ / インライン編集 / スワイプ / 一括削除 / 拡大 / 画像化。
 */
import { useState } from 'preact/hooks';
import { addDays, todayLocal } from '@core/datetime';
import type { Settings } from '@core/types';
import { BottomSheet, ConfirmSheet } from '../components/BottomSheet';
import { Empty } from '../components/primitives';
import { toast, toastUndo } from '../components/Toast';
import { HistoryRow } from '../list/HistoryRow';
import { ZoomModal } from '../list/ZoomModal';
import { MergePanel } from '../list/MergePanel';
import { idsCreatedBefore, sortScans } from '../derived';
import {
  deleteScan,
  deleteScans,
  restoreScan,
  restoreScans,
  scans,
  settings,
  updateScan,
  updateSettings,
} from '../store';

const SORTS: { value: Settings['historySort']; label: string }[] = [
  { value: 'newest', label: '新しい順' },
  { value: 'oldest', label: '古い順' },
  { value: 'genre', label: 'ジャンル順' },
  { value: 'name', label: '商品名順' },
];

type BulkMode = null | 'selected' | 'untilYesterday' | 'genre' | 'all';

export function ListTab() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [bulk, setBulk] = useState<BulkMode>(null);
  const [genreTarget, setGenreTarget] = useState('');

  const all = scans.value;
  const display = sortScans(all, settings.value.historySort);
  const genres = [...new Set(all.map((i) => i.genre).filter(Boolean))].sort();

  const toggleSelected = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const removeOne = (id: string) => {
    const removed = deleteScan(id);
    if (!removed) {
      toast('保護中のため削除できません', { tone: 'warn' });
      return;
    }
    if (expandedId === id) setExpandedId(null);
    toastUndo('1件削除しました', () => restoreScan(removed.item, removed.index));
  };

  const runBulk = () => {
    let ids: string[] = [];
    let label = '';
    if (bulk === 'selected') {
      ids = [...selected];
      label = `選択した${ids.length}件`;
    } else if (bulk === 'untilYesterday') {
      ids = idsCreatedBefore(all, todayLocal());
      label = `昨日までの${ids.length}件`;
    } else if (bulk === 'genre') {
      ids = all.filter((s) => s.genre === genreTarget).map((s) => s.id);
      label = `ジャンル「${genreTarget}」の${ids.length}件`;
    } else if (bulk === 'all') {
      ids = all.map((s) => s.id);
      label = `全${ids.length}件`;
    }
    setBulk(null);
    setMenuOpen(false);
    if (!ids.length) {
      toast('対象がありません', { tone: 'warn' });
      return;
    }
    const removed = deleteScans(ids);
    setSelected(new Set());
    setSelecting(false);
    toastUndo(`${label}のうち${removed.length}件を削除しました（保護中は残ります）`, () =>
      restoreScans(removed),
    );
  };

  return (
    <>
      <div class="topbar">
        <span class="topbar__title">
          リスト <span class="topbar__sub">{all.length}件</span>
        </span>
        <select
          class="select"
          style={{ width: 'auto', minHeight: '40px' }}
          value={settings.value.historySort}
          onChange={(e) =>
            updateSettings({
              historySort: (e.currentTarget as HTMLSelectElement).value as Settings['historySort'],
            })
          }
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="button" class="btn btn--sm btn--icon" aria-label="メニュー" onClick={() => setMenuOpen(true)}>
          ⋮
        </button>
      </div>

      {selecting ? (
        <div class="summary-line" style={{ margin: '8px 0' }}>
          選択モード: {selected.size}件
          <button
            type="button"
            class="btn btn--sm"
            style={{ marginLeft: '8px' }}
            onClick={() => {
              setSelecting(false);
              setSelected(new Set());
            }}
          >
            終了
          </button>
        </div>
      ) : null}

      {display.length === 0 ? (
        <Empty>まだ履歴がありません。スキャンタブから登録してください。</Empty>
      ) : (
        <ul class="histlist">
          {display.map((item) => (
            <HistoryRow
              key={item.id}
              item={item}
              expanded={expandedId === item.id}
              selecting={selecting}
              selected={selected.has(item.id)}
              onToggleExpand={() => setExpandedId(expandedId === item.id ? null : item.id)}
              onSelect={() => toggleSelected(item.id)}
              onZoom={() => setZoomIndex(display.findIndex((d) => d.id === item.id))}
              onDelete={() => removeOne(item.id)}
              onToggleProtect={() => {
                updateScan(item.id, { protected: !item.protected });
                toast(item.protected ? '🔓 保護を解除しました' : '🔒 保護しました');
              }}
            />
          ))}
        </ul>
      )}

      {zoomIndex !== null ? (
        <ZoomModal
          items={display}
          index={Math.min(zoomIndex, display.length - 1)}
          onNavigate={setZoomIndex}
          onClose={() => setZoomIndex(null)}
          onDelete={(item) => {
            removeOne(item.id);
            setZoomIndex(null);
          }}
        />
      ) : null}

      <BottomSheet open={menuOpen} title="リスト操作" onClose={() => setMenuOpen(false)}>
        <div class="menulist">
          <button
            type="button"
            class="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setMergeOpen(true);
            }}
          >
            <span class="menuitem__icon">🖼</span>
            <span class="grow">画像化（バーコード一覧を書き出し）</span>
            <span class="menuitem__chev">›</span>
          </button>
          <button
            type="button"
            class="menuitem"
            onClick={() => {
              setSelecting(true);
              setMenuOpen(false);
            }}
          >
            <span class="menuitem__icon">☑</span>
            <span class="grow">選択モードにする</span>
          </button>
          <hr class="sep" />
          <button type="button" class="menuitem" onClick={() => setBulk('selected')}>
            <span class="menuitem__icon">🗑</span>
            <span class="grow">選択した{selected.size}件を削除</span>
          </button>
          <button type="button" class="menuitem" onClick={() => setBulk('untilYesterday')}>
            <span class="menuitem__icon">🗓</span>
            <span class="grow">昨日までを削除（登録日時基準）</span>
          </button>
          <div class="menuitem">
            <span class="menuitem__icon">🏷</span>
            <select
              class="select grow"
              value={genreTarget}
              onChange={(e) => setGenreTarget((e.currentTarget as HTMLSelectElement).value)}
            >
              <option value="">ジャンルを選択</option>
              {genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <button
              type="button"
              class="btn btn--sm"
              disabled={!genreTarget}
              onClick={() => setBulk('genre')}
            >
              削除
            </button>
          </div>
          <button type="button" class="menuitem" onClick={() => setBulk('all')}>
            <span class="menuitem__icon">💥</span>
            <span class="grow">すべて削除</span>
          </button>
        </div>
        <p class="muted" style={{ marginTop: '8px' }}>
          保護中（🔒）の履歴はどの一括削除でも残ります。「昨日まで」は createdAt を基準にします。
        </p>
      </BottomSheet>

      <ConfirmSheet
        open={bulk !== null}
        title="一括削除"
        danger
        confirmLabel="削除する"
        message={
          bulk === 'selected'
            ? `選択した ${selected.size} 件を削除します。`
            : bulk === 'untilYesterday'
              ? `${addDays(todayLocal(), -1)} 以前に登録した履歴を削除します。`
              : bulk === 'genre'
                ? `ジャンル「${genreTarget}」の履歴を削除します。`
                : `全 ${all.length} 件を削除します。`
        }
        onCancel={() => setBulk(null)}
        onConfirm={runBulk}
      />

      <MergePanel
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        items={all}
        selectedIds={selected}
        onRequestSelection={() => {
          setMergeOpen(false);
          setSelecting(true);
          toast('行をタップして選択してください', { tone: 'info' });
        }}
      />
    </>
  );
}
