# ADR 0076: 自動起票の重複防止は、ランナー上のファイルではなく起票先の状態で判定する

## ステータス

採用（2026-09-25）

## 背景

Linearチケットの棚卸しで、`[content-quality]` ラベルのIssue 13件のうち **12件が完全重複**していることが分かった。

| タイトル | 件数 | チケット |
|---|---|---|
| `[content-quality] x下書きで「full-redo」による修正依頼が4件累積` | **6件** | BOA-375 / 378 / 385 / 388 / 393 / 416 |
| `[content-quality] tiktok下書きで「full-redo」による修正依頼が6件累積` | **6件** | BOA-374 / 377 / 384 / 387 / 392 / 415 |

2026-09-20から9-24まで、毎晩1件ずつ増えていた。

### 原因

`scripts/maintenance/content-ops-checks/check-revision-escalation.js` は、起票済みの組み合わせを `data/analysis/content-quality-audit/escalations.json` に記録して二重起票を防ぐ設計だった。冒頭コメントにもそう書いてある。

実際には次の連鎖で機能していなかった。

1. このスクリプトを実行するのは `.github/workflows/content-ops-nightly-check.yml`（毎晩）
2. **ワークフローは `escalations.json` をコミットしていない**
3. GitHub Actionsのランナーは実行ごとに破棄されるので、書いたファイルは残らない
4. `readEscalations()` はファイルが無いと `catch` で `{ escalated: {} }` を返す＝**常に「未起票」と判断する**

`escalations.json` はリポジトリに一度も存在していない。設計が想定していた永続化が、最初から成立していなかった。

### なぜ気づかれなかったか

- 起票は成功するのでワークフローは緑のまま
- Slack通知は「閾値超過時のみ」で、起票そのものは通知されない
- `session-start-check.js` の `qualityBacklog` は古い順に2〜3件しか提示しないため、同じタイトルが並んでいても目に入りにくい

**壊れていることが誰にも見えない**という点で、[ADR-0072](0072-verify-script-registry-and-ci.md)（検証スクリプトがCIに載っておらず、壊れていることに気づかれなかった）と同じ構造である。

## 決定

**重複判定の正を、ランナー上のファイルではなく起票先（Linear）の状態に置く。**

起票の直前に、同じ `platform:reasonCode` で未完了のIssueが既に存在するかを Linear に問い合わせ、あればスキップする。

```
filter: {
  team:   { id:   { eq:  <teamId> } },
  labels: { name: { eq:  "content-quality" } },
  state:  { type: { nin: ["completed", "canceled"] } },
}
```

取得したIssueのタイトルを前方一致で照合する。`state.type` の `nin`、`labels.name` の `eq`、いずれもLinear APIで動作することを実測で確認した。

### タイトルから件数を外す

旧タイトルは `…修正依頼が4件累積` のように件数を含んでいた。件数が5件に変われば別タイトルになり、完全一致による重複判定をすり抜ける。件数は本文に移し、タイトルは `…修正依頼が累積` で固定する。

照合を前方一致（`[content-quality] ${platform}下書きで「${reasonCode}」による修正依頼が`）にしてあるので、**件数入りの旧タイトルも既存として拾える**。移行のための特別な処理は要らない。

### `escalations.json` は残す

ローカル実行時の記録として残し、Linear側で既存を見つけたときには記録を復元する。ただし**判定には使わない**（ファイルが空でも正しく動く）。

## 結果

修正後に実行したところ、新規起票せず既存を検知した。

```json
{
  "escalated": [
    { "key": "tiktok:full-redo", "count": 6, "alreadyOpen": "BOA-415" },
    { "key": "x:full-redo",      "count": 4, "alreadyOpen": "BOA-416" }
  ],
  "checked": 5
}
```

修正前ならここで13件目・14件目が作られていた。

## 併せて直したこと: `linear-cli.js` の取りこぼし

`listIssues()` は `first: limit` を1回投げるだけでページネーションが無く、Linear APIの上限（250）を超える指定は `Argument Validation Error`、上限ちょうどの指定は**それ以上あっても黙って切り捨て**られていた。

棚卸しのように「全件見たつもり」で判断する用途では、取りこぼしが結論を誤らせる。実際この調査の初期に、`list "" 250` の結果（250件）を全件と誤認しかけた。`PAGE_SIZE = 100` で繋ぐように直した。

## 一般化

**自動起票・自動通知の冪等性は、実行環境に残るものではなく、送り先の状態で担保する。**

同じ穴は他にもありうる。次はいずれも「ランナー上のファイル」に状態を持たせている。

- `data/analysis/racer-news-pending-review/pending.json`（`collect-racer-news.yml`）— こちらはワークフローが `push-with-retry.sh` でコミットしているため成立している
- `data/analysis/x-posts/history.json` / `tiktok-posts/history.json` — 対話セッションが書くので成立している

新たに「ワークフローが状態ファイルを書く」設計をするときは、**そのファイルをコミットするステップが実際にあるか**を確認する。無ければ、送り先に問い合わせる方式に倒す。

## 検討したが採らなかった案

- **ワークフローに `escalations.json` のコミットを足す**: 最小の変更だが、(a) 夜間ワークフローがmasterへpushする経路が1本増える、(b) 並行実行や手元実行との競合で記録が食い違う、(c) ファイルが消えた時に静かに壊れるという性質は残る。Linearに聞けば状態は1つしかない。
- **タイトルを完全一致で照合する**: 件数がタイトルに残る限り、件数が変わった瞬間にすり抜ける。前方一致＋タイトルからの件数除去で根本を断つほうが確実。
