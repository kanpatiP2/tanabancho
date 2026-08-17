/**
 * v1 → v2 移行の結果表示。起動時に1度だけボトムシートで出す。
 *
 * 移行そのものは `main.tsx` が描画前に `bootMigration()` で済ませているので、
 * ここは `lastMigrationReport()` を読んで件数の照合表を描くだけ（副作用なし）。
 */
import { useState } from 'preact/hooks';
import { lastMigrationReport } from '@core/migrate';
import { formatDateTime } from '@core/datetime';
import { BottomSheet } from './components/BottomSheet';

const LABELS: Record<string, string> = {
  scans: '履歴',
  products: '学習辞書',
  comp: '競合',
  returns: '返品',
  cust: '客注',
  notes: 'ノート（メモ・リマインダー・便メモ）',
  shareRecv: '共有受信',
  shiwake: '仕分番長',
};

export function MigrationSheet() {
  const report = lastMigrationReport();
  const [open, setOpen] = useState(true);

  if (!report || (!report.ran && report.errors.length === 0)) return null;

  const rows = report.collections.filter((c) => c.v1Count > 0 || c.v2Count > 0);

  return (
    <BottomSheet
      open={open}
      title={report.ran ? '旧バージョンのデータを引き継ぎました' : 'データ移行に失敗しました'}
      onClose={() => setOpen(false)}
      footer={
        <button type="button" class="btn btn--primary grow" onClick={() => setOpen(false)}>
          確認しました
        </button>
      }
    >
      {report.errors.length > 0 ? (
        <div class="stack">
          {report.errors.map((e) => (
            <p key={e} style={{ color: 'var(--red)' }}>
              {e}
            </p>
          ))}
        </div>
      ) : null}

      {report.ran ? (
        <>
          <p class="muted">
            {formatDateTime(report.migratedAt)} に移行しました。旧データ（v1）はそのまま残しています。
          </p>

          <div class="dtable" role="table" aria-label="移行件数の照合">
            <div class="dtable__row dtable__row--head" role="row">
              <span role="columnheader">データ</span>
              <span role="columnheader">v1</span>
              <span role="columnheader">v2</span>
              <span role="columnheader">破棄</span>
              <span role="columnheader">日付近似</span>
            </div>
            {rows.map((c) => (
              <div key={c.target} class="dtable__row" role="row">
                <span role="cell">{LABELS[c.target] ?? c.target}</span>
                <span class="mono" role="cell">
                  {c.v1Count}
                </span>
                <span class="mono" role="cell">
                  {c.v2Count}
                </span>
                <span class="mono" role="cell">
                  {c.dropped || ''}
                </span>
                <span class="mono" role="cell">
                  {c.approxDate || ''}
                </span>
              </div>
            ))}
            <div class="dtable__row dtable__row--total" role="row">
              <span role="cell">合計</span>
              <span class="mono" role="cell">
                {report.totals.v1Count}
              </span>
              <span class="mono" role="cell">
                {report.totals.v2Count}
              </span>
              <span class="mono" role="cell">
                {report.totals.dropped || ''}
              </span>
              <span class="mono" role="cell">
                {report.totals.approxDate || ''}
              </span>
            </div>
          </div>

          <p class="muted" style={{ marginTop: '8px' }}>
            「破棄」はリマインダー用の疑似レコードなど v2 で不要になった行、「日付近似」は
            記録日時を復元できず移行日時で代用した行です。
          </p>
        </>
      ) : null}
    </BottomSheet>
  );
}
