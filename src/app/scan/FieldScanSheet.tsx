/**
 * 「スキャンで入力」シート（field intent の読み取り面）。
 *
 * App 直下に常駐し、`fieldScanRequest` が立っている間だけ開く。
 * 画面遷移をしないので、呼び出し元のフォーム（客注・返品・競合・履歴行）の
 * 入力途中の状態はそのまま残る。読み取り経路はカメラ / ウェッジ / 手入力の3つで、
 * いずれも `dispatchCode` → session（intent = field）→ `onField` に合流する。
 */
import { useEffect, useState } from 'preact/hooks';
import { BottomSheet } from '../components/BottomSheet';
import { toast } from '../components/Toast';
import {
  attachWedge,
  cameraError,
  cameraState,
  dispatchCode,
  feedback,
  setFieldHandler,
  startCamera,
  stopCamera,
} from '../scan-bridge';
import { settings } from '../store';
import { abortFieldScan, deliverFieldScan, fieldScanRequest } from './field-scan';

/** 本体スキャンタブとは別の器を使う（同じ id が2つ生えないように） */
export const FIELD_VIDEO_ID = 'tb-field-camera';

export function FieldScanSheet() {
  const req = fieldScanRequest.value;
  const [manual, setManual] = useState('');
  const open = Boolean(req);

  // ---- 読み取り結果の受け口。開いている間だけ session の onField を握る
  useEffect(() => {
    if (!open) return;
    setFieldHandler((ev) => {
      feedback(true);
      deliverFieldScan(ev);
      toast(`読み取りました: ${ev.jan}`, { tone: 'ok' });
    });
    return () => setFieldHandler(null);
  }, [open]);

  // ---- カメラ。開いたら起動し、閉じたら必ず止める
  useEffect(() => {
    if (!open) return;
    void stopCamera().then(() => startCamera(FIELD_VIDEO_ID));
    return () => void stopCamera();
  }, [open]);

  // ---- ウェッジ（Bluetooth リーダー）。設定が wedge のときだけ
  useEffect(() => {
    if (!open || settings.value.inputSource !== 'wedge') return;
    return attachWedge();
  }, [open, settings.value.inputSource]);

  useEffect(() => {
    if (open) setManual('');
  }, [open]);

  if (!req) return null;

  const submitManual = () => {
    const code = manual.trim();
    if (!code) return;
    if (!dispatchCode(code, 'manual')) {
      toast('コードとして解釈できません', { tone: 'warn' });
      return;
    }
    setManual('');
  };

  return (
    <BottomSheet
      open={open}
      title={`${req.label} をスキャン`}
      layer="top"
      onClose={abortFieldScan}
      footer={
        <button type="button" class="btn btn--block" onClick={abortFieldScan}>
          キャンセル
        </button>
      }
    >
      <p class="muted" style={{ margin: '0 0 6px' }}>
        1件読み取ると自動で閉じ、元のモードに戻ります。
      </p>
      <div class="camerabox">
        <div class="camerabox__view" id={FIELD_VIDEO_ID} />
        {cameraState.value === 'running' ? null : (
          <div class="camerabox__hint">
            {cameraState.value === 'unavailable' ? (
              <>
                <p>カメラを開始できませんでした</p>
                <p class="muted">{cameraError.value}</p>
                <p class="muted">下の手入力をご利用ください</p>
              </>
            ) : (
              <p>起動中…</p>
            )}
          </div>
        )}
      </div>
      <div class="row" style={{ marginTop: '8px' }}>
        <input
          class="input mono grow"
          inputMode="numeric"
          placeholder="手入力"
          value={manual}
          onInput={(e) => setManual((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitManual();
          }}
        />
        <button type="button" class="btn btn--primary" disabled={!manual.trim()} onClick={submitManual}>
          入力
        </button>
      </div>
    </BottomSheet>
  );
}
