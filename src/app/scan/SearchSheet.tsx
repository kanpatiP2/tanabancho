/**
 * 手入力 / 辞書検索シート。コード・商品名の部分一致サジェスト（最大10件）。
 */
import { useMemo, useState } from 'preact/hooks';
import { BottomSheet } from '../components/BottomSheet';
import { JanText } from '../components/primitives';
import { products } from '../store';
import { searchProducts } from './search';

interface Props {
  open: boolean;
  onClose: () => void;
  /** コード確定（手入力・サジェスト選択のどちらも） */
  onPick: (jan: string) => void;
  title?: string;
}

export function SearchSheet({ open, onClose, onPick, title = '手入力 / 辞書検索' }: Props) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => searchProducts(products.value, q), [q, products.value]);

  const submit = () => {
    const code = q.trim();
    if (!code) return;
    onPick(code);
    setQ('');
  };

  return (
    <BottomSheet
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <button type="button" class="btn btn--primary btn--block" disabled={!q.trim()} onClick={submit}>
          このコードで登録
        </button>
      }
    >
      <input
        class="input"
        autofocus
        placeholder="コード または 商品名"
        value={q}
        onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <p class="muted" style={{ margin: '8px 0 4px' }}>
        {q.trim() ? `辞書ヒット ${hits.length}件` : '学習辞書から検索します'}
      </p>
      <ul class="suggest">
        {hits.map((p) => (
          <li key={p.jan}>
            <button
              type="button"
              class="suggest__item"
              onClick={() => {
                onPick(p.jan);
                setQ('');
              }}
            >
              <span>{p.name || '（名称未登録）'}</span>
              <span class="muted">
                <JanText jan={p.jan} />
                {p.boxJan ? ` / 箱 ${p.boxJan}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
