/**
 * バーコード描画（jsbarcode）。canvas に直接描くので innerHTML は使わない。
 *
 * ここだけ色をリテラル指定するのは、バーコードが読み取り機器の対象だから。
 * テーマに追従して反転・低コントラスト化すると読めなくなるため、
 * 面は常に白・バーは常に黒で固定する（エラー文言も白面前提の暗色）。
 */
import JsBarcode from 'jsbarcode';
import { useEffect, useRef } from 'preact/hooks';
import { barcodeFormat } from '@core/jan';

export function Barcode({
  code,
  width = 3,
  height = 120,
  displayValue = true,
}: {
  code: string;
  width?: number;
  height?: number;
  displayValue?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !code) return;
    const opts = {
      format: barcodeFormat(code),
      width,
      height,
      displayValue,
      margin: 6,
      background: '#ffffff',
      lineColor: '#000000',
      fontSize: 16,
    };
    try {
      JsBarcode(el, code, opts);
    } catch {
      try {
        JsBarcode(el, code, { ...opts, format: 'CODE128' });
      } catch {
        const ctx = el.getContext('2d');
        if (ctx) {
          el.width = 240;
          el.height = 60;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, el.width, el.height);
          ctx.fillStyle = '#b91c1c';
          ctx.font = '14px sans-serif';
          ctx.fillText('バーコード化できないコードです', 10, 34);
        }
      }
    }
  }, [code, width, height, displayValue]);

  return <canvas ref={ref} class="barcode-canvas" />;
}
