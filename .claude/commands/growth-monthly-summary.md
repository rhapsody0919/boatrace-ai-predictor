# 集客PDCA月次統合サマリー

Search Console/GA4（SEO）・X・TikTokの集客PDCAスキルがそれぞれ独立して実行されており、事業ゴール（役所広告受注に向けたPV・認知度実績づくり）への進捗を横断的に確認する仕組みが無かった（2026-08-26、8人パネル議論で発覚）。月1回、各スキルの直近レポートを集約し、主要KPIの推移と中期目標への進捗を1枚にまとめる。

「集客の月次まとめを見せて」「今月の集客どうだった？」等の自然言語依頼でも起動する。

## 実行手順

### 1. 各データソースの最新状況を集約

以下の直近レポートを確認する（無ければ「未実施」と明記し、代わりに該当スキルを先に実行するかユーザーに確認する）。

- `data/analysis/search-console/report-*.json`（直近と約1ヶ月前の2時点）
- `data/analysis/i18n-demand/report-*.json`（直近と約1ヶ月前の2時点）
- `data/analysis/x-growth/report-*.json`（直近と約1ヶ月前、無ければ`/x-growth-report`未実施と明記）
- `data/analysis/tiktok-growth/report-*.json`（直近と約1ヶ月前、無ければ`/tiktok-growth-report`未実施と明記）
- `note-articles/tweet-drafts.md`の消化率（`- [x] 投稿済み`件数 / 全件数）
- `data/analysis/x-posts/history.json`・`data/analysis/tiktok-posts/history.json`の投稿実施率（`status: posted`と`status: skipped`の比率。セッションが開かれず確認自体が無かった日はどちらの母数にも含めない）

各データが1ヶ月以上古い場合は、その時点で該当スキル（`/growth-pdca`・`/x-growth-report`・`/tiktok-growth-report`）を先に実行してから本サマリーを作成する（データが古いまま集約すると実態と乖離したサマリーになるため）。

### 2. KPIサマリー表を作成

以下を月初（または前回サマリー時点）と比較する表にまとめる。

- サイト全体PV/日（日本語）
- Search Console クリック/日・表示回数/日
- 多言語PV（English/繁體中文/한국어）— 動きが無くても必ず記載する（`.claude/CLAUDE.md`の「調査・分析結果の報告原則」に従う）
- Xフォロワー数・直近投稿の平均インプレッション
- TikTokフォロワー数・直近投稿の平均視聴数
- note/Xツイート下書き消化率
- TikTok/X動画投稿の実施率（history.jsonのposted/skipped比率）

### 3. 中期目標への進捗確認

既存の中期目標（memory参照。例: `venue_guide_expansion_project`の「3ヶ月でPV3-5倍、次回確認2026-10-27」）に対して現在地を確認する。目標未達・遅延の兆候があれば明示する。該当する中期目標が見当たらない場合は「中期目標が設定されていない」旨を明記する（目標が無いこと自体も報告すべき事実）。

### 4. 大施策の意思決定状況

`data/analysis/growth-pdca-major-initiatives.json`から、進行中（`in_progress`）・保留（`deferred`）・見送り（`rejected`）・未判断（`proposed`）の件数を集計し、未判断のまま長期間（2ヶ月以上目安）放置されている候補が無いか確認する。

### 5. Search Console手動確認項目のリマインド（2026-08-26追加）

Search Console APIでは取得できず、Web UI限定でしか確認できない項目がある（2026-08-25判明）。これらはAPI経由で自動化できずClaude側からは見えないため、月次サマリー提示のたびに以下をユーザーに確認依頼する。

- **「リンク」レポート**: 自サイトへの被リンク元ドメイン一覧。Ahrefs等の有料ツールが無い中で被リンク状況を把握できる唯一の無料手段。ステップ4の大施策（被リンク獲得施策）の判断材料になる
- **「セキュリティと手動対策」**: Googleからのペナルティ・手動対策の有無。問題が無ければ一瞬で終わる確認だが、入っていれば検索順位への影響が大きい
- **「メッセージ」**: インデックス登録の問題・構造化データのエラー等の通知

確認を促すだけに留め、Claude側がSearch Console画面を直接操作しようとしない（ユーザーのGoogleアカウントでのログインが必要なため）。気になる点があれば次回セッションで共有してもらう。

### 6. 次月のフォーカス提案

上記を踏まえ、次月に優先すべき施策を1〜2個提案する。優先順位付けは`/growth-pdca`と同じ「インパクト×工数」マッピングを使う。

## 保存先

`data/analysis/growth-monthly-summary/summary-{年月}.json`（構造: `{generatedAt, period: {from, to}, kpis: {...}, midTermGoals: [...], majorInitiativesStatus: {...}, nextMonthFocus: [...]}`）。専用集計スクリプトは無い（各ソースのJSONを読み合わせるだけのため）。Writeツールで直接書き込む。

## 実行頻度・起動タイミング

月1回目安。`/growth-pdca`実行時、前回の月次サマリーから1ヶ月以上経過していることを検知したら、本サマリーの実行を提案する（自動実行はしない、あくまで提案）。

## 関連

- `/growth-pdca`: SEO/GA4側の定点観測・施策立案
- `/x-growth-report`: X自体のパフォーマンス
- `/tiktok-growth-report`: TikTok自体のパフォーマンス
- 会場ガイド拡充の中期目標: memory `venue_guide_expansion_project`
