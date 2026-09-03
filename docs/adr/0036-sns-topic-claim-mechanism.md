# ADR 0036: ネタ×アカウントのclaim機構の実装方式

## ステータス
採用

## 背景
`sns_topic_targets`（ネタ×アカウントの中間テーブル）の各行を、チャネルごとに独立した複数のパイプライン（Routine）が同時にポーリングして拾う設計にする（`docs/design/sns-topic-gate/spec.md`要件5）。同じ行を2つのパイプラインが同時にclaimして二重生成することを防ぐ、アトミックな取り合い（claim）の実装方式を決める必要がある。

## 決定
**PostgRESTの条件付きPATCH（`WHERE status='pending'`を条件に含めたUPDATE）を採用する。**

```
PATCH /rest/v1/sns_topic_targets?id=eq.{id}&status=eq.pending
Prefer: return=representation
Body: { "status": "claimed", "claimed_by": "{routine_run_id}", "claimed_at": "{now}" }
```

レスポンスの配列が空（0行更新）であれば、他のパイプラインが先にclaimした（または既に状態が変わっていた）とみなし、そのターゲットをスキップする。1行返れば自分がclaimに成功したとみなす。Supabase（PostgREST）の標準的なREST操作のみで実現でき、既存の`updateDraft()`（`api/_lib/snsHubHelpers.js`）と同じ薄いラッパーパターンで実装できる。

## 却下した選択肢

- **`SELECT ... FOR UPDATE`によるトランザクションロック**: PostgRESTはリクエスト単位のHTTP APIであり、複数リクエストにまたがるトランザクション（BEGIN〜COMMIT）を維持できない。素のPostgres接続（`pg`クライアント等）に切り替える必要があり、既存のfetchベースのSupabase操作パターン（`scripts/lib/supabaseClient.js`・`api/_lib/snsHubHelpers.js`）から逸脱する
- **`pg_advisory_lock`によるアドバイザリロック**: 同上、素のPostgres接続が前提になる。加えてプロセスがクラッシュした場合のロック解放漏れという運用リスクも増える
- **Redis等の外部分散ロック**: 新規インフラの導入コストが見合わない。boatAIはSupabaseのみで完結させる方針（`docs/design/sns-marketing-hub/spec.md`の非機能要件「新規の月額固定費追加を避ける」を踏襲）

## 影響
- claimしたパイプラインが生成途中で異常終了した場合、そのターゲットは`claimed`のまま放置される（claim解放・タイムアウトの仕組みは今回スコープ外、`docs/design/sns-topic-gate/spec.md`未確定事項#3）。当面は`sns-hub`の進捗マトリクスUIで人間が気づき、手動で`pending`に戻す運用とする
- 同じ仕組みは`sns_topics`自体の承認処理（複数の承認者が同時に同じネタを操作するケース）には使わない。ネタ承認はspecの既存方針通り1件ごとの人間操作であり、同時競合の可能性が実運用上ほぼ無いため、`sns_drafts`の承認操作と同様の単純な状態更新で十分と判断する
