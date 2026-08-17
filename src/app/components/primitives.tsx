/**
 * 小さな共通パーツ。innerHTML を使わず JSX のみで組む。
 */
import type { ComponentChildren } from 'preact';
import { profile } from '../store';

export type Tone = 'teal' | 'red' | 'amber' | 'blue' | 'plain';

export function Badge({ tone = 'plain', children }: { tone?: Tone; children: ComponentChildren }) {
  return <span class={`badge badge--${tone}`}>{children}</span>;
}

export function Card({
  title,
  action,
  children,
  flat,
}: {
  title?: ComponentChildren;
  action?: ComponentChildren;
  children: ComponentChildren;
  flat?: boolean;
}) {
  return (
    <section class={flat ? 'card card--flat' : 'card'}>
      {title ? (
        <h2 class="card__title">
          {title}
          <span class="spacer" />
          {action}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: ComponentChildren;
  style?: string | Record<string, string | number>;
}) {
  return (
    <label class="field" style={style}>
      <span class="field__label">{label}</span>
      {children}
    </label>
  );
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: ComponentChildren;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label class="check" data-on={String(checked)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <span class="stepper">
      <button
        type="button"
        class="btn btn--sm"
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label="減らす"
      >
        −
      </button>
      <span class="stepper__val">{value}</span>
      <button
        type="button"
        class="btn btn--sm"
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label="増やす"
      >
        ＋
      </button>
    </span>
  );
}

export function Chips<T extends string | number>({
  options,
  value,
  onSelect,
  small,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onSelect: (v: T) => void;
  small?: boolean;
}) {
  return (
    <div class="chiprow">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          class={small ? 'chip chip--sm' : 'chip'}
          aria-pressed={value === o.value}
          onClick={() => onSelect(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 0始まりJANの先頭0を強調（プロファイルの features.leadingZeroHighlight に従う） */
export function JanText({ jan }: { jan: string }) {
  if (!profile.value.features.leadingZeroHighlight || !jan.startsWith('0')) {
    return <span class="mono">{jan}</span>;
  }
  return (
    <span class="mono">
      <span class="lead-zero" title="0始まりJAN">
        0
      </span>
      {jan.slice(1)}
    </span>
  );
}

/** 未実装モジュール待ちの箇所に出す共通表示 */
export function Pending({ children }: { children?: ComponentChildren }) {
  return <span class="pending">準備中{children ? `（${children}）` : ''}</span>;
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <p class="empty">{children}</p>;
}
