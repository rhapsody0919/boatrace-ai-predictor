# 選手ページの回収率の全国の基準（DB の変更の案）

> **未審査の案。適用の根拠にしない。** マイグレーションは作り手が作らない（AGENTS.md 安全の3）。この案を審査に通したうえで、人がマイグレーションの PR を作り、オーナーが db-apply で当てる。`vercel.json` の crons の行と、共通ラッパの mode を live にする作業も人の手で行う（安全の4）。

## 目的
選手ページの「枠番別回収率」（単勝・複勝、#3523・#3532）と「3着以内のレースの3連単配当」（3連単の着順固定の回収率、#3535 を作り直し中）に、意味づけ（レーン M2、`src/pure/compareBaseline.js`・型1「基準と比べる棒」）を入れる。比べる相手の「全国の同じ枠番の平均回収率」と、その1走あたりのばらつきが今は DB に無い。

- オーナーの原則（2026-11-26）: どの画面・指標も、数字から何が読み取れるか・価値を視覚的に出す
- 回収率の色は付けない（#3530 の承認「回収率の色は外す」）。位置だけを型1の棒で出し、判定は計算しない（dir="unclear" 固定。額の分布の裾が重く z・二項が当てはまらない。M2 2026-11-26）。言葉は検証済みの事実「回収率は先の期に続かない」（docs/knowledge/stat-findings.md 98行目、時期の前後の順位相関 0.055）に寄せる
- 基準は「全国の同じ枠番の平均」（data-scientist 2026-11-26）。3連単も枠番ごとに持つ（枠番で分けないと1着・2着・3着・全体の基準が恒等式で全部同じ値＝3連単の配当÷12,000 の平均になる）。選手の行には、その選手が走った枠番の構成で重み付けした平均（Σ n_b·μ_b / n）を出す。級では分けない

## 置き場の比較（system-architect 2026-11-26）
| 案 | 判定 | 理由 |
|---|---|---|
| A 新しい小さな表＋毎晩 Vercel Cron（共通ラッパ）から SQL の RPC で全部を数え直して upsert | **採る** | 期間を直書きせず毎晩数え直すので、過去の分の取り込み（BOA-1719）の後も自動で入る。ADR-0066 改訂1（DB 内の集計でも Vercel Cron でよい）・ADR-0068（窓を実測の列に持つ）・ADR-0104 決定2（率でなく件数を持つ）と整合 |
| B 既存の 059・067・094 に列を足す | 採らない | 059 は CLEAN_DATA_SINCE=2026-02-04 を直書き（scripts/daily/calculate-venue-grade-stats.js:21）、race_count は6艇すべてに+1する別の定義。067・094 は粒度が別 |
| C RPC で都度数える | 採らない | ADR-0068 の却下1と同じ（開くたびに数十万行。anon の statement_timeout 3秒） |
| D src/data の静的 JSON | 採らない | ADR-0068 の却下3（人手の更新で古くなる）。選手側は730日の動く窓なのでずれる |

新しい匿名公開の表と「後の結果が基準に入るのを許す」判断を伴うので、短い ADR を1本足す（番号は PR を作るときの origin/master の最大＋1）。

## 後の結果が基準に入る問題
- 選手ページの表は、選手の値も基準も同じ窓（`racerHistoryCutoff` の730日）の通算なので許す
- 推移の線の過去の点も窓の全期間の基準と比べる。基準は全国の数万走でほぼ動かないので許し、札に「基準は {window_start}〜{window_end} の全国」と出す
- **禁止**: この表をレース詳細・予想・事前の判定に使うこと。表の COMMENT と ADR に「選手ページの通算の比べに限る」と書く（ST 考察の st_course_baseline が日付を持たず過去のレースに後の結果が入った型を繰り返さない。m2-meaning/step2-baselines.md）
- 絞り込み（会場・グレード）の間も基準は全国・全グレードのまま。札にそう書く

## 表（案）`racer_boat_return_baseline`
- 主キー: (scope TEXT, boat_number SMALLINT)。scope は今は 'national' だけ（後で 'venue:NN' を足しても主キーを変えない）。boat_number は 1〜6 と、全体の行 0（059 と同じ番兵）
- 窓: window_start・window_end・window_days（実測。CHECK window_end >= window_start）
- 件数: runs（母数）、unranked_runs（着順なし。払戻0で母数に入れる、オーナー決定 2026-11-26）
- 単勝・複勝: win_sum・win_sumsq・place_sum・place_sumsq（BIGINT。払戻金100円あたりの合計と二乗の合計）
- 3連単: tri_pos1_sum・tri_pos1_sumsq・tri_pos2_sum・tri_pos2_sumsq・tri_pos3_sum・tri_pos3_sumsq（その着の走の race_results.payout_trio の合計。点数で割る前。payout_trio は列名と中身が逆で3連単、docs/knowledge/data-columns.md 6行目）、tri_paid_missing（payout_trio が NULL の走の数）
- その他: rule_version（数え方を変えたら上げる）、last_updated（値が変わった日）、computed_at
- CHECK: runs > 0、boat_number BETWEEN 0 AND 6
- RLS 有効。anon・authenticated に SELECT だけ GRANT、ポリシーは USING (true)。076 以降は既定で権限を剥がすので GRANT を明示する（059 は書き忘れて0件が返った前例）。書き手は service_role だけ

