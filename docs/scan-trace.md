# スキャン挙動トレース（v2 / renewal-v2）

実コードを追って「入力がこう来たらこうなる」を固定した記録。行番号は本ドキュメント作成時点のもの。
`npm test` の `src/app/scan-flow.test.ts` が、ここに書いた挙動をそのまま検証している。

---

## 0. 全体像

```
 カメラ  BdScanner/H5Scanner.start() の onDetect      scanner/camera.ts:230 / :324
 ウェッジ startWedgeListener の commit()               scanner/wedge.ts:84
 手入力  SearchSheet.onPick / FieldScanSheet の「入力」  app/scan/SearchSheet.tsx:22 / FieldScanSheet.tsx:63
    │
    └─▶ dispatchCode(raw, source)                     app/scan-bridge.ts:161   ← 合流点はここ1箇所
           │  空・URL・記号混じりを門前払い（null）
           ▼
        session.input(code, source)                   scanner/session.ts:290
           │ 1. resolveCode（ITF-14変換 → 箱JAN置換 → leadingZero）  core/jan.ts:101
           │ 2. 重複判定（capture / expiry / pop のみ）  → onDuplicate
           │ 3. 辞書照合 lookupProduct（products signal）
           │ 4. intent 別に振り分け
           ▼
        handlers（UIフックは ScanTab が実装）           app/scan/handlers.ts:51
           ├ capture   → registerScan()                app/scan/draft.ts:136
           ├ expiry    → registerScan() + 提案を保留    app/scan/handlers.ts:100
           ├ pop       → registerScan({pop})            app/scan/handlers.ts:60
           ├ order     → addToOrder()                   app/scan/draft.ts:256
           ├ compCheck → compPending に照合結果          app/scan/handlers.ts:74
           └ field     → deliverFieldScan()（one-shot）  app/scan/field-scan.ts:61
```

- intent の遷移・field の one-shot 復帰・期限提案の保留は **すべて `@scanner/session`**（純ロジック）。
- `scan-bridge` は「session ⇄ カメラ/ウェッジ/store/UI」を結ぶ配線だけを持つ。
- `handlers.ts` は intent 別の判断（DOM 非依存）。トースト・期限パッド・触覚は `ScanUiHooks` で外から注入。

---

## 1. カメラ経路

| # | 場所 | 起きること |
|---|------|-----------|
| 1 | `app/tabs/ScanTab.tsx:296` カメラ枠タップ | `toggleCamera()` → `startCamera(VIDEO_CONTAINER_ID)` |
| 2 | `scan-bridge.ts:227` `startCamera` | `createScanner(cameraOptionsFromSettings(settings))` で毎回作り直す（fps/AF/読取枠は生成時に決まるため） |
| 3 | `scanner/camera.ts:366` `createScanner` | `BarcodeDetector` が ean_13 を扱えれば `BdScanner`、でなければ `H5Scanner`（html5-qrcode を動的 import） |
| 4 | `camera.ts:213` rAF ループ | `shouldSample()` で fps 間引き → `detect()` |
| 5 | `camera.ts:229` / `:323` | `createDeduper(1500ms)` が同一コードの連投を落とす（別コードは即受理＝流し読み可） |
| 6 | `scan-bridge.ts:231` | `onDetect` → `dispatchCode(raw, 'camera')` |

- 連続スキャン: `createScanSession(..., { continuous: true })`（`scan-bridge.ts:83`）。v1 の「1件ごとに停止」はやめ、deduper で代替している。
- 画面が隠れると `camera.ts:207` / `:330` の `visibilitychange` でアダプタが自分で止まる。
  **v2 ではこれに合わせて `scan-bridge.ts:210 watchVisibility()` も `cameraState` を `idle` に戻す**（後述の修正2）。

## 2. ウェッジ経路

| # | 場所 | 起きること |
|---|------|-----------|
| 1 | `ScanTab.tsx:123` / `FieldScanSheet.tsx:52` | `settings.inputSource === 'wedge'` のとき `attachWedge()`（カメラは停止） |
| 2 | `scanner/wedge.ts:105` keydown(capture) | input/textarea/select/contenteditable にフォーカスがあれば**素通し** |
| 3 | `wedge.ts:112` | Enter＝確定（4桁以上・500ms 以内）／無入力 80ms＋8桁以上でも確定 |
| 4 | `wedge.ts:87` `commit()` | `onCode(code, 'wedge')` → `scan-bridge.ts:277` → `dispatchCode(code, 'wedge')` |

以降はカメラと完全に同じ道を通る（合流済み）。

