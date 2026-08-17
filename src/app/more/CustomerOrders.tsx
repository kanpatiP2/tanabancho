/**
 * 客注管理。全項目（jan/名前/個数/ケース/納品日/受渡日+時間帯/電話/到着時電話/対応済/発注済/備考）。
 * ソート2種（settings.custSort）、インライン編集、バーコード表示、履歴追加。
 */
import { useState } from 'preact/hooks';
import { formatDateOnly } from '@core/datetime';
import type { CustomerOrder, DeliveryTime, ScanItem, Settings } from '@core/types';
import { Badge, Card, Check, Empty, Field, JanText } from '../components/primitives';
import { BottomSheet, ConfirmSheet } from '../components/BottomSheet';
import { Barcode } from '../components/Barcode';
import { toast } from '../components/Toast';
import { requestFieldScan, useFieldScan } from '../scan/field-scan';
import {
  addCustomerOrder,
  addScan,
  customerOrders,
  deleteCustomerOrder,
  emptyScan,
  isDuplicateJan,
  products,
  settings,
  stamp,
  updateCustomerOrder,
  updateSettings,
} from '../store';
import { sortCustomerOrders } from './sorting';

const TIMES: DeliveryTime[] = ['', '開店', '午前', '午後', '夕方', '夜'];

function blank(): CustomerOrder {
  return {
    ...stamp(),
    jan: '',
    name: '',
    qty: 1,
    caseQty: 0,
    ordered: false,
    arrivalDate: '',
    deliveryDate: '',
    deliveryTime: '',
    phone: '',
    willCall: false,
    called: false,
    memo: '',
    dismissedArrival: false,
    dismissedDelivery: false,
    addedToHistory: false,
  };
}

