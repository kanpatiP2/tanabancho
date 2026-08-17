# 外部JAN照会 スパイク結果（P3-G）

実測日: 2026-08-17 / 実測者: P3-G

## 対象データ

実店舗の学習辞書（`test-fixtures-local/tanabancho_localStorage_dump.json` の
`barcode_master_db` のキー）から **JAN 187件**。内訳は 13桁 178件 / 8桁 6件 / 12桁 3件。

> 外部へ送ったのは JAN 番号のみ。辞書の商品名・APIキー等は送っていない。

## 結論（先に要点）

| | |
|---|---|
| **採用** | Open Food Facts のみ（認証不要・CORS 開放・**リレー不要**） |
| **的中率** | **79/187 = 42.2%**（うち日本語名は 51件 = 全体の 27.3%） |
| **リレーの要否** | **不要**。Cloudflare Workers リレーは立てない |
| **JANCODE LOOKUP** | **サービス停止中**（ドメインパーキング）。実装だけ入れて appId 未設定で無効 |

Open Food Facts だけでブラウザから直接叩けるため、当初想定していた
Cloudflare Workers のリレーは **不要**。リレーが要るのは下表で CORS 不可の情報源を
使いたくなった場合だけ。

## 情報源ごとの実測

### 1. Open Food Facts ★採用

- エンドポイント: `https://world.openfoodfacts.org/api/v2/product/{JAN}.json?fields=...`
- 認証: **不要**

| 項目 | 実測値 |
|---|---|
| 的中（名前あり） | **79 / 187 = 42.2%** |
| 登録はあるが名前が空 | 6 / 187（ミス扱い） |
| 未登録（404 / status:0） | 102 / 187 |
| CORS | **`Access-Control-Allow-Origin: *`** → ブラウザから直接可 |
| レート制限 | 商品参照 **100 req/分**。超過で `429` |

**名前の質**（ここが実運用上の争点）

- 的中79件のうち、日本語（かな/漢字）を含む名前は **51件（65%）**
- 残り28件は英字・ローマ字表記。例: `Natural Mineral Water`（サントリー天然水）、
  `Boss coffee Zeitaku Bitou`、`gogo no kocha oishi moto darjeeling tea &quot;kirin&quot;`
- **HTML エンティティが生で入っている**ケースあり（`&quot;`）→ プロバイダ側でデコード済み
- `product_name_ja` があるものは 48件。実装は **ja → 既定 → en** の順で採用する

**レート制限の実測メモ**

300ms 間隔（= 200 req/分）で回したところ **187件中151件が 429**。
しかも一度 429 に入ると連続して 429 が返り続ける（単純なトークンバケットではなく
ペナルティ期間がある挙動）。1500ms 間隔（= 40 req/分）で再試行したところ
151件中 429 は14回のみで、いずれもリトライで回収できた。

→ 実アプリはスキャン都度の単発照会なので通常は制限に当たらない。
一方**キューの一括フラッシュは連投になるため、実測値に合わせて
`FLUSH_SPACING_MS = 1500` の間隔を入れてある**（`src/lookup/index.ts`）。

**利用規約上の注意**

- データは **Open Database License (ODbL)**、商品名等は Database Contents License。
  社内の棚札運用に使う分には問題ないが、**再配布時は出典表示が要る**。
- OFF は User-Agent での自己申告を求めているが、**ブラウザの fetch では
  User-Agent を設定できない**（禁止ヘッダ）ため付けていない。
- 食品DBなので**日用品・雑貨・化粧品はほぼ入っていない**。42%という数字は
  対象辞書が食品中心だから出た値で、雑貨主体の店ではさらに下がる。

補足: `world.openproductsfacts.org` / `world.openbeautyfacts.org` も試したが、
同一バックエンドで「食品として登録済み」を指す 404 を返すだけで、
**別途の的中は増えない**。food エンドポイント1本でよい。

### 2. JANCODE LOOKUP ✗ サービス停止中

