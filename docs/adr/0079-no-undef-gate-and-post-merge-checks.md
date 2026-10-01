# ADR 0079: 未定義の名前の参照を CI で検査し、マージ後の master でも検査して Slack に流す

## ステータス

採用（2026-10-01）

## 背景

2026-10-01、本番で「groupIntoCurrentMeet is not defined」が出て、今節 F の印が全レースで消えた。

- #1002 が `src/services/supabaseDataService.js` の import を `groupIntoCurrentMeet` から `groupIntoMeetBeforeRace` に置き換えた
- その後にマージされた #999 は、同じファイルの別の箇所でまだ `groupIntoCurrentMeet` を呼んでいた
- 2つの PR は別々の行を触っていたので、テキストの衝突は無かった。どちらの PR も単体では CI が緑だった
- master では「import の無い名前を呼ぶ」形になり、そのまま本番に出た。#1020 が import を戻して直した

### マージ順で壊れる型

片方の PR が名前を消し（import・export・関数の削除や改名）、もう片方の PR がその名前を新しく使う。どちらも「自分を作った時点の master」との組み合わせでは正しい。2つが両方入った時点で初めて壊れる。

### PR 単位の CI で捕まらない理由

- PR の CI は「PR を作った（または最後に push した）時点の master」と PR の組み合わせしか検査しない。後から入った別の PR との組み合わせは検査しない
- master にはブランチ保護の "Require branches to be up to date before merging" が効いていない（ADR-0072 の 063 番重複と同じ経路）。先に #1002 が入っても、#999 の CI はやり直されずにマージできる
- vite build（Rollup）は「is not exported by」（存在しない名前を import する）をエラーにするが、**import 自体が無い名前の参照は実行時まで分からない**ので通す。ビルドが緑でも捕まらない

## 調査

- src・api・middleware.js（347 ファイル）の no-undef は、上の 1 件だけだった
- scripts・e2e では誤検出が出ていた。いずれも `process`・`console`・`Buffer` で、`eslint.config.js` が e2e/ に Node のグローバルを付けていないこと、`.mjs` をどの設定区分にも入れておらず（`files: ['**/*.{js,jsx}']`）ルールが1つも有効になっていなかったことによる
  - 本 ADR の時点（origin/master `424b101d`）で no-undef の対象 5 ディレクトリ・939 ファイルを数えると: 変更前 20 件（e2e の process 18・Buffer 2。.mjs は検査されず 0 件扱い）→ `.mjs` を検査対象に入れただけの状態 46 件（scripts の .mjs で process 25・Buffer 1 が増える）→ Node 区分を直した後 0 件
- `npm run lint`（`eslint .`）は CI に載っておらず、no-undef 以外のルールの既存違反が多数ある。lint 全体をゲートにすると、無関係な既存違反の解消が先に要る

## 決定

1. **`eslint.config.js` の Node 区分を実態に合わせる。** `scripts/`・`api/`・`e2e/`・`analysis/`・`middleware.js`・ルートの `*.config.js`・ルートの `.mjs`/`.cjs` に `globals.node` を付ける。ブラウザで動く `src/` には付けない（付けると `src/` で `process` を参照しても黙る）。e2e/ は `page.evaluate` の中で `document` を使うので、ブラウザのグローバルと併存させる。共通区分の `files` に `.mjs`/`.cjs` を加え、これらも検査対象にする
2. **`scripts/maintenance/verify-no-undef.js`（ci tier）を追加する。** src・api・middleware.js・scripts・e2e・ルートの `*.config.js` を ESLint で検査し、no-undef だけを数える（`ruleFilter`）。他のルールの既存違反では落とさない
   - 構文エラーや、どの設定区分にも当たらず検査されなかったファイルも失敗にする（検査されずに 0 件で通るのを防ぐ）
   - 残す違反は `verify-no-undef-allowlist.json` に（file, name, reason）で載せる。解消済みの項目が残っていても失敗にする（`verify-css-class-collisions.js` と同じ流儀）。導入時点では空
   - 自己テストを毎回実行する: #1020 直前の master（`3c0894ba`）の `supabaseDataService.js` を `git show` で読み、`groupIntoCurrentMeet` を検出できること。`src/` で `process` を検出すること（Node のグローバルが漏れていない）。`e2e/` で `process`・`Buffer`・`document` を通すこと。`.mjs` が検査対象であること
3. **マージ後の master でも検査する（`.github/workflows/post-merge-checks.yml`）。** 今回の型を捕まえる本命はこちら。master への push で `verify-no-undef.js` と `npm run build` を走らせ、失敗したら Slack（`SLACK_WEBHOOK_URL`）に流す
   - 通知には、壊れたコミット（`git log -1`）と、その直前にマージされた PR（直近のコミットのうち、タイトル末尾に `(#番号)` を持つもの）を並べる。2 つの PR の組み合わせで壊れる型では、この 2 つが当たりになる
   - 絞り方: `paths` で `src/`・`api/`・`middleware.js`・`scripts/`・`e2e/**/*.js`・`index.html`・`eslint.config.js`・`vite.config.js`・`package.json`・`package-lock.json` に限る。自動コミット（`[automated]`）が触るのは `public/sitemap.xml`・`public/llms.txt`・`docs/`・`data/`・`e2e/recording.json`（直近 200 コミットの実測）なので、これで走らない。コミットメッセージでは絞らない（`[automated]` でも `src/` を触るなら走らせるため）。なお GITHUB_TOKEN による push はそもそも他のワークフローを起動しない（ADR-0078）
   - `concurrency` で取り消さない。マージが続いても各コミットを検査し、どのコミットで壊れたかを通知に出すため

## 検討して採らなかったもの

| 案 | 採らなかった理由 |
|---|---|
| `npm run lint` 全体を PR ゲートにする | no-undef 以外の既存違反が多数あり、無関係な修正が先に要る。今回の型を捕まえるのに必要なのは no-undef だけ |
| ブランチ保護で "Require branches to be up to date" を有効にする | 並行 PR が多く、マージのたびに他の全 PR の rebase と CI のやり直しが要る。運用コストが大きい。マージ後の検査は「本番に出る前に気づく」までで止めるが、コストはほぼ無い |
| Quality Gates（master push でも `verify:ci` を走らせている）に Slack 通知を足す | `verify:ci` は全 verify を走らせるため、無関係な検査の揺れでも通知が飛ぶ。マージ後の通知は「本番に出ると壊れるもの」（no-undef・build）に絞る |
| TypeScript の型検査（`checkJs`） | 今回の型を捕まえられるが、既存コードへの導入コストが大きい。no-undef で今回の型は十分に捕まる |

## 限界

- マージ後の検査は「検知」であって「予防」ではない。Vercel の本番デプロイと並行して走るため、壊れたコミットが一度本番に出ることはありうる。通知で気づいて直すまでの時間を縮めるのが目的
- no-undef は「名前が無い」ことしか見ない。名前はあるが引数・戻り値の形が変わった、という組み合わせの壊れ方は捕まえない
- 動的に作る名前（`globalThis[name]` 等）や、`typeof x === "undefined"` で守った参照は対象外（no-undef の仕様）
