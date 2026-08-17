import type { ComponentChildren } from 'preact';

/** alert/confirm/prompt の代替。スクリムをタップで閉じる */
export function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  return (
    <div class="sw-scrim" onClick={onClose} role="presentation">
      <div class="sw-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
        <button class="sw-btn-ghost" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}

export interface ToastState {
  message: string;
  /** 取り消し可能な操作のみ */
  undo?: (() => void) | undefined;
}

export function Toast({ state, onDismiss }: { state: ToastState; onDismiss: () => void }) {
  return (
    <div class="sw-toast" role="status">
      <span>{state.message}</span>
      {state.undo ? (
        <button
          onClick={() => {
            state.undo?.();
            onDismiss();
          }}
        >
          元に戻す
        </button>
      ) : (
        <button onClick={onDismiss}>閉じる</button>
      )}
    </div>
  );
}
