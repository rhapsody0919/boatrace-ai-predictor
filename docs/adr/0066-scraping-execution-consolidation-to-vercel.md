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
- レビュー（2026-09-19、Vercel公式ドキュメントで確認）の事実: Cron登録数は1プロジェクトあたり100個、Proは1分精度、関数の最大実行時間は800秒

## 決定

**データ取得（外部サイトを取得してDBに書き込む処理）は、Vercel Functions + Vercel Cronの1基盤に一本化する。**

- **新規**: GitHub Actions・cron-job.orgに、新規の取得ジョブを追加しない
- **既存**: 段階的にVercelへ移行し、移行完了後にcron-job.orgのジョブと取得系GitHub Actionsワークフローを廃止する。移行の順序・粒度は別途specで確定する（`scrape-scheduled`は結果・オッズ・レース情報が同居しているため、分割が前提）。旧基盤の廃止条件は「`morning-init`を含む全取得処理の移行完了」とする
- **対象外（GitHub Actionsのまま）**: 取得済みデータのDB内集計・統計更新（`aggregate-stats`・`update-*-stats`等）、モデル学習・予測生成（`train-*`・`generate-*`）、SNS・コンテンツ・sitemap系。外部サイトを取得せず、長時間のCPU処理を含むため。**→ この区分は §改訂1（2026-09-25）で「実測の実行時間」基準に改めた。**ただし「展示取得→予測リフレッシュ」のような取得との連動は、移行specで扱いを決める
- **移行対象に含める（対象外としない）**: 取得系である`morning-init.js`（レース・出走表の初期化。`scrape-to-json.js`→`races.json`、`execSync`・`git log`に依存）。全Vercel関数が`getRaceSchedule`経由で`races`に依存するため、`races`の初期化がGitHub Actionsに残ると、取得系GitHub Actionsを廃止できない
- **関数のリージョン**: DBはap-southeast-2（シドニー）。関数のリージョンはsyd1・hnd1を、DBへの往復とboatrace.jpの取得の遅延を実測して決める
- **バックフィル・過去分の一括取得**: Cronではなく手動実行のCLI（`scripts/maintenance/`）で行う。ただし取得ロジックは定期実行と同じ共有関数を使い、二重実装しない
- **Vercel Cronの性質への対応を設計に組み込む**（[Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)）:
  - タイムゾーンはUTC固定 → cron式はUTCで書き、JSTの運用時間帯をコメントで併記する
  - 失敗時の自動リトライは無く、配信はbest-effort（まれに未配信）→ 各実行は「本来取得済みであるべき窓のうち、未取得のもの」も再処理するcatch-up設計にする
  - まれに重複配信される → upsertによる冪等な書き込みにする（既存の展示取得は対応済み）
  - 関数の最大実行時間の制約 → 1回の呼び出しで処理する対象（会場・レース）を分割し、時間内に必ず終わる粒度にする
  - 前回の実行中でも次の実行が起動しうる（公式ドキュメント manage-cron-jobs に明記。1分間隔では重複が増える） → DB上のリース（ロック行）による排他を設計に入れる
  - 並走期間（新旧基盤の併存中）の二重書き込み → 行に取得元（source）を持たせて区別し、窓内取得率が水増しされないようにする
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
- 展示取得のGitHub Actionsスキップ（2026-09-16〜）以降、展示更新が予測リフレッシュの起動条件（`scrape-scheduled.js`の`anyUpdated`）に入らなくなっている。実害は未検証（`predictions.predicted_at`は買い目オッズ更新でも更新されるため判別不能）。移行specで、展示→予測リフレッシュの連動を扱う
- Supabaseでdisk IO budget枯渇の警告が出ている（2026-09-19）。移行後の書き込み量を増やさない設計にする（条件付きupsert、変更の無い行を書かない、Cron頻度の見直し）。移行はDisk IO対策（orchestration.mdのWS8）と並行して進める
- 移行specは、既存の`docs/design/scraping-full-coverage/`と`docs/design/scraping-serverless-migration/`を統合改訂する（新規に三重管理しない）。体制の正本は`docs/design/scraping-vercel-consolidation/orchestration.md`