- **2026-08-17 時点で `www.jancodelookup.com` / `api.jancodelookup.com` とも
  ドメインパーキング用の HTML（parklogic の広告リダイレクトスクリプト）を返す。**
  `Content-Type: text/html`、`Server: openresty`。JSON API は応答しない。
- 検索エンジン上の記述でも「データ再構築中...近日オープン予定」とあり、稼働していない。
- 認証: appId が必要（従来は無料のユーザー登録制）。**新規登録も現状不可**。
- CORS: サービスが動いていないため **判定不能**。

→ 復旧に備えて `src/lookup/providers/jancodelookup.ts` に実装だけ置き、
**appId 未設定（既定 `''`）ならプロバイダごと組み立てない**。
HTML が返ったら JSON パース失敗を検出して throw し、Open Food Facts へフォールバックする。

### 3. その他に調べたもの

| 情報源 | 認証 | CORS | 判定 |
|---|---|---|---|
| **楽天市場 商品検索API** | 要 applicationId（無料登録） | **`ACAO: *`** ✅ | 将来の有力候補。日本の商品に強い |
| **Yahoo!ショッピング 商品検索API** | 要 appid | **無し** ❌ | 使うならリレー必須 |
| **UPCitemdb（trial）** | 不要 | `ACAO: https://www.upcitemdb.com` ❌ | リレー必須。100req/日。名前は転売リスト由来の英語で質が低い |
| Open Products / Beauty Facts | 不要 | ✅ | OFF と同一DB。上乗せ無し |

補足:

- **楽天**は `applicationId` 不正でも `Access-Control-Allow-Origin: *` を返すことを確認済み。
  無料登録で使え、日本の商品名が取れるので **OFF の次に足すならここ**。
  ただし商品名は「店舗の出品タイトル」なので
  `送料無料 1ケース ...` のようなノイズが乗る（後処理が要る）。
- **Yahoo!** は `jan_code` で正しく JAN 一致検索でき、実測した3件中2件が的中したが、
  CORS ヘッダを一切返さないためブラウザから直接は叩けない。
  （`appid=dummy` でも応答が返ったが、規約上そこに依存すべきではない）

## 推奨構成（実装したもの）

```
scan（辞書ミス）
  → lookupJan(jan)
      → IndexedDB キャッシュ（idb-keyval, store 'tb-lookup'）
          ヒット/ミス記録があればそれを返す
      → プロバイダを順に試す
          1. JANCODE LOOKUP（appId 設定時のみ。既定は無効）
          2. Open Food Facts
      → 結果を保存:
          ヒット   … 180日キャッシュ
          確定ミス … 7日 negative cache
          通信失敗 … キャッシュせずキューへ（online イベントで再試行）
  → ヒットしたら learnProduct(jan, name, nameSource:'ext') + 履歴行/フラッシュカードを後追い更新
```

設計上の要点:

- **「確定ミス（DBに無い）」と「通信失敗（分からない）」を区別する。**
  前者だけ negative cache に載せる。429/5xx/ネットワーク断を negative cache に
  載せてしまうと、電波が悪かっただけの JAN が7日間照会されなくなる。
- キャッシュは localStorage ではなく **IndexedDB**。照会結果は件数が増えやすく、
  v2 キーの 5MB 枠を圧迫したくないため。失われても再取得できるデータ。
- 名前の優先度は `core/dict.ts` の `mergeProduct` に従う（**manual > gemini > ext**）。
  外部照会が手入力の名前を上書きすることはない。

## 運用上の期待値

- **未知JANの4割強に名前が付く。日本語名が付くのは3割弱。**
  「全部埋まる」機能ではなく「手入力の手間が4割減る」機能として案内するのが妥当。
- 雑貨・日用品が多い売場では的中率はさらに下がる。
  改善したい場合の次の一手は **楽天市場APIの追加**（CORS OK・無料登録・要タイトル整形）。
