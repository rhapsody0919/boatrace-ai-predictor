# スクレイピング基盤のサーバーレス移行 spec

種別: インフラ改善
対応調査: [docs/proposal/scraping-serverless-migration/investigation.md](../../proposal/scraping-serverless-migration/investigation.md)（背景・根本原因・Vercel/cron-job.org制約調査・Active CPU実測結果はこちらを参照）

## 背景・目的

ユーザーから「レース前に展示情報が無い」「レース後に結果が無い」という信頼性への懸念が提起された。調査の結果、根本原因は個々のスクリプトロジックではなく、**GitHub Actionsの`concurrency`直列化により、処理が5分のトリガー間隔を超えると後続ジョブがキャンセルされ、展示データ取得の窓が丸ごと失われる**という構造的な問題と判明した（実データで確認済み: 2026-09-13に福岡7レース連続欠落）。

恒久対策として、時間に厳しい処理（展示データ・オッズ・結果）をGitHub ActionsからVercel Serverless Functionsへ移行する。Vercel Functionsは起動コストがほぼゼロで、GitHub Actions特有の「チェックアウト+npm install」の固定コストや`concurrency`グループによる直列化・キャンセルの問題が構造的に存在しない。

## 非目標

- ML学習・日次集計・選手プロフィール取得等、分単位の即時性が不要なバッチ処理はGitHub Actionsに残す（対象外）
- AWS等への移行は対象外（[investigation.md](../../proposal/scraping-serverless-migration/investigation.md)の通り、具体的な制約にぶつかるまで不要と判断済み）

## 移行対象と優先順位

ユーザー影響が大きい順に段階的に移行する。各段階で安定を確認してから次に進む（一度に全部切り替えない）。

1. **Phase 1: 展示データ**（`scrape-exhibition-data.js`）— 最優先。レース前にユーザーが直接見るデータで、今回の問題提起の直接的な原因
2. **Phase 2: 結果取得**（`scrape-results.js`）— レース後にユーザーが見るデータ。「結果が載っていない」というもう一つの指摘に対応
3. **Phase 3: オッズ**（`scrape-odds.js`）— ユーザー影響はPhase1/2より間接的（現状表示に使っていない、将来の期待値分析用データ）だが、同じ問題を抱えているため最終的には移行する

予測リフレッシュ（`generate-predictions.js`のメイン処理）・レース情報更新（`update-race-info.js`）は当面GitHub Actionsに残し、Phase 1〜3の結果次第で追って検討する。

## アーキテクチャ

### 全体構成

```
cron-job.org（種類ごとに専用ジョブ、1〜2分間隔）
  → Vercel Serverless Function（/api/cron/exhibition 等）
    → 既存のrun(schedule, date)関数をそのまま呼び出す（ロジックの二重実装をしない）
    → Supabaseへ書き込み（既存と同じテーブル・同じupsertロジック）
```

### 既存コードの再利用方針

`scripts/daily/scrape-exhibition-data.js`・`scrape-odds.js`・`scrape-results.js`は、いずれも`export async function run(schedule, date)`という共通インターフェースを既に持っている（オーケストレーター`scrape-scheduled.js`から呼ばれる設計のため）。この`run()`関数は**そのままVercel Functionから呼び出せる**——CLIエントリポイント（`if (process.argv[1] === ...)`のガード部分）とは独立しているため、ロジックを一切複製・書き換えずに再利用できる。

新規に書くのは「Vercel Functionのハンドラー（薄いラッパー）」のみ:

```js
// api/cron/exhibition.js（イメージ）
import { getTodayDateJST } from "../../scripts/lib/dateUtils.js";
import { getRaceSchedule } from "../../scripts/lib/raceSchedule.js";
import { run as runExhibition } from "../../scripts/daily/scrape-exhibition-data.js";

export const config = { maxDuration: 60 }; // 300秒まで可能だが、cron-job.orgの30秒タイムアウトを踏まえ余裕を持って短く設定

export default async function handler(req, res) {
  // cron-job.orgからの正当なリクエストか検証（下記セキュリティ参照）
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const date = getTodayDateJST();
  const schedule = await getRaceSchedule(date);
  if (schedule.length === 0) {
    return res.status(200).json({ updated: false, message: "no schedule" });
  }
  const result = await runExhibition(schedule, date);
  return res.status(200).json(result);
}
```

