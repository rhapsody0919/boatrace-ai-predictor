# 引き継ぎ: BOA-822 /step4 の進み具合（2026-10-13）

[handoff-step4.md](./handoff-step4.md)（読む順・覆さないこと）の続き。tasks.md のチェックは、#1440 のマージ後に PR-1・PR-2 の中で付ける。

## 済んだもの

| PR | ブランチ | tasks | 状態 |
|---|---|---|---|
| #1461（PR-1） | `feat/boa-822-pr1-in-caution-nightly` | 1〜5 | 2026-10-13 マージ済み |
| #1462（PR-2、draft） | `feat/boa-822-pr2-in-caution-generate`（base は master） | 7〜12 | /code-review 済み（PR コメント）。表ができてから ready にする |

## 判断したこと（plan からの変更）

- task 1: JSON の import をやめ、`src/constants/inCautionConfig.js`（JS の正）と `src/data/inCautionConfig.json`（Python 用）の2つにした。一致は `verify-in-caution.js` (a)（ci）。Vercel 関数のバンドルで `import … with { type: "json" }` が動くかを確かめる手段が無いため（plan §1 の代わりの案）
- config に `minCellN: 100`・`lowSampleN: 300` を足した（2026-10-13 ユーザー決定の値を1か所に置く）
- task 4: export は 14日・full とも `--daily`（Storage に書かない）。full は長期3テーブルを足す
- task 10: inCautionFailed のとき後始末は「失敗にせず pending」、5回目だけ失敗にして unified を済みにする（翌起動で done）
- task 12: 問題は実行の失敗にして `failureAlertAfter: 1`。scrape-monitor の運用窓の都合で Slack は JST 07:00 以降（plan §9 の「04:30」と違う）

## Orchestrate に回したこと・回すこと

- PR-1 は #1440 のマージが先（途中報告済み）
- data-accuracy-verifier の指摘（2025-12-03〜2026-02-02 の race_stage が空）は、検証に使った 10/1 時点の CSV が古かっただけだった。本番では K/B 補完（backfill-phase1-kb-2026-10.md 項目5）で 9,962レース全部が埋まっており、準優 4.02%・優勝戦 1.54%（2026-02-03〜09 は 4.15%・1.52%）。155 の表は本番から作るので対応は要らない（2026-10-13 読み取りで確認）

## 次にやること

1. オーナー: [owner-prod-steps-pr1.sql](./owner-prod-steps-pr1.sql) の手順1〜3（155 の適用 → Actions「In-Caution Nightly」を full・force で1回 → in_caution_dispatch を live）。確認の SELECT はレーンが読み取りで行う（年ごとの `sum(n)` は #1461 の本文の表と照合。2026 の分は本番の値が正）
2. 表ができたら PR-2 を ready にして master へ向け直す → CI → Orchestrate。マージ後に `in_caution_health` を live、翌朝 task 13（`verify-in-caution-coverage.js --table --today`、例のレースの値の出し直し、data-accuracy-verifier）
3. PR-3（task 14〜16、RPC 157）から先は tasks.md のとおり
