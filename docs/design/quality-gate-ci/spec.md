# 品質ゲート集約CI — 仕様書

- **種別**: データ・分析機能（画面変更なし。CI・検証スクリプト基盤の再編）
- **Linearチケット**: 未起票（この仕様確定後に親チケットを起票する）
- **背景**: 「その場限りの修正ではなく恒常的な改修になっているか」というレビュー観点から、既存の検証スクリプト群の実態を調査して発見した構造問題への対処。

---

## 背景: 実測で判明した現状

2026-09-25、`scripts/maintenance/verify-*.js` 全57本を実際に実行して測定した。

| 指標 | 実測値 |
|---|---|
| verify-*.js の本数 | 57本 |
| そのうちCIワークフローから実行されているもの | **2本**。`verify-query-errors.js`（`verify-query-errors.yml`、PR時・パス限定）と `verify-morning-digest.js`（`generate-morning-digest.yml`、日次の生成直後）。**PRごとに走るのは1本だけ** |
| 環境変数なしで実行して成功 | 49本（逐次合計 151.8秒） |
| 失敗・タイムアウト | 8本 |

PRごとに自動実行される検証ワークフローは `e2e-smoke-test.yml`（Playwright）・`verify-query-errors.yml`・`verify-cache-config.yml`（`scripts/verification/verify-cache-config.js`、パス限定）の3本。このうち `scripts/maintenance/verify-*.js` を呼ぶのは `verify-query-errors.yml` だけで、残り56本のうち55本は「PRのたびに検証スクリプトを新規に書き、手元で1回実行し、以後誰も実行しない」という運用になっている（例外は `verify-morning-digest.js` で、`generate-morning-digest.yml` が日次で実行している）。

なお `scripts/verification/` にも2本の verify スクリプトがある（`verify-cache-config.js`・`verify-ai-snapshots.js`）。本件のレジストリは `scripts/maintenance/` 配下を対象とし、`scripts/verification/` は対象外とする（`verify-cache-config.js` は専用ワークフローで既にPRゲートとして機能しているため）。

### 失敗8本の内訳（CI未接続の実害）

| スクリプト | 失敗理由 | 分類 |
|---|---|---|
| `verify-migration-numbers.js` | **マイグレーション番号063がmaster上で実際に重複している**（`063_add_cancellation_status_to_today_races_rpc.sql` / `063_race_results_actual_course_kfile.sql`） | **実在バグの検知**。CIに載っていないため誰も気づかなかった |
| `verify-boatcast-job.js` | マイグレーション台帳の適用状況（091が未適用であること）を期待値にハードコードしており、適用が進むと壊れる | 陳腐化 |
| `verify-pit-report-job.js` | 同上（085適用済み・086未適用を期待） | 陳腐化 |
| `verify-data-health-job.js` | 検証自体は「全ての検証に成功」と出力するが、プロセスが終了せず90秒でタイムアウト（ハンドルが解放されていない） | CI適性の欠陥 |
| `verify-format-column-migration.js` | 実Supabase接続が必須 | 環境依存 |
| `verify-morning-digest.js` | 同上 | 環境依存 |
| `verify-rpc-output-keys.js` | 同上（本番RPCの出力キーを検証） | 環境依存 |
| `verify-topic-target-claim.js` | 同上（claim機構の並行実行テスト） | 環境依存 |

「検知のために書かれたスクリプトが、検知すべき問題を検知しないまま放置されている」状態が、少なくとも1件（063重複）実際に発生していた。

なお `verify-scrape-slots-on-db.js` は環境変数なしでも終了コード0で終わるが、`--execute` を付けない限りdry-runの案内を出すだけで何も検証しない。CIに載せても常に成功する無意味なゲートになるため、上記8本に加えて `manual` に分類する（`manual` は計5本）。

---

## 機能要件

| # | 要件 | 優先度 | 受入基準 |
|---|---|---|---|
| F1 | 全 `verify-*.js` を2層（`ci` / `manual`）に分類し、単一のレジストリファイルで宣言する | 必須 | `scripts/maintenance/verify-registry.json` に57本すべてが分類済みで存在する |
| F2 | レジストリ未登録のverifyスクリプトが存在したら検証が失敗する | 必須 | 新規に `verify-foo.js` を置いてレジストリに書かずに実行すると非ゼロ終了し、ファイル名を明示したエラーが出る |
| F3 | レジストリに載っているがファイルが存在しない場合も失敗する | 必須 | 削除済みスクリプトをレジストリに残した状態で非ゼロ終了する |
| F4 | `ci` 層を1コマンドでまとめて実行できる | 必須 | `npm run verify:ci` が `ci` 層を全件実行し、1本でも失敗したら非ゼロ終了する。成功/失敗の一覧と所要時間を出力する |
| F5 | `ci` 層がPRごとにGitHub Actionsで自動実行される | 必須 | master向けPRで新ワークフローが発火し、意図的に壊したスクリプトでPRが赤くなる |
| F6 | 既存の失敗8本を、修正または `manual` 化で決着させる | 必須 | `npm run verify:ci` がmasterでグリーンになる |
| F7 | `manual` 層（実DB必須）は実行対象から外しつつ、実行方法をレジストリに記録する | 必須 | レジストリの各エントリに `reason`（なぜCIに載せないか）と実行コマンドが書かれている |
| F8 | 並列実行でCI時間を短縮する | 推奨 | `ci` 層の総実行時間が 90秒以内（逐次実測151.8秒に対して） |
| F9 | 既存の `verify-query-errors.yml` を新ワークフローに統合し、重複実行をなくす | 推奨 | 旧ワークフローが削除され、同等の検証が新ワークフローで走る |

---

## スコープ

