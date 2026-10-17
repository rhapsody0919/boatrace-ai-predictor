# 引き継ぎ: BOA-822 /step4 の進み具合（2026-10-17 更新）

[handoff-step4.md](./handoff-step4.md)（読む順・覆さないこと）の続き。進み具合の正は [tasks.md](./tasks.md) のチェック。判断が要る点の報告先は Orchestrate（`/orchestrate` のセッション）。

## 済んだもの

| PR | tasks | 状態 |
|---|---|---|
| #1461 | 1〜5 夜の表のジョブ | マージ済み。155 適用・full 実行・dispatch live（10/13） |
| #1462 | 7〜12 生成・やり直し・監視 | マージ済み。監視は表（in_caution_health）・当日（in_caution_today_health）とも live |
| #1521 | 監視の失敗が通知の前に消える・中止で誤報（レビュー F1・F2） | マージ済み |
| #1492 | 14・15 RPC の経路 | マージ済み。157 は 10/17 適用・確認済み（#1594） |
| #1595 | 17〜20・26 の AIコピー分（AI予想タブのカード） | マージ済み（10/17）。ファン評価3周・mock-diff-checker 済み |
| #1602 | 21・22（一覧の札・ホーム） | **レビュー前**。/code-review・wording-editor・mock-diff-checker（mock/2-lists-375.png）・ファン評価ループが残り |

## 公開の前提（覆さない）

- 公開の1行 PR（task 39）は tasks 21〜24 がすべてマージされてから。カードの導線の先（/accuracy＝24、思考アシスト＝23）と一覧・ホーム（21・22）が旧指数のままだと食い違う（#1595 のファン評価で2周続けて出た指摘の原因分析）
- 2026-10-17 オーナー決定（Orchestrate 経由）
  - 準優・優勝戦も 35/55 のまま（将来の議論は Orchestrate が起票）
  - 龍神ソナーへのボタンは件数を書かない（「類似レースで見ると？」）
  - 点線のラベルは「全レース」（/accuracy＝task 24 でもそろえる）
  - 受け入れ E2E の補助関数は見出しの表示を待つだけ直してよい（済み）

## 次にやること

1. #1602 のレビュー一式（上の表）。Preview の `?caution=1` で /（ホーム）と /venue/{会場} を見る。画面が変わるので、Preview と確認項目を CI と並行で Orchestrate に送る
2. task 23 思考アシスト（1着のバー = 100 − pct、行ごとの範囲の名前と件数、裏返しの説明の1行）
3. task 24 /accuracy と /winning-technique?tab=volatility（`InCautionAccuracyChart`。点線のラベルは「全レース」）。task 29（夜のジョブで accuracy_cache.in_caution_accuracy を書く）が要る
4. task 25 /races、26 のシェア文、27 計測、28 確認

## 知っておくこと

- Node は `$HOME/.nvm/versions/node/v22.20.0/bin`（既定の node は 16）。pytest は Python 3.12 の venv に pandas 3.0.6・pytest を入れて流した
- 本番の読み取りは Management API の SELECT（`SUPABASE_ACCESS_TOKEN`、.env.local）と PostgREST。Supabase MCP はこの環境で繋がらない
- ワークフローの手動起動はフックで止められる（ユーザー本人が行う）
- 録画データ（e2e/recordings）は 157 の適用前のまま（10/17 時点）。画面の再現テストは `page.route` で応答を差し替えて書く（`e2e/in-caution-card.spec.js`・`e2e/in-caution-lists.spec.js`）
- 会場のレース一覧は `/api/predictions/{date}`、ホームは `/api/races/today` を読む
- 過去の日付の `/api/predictions/{date}` は CDN に1日残る
- 別スコープの起票: BOA-857・858・859（設計時）、BOA-889（カードの P3）、BOA-891（出現パターンのコースの選び方）
