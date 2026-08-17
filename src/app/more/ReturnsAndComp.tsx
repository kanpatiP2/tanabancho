/**
 * 返品管理 / 競合ヘッダー登録+一覧。
 */
import { useState } from 'preact/hooks';
import { formatDateOnly, todayLocal } from '@core/datetime';
import type { Competitor, CompetitorReason, ReturnItem } from '@core/types';
import { Badge, Card, Empty, Field, JanText } from '../components/primitives';
import { ConfirmSheet } from '../components/BottomSheet';
import { toast } from '../components/Toast';
import { requestFieldScan, useFieldScan } from '../scan/field-scan';
import {
  addCompetitor,
  addReturn,
  competitors,
  deleteCompetitor,
  deleteReturn,
  products,
  returns,
  stamp,
  updateCompetitor,
  updateReturn,
} from '../store';

const REASONS: CompetitorReason[] = ['ヘッダー変更', '売価変更', '新規導入', '廃番', 'その他'];

export function Returns() {
  const [draft, setDraft] = useState({ jan: '', start: '', end: '', returnDate: '', memo: '' });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const today = todayLocal();

  // v1 の activeSideScanType='return' 相当。返品伝票の JAN は生コードのまま入れる
  useFieldScan('returnJan', (jan) => setDraft({ ...draft, jan }));

  return (
    <>
      <Card title="返品を登録">
        <div class="stack">
          <Field label="JAN">
            <div class="row row--tight">
              <input
                class="input mono grow"
                inputMode="numeric"
                value={draft.jan}
                onInput={(e) => setDraft({ ...draft, jan: (e.currentTarget as HTMLInputElement).value })}
              />
              <button
                type="button"
                class="btn btn--sm btn--icon"
                title="JANをスキャンで入力"
                aria-label="JANをスキャンで入力"
                onClick={() =>
                  requestFieldScan({
                    kind: 'returnJan',
                    label: '返品のJAN',
                    convertItf: false,
                    applyBoxJanLookup: false,
                  })
                }
              >
                📷
              </button>
            </div>
          </Field>
          <div class="row">
            <Field label="受付開始" style={{ flex: '1' }}>
              <input
                class="input"
                type="date"
                value={draft.start}
                onChange={(e) => setDraft({ ...draft, start: (e.currentTarget as HTMLInputElement).value })}
              />
            </Field>
            <Field label="受付終了" style={{ flex: '1' }}>
              <input
                class="input"
                type="date"
                value={draft.end}
                onChange={(e) => setDraft({ ...draft, end: (e.currentTarget as HTMLInputElement).value })}
              />
            </Field>
          </div>
          <div class="row">
            <Field label="返品予定日" style={{ flex: '1' }}>
              <input
                class="input"
                type="date"
                value={draft.returnDate}
                onChange={(e) =>
                  setDraft({ ...draft, returnDate: (e.currentTarget as HTMLInputElement).value })
                }
              />
            </Field>
            <Field label="備考" style={{ flex: '2' }}>
              <input
                class="input"
                value={draft.memo}
                onInput={(e) => setDraft({ ...draft, memo: (e.currentTarget as HTMLInputElement).value })}
              />
            </Field>
          </div>
          <button
            type="button"
            class="btn btn--primary btn--block"
            onClick={() => {
              if (!draft.jan.trim()) {
                toast('JANを入力してください', { tone: 'warn' });
                return;
              }
              const item: ReturnItem = { ...stamp(), ...draft, dismissed: false };
              addReturn(item);
              setDraft({ jan: '', start: '', end: '', returnDate: '', memo: '' });
              toast('返品を登録しました', { tone: 'ok' });
            }}
          >
            登録
          </button>
        </div>
      </Card>

      {returns.value.length === 0 ? (
        <Empty>返品予定はありません。</Empty>
      ) : (
        <div class="stack">
          {returns.value.map((r) => (
            <div key={r.id} class="card">
              <div class="row">
                <div class="grow">
                  <div class="histrow__code">
                    <JanText jan={r.jan} />
                  </div>
                  <div class="muted">{products.value[r.jan]?.name || '（名称未登録）'}</div>
                </div>
                <button type="button" class="btn btn--sm btn--danger" onClick={() => setDeleteId(r.id)}>
                  削除
                </button>
              </div>
              <div class="histrow__meta">
                {r.start || r.end ? (
                  <Badge tone={r.end && r.end < today ? 'red' : 'amber'}>
                    受付 {formatDateOnly(r.start)}〜{formatDateOnly(r.end)}
                  </Badge>
                ) : null}
                {r.returnDate ? <Badge tone="blue">返品予定 {formatDateOnly(r.returnDate)}</Badge> : null}
                {r.dismissed ? <Badge tone="plain">確認済</Badge> : null}
                {r.memo ? <Badge tone="plain">{r.memo}</Badge> : null}
              </div>
              <button
                type="button"
                class="btn btn--sm"
                style={{ marginTop: '6px' }}
                onClick={() => updateReturn(r.id, { dismissed: !r.dismissed })}
              >
                {r.dismissed ? '未確認に戻す' : '✔ 確認済みにする'}
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmSheet
        open={Boolean(deleteId)}
        title="返品を削除"
        danger
        confirmLabel="削除する"
        message="この返品予定を削除します。"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteReturn(deleteId);
          setDeleteId(null);
          toast('削除しました');
        }}
      />
    </>
  );
}

export function Competitors() {
  const [draft, setDraft] = useState<{ date: string; jan: string; name: string; reason: CompetitorReason; memo: string }>({
    date: todayLocal(),
    jan: '',
    name: '',
    reason: 'ヘッダー変更',
    memo: '',
  });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // v1 の activeCompScan 相当。ITF-14 変換・箱JAN→バラJAN 置換はどちらも効かせる
  useFieldScan('compJan', (jan) => {
    const known = products.value[jan]?.name;
    setDraft({ ...draft, jan, name: known && !draft.name ? known : draft.name });
  });

  return (
    <>
      <Card title="競合ヘッダーを登録">
        <div class="stack">
          <div class="row">
            <Field label="実施日" style={{ flex: '1' }}>
              <input
                class="input"
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: (e.currentTarget as HTMLInputElement).value })}
              />
            </Field>
            <Field label="種別" style={{ flex: '1' }}>
              <select
                class="select"
                value={draft.reason}
                onChange={(e) =>
                  setDraft({ ...draft, reason: (e.currentTarget as HTMLSelectElement).value as CompetitorReason })
                }
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="JAN">
            <div class="row row--tight">
              <input
                class="input mono grow"
                inputMode="numeric"
                value={draft.jan}
                onInput={(e) => {
                  const jan = (e.currentTarget as HTMLInputElement).value;
                  const known = products.value[jan]?.name;
                  setDraft({ ...draft, jan, name: known && !draft.name ? known : draft.name });
                }}
              />
              <button
                type="button"
                class="btn btn--sm btn--icon"
                title="JANをスキャンで入力"
                aria-label="JANをスキャンで入力"
                onClick={() => requestFieldScan({ kind: 'compJan', label: '競合商品のJAN' })}
              >
                📷
              </button>
            </div>
          </Field>
          <Field label="商品名">
            <input
              class="input"
              value={draft.name}
              onInput={(e) => setDraft({ ...draft, name: (e.currentTarget as HTMLInputElement).value })}
            />
          </Field>
          <Field label="備考">
            <input
              class="input"
              value={draft.memo}
              onInput={(e) => setDraft({ ...draft, memo: (e.currentTarget as HTMLInputElement).value })}
            />
          </Field>
          <button
            type="button"
            class="btn btn--primary btn--block"
            onClick={() => {
              if (!draft.jan.trim() && !draft.name.trim()) {
                toast('JANまたは商品名を入力してください', { tone: 'warn' });
                return;
              }
              const item: Competitor = { ...stamp(), ...draft, dismissed: false };
              addCompetitor(item);
              setDraft({ date: todayLocal(), jan: '', name: '', reason: 'ヘッダー変更', memo: '' });
              toast('競合予定を登録しました', { tone: 'ok' });
            }}
          >
            登録
          </button>
        </div>
      </Card>

      {competitors.value.length === 0 ? (
        <Empty>競合予定はありません。</Empty>
      ) : (
        <div class="stack">
          {competitors.value.map((c) => (
            <div key={c.id} class="card">
              <div class="row">
                <div class="grow">
                  <div class="histrow__name">{c.name || '（名称未設定）'}</div>
                  <div class="muted">
                    <JanText jan={c.jan} />
                  </div>
                </div>
                <button type="button" class="btn btn--sm btn--danger" onClick={() => setDeleteId(c.id)}>
                  削除
                </button>
              </div>
              <div class="histrow__meta">
                <Badge tone={c.date === todayLocal() ? 'red' : 'blue'}>{formatDateOnly(c.date)}</Badge>
                <Badge tone="amber">{c.reason}</Badge>
                {c.memo ? <Badge tone="plain">{c.memo}</Badge> : null}
              </div>
              <Field label="実施日を変更">
                <input
                  class="input"
                  type="date"
                  value={c.date}
                  onChange={(e) =>
                    updateCompetitor(c.id, { date: (e.currentTarget as HTMLInputElement).value })
                  }
                />
              </Field>
            </div>
          ))}
        </div>
      )}

      <ConfirmSheet
        open={Boolean(deleteId)}
        title="競合予定を削除"
        danger
        confirmLabel="削除する"
        message="この競合予定を削除します。"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteCompetitor(deleteId);
          setDeleteId(null);
          toast('削除しました');
        }}
      />
    </>
  );
}