## 3. 手入力・辞書検索経路

| # | 場所 | 起きること |
|---|------|-----------|
| 1 | `ScanTab.tsx:156` 🔍ボタン | `SearchSheet` を開く |
| 2 | `app/scan/SearchSheet.tsx:20` | `searchProducts(products, q)` でコード・商品名の部分一致（最大10件） |
| 3 | `SearchSheet.tsx:22` `submit()` / `:59` サジェスト選択 | `onPick(code)` |
| 4 | `ScanTab.tsx:230` | `dispatchCode(code, 'manual')`。戻り値 `null`（＝コードとして解釈不能）だけトースト。重複は `setDuplicateHandler` 側が通知する |

## 4. 具体例: ITF-14 `14901234567893` を **capture** で読む

```
dispatchCode('14901234567893', 'camera')            scan-bridge.ts:161
 └ session.input()                                  session.ts:290
    ├ raw = '14901234567893'（空白除去済み）
    ├ resolveCode(raw, boxJanLookup, {convertItf:true})            jan.ts:101
    │   digits = '14901234567893'（14桁）
    │   itfToJan: 先頭1桁を落とした '490123456789' に CD 再計算 → '4901234567894'   jan.ts:73
    │   fromItf = true
    │   boxJanLookup('4901234567894')                              store.ts:290
    │     ├ ヒット（Product.boxJan が一致）→ jan = そのバラJAN, fromBoxJan = true
    │     └ 外れたら生桁 '14901234567893' でも引く（仕分番長の還流形式）※修正4
    │   leadingZero = false
    ├ 重複判定 isDuplicateJan('4901234567894')                     store.ts:176
    │   true → onDuplicate → トースト「リストに存在するコードです: …」＋ 振動(NG)、履歴は増えない
    ├ 辞書照合 products['4901234567894']
    └ onCapture → handleScannedCode()                              handlers.ts:51
        └ registerScan(resolved)                                   draft.ts:136
            ├ name = 下書きの商品名 || 辞書名 || ''
            ├ memo/genre/end/order = captureDraft をそのまま反映
            ├ boxJan = 辞書の boxJan
            ├ addScan(item)（先頭に積む・localStorage へ即保存）    store.ts:127
            ├ 名前が新規なら learnProduct(nameSource:'manual')、既知なら touchProduct
            ├ flash（結果フラッシュカード）に ITF変換/箱JAN変換の別を出す  ScanTab.tsx:345
            ├ resetCaptureAfterRegister()（📌維持の挙動）           draft.ts:56
            └ 名前が空 & ブラウザ環境なら resolveNameExternally()   draft.ts:198
                 → lookupJan（キャッシュ→provider→失敗はキュー）    lookup/index.ts:86
                 → 取れたら ①辞書へ ext ②履歴行が空欄なら埋める ③表示中のフラッシュを差し替え
```

## 5. intent 別の下流

### capture（通常）
- 下書き `captureDraft`（`draft.ts:38`）: 商品名・エンド・発注種別・ジャンル・コメント・📌維持。
- **📌維持 OFF** → 登録後に下書きを全消去。**ON** → 商品名だけ消して他は残す（`draft.ts:56`。legacy `finalizeRegistration` と同じ）。
- 「POP号数リセット」は v2 では **capture 下書きに POP が無い**ため対象なし（POP は専用モードへ分離）。
- 結果フラッシュカード（`ScanTab.tsx:345`）から取り消し（Undo トースト付き削除）ができる。

### expiry（期限）
```
1回目スキャン → registerScan(expiry:'')  → 提案があれば pending として session に預ける
              → トースト「提案 2026-08-22（次のスキャンで確定）」＋「今すぐ変更」
2回目スキャン → session が pending を commit（cause:'next-scan'）→ applyExpiry(1件目)
              → 2件目の提案が新しい pending になる
モード離脱   → commit（cause:'intent-change'）      session.ts:249
明示確定     → flushPendingExpiry()（「今すぐ確定」ボタン / スキャンタブ離脱時）
取消        → cancelPendingExpiry()（「今すぐ変更」→ 期限パッドへ）
```
- 提案値は `suggestExpiryFor()`（`draft.ts:232`）＝ `dict.suggestExpiryOffset()` の最頻オフセット。
- 学習が無い / 自動確定 OFF のときは、その場で期限パッド（`scan/ExpiryPad.tsx`）を開く。
- 確定時 `applyExpiry()`（`draft.ts:220`）が `learnExpiryOffset`（最新5件）と「直前と同じ」用の `lastExpiry` を更新。`noLearn` の行からは学習しない。

