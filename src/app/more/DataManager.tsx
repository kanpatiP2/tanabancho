/**
 * データ管理。バックアップ出力/取込・ストレージメーター・共有URL生成/取込。
 *
 * 実装の置き場所:
 * - バックアップの入出力は core/backup.ts（exportBackup / importBackup）
 * - 共有URLの符号化は core/share-codec.ts（encodeShareData / decodeShareDataDetailed）
 * ここは「ファイル/クリップボード/共有シートという入出力の口」と結果表示だけを持つ。
 */
import { useRef, useState } from 'preact/hooks';
import { exportBackup, importBackup, type ImportReport } from '@core/backup';
import {
  SHARE_URL_LIMIT,
  buildShareUrl,
  decodeShareDataDetailed,
  encodeShareData,
  envelopeToScanItems,
  extractDataParam,
} from '@core/share-codec';
import { nowIso } from '@core/datetime';
import type { ScanItem, ShareEnvelopeV2 } from '@core/types';
import { Card, Empty } from '../components/primitives';
import { BottomSheet } from '../components/BottomSheet';
import { toast } from '../components/Toast';
import { loadAll, measureStorage, mergeIncomingScans, scans, settings, updateSettings } from '../store';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/** 'tanabancho-backup-20260817-0912.json' */
function backupFileName(at: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `tanabancho-backup-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(
    at.getHours(),
  )}${p(at.getMinutes())}.json`;
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** share.html の絶対URL（現在地からの相対解決） */
function shareBaseUrl(): string {
  if (typeof location === 'undefined') return 'share.html';
  return new URL('share.html', location.href).href;
}

/**
 * 受信エンベロープ → ScanItem[]。
 * 共有形式は時刻を 'HH:MM' しか持たないので、送信日時（ts）の日付と組み合わせて
 * 記録時刻を復元する（重複判定「jan + 時刻」を効かせるため）。
 */
function toScanItemsWithTime(env: ShareEnvelopeV2): ScanItem[] {
  const base = new Date(env.ts);
  const items = envelopeToScanItems(env);
  if (Number.isNaN(base.getTime())) return items;
  return items.map((item, i) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(env.items[i]?.t ?? '');
    if (!m) return item;
    const d = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      Number(m[1]),
      Number(m[2]),
      0,
      0,
    );
    const iso = d.toISOString();
    return { ...item, createdAt: iso, updatedAt: iso };
  });
}

export function DataManager() {
  const [shareUrl, setShareUrl] = useState('');
  const [shareError, setShareError] = useState('');
  const [receiveInput, setReceiveInput] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const usage = measureStorage();
  const pct = Math.min(100, Math.round((usage.total / usage.limit) * 100));
  const level = pct >= 80 ? 'danger' : pct >= 60 ? 'warn' : 'ok';
  const tooLong = shareUrl.length > SHARE_URL_LIMIT;

  // ---------------------------------------------------------------- バックアップ

  const doExport = () => {
    try {
      const at = nowIso();
      downloadJson(backupFileName(), exportBackup(at));
      updateSettings({ lastBackupAt: at });
      toast('バックアップを書き出しました', { tone: 'ok' });
    } catch (e) {
      toast(`書き出しに失敗しました: ${e instanceof Error ? e.message : String(e)}`, {
        tone: 'error',
      });
    }
  };

  const doImport = async (file: File) => {
    let text: string;
    try {
      text = await file.text();
    } catch {
      toast('ファイルを読み取れませんでした', { tone: 'error' });
      return;
    }
    const result = importBackup(text);
    setReport(result);
    if (result.ok) {
      // 取り込んだ内容を画面へ反映する（store は起動時に一度しか読まないため）
      loadAll();
      toast(`${result.totals.added}件を取り込みました`, { tone: 'ok' });
    } else {
      toast(result.errors[0] ?? '取込に失敗しました', { tone: 'error' });
    }
  };

  // ---------------------------------------------------------------- 共有URL

  const makeShare = () => {
    setShareError('');
    setShareUrl('');
    if (scans.value.length === 0) {
      setShareError('共有できる履歴がありません');
      return;
    }
    try {
      const url = buildShareUrl(shareBaseUrl(), encodeShareData(scans.value), 'main');
      setShareUrl(url);
      toast('共有URLを生成しました', { tone: 'ok' });
    } catch (e) {
      setShareError(e instanceof Error ? e.message : String(e));
    }
  };

  const sendShare = () => {
    if (!shareUrl) return;
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav && typeof nav.share === 'function') {
      void nav
        .share({ title: '棚番長 共有リスト', text: `棚番長 ${scans.value.length}件`, url: shareUrl })
        .catch(() => {
          /* ユーザーがキャンセルした場合も来るので通知しない */
        });
      return;
    }
    void nav?.clipboard
      ?.writeText(shareUrl)
      .then(() => toast('コピーしました', { tone: 'ok' }))
      .catch(() => toast('コピーできませんでした', { tone: 'error' }));
  };

  const receiveShare = () => {
    const encoded = extractDataParam(receiveInput);
    if (!encoded) {
      toast('共有URLからデータを読み取れませんでした', { tone: 'warn' });
      return;
    }
    try {
      const decoded = decodeShareDataDetailed(encoded);
      const added = mergeIncomingScans(toScanItemsWithTime(decoded.envelope));
      const total = decoded.envelope.items.length;
      const skipped = total - added;
      toast(
        added > 0
          ? `${added}件を取り込みました${skipped > 0 ? `（重複 ${skipped}件は除外）` : ''}`
          : '新しい項目はありませんでした（すべて取込済み）',
        { tone: added > 0 ? 'ok' : 'warn' },
      );
      if (decoded.warnings > 0) {
        toast(`${decoded.warnings}件の値を除外・切り詰めました`, { tone: 'warn' });
      }
      setReceiveInput('');
    } catch (e) {
      toast(
        `取込に失敗しました: ${e instanceof Error ? e.message : String(e)}。URLが途中で切れていないかご確認ください`,
        { tone: 'error' },
      );
    }
  };

  // ---------------------------------------------------------------- 描画

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
        <p class="muted">
          履歴・学習辞書・競合・返品・客注・ノート・発注リスト・設定・仕分番長を1ファイルに書き出します。
        </p>
        <p class="muted">最終バックアップ: {settings.value.lastBackupAt || '未実施'}</p>
        <div class="row">
          <button type="button" class="btn btn--primary grow" onClick={doExport}>
            バックアップを出力
          </button>
          <button type="button" class="btn grow" onClick={() => fileRef.current?.click()}>
            バックアップを取込
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const input = e.currentTarget as HTMLInputElement;
            const file = input.files?.[0];
            input.value = ''; // 同じファイルを選び直せるようにする
            if (file) void doImport(file);
          }}
        />
        <p class="muted">
          取込は「既存データを消さずに追加」します（同じ項目は id で重複除外）。
        </p>
      </Card>

      <Card title="共有URL">
        <button type="button" class="btn btn--block" onClick={makeShare}>
          現在のリスト（{scans.value.length}件）から共有URLを生成
        </button>
        {shareError ? (
          <p class="muted" style={{ marginTop: '8px', color: 'var(--red)' }}>
            {shareError}
          </p>
        ) : null}
        {shareUrl ? (
          <div class="stack" style={{ marginTop: '8px' }}>
            {tooLong ? (
              <p class="muted" style={{ color: 'var(--amber)' }}>
                URLが長すぎます（{shareUrl.length}文字 / 目安 {SHARE_URL_LIMIT}
                文字）。アプリによっては途中で切られます。件数を減らして生成し直してください。
              </p>
            ) : null}
            <textarea class="textarea mono" readOnly value={shareUrl} rows={4} />
            <div class="row">
              <button type="button" class="btn btn--primary grow" onClick={sendShare}>
                共有 / コピー
              </button>
            </div>
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
          onClick={receiveShare}
        >
          取込
        </button>
      </Card>

      <ImportReportSheet report={report} onClose={() => setReport(null)} />
    </>
  );
}

