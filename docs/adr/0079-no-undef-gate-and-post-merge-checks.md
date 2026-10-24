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
2. **`scripts/maintenance/verify-no-undef.js`（ci tier）を追加する。** src・api・middleware.js・scripts・e2e・ルートの `*.config.js`・`*.mjs` を ESLint で検査し、no-undef だけを数える（`ruleFilter`）。他のルールの既存違反では落とさない
   - 構文エラーや、どの設定区分にも当たらず検査されなかったファイルも失敗にする（検査されずに 0 件で通るのを防ぐ）。不要になった `eslint-disable` コメントの警告は、検査自体はできているので対象外にする
   - 残す違反は `verify-no-undef-allowlist.json` に（file, name, reason）で載せる。解消済みの項目が残っていても失敗にする（`verify-css-class-collisions.js` と同じ流儀）。導入時点では空
   - 自己テストを毎回実行する: #1020 直前の master（`3c0894ba`）の `supabaseDataService.js` を `git show` で読み、`groupIntoCurrentMeet` を検出できること。`src/` で `process` を検出すること（Node のグローバルが漏れていない）。`e2e/` で `process`・`Buffer`・`document` を通すこと。`.mjs` が検査対象であること
3. **マージ後の master でも検査する（`.github/workflows/post-merge-checks.yml`）。** 今回の型を捕まえる本命はこちら。master への push で `verify-no-undef.js` と `npm run build` を走らせ、失敗したら Slack（`SLACK_WEBHOOK_URL`）に流す
   - 通知には、壊れたコミット（`git log -1`）と、その直前にマージされた PR（直近のコミットのうち、タイトル末尾に `(#番号)` を持つもの）を並べる。2 つの PR の組み合わせで壊れる型では、この 2 つが当たりになる
   - 絞り方: `paths` で `src/`・`api/`・`middleware.js`・`scripts/`・`e2e/**/*.js`・ルートの `*.mjs`・`index.html`・`eslint.config.js`・`vite.config.js`・`package.json`・`package-lock.json` に限る。自動コミット（`[automated]`）が触るのは `public/sitemap.xml`・`public/llms.txt`・`docs/`・`data/`・`e2e/recording.json`（直近 200 コミットの実測）なので、これで走らない。コミットメッセージでは絞らない（`[automated]` でも `src/` を触るなら走らせるため）。なお GITHUB_TOKEN による push はそもそも他のワークフローを起動しない（ADR-0078）
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

## 追記（2026-10-24）: lint の範囲を広げる・型の検査は pure の根の中だけ

開発効率の計画（`docs/design/dev-efficiency/plan.md` の 1a・4）で、本 ADR の範囲を次のように広げる。元の決定（lint 全体を PR の関門にしない・`checkJs` を全体に入れない）は変えない。

1. **lint は verify:ci の中で、ESLint の1回の実行に複数の規則を見る。** `verify-no-undef.js` に規則の一覧を渡す引数を足し、`verify-registry.json` の行の `args` で verify:ci のときだけ一覧を渡す。同じ対象のディレクトリ・同じ「検査されなかったファイルは失敗」の扱いで回す。**引数が無いときは今のまま no-undef だけ**にする。`post-merge-checks.yml:69` は引数なしで呼ぶので、マージ後の Slack は no-undef・build のまま（上の「採らなかった案」3行目の「マージ後の通知は本番に出ると壊れるものに絞る」を保つ。system-architect の審査 P2、2026-10-24）。`npm run lint`（`eslint .`）を必須にはしない。`.github` は変えない（Quality Gates が verify:ci を走らせる）
   - 最初に入れるのは今の違反が少ない規則（`no-empty`・`no-irregular-whitespace` 等）と、`src` だけの `react-hooks/rules-of-hooks`。違反を直してから入れる
   - `no-unused-vars` は既存の違反の解消（BOA-1015〜1018・1024）の後
   - 抑制の一覧は規則ごとに持ち、解消済みの行が残っていても失敗にする（決定2の流儀のまま）。ファイルの中の `eslint-disable` の追加も検出し、一覧を通らない抑制を塞ぐ
   - 「lint 全体を PR の関門にする」を採らなかった理由（既存の違反が多数）はそのまま当てはまる。実測 error 345〜699（範囲の取り方で変わる。system-architect の実測 345、e2d194f35 の `eslint .` 全体 699・docs と sns-video-studio を除く 352。1a で verify-no-undef と同じ対象で数え直す、plan.md 1a）。規則ごとに違反を 0 にしてから足すので、無関係な既存の違反で落ちない
