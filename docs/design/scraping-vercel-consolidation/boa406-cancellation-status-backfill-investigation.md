# BOA-406調査: 中止・打ち切りレースのcancellation_status未設定

BOA-403（PR #807）の調査で発覚した、`race_results`欠損レースのうち「K-fileにそのレースの記録が無い（開催されなかった）」パターンについて、`races.cancellation_status`を是正すべきか調査した結果。**本調査は読み取り専用。本番DBへの書き込みは一切行っていない。**

## 対象範囲の再実測

`node scripts/maintenance/backfill-kb-recent-results.js plan --from=2025-12-03 --to=2026-03-31` を実行（2026-09-24時点）。

| 分類 | 件数 | 扱い |
|---|---|---|
| 対象期間の`race_results`欠損 | 677件 | — |
| `race_not_in_k_venue`（K-fileにそのレースが無い） | **269件** | 本チケットの調査対象 |
| `venue_not_in_k`（該当日のK-fileにその会場のブロック自体が無い） | 408件 | 対象外。`race_id`日付ズレ疑い（BOA-325/BOA-402系統、別問題） |

269件（チケット記載の実測値と一致）は35件の「会場×日」グループに集約される。

## 検証結果

### 1. cancellation_statusの現状

269件全件が`cancellation_status = NULL`。既に`confirmed`/`tentative`が設定されている行は0件（`plan`コマンドの「既に設定済み」注記も出力されず、分母修正は不要）。

`cancellation_check_streak`（暫定検知の内部カウンタ）も269件全件が`0`。当時この検知機構自体が存在しなかったため、一度もインクリメントされていない。

### 2. K-fileでの裏付け（35グループ全件で確認）

35グループ全てが以下の性質を満たす（`classifyMissingResult`の`maxRaceNumberInVenue`と実データを突き合わせ）:

- **末尾連続欠損**: 欠けているレース番号が必ず「N〜12R」の連続した末尾（`1,2,3のように途中だけ飛ぶ`パターンは0件）
- **K内最大レース番号の直後から開始**: 欠損の先頭レース番号は、その会場・その日のK-file内の実際の最大レース番号+1と完全一致（35/35）
- **K-fileブロックのstatusは全て`complete`**（`pending`＝未確定マーカーではない。公式が「この日はこれで確定」として配信済み）

35グループは性質の異なる2パターンに分かれる。

#### パターンA: 全日中止型（13グループ・156件、K内最大レース番号=0）

その会場はその日、K-file上で1レースも実施記録が無い（他の開催会場は通常通り12R完走）。K生ファイル（LZH解凍後のテキスト）を直接確認したところ、**該当会場ブロックには「1R　中止」〜「12R　中止」という明示的なテキストが存在する**ことを複数サンプルで確認した。

例（2025-12-12 江戸川、第5日。同日の他10会場は全て12R complete）:
```
   [払戻金]       ３連単           ３連複           ２連単         ２連複
           1R  中　止
           2R  中　止
           ...
          12R  中　止
```
同様の明示テキストを2026-01-08 津（第1日）でも確認済み。

**重要な発見**: 現行の`scripts/lib/kbFileParser.js`（`parseKVenue`）は、この「N R　中止」という行を一切解析せず黙って読み捨てている。結果として`venue.races`が単に空配列になるだけで、「そのレースは中止と公式に明記されていた」という情報はパース済みJSON（`data/kb-archive/parsed/`）のどこにも残らない。`parse`コマンドが検知するのはレース数不一致（K/B間の合計レース数差）という間接的な兆候のみで、個々のレースが中止だったという事実は捨てられている。

#### パターンB: 途中打ち切り型（22グループ・113件、K内最大レース番号>0）

その会場は前半のレースは完走し、後半のレース番号（例: 9〜12R）から丸ごと欠ける。こちらはK生ファイルを確認しても「中止」等のテキストは存在せず、**該当会場ブロックが最後に実施されたレースの結果でそのまま終わっている**（例: 2025-12-25 丸亀は8Rの払戻情報で会場ブロックが終了、9R以降への言及は一切無い）。

このパターンの確証は「ブロックが`complete`のまま該当レース番号が存在しない」という間接的なものに留まるが、これは既存の自動確定ロジック（`confirmCancellationsForRaceIds`、`発走90分超・結果未取得`）が採用している評価基準と同水準であり、追加の裏付けが無いことをもって確定を見送る理由にはならないと判断する。

