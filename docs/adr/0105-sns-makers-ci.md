# ADR 0105: SNS の作り手（Remotion の束と描画）を PR ごとに CI で通しで試す

## ステータス

採用（2026-11-05、オーナー承認。system-architect の審査 2026-11-05 の指摘 P1×4・P2×4・P3×5 を反映。必須のチェックへの切り替えは段階2）

## 背景

2026-11-04 21:28〜22:50、本番の作り手（hq が毎日回す SNS 動画の生成）が全部落ちた。

1. #2236 で `sns-video-studio/remotion/src/upsetWin/model.js` → `src/utils/raceSeriesText.js` → `raceDetailHeading.js` → `src/config/languages.js` → `src/data/blogPostsEn.js`（`import.meta.glob`）が繋がり、Remotion（webpack）の束が Getting composition で `{}.glob is not a function` になった。Root は全部の composition を1つの束にするので、節の機力・人気薄の1着・全貌 f01 が全部落ちた（#2251 で直した）
2. hq の studio の `node_modules` が x64 で入り、`@rollup/rollup-darwin-arm64` が無かった（hq の環境）
3. hq の studio が root の `npm ci` をしておらず、`twitter-text` が無かった（hq の環境）

1 は龍神のコードの壊れで、PR の CI で止められた。CI は remotion の依存を入れておらず、束を作る検査（`verify-remotion-compositions.js`）は manual だった。静的な検査（`verify-remotion-src-imports.js`、ci）は #2251 で足したが、相対 import の文字列だけを辿るので、パッケージの側の壊れ・描画時の例外（props の形の食い違い等）は拾えない。

送る口（`scripts/sns/push-*.js`）の受け取りの検査は、`verify-sns-*.js`・`verify-upset-win.js`・`verify-setsu-kiryoku.js`（ci、PGlite のモックの store）で既に PR ごとに回っている。抜けているのは「Remotion の束を作り、作り手が作る props で実際に描く」所。

## 決定

### 1. 新しい workflow `sns-makers.yml`（`ubuntu-24.04` 固定）

外部（本番 DB・YouTube・X・VOICEVOX・LLM）に一切つながない。取りに行くのは npm と Remotion の Chromium だけ。job は3つ（e2e の ADR-0100 と同じ形）。

| job | 中身 |
|---|---|
| `sns-makers-scope` | 差分から `run=true/false`（下の3） |
| `sns-makers-run` | `run=true` のときだけ。root と remotion の `npm ci`（hq と同じ入れ方）→ Remotion の Chromium（`npx remotion browser ensure`、`node_modules/.remotion` を remotion の lock の hash で cache）→ OS の部品（`npx playwright install-deps chromium`）→ `verify-remotion-compositions.js`（CLI。hq の daily と同じ入口と remotion.config.js）→ `verify-sns-makers.js`（描いた PNG は artifact `sns-makers-stills`、7日） |
| `sns-makers`（集約） | `always()`。判定が失敗なら失敗、`run=false` なら成功（skip にしない）、`run=true` なら `sns-makers-run` の成否 |

Chromium は Remotion が試した版（4.0.512 は chrome-headless-shell 149.0.7790.0）を、hq の mac と同じ取り方で取る。Playwright 1.64.1 の headless shell（156）を使うと、CI と hq で版がずれる（審査 P2-6）。Playwright は OS の部品を入れるのにだけ使う。

master への push でも同じ判定で走らせる（並行する2つの PR が別々に緑になった後の組み合わせの壊れを検知する。quality-gates.yml と同じ理由）。ryujin-bot の自動コミットでは動かさない（ADR-0097、`verify-bot-push-workflows.js`）。master での失敗は `job-watch`（`scripts/watch/job-watch.json` の watched・watchedExtra）が知らせる。rerun はしない。

### 2. `verify-sns-makers.js` が流す範囲

束は1回だけ作り（`@remotion/bundler`）、ブラウザも1つを使い回す（`@remotion/renderer` の `openBrowser`）。2つは `sns-video-studio/remotion/package.json` に `4.0.512` で直接書き、remotion の `node_modules` から `createRequire` で読む（root に `@remotion/*` は無い）。束を作る前に、一時の public（remotion の public の写し＋仮の声の wav と仮の撮った画面の PNG）を作り、それを束に入れる（本番は f01 と人気薄の1着で `--public-dir` を替えて描く）。描くのは1コマの still だけ（mp4 は作らない）。

