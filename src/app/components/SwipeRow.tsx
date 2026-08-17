/**
 * 左右スワイプ操作つき行。
 * 右スワイプ = 主アクション（削除など） / 左スワイプ = 副アクション（保護トグルなど）。
 * ボタン・入力の上から始まったジェスチャは無視する（legacy の attachSwipeListener と同じ方針）。
 */
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';

const THRESHOLD = 70;

export function SwipeRow({
  children,
  onSwipeRight,
  onSwipeLeft,
  rightLabel,
  leftLabel,
}: {
  children: ComponentChildren;
  onSwipeRight: (() => void) | null;
  onSwipeLeft: (() => void) | null;
  rightLabel: string;
  leftLabel: string;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; lock: 'none' | 'h' | 'v' } | null>(null);

  const isInteractive = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    return Boolean(el?.closest('button, input, select, textarea, a, label'));
  };

  return (
    <div class="histrow__wrap" style={{ position: 'relative' }}>
      {dx !== 0 ? (
        <div class="histrow__under" aria-hidden="true">
          <span class="lock">{dx < 0 ? leftLabel : ''}</span>
          <span class="del">{dx > 0 ? rightLabel : ''}</span>
        </div>
      ) : null}
      <div
        class="histrow__swipe"
        style={{ transform: `translateX(${dx}px)` }}
        onTouchStart={(e) => {
          if (isInteractive(e.target)) return;
          const t = e.touches[0];
          if (!t) return;
          start.current = { x: t.clientX, y: t.clientY, lock: 'none' };
        }}
        onTouchMove={(e) => {
          const s = start.current;
          const t = e.touches[0];
          if (!s || !t) return;
          const mx = t.clientX - s.x;
          const my = t.clientY - s.y;
          if (s.lock === 'none') {
            if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
            s.lock = Math.abs(mx) > Math.abs(my) ? 'h' : 'v';
          }
          if (s.lock !== 'h') return;
          if (mx > 0 && !onSwipeRight) return;
          if (mx < 0 && !onSwipeLeft) return;
          setDx(Math.max(-120, Math.min(120, mx)));
        }}
        onTouchEnd={() => {
          const moved = dx;
          start.current = null;
          setDx(0);
          if (moved > THRESHOLD) onSwipeRight?.();
          else if (moved < -THRESHOLD) onSwipeLeft?.();
        }}
        onTouchCancel={() => {
          start.current = null;
          setDx(0);
        }}
      >
        {children}
      </div>
    </div>
  );
}
