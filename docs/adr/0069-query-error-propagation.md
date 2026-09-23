# ADR 0069: 画面のSupabaseクエリは、取得エラーを既定で例外にする

## ステータス

採用（2026-09-23）

## 背景

phase a（[analysis-visualization-upgrade](../design/analysis-visualization-upgrade/spec.md)）のタスク T0-1 は「`fetchAllByIn` がページ取得エラーを握りつぶす」1関数の修正だった。着手前に根本原因を調べた結果、**同じ欠陥が76箇所あり、同型の障害が4層で再発している**ことが分かったため、1関数の修正ではなく構造的な対策に切り替えた。

### 実測（2026-09-23、`src/services/supabaseDataService.js` 6597行）

| 項目 | 値 |
|---|---|
| Supabaseクエリ | 91件（`.from()` 87 + `.rpc()` 4） |
| error をチェックして `throw` | **10件** |
| error をチェックして握りつぶす | **70件** |
| error を参照すらしない | **6件** |
| 特定エラーのみ分岐 | 1件 |
| 失敗を表す値の方言 | **11種類** |
| 呼び出し側から失敗を検知できない | **77件中73件** |

実害の重さで分けると **重大12 / 中57 / 軽8**。「重大」は失敗すると集計結果が黙って間違うもので、例えば次がある。

- `getAccuracy`（1673行）: `if (error || !page || page.length === 0) break;` — **エラーと「取得完了」を完全に同一視し、ログすら出さない**。的中率・回収率・月別履歴が途中までのデータで計算される
- `fetchAllByIn`（326行）: 20関数が「entries（完全）× results（部分）」のMap結合をしており、欠けた分は `if (!result) return` で黙って母数から落ちる。回収率・決まり手構成比・逃げ率が縮んだ分母で出る
- `getMotorPowerIndex`（2608行）: `Promise.all` の各チャンクを `forEach` で走査し、エラーチャンクを `return` でスキップ

消費側（81件 / 35ファイル）も、**27件（33%）が catch して空配列にするだけ**で、サービス層を直しても画面に届かない状態だった。`ErrorBoundary` は0件。

### 同型の障害の履歴

| チケット | 層 | 状態 |
|---|---|---|
| BOA-291 | バッチ（0件書き込みを成功扱い） | Done |
| BOA-301 | 集計（ページネーション欠落で黙って切り捨て） | Done |
| BOA-352 | バッチ（`getRaceSchedule` 握りつぶしで全スキップ） | Backlog |
| BOA-356 | 監視（取得エラー握りつぶし） | Done |
| BOA-359 | フロント（取得失敗が「本日開催なし」に化ける・約20関数） | Backlog |
| BOA-369 | CI（Linear 401で連日失敗を検知できず） | Done |
| BOA-372 | バッチ（1000行上限で欠ける） | Backlog |

### 根本原因

`supabase-js` は失敗を例外ではなく `{ data, error }` で返すため、**「error を無視する」が最も短く書ける既定の書き方**になっている。加えて `[]` / `null` が「データなし」と衝突し、`withCache` がそれを 30分〜7日 保存するため、1回の失敗が長期間の誤表示として固着する。

決定的なのは、**「握りつぶさない」がオプトインだったこと**。`throwOnError = false` をパラメータに持つ関数が**8つ**、それぞれ独立に定義されていた（`fetchAll` / `getRaceSchedule` / `writeToSupabase` ほか）。同じ escape hatch を8回作り直している状態で、1回ごとの判断（既存挙動を壊さない）は毎回正しかったが、その積み重ねが全体として欠陥を固定した。

## 決定

**`supabase-js` 標準の `.throwOnError()` を、クライアント生成時に既定で適用する。**

`src/services/supabaseClient.js` で `.from()` / `.rpc()` をラップし、返された builder の `select` / `insert` / `update` / `upsert` / `delete` に `.throwOnError()` を自動で付ける。

```js
function applyThrowOnError(queryBuilder) {
  for (const method of BUILDER_ENTRY_METHODS) {
    const original = queryBuilder[method].bind(queryBuilder);
    queryBuilder[method] = (...args) => original(...args).throwOnError();
  }
  return queryBuilder;
}
```

実測で確認した性質（本番の匿名キーで7項目を実行）。

| 確認したこと | 結果 |
|---|---|
| 正常系で `{ data, error }` の形が保たれるか | **保たれる**（`error === null`） |
| 異常系（存在しない列）で例外になるか | なる（`PostgrestError`） |
| `order` / `range` のチェーンが壊れないか | 壊れない |
| 権限エラー（42501）も例外になるか | なる（`err.code === "42501"`） |

