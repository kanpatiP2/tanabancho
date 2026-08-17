/**
 * その他タブ。メニュー → 各管理画面。
 */
import { useState } from 'preact/hooks';
import { CustomerOrders } from '../more/CustomerOrders';
import { Competitors, Returns } from '../more/ReturnsAndComp';
import { DictManager } from '../more/DictManager';
import { Notes } from '../more/Notes';
import { DataManager } from '../more/DataManager';
import { SettingsPanel } from '../more/SettingsPanel';
import { competitors, customerOrders, notes, products, profile, returns } from '../store';

type Section = 'cust' | 'return' | 'comp' | 'dict' | 'notes' | 'data' | 'settings';

const TITLES: Record<Section, string> = {
  cust: '客注管理',
  return: '返品管理',
  comp: '競合ヘッダー',
  dict: '学習辞書',
  notes: 'ノート',
  data: 'データ管理',
  settings: '設定',
};

export function MoreTab() {
  const [section, setSection] = useState<Section | null>(null);

  if (section) {
    return (
      <>
        <div class="topbar">
          <button type="button" class="btn btn--sm btn--ghost" onClick={() => setSection(null)}>
            ‹ 戻る
          </button>
          <span class="topbar__title">{TITLES[section]}</span>
        </div>
        {section === 'cust' ? <CustomerOrders /> : null}
        {section === 'return' ? <Returns /> : null}
        {section === 'comp' ? <Competitors /> : null}
        {section === 'dict' ? <DictManager /> : null}
        {section === 'notes' ? <Notes /> : null}
        {section === 'data' ? <DataManager /> : null}
        {section === 'settings' ? <SettingsPanel /> : null}
      </>
    );
  }

  const items: { key: Section; icon: string; count?: number }[] = [
    { key: 'cust', icon: '🧾', count: customerOrders.value.length },
    { key: 'return', icon: '↩️', count: returns.value.length },
    { key: 'comp', icon: '🏪', count: competitors.value.length },
    { key: 'dict', icon: '📚', count: Object.keys(products.value).length },
    ...(profile.value.features.notes
      ? [{ key: 'notes' as Section, icon: '📝', count: notes.value.length }]
      : []),
    { key: 'data', icon: '💾' },
    { key: 'settings', icon: '⚙️' },
  ];

  return (
    <>
      <div class="topbar">
        <span class="topbar__title">
          その他 <span class="topbar__sub">{profile.value.label}</span>
        </span>
      </div>
      <div class="menulist" style={{ marginTop: '8px' }}>
        {items.map((it) => (
          <button key={it.key} type="button" class="menuitem" onClick={() => setSection(it.key)}>
            <span class="menuitem__icon" aria-hidden="true">
              {it.icon}
            </span>
            <span class="grow">{TITLES[it.key]}</span>
            {it.count !== undefined ? <span class="muted">{it.count}件</span> : null}
            <span class="menuitem__chev">›</span>
          </button>
        ))}
        <a class="menuitem" href="./shiwake/">
          <span class="menuitem__icon" aria-hidden="true">
            📦
          </span>
          <span class="grow">仕分番長をひらく</span>
          <span class="menuitem__chev">›</span>
        </a>
      </div>
    </>
  );
}