### pop
- `popDraft`（現在の号数組合せ）をそのまま `registerScan({pop})` に渡して即適用。
- 組合せは **次のスキャンにも残る**（同じ POP を連続で貼る運用）。クリアは「組合せをクリア」ボタン。

### order
- `addToOrder(jan, 1)` → `ensureOrderList()`（当日ラベルのリストを用意）→ `bumpOrderLine()`（`store.ts:404`）。
- 同一 JAN の再スキャンは **数量 +1**。履歴（ScanItem）には積まない。重複ガードの対象外。

### compCheck
- `competitors` から同 JAN を探し、`compPending` に `{jan, name, matched}` を置くだけ（履歴は増えない）。
- パネルの「📋 履歴に追加」で `addCompCheckToHistory()`（genre は `競合ヘッダー` 固定）。
- sticky。抜けるまで継続（v1 の `isCompCheckMode` と同じ）。

### field（one-shot「スキャンで入力」）
| 呼び出し元 | kind | 変換 | 反映先 |
|---|---|---|---|
| 履歴行の箱JAN欄 `list/HistoryRow.tsx:203` | `boxJan:<scanId>` | ITF変換あり / 箱JAN置換**なし** | `updateScan(boxJan)` ＋ `learnProduct(boxJan)`（`HistoryRow.tsx:260`） |
| 客注フォーム `more/CustomerOrders.tsx:269` | `custJan:new` / `custJan:<id>` | どちらも**なし**（伝票の生コード） | 新規フォームの下書き / 既存レコード |
| 返品フォーム `more/ReturnsAndComp.tsx:52` | `returnJan` | どちらも**なし** | 登録フォームの下書き |
| 競合フォーム `more/ReturnsAndComp.tsx:239` | `compJan` | ITF変換あり / 箱JAN置換あり | 下書き（辞書に名前があれば商品名も補完） |

流れ: `requestFieldScan()`（`field-scan.ts:50`）→ `session.beginFieldScan()` → `FieldScanSheet`（App 直下に常駐）が開いてカメラ/ウェッジ/手入力を受ける → `onField` → `deliverFieldScan()` → 呼び出し元の `useFieldScan(kind, …)` が値を消費 → session は **直前の intent へ自動復帰**。
画面遷移をしないので、入力途中のフォーム状態は保持される。

---

## 6. 共有ビュー（`src/share/`）との差

| 項目 | 本体 | 共有ビュー |
|---|---|---|
| 合流点 | `dispatchCode`（session 経由） | `addCode()` `share/state.ts:218`（session は使わない・意図的に軽量） |
| ITF-14 → JAN13 | `resolveCode`（`core/jan.ts`） | 同じ `resolveCode` を直接呼ぶ → **挙動一致** |
| 箱JAN 置換 | あり（学習辞書） | なし（辞書を持たない） |
| 重複 | 履歴 `scans` と照合 → トースト | 自分のスキャン一覧と照合 → 「既に登録済みです」 |
| 弾く条件 | `^https?:` / `[^0-9A-Za-z-]` | `^https?:` / `[^0-9A-Za-z]`（ハイフンも弾く） |
| カメラ停止 | `scan-bridge` が一元管理 | タブ内 `adapterRef` で自前管理・`visibilitychange` で停止 |

`14901234567893` は本体・共有ビューのどちらでも `4901234567894` になる（`share/state.test.ts` でも固定済み）。

---

## 7. 仕様との対応表

| 仕様（v1 / 設計） | v2 の実装 | 状態 |
|---|---|---|
| 通常登録（フラグなし） | intent `capture` | ✅ |
| `isCompCheckMode` | intent `compCheck`（sticky） | ✅ |
| `activeBoxJanScanId` | `beginFieldScan({kind:'boxJan:<id>', applyBoxJanLookup:false})` | ✅（修正1で結線） |
| `activeCompScan` | `beginFieldScan({kind:'compJan'})` | ✅（修正1で結線） |
| `activeSideScanType='return'/'cust'` | `beginFieldScan({kind:'returnJan'/'custJan:*', convertItf:false, applyBoxJanLookup:false})` | ✅（修正1で結線） |
| 重複は登録せず警告 | session の重複ガード → `onDuplicate` → トースト＋振動(NG) | ✅（修正3で session 側に集約） |
| ITF-14 → JAN13 | `resolveCode` / `itfToJan` | ✅ |
| 箱JAN → バラJAN | `store.boxJanLookup` ＋ 生桁フォールバック | ✅（修正4） |
| 📌維持は商品名だけ消す | `resetCaptureAfterRegister()` | ✅ |
| 期限は次スキャンで自動確定 | `ExpiryPending` → `onExpiryCommit` | ✅（修正2で結線） |
| 先頭0コードの確認ダイアログ | `ResolvedCode.leadingZero` を surface するのみ（`alert/confirm` 禁止のため） | ⚠️ UI 未実装（下記 残課題） |
| 学習無効（noLearn） | 期限オフセット・箱JAN学習で尊重 | ⚠️ 名前学習は登録時のみで対象外（下記 残課題） |

