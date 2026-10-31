# 選手の場別・優勝歴・年別・進入コース別の集計表（案2）の設計審査

system-architect の審査の全文（2026-10-28、GS00）。本番は claude_ro で読み取りだけ。案2の PR を作るときに使う。ADR-0067 の確認をオーナーに取るまで、マイグレーション・ADR の PR は作らない。

## 結論
- A の形は ADR と矛盾しない。B は規則に反するので採らない。推奨は C（A を直した形）
- 叩き台の A のままだと危ない点が3つある
  - ①優勝・優出を stage_kind で判定する
  - ②日次で差分を「足す」
  - ③境目 2025-12-02 の重なりを消していない
- ADR の追加が要る（0104 の見込み。番号は PR を作るときに取る）。kb の値を選手単位で匿名に出すと、074 のコメント「アーカイブを公開APIへ出さない」の外になる。会場の集計だけを出した ADR-0088 の先例の外にもなる
- ADR-0067 の見直しの契機「表示の量や範囲が大きく変わる」に当たりうる。事実データの集計なので、現状維持の範囲と読むのが自然。ただし公開の方針に関わるので、オーナーに1行で確かめることを勧める

## 根拠

### kb_archive は止まっている（作りの上でそうしている）
- 本番の値
  - 期間は 2019-04-01〜2025-12-02
  - kb_archive_races は 372,276行
  - created_at は全行 NULL
- `scripts/maintenance/kb-backfill.js:51` に `MAIN_TABLES_START="2025-12-03"` がある。`:730` で、`--to` がそれ以降なら拒む
- 夜の `wake-and-download-nightly.sh:41-42,130` は `download` だけで、`load` は呼ばない。kb_archive に書く cron も api も無い
- よって kb 側は1回計算すれば足りる

### stage_kind は優勝の判定に使えない
- `scripts/lib/kbArchiveRows.js:51-56` の classifyStage は、先頭が「優勝」「優出」かだけを見る
- 本番で抜けたもの
  - is_final_day の日で final が0件のものが98日
  - 例は 2019 GP の「GP優勝戦」、「サントリー優」「王座決定戦」「県内選手権優」など
- ほかの崩れ
  - final が2件ある日が60日（男女W優勝戦・GP/シリーズ）
  - 最終日でない日の final が35件
- 判定は `src/pure/raceStageConfig.js` の `isFinalStage` を両方の期間に使う
  - v2。NFKC で正規化し、FINAL_WORDS と「〜優」の語尾で判定する。準・準々・進出は除く
- 同じ規則を SQL で近似し、2026年後期（2025-11-01〜2026-04-30、境目をまたぐ）で公式の racer_period_stats と照らした
  - 優勝: 412/412。選手ごとに 1,643/1,643 人が一致した
  - 優出: 2,489 対 2,471 で18件多い。多い18件は、成績コードが NULL の艇の数（18件）とちょうど同じ。成績コードがある艇（S0・K0 を含む）だけを数えれば、合計は一致する見込み。選手ごとの照合は未実施
- 今の stage_kind のまま 2025年前期で数えると、合計は 419 対 424 で少ない。選手ごとの一致は 1,611/1,616

### 出走・勝率の材料はそろっている
- 着の原文のコードの体系は、2つの期間で同じ
  - kb 側は kb_archive_boats.finish_raw（01〜06・F・S0・S1・S2・K0・K1・L0・L1・00・NULL）
  - 本体側は race_start_timings.official_finish_code。2025-12〜2026-10 で、結果のあるレースの全艇に入っている（10月だけ 25,122/25,716）
- 出走回数の定義は 126 にある（01〜06・F・L1・K1・S1・S2）。期別成績と 1,625人全員一致する。これを流用する
- 本体側の進入コースは race_results.actual_course_N を使う（ほぼ全レースにある）。race_start_timings.entry_course は月によって73〜25,671行しか無い

### 境目には重なりがある
- 2025-12-02 は、races に12レース（1会場）、kb に同じ日の120レースがある
- 切り方は、kb を race_date ≤ 2025-12-02、本体を ≥ 2025-12-03 に固定する。MAIN_TABLES_START を共通の定数にして両方から読む

