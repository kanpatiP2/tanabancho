/**
 * 改行区切りテキスト → QR のセルマトリクス。
 *
 * **SVG 文字列は返さない**。ARCHITECTURE.md の innerHTML 禁止に従い、
 * 呼び出し側が JSX で `<svg><rect/></svg>` を組めるよう「セル配列 / 矩形配列」だけを返す。
 * 座標はすべてモジュール単位の整数なので、viewBox をモジュール数に合わせれば
 * 拡大しても量子化ズレ（セル境界のにじみ）が起きない。
 */
import qrcode from 'qrcode-generator';

/** 誤り訂正レベル。読み取り対象は綺麗な画面なので最小の L（＝同容量で最小サイズ） */
export const QR_ECC = 'L' as const;

/** 静寂域（quiet zone）。規格上の最小は 4 モジュール */
export const QR_QUIET_ZONE = 4;

export interface QrMatrix {
  /** データ領域のモジュール数（1辺）。型番 n なら 4n+17 */
  count: number;
  /** 静寂域のモジュール数（片側） */
  margin: number;
  /** 静寂域を含む1辺のモジュール数。SVG の viewBox に使う */
  size: number;
  /** [row][col] の暗モジュール。原点はデータ領域の左上（静寂域を含まない） */
  cells: boolean[][];
  /** 自動選択された型番（1..40） */
  typeNumber: number;
  ecc: typeof QR_ECC;
}

export interface QrRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface QrOptions {
  /** 静寂域のモジュール数（既定 QR_QUIET_ZONE） */
  margin?: number;
}

/**
 * テキストから QR のセルマトリクスを作る。型番は自動（0 = auto）。
 *
 * 入力が型番40・レベルLの容量を超える場合は Error を投げる（バッチサイズを下げてもらう）。
 */
export function buildQrMatrix(text: string, opts: QrOptions = {}): QrMatrix {
  const margin = Math.max(0, Math.floor(opts.margin ?? QR_QUIET_ZONE));
  const data = String(text ?? '');

  let qr: ReturnType<typeof qrcode>;
  try {
    qr = qrcode(0, QR_ECC);
    qr.addData(data); // 既定は Byte モード（改行を含むので数字モードは使えない）
    qr.make();
  } catch (e) {
    throw new Error(
      `QRに収まりません（${data.length}文字）。バッチサイズを小さくしてください: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  const count = qr.getModuleCount();
  const cells: boolean[][] = [];
  for (let row = 0; row < count; row++) {
    const line: boolean[] = new Array<boolean>(count);
    for (let col = 0; col < count; col++) line[col] = qr.isDark(row, col);
    cells.push(line);
  }

  return {
    count,
    margin,
    size: count + margin * 2,
    cells,
    // 型番 n のモジュール数は 4n+17
    typeNumber: (count - 17) / 4,
    ecc: QR_ECC,
  };
}

/**
 * セルマトリクス → 描画用の矩形配列（静寂域のオフセット込み）。
 *
 * 横方向に連続する暗モジュールを1つの矩形へまとめる。
 * 1モジュール1 `<rect>` だと 40x40 でも 1600 ノードになるため、
 * ラン長圧縮しておくと DOM が概ね 1/3〜1/5 になる。
 */
export function toQrRects(matrix: QrMatrix): QrRect[] {
  const rects: QrRect[] = [];
  const { cells, count, margin } = matrix;
  for (let row = 0; row < count; row++) {
    const line = cells[row];
    if (!line) continue;
    let runStart = -1;
    for (let col = 0; col <= count; col++) {
      const dark = col < count && line[col] === true;
      if (dark && runStart < 0) runStart = col;
      if (!dark && runStart >= 0) {
        rects.push({ x: runStart + margin, y: row + margin, w: col - runStart, h: 1 });
        runStart = -1;
      }
    }
  }
  return rects;
}
