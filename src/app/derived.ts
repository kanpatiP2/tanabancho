/**
 * signal から導出する読み取り専用の集計（描画と副作用の分離のため、ここでは一切保存しない）。
 * legacy の checkAlerts は「表示」と「履歴 unshift」が混ざっていたが、
 * v2 では表示（この feed）と副作用（ボタン押下でのみ実行）を分ける。
 */
import { computed } from '@preact/signals';
import { addDays, todayLocal } from '@core/datetime';
import type { Competitor, CustomerOrder, Note, ReturnItem, ScanItem } from '@core/types';
import { competitors, customerOrders, notes, returns, scans } from './store';

export type FeedKind = 'expired' | 'expiry-soon' | 'cust-arrival' | 'cust-delivery' | 'comp' | 'return' | 'reminder';
export type FeedTone = 'danger' | 'warn' | 'info' | 'ok';

export interface FeedEntry {
  id: string;
  kind: FeedKind;
  tone: FeedTone;
  title: string;
  detail: string;
  /** 元データの参照（アクションボタンが使う） */
  scan?: ScanItem;
  cust?: CustomerOrder;
  comp?: Competitor;
  ret?: ReturnItem;
  note?: Note;
}

export interface TodayFeed {
  entries: FeedEntry[];
  counts: Record<FeedKind, number>;
}

function emptyCounts(): Record<FeedKind, number> {
  return {
    expired: 0,
    'expiry-soon': 0,
    'cust-arrival': 0,
    'cust-delivery': 0,
    comp: 0,
    return: 0,
    reminder: 0,
  };
}

export function buildTodayFeed(
  input: {
    scans: ScanItem[];
    cust: CustomerOrder[];
    comp: Competitor[];
    returns: ReturnItem[];
    notes: Note[];
  },
  now: Date = new Date(),
): TodayFeed {
  const today = todayLocal(now);
  const tomorrow = addDays(today, 1);
  const nowMs = now.getTime();
  const entries: FeedEntry[] = [];
  const counts = emptyCounts();

  const push = (e: FeedEntry) => {
    entries.push(e);
    counts[e.kind]++;
  };

  for (const s of input.scans) {
    if (!s.expiry) continue;
    if (s.expiry < today) {
      push({
        id: `exp-${s.id}`,
        kind: 'expired',
        tone: 'danger',
        title: s.name || s.jan,
        detail: `期限切れ ${s.expiry}`,
        scan: s,
      });
    } else if (s.expiry === today || s.expiry === tomorrow) {
      push({
        id: `exps-${s.id}`,
        kind: 'expiry-soon',
        tone: 'warn',
        title: s.name || s.jan,
        detail: s.expiry === today ? `本日期限 ${s.expiry}` : `明日期限 ${s.expiry}`,
        scan: s,
      });
    }
  }

  for (const c of input.cust) {
    if (c.arrivalDate === today) {
      push({
        id: `cua-${c.id}`,
        kind: 'cust-arrival',
        tone: 'info',
        title: c.name || c.jan,
        detail: `本日納品 / ${c.qty}個${c.memo ? ` / ${c.memo}` : ''}`,
        cust: c,
      });
    }
    if (c.deliveryDate === today) {
      push({
        id: `cud-${c.id}`,
        kind: 'cust-delivery',
        tone: 'ok',
        title: c.name || c.jan,
        detail: `本日受渡${c.deliveryTime ? ` ${c.deliveryTime}` : ''}${c.phone ? ` / ${c.phone}` : ''}`,
        cust: c,
      });
    }
  }

  for (const c of input.comp) {
    if (c.date === today || c.date === tomorrow) {
      push({
        id: `cmp-${c.id}`,
        kind: 'comp',
        tone: c.date === today ? 'danger' : 'warn',
        title: c.name || c.jan || '(名称未設定)',
        detail: `${c.date === today ? '本日' : '明日'} ${c.reason}${c.memo ? ` / ${c.memo}` : ''}`,
        comp: c,
      });
    }
  }

  for (const r of input.returns) {
    if (!r.end) continue;
    // 受付終了が今日を含む 3 日以内、または返品予定日が今日
    if ((r.end >= today && r.end <= addDays(today, 3)) || r.returnDate === today) {
      push({
        id: `ret-${r.id}`,
        kind: 'return',
        tone: r.end === today ? 'danger' : 'warn',
        title: r.jan || '(JAN未設定)',
        detail: `返品受付 〜${r.end}${r.memo ? ` / ${r.memo}` : ''}`,
        ret: r,
      });
    }
  }

  for (const n of input.notes) {
    if (!n.remindAt) continue;
    if (Date.parse(n.remindAt) <= nowMs) {
      push({
        id: `rem-${n.id}`,
        kind: 'reminder',
        tone: n.firedAt ? 'info' : 'warn',
        title: n.title || '(無題のノート)',
        detail: n.text.slice(0, 60) || 'リマインダー',
        note: n,
      });
    }
  }

  const order: FeedKind[] = [
    'expired',
    'comp',
    'cust-delivery',
    'cust-arrival',
    'return',
    'reminder',
    'expiry-soon',
  ];
  entries.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return { entries, counts };
}

export const todayFeed = computed<TodayFeed>(() =>
  buildTodayFeed({
    scans: scans.value,
    cust: customerOrders.value,
    comp: competitors.value,
    returns: returns.value,
    notes: notes.value,
  }),
);

/** ボトムナビのバッジ件数 */
export const navBadges = computed(() => {
  const feed = todayFeed.value;
  const pendingCust = customerOrders.value.filter((c) => !c.ordered || !c.addedToHistory).length;
  return {
    today: feed.entries.length,
    list: scans.value.length,
    more: pendingCust,
  };
});

/** 履歴のソート（settings.historySort） */
export function sortScans(items: ScanItem[], mode: string): ScanItem[] {
  const out = [...items];
  switch (mode) {
    case 'oldest':
      return out.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    case 'genre':
      return out.sort((a, b) => (a.genre || '').localeCompare(b.genre || '', 'ja'));
    case 'name':
      return out.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
    default:
      return out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
}

/** 一括削除「昨日まで」— createdAt 基準（legacy の id パースバグは踏襲しない） */
export function idsCreatedBefore(items: ScanItem[], boundary: string): string[] {
  const cut = Date.parse(`${boundary}T00:00:00`);
  return items.filter((s) => Date.parse(s.createdAt) < cut).map((s) => s.id);
}
