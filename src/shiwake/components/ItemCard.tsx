import type { CustomerOrder, ShiwakeItem } from '@core/types';
import { Barcode } from './Barcode';

interface Props {
  item: ShiwakeItem;
  /** 辞書（KEYS.products）の正式名。明細名と違うときだけ渡ってくる */
  dictName: string | null;
  cartLabel: string | null;
  custOrder: CustomerOrder | undefined;
  barcodeOpen: boolean;
  memoOpen: boolean;
  onToggleBarcode: () => void;
  onToggleMemo: () => void;
  onMemoInput: (text: string) => void;
  onShowCustOrder: (order: CustomerOrder) => void;
}

function caseTone(cases: number): 'single' | 'many' | undefined {
  if (cases === 1) return 'single';
  if (cases >= 5) return 'many';
  return undefined;
}

export function ItemCard({
  item,
  dictName,
  cartLabel,
  custOrder,
  barcodeOpen,
  memoOpen,
  onToggleBarcode,
  onToggleMemo,
  onMemoInput,
  onShowCustOrder,
}: Props) {
  return (
    <div class="sw-card" data-alert={item.isAlert}>
      <div class="sw-card-main">
        <span class="sw-dot" aria-hidden="true" />
        <div class="sw-card-body">
          <div class="sw-item-name">
            {item.name}
            {item.isAlert ? <span class="sw-tag-alert">要注意</span> : null}
          </div>
          {dictName ? <div class="sw-dict-name">→ {dictName}</div> : null}
          <div class="sw-meta">
            <span class="sw-chip" data-tone={caseTone(item.cases)}>
              {item.cases}ケース
            </span>
            {/* qty_per_case が null のとき v1 は "入数 null" と出ていた */}
            <span>入数 {item.qtyPerCase === null ? '—' : item.qtyPerCase}</span>
            {item.jan ? <span>JAN: {item.jan}</span> : null}
            {cartLabel ? <span class="sw-chip">{cartLabel}</span> : null}
            {custOrder ? (
              <button class="sw-cust-badge" onClick={() => onShowCustOrder(custOrder)}>
                客注 {custOrder.qty}点
              </button>
            ) : null}
          </div>
          {item.memo ? <div class="sw-item-memo">{item.memo}</div> : null}
        </div>
      </div>

      <div class="sw-expand-row">
        <button class="sw-expand-btn" aria-expanded={barcodeOpen} onClick={onToggleBarcode}>
          📊 バーコード
        </button>
        <button class="sw-expand-btn" aria-expanded={memoOpen} onClick={onToggleMemo}>
          📝 メモ{item.memo ? ' ●' : ''}
        </button>
      </div>

      {barcodeOpen ? (
        <div class="sw-panel">
          {item.jan ? (
            <>
              <div class="sw-panel-head">JAN: {item.jan}</div>
              <Barcode code={item.jan} />
            </>
          ) : (
            <div class="sw-panel-head">コード情報なし</div>
          )}
        </div>
      ) : null}

      {memoOpen ? (
        <div class="sw-panel">
          <textarea
            placeholder="商品メモ..."
            value={item.memo}
            onInput={(e) => onMemoInput((e.currentTarget as HTMLTextAreaElement).value)}
          />
        </div>
      ) : null}
    </div>
  );
}
