# 全貌動画をデータから描く — 引き継ぎ

計画は [plan.md](./plan.md)。型の正本は hq の `~/hq/drafts/full-picture-scene-contract.md`（読むだけ、変えない）。
ブランチ `feature/full-picture-remotion-scene2`（worktree `.claude/worktrees/pensive-tharp-fdba2f`）。報告先はオーケストレーター（セッション名 Orchestrate）。

## 決まっていること（2026-10-20 オーナー）

- データからコードで描く（実画面の撮影はしない）。狙いは生成の速さ・トークンの少なさ・質・再現性
- 文は描画の前に1度だけ作って JSON に保存し、描画はその JSON から（同じ JSON なら同じ MP4）
- 場面2は1艇4.5秒・約45秒でよい
- 並びは 1 条件 → 2 6艇の重ね図 → 2b 類似レース → 3 軸 → 4 展開（省略禁止）→ 5 相手 → 6 機力と調子 → 8 展示後に見るところ
- 毎日の実行は「材料 JSON 1つ → 全場面をつないだ MP4 と本文」の1本のコマンド。鍵が要るのは材料の取得だけ。毎日の実行は hq の集客部署に渡す
- 実画面と仕様が違うときは画面どおりに描き、報告に書く。数値は src の計算関数を直接使い画面と合わせる
- 材料が無い要素は描かずに記録し、全体を止めない（場面4だけは省略禁止。材料が無ければ報告）
- 全貌（Remotion の型・文型）の型を変える PR は、x-channel と youtube-channel の評価を必須にする。P0 は直してからマージ、P1 は PR 本文に残す。毎日の投稿そのものは審査しない（関門は機械の検査だけ）
- `.claude/CLAUDE.md` の全貌の自動送信の例外（評価役の検査）は、本番の送信に移るときにオーナーの直接承認で変える。今は触らない

## オーナーが決めたこと（2026-10-21 1時台、決定待ち 1〜6 と入口版の言葉）

1. 場面1③「この日の水面傾向」は「このレースより前に確定したレース」で数える（画面は見た時点までの確定レース）。案のまま
2. 場面3②③の選手の730日・180日は、レースの日から数え、このレースより前の走だけ（画面は見た日から）。案のまま
3. 場面3①の答えは「全国・」を省かず2行にする（母数が分からなくなるため）。→ 1行目「全国・級の並びが同じ準優勝戦646件」、
   2行目「1着76.5%、全国の55.2%より21.3ポイント高い」。4レースで毎秒7.9〜8.0字（拍を伸ばして読める長さ）
4. 場面2b・4 の型に文言の無い上帯の問いは、画面の見出し（2b「類似レースの結果は？」、4 STEP2「スタートはどう並ぶ？」・STEP3「攻めは決まった？」）。案のまま
5. 場面3②は走の多い8会場（その日の会場は必ず入れる）に絞る。案のまま
6. 場面4の答えは「〜守った割合」に縮め、STEP2 は「このコースの並びは〜に一致」。案のまま
- 入口版の問いの言葉: 最初は「{会場}{R}R（{日付}）1号艇は堅い？」、結論は「同じ並びの過去は、どう決まった？」。案のまま
- 入口版の結論の1拍: 同じ並びの過去レースで1着が多かった艇と割合を出し、「過去N件」と書く。案のまま

## オーナーが決めたこと（2026-10-20 13:4x、決定待ち 7・8 の答え）

7. 尺: 完全版（約3分）は削らずに YouTube の通常の動画として出す。X・Shorts は59秒以内の入口を1本。中身は固定の型
   （条件＋6艇の重ね図＋最後に「どう決まったか」の結論1拍）。場面をレースごとに選び分けるかは公開後の数字で決める。
   visual-designer の3分割案（各60秒超）は採らない（1分超は申し立てでブロック。`docs/knowledge/video-composition.md`）
   → 実装: `scripts/full-picture/entry.mjs`。条件は場面1の「会場の1着率（過去90日）」と今日の条件1つ（風、無ければこの日の水面傾向）、
   重ね図は6艇全体と1艇ずつ（カードの頁へは送らない）、結論は場面4「結果はどう決まった？」の着順の流れ（このコースの形のとき、
   1着最多の艇と割合）。59秒を越えたら条件の2つ目を外し、それでも越えたら止める（4レースとも約49秒）
