/**
 * 設定。プロファイル / テーマ / カメラプリセット / 期限チップ / 委託先 / QRバッチ / 行末。
 */
import { useState } from 'preact/hooks';
import type { CameraPresetKey, ProfileKey, Settings } from '@core/types';
import { PROFILES } from '@core/profile';
import { Card, Field } from '../components/primitives';
import { toast } from '../components/Toast';
import { settings, updateSettings } from '../store';

const THEMES: { value: Settings['theme']; label: string }[] = [
  { value: 'auto', label: '自動' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
];

const CAMERA_PRESETS: { value: CameraPresetKey; label: string; fps: number; focus: '' | 'continuous' }[] = [
  { value: 'default', label: '標準', fps: 5, focus: '' },
  { value: 'fast', label: '高速', fps: 15, focus: 'continuous' },
  { value: 'custom', label: 'カスタム', fps: 5, focus: '' },
];

export function SettingsPanel() {
  const s = settings.value;
  const [chipInput, setChipInput] = useState('');
  const [assigneeInput, setAssigneeInput] = useState('');

  return (
    <>
      <Card title="プロファイル">
        <div class="chiprow">
          {(Object.keys(PROFILES) as ProfileKey[]).map((k) => (
            <button
              key={k}
              type="button"
              class="chip"
              aria-pressed={s.profile === k}
              onClick={() => updateSettings({ profile: k })}
            >
              {PROFILES[k].label}
            </button>
          ))}
        </div>
        <p class="muted" style={{ marginTop: '6px' }}>
          語彙・機能フラグが切り替わります（0始まりJAN強調:{' '}
          {PROFILES[s.profile].features.leadingZeroHighlight ? 'ON' : 'OFF'}）
        </p>
      </Card>

      <Card title="テーマ">
        <div class="chiprow">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              class="chip"
              aria-pressed={s.theme === t.value}
              onClick={() => updateSettings({ theme: t.value })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      <Card title="カメラ">
        <div class="chiprow">
          {CAMERA_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              class="chip"
              aria-pressed={s.cameraPreset === p.value}
              onClick={() =>
                updateSettings(
                  p.value === 'custom'
                    ? { cameraPreset: p.value }
                    : { cameraPreset: p.value, cameraFps: p.fps, cameraFocusMode: p.focus },
                )
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        {s.cameraPreset === 'custom' ? (
          <div class="row" style={{ marginTop: '8px' }}>
            <Field label="FPS" style={{ flex: '1' }}>
              <input
                class="input"
                type="number"
                min="1"
                max="30"
                value={s.cameraFps}
                onInput={(e) =>
                  updateSettings({ cameraFps: Number((e.currentTarget as HTMLInputElement).value) || 5 })
                }
              />
            </Field>
            <Field label="フォーカス" style={{ flex: '1' }}>
              <select
                class="select"
                value={s.cameraFocusMode}
                onChange={(e) =>
                  updateSettings({
                    cameraFocusMode: (e.currentTarget as HTMLSelectElement).value as '' | 'continuous',
                  })
                }
              >
                <option value="">既定</option>
                <option value="continuous">連続</option>
              </select>
            </Field>
          </div>
        ) : null}
        <p class="muted">現在: {s.cameraFps}fps / {s.cameraFocusMode || '既定'}フォーカス</p>
      </Card>

      <Card title="期限チップ（日数）">
        <div class="chiprow">
          {s.expiryChips.map((n) => (
            <button
              key={n}
              type="button"
              class="chip chip--sm"
              onClick={() => updateSettings({ expiryChips: s.expiryChips.filter((x) => x !== n) })}
            >
              +{n}日 ✕
            </button>
          ))}
        </div>
        <div class="row" style={{ marginTop: '6px' }}>
          <input
            class="input grow"
            type="number"
            min="1"
            placeholder="日数"
            value={chipInput}
            onInput={(e) => setChipInput((e.currentTarget as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="btn"
            onClick={() => {
              const n = Number(chipInput);
              if (!Number.isInteger(n) || n <= 0) {
                toast('1以上の整数を入力してください', { tone: 'warn' });
                return;
              }
              if (s.expiryChips.includes(n)) {
                toast('既にあります', { tone: 'warn' });
                return;
              }
              updateSettings({ expiryChips: [...s.expiryChips, n].sort((a, b) => a - b) });
              setChipInput('');
            }}
          >
            追加
          </button>
        </div>
      </Card>

      <Card title="委託先">
        <div class="chiprow">
          {s.assignees.length === 0 ? (
            <span class="muted">未登録</span>
          ) : (
            s.assignees.map((a) => (
              <button
                key={a}
                type="button"
                class="chip chip--sm"
                onClick={() => updateSettings({ assignees: s.assignees.filter((x) => x !== a) })}
              >
                {a} ✕
              </button>
            ))
          )}
        </div>
        <div class="row" style={{ marginTop: '6px' }}>
          <input
            class="input grow"
            placeholder="委託先名"
            value={assigneeInput}
            onInput={(e) => setAssigneeInput((e.currentTarget as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="btn"
            onClick={() => {
              const v = assigneeInput.trim();
              if (!v || s.assignees.includes(v)) {
                toast('未入力または重複しています', { tone: 'warn' });
                return;
              }
              updateSettings({ assignees: [...s.assignees, v] });
              setAssigneeInput('');
            }}
          >
            追加
          </button>
        </div>
      </Card>

      <Card title="発注エクスポート">
        <div class="row">
          <Field label="QRバッチサイズ" style={{ flex: '1' }}>
            <select
              class="select"
              value={String(s.qrBatchSize)}
              onChange={(e) =>
                updateSettings({
                  qrBatchSize: Number((e.currentTarget as HTMLSelectElement).value) as Settings['qrBatchSize'],
                })
              }
            >
              <option value="20">20件</option>
              <option value="30">30件</option>
              <option value="50">50件</option>
            </select>
          </Field>
          <Field label="行末" style={{ flex: '1' }}>
            <select
              class="select"
              value={s.exportEol}
              onChange={(e) =>
                updateSettings({ exportEol: (e.currentTarget as HTMLSelectElement).value as 'CRLF' | 'LF' })
              }
            >
              <option value="CRLF">CRLF</option>
              <option value="LF">LF</option>
            </select>
          </Field>
        </div>
      </Card>
    </>
  );
}
