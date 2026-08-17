import { dismissToast, toast } from './state';

/** alert/confirm の代替。破壊的操作は Undo ボタン付きで出す */
export function Toast() {
  const t = toast.value;
  if (!t) return null;
  return (
    <div class={`sv-toast${t.tone === 'warn' ? ' sv-toast--warn' : ''}`} role="status" aria-live="polite">
      <span class="sv-toast-msg">{t.message}</span>
      {t.onUndo ? (
        <button
          type="button"
          class="sv-btn"
          onClick={() => {
            // 先に閉じる（Undo 側が新しいトーストを出す場合に消さないため）
            dismissToast();
            t.onUndo?.();
          }}
        >
          {t.undoLabel ?? '元に戻す'}
        </button>
      ) : null}
    </div>
  );
}
