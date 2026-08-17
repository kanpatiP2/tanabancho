/**
 * データ管理。バックアップ出力/取込・ストレージメーター・共有URL生成/取込。
 *
 * スタブ待ち:
 * - core/backup.ts（P1-A）が未着のため、出力/取込は「準備中」
 * - core/share-codec.ts（P1-B）は throw するので try/catch で「準備中」に落とす
 */
import { useState } from 'preact/hooks';
import { encodeShareData } from '@core/share-codec';
import { Card, Empty, Pending } from '../components/primitives';
import { toast } from '../components/Toast';
import { measureStorage, scans, settings } from '../store';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export function DataManager() {
  const [shareUrl, setShareUrl] = useState('');
  const [shareError, setShareError] = useState('');
  const [receiveInput, setReceiveInput] = useState('');

  const usage = measureStorage();
  const pct = Math.min(100, Math.round((usage.total / usage.limit) * 100));
  const level = pct >= 80 ? 'danger' : pct >= 60 ? 'warn' : 'ok';

  const makeShare = () => {
    setShareError('');
    setShareUrl('');
    try {
      const encoded = encodeShareData(scans.value);
      const base = typeof location !== 'undefined' ? location.href.replace(/[^/]*$/, '') : '';
      setShareUrl(`${base}share.html#${encoded}`);
      toast('共有URLを生成しました', { tone: 'ok' });
    } catch (e) {
      // P1-B の share-codec 未実装（throw）を握って「準備中」に落とす
      setShareError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <Card title="ストレージ">
        <div class="meter">
          <div class="meter__bar" data-level={level} style={{ width: `${pct}%` }} />
        </div>
        <p class="muted" style={{ margin: '6px 0' }}>
          {fmtBytes(usage.total)} / {fmtBytes(usage.limit)}（{pct}%）
        </p>
        {usage.slices.length === 0 ? (
          <Empty>まだ保存データがありません。</Empty>
        ) : (
          usage.slices.map((s) => (
            <div key={s.key} class="kv">
              <span class="kv__k">
                {s.label} <span class="mono">{s.key}</span>
              </span>
              <span>{fmtBytes(s.bytes)}</span>
            </div>
          ))
        )}
        {pct >= 80 ? (
          <p class="muted" style={{ color: 'var(--red)' }}>
            容量が逼迫しています。古い履歴の削除をおすすめします。
          </p>
        ) : null}
      </Card>

      <Card title="バックアップ">
        <p>
          バックアップの出力/取込は <Pending>P1-A の core/backup 実装待ち</Pending> です。
        </p>
        <p class="muted">
          最終バックアップ: {settings.value.lastBackupAt || '未実施'}
        </p>
        <div class="row">
          <button type="button" class="btn grow" disabled>
            バックアップを出力
          </button>
          <button type="button" class="btn grow" disabled>
            バックアップを取込
          </button>
        </div>
      </Card>

      <Card title="共有URL">
        <button type="button" class="btn btn--block" onClick={makeShare}>
          現在のリスト（{scans.value.length}件）から共有URLを生成
        </button>
        {shareError ? (
          <p style={{ marginTop: '8px' }}>
            <Pending>P1-B の share-codec 実装待ち</Pending>
            <br />
            <span class="muted">{shareError}</span>
          </p>
        ) : null}
        {shareUrl ? (
          <div class="stack" style={{ marginTop: '8px' }}>
            <textarea class="textarea mono" readOnly value={shareUrl} />
            <button
              type="button"
              class="btn"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(shareUrl)
                  .then(() => toast('コピーしました', { tone: 'ok' }))
                  .catch(() => toast('コピーできませんでした', { tone: 'error' }));
              }}
            >
              コピー
            </button>
          </div>
        ) : null}

        <hr class="sep" />
        <p class="muted">共有URLの取込</p>
        <textarea
          class="textarea mono"
          placeholder="共有URLを貼り付け"
          value={receiveInput}
          onInput={(e) => setReceiveInput((e.currentTarget as HTMLTextAreaElement).value)}
        />
        <button
          type="button"
          class="btn btn--block"
          style={{ marginTop: '6px' }}
          disabled={!receiveInput.trim()}
          onClick={() => toast('共有URLの取込は share-codec 実装後に有効になります', { tone: 'warn' })}
        >
          取込（<Pending>P1-B 待ち</Pending>）
        </button>
      </Card>
    </>
  );
}
