# ADR 0074: RPCのキー取りこぼしは、SQLファイル同士の比較でCIが止める

## ステータス

採用（2026-09-25）

## 背景

`CREATE OR REPLACE FUNCTION` は関数定義を丸ごと置き換える。古い版を土台に書き始めると、その間に別のマイグレーションが足したキーが**黙って消える**。

本プロジェクトでは同型の回帰が**2回**起きている。

| 件 | 何が消えたか | 発覚まで |
|---|---|---|
| BOA-363 | 048 が入れた `cancellationStatus` が 051・062・066 に上書きされた | 本番で数日間 |
| **BOA-431** | 102（当初063、PR #824）が068ではなくそれ以前の定義を土台にし、`seriesDay` / `isFinalDay` / `raceTitle` / `raceStage` と `LEFT JOIN race_conditions` が消えた | 別件の調査中に偶然発見 |

### なぜ既存の検査で止まらなかったか

`scripts/maintenance/verify-rpc-output-keys.js` は、まさにこれを検知するために BOA-363 の再発防止として書かれた。しかし**本番Supabaseへの接続が必須**のため Quality Gates CI（[ADR-0072](0072-verify-script-registry-and-ci.md)）に載せられず `tier=manual` に分類され、定期実行の仕組みが無いまま誰も実行していなかった。

他の検査も通り抜ける。

- **DDLとしては正常**。構文エラーにならない
- **E2Eでは検知できない**。`api/races/today.js` の主経路は `...race` のスプレッドで素通しし、`supabaseDataService.js` の直接クエリfallbackは `race_conditions` を明示マップするため、**主経路とfallbackでレスポンスの形が食い違っても画面は壊れない**
- **型検査も効かない**。JavaScriptで、RPCの戻り値に型定義が無い

BOA-431 は、RaceCard の優勝戦・準優勝戦バッジが本番で出なくなっていたが、誰も気づかないまま運用されていた。

## 決定

**`scripts/maintenance/verify-rpc-key-regression.js` を新設し、`tier=ci` でPRごとに実行する。**

`docs/db-migration/` の各 `.sql` から `CREATE OR REPLACE FUNCTION <名前>` のブロックを切り出し、その中の `json_build_object` のキー（`'キー名',`）を集める。同じ関数を定義するファイルを番号順に並べ、**最新の定義が、それ以前のどの定義にもあったキーを失っていないか**を検査する。

本番接続もDB接続も要らず、**SQLファイル同士の比較だけで完結する**のでCIに載せられる。

### 既存の乖離は凍結する

導入時点で3キー（`score` / `reasons` / `recommendedModel`）が既に失われていた。3モデル体系（本命/スタンダード/穴）のunified一本化に伴う意図的な撤去と判断し、`ALLOWED_KEY_REMOVALS` に理由つきで凍結した。根拠は3つ。

- 本番の3関数（`get_today_races` / `get_predictions_by_date` / `get_predictions_by_date_light`）すべてで、この3キーが既に存在しないことを `pg_get_functiondef` で確認
- `src/` にこれらのキーを読む箇所が無いことを確認（`supabaseDataService.js` の `data.reasons` は `bet_recommendations` テーブルの列であって、RPCの `'reasons'` キーとは別物）
- 画面は正常に動作しており、欠落による実害が出ていない

`verify-migration-numbers.js` の `ALLOWED_DUPLICATES` と同じ方式で、**既存の乖離を凍結して新規の発生だけを止める**。

### 手元実行の `verify-rpc-output-keys.js` は残す

役割が違う。

| | 何を見るか | どこで走るか |
|---|---|---|
| `verify-rpc-key-regression.js`（新規） | マイグレーション同士の整合。「書いたSQLがキーを落としていないか」 | **PRごとにCI** |
| `verify-rpc-output-keys.js`（既存） | 本番の実物とフロントの参照の整合。「実際に本番に何が入っているか」 | 本番適用後に手元 |

前者は**書く時点で**止める。後者は適用漏れ・手動変更・CIをすり抜けた経路を拾う最終確認。CLAUDE.md には後者を「本番適用したら実行する」として残した。

## 結果

- **BOA-431の欠落を実際に検知することを確認した。**103（復旧マイグレーション）を外した状態で実行すると、消えた4キーを「どのマイグレーションで入ったものか」まで示して失敗する。

  ```
  get_today_races（最新の定義: 102_add_cancellation_status_to_today_races_rpc.sql）
    - 'seriesDay' が消えている（038_add_series_day_to_race_rpcs.sql で入ったもの）
    - 'isFinalDay' が消えている（038_add_series_day_to_race_rpcs.sql で入ったもの）
    - 'raceTitle' が消えている（038_add_series_day_to_race_rpcs.sql で入ったもの）
    - 'raceStage' が消えている（062_add_race_stage_to_race_rpcs.sql で入ったもの）
  ```

  PR #824 の時点でこの検査がCIにあれば、そこで止まっていた。
- Quality Gates の `ci` 層が54本から55本になった。実行時間への影響は実質ゼロ（ファイル読み込みのみ）。

## 限界

- **キーの抽出は正規表現によるもの**で、`json_build_object` の構造を解析しているわけではない。`'キー名',` の形に合致する文字列リテラルをすべて拾うため、キー以外の文字列も混じりうる。ただし「以前あったものが消えていないか」という差分の比較なので、両方に同じノイズが乗る限り誤検知にはならない。
- **キーの値が変わった場合は検知できない**。`'raceStage', rc.race_stage` が `'raceStage', NULL` になっても通る。
- **ファイル上の整合しか見ない**。本番に実際に何が入っているかは `verify-rpc-output-keys.js` の担当。

## 検討したが採らなかった案

- **`verify-rpc-output-keys.js` を夜間ワークフローでsecrets付き実行する**: 本件では採らなかった。本番DBへ接続するワークフローを増やす影響が大きく、かつ「本番に入った後」でしか検知できないため予防にならない。ファイル比較でPR時に止めるほうが早い。
  **ただし、その後 [ADR-0075](0075-merge-gate-and-worktree-data-guard.md)（PR #846）で `nightly-verify-db.yml`（毎晩JST3:00）として別セッションが実装した。**両者は役割が異なり、併存させる。本ADRの検査は「書いたSQLがキーを落としていないか」をPR時に止め、夜間ワークフローは「本番の実物がフロントの参照と合っているか」を継続的に見る。適用漏れ・手動変更・この検査をすり抜けた経路は後者でしか拾えない。
- **RPCの戻り値に型定義を持たせる（TypeScript化 / `generate_typescript_types`）**: 効果は大きいが、プロジェクト全体のTypeScript移行を伴う。本件のスコープを大きく超える。
