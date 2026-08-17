import { useState } from 'preact/hooks';
import { isPlausibleKey, maskApiKey } from '../apikey';

interface Props {
  /** 既存キー（無ければ ''） */
  currentKey: string;
  currentPersisted: boolean;
  onSave: (key: string, persist: boolean) => void;
  /** 既存キーがある場合のみ（v1 は戻れないバグがあった） */
  onCancel: (() => void) | null;
  onClear: (() => void) | null;
}

export function ApiKeyScreen({ currentKey, currentPersisted, onSave, onCancel, onClear }: Props) {
  const [value, setValue] = useState('');
  const [persist, setPersist] = useState(currentPersisted);

  const canSave = isPlausibleKey(value);

  return (
    <div class="sw-apikey">
      <div class="sw-logo" aria-hidden="true">
        🔑
      </div>
      <h2>Google AI Studio APIキー</h2>
      <p class="sw-note" style={{ textAlign: 'center' }}>
        Gemini API で明細書を読み取ります。キーはこの端末の外に出ません。
      </p>

      {currentKey ? <p class="sw-mask">現在のキー: {maskApiKey(currentKey)}</p> : null}

      <div>
        <input
          type="password"
          value={value}
          placeholder="AIzaSy..."
          autocomplete="off"
          spellcheck={false}
          onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
        />
        <p class="sw-note" style={{ marginTop: '6px' }}>
          aistudio.google.com → Get API key から取得
        </p>
      </div>

      <label class="sw-check">
        <input
          type="checkbox"
          checked={persist}
          onChange={(e) => setPersist((e.currentTarget as HTMLInputElement).checked)}
        />
        <span>
          この端末に保存して次回も使う
          <br />
          （オフのときはタブを閉じるとキーは消えます）
        </span>
      </label>

      <button class="sw-btn-primary" disabled={!canSave} onClick={() => onSave(value.trim(), persist)}>
        保存して始める
      </button>

      {onCancel || onClear ? (
        <div class="sw-btn-row">
          {onCancel ? (
            <button class="sw-btn-ghost" onClick={onCancel}>
              キャンセル
            </button>
          ) : null}
          {onClear ? (
            <button class="sw-btn-ghost" onClick={onClear}>
              保存済みキーを削除
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
