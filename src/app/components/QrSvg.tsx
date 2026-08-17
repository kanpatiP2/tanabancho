/**
 * QR の SVG 描画。
 *
 * `@order-export/qr` が返すセル矩形を JSX の <rect> として並べるだけ（innerHTML 不使用）。
 * viewBox はモジュール数そのものなので、どれだけ拡大しても
 * セル境界が整数座標に乗り、量子化ズレ（にじみ）が起きない。
 *
 * 色は白黒固定。読み取り対象なのでテーマに追従させない
 * （ARCHITECTURE.md のリテラル色禁止に対する明示的な例外。実際の値は ui.css の
 *  .fullscreen--paper が持つ --qr-paper / --qr-ink）。
 */
import type { QrMatrix } from '@order-export/qr';
import { toQrRects } from '@order-export/qr';

export function QrSvg({ matrix, label }: { matrix: QrMatrix; label: string }) {
  const rects = toQrRects(matrix);
  return (
    <svg
      class="qrsvg"
      viewBox={`0 0 ${matrix.size} ${matrix.size}`}
      role="img"
      aria-label={label}
      shape-rendering="crispEdges"
    >
      {/* 静寂域（quiet zone）を含む下地。QR の外周 4 モジュールぶんが白で確保される */}
      <rect x={0} y={0} width={matrix.size} height={matrix.size} fill="var(--qr-paper)" />
      {rects.map((r) => (
        <rect
          key={`${r.y}:${r.x}:${r.w}`}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          fill="var(--qr-ink)"
        />
      ))}
    </svg>
  );
}