2. **型の検査（`@ts-check` と範囲を限った `tsc --noEmit`）は pure の根（`src/pure/**`・`scripts/lib/pure/**`、`docs/design/codex-direct-pr/design.md` §4.2）の中だけ。** `checkJs` を全体に入れない元の決定と両立する理由:
   - 元の理由は「既存のコードへの導入の費用が大きい」。pure の根は新しく作るフォルダで、入る物は切り出しの PR で1関数ずつ移すので、既存の違反の山が無い。導入の費用が元の理由の前提に当たらない
   - pure の根は `verify-pure-imports.js` で根の外を読めない。型の検査の範囲が import でほかのファイルへ広がらない。ただし `tsc` は JSDoc の `import('...')` 型と `/// <reference>` も解決し、既定の `lib` は DOM を含み `@types/*`（今は `@types/react`・`@types/react-dom`）も自動で入る。範囲を閉じる条件として、(a) verify-pure-imports.js がコメントの中の `import(` と `/// <reference` も import と同じ判定にかける (b) jsconfig に `"types": []` と DOM を含まない `"lib"`（例 `["ES2022"]`）を置く、の2つを満たす（system-architect の審査 P2、2026-10-24）
   - no-undef が捕まえない「名前はあるが引数・戻り値の形が変わった」（本 ADR の限界）を、共有される純関数に限って捕まえる。画面と定期の job の両方から呼ばれる関数ほど、この壊れ方の害が大きい
   - 「await し忘れ」（`no-floating-promises` 相当、型の情報が要る規則）も、この型の段まで入れない

## 追記（2026-10-24）: 1a の実装（PR #1819、オーナー承認済みの計画どおり）

`verify-no-undef.js` を、ESLint の1回の実行で複数の規則を数える「lint の関門」に広げる。名前は変えない（`post-merge-checks.yml` がこの名前で呼び、`.github` は変えない方針のため）。

- 規則は引数 `--rules=` で渡す。PR の Quality Gates（verify:ci）は `verify-registry.json` の `args` で下の4規則を渡す。**引数が無いときは no-undef だけ**で、`post-merge-checks.yml` は引数なしで呼ぶ。マージ後の Slack 通知の範囲は「本番に出ると壊れるもの」（no-undef・build）のまま変わらず、上の「採らなかった案」（マージ後の通知を広げない）と合う
- 規則: `no-undef`・`no-empty`・`no-irregular-whitespace`・`react-hooks/rules-of-hooks`（`src/` だけ。`e2e/fixtures.js` の Playwright の `use(...)` が誤検出になる）。重さは `eslint.config.js` に頼らず検査の側で `error` に固定する。`no-unused-vars` は BOA-1015〜1018・1024 の後、「await し忘れ」は入れない
- 範囲は変えない（src・api・middleware.js・scripts・e2e・ルートの `*.config.js`・`*.mjs`）。`globalIgnores` が `dist` だけなので、範囲を明示して `public`・`sns-video-studio`・`data` を読まない
- 許可リストは「規則 → ファイル → 許可・理由」。no-undef は名前（`names`。旧版と同じく名前の入れ替わりも落とす）、他の規則は件数（`count`）。許可を超えたら失敗、許可に満たなくなっても失敗（解消済みの行を残さない）。件数で持つ規則は、同じファイルの中で1件直って1件増える入れ替わりを通す（代償として受け入れる）。導入時は no-empty 3件・no-irregular-whitespace 18件
- ファイル内の設定コメント: この検査では `noInlineConfig` で効かせず、検査中の規則に触れるもの（規則名の無い `eslint-disable`、検査中の規則を名指す `eslint-disable`・`/* eslint 規則: 重さ */`、`global`・`globals`・`eslint-env`）があれば失敗にする。旧版は `eslint-disable no-undef`・`/* global */` で no-undef を消せた（導入時に消されていたものは0件）。関門の外の規則の `eslint-disable`（`react-hooks/exhaustive-deps` 等、導入時30件。exhaustive-deps 28・no-unused-vars 2）は通す。「今の数を一覧に固定する」案は採らない。関門の外の disable を足すたびに一覧の更新が要り、数が合っていれば関門の規則の disable を紛れ込ませられるため。`eslint.config.js` には `noInlineConfig` を入れない（`npm run lint` とエディタの挙動を変えない）
- 自己テストに、規則ごとの検出、突き合わせの単体（許可リストが空でも added・stale を確かめる）、実在のファイルに違反を1つ足した版を実際の許可リストと突き合わせて落ちること（変異の検証）を足す。変異は `lintText` でメモリの上で作り、ディスクに一時ファイルを書かない（並行で走る他の verify に拾われないため）
