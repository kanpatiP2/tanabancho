import { useEffect } from 'preact/hooks';
import './share.css';
import { initShareState, isLineOnIos, readUrlPayload, received, scanned, tab } from './state';
import type { ShareTab } from './state';
import { ScanTab } from './ScanTab';
import { SendTab } from './SendTab';
import { RecvTab } from './RecvTab';
import { Toast } from './Toast';

// URL の解釈は同期で済ませる（?from=main のとき最初から受信タブを開くため）
if (typeof location !== 'undefined') readUrlPayload(location.href);

const TABS: { key: ShareTab; label: string }[] = [
  { key: 'scan', label: 'スキャン' },
  { key: 'send', label: '送信' },
  { key: 'recv', label: '受信表示' },
];

function openInSafari(): void {
  // LINE の iOS 内蔵ブラウザから Safari を開く
  location.href = `x-safari-${location.href}`;
}

/** 共有ビューのルート。スキャン / 送信 / 受信表示の3タブ */
export function ShareApp() {
  useEffect(() => {
    initShareState();
  }, []);

  const active = tab.value;
  const recvCount = received.value?.items.length ?? 0;

  return (
    <>
      {isLineOnIos.value ? (
        <div class="sv-banner">
          <strong>LINEアプリ内ではカメラが使えない場合があります</strong>
          <button type="button" class="sv-btn" onClick={openInSafari}>
            Safariで開く
          </button>
        </div>
      ) : null}

      <div class="sv-top">
        <header class="sv-header">
          <span class="sv-title">棚番長 — 共有</span>
          <span class="sv-count">スキャン {scanned.value.length}件</span>
        </header>

        <nav class="sv-tabs" role="tablist" aria-label="共有ビューの表示切替">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              class="sv-tab"
              aria-selected={active === t.key}
              onClick={() => {
                tab.value = t.key;
              }}
            >
              {t.label}
              {t.key === 'recv' && recvCount > 0 ? <span class="sv-tab-badge">{recvCount}</span> : null}
            </button>
          ))}
        </nav>
      </div>

      <main>
        {active === 'scan' ? <ScanTab /> : null}
        {active === 'send' ? <SendTab /> : null}
        {active === 'recv' ? <RecvTab /> : null}
      </main>

      <Toast />
    </>
  );
}
