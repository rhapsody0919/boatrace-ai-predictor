# 開発効率の計画（1週目〜2週目）

オーナーが 2026-10-24 に「推奨どおりで良い」で承認した計画。system-architect の審査の指摘を反映した版。

## 0. 目的

- 1件の起票が完了するまでの時間・差し戻し・衝突・Claude の週の枠の使用を減らす
- 手段は「機械が落とす検査を増やす」と「純関数を Node で試験できる場所へ移す」の2つ。Codex に任せられる範囲（`docs/design/codex-direct-pr/design.md` の段1・2）を広げることにもつながる
- 測れない効きは主張しない。§5 の基準値と比べて判断する

## 1. 全体の流れ

```mermaid
flowchart TD
  S0["0. 基準値と候補<br/>直近2週の元の起票1件あたりの指標<br/>fix の件数×変更の大きさで候補を並べる"]
  S1a["1a. ESLint の1回の実行で複数の規則<br/>verify-no-undef を広げ verify:ci の中で回す"]
  S1b["1b. 共有の根を決める（design §4.2）<br/>→ verify-pure-imports.js"]
  S32["3+2. DAL の1関数ずつの切り出し<br/>手を加えず移す＋試験で固定＋旧 export から呼ぶ"]
  S4["4. pure の根の中だけ @ts-check と範囲を限った tsc"]
  S5["5. PGlite の共通の土台<br/>本番スキーマのスナップショットを正本に"]
  S6["6. ER図（後回し）"]
  S0 --> S1a
  S0 --> S1b
  S1b --> S32
  S1b --> S4
  S32 --> S4
  S0 --> S5
  S5 -.-> S6
```

1a と 1b は並べる。3+2 は 1b の決定が要る（移す先のパスが決まらないと verify-pure-imports.js が書けない）。ただし依存が `src/utils` にある関数は、1b を待たず `src/services` の下の別ファイルへ移してよい（§2 の 3+2）。

## 2. 段ごとの中身

### 0. 基準値と候補

- 直近2週（2026-10-10〜10-23）の元の起票1件あたりで、完了までの時間・差し戻しの回数（CI の赤・審査の P0/P1）・衝突（rebase・番号の付け直し）・Claude の枠の使用を記録する。定義と取り方は `docs/design/codex-direct-pr/design.md` §8 に合わせる
- 候補の並べ方: ファイルごとの fix コミットの件数 × 変更の大きさ（追加＋削除の行）。上位から切り出しの候補にする
- 切り出した関数の試験が効いているかは BOA-255 の方式（変異の検証: 実装をわざと壊して試験が落ちるかを確かめる）で見る

### 1a. lint の範囲を広げる

- `scripts/maintenance/verify-no-undef.js` を、ESLint の1回の実行（`ruleFilter` に複数の規則）で見る形に広げ、verify:ci の中で回す。`.github` は変えない（Quality Gates が既に verify:ci を必ず走らせる）
- 規則の一覧は引数で渡し、`verify-registry.json` の行の `args` で verify:ci のときだけ付ける。引数なしは今のまま no-undef だけ。`post-merge-checks.yml:69` が引数なしで呼ぶので、マージ後の Slack の範囲は広がらない（ADR-0079 追記）
- 最初に error にするもの: 今の違反が少ない規則（`no-empty`・`no-irregular-whitespace` 等）と、`src` だけの `react-hooks/rules-of-hooks`
- `no-unused-vars` は BOA-1015〜1018・1024（既存の違反の解消）の後に入れる
- 抑制の一覧（`verify-no-undef-allowlist.json` を規則ごとに広げたもの）は、解消済みの行が残っていても落とす（今の流儀のまま）
- ファイル内の `eslint-disable` の追加も検出する（一覧を通らない抑制を塞ぐ）
- 「await し忘れ」（`no-floating-promises` 相当）は型の情報が要るので、4 の型の段まで外す
- 実測: error は 345（2026-10-24、system-architect の実測）。本 PR の作成時の再測（origin/master `e2d194f35`、`npx eslint . -f json`）は全体で 699、`docs/`（235 件の no-undef は docs の中の .js の例）と `sns-video-studio/`（別の React の作り）を除くと 352。範囲の取り方で数が変わるので、1a の PR で対象のディレクトリを verify-no-undef と同じにそろえて数え直す。lint 全体を必須にしない理由は ADR-0079 の追記