**要確認事項（実装時）**: `scripts/lib/`配下の共有モジュール（`supabaseClient.js`、`raceSchedule.js`、`dateUtils.js`）が、Vercelのモジュール解決・バンドル方式（`api/`配下からリポジトリルート外を`import`できるか）で問題なく動くか、実際にデプロイして確認する。Vercelは`api/`ディレクトリ配下のファイルとその依存関係を自動的にバンドルするため、`scripts/`配下への相対import自体は技術的に可能なはずだが、実機確認が必須。

### タイムアウト設計（30秒制約への対応）

cron-job.org側のタイムアウトは30秒（[investigation.md](../../proposal/scraping-serverless-migration/investigation.md)で確認済み）。Vercel Function自体は最大300秒（Hobby、Fluid Compute）まで動けるが、**cron-job.orgへの応答は30秒以内に返す必要がある**。実測ベース（展示データ8レースで約55秒、これは複数レースをまとめて処理した場合の数値）を踏まえ検討した結果、**案B（`waitUntil`でバックグラウンド継続）を採用した**（2026-09-14決定・実機検証済み、詳細は上記「決定事項」参照）。

案A（1回の呼び出しで処理するレース数を絞る）は不採用: 上限を超えた分のレースが次のtickまで待たされる、というアプリケーション層のキューを新たに作ってしまい、GitHub Actionsのconcurrencyキューで起きた問題を小さいスケールで再現するだけで根本解決にならないため。

### セキュリティ

`api/`配下のエンドポイントはVercelにデプロイされた時点で公開URLとしてアクセス可能になる（誰でも叩けてしまう）。cron-job.orgからの正当なリクエストであることを検証する仕組みが必須:

- `CRON_SECRET`という環境変数をVercel側に設定し、cron-job.org側のリクエストヘッダー（`Authorization: Bearer {CRON_SECRET}`）で一致確認する（Vercel公式ドキュメントが推奨するパターンと同じ）
- 既存の`docs/operation/external-cron-setup.md`のGitHub PAT管理と同様、`CRON_SECRET`もローテーション運用を検討する

## 移行手順（安全第一、段階を飛ばさない）

### Step 1: 実装・単体でのデプロイ確認
1. `api/cron/exhibition.js`を実装、`CRON_SECRET`をVercel環境変数に設定
2. デプロイ後、`curl`で手動リクエストを送り、正しくSupabaseに書き込まれることを確認する（本番のSupabaseに対してだが、既存のupsertロジックそのままなので、書き込み内容自体は既存パイプラインと同一——実害は無い）
3. この時点では**cron-job.org側のジョブはまだ作成しない**（手動確認のみ）

### Step 2: 並走期間（既存のGitHub Actionsは止めない）
1. cron-job.orgにジョブを追加し、Vercel Function側を1〜2分間隔で稼働開始する
2. 既存のGitHub Actions側（`scrape-scheduled.js`内の展示データ処理）は**そのまま動かし続ける**（両方が同じテーブルに書き込むが、upsertなので競合しても後勝ちで問題ない）
3. 最低3〜7日間、両方を並走させる
4. 並走期間中、以下を毎日確認する:
   - 展示データ欠落率（本調査で使ったスクリプトと同じロジックで、結果確定済みレースのうち展示データが無いものの割合を計測）が並走前より悪化していないか
   - Vercel側のActive CPU実測値が想定通りか（investigation.mdの試算との比較）
   - cron-job.org側の実行履歴・失敗通知に異常が無いか

### Step 3: 切り替え
1. 並走期間の結果に問題が無ければ、GitHub Actions側の展示データ処理（`scrape-scheduled.js`内の該当呼び出し）を無効化する
2. **コードは削除しない**（コメントアウト・フラグで無効化する程度に留め、切り戻しを容易にする）
3. 切り替え後も1週間は欠落率を監視する

