# daily-auto型ネタ、note向けターゲットがblog依存で恒久的にpending滞留する

## 発覚経緯

2026-10-05、noteチャネル別パイプラインRoutine（`docs/operation/sns-pipeline-note.md`）の定期実行で、`getClaimableTopicTargets()`が返した8件のclaim可能ターゲットすべてが`content_type_id`＝`daily-auto`型（「本日のイン崩れ指数」系）で、作成日が2026-09-05〜09-14（実行時点で3週間〜1ヶ月前）だった。

ドキュメント通りに1件（最古のターゲット、`sns_topic_targets.id=c87b8198-...`）をclaimし、対応するblog行（`platform='blog'`・同じ`content_group_id`）の存在を確認したところ0件だったため、`pending`に差し戻して正常終了した。

## 問題

8件全ての`topic_id`について、対応するblog向け`sns_topic_targets`行を確認したところ、全件が次のいずれかだった。

- `status='skipped'`（例: 「premise-stale: 本日開催を前提としたネタだが実行時点で該当レースが終了済み」「ブログはevergreenのため単一レース・単一日の予測値を記事化できない」等の理由）
- `status='pending'`（blogパイプライン側がまだclaimしていない。claimされても同じ理由でskipされる可能性が高い）

つまりdaily-auto型（当日限定のイン崩れ指数ダイジェスト）は、**設計上blogチャネルでは生成されない**（blogはevergreen記事という制約と、ネタの「本日」という時制が構造的に矛盾する）。noteパイプラインはblog本文への変換を前提に設計されているため（`sns-pipeline-note.md`冒頭）、blogが永久に生成しないdaily-auto型のnoteターゲットは、**claim→blog未検出→pending復帰のサイクルを無限に繰り返すだけ**で、生成されることが無い。

この8件は氷山の一角で、同じtopic_idに対するX向けターゲットの一部も同様の理由（premise-stale等）で`skipped`になっている実績がある。noteだけでなく、blog依存を持つ他チャネルも同じ詰まりを抱えている可能性がある。

## 影響

- 無駄なポーリング（1時間おき×各チャネル）がこの種のターゲットに対して永久に発生する
- sns-hub管理画面等で「claim可能件数」を見ても、実際には生成され得ない件数が混ざって見える

## 考えられる対応案（未検討・要判断）

1. noteパイプライン側で、`sns_topics.content_type_id`がdaily-auto型の場合はblog依存を外し、X向けと同様に当日中にblog非依存で直接生成するか、またはそもそもnote向けターゲットを作らない（`sns_topic_category_channels`でdaily-auto型のnote有効化を見直す）
2. blog側パイプラインが「この種別は生成しない」と判定した時点（`status='skipped'`になった時点）で、同じ`topic_id`に紐づく他チャネルのblog依存ターゲットも連動して`skipped`にする仕組みを設ける
3. ターゲットの`created_at`から一定期間（例: 7日）経過して未生成のまま`pending`なら、無限リトライを避けるため`skipped`扱いにする期限切れロジックを追加する

いずれもネタ種別設計・チャネル設定の判断を伴うため、本ドキュメントでは実装せず起票のみとする。
