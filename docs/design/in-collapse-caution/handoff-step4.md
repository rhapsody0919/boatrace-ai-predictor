# 引き継ぎ: BOA-822 /step4 から（2026-10-13）

/step2・/step3・system-architect・design-reviewer・受け入れ E2E まで終えた時点の引き継ぎ。次のセッションは `/step4 in-collapse-caution` で tasks.md の次の未完タスク（PR-1 の task 1）から始める。判断が要る点の報告先は Orchestrate（`/orchestrate` のセッション）。SQL・ADR の番号と運用の仕組みの件だけは hq。

## 作業の場所
- 設計は Draft PR #1440（ブランチ `docs/boa-822-in-collapse-caution`、docs と受け入れ E2E だけ）。実装は master から PR ごとに新しいブランチを切る（tasks.md の PR-1〜PR-8）。#1440 は設計の PR として先にマージしてよいか Orchestrate に聞く
- マイグレーションは 155〜157（hq 割り当て済み。149〜151 は欠番）、ADR は 0095。マージ前に master の最大番号が 157 以上になっていたら hq に知らせて付け替える

## 読む順
1. [tasks.md](./tasks.md): 実装の順と完了の定義
2. [plan.md](./plan.md): §1 値の定義（pct の整数の式、出さないレース、保存の形）、§2 夜のジョブ、§7 切り替えの順、末尾の system-architect・design-reviewer の指摘と対応、ユーザーの決定
3. [spec.md](./spec.md)・[screens.md](./screens.md)（S-1 に承認したモックの文言）・[mock/APPROVED.md](./mock/APPROVED.md)
4. [ADR-0095](../../adr/0095-in-caution-gap-band-nightly-table.md)、マイグレーション案 `docs/db-migration/155〜157`
5. 受け入れ E2E `e2e/acceptance/in-collapse-caution.spec.js`（実装者は書き換えない。誤読だと思ったら止めて報告）

## 決まっていること（覆さない）
- 案Y・案A・3段 35/55・3語・真ん中の段は色なし・思考アシスト (a)・/accuracy に公開前の検証（2026-10-12 ユーザー）
- 理由は勝率差の1行と「ほかの材料は龍神ソナーで」の1行だけ、/races は開催日の一覧として残す、/today の注目レースは新しい値に替える（比較を PR に書き、変わり方が大きければ Orchestrate に返す）（2026-10-13 Orchestrate、段階1）
- 公開の1行 PR（`IN_CAUTION_PUBLIC`）はユーザーの判断。その前に Preview の URL（`?caution=1`）と見るところを Orchestrate に渡す
- 本番 DB は読み取りだけ。書き込み（155〜157 の適用、full の workflow_dispatch）はオーナーに SQL・手順を渡す
- 例のレースの値は 34,842件・pct 65（モックの 35,181件はラウンドで分けない前日までの値）。モックとの差でコードを合わせない
- 帯の端は「−3.5未満」「+3.0以上」

## 確認待ち
- なし。件数100未満の (ラウンド, 帯) は出さない・100〜299件は「件数少なめ（n件）」で確定（2026-10-13 ユーザー、Orchestrate 経由。件数は [analysis/sparse-cells.md](./analysis/sparse-cells.md)）

## 起票済みの別スコープ
- BOA-857（残りのブログ・動画・llms.txt）、BOA-858（SNS 企画の展開予測）、BOA-859（races.volatility_* と race_history_cache の展開予測）