---

## 8. このトレースで見つけて直した問題

1. **「スキャンで入力」が存在しなかった**（P2 報告どおり `beginFieldScan` / `setFieldHandler` / `setRejectHandler` が未使用）。
   → `app/scan/field-scan.ts`・`app/scan/FieldScanSheet.tsx` を追加し、箱JAN・客注・返品・競合の各欄に 📷 ボタンを実装。
2. **期限モードの「次スキャンで自動確定」が未結線**。`onExpiry` の戻り値も `onExpiryCommit` も誰も使っておらず、実際には
   スキャンした瞬間に提案値で確定していた（チェックボックスの文言と不一致）。
   → `setCodeHandler` の戻り値で pending を預け、`setExpiryCommitHandler` で確定。確定待ちの表示・「今すぐ確定 / 取消」も追加。
3. **重複弾きが session 側で死んでいた**（`isDuplicate` / `onDuplicate` 未接続。通知自体は `registerScan` の戻り値で出ていた）。
   → session に集約し `setDuplicateHandler` で通知。`dispatchCode` は `ScanInputResult` を返すようにして、
   手入力の「解釈できません」と「重複」を出し分け。
4. **仕分番長が学習した箱JAN が本体で引けなかった**。`shiwake/build.ts:108` は生の ITF-14 を `Product.boxJan` に入れるが、
   `resolveCode` は ITF を JAN13 に変換した**後**で引くため常に外れていた。
   → `core/jan.ts:121` で変換後・生桁の両方を試すフォールバックを追加。
5. **箱JAN が学習辞書に入らなかった**。履歴行の箱JAN欄は `ScanItem.boxJan` を書くだけで `Product.boxJan` を更新せず、
   本体だけ使っていると箱JAN置換が永遠に効かなかった。→ `HistoryRow.tsx:260 setBoxJan()` で辞書にも紐付け。
6. **バックグラウンド復帰後にカメラ状態がズレた**。アダプタは `visibilitychange` で自分を止めるのに
   `cameraState` は `running` のままで、復帰後の1タップが空振りしていた。→ `scan-bridge.ts:210` で状態も同期。
7. **`noLearn` が無視されていた**。→ `applyExpiry`（期限オフセット）と箱JAN学習で尊重するようにした。

### 残課題（設計判断が要るので未修正）
- **先頭0コードの確認**: v1 は `confirm()` で「0から始まるコードです。登録しますか？」を出していた。v2 は `leadingZero` を
  渡すだけで UI が無い（`alert/confirm` 禁止＝ボトムシート実装が必要）。誤読の取り消しはフラッシュカードの「取り消し」で可能。
- **名前の衝突ダイアログ**: v1 の `showConflictModal`（辞書名 ≠ 入力名の選択）は v2 に無く、入力名が優先される。
- **`setRejectHandler` は今も未使用**: 空・URL は `dispatchCode` の手前で落としているため、`onReject` まで到達しない。
  「読めないコード」を可視化したいなら、ガードを session 側へ寄せる必要がある。
- **capture 下書きに POP が無い**: v1 はスキャン前に POP 号数を選べた（登録後は号数だけリセット）。v2 は POP モードへ分離済み。

---

## 9. 固定しているテスト

`src/app/scan-flow.test.ts`（jsdom / memory backend、30 ケース）

- 入力3経路の合流（カメラ・ウェッジ KeyboardEvent・手入力）／入力欄フォーカス時の素通し／URL・記号の門前払い
- ITF-14 変換・箱JAN 置換（本体形式・仕分番長形式）・leadingZero
- capture の下書き反映・📌維持 ON/OFF・辞書学習
- 重複（通知・モード非消費・正規化後の JAN で判定・発注モードは対象外）
- 期限の2連続スキャン自動確定シーケンス・flush・cancel・提案なし・自動確定 OFF・オフセット学習
- pop / order（同JAN +1）/ compCheck（照合と履歴追加）
- field 4種（箱JAN・返品・客注・競合）の変換差・one-shot 復帰・キャンセル・期限保留との共存
