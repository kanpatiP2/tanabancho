/**
 * ノート（メモ + リマインダー統合）。カードグリッド / 6色 / ピン留め / remindAt。
 */
import { useState } from 'preact/hooks';
import { formatDateTime, nowIso } from '@core/datetime';
import { NOTE_COLORS, type Note } from '@core/types';
import { BottomSheet } from '../components/BottomSheet';
import { Card, Check, Empty, Field } from '../components/primitives';
import { toast, toastUndo } from '../components/Toast';
import { addNote, deleteNote, notes, restoreNote, stamp, updateNote } from '../store';
import { sortNotes } from './sorting';

function blank(): Note {
  return { ...stamp(), title: '', text: '', color: NOTE_COLORS[0], pinned: false };
}

export function Notes() {
  const [editing, setEditing] = useState<Note | null>(null);
  const [isNew, setIsNew] = useState(false);

  const list = sortNotes(notes.value);

  const openNew = () => {
    setEditing(blank());
    setIsNew(true);
  };

  const commit = () => {
    if (!editing) return;
    if (!editing.title.trim() && !editing.text.trim()) {
      toast('タイトルか本文を入力してください', { tone: 'warn' });
      return;
    }
    if (isNew) addNote({ ...editing, updatedAt: nowIso() });
    else updateNote(editing.id, editing);
    setEditing(null);
    toast('ノートを保存しました', { tone: 'ok' });
  };

  return (
    <>
      <Card title={`ノート (${notes.value.length}件)`}>
        <button type="button" class="btn btn--primary btn--block" onClick={openNew}>
          ＋ 新しいノート
        </button>
      </Card>

      {list.length === 0 ? (
        <Empty>ノートはありません。</Empty>
      ) : (
        <div class="notegrid">
          {list.map((n) => (
            <button
              key={n.id}
              type="button"
              class="notecard"
              style={{ borderLeftColor: n.color }}
              onClick={() => {
                setEditing({ ...n });
                setIsNew(false);
              }}
            >
              <span class="notecard__title">
                {n.pinned ? '📌 ' : ''}
                {n.title || '（無題）'}
              </span>
              <span class="notecard__text">{n.text}</span>
              <span class="notecard__title" style={{ fontWeight: 400, opacity: 0.7 }}>
                {n.remindAt ? `⏰ ${formatDateTime(n.remindAt)}` : formatDateTime(n.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      )}

      <BottomSheet
        open={Boolean(editing)}
        title={isNew ? '新しいノート' : 'ノートを編集'}
        onClose={() => setEditing(null)}
        footer={
          <>
            {!isNew && editing ? (
              <button
                type="button"
                class="btn btn--danger"
                onClick={() => {
                  const removed = deleteNote(editing.id);
                  setEditing(null);
                  if (removed) toastUndo('ノートを削除しました', () => restoreNote(removed.item, removed.index));
                }}
              >
                削除
              </button>
            ) : null}
            <button type="button" class="btn btn--primary grow" onClick={commit}>
              保存
            </button>
          </>
        }
      >
        {editing ? (
          <div class="stack">
            <Field label="タイトル">
              <input
                class="input"
                value={editing.title}
                onInput={(e) => setEditing({ ...editing, title: (e.currentTarget as HTMLInputElement).value })}
              />
            </Field>
            <Field label="本文">
              <textarea
                class="textarea"
                rows={6}
                value={editing.text}
                onInput={(e) => setEditing({ ...editing, text: (e.currentTarget as HTMLTextAreaElement).value })}
              />
            </Field>
            <div>
              <div class="field__label">色</div>
              <div class="colorrow">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    class="colordot"
                    style={{ background: c }}
                    aria-pressed={editing.color === c}
                    aria-label={`色 ${c}`}
                    onClick={() => setEditing({ ...editing, color: c })}
                  />
                ))}
              </div>
            </div>
            <Check
              label="📌 ピン留め"
              checked={editing.pinned}
              onChange={(pinned) => setEditing({ ...editing, pinned })}
            />
            <Field label="リマインダー（設定すると「今日」タブに浮上します）">
              <input
                class="input"
                type="datetime-local"
                value={editing.remindAt ? toLocalInput(editing.remindAt) : ''}
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  const next = { ...editing };
                  if (v) next.remindAt = new Date(v).toISOString();
                  else delete next.remindAt;
                  setEditing(next);
                }}
              />
            </Field>
          </div>
        ) : null}
      </BottomSheet>
    </>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
