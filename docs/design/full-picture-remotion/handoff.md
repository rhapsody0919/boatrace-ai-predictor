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
- 全貌（Remotion の型・文型）の型を変える PR は、x-channel と youtube-channel の評価を必須にする。P0 は直してからマージ、P1 は PR 本文に残す。毎日の投稿そのものは審査しない（関門は機械の検査だけ）
- `.claude/CLAUDE.md` の全貌の自動送信の例外（評価役の検査）は、本番の送信に移るときにオーナーの直接承認で変える。今は触らない

## オーナーの決定待ち（オーケストレーターが出す）

1. 場面1③「この日の水面傾向」は「このレースより前に確定したレース」で数えている（画面は見た時点までの確定レース）
2. 場面3②③の選手の730日・180日を、レースの日から数え、このレースより前の走だけにしている（画面は見た日から）
3. 場面3①の答えで「全国・」を省いている（「級の並びが同じ準優勝戦646件で1着76.5%」）。母集団が分からなくなるので、省かず2行にするか語を短くするのを推奨
4. 場面2b・4 の型に文言の無い上帯の問いを決めた（2b「類似レースの結果は？」、4 の STEP2「スタートはどう並ぶ？」・STEP3「攻めは決まった？」＝画面の見出し）
5. 場面3②は会場が多いと頁に収まらないので、走の多い8会場（その日の会場は必ず入れる）に絞った
6. 場面4の答え「前付けがあっても1号艇がインを守ったレースの割合」は1行に入らないので「〜守った割合」に。STEP2 の答えは「平均ST」を期間なしで書かないため「このコースの並びは〜に一致」
7. 全体の尺は約3分11秒（場面1 19秒・2 43秒・2b 18秒・3 15秒・4 36秒・5 23秒・6 32秒・8 5秒）。59秒の予算をどう配るか
8. 整えた版（LLM）は、検査を厳しくした結果、ほとんどの拍で文型の版と同じ文を返す（10/19 は42拍すべて同じ、10/15 は44拍中4拍だけ言い換え）。LLM を使う意味があるか

## 作り（sns-video-studio/remotion）

| 段 | ファイル | 役目 |
|---|---|---|
| 材料の取得（鍵あり） | `scripts/full-picture/fetch-materials.mjs` | 公開 API（facts・similar・scenario の既定/NC/NCR/NA/VA・predictions・24会場の outcome-distribution）と Supabase の匿名読み取り（1号艇の選手の730日の走、モーターの前検・会場の成績・今節の展示）を1つの JSON に。取れない材料は `missing` |
| 場面の build | `scripts/full-picture/scene2-data.mjs`（場面2）、`scripts/full-picture/scenes/scene{1,2b,3,4,5,6,8}.mjs` | 材料 → 描く値＋拍ごとの `facts`（コードが計算した比較）＋文型の版 `lines`。省いた要素は `omitted`（場面4の材料が無いときは `mustReport`） |
| 文 | `scripts/full-picture/scene2-text.mjs` | 文型の版・整えた版（全場面で LLM 1回）・検査（facts に無い数値・艇番・材料名・順位、risk-rules.json の禁止表現、ぼかし語、幅全角22字分、facts に無い言い回し＝VOCAB で区切れない残り、つなぐ語）。場面ごとの語は VOCAB に足す |
| 描画 | `src/fullPicture/Scene2Compare.jsx`（場面2）、`StepScene.jsx`＋`pages.jsx`（段で進む場面）、`parts.jsx`/`parts.js`（枠・指・吹き出し・札・問い・注記）、`FullPicture.jsx`（全場面を1本に） | 決まった手順で描くだけ |
| 配置（純粋） | `scene2Layout.js`・`pageLayout.js`・`sonarLayout.js` | 枠・札・項目名の箱。検査と描画が同じ値を使う |
| 拍の並び | `scene2Timeline.js`・`stepTimeline.js`・`fullPictureTimeline.js` | 頁を送る → 押す → 変わる → 0.5秒 → 枠（順に移す／同時）→ 答え。答えは次の段で頁を送るまで残す |
| 1本のコマンド | `scripts/full-picture/run-full.mjs` | 材料 JSON → `scenes.json`・`text-{版}.json`・`{版}/full-picture.mp4`・`{版}/stills/`・`post-{版}.txt`・`run-{版}.json`（時間・LLM の回数）。`--no-video` で文だけ |
| 検査 | `scripts/maintenance/verify-full-picture-scene2.js`（ci） | 文・検査・配置（場面2と段の場面）・拍の並びの再現テスト |

確認用の合成: `FullPictureScene2`、`FullPictureStep`（段の場面を1つ）、`FullPicture`（全場面）。
試すレース（10/19 下関10R・10/12 桐生12R・10/16 大村11R・10/15 丸亀10R）の材料と出力: `out/full-picture/`（gitignore）。

```bash
cd sns-video-studio/remotion
PATH=~/.nvm/versions/node/v22.20.0/bin:$PATH node --env-file=../../.env.local scripts/full-picture/fetch-materials.mjs <raceId> out/full-picture/materials/<raceId>.json --from-case ~/full-picture/cases/<raceId>
PATH=~/.nvm/versions/node/v22.20.0/bin:$PATH node scripts/full-picture/run-full.mjs out/full-picture/materials/<raceId>.json out/full-picture/<raceId> --text both --bgm ~/full-picture/in/2026-10-12/bgm-candidates/alexgrohl-energetic-action-sport-500409.mp3
```

## 進み具合

