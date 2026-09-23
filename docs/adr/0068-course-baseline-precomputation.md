# ADR 0068: コース別ベースライン（ST考察・逃げシミュレーション）を日次バッチの事前集計にする

## ステータス

採用（2026-09-23）

## 背景

UI/UX刷新 phase a（[docs/design/analysis-visualization-upgrade/](../design/analysis-visualization-upgrade/spec.md)）で、レース詳細の枠別情報タブに2つの指標群を追加することが決まった。

1. **ST考察**（FR-1）: 安定率・抜出率・出遅率と、**同じコースの全国平均との差**
2. **逃げシミュレーション**（FR-6）: 1コースが逃げたときの2着率・2連単確率（会場別・直近1年）

このうち、選手個人の3指標は `getRacerScopedRaceStats(racerId)` が既に取得している730日分のデータ（同一レースの全6艇の `start_timing`・`is_flying` と `actual_course_1〜6`）からクライアント側で算出でき、**追加のSupabaseクエリは0本**で済むことを確認した。

問題は残りの2つで、どちらもレース詳細の1画面より広い母集団を必要とする。

- 同コース平均のベースライン: 全国・直近1年で各コース約40,000走（計約242,000走）
- 逃げシミュレーション: 直近1年の結果確定レース約45,000件（うち1コース逃げ23,056件）

