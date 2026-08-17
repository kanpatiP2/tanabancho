/**
 * バーコード拡大モーダル。◀▶ で表示中リストを移動、この履歴を削除。
 */
import type { ScanItem } from '@core/types';
import { Barcode } from '../components/Barcode';
import { JanText } from '../components/primitives';

interface Props {
  items: ScanItem[];
  index: number;
  onNavigate: (nextIndex: number) => void;
  onClose: () => void;
  onDelete: (item: ScanItem) => void;
}

export function ZoomModal({ items, index, onNavigate, onClose, onDelete }: Props) {
  const item = items[index];
  if (!item) return null;
  return (
    <div
      class="zoom-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="zoom-card">
        <div class="muted">
          {index + 1} / {items.length}
        </div>
        <h3 style={{ margin: '4px 0' }}>{item.name || '（名称未登録）'}</h3>
        <Barcode code={item.jan} />
        <div style={{ marginTop: '4px' }}>
          <JanText jan={item.jan} />
        </div>
        {item.boxJan ? (
          <div style={{ marginTop: '10px' }}>
            <div class="muted">箱JAN</div>
            <Barcode code={item.boxJan} height={80} width={2} />
          </div>
        ) : null}
      </div>
      <div class="row" style={{ justifyContent: 'center' }}>
        <button
          type="button"
          class="btn"
          disabled={index <= 0}
          onClick={() => onNavigate(index - 1)}
          aria-label="前へ"
        >
          ◀
        </button>
        <button
          type="button"
          class="btn btn--danger"
          disabled={item.protected}
          onClick={() => onDelete(item)}
        >
          この履歴を削除
        </button>
        <button
          type="button"
          class="btn"
          disabled={index >= items.length - 1}
          onClick={() => onNavigate(index + 1)}
          aria-label="次へ"
        >
          ▶
        </button>
      </div>
      <button type="button" class="btn" onClick={onClose}>
        閉じる
      </button>
    </div>
  );
}
