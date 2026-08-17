import type { Note } from '@core/types';
import { BIN_MEMO_HISTORY_MAX } from '../state';

interface Props {
  draft: string;
  saved: boolean;
  history: Note[];
  onInput: (text: string) => void;
}

export function MemoTab({ draft, saved, history, onInput }: Props) {
  return (
    <div class="sw-stack">
      <div class="sw-label">📝 今便のメモ</div>
      <textarea
        class="sw-memo-area"
        placeholder="便全体へのメモ（夜間依頼・特記事項など）"
        value={draft}
        onInput={(e) => onInput((e.currentTarget as HTMLTextAreaElement).value)}
      />
      <div class="sw-saved">{saved ? '✓ 保存しました' : ''}</div>
      <div class="sw-divider" />
      <div class="sw-label">🕐 過去の便メモ</div>
      {history.length ? (
        history.map((n) => (
          <div class="sw-history" key={n.id}>
            <div class="sw-history-date">{n.title}</div>
            <div class="sw-history-text">{n.text}</div>
          </div>
        ))
      ) : (
        <div class="sw-empty">過去のメモはありません</div>
      )}
      <p class="sw-note">
        「次の便へ（リセット）」で今便のメモが履歴に残ります（最新{BIN_MEMO_HISTORY_MAX}件）。
      </p>
    </div>
  );
}
