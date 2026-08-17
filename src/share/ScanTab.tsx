import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ScannerAdapter } from '@core/types';
import { formatTime } from '@core/datetime';
import { addCode, camera, clearScanned, removeScanned, scanned, setCamera, showToast } from './state';
import { CameraSettings } from './CameraSettings';
import { BarcodeModal } from './BarcodeModal';

const VIDEO_ID = 'sv-reader';

type CamState = 'idle' | 'starting' | 'running' | 'unavailable';

export function ScanTab() {
  const [camState, setCamState] = useState<CamState>('idle');
  const [camNote, setCamNote] = useState('');
  const [flash, setFlash] = useState<'' | 'ok' | 'ng'>('');
  const [manual, setManual] = useState('');
  const [zoom, setZoom] = useState(-1);
  const adapterRef = useRef<ScannerAdapter | null>(null);
  const lockRef = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  const items = scanned.value;

  const blink = useCallback((tone: 'ok' | 'ng') => {
    setFlash(tone);
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 300);
  }, []);

  const submit = useCallback(
    (raw: string) => {
      const r = addCode(raw);
      if (r.ok) {
        blink('ok');
        showToast(r.fromItf ? `登録: ${r.jan}（ITFから変換）` : `登録: ${r.jan}`);
        return;
      }
      blink('ng');
      if (r.reason === 'duplicate') showToast('既に登録済みです', { tone: 'warn' });
      else if (r.reason === 'invalid') showToast('バーコードとして読めない値です', { tone: 'warn' });
    },
    [blink],
  );

  const stopCamera = useCallback(async () => {
    const adapter = adapterRef.current;
    adapterRef.current = null;
    if (!adapter) return;
    try {
      await adapter.stop();
    } catch {
      /* 停止失敗は無視 */
    }
    setCamState('idle');
  }, []);

  const startCamera = useCallback(async () => {
    if (adapterRef.current) return;
    setCamState('starting');
    setCamNote('カメラ起動中...');
    try {
      // 動的 import: カメラ実装（html5-qrcode 等）を初期チャンクに載せない
      const { createScanner } = await import('@scanner/camera');
      // fps / フォーカス / 読取枠は生成時に決まるため、その時点の設定を渡す
      const c = camera.peek();
      const adapter = await createScanner({ fps: c.fps, focusMode: c.focusMode, tall: c.tall });
      await adapter.start(VIDEO_ID, (raw) => {
        if (lockRef.current) return;
        lockRef.current = true;
        submit(raw);
        setTimeout(() => {
          lockRef.current = false;
        }, 800);
      });
      adapterRef.current = adapter;
      setCamState('running');
      setCamNote('');
    } catch {
      adapterRef.current = null;
      setCamState('unavailable');
      setCamNote('カメラを開始できませんでした。下の手入力をご利用ください');
    }
  }, [submit]);

  /** 設定変更の反映。停止中なら何もしない（次回の開始時に反映される） */
  const restartCamera = useCallback(() => {
    if (!adapterRef.current) return;
    void stopCamera().then(() => setTimeout(() => void startCamera(), 300));
  }, [startCamera, stopCamera]);

  useEffect(() => {
    const onHide = () => {
      if (document.hidden) void stopCamera();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      void stopCamera();
    };
  }, [stopCamera]);

  const c = camera.value;

  return (
    <div class="sv-panel">
      <div class={`sv-camera${flash ? ` sv-camera--${flash}` : ''}`}>
        <div id={VIDEO_ID} class="sv-camera-view" />
        {camState === 'running' ? (
          <button
            type="button"
            class="sv-btn sv-btn--ghost sv-camera-aspect"
            onClick={() => {
              setCamera({ tall: !c.tall });
              restartCamera(); // 読取枠は生成時に決まるので作り直す
            }}
          >
            {c.tall ? '縦' : '横'}
          </button>
        ) : (
          <button type="button" class="sv-camera-cover" onClick={() => void startCamera()}>
            <span aria-hidden="true">{camState === 'unavailable' ? '×' : '▶'}</span>
            <span>
              {camState === 'starting'
                ? '起動中...'
                : camState === 'unavailable'
                  ? 'カメラを開始できません'
                  : 'タップしてスキャン開始'}
            </span>
            {camState === 'unavailable' ? <span class="sv-sub">手入力でも登録できます</span> : null}
          </button>
        )}
      </div>
      <div class="sv-camera-status">{camNote}</div>

      <CameraSettings onApply={restartCamera} />

      <form
        class="sv-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!manual.trim()) return;
          submit(manual);
          setManual('');
        }}
      >
        <input
          class="sv-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="バーコード手入力"
          value={manual}
          onInput={(e) => setManual((e.target as HTMLInputElement).value)}
        />
        <button type="submit" class="sv-btn sv-btn--primary">
          追加
        </button>
      </form>

      <div class="sv-list">
        <div class="sv-list-head">
          <span class="sv-list-title">スキャン済み {items.length}件</span>
          <button type="button" class="sv-btn sv-btn--ghost sv-btn--danger" onClick={clearScanned} disabled={items.length === 0}>
            全消去
          </button>
        </div>
        {items.length === 0 ? (
          <div class="sv-empty">
            スキャンすると
            <br />
            ここに一覧が表示されます
          </div>
        ) : (
          items.map((item, i) => (
            <div class="sv-item" key={item.id}>
              <span class="sv-item-num">{items.length - i}</span>
              <button type="button" class="sv-item-tap" onClick={() => setZoom(i)}>
                <span class="sv-code">{item.jan}</span>
                <span class="sv-sub">{formatTime(item.createdAt)}</span>
              </button>
              <button type="button" class="sv-btn sv-btn--ghost" aria-label={`${item.jan} を削除`} onClick={() => removeScanned(item.id)}>
                削除
              </button>
            </div>
          ))
        )}
      </div>

      {zoom >= 0 && items[zoom] ? (
        <BarcodeModal
          items={items.map((i) => ({ code: i.jan, meta: formatTime(i.createdAt) }))}
          index={zoom}
          onNavigate={setZoom}
          onClose={() => setZoom(-1)}
        />
      ) : null}
    </div>
  );
}
