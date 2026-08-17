import { useEffect, useRef } from 'preact/hooks';
import { barcodeFormat } from '@core/jan';

export interface BarcodeEntry {
  code: string;
  name?: string;
  meta?: string;
}

interface Props {
  items: BarcodeEntry[];
  index: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

/**
 * バーコード拡大表示。JsBarcode は初回表示時に動的 import する
 * （共有ビューの初期ロードに約60KBを載せないため）。
 */
export function BarcodeModal({ items, index, onNavigate, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const item = items[index];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !item) return;
    let cancelled = false;
    void import('jsbarcode')
      .then(({ default: JsBarcode }) => {
        if (cancelled || !canvasRef.current) return;
        JsBarcode(canvasRef.current, item.code, {
          format: barcodeFormat(item.code),
          width: 3,
          height: 130,
          displayValue: false,
          margin: 8,
        });
      })
      .catch(() => {
        /* 描画できない場合は下の数字表示のみ */
      });
    return () => {
      cancelled = true;
    };
  }, [item?.code]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
      if (e.key === 'ArrowRight' && index < items.length - 1) onNavigate(index + 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, items.length, onNavigate, onClose]);

  if (!item) return null;

  return (
    <div
      class="sv-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`バーコード ${item.code}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="sv-modal-card">
        <canvas ref={canvasRef} class="sv-modal-canvas" />
        <div class="sv-modal-code">{item.code}</div>
        {item.name ? <div class="sv-modal-name">{item.name}</div> : null}
        {item.meta ? <div class="sv-modal-meta">{item.meta}</div> : null}
        <div class="sv-modal-nav">
          <button type="button" class="sv-btn" disabled={index <= 0} onClick={() => onNavigate(index - 1)} aria-label="前へ">
            ◀
          </button>
          <span class="sv-modal-hint">
            {items.length > 1 ? `${index + 1} / ${items.length}` : '枠外タップで閉じる'}
          </span>
          <button
            type="button"
            class="sv-btn"
            disabled={index >= items.length - 1}
            onClick={() => onNavigate(index + 1)}
            aria-label="次へ"
          >
            ▶
          </button>
        </div>
        <button type="button" class="sv-btn" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