| 型 | 材料 | 作り手の通る所 | 描く composition とコマ |
|---|---|---|---|
| 人気薄の1着（upset_win_short） | `src/upsetWin/samples/2026-11-03-17-10.json`（本番の束） | model.js の `checkBundle`・送る口の `checkUpsetBundle` | `UpsetWinShort` の `stillsOf` の3コマ（声の `<Audio>` は仮の wav） |
| 節の機力 Shorts（4型） | `src/setsuKiryoku/samples/{border,final_gap,motor_gap,motor_up}.json` | 送る口の `checkShortBundle`（中で型の `checkBundle`） | `SetsuKiryokuShort` の中ほどの1コマ |
| 全貌（今の型の完全版・入口版） | `scripts/full-picture/fixtures/2026-10-19-19-10.json.gz` | `run-full.mjs --text template --no-video`（材料の契約・場面・文・入口版・本文の検査は本物。`--no-video` は props を書くようにした） | `FullPicture` の完全版と入口版、それぞれ先頭・中ほど・最後 |
| 全貌 f01（横 16:9＋声） | 同じ写しに名前と級・日目を埋めた材料（`verify-full-picture-scene2.js` の `f01Fixture` と同じ埋め方） | `f01Script`・`f01RacerCheck`・`f01TitleThumbCheck`・`f01Timeline`（声は1行2秒の仮の行、撮った画面は `PLAN` の名前ごとに仮の PNG） | `F01Landscape` の各章の中ほど（章の本体の `<Img>`・右の列・カーソルを含む）・`F01Thumb` |

外すもの（理由）:

- 声（VOICEVOX）・f01 の実画面の撮影（vite＋Playwright）・mp4 の書き出し・ffmpeg: 外部のエンジンか数分単位の時間が要る。束と描画の壊れ方（今回の1）は still で拾える
- 作り手が書く束のフォルダ（mp4 のファイル名・大きさ・尺）と送る口の受け取りの契約: mp4 を作らないので拾わない。送る口の側の検査は既存の verify が持つ
- /today・数字で見たら・優勝戦と /today の思考・X の節の機力の画像: 画像は hq が作り、龍神に作り手が無い。龍神の側は送る口だけで、既存の `verify-sns-*.js`（ci）が PGlite のモックの store で通している
- 送る口の `--dry-run` の実行: `--dry-run` も本番 DB を REST で読む（日の上限・中止の読み直し）。モックの store で通す検査は既存の verify が持つので、ここでは送る口の純粋な受け取りの検査を見本に当てるだけにする
- `remotion.config.js` は CLI だけが読み、`@remotion/bundler` の API には効かない。今は `webpackOverride` が無いので差は出ない。足すときは `verify-sns-makers.js` の `bundle()` にも同じものを渡す

### 3. どの差分で走らせるか

`scripts/maintenance/sns-makers-scope.js` が差分のパスから決める。`run=true` になるのは次のどれかに当たるとき:

- `sns-video-studio/remotion/` の下（`node_modules`・`out` を除く。`remotion.config.js`・`public/`・`risk-rules.json` を含む）
- 作り手と送る口（`sns-video-studio/remotion/src/**`・`sns-video-studio/remotion/scripts/**`・`scripts/sns/push-*.js`）から、相対の import・`export from`・`import()`・`new URL("<相対>", import.meta.url)` で辿れるファイル。JSON 等のコードでないものは辿らない葉として数える（全貌の文は `scene2-data.mjs` が `src/locales/ja/common.json` を `new URL` で読む）。今回の `src/utils/raceSeriesText.js` はここで当たる
- root の `package.json`・`package-lock.json`（作り手が使うパッケージ remotion・react・@remotion/fonts・twitter-text・playwright の版）、この workflow、検査のスクリプト
- 辿る途中で参照先が見つからない import がある（安全側）、差分が空・一覧が読めない

