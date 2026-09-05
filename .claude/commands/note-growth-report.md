# note集客状況レポート（自アカウント投稿実績の定点観測）

note.com自体のパフォーマンス（記事ごとのPV・スキ・コメント）を定点観測し、次の記事制作・タイトル/タグ設計の施策につなげます。

`/growth-report`・`/growth-pdca`がSearch Console/GA4（検索流入・ブログ側）を、`/x-growth-report`・`/tiktok-growth-report`がX/TikTokを扱うのに対し、このスキルは**noteというプラットフォーム自体のパフォーマンス**を扱う。note APIは無いため、Chrome in Claudeで実際のダッシュボード画面を開いて数値を読み取る方式を取る（X/TikTokと同じ制約・同じ方式）。

**2026-09-05新設の経緯**: 4チャネルアルゴリズム調査監査で、noteだけが投稿実績を確認する手段が一切無い（X/TikTokのようなhistory.json、growth-reportスキルのどちらも無い）と判明した。実際にダッシュボード（`https://note.com/dashboard`）を確認したところ、複数記事が既に公開済みで実データ（全体ビュー105・スキ3等）が存在していた。「投稿実績が無いはず」という前提は誤りだったため、本スキルで既存の公開実績を可視化する。

## 実行手順

### 0. 前回提案した施策の実施・効果検証（必須、最初に行う）

PDCAの「C→A」を閉じるための最重要ステップ。**新しいデータを集める前に**、直近の`data/analysis/note-growth/report-*.json`（またはmemory）に残っている「前回の提案」を確認し、以下を明示する。

- 前回提案した施策（タイトル文字数の見直し、ハッシュタグ構成変更等）は実際に実行されたか
- 実行された場合、その後の実績に変化が見えるか（今回集めるデータと突き合わせる）
- 実行されていない場合、なぜか（判断が保留された/優先度が下がった等）を記録する

過去レポートが無い初回実行時はこのステップをスキップし、その旨を明記する。

### 1. 自アカウントの公開実績を確認

1. `https://note.com/dashboard`（自動的に`https://note.com/sitesettings/stats`にリダイレクトされる）を開く。「全期間」タブを選択し、以下を読み取る。
   - 全体ビュー（合計PV）・コメント数・スキ数の合計値
   - 記事ごとの一覧（ビュー・コメント・スキが列で表示される）。上位10件程度を記録する
2. 自アカウントのプロフィールページ（`https://note.com/{アカウント名}`）を開き、フォロワー数・投稿数（マガジン含む）を記録する。
3. 個別記事のURLを開き、実際に**タイトル文字数**（`docs/reference/note-algorithm-and-growth-notes.md`の目安15〜25文字と比較）・**ハッシュタグ数と内訳**（ジャンル大タグ/独自タグの構成、目安2〜4個）を確認する。ダッシュボードの一覧には出ない情報のため、上位記事から数件サンプルで確認する。

結果を`data/analysis/note-growth/report-{日付}.json`に保存する（構造: `{generatedAt, followerCount, totalViews, totalComments, totalLikes, previousActionsReview: [...], articles: [{title, titleLength, url, views, comments, likes, hashtagCount, publishedAt}]}`）。専用スクリプトは無い（note APIが無いため）。Writeツールで直接書き込む。

### 2. 判断基準（しきい値）— 分析を「なんとなく」で終わらせないために

- **母数が少ない段階（記事10件未満）の警告**: この段階での「タイトルの型ごとの優劣」比較は統計的に意味のある結論を出すには早すぎる。傾向として言及してよいが、断定はしない（`/x-growth-report`・`/tiktok-growth-report`と同じ考え方）
- **noteのレコメンド構造を踏まえる**（`note-algorithm-and-growth-notes.md`より）: 2026年2月の刷新以降、SNSシェア経由の流入は8%程度まで低下し、note内回遊・検索が中心。フォロワー数よりも「一次情報性」「カテゴリ分類の正確さ」がPVに効くとされているため、フォロワー数だけで評価しない
- **内部基準（自アカウントの推移が十分に貯まってから）**: 直近5〜10記事の中央値をベースラインとし、そこから明確に外れた記事（2倍以上／半分以下）を「なぜそうなったか」の分析対象にする

### 3. 過去レポートとの比較（Claudeが実施）

`data/analysis/note-growth/report-*.json`の過去分と比較し、以下を算出する。

- フォロワー数・全体ビュー・スキ数の増減
- タイトル文字数と閲覧数の相関（15〜25文字の目安を満たしている記事とそうでない記事で差があるか）
- 公開頻度の実績（週2回程度の目安に対する実際の公開間隔）

### 4. 統合分析・次の施策

上記を踏まえ、次の記事制作・タイトル/タグ設計の施策を提案する。判断基準は`/growth-pdca`・`/x-growth-report`と同じ「インパクト×工数」マッピングを使う。**次回このスキルを実行する際にステップ0で検証できるよう、提案した施策は具体的に書く**。

- 小施策（即実行）の例: タイトル文字数の調整、ハッシュタグ構成の見直し、反応の良かった記事タイプの横展開
- 大施策（提案のみ）の例: note pro導入の再検討、有料記事・マガジン化の検討

### 5. 提案した小施策をinsightとしてDBに登録する（Phase 2）

SNSマーケティングハブPhase 2（改善案の自律立案ループ、`docs/design/sns-hub-phase2-pdca-loop/`）の入力として、ステップ4で挙げた「小施策（即実行）」を`sns_strategy_insights`テーブルに構造化して登録する（`/x-growth-report`・`/tiktok-growth-report`と同じADR 0027パターン）。

- 各「小施策」1件につき1レコードを`createInsight`（`scripts/lib/snsStrategyInsights.js`）で登録する
  - `platform`: `'note'`
  - `language`: `'ja'`
  - `format`: 施策が特定の記事タイプに限定される場合はその型名、全体に関わる施策なら`null`
  - `insightText`: 施策の内容（次回生成に注入してそのまま参照できる粒度で書く）
  - `evidence`: 根拠となった数値・観測
  - `source`: `'own-metrics'`
  - `researchMethod`: `'note-growth-report-skill'`
- 「大施策（提案のみ）」はinsight化しない
- 登録は専用スクリプトが無いため`node -e`等の一時的なコードで行ってよい

## 解釈の注意点

- noteのPVは公開直後よりも、note内検索・関連記事経由での緩やかな流入が中心のため、X/TikTokほど短期間で数値が確定しない。公開直後だけでなく1〜2週間後の数値も追う
- フォロワー数が少ない段階は母数が小さく、1本の記事が全体ビューを大きく左右するため、中央値や個別記事の傾向も併記する
- ダッシュボードの記事一覧は「全期間」で見た場合、`sns-pipeline-note.md`経由で生成された記事と、それ以前の`note-articles/`手動下書き由来の記事が混在する可能性がある。どちらの制作経路かを可能な範囲で区別する

## 関連

- 制作パイプライン: `docs/operation/sns-pipeline-note.md`
- アルゴリズム調査: `docs/reference/note-algorithm-and-growth-notes.md`
- X側の集客PDCA: `/x-growth-report`（同じ設計思想、プラットフォーム別に分離）
- TikTok側の集客PDCA: `/tiktok-growth-report`
- ブログ側の集客PDCA: `/growth-report`・`/growth-pdca`
