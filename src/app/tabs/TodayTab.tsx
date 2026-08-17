/**
 * 今日タブ。期限 / 客注 / 競合 / 返品 / リマインダーの統合フィード。
 *
 * legacy の checkAlerts は表示と同時に履歴へ unshift していたが、
 * v2 では描画（このコンポーネント）と副作用（ボタン押下）を分離する。
 */
import { nowIso, todayLocal } from '@core/datetime';
import type { ScanItem } from '@core/types';
import { Badge, Card, Empty } from '../components/primitives';
import { toast } from '../components/Toast';
import { goTab } from '../App';
import { todayFeed, type FeedEntry } from '../derived';
import { scanIntent } from '../scan-bridge';
import {
  addScan,
  emptyScan,
  isDuplicateJan,
  updateCustomerOrder,
  updateNote,
  updateReturn,
} from '../store';

const KIND_LABEL: Record<string, string> = {
  expired: '期限切れ',
  'expiry-soon': '期限間近',
  'cust-arrival': '客注・納品',
  'cust-delivery': '客注・受渡',
  comp: '競合',
  return: '返品',
  reminder: 'リマインダー',
};

function addToHistory(jan: string, name: string, genre: string): boolean {
  if (!jan || isDuplicateJan(jan)) return false;
  const item: ScanItem = { ...emptyScan(jan), name, genre };
  addScan(item);
  return true;
}

export function TodayTab() {
  const feed = todayFeed.value;
  const today = todayLocal();

  return (
    <>
      <div class="topbar">
        <span class="topbar__title">
          今日 <span class="topbar__sub">{today}</span>
        </span>
        <span class="muted">{feed.entries.length}件</span>
      </div>

      <div class="chiprow" style={{ margin: '8px 0' }}>
        {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => {
          const n = feed.counts[k as keyof typeof feed.counts] ?? 0;
          if (!n) return null;
          return (
            <span key={k} class="chip chip--sm" aria-pressed={false}>
              {KIND_LABEL[k]} {n}
            </span>
          );
        })}
      </div>

      {feed.entries.length === 0 ? (
        <Empty>今日の予定はありません。</Empty>
      ) : (
        <div class="feed">
          {feed.entries.map((e) => (
            <FeedRow key={e.id} entry={e} />
          ))}
        </div>
      )}

      <Card title="競合対抗確認">
        <p class="muted">
          競合の指定日が来ても履歴には自動追加されません。上のフィードから「履歴に追加」するか、
          スキャンで対抗確認してください。
        </p>
        <button
          type="button"
          class="btn btn--primary btn--block"
          onClick={() => {
            scanIntent.value = 'compCheck';
            goTab('scan');
          }}
        >
          対抗確認モードを開始
        </button>
      </Card>
    </>
  );
}

function FeedRow({ entry }: { entry: FeedEntry }) {
  return (
    <div class="feeditem" data-tone={entry.tone}>
      <div class="feeditem__body">
        <div class="row row--tight">
          <Badge tone={entry.tone === 'danger' ? 'red' : entry.tone === 'warn' ? 'amber' : 'blue'}>
            {KIND_LABEL[entry.kind]}
          </Badge>
        </div>
        <div class="feeditem__title">{entry.title}</div>
        <div class="muted">{entry.detail}</div>
        <div class="row row--tight" style={{ marginTop: '6px' }}>
          <Actions entry={entry} />
        </div>
      </div>
    </div>
  );
}

function Actions({ entry }: { entry: FeedEntry }) {
  if (entry.comp) {
    const c = entry.comp;
    return (
      <button
        type="button"
        class="btn btn--sm"
        onClick={() => {
          const ok = addToHistory(c.jan, c.name, '競合ヘッダー');
          toast(ok ? '履歴に追加しました' : 'JAN未設定または既に履歴にあります', {
            tone: ok ? 'ok' : 'warn',
          });
        }}
      >
        📋 履歴に追加
      </button>
    );
  }
  if (entry.cust) {
    const c = entry.cust;
    return (
      <>
        <button
          type="button"
          class="btn btn--sm"
          aria-pressed={c.called}
          onClick={() => updateCustomerOrder(c.id, { called: !c.called })}
        >
          {c.called ? '☑ 電話済' : '☐ 電話済'}
        </button>
        <button
          type="button"
          class="btn btn--sm"
          disabled={c.addedToHistory}
          onClick={() => {
            const ok = addToHistory(c.jan, c.name, '客注');
            if (ok) updateCustomerOrder(c.id, { addedToHistory: true });
            toast(ok ? '履歴に追加しました' : '既に履歴にあります', { tone: ok ? 'ok' : 'warn' });
          }}
        >
          📋 履歴に追加
        </button>
      </>
    );
  }
  if (entry.ret) {
    const r = entry.ret;
    return (
      <button
        type="button"
        class="btn btn--sm"
        onClick={() => {
          updateReturn(r.id, { dismissed: true });
          toast('返品を確認済みにしました', { tone: 'ok' });
        }}
      >
        ✔ 確認済みにする
      </button>
    );
  }
  if (entry.note) {
    const n = entry.note;
    return (
      <button
        type="button"
        class="btn btn--sm"
        onClick={() => {
          updateNote(n.id, { firedAt: nowIso(), remindAt: undefined });
          toast('リマインダーを完了にしました', { tone: 'ok' });
        }}
      >
        ✔ 完了
      </button>
    );
  }
  if (entry.scan) {
    return (
      <button type="button" class="btn btn--sm" onClick={() => goTab('list')}>
        リストで見る
      </button>
    );
  }
  return null;
}
