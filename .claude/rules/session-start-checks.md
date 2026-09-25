# セッション開始時の確認

セッション開始時に次を実行し、**結果をこのセッションの最初の応答で報告する**。

```bash
node scripts/maintenance/session-start-check.js
```

1回の実行で次を集める。

| 項目 | 何を見るか |
|---|---|
| `xVideo` / `tiktok` | 本日の投稿本数が目標に達しているか |
| `racerNews` | 選手ニュースの要確認（自動投入されなかった候補） |
| `growthSkills` | `/x-growth-report`・`/tiktok-growth-report`・`/note-growth-report` の最新レポートが1週間以上前か |
| `pendingInsights` | 戦略メモ（`sns_strategy_insights`）の承認待ち |
| `qualityBacklog` | Linearの `content-quality` ラベルの古いもの2〜3件 |
| `visualAssetAge` | 90日以上更新されていない視覚素材 |
| `deprecatedTerms` | 廃止済み用語の残存件数 |
| `contentIndexCoverage` / `missingContentIndex` | トレーサビリティ索引の欠落・形式エラー |
| `tweetDrafts` | 滞留している下書き（旧フロー、残置） |

**該当が1件以上あれば、ユーザーから話しかけられるのを待たずに最初の応答で提示する。**
「いいえ」または反応が無ければその日はスキップし、催促しない。

各項目を確認したあと実際に何をするか（投稿の作り方・承認の取り方・型の選び方）は
[`content-ops.md`](./content-ops.md) にある。そちらは `public/blog/**`・`note-articles/**`・
`sns-video-studio/**` 等を編集するときに読み込まれる。

---

このファイルだけを常時読み込みに残しているのは、上の確認が**特定のファイルを編集する前に
発火する必要がある**ため。運用フローの本体（フローA〜C）は、該当する領域を触るときだけ
読めばよいので条件付きに移した（2026-09-25、常時読み込みが613行・84.5KBに膨らみ、
Anthropicの公式ガイダンス（目安200行）を大きく超えていたため）。
