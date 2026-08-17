import { useState } from 'preact/hooks';
import { diffDays, formatDateOnly, todayLocal } from '@core/datetime';
import type { ShareSlimItem } from '@core/types';
import { receiveError, receiveWarnings, received } from './state';
import { BarcodeModal } from './BarcodeModal';

function popLabel(item: ShareSlimItem): string {
  const pd = item.pd ?? [];
  if (pd.length === 0) return 'POP';
  return `POP ${pd.map((d) => `${d.size || '?'}×${d.qty}${d.lami ? 'ラミ' : ''}${d.enlarge ? `/${d.enlarge}` : ''}`).join(' ')}`;
}

function expiryLabel(x: string): { text: string; urgent: boolean } {
  const days = diffDays(todayLocal(), x);
  const suffix = Number.isNaN(days) ? '' : days < 0 ? '（期限切れ）' : days === 0 ? '（本日）' : `（あと${days}日）`;
  return { text: `期限 ${formatDateOnly(x)}${suffix}`, urgent: !Number.isNaN(days) && days <= 2 };
}

/** 受信データの一覧。描画はすべて JSX（innerHTML は使わない） */
export function RecvTab() {
  const [zoom, setZoom] = useState(-1);
  const env = received.value;
  const items = env?.items ?? [];

  const modalItems = items.map((i) => ({
    code: i.c,
    name: i.n,
    meta: [i.g, ...(i.o ?? []), i.p ? 'POP' : '', i.e ? 'エンド' : '', i.m, i.x ? `期限 ${formatDateOnly(i.x)}` : '']
      .filter(Boolean)
      .join('  '),
  }));

  return (
    <div class="sv-panel">
      <div class="sv-card">
        <h2>受信データ</h2>
        {receiveError.value ? (
          <p class="sv-error">{receiveError.value}</p>
        ) : items.length === 0 ? (
          <p class="sv-desc">メインツールから送られたURLを開くと、ここにデータが表示されます。</p>
        ) : (
          <p class="sv-desc">
            {items.length}件を受信しています。タップするとバーコードを拡大表示できます。
          </p>
        )}
        {receiveWarnings.value > 0 ? (
          <p class="sv-warn">
            読み取れない項目が {receiveWarnings.value} 件あったため除外しました。送信元で件数を減らして再送信すると改善する場合があります。
          </p>
        ) : null}
      </div>

      {items.length === 0 ? null : (
        <div class="sv-list">
          {items.map((item, i) => {
            const orders = item.o ?? [];
            const expiry = item.x ? expiryLabel(item.x) : null;
            return (
              <button type="button" class="sv-item sv-item--recv" key={item.id} onClick={() => setZoom(i)}>
                <span class="sv-code">{item.c}</span>
                {item.n ? <span class="sv-name">{item.n}</span> : null}
                <span class="sv-badges">
                  {item.g ? <span class="sv-badge sv-badge--genre">{item.g}</span> : null}
                  {item.p ? <span class="sv-badge sv-badge--pop">{popLabel(item)}</span> : null}
                  {orders.map((o, k) => (
                    <span class="sv-badge sv-badge--order" key={`${o}-${k}`}>
                      {o}
                    </span>
                  ))}
                  {item.e ? <span class="sv-badge sv-badge--end">エンド</span> : null}
                  {expiry ? (
                    <span class={`sv-badge${expiry.urgent ? ' sv-badge--expiry' : ''}`}>{expiry.text}</span>
                  ) : null}
                  {item.t ? <span class="sv-sub">{item.t}</span> : null}
                </span>
                {item.m ? <span class="sv-sub">{item.m}</span> : null}
              </button>
            );
          })}
        </div>
      )}

      {zoom >= 0 && modalItems[zoom] ? (
        <BarcodeModal items={modalItems} index={zoom} onNavigate={setZoom} onClose={() => setZoom(-1)} />
      ) : null}
    </div>
  );
}
