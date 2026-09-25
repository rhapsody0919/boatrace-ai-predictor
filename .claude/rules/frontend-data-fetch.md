---
paths:
  - "src/**"
---

# 画面のデータ取得ルール（取得失敗を「データなし」に化けさせない）

`src/**` 編集時のみ自動読み込み。書き込み側（バッチ・Cron）のルールは `.claude/rules/data-acquisition.md`。

## なぜこのルールがあるか（2026-09-23策定、BOA-359）

書き込み側には「0件書き込みを成功扱いにしない」というルールが既にあったが、**読み取り側（画面）には対応するルールが1つも無かった**。書き込み側はバッチが止まるので障害として認識されるが、読み取り側は画面が空になるだけで止まらないため、ルール化の契機が生まれなかった。

その結果、次の状態が長期間放置された（2026-09-23の実測）。

| 実測項目 | 値 |
|---|---|
| `supabaseDataService.js` のクエリ | 91件（`.from()` 87 + `.rpc()` 4） |
| うち error をチェックして throw | **10件** |
| うち error をチェックして握りつぶす | **70件** |
| うち error を参照すらしない | **6件** |
| 失敗の表現の方言 | **11種類** |
| 呼び出し側から失敗を検知できない割合 | **77件中73件** |
| 消費側で catch して空配列にするだけ | **81件中27件（33%）** |
| ErrorBoundary | **0件** |

同型の障害は **BOA-291 / 301 / 352 / 356 / 359 / 369 / 372** と、フロント・バッチ・監視・CIの4層で再発している。原因は個々の不注意ではなく、**「握りつぶす」が既定で「握りつぶさない」がオプトインという設計**（同じ `throwOnError` フラグが8関数に独立して再発明されていた）。

## 1. Supabaseクライアントは1つの入口に閉じる（機械検査あり）

- **`src/` 配下で `createClient()` を呼ばない。`@supabase/supabase-js` を直接importしない。** 必ず `src/services/supabaseClient.js` の `supabase` を使う
- このクライアントは `.from()` / `.rpc()` の結果に supabase-js 標準の **`.throwOnError()` を既定で適用する**ため、クエリが失敗すると戻り値ではなく例外（`PostgrestError`）になる
- **成功時の戻り値の形は変わらない。** `const { data, error } = await supabase.from(...)` はそのまま動く（`error` が非nullになる前に例外が出る）
- `npm run verify:query-errors` が機械検査する（`.github/workflows/verify-query-errors.yml` でPR時に自動実行）

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

2026-09-23時点で `.range()` 漏れは0件。ただし選手単位の730日窓の3関数は、DBが約10ヶ月分しか無いから安全なだけ（選手1人あたり最大265行）。2年分溜まると約2倍になるので、窓を伸ばす変更をするときは実測し直す。
