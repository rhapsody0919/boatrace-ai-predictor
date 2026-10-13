# 引き継ぎ: BOA-822 /step4 の進み具合（2026-10-13）

[handoff-step4.md](./handoff-step4.md)（読む順・覆さないこと）の続き。tasks.md のチェックは、#1440 のマージ後に PR-1・PR-2 の中で付ける。

## 済んだもの

| PR | ブランチ | tasks | 状態 |
|---|---|---|---|
| #1461（PR-1） | `feat/boa-822-pr1-in-caution-nightly` | 1〜5 | CI は `verify-adr-references`（ADR-0095 が #1440 にしかない）だけ赤。#1440 のマージ後に master を取り込めば緑の見込み。/code-review・data-accuracy-verifier 済み（PR コメント） |
| #1462（PR-2、draft） | `feat/boa-822-pr2-in-caution-generate`（base は PR-1 のブランチ） | 7〜12 | /code-review 済み（PR コメント）。PR-1 のマージ後に base を master に向け直す |

## 判断したこと（plan からの変更）

- task 1: JSON の import をやめ、`src/constants/inCautionConfig.js`（JS の正）と `src/data/inCautionConfig.json`（Python 用）の2つにした。一致は `verify-in-caution.js` (a)（ci）。Vercel 関数のバンドルで `import … with { type: "json" }` が動くかを確かめる手段が無いため（plan §1 の代わりの案）
- config に `minCellN: 100`・`lowSampleN: 300` を足した（2026-10-13 ユーザー決定の値を1か所に置く）
- task 4: export は 14日・full とも `--daily`（Storage に書かない）。full は長期3テーブルを足す
- task 10: inCautionFailed のとき後始末は「失敗にせず pending」、5回目だけ失敗にして unified を済みにする（翌起動で done）
- task 12: 問題は実行の失敗にして `failureAlertAfter: 1`。scrape-monitor の運用窓の都合で Slack は JST 07:00 以降（plan §9 の「04:30」と違う）

## Orchestrate に回したこと・回すこと

- PR-1 は #1440 のマージが先（途中報告済み）
- data-accuracy-verifier の指摘: 本体の 2025-12-03〜2026-02-02 は `race_conditions.race_stage` が空で、準優（約400件）・優勝戦（約148件）が other に入る。統計検証 r4 も同じ欠け。race_series から補うかは仕様の判断（yusho の率は 30.65% → 約30.8% の見積もり）

## 次にやること

1. #1440 のマージ後: PR-1 に master を取り込み → CI 緑 → Orchestrate に報告（PR 番号・確認すること）。tasks.md の 1〜5 にチェック
2. PR-1 のマージ後（オーナー）: 155 を SQL Editor で適用 → Actions「In-Caution Nightly」を `full=true`・`force=true` で1回 → `scrape_job_state` の `in_caution_dispatch` を live。確認の SELECT はレーンが読み取りで行う（年ごとの `sum(n)` は PR-1 の本文の表と照合）
3. 表ができたら PR-2 を ready にして master へ向け直す → CI → Orchestrate。マージ後に `in_caution_health` を live、翌朝 task 13（`verify-in-caution-coverage.js --table --today`、例のレースの値の出し直し、data-accuracy-verifier）
4. PR-3（task 14〜16、RPC 157）から先は tasks.md のとおり
