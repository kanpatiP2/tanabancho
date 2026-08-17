/**
 * ボトムシート（modal 代替）。confirm の代替として `ConfirmSheet` も提供する。
 */
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
}

export function BottomSheet({ open, title, onClose, children, footer }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      class="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div class="sheet__grab" />
        <div class="sheet__head">
          <span class="sheet__title">{title}</span>
          <button type="button" class="btn btn--sm btn--ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div class="sheet__body">{children}</div>
        {footer ? <div class="sheet__foot">{footer}</div> : null}
      </div>
    </div>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** window.confirm の代替 */
export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel = 'OK',
  danger,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  return (
    <BottomSheet
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" class="btn grow" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            class={danger ? 'btn btn--danger grow' : 'btn btn--primary grow'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message}</p>
    </BottomSheet>
  );
}
