import { useMemo } from 'preact/hooks';
import type { CustomerOrder, Product, ShiwakeCart, ShiwakeItem } from '@core/types';
import { dictName } from '../link';
import { digitsOnly, normalizeForSearch } from '../text';
import { ItemCard } from './ItemCard';

export type CartFilter = 'all' | number;

interface Props {
  items: ShiwakeItem[];
  carts: ShiwakeCart[];
  filter: CartFilter;
  query: string;
  products: Record<string, Product>;
  custHits: ReadonlyMap<string, CustomerOrder>;
  openBarcodes: ReadonlySet<string>;
  openMemos: ReadonlySet<string>;
  onFilter: (f: CartFilter) => void;
  onToggleBarcode: (id: string) => void;
  onToggleMemo: (id: string) => void;
  onMemoInput: (id: string, text: string) => void;
  onShowCustOrder: (order: CustomerOrder) => void;
  onReset: () => void;
}

export function ResultView(props: Props) {
  const { items, carts, filter, query, products, custHits } = props;

  const filtered = useMemo(() => {
    const byCart = filter === 'all' ? items : items.filter((i) => i.cartIndex === filter);
    const q = normalizeForSearch(query).trim();
    if (!q) return byCart;
    const qDigits = digitsOnly(query);
    return byCart.filter(
      (i) =>
        normalizeForSearch(i.name).includes(q) ||
        (!!qDigits && (i.jan.includes(qDigits) || i.code.includes(qDigits))),
    );
  }, [items, filter, query]);

  const alertItems = filtered.filter((i) => i.isAlert);
  const normalItems = filtered.filter((i) => !i.isAlert);
  const alertTotal = items.filter((i) => i.isAlert).length;
  const cartLabelOf = (idx: number) => carts.find((c) => c.index === idx)?.label ?? null;

  const renderCard = (item: ShiwakeItem) => (
    <ItemCard
      key={item.id}
      item={item}
      dictName={dictName(item, products)}
      cartLabel={carts.length > 1 ? cartLabelOf(item.cartIndex) : null}
      custOrder={custHits.get(item.id)}
      barcodeOpen={props.openBarcodes.has(item.id)}
      memoOpen={props.openMemos.has(item.id)}
      onToggleBarcode={() => props.onToggleBarcode(item.id)}
      onToggleMemo={() => props.onToggleMemo(item.id)}
      onMemoInput={(t) => props.onMemoInput(item.id, t)}
      onShowCustOrder={props.onShowCustOrder}
    />
  );

  return (
    <div>
      <div class="sw-summary">
        <div class="sw-stat">
          <div class="sw-stat-num">{items.length}</div>
          <div class="sw-stat-lbl">全商品</div>
        </div>
        <div class="sw-stat" data-tone="alert">
          <div class="sw-stat-num">{alertTotal}</div>
          <div class="sw-stat-lbl">⚠ 要注意商品</div>
        </div>
      </div>

      {carts.length > 1 ? (
        <div class="sw-cart-tabs">
          <button
            class="sw-cart-tab"
            aria-pressed={filter === 'all'}
            onClick={() => props.onFilter('all')}
          >
            全て({items.length})
          </button>
          {carts.map((c) => (
            <button
              class="sw-cart-tab"
              key={c.index}
              aria-pressed={filter === c.index}
              onClick={() => props.onFilter(c.index)}
            >
              {c.label}({items.filter((i) => i.cartIndex === c.index).length})
            </button>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? <div class="sw-empty">該当する商品がありません</div> : null}

      {alertItems.length ? (
        <>
          <div class="sw-label">⚠ 要注意商品 ({alertItems.length})</div>
          {alertItems.map(renderCard)}
        </>
      ) : null}

      {normalItems.length ? (
        <>
          <div class="sw-label">商品一覧 ({normalItems.length})</div>
          {normalItems.map(renderCard)}
        </>
      ) : null}

      <button class="sw-btn-ghost sw-reset" onClick={props.onReset}>
        ↩ 次の便へ（リセット）
      </button>
    </div>
  );
}
