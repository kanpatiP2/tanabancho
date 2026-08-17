import type { ScannerAdapter } from '@core/types';

/**
 * カメラスキャナ。
 *
 * 経路は2つ:
 * - `'bd'` … ネイティブ BarcodeDetector（Android Chrome）。getUserMedia + rAF ループ
 * - `'h5'` … html5-qrcode フォールバック。動的 import でチャンクを分離する
 *
 * ブラウザ API に触る部分は自動テスト対象外（手動確認前提）。
 * デデュープ・fps 間引き・qrbox 計算といった純ロジックは切り出してテストする。
 */

// ---------------------------------------------------------------- オプション

export interface ScannerOptions {
  /** 1秒あたりのデコード試行回数。既定 5（v1 の CAM_PRESETS.default 相当） */
  fps?: number;
  /** advanced constraints の focusMode。'' は指定なし */
  focusMode?: '' | 'continuous';
  /** 縦長バーコード用に読取枠を縦長（40%×85%）にする。既定は横長（85%×40%） */
  tall?: boolean;
  /** video を差し込む要素の id。start() の引数が優先される */
  targetElementId?: string;
  /** 同一コードを無視する時間(ms)。既定 1500 */
  dedupeMs?: number;
  /** 経路の強制。未指定なら BarcodeDetector 対応状況で自動判定 */
  prefer?: 'bd' | 'h5';
}

export const DEFAULT_FPS = 5;
export const DEFAULT_DEDUPE_MS = 1500;

/** BarcodeDetector に渡すフォーマット（v1 の対応フォーマットと同一） */
export const BD_FORMATS = ['ean_13', 'ean_8', 'code_128', 'itf'] as const;

// ---------------------------------------------------------------- 純ロジック

/** fps から 1フレームあたりの最小間隔(ms)。fps<=0 は毎フレーム扱い */
export function frameIntervalMs(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return 1000 / fps;
}

/**
 * rAF ループの間引き判定。前回デコード時刻 `lastAt`（未実行なら null）から
 * 1フレーム分の間隔が経過していれば true。
 */
export function shouldSample(lastAt: number | null, now: number, fps: number): boolean {
  if (lastAt === null) return true;
  return now - lastAt >= frameIntervalMs(fps);
}

/** 読取枠の寸法。v1 の qrboxFn と同じ比率 */
export function qrboxDimensions(
  viewW: number,
  viewH: number,
  tall: boolean,
): { width: number; height: number } {
  return tall
    ? { width: viewW * 0.4, height: viewH * 0.85 }
    : { width: viewW * 0.85, height: viewH * 0.4 };
}

export interface Deduper {
  /** 受理すべきなら true。同一コードが window 内に再来したら false */
  accept(code: string, now?: number): boolean;
  reset(): void;
}

/**
 * 連続誤読よけ。同じコードが `windowMs` 以内に再検出されたら弾く。
 * 別コードが来た場合は即座に受理する（棚を流し読みする運用のため）。
 */
export function createDeduper(windowMs: number = DEFAULT_DEDUPE_MS): Deduper {
  let lastCode: string | null = null;
  let lastAt = 0;
  return {
    accept(code: string, now: number = Date.now()): boolean {
      if (lastCode === code && now - lastAt < windowMs) {
        // 読み続けている間は期限を延長しない（離してから再度読めるように）
        return false;
      }
      lastCode = code;
      lastAt = now;
      return true;
    },
    reset() {
      lastCode = null;
      lastAt = 0;
    },
  };
}

/** getUserMedia に渡す制約を組み立てる */
export function buildVideoConstraints(opts: ScannerOptions): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = { facingMode: 'environment' };
  if (opts.focusMode) {
    // focusMode は TS の MediaTrackConstraintSet に無いため型を緩める
    (constraints as { advanced?: unknown[] }).advanced = [{ focusMode: opts.focusMode }];
  }
  return constraints;
}

// ---------------------------------------------------------------- BarcodeDetector 型

interface DetectedBarcodeLike {
  rawValue: string;
  format?: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcodeLike[]>;
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: readonly string[] }): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

