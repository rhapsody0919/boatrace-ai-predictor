# 全貌動画をデータから描く — 引き継ぎ

計画は [plan.md](./plan.md)。型の正本は hq の `~/hq/drafts/full-picture-scene-contract.md`（読むだけ、変えない）。
ブランチ `feature/full-picture-remotion-scene2`（worktree `.claude/worktrees/pensive-tharp-fdba2f`）。報告先はオーケストレーター（セッション名 Orchestrate）。

## 決まっていること（2026-10-20 オーナー）

- データからコードで描く（実画面の撮影はしない）。狙いは生成の速さ・トークンの少なさ・質・再現性
- 文は LLM で整えた版を使い、機械の検査に1つでも落ちた拍は文型の版に戻す（全体は止めない）。文は描画の前に1度だけ作って JSON に保存し、描画はその JSON から（同じ JSON なら同じ MP4）
- 場面2は1艇4.5秒・約45秒でよい
- 並びは 1 条件 → 2 6艇の重ね図 → 2b 類似レース → 3 軸 → 4 展開（省略禁止）→ 5 相手 → 6 機力と調子 → 8 展示後に見るところ
- 毎日の実行は「材料 JSON 1つ → 全場面をつないだ MP4 と本文」の1本のコマンド。鍵が要るのは材料の取得だけ。毎日の実行は hq の集客部署に渡す
- 実画面と仕様が違うときは画面どおりに描き、報告に書く。数値は src の計算関数を直接使い画面と合わせる
- 材料が無い要素は描かずに記録し、全体を止めない（場面4だけは省略禁止。材料が無ければ報告）
- `.claude/CLAUDE.md` の全貌の自動送信の例外（評価役の検査）は、本番の送信に移るときにオーナーの直接承認で変える。今は触らない

## 作り（sns-video-studio/remotion）

| 段 | ファイル | 役目 |
|---|---|---|
| 材料の取得 | `scripts/full-picture/fetch-materials.mjs` | 公開 API（facts・similar・scenario の既定/NC/NCR/NA/VA・predictions・24会場の outcome-distribution）と Supabase の匿名読み取り（1号艇の選手の730日の走）を1つの JSON に。取れない材料は `missing` |
| 場面の build | `scripts/full-picture/scene2-data.mjs`（場面2）、`scripts/full-picture/scenes/scene{1,2b,3}.mjs` | 材料 → 描く値＋拍ごとの `facts`（コードが計算した比較）＋文型の版 `lines`。省いた要素は `omitted` |
| 文 | `scripts/full-picture/scene2-text.mjs` | 文型の版・整えた版（LLM 1回）・検査（facts に無い数値・艇番・材料名・順位、risk-rules.json の禁止表現、ぼかし語、幅全角22字分、facts に無い言い回し＝VOCAB で区切れない残り、つなぐ語）。場面ごとの語は VOCAB に足す |
| 描画 | `src/fullPicture/Scene2Compare.jsx`（場面2）、`StepScene.jsx`＋`pages.jsx`（段で進む場面）、`parts.jsx`/`parts.js`（枠・指・吹き出し・札・問い・注記） | 決まった手順で描くだけ |
| 配置（純粋） | `scene2Layout.js`・`pageLayout.js`・`sonarLayout.js` | 枠・札・項目名の箱。検査と描画が同じ値を使う |
| 拍の並び | `scene2Timeline.js`（場面2）・`stepTimeline.js`（段の場面） | 頁を送る → 押す → 変わる → 0.5秒 → 枠（順に移す）→ 答え。答えは次の段で頁を送るまで残す |
| 1本のコマンド | `scripts/full-picture/run.mjs`（今は場面2だけ） | 材料 → 文の JSON → MP4・静止画・本文。全場面に広げるのが残り |
| 検査 | `scripts/maintenance/verify-full-picture-scene2.js`（ci） | 文・検査・配置・拍の並びの再現テスト |

確認用の合成: `FullPictureScene2`（props＝場面2の材料＋answers）、`FullPictureStep`（props＝{scene, answers}、段の場面を1つ）。
試すレースの材料: `out/full-picture/materials/{raceId}.json`（gitignore）。作り直し:
`node --env-file=../../.env.local scripts/full-picture/fetch-materials.mjs <raceId> out/full-picture/materials/<raceId>.json --from-case ~/full-picture/cases/<raceId>`

## 進み具合

| 場面 | 状態 | 備考 |
|---|---|---|
| 2 6艇の重ね図 | 済み（レビュー P0・P1 直し済み） | 4レース×2版の MP4 は `out/full-picture-scene2/` |
| 1 条件 | 済み（レビュー前） | ③は「このレースより前に確定したレース」、④は展示後だけ |
| 2b 類似レース | 済み（レビュー前） | 上帯の問いは型に無いので「類似レースの結果は？」 |
| 3 軸 | 済み（レビュー前） | ②は走の多い8会場まで、10/16 大村は②を省く |
| 4 展開（省略禁止） | 未 | scenario の cells（進入の型 e＝mae 等）・course_st（スリット）・exh_agreement・attack。STEP1〜4 を既定（VC）で→「全体」で繰り返し。2b の sonarSteps（サンキー・3連単）を再利用 |
| 5 相手 | 未 | 上段 facts の usual.top2（assistSummary の b1Usual）、下段 winFollowers(VA, 軸)。軸ボタン1→6 |
| 6 機力と調子 | 未 | モーター表・今節展示は Supabase（race_entries・venue_motor_stats・motor_pretest_stats・exhibition_data・race_original_exhibition_values）。深掘りは facts の factChips・featChips |
| 8 展示後に見るところ | 未 | まとめカードだけ。文言は型で固定。橙の艇番は場面4〜6の鍵の艇 |
| つなぎ | 未 | 全場面を1本の MP4 に（Series）、run.mjs を全場面に、文は全場面で LLM 1回、本文 |
| レビュー | 未 | 全場面が出来たら visual-designer・wording-editor、P0・P1 を直す |

## 気をつけること

- worktree の `node_modules` は worktree 内で `npm ci` する（メインの作業ツリーにリンクしない。リンク越しの `npm ci` がメインの中身を消した）
- この worktree の既定の node は v16。`PATH=~/.nvm/versions/node/v22.20.0/bin:$PATH` で v22 を使う
- 文の幅は全角22字分（半角0.55）。答えは1〜2行、数値は比べて書く。「この選手」と書かない。平均ST は「平均ST（直近30走）」
- 書き出しは1レース1版で2〜4分（静止画＋MP4）。並行の作業があると遅くなる