8. 文: 整えた版（LLM が文を整える）はやめる。比べる文は文型で固定し、LLM には文と文をつなぐ語だけを任せる（wording-editor の推奨）
   → 実装: `connectedText`（scene2-text.mjs）。LLM は決まったつなぐ語（一方・さらに 等）を選ぶだけ。文型の文は変えず、
   検査に落ちた拍はつなぐ語なし。入口版は文型の版（つなぐ語は完全版の拍の並びに合わせたものなので使わない）

## 作り（sns-video-studio/remotion）

| 段 | ファイル | 役目 |
|---|---|---|
| 材料の取得（鍵あり） | `scripts/full-picture/fetch-materials.mjs` | 公開 API（facts・similar・scenario の既定/NC/NCR/NA/VA・predictions・24会場の outcome-distribution）と Supabase の匿名読み取り（1号艇の選手の730日の走、モーターの前検・会場の成績・今節の展示）を1つの JSON に。取れない材料は `missing` |
| 場面の build | `scripts/full-picture/scene2-data.mjs`（場面2）、`scripts/full-picture/scenes/scene{1,2b,3,4,5,6,8}.mjs` | 材料 → 描く値＋拍ごとの `facts`（コードが計算した比較）＋文型の版 `lines`。省いた要素は `omitted`（場面4の材料が無いときは `mustReport`） |
| 文 | `scripts/full-picture/scene2-text.mjs`・`fit.mjs` | 文型の版・つないだ版（LLM はつなぐ語を選ぶだけ、全場面で1回）・検査（facts に無い数値・艇番・材料名・順位、risk-rules.json の禁止表現、ぼかし語、幅全角22字分、facts に無い言い回し、つなぐ語、差1ポイント未満の向き）。1行に入らない文型は `fitFirst` で決まった別の言い方に |
| 材料の契約 | `scripts/full-picture/materials.schema.json`・`materials-contract.mjs`・`fixtures/`・`make-fixture.mjs` | 版つきの JSON Schema（`full-picture-materials/1`、fetch-materials.mjs の MATERIALS_VERSION と同じ）。run-full は描く前に検査し、合わなければ止める。固定の材料は4レースの最小の写し（build が読んだ所だけ、gzip） |
| 入口版 | `scripts/full-picture/entry.mjs` | 完全版の場面から入口版（59秒以内）の並びを作る |
| 描画 | `src/fullPicture/Scene2Compare.jsx`（場面2）、`StepScene.jsx`＋`pages.jsx`（段で進む場面）、`parts.jsx`/`parts.js`（枠・指・吹き出し・札・問い・注記）、`FullPicture.jsx`（全場面を1本に） | 決まった手順で描くだけ |
| 配置（純粋） | `scene2Layout.js`・`pageLayout.js`・`sonarLayout.js` | 枠・札・項目名の箱。検査と描画が同じ値を使う |
| 拍の並び | `scene2Timeline.js`・`stepTimeline.js`・`fullPictureTimeline.js` | 頁を送る → 押す → 変わる → 0.5秒 → 枠（順に移す／同時）→ 答え。答えは次の段で頁を送るまで残す。拍の長さは決まった長さを下限に、答えを毎秒8字で読める長さまで伸ばす（文の JSON を渡す） |
| 1本のコマンド | `scripts/full-picture/run-full.mjs` | 材料 JSON → `scenes.json`・`text-{版}.json`・`{版}/full-picture.mp4`（完全版）・`entry/entry.mp4`（入口版）・各 `stills/`・`post.txt`・`run-*.json`（時間・LLM の回数）。`--text template\|connected\|both`（既定 connected）、`--no-video` で文だけ |
| 検査 | `scripts/maintenance/verify-full-picture-scene2.js`（ci） | 文・検査・配置・拍の並び・材料の契約・固定の材料4レースでの全場面の文と読む時間・入口版の尺の再現テスト |

