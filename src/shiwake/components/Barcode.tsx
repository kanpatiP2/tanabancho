import { useEffect, useRef, useState } from 'preact/hooks';
import { barcodeFormat } from '@core/jan';

type JsBarcodeFn = (el: Element, data: string, opts?: Record<string, unknown>) => void;

let loader: Promise<JsBarcodeFn> | null = null;

/** jsbarcode は CJS（export =）なので動的 import で読む。バーコードを開いた時だけロードされる */
function loadJsBarcode(): Promise<JsBarcodeFn> {
  if (!loader) {
    loader = import('jsbarcode').then((m) => {
      const mod = m as unknown as { default?: JsBarcodeFn };
      return (mod.default ?? (m as unknown as JsBarcodeFn));
    });
  }
  return loader;
}

export function Barcode({ code }: { code: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const wrap = wrapRef.current;
    if (!wrap || !code) return;
    setFailed(false);

    loadJsBarcode()
      .then((JsBarcode) => {
        if (cancelled || !wrapRef.current) return;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        wrapRef.current.replaceChildren(svg);
        JsBarcode(svg, code, {
          format: barcodeFormat(code),
          displayValue: true,
          fontSize: 11,
          margin: 4,
          width: 1.5,
          height: 50,
          // バーコードは読取機の要件で白地・黒バー固定（テーマ非依存）
          background: '#ffffff',
          lineColor: '#000000',
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed) return <div class="sw-note">バーコードを生成できませんでした</div>;
  return <div class="sw-barcode-wrap" ref={wrapRef} />;
}