率と標準偏差は持たない。読み手の純関数（src/pure）で 平均 = sum/runs、sd = sqrt(sumsq/runs − 平均²) を出し、3連単は 1着・2着・3着固定なら ÷20、全体なら3つの合計 ÷60 で回収率（%）にする。

## 集計の RPC（案）`compute_racer_boat_return_baseline(p_from date, p_to date)`
- 母数の定義は選手ページと一字一句そろえる: race_entries のうち窓の中で venue_code があり、`isUsableRaceResult`（no_race と rank1 が NULL を除く）を通る走。着順なしは race_start_timings.finish_mark が 1〜6 以外（`isUnrankedFinishMark`、src/services/racerRaceHistoryRows.js:17）で払戻0。race_results だけから艇番で数えない（着順なしが rank に入った43件と会場の無い行がずれる）
- 1着なら単勝と複勝の1着側、2着なら複勝の2着側（src/pure/racerBoatReturns.js の payoutsOf と同じ）
- 艇ごとの合計を6〜7行で返す。STABLE・SECURITY INVOKER、service_role だけに許す。REVOKE と GRANT は1関数1文に分ける（verify-migration-rls）
- 8秒の打ち切りを避けるため、Node 側は月ごとに呼んで足す（合計は足し算ができる）。730日分の所要時間は未検証。**適用前に1か月分で EXPLAIN ANALYZE を測る**

## Cron（案）
- `api/cron/racer-boat-return-baseline.js` を `createScrapeCronHandler` に載せる
- UTC 16:20（JST 01:20。result-catchup の UTC 14:50・15:30 の後）と、取り直しの UTC 20:20（JST 05:20）
- 毎回、窓の全部を数え直し、主キーで upsert。全行が同じ列を持つ payload で `upsertChangedRows`（キーの揃わない行を混ぜて NULL を書く事故を避ける）
- runs が0、または返る行が0ならエラー（期待は0でない）
- 窓の始まりは `racerHistoryCutoff` と同じ計算を src/pure に置いて scripts/lib から読む。始まりの日を直書きしない（BOA-1719）。取り込み先が別の表なら、選手ページが読む表と同じ表を読む
- 共通ラッパは最初の起動で scrape_job_state に mode='off' の行を作る。live にするのはオーナー

## 画面の側（案）
- `src/services/racerQueries5.js` か `racerQueries6.js` に `getRacerBoatReturnBaseline()`。withCache の鍵は `racer-boat-return-baseline-v1`（日付で終わらせない。日付で終わると過去レース扱いの7日になる）
- 失敗はサービスが throw。権限エラー（適用前・戻した後）だけ `isPermissionDeniedError` で分けて `fetchFailed: true`（`getStCourseBaseline`、src/services/venueQueries2.js:354 の型）
- 画面は、基準が取れないときは位置を出さず、値と走数はそのまま、`InlineFetchError` を添える。基準が無いことを「平均並み」と見せない
- window_end が2日以上古ければ「基準は ◯/◯ まで」と出す
- 推移の線には帯を付けない（推移の線のオーナー決定）。基準の破線と札（「全国の同じ枠番 X%」）だけを足す

## 適用と戻しの手順（案）
1. 事前（読み取りだけ）: docs/reference/data-readers.md に同じ名前が無いか。1か月分の RPC 相当の SELECT の実行時間。艇1の単勝の全国の平均を、選手ページの純関数で数百人分を足した値と SQL の値の2通りで出して一致するか
2. 適用: マイグレーション（人の PR）→ オーナーの db-apply → vercel.json の crons の行（人の PR）→ mode を live（オーナー）
3. 事後: `has_table_privilege('anon', 'public.racer_boat_return_baseline', 'SELECT')` が true・INSERT が false、`relrowsecurity` が true、行が7、window_end が昨日、scrape_job_state の last_success_at、2回目の実行で書いた行がほぼ0（window_end が変わった日を除く）。画面の値と手で数えた値の照合を `scripts/maintenance/verify-*.js` に置く
4. 戻し: 画面は権限エラーで基準を出さない形に戻るだけで壊れない。表と RPC は DROP、crons の行を外す

## 未検証
- 730日分の RPC の所要時間
- 外の枠の1走の SD（1号艇の単勝 115円しか分かっていない）
- 同着で3連単の払戻が2口あるレースは payout_trio に1つ（12か月で約18件）。基準も選手の値も同じ限界なので比べはずれない