確認用の合成: `FullPictureScene2`、`FullPictureStep`（段の場面を1つ）、`FullPicture`（全場面。入口版も同じ合成に入口版の場面の並びを渡す）。
固定の材料を作り直す: `node scripts/full-picture/make-fixture.mjs out/full-picture/materials/<raceId>.json scripts/full-picture/fixtures/<raceId>.json.gz`
試すレース（10/19 下関10R・10/12 桐生12R・10/16 大村11R・10/15 丸亀10R）の材料と出力: `out/full-picture/`（gitignore）。

```bash
cd sns-video-studio/remotion
PATH=~/.nvm/versions/node/v22.20.0/bin:$PATH node --env-file=../../.env.local scripts/full-picture/fetch-materials.mjs <raceId> out/full-picture/materials/<raceId>.json --from-case ~/full-picture/cases/<raceId>
PATH=~/.nvm/versions/node/v22.20.0/bin:$PATH node scripts/full-picture/run-full.mjs out/full-picture/materials/<raceId>.json out/full-picture/<raceId> --bgm ~/full-picture/in/2026-10-12/bgm-candidates/alexgrohl-energetic-action-sport-500409.mp3
```

## 進み具合

| 段 | 状態 |
|---|---|
| 場面1・2・2b・3・4・5・6・8 | 出来た。全場面のレビュー（visual-designer・wording-editor）の P0・P1 は直した |
| 完全版・入口版・1本のコマンド | 出来た。4レースで完全版 210〜228秒（描画 397〜541秒）、入口版 48.5〜49.8秒（描画 68〜91秒）。比較表は `out/full-picture/compare.md` |
| 材料の契約 | 出来た（`materials.schema.json`・固定の材料4レース・CI） |
| 型を変える PR の評価 | x-channel・youtube-channel とも P0 0。入口版の共通の P1（最初の画面にレース名、結論は「過去」、本文は動画の数字だけ）は直した。残りは BOA-912・BOA-913 |

## 次にやること

1. PR のマージ（オーケストレーター経由でオーナー）
2. BOA-912（YouTube の出し方の型: タイトル・説明文・免責・章・Shorts→完全版の導線・公開順・BGM）
3. BOA-913（s3 の回収率の出し方、つなぐ語の単調さ）
4. 毎日の実行を hq の集客部署に渡す（材料はレースの前に取る）

## レビュー（全場面、2026-10-20）と対応

対象は 10/19 の文型の版の MP4（191秒）と4レースの文の比較表。

### visual-designer（P0 1・P1 5・P2 7・P3 4）

- P0 尺 → オーナー決定（上の 7）で解いた: 完全版は削らず YouTube、入口版は59秒以内
- P1 答えを読む時間 → 拍の長さを答えの字数（毎秒8字）で伸ばす。場面5の重点でない艇は答えを出さず最後に1枚（`s5-axis-rest`）
- P1 s4-slit の札の先出し → 形の札は枠と同時に選ぶ（`slitFormOn`）
- P1 場面2のカード → x40〜960（`CARD`）
- P1 s8 の CTA → y1388 まで（`summaryLayout`）。「スクショで保存」は1つ目の見出しの右
- P1 s3-rough → 棒を欄の幅いっぱい、値は棒の上、全国の値は棒の下（`statsBarRow`）
- P2・P3 は未対応（頁の高さ、語の途中の改行、吹き出しの尖り 等）

### wording-editor（P0 0・P1 2・P2 1・P3 2）

- P1 2件・P2 → 整えた版をやめた（上の 8）ので起きない。差1ポイント未満の向きは検査にも足した
- P3 は未対応

## 気をつけること

- 試作の材料はレースの後に取ったので、展示前のはずの 10/19 にも場面1④（風）が出る。毎日の実行ではレースの前に取る
- worktree の `node_modules` は worktree 内で `npm ci` する（メインの作業ツリーにリンクしない。リンク越しの `npm ci` がメインの中身を消した）
- この worktree の既定の node は v16。`PATH=~/.nvm/versions/node/v22.20.0/bin:$PATH` で v22 を使う
- 文の幅は全角22字分（半角0.55）。答えは1〜2行、数値は比べて書く。「この選手」と書かない。平均ST は「平均ST（直近30走）」
