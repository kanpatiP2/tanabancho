/**
 * 画像入力（ギャラリー選択 / カメラ撮影）の共通モデル。
 *
 * 【v1 の重大バグ修正】
 * v1 は FileReader の onload 内で selectedImages.push していたため、
 * 読み込み完了順＝配列順になり、選択順（＝明細/カートの順序）が壊れていた。
 * カート取り違えの実害があるため、ここでは Promise.all + 入力 index 保持で
 * 「選択順を厳守」する。Promise.all は解決順に依らず入力順の配列を返す。
 */

export interface SelectedImage {
  /** data:image/jpeg;base64,... 形式 */
  dataUrl: string;
  name: string;
}

/** dataUrl から Gemini inline_data 用の mimeType / base64 を取り出す */
export function splitDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const comma = dataUrl.indexOf(',');
  const head = comma < 0 ? '' : dataUrl.slice(0, comma);
  const data = comma < 0 ? '' : dataUrl.slice(comma + 1);
  const mimeType = head.slice(head.indexOf(':') + 1, head.indexOf(';') < 0 ? undefined : head.indexOf(';'));
  return { mimeType: mimeType || 'image/jpeg', data };
}

function readOne(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      resolve(typeof r === 'string' ? r : '');
    };
    reader.onerror = () => reject(reader.error ?? new Error('画像の読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}

/**
 * 選択されたファイルを **選択順のまま** data URL 化する。
 * 1枚でも失敗したら reject（順序が欠けた状態で明細を組み立てないため）。
 */
export async function readImageFiles(files: readonly File[]): Promise<SelectedImage[]> {
  const indexed = files.map((file, index) =>
    readOne(file).then((dataUrl) => ({ index, image: { dataUrl, name: file.name } as SelectedImage })),
  );
  const settled = await Promise.all(indexed);
  // Promise.all は入力順を保つが、意図を明示するため index で再ソートする
  return settled.sort((a, b) => a.index - b.index).map((s) => s.image);
}
