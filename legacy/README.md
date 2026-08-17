# tanabancho
棚番長 / 売場スキャン（汎用版）
- 小売現場向けバーコードスキャン業務ツール
- 自社版: index.html / share.html（tanabancho リポジトリルート）
- 汎用版: public/index.html / public/share.html
- localStorage キー: 自社版=barcode_master_* / 汎用版=sellfloor_*
- 設定データ: 自社版=tanabancho_settings / 汎用版=sellfloor_settings
- 主な機能: スキャン・履歴管理・POP（販促物）・指定日アラート・案件管理・画像化・共有URL
## 棚番長ファミリー

| ツール | 説明 | パス |
|--------|------|------|
| 棚番長 | バーコードスキャン・売場管理 | `/` `/public/` |
| 仕分番長 | 納品荷受け・仕分け作業支援 | `/shiwake/` |

### 仕分番長の主な機能
- 納品明細書をAI（Gemini）で自動読み取り
- 複数枚を1リクエストで一括処理（API節約）
- 要注意商品の事前登録・アラート表示（ひらがな検索対応）
- JANバーコード表示（ITF-14自動変換）
- 便メモ・商品メモ・過去履歴保存
- localStorageによるセッション復元
