/**
 * 発注リスト画面。行 = jan / 名前 / 数量± / スワイプ削除。
 * 「QR出力」で全画面の OrderQrScreen（src/order-export/ を使う）へ。
 */
import { useEffect, useState } from 'preact/hooks';
import { batchCount, isFullyExported, toJanLines } from '@order-export/payload';
import { BottomSheet } from '../components/BottomSheet';
import { Badge, Empty, JanText, Stepper } from '../components/primitives';
import { toastUndo } from '../components/Toast';
import { SwipeRow } from '../components/SwipeRow';
import { OrderQrScreen } from './OrderQrScreen';
import {
  bumpOrderLine,
  orderLists,
  products,
  removeOrderLine,
  restoreOrderLine,
  settings,
} from '../store';

export function OrderListScreen({ listId, open, onClose }: { listId: string; open: boolean; onClose: () => void }) {
  const [qrOpen, setQrOpen] = useState(false);
  const list = orderLists.value.find((o) => o.id === listId);

  // リストを閉じたら QR 画面も畳む（次に開いたとき勝手に QR が出ないように）
  useEffect(() => {
    if (!open) setQrOpen(false);
  }, [open]);

  const batchSize = settings.value.qrBatchSize;
  const lineCount = toJanLines(list).length;
  const total = batchCount(lineCount, batchSize);
  const doneCount = (list?.exportedBatches ?? []).filter((n) => n >= 0 && n < total).length;
  const exported = isFullyExported(list?.exportedBatches, lineCount, batchSize);

  return (
    <>
      <BottomSheet
        open={open}
        title={`発注リスト${list ? `（${list.label}）` : ''}`}
        onClose={onClose}
        footer={
          <>
            <button type="button" class="btn grow" onClick={onClose}>
              閉じる
            </button>
            <button
              type="button"
              class="btn btn--primary grow"
              disabled={lineCount === 0}
              onClick={() => setQrOpen(true)}
            >
              QR出力
            </button>
          </>
        }
      >
        {!list || list.lines.length === 0 ? (
          <Empty>まだ発注がありません。発注モードでスキャンすると追加されます。</Empty>
        ) : (
          <>
            <div class="summary-line" style={{ marginBottom: '8px' }}>
              {lineCount}件 / QR {total}バッチ（{batchSize}件ずつ）
              {exported ? (
                <>
                  {' '}
                  <Badge tone="teal">出力済</Badge>
                </>
              ) : doneCount > 0 ? (
                <>
                  {' '}
                  <Badge tone="amber">
                    読取済 {doneCount}/{total}
                  </Badge>
                </>
              ) : null}
            </div>
            <ul class="histlist">
              {list.lines.map((line, index) => (
                <li key={line.jan}>
                  <SwipeRow
                    onSwipeLeft={null}
                    onSwipeRight={() => {
                      removeOrderLine(list.id, line.jan);
                      toastUndo(`${line.jan} を削除しました`, () =>
                        restoreOrderLine(list.id, line.jan, line.qty, index),
                      );
                    }}
                    rightLabel="削除"
                    leftLabel=""
                  >
                    <div class="histrow__head" style={{ cursor: 'default' }}>
                      <div class="grow">
                        <div class="histrow__code">
                          <JanText jan={line.jan} />
                        </div>
                        <div class="muted">{products.value[line.jan]?.name || '（名称未登録）'}</div>
                      </div>
                      <Stepper
                        value={line.qty}
                        min={0}
                        max={999}
                        onChange={(qty) => bumpOrderLine(list.id, line.jan, qty - line.qty)}
                      />
                    </div>
                  </SwipeRow>
                </li>
              ))}
            </ul>
          </>
        )}
      </BottomSheet>

      <OrderQrScreen listId={listId} open={open && qrOpen} onClose={() => setQrOpen(false)} />
    </>
  );
}
