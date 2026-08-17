import { useState } from 'preact/hooks';
import { SHARE_URL_LIMIT, buildShareUrl, encodeShareData } from '@core/share-codec';
import { clearScanned, scanned, showToast } from './state';

function shareBaseUrl(): string {
  if (typeof location === 'undefined') return 'share.html';
  return `${location.origin}${location.pathname}`;
}

export function SendTab() {
  const [url, setUrl] = useState('');
  const items = scanned.value;

  const generate = () => {
    if (items.length === 0) {
      showToast('スキャン済みデータがありません', { tone: 'warn' });
      return;
    }
    const generated = buildShareUrl(shareBaseUrl(), encodeShareData(items), 'share');
    setUrl(generated);
    showToast(`URL生成完了（${items.length}件 / ${generated.length}文字）`);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('URLをコピーしました。LINEに貼り付けて送信してください');
    } catch {
      showToast('コピーできませんでした。URL欄を長押しして手動でコピーしてください', { tone: 'warn' });
    }
  };

  const share = async () => {
    if (!url) return;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: '棚番長 データ共有',
          text: 'バーコードデータを受け取ってください。',
          url,
        });
        showToast('共有しました');
        return;
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
      }
    }
    await copy(url);
  };

  const tooLong = url.length > SHARE_URL_LIMIT;

  return (
    <div class="sv-panel">
      <div class="sv-card">
        <h2>メインツールへ送信</h2>
        <p class="sv-desc">
          スキャンしたバーコードを担当者のメインツールへ送ります。URLを生成してLINEなどで送信してください。
          受け取る側はメインツールの「バックアップ → 受け取り」から取り込みます。
        </p>
        <button type="button" class="sv-btn sv-btn--primary" onClick={generate} disabled={items.length === 0}>
          送信用URLを生成（{items.length}件）
        </button>

        {url ? (
          <>
            <textarea class="sv-textarea" readOnly value={url} aria-label="送信用URL" />
            {tooLong ? (
              <p class="sv-warn">
                URL長が{url.length}文字です。送信先で切られる可能性があります（目安 {SHARE_URL_LIMIT}
                文字以下）。件数を減らして再生成してください。
              </p>
            ) : null}
            <div class="sv-panel">
              <button type="button" class="sv-btn sv-btn--primary" onClick={() => void share()}>
                共有する（LINE等）
              </button>
              <button type="button" class="sv-btn" onClick={() => void copy(url)}>
                URLをコピー
              </button>
            </div>
          </>
        ) : null}
      </div>

      <div class="sv-card">
        <h2>スキャン済みデータ</h2>
        <p class="sv-desc">送信後、不要になったら消去できます。消去直後ならトーストの「元に戻す」で復元できます。</p>
        <button type="button" class="sv-btn sv-btn--danger" onClick={clearScanned} disabled={items.length === 0}>
          全消去（{items.length}件）
        </button>
      </div>
    </div>
  );
}
