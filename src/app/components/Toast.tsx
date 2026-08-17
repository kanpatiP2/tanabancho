/**
 * トースト（alert/confirm の代替）。Undo アクション付き。
 * 表示状態はモジュールローカルの signal で持ち、どこからでも `toast()` で出せる。
 */
import { signal } from '@preact/signals';
import { newId } from '../store';

export type ToastTone = 'info' | 'ok' | 'warn' | 'error';

export interface ToastAction {
  label: string;
  onAct: () => void;
}

interface ToastEntry {
  id: string;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

const entries = signal<ToastEntry[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function dismiss(id: string): void {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
  entries.value = entries.value.filter((e) => e.id !== id);
}

export function toast(
  message: string,
  opts: { tone?: ToastTone; action?: ToastAction; durationMs?: number } = {},
): void {
  const id = newId();
  const entry: ToastEntry = { id, message, tone: opts.tone ?? 'info' };
  if (opts.action) entry.action = opts.action;
  entries.value = [...entries.value.slice(-2), entry];
  timers.set(
    id,
    setTimeout(() => dismiss(id), opts.durationMs ?? (opts.action ? 6000 : 3000)),
  );
}

/** 削除 + Undo の定型。onUndo は差し戻し処理 */
export function toastUndo(message: string, onUndo: () => void): void {
  toast(message, {
    tone: 'info',
    action: { label: '元に戻す', onAct: onUndo },
  });
}

export function ToastHost() {
  if (!entries.value.length) return null;
  return (
    <div class="toasts" role="status" aria-live="polite">
      {entries.value.map((e) => (
        <div key={e.id} class={`toast toast--${e.tone}`}>
          <span class="toast__msg">{e.message}</span>
          {e.action ? (
            <button
              type="button"
              class="btn btn--sm"
              onClick={() => {
                e.action?.onAct();
                dismiss(e.id);
              }}
            >
              {e.action.label}
            </button>
          ) : null}
          <button type="button" class="btn btn--sm btn--ghost" onClick={() => dismiss(e.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