export function CustomerOrders() {
  const [draft, setDraft] = useState<CustomerOrder>(blank());
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [barcodeOf, setBarcodeOf] = useState<CustomerOrder | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const list = sortCustomerOrders(customerOrders.value, settings.value.custSort);

  const submit = () => {
    if (!draft.jan.trim()) {
      toast('JANを入力してください', { tone: 'warn' });
      return;
    }
    addCustomerOrder({
      ...draft,
      name: draft.name || products.value[draft.jan]?.name || '',
    });
    setDraft(blank());
    setFormOpen(false);
    toast('客注を登録しました', { tone: 'ok' });
  };

  return (
    <>
      <Card
        title="客注"
        action={
          <select
            class="select"
            style={{ width: 'auto', minHeight: '36px' }}
            value={settings.value.custSort}
            onChange={(e) =>
              updateSettings({ custSort: (e.currentTarget as HTMLSelectElement).value as Settings['custSort'] })
            }
          >
            <option value="arrival">納品日順</option>
            <option value="delivery">受渡日順</option>
          </select>
        }
      >
        <button type="button" class="btn btn--primary btn--block" onClick={() => setFormOpen(true)}>
          ＋ 客注を登録
        </button>
      </Card>

      {list.length === 0 ? (
        <Empty>客注はありません。</Empty>
      ) : (
        <div class="stack">
          {list.map((c) => (
            <div key={c.id} class="card">
              <div class="row">
                <div class="grow">
                  <div class="histrow__code">
                    <JanText jan={c.jan} />
                  </div>
                  <div class="histrow__name">{c.name || '（名称未登録）'}</div>
                </div>
                <button type="button" class="btn btn--sm btn--icon" onClick={() => setBarcodeOf(c)}>
                  🔍
                </button>
                <button
                  type="button"
                  class="btn btn--sm btn--icon"
                  onClick={() => setEditId(editId === c.id ? null : c.id)}
                >
                  ✏️
                </button>
              </div>
              <div class="histrow__meta">
                <Badge tone="plain">{c.qty}個</Badge>
                {c.caseQty ? <Badge tone="plain">{c.caseQty}ケース</Badge> : null}
                {c.arrivalDate ? <Badge tone="blue">納品 {formatDateOnly(c.arrivalDate)}</Badge> : null}
                {c.deliveryDate ? (
                  <Badge tone="teal">
                    受渡 {formatDateOnly(c.deliveryDate)}
                    {c.deliveryTime ? ` ${c.deliveryTime}` : ''}
                  </Badge>
                ) : null}
                {c.phone ? <Badge tone="plain">☎ {c.phone}</Badge> : null}
                {c.willCall ? <Badge tone="amber">到着時電話</Badge> : null}
                {c.memo ? <Badge tone="plain">{c.memo}</Badge> : null}
              </div>
              <div class="row row--tight" style={{ marginTop: '6px' }}>
                <Check
                  label="発注済"
                  checked={c.ordered}
                  onChange={(ordered) => updateCustomerOrder(c.id, { ordered })}
                />
                <Check
                  label="電話済"
                  checked={c.called}
                  onChange={(called) => updateCustomerOrder(c.id, { called })}
                />
                <button
                  type="button"
                  class="btn btn--sm"
                  disabled={c.addedToHistory}
                  onClick={() => {
                    if (!c.jan || isDuplicateJan(c.jan)) {
                      toast('既に履歴にあります', { tone: 'warn' });
                      return;
                    }
                    const item: ScanItem = {
                      ...emptyScan(c.jan),
                      name: c.name,
                      memo: c.memo,
                      genre: '客注',
                    };
                    addScan(item);
                    updateCustomerOrder(c.id, { addedToHistory: true });
                    toast('履歴に追加しました', { tone: 'ok' });
                  }}
                >
                  📋 履歴へ
                </button>
                <button type="button" class="btn btn--sm btn--danger" onClick={() => setDeleteId(c.id)}>
                  削除
                </button>
              </div>

              {editId === c.id ? (
                <div class="histrow__edit" style={{ marginTop: '8px' }}>
                  <CustFields
                    value={c}
                    scanKey={c.id}
                    onChange={(patch) => updateCustomerOrder(c.id, patch)}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <BottomSheet
        open={formOpen}
        title="客注を登録"
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" class="btn grow" onClick={() => setFormOpen(false)}>
              キャンセル
            </button>
            <button type="button" class="btn btn--primary grow" onClick={submit}>
              登録
            </button>
          </>
        }
      >
        <CustFields
          value={draft}
          scanKey="new"
          onChange={(patch) => setDraft({ ...draft, ...patch })}
        />
      </BottomSheet>

      <BottomSheet
        open={Boolean(barcodeOf)}
        title={barcodeOf?.name || 'バーコード'}
        onClose={() => setBarcodeOf(null)}
      >
        {barcodeOf ? (
          <div style={{ textAlign: 'center' }}>
            <Barcode code={barcodeOf.jan} />
          </div>
        ) : null}
      </BottomSheet>

      <ConfirmSheet
        open={Boolean(deleteId)}
        title="客注を削除"
        danger
        confirmLabel="削除する"
        message="この客注を削除します。"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteCustomerOrder(deleteId);
          setDeleteId(null);
          toast('削除しました');
        }}
      />
    </>
  );
}

function CustFields({
  value,
  scanKey,
  onChange,
}: {
  value: CustomerOrder;
  /** 「スキャンで入力」の宛先識別子。新規フォームと行内編集が同時に出るため一意にする */
  scanKey: string;
  onChange: (patch: Partial<CustomerOrder>) => void;
}) {
  // v1 の activeSideScanType='cust' 相当。客注伝票の JAN は生コードのまま入れる
  const kind = `custJan:${scanKey}`;
  useFieldScan(kind, (jan) => onChange({ jan }));

  return (
    <div class="stack">
      <div class="row">
        <Field label="JAN" style={{ flex: '2' }}>
          <div class="row row--tight">
            <input
              class="input mono grow"
              inputMode="numeric"
              value={value.jan}
              onInput={(e) => onChange({ jan: (e.currentTarget as HTMLInputElement).value })}
            />
            <button
              type="button"
              class="btn btn--sm btn--icon"
              title="JANをスキャンで入力"
              aria-label="JANをスキャンで入力"
              onClick={() =>
                requestFieldScan({
                  kind,
                  label: '客注のJAN',
                  convertItf: false,
                  applyBoxJanLookup: false,
                })
              }
            >
              📷
            </button>
          </div>
        </Field>
        <Field label="個数" style={{ flex: '1' }}>
          <input
            class="input"
            type="number"
            min="1"
            value={value.qty}
            onInput={(e) => onChange({ qty: Number((e.currentTarget as HTMLInputElement).value) || 1 })}
          />
        </Field>
        <Field label="ケース" style={{ flex: '1' }}>
          <input
            class="input"
            type="number"
            min="0"
            value={value.caseQty}
            onInput={(e) => onChange({ caseQty: Number((e.currentTarget as HTMLInputElement).value) || 0 })}
          />
        </Field>
      </div>
      <Field label="商品名">
        <input
          class="input"
          value={value.name}
          onInput={(e) => onChange({ name: (e.currentTarget as HTMLInputElement).value })}
        />
      </Field>
      <div class="row">
        <Field label="納品日" style={{ flex: '1' }}>
          <input
            class="input"
            type="date"
            value={value.arrivalDate}
            onChange={(e) => onChange({ arrivalDate: (e.currentTarget as HTMLInputElement).value })}
          />
        </Field>
        <Field label="受渡日" style={{ flex: '1' }}>
          <input
            class="input"
            type="date"
            value={value.deliveryDate}
            onChange={(e) => onChange({ deliveryDate: (e.currentTarget as HTMLInputElement).value })}
          />
        </Field>
      </div>
      <div>
        <div class="field__label">受渡時間帯</div>
        <div class="chiprow">
          {TIMES.map((t) => (
            <button
              key={t || 'none'}
              type="button"
              class="chip chip--sm"
              aria-pressed={value.deliveryTime === t}
              onClick={() => onChange({ deliveryTime: t })}
            >
              {t || '指定なし'}
            </button>
          ))}
        </div>
        <input
          class="input"
          type="time"
          style={{ marginTop: '6px' }}
          value={/^\d{1,2}:\d{2}$/.test(String(value.deliveryTime)) ? String(value.deliveryTime) : ''}
          onChange={(e) =>
            onChange({ deliveryTime: (e.currentTarget as HTMLInputElement).value as DeliveryTime })
          }
        />
      </div>
      <div class="row">
        <Field label="電話番号" style={{ flex: '1' }}>
          <input
            class="input"
            type="tel"
            value={value.phone}
            onInput={(e) => onChange({ phone: (e.currentTarget as HTMLInputElement).value })}
          />
        </Field>
      </div>
      <div class="row row--tight">
        <Check
          label="到着時に電話"
          checked={value.willCall}
          onChange={(willCall) => onChange({ willCall })}
        />
        <Check label="電話対応済" checked={value.called} onChange={(called) => onChange({ called })} />
        <Check label="発注済" checked={value.ordered} onChange={(ordered) => onChange({ ordered })} />
      </div>
      <Field label="備考">
        <textarea
          class="textarea"
          value={value.memo}
          onInput={(e) => onChange({ memo: (e.currentTarget as HTMLTextAreaElement).value })}
        />
      </Field>
    </div>
  );
}