### 本体側のグレードに欠けがある
- races.race_grade は 2025-12 が 4,148/4,496、2026-01 が 4,718/5,166 しか入っていない
- 優勝歴のグレードと開催名は race_series で補う（venue_code と、start_date〜end_date の範囲で引く）
- kb_archive_venue_days の race_grade・title は NULL が0件

### B は規則に反する
- SECURITY DEFINER の RPC を匿名に開くことは禁じている（`verify-migration-rls` 7、マイグレーション 113、ADR-0088 の却下の理由）
- 加えて、選手ページを開くたびに221万行の表を引く。Small の Disk IO の予算に響く

### 実行の基盤
- 外部からの取得ではなく、DB の中の計算なので、ADR-0066 改訂1 の線引きに沿う
- 先例は `api/cron/racer-course-technique-stats.js` と `scripts/daily/update-racer-course-technique-stats.js`。Vercel Cron から集計の RPC（service_role だけ）を呼び、`upsertChangedRows` で書く

### 進入コース別の公式の値
- racer_period_stats の c1〜c6_entries・p1〜p6・F・L・K・S は、公式のコース別の期の値で、匿名で読める
- ただし今の期（2026-05〜）はまだ無い。表示には使わず、照合に使う

## 推奨（C）
1. **表を2層に分ける**
   - 各表に `era`（`kb` または `main`）を持たせ、主キーに入れる
     - racer_venue_stats は (racer_id, venue_code, era)
     - racer_year_stats は (racer_id, year, era)
     - racer_course_stats は (racer_id, course, era)
     - racer_championships は (race_id, racer_id)
   - 画面は era の2行を JS で足す。1人あたり最大48行で、1000行の上限には遠い
2. **率は保存せず、コードごとの件数を持つ**
   - 列は starts、p1〜p6、f、l1、k1、s1、s2、k0、s0、l0、finals、wins
   - 勝率の点は src/pure の純関数で、版を付けて計算する
   - 公式の勝率の定義の点（グレード別の加点の有無を含む）は official-data-spec に確かめる。加点がグレード×種別で変わるなら、件数をその軸でも持つ
3. **kb の層は1回だけ計算する**
   - 書き手は手動の CLI（`scripts/maintenance/`、ADR-0066 のバックフィルの規則）で、オーナーが実行する
   - race_id が日付で始まるので、kb_archive_boats の PK の範囲（`race_id >= '2019-' AND < '2020-'`）で年ごとに7回に分けて読む。racer_id の索引が無くても、全表を何度も読まない。索引は足さない
   - kb の行数と最大の日付の指紋をメタの行に残す。夜のジョブが変化を見つけたら知らせる
4. **main の層は毎晩「計算し直す」**（足し算はしない）
   - 直近3日に出走した選手について、main の期間全体を racer_id の索引で集計し直して upsert する。Cron の重複や未配信に強い（冪等、catch-up）
   - 件数が0になったセルは computed_at の掃除で消す（db-operations の 155 の知見）
5. **優勝・優出の判定**
   - 優勝戦は isFinalStage(stage) の形で決める。is_final_day・stage_kind・race_series.end_date（順延でずれる）は使わない
   - 優出は、成績コードのある艇。欠場の S0・K0 を含むかは公式との照合で決める
   - 優勝は着のコードが '01'
   - 同着、団体戦（「団体・優勝戦」）、W優勝戦の扱いは、期ごとの選手単位の照合で確定する
6. **照合を関門にする**
   - 13期すべてで、選手×期の wins・finals・starts（c1〜c6 を含む）を racer_period_stats と比べる
   - 一致しない選手の一覧を、verify と完了報告に出す。verify は `verify-registry.json` に manual で登録する
7. **権限**
   - 各表で RLS を有効にし、`GRANT SELECT … TO anon, authenticated` を明示する（076）
   - 書き手は service_role だけ
   - 集計の RPC は service_role だけに付け、1関数1文で GRANT と REVOKE を書く

## 書き込みと Disk IO の見積り（本番の実測から）
| 項目 | 値 |
|---|---|
| 選手×会場 | 42,387組（選手 1,979人） |
| 選手×年 | 13,023組 |
| 選手×コース | 約12,000行（推計） |
| 優勝 | 約5,500行（kb 13期で 5,330、本体を足す） |
| 初回の書き込み | 約7.3万行×約120B ≒ 9MB（索引と WAL を入れて約30MB、推計） |
| 初回の読み取り | kb_archive_boats 412MB を1回（年ごとの範囲読み） |
| 毎晩 | 出走は約900艇/日（約150R×6）、選手は約600〜900人。変わる行は会場・年・コースで約2〜3千行/日、1MB 未満（推計） |