---

## 改訂1（2026-09-25）: 対象外の線引きを「カテゴリ」から「実測の実行時間」に変える

### 何が起きたか

「本日のデータ一覧」（`/today`、BOA-402）が、定時実行では**一度も生成できていなかった**。原因は2つあり、どちらも本ADRの「対象外（GitHub Actionsのまま）」という区分に由来する。

1. **実行順序の破綻**: 集計（GitHub Actions、JST 01:10）が、材料である `race_results.actual_course_*` を書く `kfile-sync`（Vercel Cron、JST 07:00）より6時間早く、前日ぶんを取り込めなかった。基盤が分かれていたため、依存関係が時刻でしか表現できず、しかも噛み合っていなかった
2. **定刻性**: GitHub Actions の定時実行は、このリポジトリの実測で **2.5〜4.5時間遅れるのが常態**だった（5日連続で観測）。朝に出ることが価値の中心のページで、JST 05:30 を狙っても実際の公開は 08:00〜12:30 になる

| ワークフロー | 予定(UTC) | 実際(UTC) | 遅れ |
|---|---|---|---|
| `aggregate-racer-course-technique-stats` | 16:10 | 19:57 | +3h47m |
| `generate-morning-digest`（3スロット） | 20:30 / 21:30 / 23:00 | 23:18 / 23:57 / 翌01:11 | +2h11m〜+2h48m |
| `update-winning-technique-stats` | 15:35 | 18:16〜20:05（5日連続） | +2h41m〜+4h30m |

対照的に、Vercel Cron の `kfile_sync` は JST 07:00:20 に成功しており、定刻に起動している。

### 決定

**「取得済みデータのDB内集計」を一律に対象外とするのをやめ、実測の実行時間で線を引く。**

- 本ADR本文が対象外の理由に挙げた「**長時間のCPU処理を含むため**」は、集計ジョブ一般に当てはまるわけではない。重い処理がSQL（Postgres側）にあるジョブは、Node側の実行時間が短く、Vercel Functionsの制約に収まる
- **関数の `maxDuration`（このプロジェクトでは最大300秒）に十分な余裕をもって収まり、外部サイトを取得しないジョブは、Vercel Cron へ移してよい**
- モデル学習・予測生成（`train-*`）のように、Node側で実際に長時間CPUを使うものは引き続き対象外

### 今回移したジョブ（実測）

| ジョブ | 実測の実行時間 | 重い処理の場所 | 移行後の時刻(JST) |
|---|---|---|---|
| `racer_course_technique_stats`（旧 `aggregate-racer-course-technique-stats.yml`） | **27.0秒** | 2つのSQL RPC（Postgres側）。Node側は9,471行のページングと upsert のみ | **13:00** / 17:00（補足） |
| `morning_digest`（旧 `generate-morning-digest.yml`） | **5.5秒** | 同じくDBの読み書きのみ | **05:30** / 06:30 / 08:00（補足） |

集計を 01:10 → **13:00** にしたのは、`kfile_sync`（07:00 / 12:00）より後にして前日ぶんの進入コースを取り込むため。これで翌朝 05:30 の生成まで約16時間の余裕ができる。

### 影響

- 依存関係（`kfile_sync` → 集計 → ダイジェスト）が1つの基盤の中で完結し、時刻の前後関係を1箇所（`vercel.json`）で読めるようになった
- 共通ラッパ（`scripts/lib/scrapeJobs/cronWrapper.js`）に乗ったため、CRON_SECRET認証・リース（二重起動防止）・`off`/`shadow`/`live` のモード切替・`scrape_job_state` への実行記録・既存の監視（`evaluateJobStates` の連続失敗アラート）が自動で付いた
- 旧ワークフローは **`workflow_dispatch` のみ残した**（`schedule` を削除）。障害時の手動復旧・任意日のバックフィルに使う
- **ジョブの有効化には `scrape_job_state` への行の投入が要る**（マイグレーション 099）。行が無い間は `off` 扱いで何も書かない
- GitHub Actions のログ保持と比べ、Vercel の関数ログは保持が短い。実行の記録は `scrape_job_state.last_report` に残す設計で補う