| 規則 | src | scripts | e2e | analysis | 1a での扱い |
|---|---|---|---|---|---|
| `no-unused-vars` | 16 | 293 | 2 | 5 | BOA-1015〜1018・1024 の後 |
| `no-irregular-whitespace` | 3 | 3 | 12 | 0 | 最初に error（直してから入れる） |
| `no-empty` | 3 | 0 | 0 | 0 | 最初に error（同上） |
| `react-hooks/rules-of-hooks` | 0 | — | 1 | — | `src` だけ最初に error（e2e の1件は `e2e/fixtures.js:516` の Playwright の fixture の `use` を React の Hook と取り違えた誤検出） |
| `react-hooks/set-state-in-effect`・`purity`・`preserve-manual-memoization` | 11 | — | — | — | 後で判断（React 19 の新しい規則。直すと挙動が変わりうる） |
| `no-control-regex`・`no-useless-escape` | 0 | 2 | 0 | 0 | 最初に error（同上） |

### 1b. 共有の根と verify-pure-imports.js

- 共有の根の決定は `docs/design/codex-direct-pr/design.md` §4.2 の追記（2026-10-24）を正本にする
- 決定の後に `scripts/maintenance/verify-pure-imports.js`（台帳で `ci`）を作る。仕様は同 §4.2 の表

### 3+2. DAL の切り出し

- `src/services/supabaseDataService.js`（DAL）は Node で import できない（`./supabaseClient`（拡張子なし）が `import.meta.env.VITE_SUPABASE_URL` を読む・`../utils/stConsideration` 等の拡張子なしの import を Node の ESM が解決しない、の2つ。`src/services/supabaseClient.js:44-45`、`supabaseDataService.js:8・22`）。中の純粋な計算は Node の verify で試験できない
- 1つの PR で次を同時に行う: (a) 1関数を手を加えずに移す (b) 移した先で今の動きを試験で固定する (c) DAL の旧の export からはその関数を呼ぶ（呼び出し側は変えない）
- 試験の期待値は2つに分ける: 「旧の実装から取った値」（今の動きの固定。誤りも含めて写す）と「仕様の値」（公式の定義・設計書から決まる値）。食い違ったら別の起票にし、切り出しの PR では直さない
- SQL を変えていない証拠: その PR の E2E で、録画に無いリクエストの素通しが0件（`scripts/maintenance/report-e2e-passthrough.js` の集計）。録画の照合は URL（PostgREST のクエリ）で行うので、クエリが変われば素通しが出る。限界: E2E が通らない関数のクエリは証拠にならない。そういう関数は SQL の部分を移さない
- 依存が `src/utils` にある関数は、1b が決まるまで `src/services` の下の別ファイル（Node で import できるもの）に移す。1b の後に pure の根へ移し直す
- 切り出しの PR は自動マージしない（design §4.2「切り出しの PR」）
- 切り出しの最初の PR で、共通ロジックの索引（`scripts/maintenance/generate-lib-index.js` の TARGETS）に `src/pure` を足す。足さないと移した関数が索引から消える（design §4.2 追記）

### 4. 型の検査

- pure の根の中だけ `// @ts-check` を付け、範囲を限った `tsc --noEmit`（jsconfig の `include` を pure の根だけ、`"types": []`、DOM を含まない `"lib"`）を verify:ci の中で回す。JSDoc の `import('...')` 型と `/// <reference` で根の外が入らないよう、verify-pure-imports.js がコメントの中も見る（ADR-0079 追記）
- `typescript` は今 devDependency に無い。足す PR は `package.json` を変えるので Claude の PR（Codex の G5 の対象）
- 全体に `checkJs` を入れない理由は ADR-0079 の追記

### 5. PGlite の共通の土台

- 今の PGlite の verify（`scripts/maintenance/` に34本）は、それぞれ必要なマイグレーションだけを読む。全スキーマの土台は無く、マイグレーションの積み上げでは DROP・RENAME を追えない
- 共通の土台は、本番のスキーマのスナップショット（`claude_ro` でカタログ（`pg_catalog`・`information_schema`）を読んで DDL にしたもの）を正本にする
- Supabase Branching は入れない（費用が掛かる。今の verify は PGlite で足りる）

### 6. ER図