Disk IO の予算には小さい。ただし初回の kb の読みは夜に流し、前後でダッシュボードの Disk IO を記録する（data-acquisition の C）。

## 手順

### 事前（Claude、読み取りだけ）
- `git fetch origin master` の後に `npm run verify:migration-numbers` と `npm run verify:adr-numbers` を実行する。今の最大は 189 と 0103 なので、190 と 0104 の見込み。予約はしない
- 表・RPC の読み手を `docs/reference/data-readers.md` で確かめる
- `racer_aggregated_stats` と名前・責務がぶつからないかを確かめる。venue_code の軸を持つが、本番は0の行だけ

### 書き込み（オーナー）
- マイグレーションを SQL Editor か db-apply で当てる。GRANT があるので heavy と判定され、自動の経路には乗らない
- 表を作ってから kb の CLI を実行する。コードのマージ後に Cron を1回手で動かす

### 事後（Claude）
- 権限を確かめる: `relrowsecurity` が有効、`has_table_privilege('anon',…,'SELECT')=true`、INSERT が false
- 層ごとの行数が見積りと合うか確かめる
- 13期の照合の一致率を出す
- `get_advisors`（security）が0件であることを確かめる
- 画面は「未計算（メタの行が無い）」と「0回」を区別する。取得の失敗は InlineFetchError で出す

## 壊れ方
1. 2025-12-02 の12レースを二重に数える
2. 差分を足す方式だと、Cron の重複で回数が倍になり、未配信で欠ける
3. 列の集合が違う行をまとめて upsert すると、欠けた列に NULL が入る（diffRows で列をそろえる）
4. 件数が0になったセルが残る
5. 読み取りの失敗が「優勝0回」に化ける
6. stage_kind・is_final_day を使うと、GP などの優勝を落とす
7. 成績コードが NULL の艇（中止・順延）を優出に数える
8. race_grade の欠けで、優勝歴のグレードが空になる
9. 年別（暦年）と公式の期を取り違える（画面の見出しで分ける）
10. 誰かが kb を load し直すと、kb の層が古いまま残る（指紋で知らせる）

## 食い違い
- kb_archive_races.stage_kind（`kbArchiveRows.js` の classifyStage）と、`src/pure/raceStageConfig.js` の v2 の規則が食い違っている
- 074 のコメントは stage_kind を「大まかな区分」と書いているので、文書の誤りではない。ただし読み手が優勝の判定に使うと落とす
- コードは書き換えていない。Orchestrate が Linear に起票する

## 知見ノートに足す行（docs/knowledge/db-operations.md）
- kb_archive_races.stage_kind は、先頭が「優勝」「優出」かだけで決めるので、「GP優勝戦」「サントリー優」「王座決定戦」を落とす（最終日で final が0件の日が98日）。優勝・優出は src/pure/raceStageConfig.js の isFinalStage で stage の原文から決める（2026-10-28、system-architect、本番の読み取り、kbArchiveRows.js:51-56）
- isFinalStage の規則で優勝を数えると、2026年後期（kb と本体をまたぐ）の公式 racer_period_stats.wins と、選手ごとに 1,643/1,643 人が一致した。優出は成績コード NULL の18艇の分だけ多い（2026-10-28、system-architect、本番の読み取り）
- kb と本体はどちらも 2025-12-02 を持つ（races 12R、kb 120R）。境目は kb を ≤12-02、本体を ≥12-03（kb-backfill.js:51 の MAIN_TABLES_START）に固定する（2026-10-28、system-architect、本番の読み取り）
- kb_archive は書き手の cron が無く、2025-12-02 で止まっている（kb-backfill.js:730 が範囲外を拒み、夜の wake-and-download は download だけ）。kb からの集計は1回で足り、変化は行数の指紋で見張る（2026-10-28、system-architect）
- kb_archive_boats は racer_id の索引が無くても、race_id が日付で始まるので、PK の範囲読み（年ごと）で分ければ全体を集計できる。選手単位の集計のために索引を足さない（2026-10-28、system-architect、074）
