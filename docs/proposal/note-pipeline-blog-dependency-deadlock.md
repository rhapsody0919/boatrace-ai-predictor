# noteパイプライン: ブログ依存チェックが「永久にスキップ済み」を区別できない

## 発見の経緯

2026-10-15 06:14 UTC、`sns-pipeline-note`Routineの定期ポーリング実行時、`getClaimableTopicTargets()`で取得できたnote向けclaim可能ターゲット7件のうち、claimして依存チェックした1件（`sns_topic_targets.id=c87b8198-e3f3-49d4-91b1-fe694e05e379`、トピック「桐生会場の1コース勝率は全国平均とほぼ同水準」）で、対応する`platform='blog'`の`sns_topic_targets`行（`id=703a9e44-c3ca-4947-9ed9-1b279a5a7f16`）が`status='skipped'`だった（`skip_reason`はnull）。

`docs/operation/sns-pipeline-note.md`「2. ブログ本文の生成状況を確認」の手順どおり、`pending`に戻して今回は生成せず終了した（正常系の処理として実行済み）。

## 問題

手順書は「見つからない場合」を「ブログ側がまだ生成していない（これから生成される）」ことしか想定していない。しかし実際には、対応する`platform='blog'`の`sns_topic_targets`行は3状態（`pending`=未処理・`generated`=生成済み・`skipped`=永久に生成しない）のいずれかであり、**`skipped`の場合は今後も永久にブログ本文が生成されない**。

この区別をしないため、`skipped`なブログ依存を持つnoteターゲットは、ポーリングのたびに「claim→チェック→pendingに戻す」を無限に繰り返す。実際、今回確認した7件のclaim可能なnoteターゲットのうち確認した限り全件（下記）で、対応するblogターゲットが`skipped`だった。

| note target (topic概要) | blog target status | skip_reason概要 |
|---|---|---|
| 桐生 1コース勝率（venue-characteristic） | skipped | reasonなし（人間がsns-hub UIで手動トグルした可能性。この topic 自体はnote/x/youtubeでは生成・投稿済み） |
| 桐生 1号艇逃げ決まり手構成比（venue-characteristic） | skipped | 「全国トップクラス」の主張が実データ非裏付け＋既存記事と重複 |
| 本日のイン崩れ警戒レースTOP5（daily-auto） | skipped | premise-stale（当日限定ネタが翌日以降に実行され事実と不整合） |
| 本日開催の全108レースランキング（daily-auto） | skipped | 当日限定ネタがstale化、ブログはevergreen前提のため不整合 |
| 桐生1R イン崩れ注意度99%（daily-auto） | skipped | 実データ不一致（daily-auto提案ロジックのバグ疑い、PR #1511で同種確認済みと記載） |
| 福岡4R イン崩れ指数（daily-auto） | skipped | 実データ不一致（同上のバグ疑い） |
| 下関12R・常滑7R イン崩れ指数（daily-auto） | skipped | 実データ不一致（同上のバグ疑い） |

## 影響

- noteの未処理バックログ（claim可能7件）は実質すべて消化不能であり、見た目上「note下書き生成待ちが7件溜まっている」ように見えるが、実際には永久にnote下書きが作られない
- 同じ依存チェック方式を使うx/tiktok/youtubeパイプライン（`docs/operation/sns-pipeline-{x,tiktok,youtube}.md`は未確認、本調査では確認していない）にも同種の無限ループが起きている可能性がある（note以外は本Routineの対象外のため未調査）
- daily-auto型トピック提案ロジックの実データ不一致バグが、2026-09-09・09-13・09-14生成分で繰り返し発生している

**PR #1511についての訂正（Agent toolで確認済み）**: skip_reason文中の「PR #1511で桐生1Rに同種の不一致が確認済み」という記述は、**PR #1511がバグを修正したという意味ではない**。PR #1511は2026-10-13作成・merge（title「content: イン崩れ指数100%の実例記事を追加（9/13福岡3R）」）のブログ記事追加PRで、コード変更は無し。本文中でたまたま桐生1Rの不一致（topic_textの「99%・ST0.215秒・AI逃げ確率35%」が実データの82.7%・別会場の値と不一致）を観測し、「daily-auto提案ロジックのバグの可能性があり、別途調査が必要」と記載して`markTopicTargetSkipped`しただけで、**提案ロジック自体の調査・修正はPR #1511のスコープ外のまま未着手**。このバグは現時点で未修正・再発可能性ありと扱うべき。

## 提案（対応は次回以降・人間判断）

1. `getClaimableTopicTargets()`またはnote/x/tiktok/youtube各パイプラインの依存チェックに、「対応するblogターゲットがskippedなら、このターゲット自身もskippedにする」分岐を追加し、無限ループを止める
2. 既存の7件の滞留ターゲットをどう扱うか（人間判断でskippedにする／別チャネル向けに作り直す等）を決める
3. **daily-auto提案ロジックの実データ不一致バグは未修正のまま**。提案元スクリプト（`todays-volatility-digest.js`等、本Routineでは未特定）を特定し、根本原因を調査・修正する（PR #1511は観測と一次対応のみで、調査自体は「別途」と明記されたまま着手されていない）