### Step 4: 切り戻し条件
以下のいずれかが発生した場合、即座にcron-job.org側のジョブを無効化し、GitHub Actions側を再有効化する:
- 展示データ欠落率が並走前より悪化した
- Vercel側でエラー率が有意に上昇した
- Active CPU等のクォータ超過でVercel側の実行がブロックされた

### Phase 2・Phase 3への展開
Phase 1（展示データ）で上記Step 1〜4が問題なく完了したら、同じ手順をPhase 2（結果取得）・Phase 3（オッズ）に適用する。

## データ精度の検証（`.claude/rules/analysis.md`準拠）

移行前後で以下を独立して検証する（コードレビューとは別の観点）:
1. 並走期間中、GitHub Actions版とVercel版で同じレースに対して取得した展示データの値が一致するか（同じ公式ページを見ているので理論上一致するはずだが、パース処理の実行タイミングのズレで多少の差異が出る可能性はある——大きく異なる場合はロジックの問題を疑う）
2. 欠落率の実測値をStep 2の並走期間中、日次で記録し、移行前3日間（2026-09-12〜14、投稿済み: 0.6%/6.7%/8.1%）と比較する

## 決定事項（2026-09-14、Step 1完了に伴い確定）

1. ~~Vercelの`api/`配下から`scripts/`配下のモジュールをimportする際のビルド・バンドル挙動~~ → **確認済み**。`vercel build`のローカル実行で`scripts/lib`・cheerio・`@vercel/functions`が全て正しくバンドルされることを確認した
2. ~~30秒タイムアウト対応の案A/Bどちらを採用するか~~ → **案Bで確定**。cron-job.orgのタイムアウト（30秒）と実際のスクレイピング所要時間は別々の関心事のため、`waitUntil()`（`@vercel/functions`）でレスポンスを即座に返し実処理をバックグラウンド継続する設計にした。理由: 案A（1回あたりの処理件数に上限を設ける）は、GitHub Actionsで起きたキュー詰まりを別の場所で再現するだけで根本解決にならない。1回あたりの処理レース数に人為的な上限は設けない
   - **実機検証済み**（2026-09-14）: 応答時間は対象レース数に関わらず1〜2秒（202 Accepted）。バックグラウンド処理は別途外部から同じ公式ページをスクレイピングして得た値と、Supabaseに書き込まれた値が完全一致することを確認した
   - 副作用: cron-job.orgのタイムアウトに基づく失敗通知は「スクレイピングが成功したか」の指標としては機能しなくなる（常に200/202が即座に返るため）。これは元々当てにすべきでない指標だったため許容し、正式な監視は下記の日次欠落率チェックに一本化する

## 未確定事項

1. cron-job.orgの実行間隔をPhase毎にどう設定するか（展示は30/15/10分前ウィンドウを狙うなら1〜2分間隔が望ましいが、既存のGitHub Actions実行と重複しすぎない配慮も要る）。**追記（2026-09-14、PR #639セルフレビューで発見）**: `waitUntil`化により応答が対象レース数に関わらず常に1〜2秒で返るため、cron-job.org側は前回invocationのバックグラウンド処理が完了したかを一切知らずに次の実行を予定通り発火する。`scrape-exhibition-data.js`の重複スキップ判定（`getExistingExhibitionRaceIds()`）は各`run()`開始時点で「書き込み済み」のrace_idしか見ないため、前回invocationがまだスクレイピング中（未書き込み）の間に次のinvocationが始まると、同じレースを重複スクレイピングしてしまう（boatrace.jpへの重複リクエスト増加・Supabaseへの重複書き込み、upsertのため実害は書き込み結果自体には出ないが、ボット判定リスクと無駄なActive CPU消費に繋がる）。対策として実行間隔を人為的にロックする仕組み（分散ロック等）を追加するのではなく、**cron-job.orgの間隔をバックグラウンド処理の実測完了時間（investigation.mdの実測ベースで数十秒程度）に対して十分余裕を持たせる**ことで運用上回避する方針とする（コードに複雑さを持ち込まない、案A不採用の理由と同じ判断軸）
2. 並走期間の具体的な長さ（3日〜7日を目安としているが、レース開催日数の関係で調整の余地あり）
3. Phase 1完了後、Phase 2・3に進む前にユーザーへの中間報告を挟むかどうか
