import { useState } from 'preact/hooks';

interface Props {
  words: string[];
  onAdd: (word: string) => void;
  onDelete: (word: string) => void;
}

export function AlertTab({ words, onAdd, onDelete }: Props) {
  const [draft, setDraft] = useState('');

  const submit = () => {
    const w = draft.trim();
    if (!w) return;
    onAdd(w);
    setDraft('');
  };

  return (
    <div>
      <p class="sw-note" style={{ marginBottom: '12px' }}>
        明細書に含まれていたときにアラート表示する商品名（部分一致）を登録します。
        ひらがな・カタカナどちらでも登録できます。
      </p>
      <div class="sw-add-row">
        <input
          type="text"
          value={draft}
          maxLength={40}
          placeholder="例: UFO、どん兵衛"
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button onClick={submit}>追加</button>
      </div>
      <div class="sw-divider" />
      {words.length ? (
        words.map((w) => (
          <div class="sw-word-row" key={w}>
            <span aria-hidden="true">⚠️</span>
            <span class="sw-word-name">{w}</span>
            <button class="sw-icon-btn" aria-label={`${w} を削除`} onClick={() => onDelete(w)}>
              ✕
            </button>
          </div>
        ))
      ) : (
        <div class="sw-empty">登録された商品はありません</div>
      )}
    </div>
  );
}