| 段 | 状態 |
|---|---|
| 場面1・2・2b・3・4・5・6・8 | 出来た（場面2はレビュー直し済み） |
| 全場面のつなぎ・1本のコマンド | 出来た（10/19 の文型の版で 191秒の MP4、描画526秒＋静止画） |
| 全場面のレビュー | visual-designer・wording-editor を当てた（結果は下の「レビュー」）。P0・P1 を直すのが次 |
| 4レース×2版の書き出し | 文（両版）は4レースとも作成済み。MP4 はレビューを直してから |
| 材料の契約（JSON Schema・版） | 未。plan.md の「材料 JSON の契約」 |
| PR | 未。完了条件は CI 全緑・CLEAN・/code-review の PR コメント。型を変える PR なので x-channel・youtube-channel の評価も |

## 次にやること

1. 下の「レビュー」の P0・P1 を直す（直したものは verify-full-picture-scene2.js の再現テストで固定）
2. 4レース×2版を書き出す（1本で約9分。`--concurrency` は既定でコア数−1）。報告: MP4・拍ごとの静止画・比較表（`out/full-picture/compare.md`）・1本の書き出し時間・LLM の回数とトークンの目安
3. 材料の契約（JSON Schema・版つき、形が変わったら CI で落とす）
4. PR（x-channel・youtube-channel の評価、/code-review）

## レビュー（全場面、2026-10-20）

対象は 10/19 の文型の版の MP4（191秒）と4レースの文の比較表。直すときは実在を確かめ、再現テストで固定する。

### visual-designer（P0 1・P1 5・P2 7・P3 4）

- **P0 尺 191秒は投稿先の上限を超える**（Premium なしの X は140秒、Shorts は180秒）。型どおりでは59秒は無理。案A（推奨）: 3本に分ける ①条件＋重ね図 62秒 ②類似＋軸＋展開 69秒 ③相手＋機力＋展示後 60秒。案B: 1本で140秒以内に削る（場面6の深掘りを▲の艇だけ、場面2を重点2艇＋残り2秒、場面4の「全体」を形の一致まで）。オーナーの判断（オーケストレーター経由）。尺の合計は `fullPictureTimeline().total` で検査に入れる
- P1 答えを読む時間が足りない（毎秒8字以内の目安に対し、押す拍3.1秒・押さない拍3.7秒で30〜44字）。答えの2行の合計を押す拍24字・押さない拍29字以内に。s5-axis-3〜6 は拍2.2秒で答え0.8秒（毎秒25字）→ 1艇ずつ答えを出さず枠だけ移し、最後に1枚「3〜6号艇が勝っても2着は1号艇」を2秒以上
- P1 s4-slit: 「横一線」の札が押す前から選ばれている（答えの先出し）。札は同じ見た目で出し、数字が出てから0.5秒で枠→答え
- P1 場面2のカードが x40〜1040 で Shorts の右ボタン列にかかる（6位の枠 x848〜998・y900〜1125）。x40〜960 にそろえる
- P1 s8: 下の段・CTA・「スクショで保存」が Shorts の下の帯（y1450〜）に隠れる。行を詰めて CTA まで y1420 以内
- P1 s3-rough: 頁が空き、「全国 55.2%」が棒に重なる。棒を大きく、数値は棒の外
- P2 吹き出しの尖りを枠の中心に／s2b-flow-1 の小見出しが押す前に変わる／s2b-sonar の札がカードの縁をまたぎ、点が外周の外に積もる／s6-exhibit の2つの枠が接して二重線、囲う所はマス（前走・平均）にする／s6-deep の語の途中の改行（「全／体」）／頁の高さを中身に合わせる（空き最大580px）／series_score は今日の1位の棒だけを囲う
- P3 問いが2行のとき上の帯の線がずれる／スリット図は丸めた値で描く（同じ0.13が別の位置）／場面の切り替えをそろえ、最後のフェードは音だけ／指がボタンの文字を隠す

### wording-editor（P0 0・P1 2・P2 1・P3 2）

- P1 整えた版が「差1ポイント未満は向きを言わない」（common.mjs の diffText）を破った（10/15 丸亀10R の s1-venue90・s1-day・s1-wind「0.2ポイント高い」等）。数値は facts にあるので今の検査では止まらない → 検査に足す（facts の diffPt < 1 の拍で「高い・低い」を使ったら落とす）
- P1 整えた版が範囲の語「90日の」を落とした（10/15 s1-day）→ 文型にある範囲の語（90日・この風・風を問わず 等）を省いたら落とす検査、またはプロンプトに明記
- P2 s4-entry の整えた版で「1号艇が」が落ちた
- P3 scene2b.mjs の小見出しで「似ている」を書いてから置き換えている → 最終の文字を直接書く／scene6.mjs の問い「機力と調子は？」は型に文言が無い（報告に書く）
- 確認済み: 場面8のまとめカードの文言・場面1〜5の問いは型と一致。場面3③は回収率として扱っている。本文の1着率に件数
- 整えた版を使う意味: 4レース178拍で文型と違ったのは4拍（10/15 だけ）で、4拍とも劣化。比較文は文型に固定し、LLM はつなぐ語だけを足す狭い役割にするのを勧める（オーナーの決定待ち 8 と合わせて判断）

## 気をつけること

- 試作の材料はレースの後に取ったので、展示前のはずの 10/19 にも場面1④（風）が出る。毎日の実行ではレースの前に取る
- worktree の `node_modules` は worktree 内で `npm ci` する（メインの作業ツリーにリンクしない。リンク越しの `npm ci` がメインの中身を消した）
- この worktree の既定の node は v16。`PATH=~/.nvm/versions/node/v22.20.0/bin:$PATH` で v22 を使う
- 文の幅は全角22字分（半角0.55）。答えは1〜2行、数値は比べて書く。「この選手」と書かない。平均ST は「平均ST（直近30走）」
