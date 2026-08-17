/**
 * 棚番長本体のルート。ボトムナビ5タブ [スキャン][リスト][今日][仕分][その他]。
 * 「仕分」だけは別エントリ（./shiwake/）への通常リンク。
 */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import './ui.css';
import { loadAll, settings, setStorageErrorHandler } from './store';
import { navBadges } from './derived';
import { ToastHost, toast } from './components/Toast';
import { MigrationSheet } from './MigrationSheet';
import { ScanTab } from './tabs/ScanTab';
import { ListTab } from './tabs/ListTab';
import { TodayTab } from './tabs/TodayTab';
import { MoreTab } from './tabs/MoreTab';

export type TabKey = 'scan' | 'list' | 'today' | 'more';

export const activeTab = signal<TabKey>('scan');

/** タブ間遷移（他タブのボタンから呼ぶ） */
export function goTab(tab: TabKey): void {
  activeTab.value = tab;
  if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
}

function applyTheme(theme: string): void {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
}

interface NavItem {
  key: TabKey;
  icon: string;
  label: string;
  badge?: number;
}

function BottomNav() {
  const badges = navBadges.value;
  const items: NavItem[] = [
    { key: 'scan', icon: '📷', label: 'スキャン' },
    { key: 'list', icon: '📋', label: 'リスト', badge: badges.list },
    { key: 'today', icon: '📅', label: '今日', badge: badges.today },
  ];
  const current = activeTab.value;
  return (
    <nav class="bottomnav" aria-label="メインナビゲーション">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          class="bottomnav__item"
          aria-current={current === it.key ? 'page' : undefined}
          onClick={() => goTab(it.key)}
        >
          <span class="bottomnav__icon" aria-hidden="true">
            {it.icon}
          </span>
          <span>{it.label}</span>
          {it.badge ? <span class="badge-dot">{it.badge > 99 ? '99+' : it.badge}</span> : null}
        </button>
      ))}
      <a class="bottomnav__item" href="./shiwake/">
        <span class="bottomnav__icon" aria-hidden="true">
          📦
        </span>
        <span>仕分</span>
      </a>
      <button
        type="button"
        class="bottomnav__item"
        aria-current={current === 'more' ? 'page' : undefined}
        onClick={() => goTab('more')}
      >
        <span class="bottomnav__icon" aria-hidden="true">
          ⋯
        </span>
        <span>その他</span>
        {badges.more ? <span class="badge-dot">{badges.more > 99 ? '99+' : badges.more}</span> : null}
      </button>
    </nav>
  );
}

export function App() {
  useEffect(() => {
    loadAll();
    setStorageErrorHandler((msg) => toast(msg, { tone: 'error' }));
    return () => setStorageErrorHandler(null);
  }, []);

  useEffect(() => {
    applyTheme(settings.value.theme);
  }, [settings.value.theme]);

  const tab = activeTab.value;
  return (
    <div class="shell">
      <div class="shell__body">
        {tab === 'scan' ? <ScanTab /> : null}
        {tab === 'list' ? <ListTab /> : null}
        {tab === 'today' ? <TodayTab /> : null}
        {tab === 'more' ? <MoreTab /> : null}
      </div>
      <ToastHost />
      <MigrationSheet />
      <BottomNav />
    </div>
  );
}
