/**
 * 発注リスト画面。行 = jan / 名前 / 数量± / スワイプ削除。
 * QR 出力は P3-F（src/order-export/）接続まで「準備中」。
 */
import { useState } from 'preact/hooks';
import { BottomSheet } from '../components/BottomSheet';
import { Empty, JanText, Pending, Stepper } from '../components/primitives';
import { toastUndo } from '../components/Toast';
import { SwipeRow } from '../components/SwipeRow';
import {
  bumpOrderLine,
  orderLists,
  products,
  removeOrderLine,
  restoreOrderLine,
  settings,
} from '../store';

export function OrderListScreen({ listId, open, onClose }: { listId: string; open: boolean; onClose: () => void }) {
  const [confirmQr, setConfirmQr] = useState(false);
  const list = orderLists.value.find((o) => o.id === listId);

  return (
    <BottomSheet
      open={open}
      title={`発注リスト${list ? `（${list.label}）` : ''}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" class="btn grow" onClick={onClose}>
            閉じる
          </button>
          <button type="button" class="btn btn--primary grow" onClick={() => setConfirmQr(true)}>
            QR出力
          </button>
        </>
      }
    >
      {!list || list.lines.length === 0 ? (
        <Empty>まだ発注がありません。発注モードでスキャンすると追加されます。</Empty>
      ) : (
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
      )}

      <BottomSheet open={confirmQr} title="QR出力" onClose={() => setConfirmQr(false)}>
        <p>
          発注リストの QR/ESP32 出力は <Pending>P3-F の order-export 接続待ち</Pending> です。
        </p>
        <p class="muted">
          バッチサイズ {settings.value.qrBatchSize} 件 / 行末 {settings.value.exportEol} の設定は
          「その他 &gt; 設定」で変更できます。
        </p>
      </BottomSheet>
    </BottomSheet>
  );
}
