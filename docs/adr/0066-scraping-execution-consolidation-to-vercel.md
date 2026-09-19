# ADR 0066: データ取得の実行基盤をVercel（Functions + Vercel Cron）に一本化する

## ステータス
採用（2026-09-19、ユーザー判断）。[ADR-0056](./0056-new-scraping-execution-placement-principle.md)のうち「T4/T5は新規GitHub Actions、T2はcron-job.org起動のVercel Function」とする配置を置き換える（「T1をレガシーオーケストレーターに追加しない」原則は継続する）。

## 背景

データ取得が3つの実行基盤に分散している（2026-09-19時点の実測）。

| 基盤 | 現在動いている取得処理 |
|---|---|
| GitHub Actions | `scrape-scheduled.yml`（10分間隔、結果・オッズ・レース情報等）、`scrape-point-rank.yml`、`scrape-racer-season-stats.yml`、`scrape-venue-entry-course-stats.yml`、`scrape-venue-motor-stats.yml`、`collect-racer-news.yml` |
| cron-job.org → Vercel Functions | `api/cron/exhibition.js`（2分間隔）、`api/cron/race-notices.js` |
| Vercel Cron | 未使用（`vercel.json`に`crons`が無い） |

この分散が次の問題を生んでいる。

- 「何がどこで・いつ動いているか」を1箇所で把握できない（[BOA-343](https://linear.app/boat-ai/issue/BOA-343)が未着手）。障害調査のたびに3系統の実行履歴を見る必要がある
- GitHub Actionsの`concurrency`直列化によるキャンセル・キュー詰まり（[BOA-313](https://linear.app/boat-ai/issue/BOA-313)、[BOA-341](https://linear.app/boat-ai/issue/BOA-341)/[342](https://linear.app/boat-ai/issue/BOA-342)/[344](https://linear.app/boat-ai/issue/BOA-344)）
- 基盤ごとに監視が分断され、次の状態が見逃された（本番DBの実測）。
  - `scrape-point-rank.yml`は2026-09-16〜18に3回`success`だが、`racer_series_points`は0件
  - `scrape-racer-season-stats.yml`は月次で一度も実行されておらず、`racer_profiles.ability_index`は0/1,627件
- Vercelは既にProプランで、Vercel Cronは1分間隔・分単位精度で使える（[investigation.md](../proposal/scraping-serverless-migration/investigation.md)の2026-09-15追記、公式ドキュメントで確認済み）。純正Cronが直接Functionを呼ぶ場合、cron-job.orgの30秒タイムアウト制約は無くなる

## 決定

**データ取得（外部サイトを取得してDBに書き込む処理）は、Vercel Functions + Vercel Cronの1基盤に一本化する。**

- **新規**: GitHub Actions・cron-job.orgに、新規の取得ジョブを追加しない
- **既存**: 段階的にVercelへ移行し、移行完了後にcron-job.orgのジョブと取得系GitHub Actionsワークフローを廃止する。移行の順序・粒度は別途specで確定する（`scrape-scheduled`は結果・オッズ・レース情報が同居しているため、分割が前提）
- **対象外（GitHub Actionsのまま）**: 取得済みデータのDB内集計・統計更新（`aggregate-stats`・`update-*-stats`等）、モデル学習・予測生成（`train-*`・`generate-*`）、SNS・コンテンツ・sitemap系。外部サイトを取得せず、長時間のCPU処理を含むため。ただし「展示取得→予測リフレッシュ」のような取得との連動は、移行specで扱いを決める
- **バックフィル・過去分の一括取得**: Cronではなく手動実行のCLI（`scripts/maintenance/`）で行う。ただし取得ロジックは定期実行と同じ共有関数を使い、二重実装しない
- **Vercel Cronの性質への対応を設計に組み込む**（[Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)）:
  - タイムゾーンはUTC固定 → cron式はUTCで書き、JSTの運用時間帯をコメントで併記する
  - 失敗時の自動リトライは無く、配信はbest-effort（まれに未配信）→ 各実行は「本来取得済みであるべき窓のうち、未取得のもの」も再処理するcatch-up設計にする
  - まれに重複配信される → upsertによる冪等な書き込みにする（既存の展示取得は対応済み）
  - 関数の最大実行時間の制約 → 1回の呼び出しで処理する対象（会場・レース）を分割し、時間内に必ず終わる粒度にする
- **監視を1系統に統一する**: 取得件数・取得遅延・空テーブルを、DBの実測値から自動計測してSlack通知する。指標と閾値は`.claude/rules/data-acquisition.md`の「完了の定義」に従う

## 却下した選択肢

- **現状の3基盤並走を維持する**: 移行コストは最小だが、上記の「把握できない」「監視が分断される」問題が構造的に残る。0件書き込み・未実行が見逃された実績があるため却下
- **GitHub Actionsへ一本化する**: 展示・オッズのように取得窓が数分単位のデータは、`concurrency`直列化とキュー遅延で窓を逃す（BOA-313で実データ確認済み）。却下
- **cron-job.org + Vercel Functionsへ一本化する**: 外部の無料サービスへの依存が残り、30秒タイムアウトのため「即応答＋`waitUntil`」という複雑な設計が必要になる。Proプランで純正Cronが使えるため却下。cron-job.org側の実行履歴による二重監視は失うが、DB実測による監視に置き換える
- **低頻度データ（T4/T5）だけGitHub Actionsに残す（ADR-0056の従来方針）**: 実装は簡単だが、低頻度ゆえに「一度も動いていない」「成功扱いで0件」が見逃されやすいことが実証された。運用・監視の統一を優先して却下

## 影響

- [ADR-0056](./0056-new-scraping-execution-placement-principle.md)のT4/T5・T2の配置を置き換える。BOA-313のPhase 2/3（結果・オッズのVercel移行）は、本ADRの移行計画に統合する。FR-4（オッズ全券種）が旧基盤（`scrape-scheduled`）にある点も、移行計画の中で解消する
- `vercel.json`に`crons`を追加する。Vercel Cronの登録数・関数数の上限は、移行設計時に公式ドキュメントで確認する
- [docs/operation/external-cron-setup.md](../operation/external-cron-setup.md)は、cron-job.org廃止時に更新または廃止する
- 移行完了までは3基盤が併存するが、その間も新規の取得ジョブを旧基盤に追加しない
- 移行specは`docs/design/scraping-vercel-consolidation/`に別途作成する