### やること
- `verify-*.js` 57本の2層分類とレジストリ化
- 集約ランナー（`npm run verify:ci`）とGitHub Actionsワークフローの新設
- 失敗8本の決着（修正 / `manual`化）
- マイグレーション番号063重複の解消（後発の `063_add_cancellation_status_to_today_races_rpc.sql` を `102_` にリネームし、`APPLIED.md` に行を追加）。当初は別チケットに切る想定だったが、これを解消しないと `npm run verify:ci` がmasterでグリーンにならず F6 を満たせないため、本件に含める。本番DBには適用済み（2026-09-25にRPC定義を確認）でファイル名変更はDBに影響しない
- `verify-query-errors.yml` の統合

### やらないこと
- **E2Eのモバイル・ダーク軸追加**（施策B。別PRで対応）
- **vitest導入によるユニットテスト整備**（施策C。別PR。ただし本件の `ci` 層は実質ユニットテストとして機能するため、Cの必要範囲は本件完了後に再評価する）
- **`database-design.md` の本文更新**（[BOA-330](https://linear.app/boat-ai/issue/BOA-330)。別チケット）
- `scripts/maintenance/` 以外のスクリプト（`check-*.js` 等）の再編 — ただしレジストリの設計は将来の取り込みを妨げない形にする
- E2E（`e2e-smoke-test.yml`）の統合 — Playwrightのインストールが重く、ジョブを分けたままにする

---

## 非機能要件

| 項目 | 基準 |
|---|---|
| CI実行時間 | `ci` 層の総実行時間 90秒以内（GitHub Actions上の実測） |
| 決定性 | `ci` 層は外部ネットワーク・実DB・実時刻に依存しない。同じコミットに対して常に同じ結果を返す |
| 追加コスト | 新規verifyスクリプトを1本追加するときの追加作業がレジストリへの1エントリ追記のみで済む |
| AI可読性 | レジストリ1ファイルを読めば、どの検証が常設で何を守っているかが一覧できる |

---

## 制約・前提

- **既存ファイルは移動しない**。`scripts/maintenance/verify-*.js` のパスは `package.json` の57個のnpm scripts・各種ドキュメント・設計書から参照されており、ディレクトリ移動は影響範囲が広い。分類はレジストリファイルで宣言する方式を採る（KISS）。
- 既存の `npm run verify:*` 個別スクリプトは残す（手元でのピンポイント実行のため）。
- CIはGitHub Actions。Node 20。`npm ci` でのインストールが前提。
- Supabaseのsecretsは既存ワークフロー（`e2e-smoke-test.yml`）で `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` が設定済み。`manual` 層で必要な `SUPABASE_SERVICE_KEY` 系をCIに持ち込むかは未確定事項U2を参照。
- 用語ルール（`.claude/rules/code-style.md`）に従う。

---

## 未確定事項

| # | 内容 | 状態 |
|---|---|---|
| U1 | 陳腐化2本（`verify-boatcast-job` / `verify-pit-report-job`）の扱い | **決着済み**。マイグレーション台帳の「適用状況」を期待値に固定していた箇所だけを「行の存在」の検証に緩め、他の検証は `ci` に残した |
| U2 | 環境依存5本を夜間ワークフロー（secrets付き）で定期実行するか | **本件では `manual` に分類するのみ**。本番DBへ接続するワークフローを増やす影響が大きいため、夜間実行は別途検討する |
| U3 | `ci` 層をPRの変更パスで絞るか、常に全件実行するか | **全件実行**（KISS）。CI時間が問題になった時点で再検討する |
| U4 | `archived` 層の扱い | **廃止**。57本を精査した結果、現時点で該当するものが1本も無かったため、枠組みを先に作らない（YAGNI） |

## 実装後の実測（2026-09-25）

| 項目 | 値 |
|---|---|
| `tier=ci` | 53本（全件成功） |
| `tier=manual` | 5本 |
| ローカル実行時間 | 257.7秒（並列度4）※計測時のマシンが load average 169 の高負荷状態だったため参考値 |
| **CI実行時間（GitHub Actions、PR #833）** | **30.8秒**（53本、並列度4）。ジョブ全体は1分19秒（`npm ci` 等を含む）。レビュー反映前の52本時点では27.2秒 |
| CI上の最遅3本 | verify-data-health-job 27.7s / verify-gha-skip-gate 9.2s / verify-rls-migration 9.2s |

非機能要件の「90秒以内」は **30.8秒で達成**。ローカルの257.7秒はマシン負荷によるもので、CI上では逐次実測（151.8秒）よりも速い。ランナーのタイムアウト180秒に対して最遅でも27.7秒と余裕がある。

### 受入基準の検証結果

| # | 受入基準 | 結果 |
|---|---|---|
| F1 | 58本すべてが分類済み | OK（ci 53 / manual 5。うち1本は bash スクリプト） |
| F2 | 未登録スクリプトがあると失敗する | OK（`verify-zzz-temp-probe.js` を置いて exit 1 とファイル名の明示を確認） |
| F3 | 台帳にあってファイルが無いと失敗する | OK（存在しないエントリを足して exit 1 を確認） |
| F4 | `npm run verify:ci` が全件実行し失敗で非ゼロ終了 | OK |
| F5 | PRごとにCIで自動実行される | OK（PR #833 で `verify` ジョブがpass） |
| F6 | 失敗8本の決着、masterでグリーン | OK（52本すべて成功） |
| F7 | manual に reason と command | OK（5本すべてに記載、ランナーが欠落を検知する） |
| F8 | 90秒以内 | OK（30.8秒） |
| F9 | 旧ワークフローの統合 | OK（`verify-query-errors.yml` 削除） |
