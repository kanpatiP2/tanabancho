import { CAMERA_PRESETS, camera, cameraSummary, selectPreset, setCamera, showToast } from './state';
import type { Settings } from '@core/types';

const PRESET_KEYS: Settings['cameraPreset'][] = ['default', 'fast', 'custom'];

interface Props {
  /** 「設定を適用」でカメラを再起動する（起動していない場合は何もしない） */
  onApply: () => void;
}

/**
 * カメラ詳細設定。v1 自社版の3プリセットを踏襲する。
 * 値の保持と表示のみ担当し、実際のカメラ制御は @scanner/camera（アダプタ）の責務。
 */
export function CameraSettings({ onApply }: Props) {
  const c = camera.value;
  return (
    <details class="sv-settings">
      <summary>
        <span>カメラ設定</span>
        <span class="sv-list-title">{cameraSummary(c)}</span>
      </summary>
      <div class="sv-settings-body">
        <div class="sv-preset-row">
          {PRESET_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              class="sv-preset"
              aria-pressed={c.preset === key}
              onClick={() => selectPreset(key)}
            >
              {CAMERA_PRESETS[key].label}
            </button>
          ))}
        </div>

        {c.preset === 'custom' ? (
          <div class="sv-settings-body">
            <div class="sv-field">
              <label for="sv-fps">FPS</label>
              <span class="sv-row">
                <input
                  id="sv-fps"
                  type="range"
                  min={3}
                  max={30}
                  step={1}
                  value={c.fps}
                  onInput={(e) => setCamera({ fps: Number((e.target as HTMLInputElement).value) })}
                />
                <strong>{c.fps}</strong>
              </span>
            </div>
            <div class="sv-field">
              <label for="sv-focus">オートフォーカス</label>
              <select
                id="sv-focus"
                class="sv-select"
                value={c.focusMode}
                onChange={(e) =>
                  setCamera({
                    focusMode: (e.target as HTMLSelectElement).value === 'continuous' ? 'continuous' : '',
                  })
                }
              >
                <option value="continuous">continuous</option>
                <option value="">指定なし</option>
              </select>
            </div>
          </div>
        ) : (
          <div class="sv-preset-desc">{CAMERA_PRESETS[c.preset].desc}</div>
        )}

        <button
          type="button"
          class="sv-btn"
          onClick={() => {
            onApply();
            showToast('カメラ設定を適用しました');
          }}
        >
          設定を適用（カメラ再起動）
        </button>
      </div>
    </details>
  );
}