/** BarcodeDetector が使えて ean_13 に対応しているか */
export async function isBarcodeDetectorUsable(): Promise<boolean> {
  const ctor = getBarcodeDetectorCtor();
  if (!ctor) return false;
  try {
    const formats = await ctor.getSupportedFormats?.();
    return Array.isArray(formats) && formats.includes('ean_13');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 共通の下ごしらえ

function requireElement(id: string): HTMLElement {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
  if (!el) throw new Error(`scanner: element #${id} not found`);
  return el;
}

// ---------------------------------------------------------------- BarcodeDetector 経路

class BdScanner implements ScannerAdapter {
  readonly kind = 'bd' as const;

  private opts: ScannerOptions;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private detector: BarcodeDetectorLike | null = null;
  private deduper: Deduper;
  private lastSampleAt: number | null = null;
  private onVisibility: (() => void) | null = null;
  private isRunning = false;

  constructor(opts: ScannerOptions) {
    this.opts = opts;
    this.deduper = createDeduper(opts.dedupeMs ?? DEFAULT_DEDUPE_MS);
  }

  get running(): boolean {
    return this.isRunning;
  }

  async start(videoContainerId: string, onDetect: (raw: string) => void): Promise<void> {
    if (this.isRunning) return;
    const ctor = getBarcodeDetectorCtor();
    if (!ctor) throw new Error('scanner: BarcodeDetector unavailable');

    const container = requireElement(videoContainerId || this.opts.targetElementId || '');

    const video = document.createElement('video');
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    video.autoplay = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';

    const stream = await navigator.mediaDevices.getUserMedia({
      video: buildVideoConstraints(this.opts),
      audio: false,
    });

    this.stream = stream;
    this.video = video;
    video.srcObject = stream;
    container.appendChild(video);

    try {
      await video.play();
    } catch {
      // 一部端末で autoplay が拒否されるが srcObject は生きているので続行
    }

    this.detector = new ctor({ formats: BD_FORMATS });
    this.deduper.reset();
    this.lastSampleAt = null;
    this.isRunning = true;

    this.onVisibility = () => {
      if (document.hidden) void this.stop();
    };
    document.addEventListener('visibilitychange', this.onVisibility);

    const fps = this.opts.fps ?? DEFAULT_FPS;
    const loop = () => {
      if (!this.isRunning) return;
      this.rafId = requestAnimationFrame(loop);
      const now = Date.now();
      if (!shouldSample(this.lastSampleAt, now, fps)) return;
      this.lastSampleAt = now;
      const v = this.video;
      const d = this.detector;
      if (!v || !d || v.readyState < 2) return;
      void d
        .detect(v)
        .then((results) => {
          if (!this.isRunning) return;
          for (const r of results) {
            const raw = String(r.rawValue ?? '').replace(/\s+/g, '');
            if (!raw) continue;
            if (!this.deduper.accept(raw, Date.now())) continue;
            onDetect(raw);
            break;
          }
        })
        .catch(() => {
          /* フレーム単位の失敗は無視 */
        });
    };
    this.rafId = requestAnimationFrame(loop);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.onVisibility) {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.onVisibility = null;
    }
    try {
      const v = this.video;
      if (v) {
        v.srcObject = null;
        v.remove();
      }
    } finally {
      // ストリーム解放は何があっても実行する
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.video = null;
      this.detector = null;
      this.deduper.reset();
      this.lastSampleAt = null;
    }
  }
}

// ---------------------------------------------------------------- html5-qrcode 経路

class H5Scanner implements ScannerAdapter {
  readonly kind = 'h5' as const;

  private opts: ScannerOptions;
  private instance: { stop(): Promise<void>; clear(): void } | null = null;
  private deduper: Deduper;
  private onVisibility: (() => void) | null = null;
  private isRunning = false;

  constructor(opts: ScannerOptions) {
    this.opts = opts;
    this.deduper = createDeduper(opts.dedupeMs ?? DEFAULT_DEDUPE_MS);
  }

  get running(): boolean {
    return this.isRunning;
  }

  async start(videoContainerId: string, onDetect: (raw: string) => void): Promise<void> {
    if (this.isRunning) return;
    const elementId = videoContainerId || this.opts.targetElementId || '';
    requireElement(elementId);

    // 動的 import: html5-qrcode を初期バンドルから切り離す
    const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');

    const html5 = new Html5Qrcode(elementId, {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.ITF,
      ],
      verbose: false,
    });
    this.instance = html5;
    this.deduper.reset();

    const tall = !!this.opts.tall;
    const config = {
      fps: this.opts.fps ?? DEFAULT_FPS,
      qrbox: (w: number, h: number) => qrboxDimensions(w, h, tall),
      aspectRatio: 1.0,
      ...(this.opts.focusMode ? { videoConstraints: buildVideoConstraints(this.opts) } : {}),
    };

    await html5.start(
      { facingMode: 'environment' },
      config,
      (decodedText: string) => {
        const raw = String(decodedText ?? '').replace(/\s+/g, '');
        if (!raw) return;
        if (!this.deduper.accept(raw, Date.now())) return;
        onDetect(raw);
      },
      undefined,
    );

    this.isRunning = true;
    this.onVisibility = () => {
      if (document.hidden) void this.stop();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.onVisibility) {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.onVisibility = null;
    }
    const inst = this.instance;
    this.instance = null;
    this.deduper.reset();
    if (!inst) return;
    try {
      await inst.stop();
    } catch {
      /* 既に停止済み */
    } finally {
      try {
        inst.clear();
      } catch {
        /* DOM が消えている場合 */
      }
    }
  }
}

// ---------------------------------------------------------------- ファクトリ

/**
 * 環境に応じたスキャナアダプタを生成する。
 * BarcodeDetector が ean_13 を扱えるならそちら、それ以外は html5-qrcode。
 */
export async function createScanner(opts: ScannerOptions = {}): Promise<ScannerAdapter> {
  if (opts.prefer === 'h5') return new H5Scanner(opts);
  if (opts.prefer === 'bd') return new BdScanner(opts);
  return (await isBarcodeDetectorUsable()) ? new BdScanner(opts) : new H5Scanner(opts);
}
