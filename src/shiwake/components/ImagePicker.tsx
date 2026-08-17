import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { readImageFiles, type SelectedImage } from '../images';

type Mode = 'gallery' | 'camera';

interface Props {
  images: SelectedImage[];
  onChange: (images: SelectedImage[]) => void;
  /** false になったらカメラを止める（タブ切替・解析中） */
  active: boolean;
  onError: (message: string) => void;
}

export function ImagePicker({ images, onChange, active, onError }: Props) {
  const [mode, setMode] = useState<Mode>('gallery');
  const [cameraOn, setCameraOn] = useState(false);
  const [flash, setFlash] = useState(false);
  const [reading, setReading] = useState(false);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  // タブ切替・アンマウント・モード変更でカメラを確実に停止する（v1 はタブを離れても回りっぱなしだった）
  useEffect(() => {
    if (!active || mode !== 'camera') stopCamera();
  }, [active, mode, stopCamera]);
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      // video 要素は cameraOn 後にマウントされるので次フレームで結線する
      requestAnimationFrame(() => {
        if (videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
      });
    } catch (e) {
      onError(`カメラを起動できませんでした（${e instanceof Error ? e.message : '不明なエラー'}）`);
    }
  }, [onError]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onError('撮影に失敗しました');
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    setFlash(true);
    setTimeout(() => setFlash(false), 80);
    onChange([...images, { dataUrl, name: `camera_${images.length + 1}.jpg` }]);
  }, [images, onChange, onError]);

  const pickFiles = useCallback(
    async (list: FileList | null) => {
      if (!list || !list.length) return;
      setReading(true);
      try {
        // 選択順を厳守する（Promise.all）。v1 は読み込み完了順に並び替わっていた
        const added = await readImageFiles(Array.from(list));
        onChange([...images, ...added]);
      } catch {
        onError('画像を読み込めませんでした');
      } finally {
        setReading(false);
      }
    },
    [images, onChange, onError],
  );

  const openPicker = () => fileRef.current?.click();

  return (
    <div class="sw-stack">
      <div class="sw-mode">
        <button aria-pressed={mode === 'gallery'} onClick={() => setMode('gallery')}>
          🖼 ギャラリー
        </button>
        <button aria-pressed={mode === 'camera'} onClick={() => setMode('camera')}>
          📷 カメラ撮影
        </button>
      </div>

      {mode === 'gallery' ? (
        <button class="sw-drop" onClick={openPicker} disabled={reading}>
          <span class="sw-drop-icon" aria-hidden="true">
            🖼
          </span>
          {reading ? '読み込み中…' : '明細書を選択'}
          <span class="sw-drop-sub">複数枚まとめて選択 → 1リクエストで処理（選択順のまま並びます）</span>
        </button>
      ) : cameraOn ? (
        <div class="sw-camera">
          <video ref={videoRef} autoPlay playsInline muted />
          <div class="sw-flash" data-on={flash} />
          <div class="sw-camera-overlay">
            <div class="sw-camera-top">
              <span class="sw-camera-count">{images.length}枚撮影済み</span>
              <button class="sw-camera-close" onClick={stopCamera} aria-label="カメラを閉じる">
                ✕
              </button>
            </div>
            <div class="sw-camera-bottom">
              <button class="sw-shutter" onClick={capture} aria-label="撮影" />
              <button class="sw-camera-done" onClick={stopCamera}>
                完了
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button class="sw-btn-primary" onClick={startCamera}>
          📷 カメラを起動する
        </button>
      )}

      <input
        class="sw-hidden-input"
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          const el = e.currentTarget as HTMLInputElement;
          void pickFiles(el.files);
          el.value = '';
        }}
      />

      {images.length > 0 ? (
        <>
          <div class="sw-preview-grid">
            {images.map((img, i) => (
              <div class="sw-thumb" key={`${img.name}-${i}`}>
                <img src={img.dataUrl} alt={`明細${i + 1}`} />
                <button
                  class="sw-thumb-remove"
                  aria-label={`明細${i + 1}を削除`}
                  onClick={() => onChange(images.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
                <span class="sw-thumb-label">明細 {i + 1}</span>
              </div>
            ))}
            <button class="sw-add-more" onClick={mode === 'camera' && cameraOn ? capture : openPicker}>
              <span class="sw-plus">＋</span>
              <span>追加</span>
            </button>
          </div>
          <p class="sw-count">{images.length}枚選択中</p>
        </>
      ) : null}
    </div>
  );
}