**成功時の戻り値の形が変わらないため、既存の呼び出し側87箇所は書き換え不要。** `if (error)` の分岐は到達しなくなるだけで害が無い。

あわせて次を行う。

1. **意図的にエラーを飲む2箇所を try/catch に移す** — `getRacePitReport`（権限エラーだけ「セクションを出さない」に倒す。phase a の FR-4 で 095/096 適用前に画面を壊さないためにも必要）、`getRaceMotorMaintenanceBreakdown`（新列未適用のときだけ旧列で再取得）
2. **throw 化で「永久スケルトン」になる2箇所に catch を足す** — `RaceBasicInfoTab`（公式勝率）・`RaceBeforeInfoTab`（今節展示情報）。どちらも同じファイル内の隣の effect では既に catch 済みという不統一だった
3. **消費側の無害化を解く** — `useRaceAnalysisData`（9件）・`useVenueTendencyStats`（4件）に `failed` / `hasFailure` / `reload()` を持たせ、`VenueCharacteristicsCard` は失敗時にカードを無言で消さない。新規の共通部品 `InlineFetchError` で表示する
4. **機械検査をCIに載せる** — `npm run verify:query-errors` と `.github/workflows/verify-query-errors.yml`
5. **読み取り側のルールを明文化する** — `.claude/rules/frontend-data-fetch.md`

## 却下した選択肢

### 却下1: `fetchAllByIn` の `break` を `throw` に変える（当初のT0-1）

**不適合点**: 76箇所のうち1箇所しか直らない。しかも `fetchAllByIn` は20関数から呼ばれるとはいえ、`getAccuracy`（的中率・回収率）や `getMotorPowerIndex` のように**独自にページネーションやチャンク分割を書いている箇所は救われない**。何より、これは「1つずつ直す」の8回目であり、同じ結果（別の場所に欠陥が残る）になる。

### 却下2: 自作のクエリラッパ（`selectOrThrow` / `selectPagedOrThrow`）を作る

エラーチェックを内包した薄いラッパを作り、87箇所を機械的に移行する。

**不適合点**: `.throwOnError()` が標準で存在するので**車輪の再発明**になる。加えて87箇所の書き換えは、単体テストの無いこのリポジトリでは退行リスクが高い。標準APIをクライアント側で既定にすれば、呼び出し側は0箇所の変更で済む。

### 却下3: `fetchAllByIn` / `fetchAll` に `throwOnError` オプションを足す（バッチ側と同じ流儀）

**不適合点**: **これが8回目の escape hatch になる**。既に `throwOnError = false` を持つ関数が8つあり、既定が unsafe である限り、渡し忘れた箇所から同じ事故が起きる。`fetchAll` の JSDoc が「監視のように『取得失敗を空データ＝正常と誤判定してはいけない』用途で指定する」と書いているのが象徴的で、**誤判定してはいけないのは監視だけではない**。既定そのものを反転させないと解決しない。

### 却下4: `withCache` 側で防ぐ

`withCache` が「空配列・null はキャッシュしない」ようにする。

**不適合点**: 「取得できて0件」を正当にキャッシュできなくなり、開催の無い会場・出走履歴の無い新人で毎回クエリが走る。BOA-357（Disk IO Budget枯渇）と逆行する。そもそも `withCache` は例外時に保存しないので、例外に寄せれば自動的に満たされる。

### 却下5: ErrorBoundary を導入する

**不適合点**: 対象は全て非同期の Promise reject なので、`ErrorBoundary` は発火しない（render 中の例外だけを捕まえる）。壊れ方は「スケルトンのまま固まる」であり、ErrorBoundary では防げない。導入自体は別途の価値があるが、本件の対策にはならない。

## 影響

- **画面の挙動が変わるのは「取得に失敗したとき」だけ**。正常系は一切変わらない
- 従来「空表示」だったものが、失敗時は `InlineFetchError`（セクション単位の再試行ボタン付き）になる。**「データなし」と「取得失敗」が初めて見分けられる**
- `withCache` が失敗をキャッシュしなくなるため、**一時的なエラーが30分〜7日固着する問題が解消する**
- 消費側で既に error 分岐を持っていた48件は、**今まで reject が来なかったため事実上デッドコードだったものが機能し始める**
- **バッチ側（`scripts/`）は本ADRの対象外**。`scripts/lib/supabaseClient.js` の `fetchAll` は `throwOnError = false` が既定のまま残る（呼び出し121箇所への影響確認が別途必要）。BOA-359 のバッチ側として別対応とし、`verify-query-errors.js` の `BATCH_TODO` に記録した
- 見直しの契機: バッチ側を同じ既定に揃えるとき、および `ErrorBoundary` を導入するとき