辿り方は `scripts/lib/relativeImportGraph.js` に置き、`verify-remotion-src-imports.js` と共用する。判定は base 側の `sns-makers-scope.js` と `relativeImportGraph.js` を `git archive` で同じ配置に取り出して動かし、辿る木は checkout（`--root`）を渡す。base に無ければ（この PR）走らせる。base は PR ではマージコミットの1つ目の親、push では `github.event.before`。

入口に `scripts/**` を含めるので、f01 の撮影（`f01-capture.mjs` → `vite.config.js`・`src/snsCapture/f01Parts.js`）を経て `src/` の多くに届く（2026-11-05 の実測で 202 ファイル、うち remotion と送る口の外が 94）。走る PR は多めに出るが、リポジトリは public で分数は無料、他の job と並行に走るので許す。

### 4. 必須のチェックへの切り替え（段階2）

赤になってもマージを止める所が無いと #2236 の種類（Codex の PR の自動マージ）を止められない（審査 P1-1）。順は次のとおり（審査の推奨）。

1. 段階1（この ADR の PR）: workflow・判定・検査を入れ、必須にしないまま緑にして時間を実測する
2. 段階2（Orchestrate・オーナー）: 次を同時に切り替える。別々に変えると `guard-pr-merge.js` の `rulesetEnforcesChecks` が食い違う
   - GitHub の ruleset「master-checks」の必須に `sns-makers` を足す
   - `scripts/maintenance/guard-pr-merge.js` の REQUIRED_CHECKS に `sns-makers` を足し、`verify-guard-pr-merge.js` を合わせる。あわせて、master の判定（base の `sns-makers-scope.js`）が `run` なのに `sns-makers-run` が成功していなければ止める（PR の側で workflow を書き換えて判定を逃れる穴。ADR-0100 §3 と同じ）
   - hq の `config/codex-pr.json` の期待の check に `sns-makers` を足す（hq の持ち場）

`run=false` でも集約の `sns-makers` は SUCCESS で終わるので、必須にしても docs だけの PR を止めない（guard の `judgeOneCheck` は SUCCESS 以外を止め、Codex の merge-check M2 は skipped を不合格にする）。

### 5. 台帳

- `verify-remotion-compositions.js`・`verify-sns-makers.js` は `tier=manual`（`verify:ci` は remotion の依存と Chromium を入れない）。reason に `sns-makers.yml` で回すことを書く。ADR-0072 に「manual には専用の workflow で自動で回すものも含む」と追記した
- `verify-sns-makers-scope.js`（ci）が判定を固定する

### 6. CI の時間

1回あたり。手元（M 系の mac、依存と Chromium は入れた後）の実測は、compositions 約3秒・`verify-sns-makers.js` 約16秒（材料と検査1秒・束3秒・19コマ12秒）。CI（ubuntu-24.04、4 vCPU）は依存の入れ方が足される:

| 段 | 分（見込み、PR の初回の run で書き直す） |
|---|---|
| root の npm ci（cache あり） | 約1 |
| remotion の npm ci（cache あり） | 約0.5 |
| Remotion の Chromium（cache あり。無ければ約93MB の取得） | 約0.2〜0.5 |
| OS の部品（apt） | 約1〜2 |
| compositions・makers | 約0.5〜1 |
| 計 | 約3.5〜5（`timeout-minutes: 20`） |

走るのは `run=true` の PR だけで、他の job と並行に走るので、PR の待ち時間（e2e の約30分）を延ばさない。

## 結果

- #2236 の種類の壊れ（束が作れない・描画で投げる）を PR で検知する。修正前の状態（`raceSeriesText.js` が `raceDetailHeading.js` を import）に戻すと、`verify-remotion-compositions.js` が `{}.glob is not a function` で、`verify-sns-makers.js` が9件全部の composition で落ちることを手元で確かめた
- マージを止めるのは段階2の後
- hq の環境の壊れ（2・3）は龍神の CI では止められない。hq の studio の側で、毎日の作り手を回す前に root と remotion の `npm ci`（arm64 の Node で）と `verify-remotion-compositions.js` を回す
- 声・撮影・mp4 の書き出しの壊れは拾わない（hq の毎日の実行で落ちたら起票）