const IMPORT_LABELS: Record<string, string> = {
  scans: '履歴',
  products: '学習辞書',
  comp: '競合',
  returns: '返品',
  cust: '客注',
  notes: 'ノート',
  orders: '発注リスト',
  shiwake: '仕分番長',
};

function ImportReportSheet({
  report,
  onClose,
}: {
  report: ImportReport | null;
  onClose: () => void;
}) {
  if (!report) return null;
  return (
    <BottomSheet
      open
      title={report.ok ? 'バックアップを取り込みました' : '取込に失敗しました'}
      onClose={onClose}
      footer={
        <button type="button" class="btn btn--primary grow" onClick={onClose}>
          閉じる
        </button>
      }
    >
      <p class="muted">
        形式: {report.formatDetected === 1 ? 'v1（旧バックアップ）' : report.formatDetected === 2 ? 'v2' : '判別できず'}
        {report.settingsApplied ? ' / 設定も復元しました' : ''}
      </p>

      {report.errors.map((e) => (
        <p key={e} style={{ color: 'var(--red)' }}>
          {e}
        </p>
      ))}

      {report.collections.length > 0 ? (
        <div class="dtable dtable--3" role="table" aria-label="取込件数">
          <div class="dtable__row dtable__row--head" role="row">
            <span role="columnheader">データ</span>
            <span role="columnheader">ファイル</span>
            <span role="columnheader">追加</span>
            <span role="columnheader">重複</span>
          </div>
          {report.collections.map((c) => (
            <div key={c.target} class="dtable__row" role="row">
              <span role="cell">{IMPORT_LABELS[c.target] ?? c.target}</span>
              <span class="mono" role="cell">
                {c.incoming}
              </span>
              <span class="mono" role="cell">
                {c.added}
              </span>
              <span class="mono" role="cell">
                {c.skipped || ''}
              </span>
            </div>
          ))}
          <div class="dtable__row dtable__row--total" role="row">
            <span role="cell">合計</span>
            <span class="mono" role="cell">
              {report.totals.incoming}
            </span>
            <span class="mono" role="cell">
              {report.totals.added}
            </span>
            <span class="mono" role="cell">
              {report.totals.skipped || ''}
            </span>
          </div>
        </div>
      ) : null}

      {report.warnings.map((w) => (
        <p key={w} class="muted" style={{ marginTop: '8px' }}>
          {w}
        </p>
      ))}
    </BottomSheet>
  );
}
