/**
 * 学習辞書管理。一覧 / 検索 / 選択削除 / 名称未設定のみ削除。
 */
import { useMemo, useState } from 'preact/hooks';
import { formatDateTime } from '@core/datetime';
import { Card, Empty, JanText } from '../components/primitives';
import { ConfirmSheet } from '../components/BottomSheet';
import { toast } from '../components/Toast';
import { deleteProducts, deleteUnnamedProducts, products } from '../store';

export function DictManager() {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | 'selected' | 'unnamed'>(null);

  const all = products.value;
  const list = useMemo(() => {
    const key = q.trim().toLowerCase();
    return Object.values(all)
      .filter((p) => !key || p.jan.includes(key) || p.name.toLowerCase().includes(key))
      .sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt));
  }, [all, q]);

  const unnamed = Object.values(all).filter((p) => !p.name.trim()).length;

  const toggle = (jan: string) => {
    const next = new Set(selected);
    if (next.has(jan)) next.delete(jan);
    else next.add(jan);
    setSelected(next);
  };

  return (
    <>
      <Card title={`学習辞書 (${Object.keys(all).length}件)`}>
        <input
          class="input"
          placeholder="コード / 商品名で検索"
          value={q}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
        />
        <div class="row" style={{ marginTop: '8px' }}>
          <button
            type="button"
            class="btn btn--sm btn--danger grow"
            disabled={selected.size === 0}
            onClick={() => setConfirm('selected')}
          >
            選択した{selected.size}件を削除
          </button>
          <button
            type="button"
            class="btn btn--sm grow"
            disabled={unnamed === 0}
            onClick={() => setConfirm('unnamed')}
          >
            名称未設定 {unnamed}件を削除
          </button>
        </div>
      </Card>

      {list.length === 0 ? (
        <Empty>{q ? '一致する商品がありません。' : 'まだ辞書に登録がありません。'}</Empty>
      ) : (
        <ul class="suggest">
          {list.slice(0, 300).map((p) => (
            <li key={p.jan}>
              <button
                type="button"
                class="suggest__item"
                aria-pressed={selected.has(p.jan)}
                style={selected.has(p.jan) ? { borderColor: 'var(--teal)' } : undefined}
                onClick={() => toggle(p.jan)}
              >
                <span>
                  {selected.has(p.jan) ? '☑ ' : '☐ '}
                  {p.name || '（名称未登録）'}
                </span>
                <span class="muted">
                  <JanText jan={p.jan} />
                  {p.boxJan ? ` / 箱 ${p.boxJan}` : ''}
                  {p.expiryOffsets.length ? ` / 期限学習 ${p.expiryOffsets.length}件` : ''} ・{' '}
                  {formatDateTime(p.lastUsedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.length > 300 ? <p class="muted">（上位300件のみ表示）</p> : null}

      <ConfirmSheet
        open={confirm !== null}
        title="辞書から削除"
        danger
        confirmLabel="削除する"
        message={
          confirm === 'unnamed'
            ? `名称未設定の ${unnamed} 件を辞書から削除します。`
            : `選択した ${selected.size} 件を辞書から削除します。`
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const n = confirm === 'unnamed' ? deleteUnnamedProducts() : deleteProducts(selected);
          setSelected(new Set());
          setConfirm(null);
          toast(`${n}件を削除しました`, { tone: 'ok' });
        }}
      />
    </>
  );
}