### 3. races・predictionsの他列への影響

| 項目 | 結果 |
|---|---|
| `races.race_grade` | 269件中213件は値あり、56件がNULL（全日中止型36件・途中打ち切り型20件、両パターンに分布） |
| `race_entries`（出走表） | 269件中167件は存在（事前にracelistがスクレイピング済み）、102件は出走表自体が無い |
| `predictions` | **269件全件で生成済み**（`model_id='standard'`が269件、`safeBet`/`upsetFocus`が各255件、計779行）。開催されなかったレースに対しても予測は生成されており、`is_hit_win`等の的中判定列は結果が永遠に来ないため未確定（NULL）のまま残存する |

`predictions`の扱い（is_hit_win等をどうするか）は本チケットのスコープ外（cancellation_statusの是正のみ）だが、影響として記録する。

## 修正方針（提案。本番書き込みは別途承認後）

269件全件について、`races.cancellation_status`を`'confirmed'`に更新する。

- 新しいenum値は不要。既存の`CHECK (cancellation_status IN ('tentative', 'confirmed'))`（`docs/db-migration/047_race_cancellation_status.sql`）の`'confirmed'`をそのまま使う
- `'tentative'`を経由する必要はない。`'tentative'`は発走前の暫定検知（選手情報0人の連続検知）専用のステータスであり、既に終わったレースの事後確定には使わない（`confirmCancellationsForRaceIds`が現在も同じ扱い＝`tentative`を経由せず直接`confirmed`を書く）
- `cancellation_check_streak`は触らない（この列は暫定検知専用の内部カウンタで、事後確定とは無関係。既存の確定処理も更新対象に含めていない）
- 更新対象の特定は、本調査で使った`backfill-kb-recent-results.js plan`の`race_not_in_k_venue`分類をそのまま使えるが、実行直前に必ず`plan`を再実行し件数を再確認すること（本番DBは並行稼働の他ジョブで日々変動するため。BOA-403のCLIと同じ注意事項）
- `predictions`側（is_hit_win等の扱い）は本是正の対象外。必要であれば別チケットで検討する

## 根本原因

1. **検出機構自体が対象期間より後に導入された**: `races.cancellation_status`列と中止・順延検知ロジック（BOA-254）は2026-09-06に本番適用された（`docs/db-migration/APPLIED.md`）。調査対象期間（2025-12-03〜2026-03-31）は全てこれより前であり、当時は列自体はおろか検出の仕組みそのものが存在しなかった。NULLのまま残っているのは当然の結果であり、バグによる書き込み漏れではない
2. **導入後も過去日への遡及処理が無い**: BOA-254導入後の確定ロジック（`confirmCancellationsForRaceIds`、および2026-09-21導入の`race_status`早期確定ジョブ）は、いずれも「当日実行中のcronが持つスケジュール（`schedule`引数）」のみを対象にしており、過去の日付をバックフィルする経路は存在しない。したがって機能導入後の現在に至るまで、この期間のNULLは自然には解消されない
3. **（副次的原因）K-fileの明示的な中止マーカーが解析されていない**: パターンAで確認した通り、K-fileは中止レースを「N R　中止」というテキストで明示しているにもかかわらず、`kbFileParser.js`はこれを一切解析対象にしていない。中止・打ち切りの検知を今後もK-fileベースで行うなら、この明示テキストを`buildKbDay`側で拾える形にしておくと、パターンAとパターンBを区別して確度の異なる根拠を持たせられる（現状は両者とも「レースが存在しない」という同じ間接シグナルに畳み込まれている）

## 参考

- `scripts/lib/kbResultsBackfillRows.js`の`classifyMissingResult`（`race_not_in_k_venue`判定ロジック、BOA-403 PR #807でマージ済み）
- `scripts/maintenance/backfill-kb-recent-results.js`（`plan`コマンド）
- `scripts/lib/cancellationStatus.js`（`tentative`/`confirmed`の状態遷移）
- `scripts/daily/scrape-results.js`の`confirmCancellationsForRaceIds`
- `docs/db-migration/047_race_cancellation_status.sql`
- `docs/design/scraping-vercel-consolidation/tasks.md` N32
- Linear: BOA-406、関連: BOA-403（PR #807）
