---
paths:
  - "src/**"
---

# 画面のデータ取得ルール（取得失敗を「データなし」に化けさせない）

`src/**` 編集時のみ自動読み込み。書き込み側（バッチ・Cron）のルールは `.claude/rules/data-acquisition.md`。

## なぜこのルールがあるか

読み取り側（画面）は、取得に失敗しても画面が空になるだけで止まらないので、失敗が見過ごされやすい。失敗を握りつぶすのが既定で、握りつぶさないのがオプトインだと、同型の障害がフロント・バッチ・監視・CI で繰り返し起きる。以下は、失敗を既定で上に伝える側に倒すための規則。

## 1. Supabaseクライアントは1つの入口に閉じる（機械検査あり）

- **`src/` 配下で `createClient()` を呼ばない。`@supabase/supabase-js` を直接importしない。** 必ず `src/services/supabaseClient.js` の `supabase` を使う
- このクライアントは `.from()` / `.rpc()` の結果に supabase-js 標準の **`.throwOnError()` を既定で適用する**ため、クエリが失敗すると戻り値ではなく例外（`PostgrestError`）になる
- **成功時の戻り値の形は変わらない。** 失敗は戻り値の `error` ではなく例外で来る。`src/services/` では `const { data } = await supabase.from(...)` と書き、`error` を受け取らない（`if (error)` の分岐は到達しないうえ、「この関数は例外を投げない」という誤った前提を生む。`verify:query-errors` の検査8が止める）
- `npm run verify:query-errors` が機械検査する（PR時にQuality Gates CI＝`.github/workflows/quality-gates.yml` が `npm run verify:ci` の一部として自動実行する。ADR-0072。専用ワークフロー `verify-query-errors.yml` は統合して廃止）

## 2. エラーの内容で分岐したいときだけ try/catch する

握りつぶすための catch は書かない。**特定のエラーを別の意味に倒したいときだけ**書き、なぜそう倒すのかをコメントに残す。既存の実例は2つだけ。

- `getRacePitReport`: 権限エラー（`code === "42501"`、マイグレーション未適用）のときだけ「セクションを出さない」に倒す。本番の公開順序の保険
- `getRaceMotorMaintenanceBreakdown`: 「column does not exist」（新列が未適用）のときだけ旧列で再取得する

それ以外のエラーは `throw` で上流に流す。**`return []` / `return null` で「データなし」に化けさせない。**

## 3. 消費側（コンポーネント・フック）は失敗を状態として持つ

サービス層を例外にしても、消費側が `.catch(() => setX([]))` で握りつぶすと画面は何も変わらない。実測で**81件中27件がこの形**だった。

- **`.catch(() => null)` だけの catch を書かない。** 失敗したことを state に残す（`failed` / `hasFailure` 等）
- 失敗時は **`InlineFetchError`**（セクション単位、`onRetry` で該当箇所だけ再取得）または **`DataFetchError`**（ページ全体、`window.location.reload()`）を出す。「データがありません」「対象外です」と同じ表示に倒さない
- **catch を完全に省略しない。** 未処理のPromise拒否になるだけでなく、state が初期値のまま残って**スケルトンが永久に消えない**ことがある（`RaceBasicInfoTab` / `RaceBeforeInfoTab` で実際に起きた）
- 参考実装は `src/components/race/RacePitReportSection.jsx`。学べる点は4つ
  1. 取得結果を `raceId` とセットで持つ（props だけ変わったときに前レースのデータが混ざらない）
  2. 失敗も `failedRaceId` として raceId 付きで持つ（戻ってきて成功したらエラー表示が消える）
  3. `loading` を state ではなく `!report && !failed` から導出する（3状態が排他になり、失敗したまま「読み込み中」が残らない）
  4. `window.location.reload()` ではなく `reloadKey` でセクション単位に再試行する

## 4. キャッシュに失敗を焼き付けない

`withCache` は `inferTtlFromKey` により、末尾が `YYYY-MM-DD-VV-RR` 形式で過去日付のキー（`race-*-${raceId}`）に **7日**、それ以外（`racer-*` / `venue-*`）に **30分** のTTLを与える。

- 取得失敗をキャッシュすると、リロードしても直らない誤表示として固着する。**例外を投げれば `withCache` は保存しない**ので、上記1〜2を守れば自動的に満たされる
- 例外ではなく戻り値で「終端でない状態」を表す場合（`state: "forbidden"` / `"pending"` 等）は、**必ず `fetchFailed: true` を付ける**。`withCache` はこのフラグを見てキャッシュを回避する

## 5. ページネーションはヘルパ経由にする

Supabaseのデフォルト上限は1000行。`.in()` や `.gte()` で1000行を超えうるクエリは `fetchAllByIn` 等の `.range()` ループを使う。上限に達しても**エラーにならず黙って切り捨てられる**ため、気づけない（BOA-301・BOA-372）。

選手単位の730日窓の関数は、DB に溜まった期間が短いうちは1000行に届かないだけで、データが溜まると届く。窓を伸ばす変更や、データが2年分に近づいたときは実測し直す。

## 6. 表示カバレッジ台帳はPRに含めない（マージ後にCIが作り直す）

生成物 [`docs/reference/display-coverage.md`](../../docs/reference/display-coverage.md) は**手で編集しない。PRにも含めない**。
画面（`src/`）・API（`api/`）が読むテーブルを増やした、または新しいテーブルを定義しても、
台帳の更新はmasterへのマージ後に `regenerate-generated-docs.yml` が行う（ADR-0078）。
PRに含めると、並行する他のPRが同じファイルでコンフリクトする。PRで台帳を変更すると
`verify-generated-docs-not-in-pr.js` がCIで落とす。

変更の影響を手元で見たいときは `npm run generate:display-coverage` で作り直して差分を読み、
コミットせずに `git checkout -- docs/reference/display-coverage.md` で戻す。
PRで検査するのは抽出ロジックと「生成が成功するか」（`npm run verify:display-coverage`）。

この台帳が答えるのは「**取得したデータが画面に繋がっているか**」。プロジェクトのゴールが
「公式・各会場公式・ボートレース日和で取得しているデータを全て表示する」ことなのに対し、
取得側の棚卸し（`docs/design/scraping-vercel-consolidation/` の `data-catalog.md`・
`job-inventory.md`・`orchestration.md`）に対して、表示側の到達度をこの台帳で追う。取得しているのに
読み手が無いテーブルや、匿名SELECT権限が無いため画面から読めないテーブルを見つけるため。

意図的に表示しないテーブルは `scripts/maintenance/display-coverage-exceptions.json` に
**理由付きで**登録する。「今は使っていない」は理由にならない（それは表示すべきものの可能性がある）。
本番DBの実際の権限は台帳では見ない。それは `scripts/maintenance/check-anon-access.js`
（実接続が要るため manual tier）の担当。