- 後回し。5 のスナップショットができれば機械で作れる（`docs/reference/database-design.md` の関係図と同じ考え方）

## 3. Codex と Claude の分け方

| 段 | Codex | Claude |
|---|---|---|
| 0 | fix の件数×大きさの集計のスクリプト（`scripts/analysis/` の新規、段1） | 基準値の記録（Linear・枠の記録）、候補の決定 |
| 1a | 規則ごとの違反の一覧・解消のパッチ（BOA-1015〜1018・1024 等、既存の変更は要審査） | `verify-no-undef.js` の拡張（守りの verify なので Claude）、`eslint.config.js` の変更 |
| 1b | — | 共有の根の決定（本 PR）、`verify-pure-imports.js`（G5 の守りの verify） |
| 3+2 | 移した関数の試験の追加（段1・2 の範囲） | 切り出しの PR（DAL の変更を含むので Claude。自動マージしない） |
| 4 | pure の根の中の型の注記の追加（段2、根が開いた後） | `typescript` の追加・jsconfig・verify の追加 |
| 5 | スナップショットを使う verify の新規（段1） | スナップショットの job（`claude_ro` の鍵を使う。オーナーの承認） |

## 4. 最初の2週間（最短）

前の結果が本当に要る所だけを順にする。

| 日 | Claude | Codex |
|---|---|---|
| 1日目（10/24） | 本 PR（docs）。基準値の記録の着手 | fix の件数×大きさの集計のスクリプト |
| 2日目 | 1a の verify の拡張の PR、1b の verify-pure-imports.js の PR（並べる） | 1a の規則ごとの違反の一覧 |
| 3日目 | 3+2 の1件目（候補の上位、`src/services` の下の別ファイルか pure の根） | 1件目の試験の追加 |
| 4〜5日目 | 3+2 の2・3件目。3件の後に ADR-0072 のランナーの見直し | BOA-1015〜1018・1024 の解消 → `no-unused-vars` を入れる |
| 2週目 | 4（`typescript` の追加と範囲を限った tsc）、5 のスナップショットの job（鍵の承認の後） | pure の根の中の型の注記、スナップショットを使う verify |

最短を決めている制約:
- 1b の決定（本 PR のマージ）→ verify-pure-imports.js → pure の根への切り出し
- BOA-1015〜1018・1024 の解消 → `no-unused-vars` の error
- オーナーの承認（スナップショットの job の鍵）→ 5

## 5. 成果の測り方

| 測る物 | 基準 | 見る時点 |
|---|---|---|
| 元の起票1件あたりの完了の時間 | §2 の 0 の直近2週 | 2週目の終わり |
| 差し戻し（CI の赤・審査の P0/P1） | 同上 | 同上 |
| 衝突（rebase・番号の付け直し） | 同上 | 同上 |
| Claude の週の枠の使用 | 同上 | 同上 |
| 新しい規則が止めた不具合 | 0（導入前） | PR ごと（verify:ci の失敗の記録） |
| 切り出した関数の試験の強さ | — | 切り出しの PR ごとに変異の検証（BOA-255 の方式） |

見直しの線（目安、根拠なし）: 2週目の終わりに4つの指標がどれも基準を下回らなければ、3+2 の候補の選び方を見直す。

## 6. 承認が要る所

| 物 | 誰 | 理由 |
|---|---|---|
| スナップショットの job の鍵（`claude_ro` を Actions か hq の定期 job で使う） | オーナー | 鍵とセキュリティ |
| Supabase Branching の費用 | オーナー | 新しい費用（本計画では入れない） |
| 必須の check の追加（ruleset） | オーナー | 保護ルールの変更。本計画は verify:ci の中に入れるので、新しい必須の check は要らない |
| それ以外（1a・1b・3+2・4 の設計） | 不要 | system-architect の審査を通して推奨どおり進める（`~/.claude/CLAUDE.md`「判断の流れ」） |

## 7. 関連

- ADR-0079（lint の範囲・型の検査の範囲、2026-10-24 追記）
- ADR-0072（ランナーの見直しの線、2026-10-24 追記）
- `docs/design/codex-direct-pr/design.md` §4.2（共有の根、2026-10-24 追記）
- `docs/knowledge/db-operations.md`（DAL・PGlite・eslint の実測・E2E の素通し・ADR-0072 の線）
