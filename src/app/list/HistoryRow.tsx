/**
 * 履歴 1 行。バッジ表示 + 展開式インライン編集 + スワイプ（右=削除 / 左=保護）。
 */
import { formatDateTime, todayLocal } from '@core/datetime';
import { barcodeFormat } from '@core/jan';
import type { ScanItem } from '@core/types';
import { Badge, Check, Field, JanText } from '../components/primitives';
import { SwipeRow } from '../components/SwipeRow';
import { PopEditor } from '../scan/PopPanel';
import { requestFieldScan, useFieldScan } from '../scan/field-scan';
import { formatPopDetails } from '../merge-image';
import { learnProduct, profile, updateScan } from '../store';

const BARCODE_KIND: Record<string, string> = {
  EAN13: 'JAN13',
  EAN8: 'JAN8',
  UPC: 'UPC',
  CODE128: 'その他',
};

interface Props {
  item: ScanItem;
  expanded: boolean;
  selecting: boolean;
  selected: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  onZoom: () => void;
  onDelete: () => void;
  onToggleProtect: () => void;
}

export function HistoryRow({
  item,
  expanded,
  selecting,
  selected,
  onToggleExpand,
  onSelect,
  onZoom,
  onDelete,
  onToggleProtect,
}: Props) {
  const expired = Boolean(item.expiry && item.expiry < todayLocal());
  const orderTypes = profile.value.vocab.orderTypes;

  /**
   * 箱JAN の「スキャンで入力」（v1 の activeBoxJanScanId 相当）。
   * 箱コード自体を登録するので箱JAN→バラJAN の置換は掛けない（ITF-14 → JAN13 の変換だけ行う）。
   */
  const boxScanKind = `boxJan:${item.id}`;
  useFieldScan(boxScanKind, (jan) => setBoxJan(item, jan));

  return (
    <li class="histrow" data-expired={String(expired)} data-selected={String(selected)}>
      <SwipeRow
        onSwipeRight={item.protected ? null : onDelete}
        onSwipeLeft={onToggleProtect}
        rightLabel="🗑 削除"
        leftLabel={item.protected ? '🔓 保護解除' : '🔒 保護'}
      >
        <div
          class="histrow__head"
          onClick={() => (selecting ? onSelect() : onToggleExpand())}
          role="button"
          tabIndex={0}
        >
          <div class="grow">
            <div class="histrow__code">
              {selecting ? <span>{selected ? '☑ ' : '☐ '}</span> : null}
              <JanText jan={item.jan} />
              {item.protected ? ' 🔒' : ''}
            </div>
            {item.name ? <div class="histrow__name">{item.name}</div> : null}
            <div class="histrow__meta">
              <Badge tone="plain">{BARCODE_KIND[barcodeFormat(item.jan)] ?? 'その他'}</Badge>
              <span class="muted">{formatDateTime(item.createdAt)}</span>
              {item.end ? <Badge tone="red">エンド</Badge> : null}
              {item.order.map((o) => (
                <Badge key={o} tone="blue">
                  {o}
                </Badge>
              ))}
              {item.pop.length ? (
                <Badge tone={item.pop.some((p) => p.size === '競合') ? 'teal' : 'amber'}>
                  POP{formatPopDetails(item.pop)}
                </Badge>
              ) : null}
              {item.genre ? (
                <Badge tone={item.genre === '競合ヘッダー' ? 'teal' : 'blue'}>{item.genre}</Badge>
              ) : null}
              {item.memo ? <Badge tone="plain">{item.memo}</Badge> : null}
              {item.expiry ? (
                <Badge tone={expired ? 'red' : 'amber'}>
                  {expired ? '期限切 ' : '期限 '}
                  {item.expiry}
                </Badge>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            class="btn btn--sm btn--icon"
            aria-label="バーコード拡大"
            onClick={(e) => {
              e.stopPropagation();
              onZoom();
            }}
          >
            🔍
          </button>
        </div>
      </SwipeRow>

      {expanded ? (
        <div class="histrow__edit">
          <div class="row">
            <Field label="商品名" style={{ flex: '1' }}>
              <input
                class="input"
                value={item.name}
                onInput={(e) => updateScan(item.id, { name: (e.currentTarget as HTMLInputElement).value })}
              />
            </Field>
            <Check
              label="学習無効"
              checked={item.noLearn}
              onChange={(noLearn) => updateScan(item.id, { noLearn })}
            />
          </div>

          <div class="row row--tight">
            <Check label="エンド" checked={item.end} onChange={(end) => updateScan(item.id, { end })} />
            <Check
              label="POP"
              checked={item.pop.length > 0}
              onChange={(on) =>
                updateScan(item.id, {
                  pop: on ? [{ size: profile.value.vocab.popSizes[0] ?? '5号', qty: 1, lami: false, enlarge: '', assignee: '' }] : [],
                })
              }
            />
          </div>

          {item.pop.length ? (
            <PopEditor value={item.pop} onChange={(pop) => updateScan(item.id, { pop })} />
          ) : null}

          <div>
            <div class="field__label">発注</div>
            <div class="row row--tight">
              {orderTypes.map((t) => (
                <Check
                  key={t}
                  label={t}
                  checked={item.order.includes(t)}
                  onChange={(on) =>
                    updateScan(item.id, {
                      order: on ? [...item.order, t] : item.order.filter((o) => o !== t),
                    })
                  }
                />
              ))}
            </div>
          </div>

          <div class="row">
            <Field label="ジャンル" style={{ flex: '1' }}>
              <input
                class="input"
                value={item.genre}
                onInput={(e) => updateScan(item.id, { genre: (e.currentTarget as HTMLInputElement).value })}
              />
            </Field>
            <Field label="コメント" style={{ flex: '2' }}>
              <input
                class="input"
                value={item.memo}
                onInput={(e) => updateScan(item.id, { memo: (e.currentTarget as HTMLInputElement).value })}
              />
            </Field>
          </div>

          <div class="row">
            <Field label="箱JAN" style={{ flex: '1' }}>
              <div class="row row--tight">
                <input
                  class="input mono grow"
                  inputMode="numeric"
                  value={item.boxJan}
                  onInput={(e) =>
                    updateScan(item.id, { boxJan: (e.currentTarget as HTMLInputElement).value })
                  }
                  // 確定時に辞書へ学習させる（次から箱コードでバラJANが引ける）
                  onChange={(e) => setBoxJan(item, (e.currentTarget as HTMLInputElement).value)}
                />
                <button
                  type="button"
                  class="btn btn--sm btn--icon"
                  title="箱JANをスキャンで入力"
                  aria-label="箱JANをスキャンで入力"
                  onClick={() =>
                    requestFieldScan({
                      kind: boxScanKind,
                      label: '箱JAN',
                      id: item.id,
                      applyBoxJanLookup: false,
                    })
                  }
                >
                  📷
                </button>
              </div>
            </Field>
            <Field label="期限" style={{ flex: '1' }}>
              <input
                class="input"
                type="date"
                value={item.expiry}
                onChange={(e) => updateScan(item.id, { expiry: (e.currentTarget as HTMLInputElement).value })}
              />
            </Field>
          </div>

          <Field label="登録日時">
            <input
              class="input"
              type="datetime-local"
              value={toLocalInput(item.createdAt)}
              onChange={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value;
                if (v) updateScan(item.id, { createdAt: new Date(v).toISOString() });
              }}
            />
          </Field>

          <div class="row">
            <button type="button" class="btn grow" onClick={onToggleProtect}>
              {item.protected ? '🔓 保護解除' : '🔒 保護する'}
            </button>
            <button
              type="button"
              class="btn btn--danger grow"
              disabled={item.protected}
              onClick={onDelete}
            >
              削除
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * 箱JAN を履歴行に書き、学習辞書へも紐付ける。
 * 辞書に入って初めて `store.boxJanLookup` が効き、次回から箱コードでバラJANが登録される。
 */
function setBoxJan(item: ScanItem, boxJan: string): void {
  const code = boxJan.trim();
  updateScan(item.id, { boxJan: code });
  if (code && item.jan && !item.noLearn) learnProduct(item.jan, { boxJan: code });
}

/** ISO → <input type="datetime-local"> 用のローカル文字列 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
