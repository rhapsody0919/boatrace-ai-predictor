-- BOA-263: 会場×グレード×艇番の横断分析用の事前集計テーブル。
--
-- 全会場×全グレードの横断集計はrace_results全件（4万行超）のスキャンが必要で、
-- 選手単体スキャン（1選手あたり平均129走）の200〜330倍の規模になる。このリポジトリの
-- 既存規約（winning_technique_stats・accuracy_cache等）では「全会場横断」集計は
-- 必ず日次バッチで事前集計しキャッシュ列/テーブルに保存する方式を取っており、
-- ブラウザ側でのライブ全件集計は前例が無い（BOA-267のコードレビューでも同じ指摘があり、
-- そちらはBOA-303として別途バッチ化を予定）。本チケットは最初からバッチ集計で設計する。
--
-- boat_number=0は「艇番非依存（レース全体）」の集計行を表すセンチネル値。艇番別指標
-- （勝率・連対率・3連対率・決まり手内訳）はboat_number=1〜6の行、レース全体指標
-- （万舟率・平均配当・決まり手構成比）はboat_number=0の行に格納する。
--
-- 「平均着順」は対象指標から除外している: race_resultsはrank1/rank2/rank3
-- （1〜3着の艇番）のみを保持し、4〜6着の着順は記録されていないため、全艇の
-- 平均着順は正確に算出できない（BOA-263ブラッシュアップ時のモックにはあったが、
-- 実装時のデータ調査で判明したため対象外にした）。
--
-- 注: race_results.payout_trioが実際の3連単、payout_trifectaが実際の3連複という
-- DB列名の歴史的な逆転があるため（hitCalculator.jsのコメント参照）、万舟率・平均配当
-- はpayout_trio列を使う（payout_trifectaではない）。
--
-- payout_trioはキャンセル・不成立でない有効なレースでもスクレイピング取得失敗等で
-- NULLになりうる（is_cancelled/is_no_raceとは独立、scrape-results.jsのtrioEntry
-- 参照）。万舟率・平均配当の分母をrace_countにすると、payout_trioが欠損している
-- レースの分だけ不当に薄まる（既存のgetTodaysVenueRankingがpayoutCountを別カウント
-- しているのと同じ理由）。そのため万舟率・平均配当専用の分母payout_countを持つ。

CREATE TABLE IF NOT EXISTS venue_grade_boat_stats (
  venue_code SMALLINT NOT NULL,
  race_grade TEXT NOT NULL,
  boat_number SMALLINT NOT NULL DEFAULT 0,
  race_count INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  top2 INTEGER NOT NULL DEFAULT 0,
  top3 INTEGER NOT NULL DEFAULT 0,
  technique_breakdown JSONB,
  payout_count INTEGER NOT NULL DEFAULT 0,
  manshu_count INTEGER NOT NULL DEFAULT 0,
  payout_trio_sum BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (venue_code, race_grade, boat_number)
);

CREATE INDEX IF NOT EXISTS idx_venue_grade_boat_stats_venue
  ON venue_grade_boat_stats(venue_code);
