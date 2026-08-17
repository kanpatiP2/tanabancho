/**
 * POP モードのパネル。
 * 号数グリッド（profile.vocab.popSizes）× 枚数± + ラミ + 拡大 + 委託先 + プリセット。
 */
import { useState } from 'preact/hooks';
import type { PopDetail, PopEnlarge } from '@core/types';
import { Check, Field, Stepper } from '../components/primitives';
import { toast } from '../components/Toast';
import { profile, settings, updateSettings } from '../store';
import { clearPop, patchPop, popDraft, popSummary, setPopAll, togglePopSize } from './draft';

const ENLARGE: PopEnlarge[] = ['', 'A4', 'A3', 'A2'];

export function PopPanel() {
  const [presetName, setPresetName] = useState('');
  const sizes = profile.value.vocab.popSizes;
  const draft = popDraft.value;
  const selected = new Map(draft.map((p) => [p.size, p]));

  const savePreset = () => {
    const label = presetName.trim();
    if (!label) {
      toast('プリセット名を入力してください', { tone: 'warn' });
      return;
    }
    if (!draft.length) {
      toast('保存する組合せがありません', { tone: 'warn' });
      return;
    }
    const rest = settings.value.popPresets.filter((p) => p.label !== label);
    updateSettings({ popPresets: [...rest, { label, pop: draft.map((p) => ({ ...p })) }] });
    setPresetName('');
    toast(`プリセット「${label}」を保存しました`, { tone: 'ok' });
  };

  const deletePreset = (label: string) => {
    updateSettings({ popPresets: settings.value.popPresets.filter((p) => p.label !== label) });
    toast(`プリセット「${label}」を削除しました`);
  };

  return (
    <div class="stack">
      <div class="summary-line">
        現在の組合せ: <strong>{popSummary.value}</strong>
      </div>

      <div class="popgrid">
        {sizes.map((size) => {
          const cur = selected.get(size);
          const on = Boolean(cur);
          return (
            <div key={size} class="popcell" data-on={String(on)}>
              <label class="popcell__label">
                <input type="checkbox" checked={on} onChange={() => togglePopSize(size)} />
                <span>{size}</span>
              </label>
              {on && size !== '競合' ? (
                <Stepper
                  value={cur!.qty}
                  min={1}
                  max={99}
                  onChange={(qty) => patchPop(size, { qty })}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {draft.length ? (
        <div class="stack">
          {draft.map((p) => (
            <div key={p.size} class="card card--flat" style={{ marginBottom: 0 }}>
              <div class="row">
                <strong class="grow">{p.size}</strong>
                <Check label="ラミ" checked={p.lami} onChange={(lami) => patchPop(p.size, { lami })} />
              </div>
              <div class="row" style={{ marginTop: '6px' }}>
                <Field label="拡大" style={{ flex: '1' }}>
                  <select
                    class="select"
                    value={p.enlarge}
                    onChange={(e) =>
                      patchPop(p.size, {
                        enlarge: (e.currentTarget as HTMLSelectElement).value as PopEnlarge,
                      })
                    }
                  >
                    {ENLARGE.map((v) => (
                      <option key={v} value={v}>
                        {v || 'なし'}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="委託先" style={{ flex: '1' }}>
                  <select
                    class="select"
                    value={p.assignee}
                    onChange={(e) =>
                      patchPop(p.size, { assignee: (e.currentTarget as HTMLSelectElement).value })
                    }
                  >
                    <option value="">自分</option>
                    {settings.value.assignees.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          ))}
          <button type="button" class="btn btn--sm" onClick={clearPop}>
            組合せをクリア
          </button>
        </div>
      ) : null}

      <div>
        <div class="field__label">プリセット（長押しで削除）</div>
        <div class="chiprow">
          {settings.value.popPresets.length === 0 ? (
            <span class="muted">まだありません</span>
          ) : (
            settings.value.popPresets.map((p) => (
              <button
                key={p.label}
                type="button"
                class="chip chip--sm"
                onClick={() => {
                  setPopAll(p.pop);
                  toast(`「${p.label}」を装着しました`, { tone: 'ok' });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  deletePreset(p.label);
                }}
              >
                {p.label}
              </button>
            ))
          )}
        </div>
        <div class="row" style={{ marginTop: '6px' }}>
          <input
            class="input grow"
            placeholder="プリセット名"
            value={presetName}
            onInput={(e) => setPresetName((e.currentTarget as HTMLInputElement).value)}
          />
          <button type="button" class="btn" onClick={savePreset}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

/** 履歴インライン編集からも使う POP 選択グリッド */
export function PopEditor({
  value,
  onChange,
}: {
  value: PopDetail[];
  onChange: (next: PopDetail[]) => void;
}) {
  const sizes = profile.value.vocab.popSizes;
  const selected = new Map(value.map((p) => [p.size, p]));
  const toggle = (size: string) => {
    if (selected.has(size)) onChange(value.filter((p) => p.size !== size));
    else onChange([...value, { size, qty: 1, lami: false, enlarge: '', assignee: '' }]);
  };
  const patch = (size: string, p: Partial<PopDetail>) =>
    onChange(value.map((x) => (x.size === size ? { ...x, ...p } : x)));

  return (
    <div class="popgrid">
      {sizes.map((size) => {
        const cur = selected.get(size);
        return (
          <div key={size} class="popcell" data-on={String(Boolean(cur))}>
            <label class="popcell__label">
              <input type="checkbox" checked={Boolean(cur)} onChange={() => toggle(size)} />
              <span>{size}</span>
            </label>
            {cur && size !== '競合' ? (
              <Stepper value={cur.qty} min={1} max={99} onChange={(qty) => patch(size, { qty })} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
