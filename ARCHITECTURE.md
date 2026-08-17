# 棚番長 v2 アーキテクチャ

計画の原本: `C:\Users\tattu\.claude\plans\witty-soaring-willow.md`（承認済み）

## 構成

- Vite MPA 3エントリ: `index.html`（本体）/ `share.html`（共有ビュー）/ `shiwake/index.html`（仕分番長）
- `src/core/types.ts` が全モジュールの契約書。**破壊的変更は統合担当（本体セッション）の承認が必要**
- `legacy/` は現行v1のスナップショット。ビルドで `dist/v1/` に同梱（触らない）
- `test-fixtures-local/` は実データ（**gitignore済・コミット厳禁**: APIキー・第三者の個人情報を含む）

## モジュール所有権（P1 並行作業）

| パス | 担当 | 内容 |
|------|------|------|
| src/core/storage.ts, migrate.ts, backup.ts | P1-A | 永続化・v1→v2移行・バックアップI/O |
| src/core/share-codec.ts, src/share/ | P1-B | 共有プロトコル・共有ビューUI |
| src/core/jan.ts, src/scanner/ | P1-C | JAN正規化・カメラ/ウェッジ・scanIntent |
| src/app/ | P1-D | 本体UI（5タブ） |
| src/shiwake/ | P1-E | 仕分番長 |
| src/core/dict.ts | P1-A が定義、P1-E が利用 | 辞書 merge（manual > gemini > ext） |
| src/lookup/, src/order-export/ | P3 | 外部JAN照会・発注エクスポート |

共有ファイル（types.ts / profile.ts / datetime.ts / tokens.css / vite.config.ts / package.json）は原則変更しない。
必要な変更は統合担当に依頼すること。

## ルール

- `innerHTML` / `dangerouslySetInnerHTML` / `document.write` は禁止（XSS対策。描画は必ず JSX 経由）
- 色・サイズはリテラル禁止。`src/core/tokens.css` の CSS 変数を参照
- `alert` / `confirm` / `prompt` は禁止（ボトムシート + Undo付きトーストで代替）
- 日時は ISO 8601 で保存し、表示変換は `core/datetime.ts` を使う
- v1 の localStorage キー（`LEGACY_KEYS`）への書き込みは migrate.ts 以外禁止。読み取りも migrate 経由のみ
- `npm test`（Vitest）と `npm run build`（tsc --noEmit 含む）が通ることを完了条件とする