非機能要件は「レース詳細を1回開くごとに増えるSupabaseクエリを**+3本以内**」「新しい集計クエリごとに読み取り行数の見積りをplan.mdに書く」で、[BOA-357](https://linear.app/boat-ai/issue/BOA-357)（Supabase Disk IO Budget枯渇の対策）がIn Progressという前提もある。レース詳細は本サービスで最もアクセスが多いページなので、ここで数万行を読む集計を毎回走らせる選択は取れない。

## 決定

**日次バッチで事前集計し、極小のテーブルに持つ。画面は単純なSELECTで読む。**

- 新規テーブル2つ（マイグレーション案 [094](../db-migration/094_course_baselines.sql)）
  - `st_course_baseline`: **6行**（コース1〜6）。平均ST・安定率・抜出率・出遅率・STの分布（0.05刻みのビンをjsonb）
  - `nige_second_by_course`: **最大120行**（24会場 × 2〜6コース）。逃し時2着率・2連単確率・母数
- 集計スクリプト: `scripts/daily/update-course-baseline-stats.js`（1スクリプトで2表を更新。両者は同じ基礎CTE（Fを負値に正規化したST × 実進入コース）を共有するため、分けるとDBスキャンが2倍になる）
- 実行基盤: **GitHub Actions の日次ワークフロー**（新規 `.github/workflows/aggregate-course-baseline-stats.yml`、JST 00:50）
- 画面からのクエリ増加: **ST考察 +0本**（取得済みデータから算出）／**ベースライン +1本**（6行のSELECT、`withCache`）／**逃げシミュレーション +1本**（5行のSELECT、`withCache`）＝**計+2本**で要件内

既存の `nige_outcome_distribution`（[027](../db-migration/027_nige_outcome_distribution.sql)、536行）は**変更しない**。艇番基準・90日・3連単粒度で、[BOA-158](https://linear.app/boat-ai/issue/BOA-158)の「逃げ成功時分布」タブが使用中。新テーブルはコース基準・直近1年・2着粒度で、粒度も期間も違う。

## 却下した選択肢

### 却下1: レース詳細から毎回ライブ集計する（RPCを追加する）

事前集計テーブルを作らず、`get_st_course_baseline()` のようなRPCをレース詳細から呼ぶ。

**不適合点**: 1回の呼び出しで `race_start_timings` 約242,000行 ＋ `race_results` 約45,000行×6艇分を読む。ベースラインは日内で変わらない値なので、同じ集計を訪問ごとに繰り返すことになる。BOA-357（Disk IO Budget枯渇）が進行中の状況で、最もアクセスの多いページに置く選択として成立しない。`withCache`（本日分30分）を通しても、キャッシュが切れるたびに全量スキャンが走る。

### 却下2: 既存の `nige_outcome_distribution`（027）を拡張する

列を足してコース基準・直近1年の値も同じテーブルに入れる。

**不適合点**: 027の UNIQUE 制約は `(venue_code, first_boat, second_boat, third_boat)` で、**3連単の組み合わせが主キー相当**になっている。コース基準・2着粒度のレコードを同じ表に入れるには、`third_boat` をNULL許容にして制約を組み替える必要があり、BOA-158のタブが使用中の表に破壊的変更を入れることになる。「艇番基準・90日」と「コース基準・1年」が1つの表に混在すると、どちらの行なのかを毎回列で見分ける設計になり、集計スクリプトも画面側も分岐が増える。既存の値も残したまま並べるなら、行数は増えるが読み手の負担が減らない。

### 却下3: ベースラインを定数としてコードに埋め込む

`src/utils/courseBaseline.js` に実測値（安定率 67.9/58.7/63.2/60.2/57.3/45.8 など）を定数として書き、DBを使わない。

**不適合点**: クエリは0本になるが、値の更新が手作業になる。直近1年の移動窓なので月単位で変わり、更新を忘れると「同コース平均との差」という表示の意味が崩れる（差の符号が実態と逆になりうる）。本プロジェクトは「ブログ記事の旧モデル言及が67ファイルに残っていた」「`/about` の動画がモデル刷新から5日間古いまま放置された」という、人間の記憶に依存した更新が形骸化する事例を繰り返している。鮮度の維持を人手に置く設計は選べない。

### 却下4: Vercel Functions + Vercel Cron で実行する（ADR-0066）

**そもそも適用範囲外**。[ADR-0066](./0066-scraping-execution-consolidation-to-vercel.md)（データ取得の実行基盤をVercelに一本化する）は、GitHub Actionsに残すものを決定の中で**明示的に列挙している**。

> **対象外（GitHub Actionsのまま）**: 取得済みデータのDB内集計・統計更新（`aggregate-stats`・`update-*-stats`等）、モデル学習・予測生成（`train-*`・`generate-*`）、SNS・コンテンツ・sitemap系。外部サイトを取得せず、長時間のCPU処理を含むため。

本ジョブ（`update-course-baseline-stats.js`）は、外部サイトへの通信を一切せず、自社DBの集計結果を同じDBに書くだけで、この「取得済みデータのDB内集計・統計更新（`update-*-stats`等）」に**そのまま該当する**。ADR-0066が禁じているのは「新規の**取得ジョブ**をGitHub Actions・cron-job.orgへ追加すること」で、DB内集計は対象に含まれない。[orchestration.md](../design/scraping-vercel-consolidation/orchestration.md) のWS7も、廃止対象を「cron-job.org・**取得系**GitHub Actions」と限定しており、同ドキュメントの承認記録(j)では「死活監視の2次はGitHub Actionsの日次で足りる」として非取得の用途でGitHub Actionsを使い続けることが承認されている。

仮に適用範囲だったとしても選ばない理由が2つある。Vercel Functionsには最大実行時間（800秒）の制約があり、約287,000行のスキャンを分割する設計が要る。また同種の既存ジョブ（`scripts/daily/update-nige-outcome-distribution.js`、`scripts/maintenance/update-venue-stats.js`）はGitHub Actionsで動いており、1つだけ別基盤に置くと「何がどこで動いているか」の把握を分断する（ADR-0066が解消しようとしている問題そのもの）。

## 影響

- **新規テーブル2つ**（合計最大126行）。Disk IOへの影響は無視できる。書き込みは日次1回、変更のある行のみupsert
- **画面のクエリは+2本**（どちらも数行のSELECT、`withCache`経由）。非機能要件の+3本以内に収まり、FR-4の新規データ表示（最大+4本）はタブごとの遅延取得で同時に増えないようにする
- **匿名（画面）からSELECTできるテーブルが2つ増える**。どちらも自社の集計値で、公式サイトのコンテンツの再表示には当たらない（ADR-0067の対象外）
- **日次ワークフローが1つ増える**。失敗を握りつぶさないため `continue-on-error` は付けず、0件書き込みをエラーとして扱う（`.claude/rules/data-acquisition.md`）
- **GitHub Actionsのスケジュール遅延の影響を受けない設計にする**。orchestration.mdの実測では `scrape-point-rank` が約4時間、`scrape-venue-motor-stats` が約2〜2.7時間遅れて起動し、**「対象日が翌日にずれて0件」という障害が実際に起きている**（`racer_series_points` が0件だった直接原因）。本ジョブは「実行時点から遡って365日」の移動窓で集計するため、起動が数時間ずれても対象範囲がほぼ変わらず、同じ失敗モードには当たらない。ただし鮮度だけは落ちるため、`last_updated` が2日以上古い場合を `scrape-monitor` の日次チェックで検知する（plan.md §5.2）
- ベースラインは**全国・直近1年の固定値**から始める。会場別・グレード別に分ける案は、ベースライン自体のnが減るため初期スコープに入れない（spec.md 未確定事項1b）
- 見直しの契機: 会場別・グレード別のベースラインが必要になった場合、`st_course_baseline` に `venue_code` を足すと行数が144行に増える。その時点で主キーの変更が必要になるため、本ADRを更新する
