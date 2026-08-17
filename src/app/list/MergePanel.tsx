/**
 * 履歴の画像化 UI（Canvas ロジック本体は merge-image.ts）。
 * フィルタ: ジャンル / コメント / 発注種別 / POPのみ / 発注指数のみ / 任意選択。
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ScanItem } from '@core/types';
import { BottomSheet } from '../components/BottomSheet';
import { Check, Empty, Field } from '../components/primitives';
import { toast } from '../components/Toast';
import {
  EMPTY_FILTER,
  applyMergeFilter,
  chunkItems,
  createMergedImages,
  mergedFileName,
  type MergeFilter,
  type MergedImage,
} from '../merge-image';
import { profile } from '../store';

interface Props {
  open: boolean;
  onClose: () => void;
  items: ScanItem[];
  /** 「任意選択」で選ばれた id。空なら全件対象 */
  selectedIds: Set<string>;
  onRequestSelection: () => void;
}

export function MergePanel({ open, onClose, items, selectedIds, onRequestSelection }: Props) {
  const [filter, setFilter] = useState<MergeFilter>({ ...EMPTY_FILTER });
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [images, setImages] = useState<MergedImage[]>([]);
  const [fullscreen, setFullscreen] = useState<string | null>(null);

  const genres = useMemo(
    () => [...new Set(items.map((i) => i.genre).filter(Boolean))].sort(),
    [items],
  );
  const memos = useMemo(() => [...new Set(items.map((i) => i.memo).filter(Boolean))].sort(), [items]);

  const effective: MergeFilter = {
    ...filter,
    selectedIds: filter.selectedIds ? selectedIds : null,
  };
  const targets = applyMergeFilter(items, effective);
  const sheets = chunkItems(targets).length;

  useEffect(() => {
    return () => images.forEach((i) => URL.revokeObjectURL(i.url));
  }, [images]);

  const run = async () => {
    if (!targets.length) {
      toast('条件に一致するデータがありません', { tone: 'warn' });
      return;
    }
    // 直前の Blob URL は setImages による useEffect のクリーンアップで解放される
    setImages([]);
    setProgress({ done: 0, total: targets.length });
    try {
      const result = await createMergedImages(targets, {
        title,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setImages(result);
      toast(`${result.length}枚の画像を生成しました`, { tone: 'ok' });
    } catch (e) {
      toast(`画像生成に失敗しました: ${e instanceof Error ? e.message : String(e)}`, {
        tone: 'error',
      });
    } finally {
      setProgress(null);
    }
  };

  const saveAll = () => {
    images.forEach((img, idx) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = img.url;
        a.download = mergedFileName(title, idx, images.length);
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, idx * 400);
    });
    toast(`${images.length}枚をまとめて保存します`, { tone: 'ok' });
  };

  return (
    <BottomSheet
      open={open}
      title="履歴を画像化"
      onClose={onClose}
      footer={
        <>
          <button type="button" class="btn grow" onClick={onClose}>
            閉じる
          </button>
          <button
            type="button"
            class="btn btn--primary grow"
            disabled={Boolean(progress)}
            onClick={() => void run()}
          >
            {progress ? '生成中…' : `画像化（${targets.length}件 / ${sheets}枚）`}
          </button>
        </>
      }
    >
      <div class="stack">
        <Field label="画像タイトル">
          <input
            class="input"
            value={title}
            onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)}
            placeholder="例: 8/17 売場変更"
          />
        </Field>

        <div class="row">
          <Field label="ジャンル" style={{ flex: '1' }}>
            <select
              class="select"
              value={filter.genre}
              onChange={(e) => setFilter({ ...filter, genre: (e.currentTarget as HTMLSelectElement).value })}
            >
              <option value="">すべて</option>
              {genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="コメント" style={{ flex: '1' }}>
            <select
              class="select"
              value={filter.memo}
              onChange={(e) => setFilter({ ...filter, memo: (e.currentTarget as HTMLSelectElement).value })}
            >
              <option value="">すべて</option>
              {memos.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="発注種別">
          <select
            class="select"
            value={filter.order}
            onChange={(e) => setFilter({ ...filter, order: (e.currentTarget as HTMLSelectElement).value })}
          >
            <option value="">すべて</option>
            {profile.value.vocab.orderTypes.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>

        <div class="row row--tight">
          <Check
            label="POPのみ"
            checked={filter.popOnly}
            onChange={(popOnly) => setFilter({ ...filter, popOnly })}
          />
          <Check
            label="発注/指数のみ"
            checked={filter.orderOnly}
            onChange={(orderOnly) => setFilter({ ...filter, orderOnly })}
          />
          <Check
            label="ジャンル順に並べる"
            checked={filter.sortByGenre}
            onChange={(sortByGenre) => setFilter({ ...filter, sortByGenre })}
          />
        </div>

        <div class="row">
          <Check
            label={`任意選択のみ（${selectedIds.size}件）`}
            checked={Boolean(filter.selectedIds)}
            onChange={(on) => setFilter({ ...filter, selectedIds: on ? selectedIds : null })}
          />
          <button type="button" class="btn btn--sm" onClick={onRequestSelection}>
            選択モードへ
          </button>
        </div>

        {progress ? (
          <div>
            <div class="progress">
              <div
                class="progress__bar"
                style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
              />
            </div>
            <p class="muted">
              {progress.done} / {progress.total} 件処理中…
            </p>
          </div>
        ) : null}

        {images.length ? (
          <>
            <button type="button" class="btn btn--block" onClick={saveAll}>
              💾 {images.length}枚をまとめて保存
            </button>
            <div class="merged-list">
              {images.map((img) => (
                <img
                  key={img.url}
                  src={img.url}
                  alt={`生成画像 ${img.index + 1}`}
                  onClick={() => setFullscreen(img.url)}
                />
              ))}
            </div>
          </>
        ) : progress ? null : (
          <Empty>「画像化」を押すと生成します</Empty>
        )}
      </div>

      {fullscreen ? (
        <div class="zoom-backdrop" onClick={() => setFullscreen(null)}>
          <img src={fullscreen} alt="生成画像（全画面）" style={{ maxWidth: '100%', maxHeight: '90dvh' }} />
        </div>
      ) : null}
    </BottomSheet>
  );
}
