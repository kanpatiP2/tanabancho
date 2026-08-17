/**
 * 期限パッド（ボトムシート）。
 * - 提案値を大表示（dict.suggestExpiryOffset の学習結果）
 * - テンキー入力は datetime.parseExpiryDigits で 4桁MMDD / 2桁DD として解釈
 * - オフセットチップ（settings.expiryChips）/「直前と同じ」/「期限なしで登録」
 */
import { useEffect, useState } from 'preact/hooks';
import { addDays, formatDateOnly, parseExpiryDigits, todayLocal } from '@core/datetime';
import { BottomSheet } from '../components/BottomSheet';
import { settings } from '../store';
import { lastExpiry } from './draft';

interface Props {
  open: boolean;
  /** 対象の表示名（商品名 or JAN） */
  subject: string;
  /** 学習からの提案値 'YYYY-MM-DD' | null */
  suggestion: string | null;
  onClose: () => void;
  onCommit: (expiry: string) => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function ExpiryPad({ open, subject, suggestion, onClose, onCommit }: Props) {
  const [digits, setDigits] = useState('');

  useEffect(() => {
    if (open) setDigits('');
  }, [open]);

  const today = todayLocal();
  const typed = parseExpiryDigits(digits);
  const value = typed ?? (digits === '' ? suggestion : null);
  const hint = typed
    ? `入力 ${digits} → ${formatDateOnly(typed)}`
    : digits
      ? `${digits} は日付として解釈できません`
      : suggestion
        ? '学習した提案値です'
        : '2桁=日 / 4桁=月日';

  const press = (k: string) => setDigits((d) => (d.length >= 4 ? d : d + k));

  return (
    <BottomSheet
      open={open}
      title="期限を入力"
      onClose={onClose}
      footer={
        <>
          <button type="button" class="btn grow" onClick={() => onCommit('')}>
            期限なしで登録
          </button>
          <button
            type="button"
            class="btn btn--primary grow"
            disabled={!value}
            onClick={() => value && onCommit(value)}
          >
            確定
          </button>
        </>
      }
    >
      <p class="muted" style={{ margin: '0 0 6px' }}>
        {subject}
      </p>

      <div class="pad-display">
        <div class="pad-display__value">{value ? formatDateOnly(value) : '—'}</div>
        <div class="pad-display__hint">{value ? `${value}（${hint}）` : hint}</div>
      </div>

      <div class="chiprow" style={{ marginBottom: '8px' }}>
        {settings.value.expiryChips.map((n) => (
          <button
            key={n}
            type="button"
            class="chip chip--sm"
            aria-pressed={value === addDays(today, n)}
            onClick={() => {
              setDigits('');
              onCommit(addDays(today, n));
            }}
          >
            +{n}日
          </button>
        ))}
        <button
          type="button"
          class="chip chip--sm"
          disabled={!lastExpiry.value}
          onClick={() => lastExpiry.value && onCommit(lastExpiry.value)}
        >
          直前と同じ{lastExpiry.value ? `（${formatDateOnly(lastExpiry.value)}）` : ''}
        </button>
      </div>

      <div class="padgrid">
        {KEYS.map((k) => (
          <button key={k} type="button" class="padkey" onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <button type="button" class="padkey padkey--fn" onClick={() => setDigits('')}>
          クリア
        </button>
        <button type="button" class="padkey" onClick={() => press('0')}>
          0
        </button>
        <button type="button" class="padkey padkey--fn" onClick={() => setDigits((d) => d.slice(0, -1))}>
          ⌫
        </button>
      </div>
    </BottomSheet>
  );
}
