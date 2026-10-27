# ADR 0102: 本番スキーマの写しを記録として持ち、スキーマの正本にする

## ステータス

採用（2026-10-27）。開発効率の計画 [docs/design/dev-efficiency/plan.md](../design/dev-efficiency/plan.md) の段5。形は計画の審査（system-architect、2026-10-27）で決めた。

関係する ADR: [ADR-0096](./0096-claude-ro-readonly-role.md)（claude_ro と ro-query.js）、[ADR-0078](./0078-generated-docs-regenerated-after-merge.md)（機械生成の文書は PR に入れず、マージ後に作り直す）、[ADR-0072](./0072-verify-script-registry-and-ci.md)（検証の台帳と CI）、[ADR-0074](./0074-rpc-key-regression-check.md)（RPC の出力のキーの照合）。

## 背景

- 本番のスキーマを1か所で読める正本が無い。マイグレーション（`docs/db-migration/`）を積み上げても、DROP・RENAME・`CREATE OR REPLACE` の上書き・SQL Editor で直に当てた変更を追えない。台帳（`APPLIED.md`）は番号ごとの適用の記録で、今の形は持たない
- そのため、表・列・RPC を変える前の「読み手・依存の洗い出し」を毎回手で行っている（in-collapse-caution plan §7、cancellation-status-readers-inventory、BOA-1124・1126 等）。計画の B（データの読み手の台帳）と段6（全体の ER 図）は、今の形を機械で読める入力を前提にする
- `docs/reference/database-design.md` は 9/15 の手書きで、自動更新されない
- 本番を読む口は claude_ro（ADR-0096）だけにしている。claude_ro から見た `information_schema` は権限で行が欠ける（2026-10-27 の実測: `table_constraints` は0件（pg_constraint は CHECK 以外で198件）、`routines` は64関数のうち7件で `routine_definition` は全部 NULL、`columns` は1,477件（pg_attribute は1,487件））。`information_schema` は「自分に SELECT 以外の権限がある表」「自分が EXECUTE できる関数」だけを見せる作りのため

## 決定

1. **取得は ro-query.js を問い合わせごとに順に呼ぶだけにする**。新しい接続の口を作らない（ADR-0096）。`scripts/db/schema-snapshot.js` が `scripts/db/schema-snapshot/{meta,relations,columns,functions,policies,constraints,indexes,grants}.sql` を1本ずつ `ro-query.js --file … --json --limit 5000` に渡す
   - 読むのは `pg_catalog`（`pg_class`・`pg_attribute`・`pg_proc`・`pg_policy`・`pg_constraint`・`pg_index`・`pg_default_acl`）と `pg_get_functiondef`・`pg_get_viewdef`・`pg_get_constraintdef`・`pg_get_indexdef`・`aclexplode` だけ。`information_schema` は使わない（背景の欠け）
   - 対象は `public` だけ。拡張が作ったもの（`pg_depend` の deptype='e'）は除く
   - 行数の目安（`reltuples`）は入れない（毎回変わり、記録の差分が読めなくなる）
   - NOT NULL の制約（PostgreSQL 18 から `pg_constraint` に載る）は列の `notNull` と重なるので制約に入れない（版を上げたときに写しが膨らまない）
   - 並びは名前の順（関数は名前と引数の型の順、列は位置の順）。同じスキーマなら `capturedAt` 以外は同じ出力になる
   - 1本でも `truncated`（`--limit` の打ち切り）なら書かずに失敗する。2026-10-27 の最大は列の1,487行で、上限の5,000まで余裕がある
2. **組み立ては DB に触れない純粋な関数にする**（`scripts/lib/schemaSnapshot.js`）。表・ビュー・列・関数・ポリシー・制約・索引・権限（表・列単位・関数・シーケンス・既定の権限）を表ごと・関数ごとにまとめる。子（列・制約・権限 等）が一覧に無い表・関数を指したら、知らない記号（relkind・contype 等）が来たら、鍵らしい文字列（JWT・`sb_secret_`）が入っていたら失敗する。試験は `verify-schema-snapshot.js`（ci）で、PGlite に小さなスキーマを作り、同じ SQL を ro-query の READ ONLY の経路（`runReadOnlyQuery`）で実行して組み立てる
3. **写しは `docs/reference/schema-snapshot.json` に置き、「生成物」ではなく「記録」として扱う**。ADR-0078 の生成物の一覧（`GENERATED_DOCS`）に入れず、PR に入れてよい。手で書き換えない（verify が「組み立ての出力の形のまま」を確かめる）
   - ADR-0078 の型に入れない理由: ソースから作り直せる生成物ではなく、本番を読んだ時点の観測。作り直しには本番の鍵が要り、CI（マージ後のワークフロー）には置けない（ADR-0096「CI で claude_ro を使うのは review.yml の1か所」）。書き換えるのは取り直しの PR だけなので、ADR-0078 が解いた「ほぼ全 PR で変わる共有ファイルの衝突」は起きない
   - 定義（`definition`・`viewDefinition`）は行の配列で持つ。JSON の差分が1行ずつ読める。読む側は `join("\n")` で戻す
4. **鮮度は台帳の番号で持つ**。`appliedThrough` は取得の時の `APPLIED.md` で「適用済み」の最大の番号、`pendingAtCapture` はそれ以下で適用済みでなかった番号（未適用・不明・廃止・欠番・台帳に行が無い番号）。後で「適用済み」になった番号（`appliedThrough` より大きいもの、または `pendingAtCapture` にあるもの）があれば古い
   - 確かめるのは `scripts/maintenance/session-start-check.js` の `schemaSnapshot`（DB に触れない）。古ければ取り直しのコマンドを出す。PR は落とさない（古さはマイグレーションの PR の作者の責任ではない）
   - `.github` は変えない。マージ後のワークフローで Slack に知らせる案は、鍵を使わずにできる（番号の比較だけ）が、今は session-start-check で足りるとして入れない
5. **取り直すのは、マイグレーションの適用を確かめた人（Claude のセッション）**。`node --env-file=.env.local scripts/db/schema-snapshot.js` を実行し、差分を PR にする。台帳に載らない変更（SQL Editor で直に当てた等）は鮮度の判定に出ないので、気づいたら取り直す
6. **読み手**: B（データの読み手の台帳）は列・RPC の有無と、RPC の本文が読む表（`functions[].definition`）をここから引く。段6 の ER 図は `relations[].constraints` の外部キー（`references`）から作る。PGlite の共通の土台（段5 の後半）は、ここを入力に DDL を組み立てる（Supabase 固有のロール・拡張・auth スキーマの扱いは別に試す）

## 却下した選択肢

| 案 | 不適合 |
|---|---|
| `information_schema` で読む | claude_ro の権限で行が欠ける（背景の実測）。欠けてもエラーにならず、黙って少ない写しになる |
| GitHub Actions の定時の job で取る | Actions に claude_ro の鍵を置く場所が増える（ADR-0096 は review.yml の1か所）。鍵の追加はオーナーの承認が要る |
| ADR-0078 の生成物にしてマージ後に作り直す | 作り直しに本番の鍵が要る（同上）。ソースから決まる生成物ではない |
| `pg_dump --schema-only`・`supabase db dump` | 手元に pg_dump が無い。どちらも新しい接続の口になり、ro-query.js の READ ONLY・ロールの確認・行の上限を通らない。`supabase db dump` は書き込みのできるロールの鍵が要る |
| マイグレーションを PGlite に積み上げて今の形とする | DROP・RENAME・SQL Editor で直に当てた変更・番号の欠け（未適用の案）を本番どおりに再現できない |
| DDL（.sql）で持つ | B・段6 が読むには構文を解析し直す必要がある。権限・ポリシーの対応を機械で引きにくい。DDL は写しから組み立てられる |

## 結果

- 本番の今の形を1つのファイルで読める（2026-10-27 の初回: 表・ビュー105（表101・ビュー4）、列1,487、関数64、ポリシー56、制約397、索引214。約1MB）
- 写しが古い間は、session-start-check が知らせる。取り直すまでは古いことを前提に読む
- 入らないもの: `public` 以外のスキーマ（auth・storage 等）、トリガー、型（enum 等）、拡張の一覧、行の中身と件数。要るようになったら問い合わせを足す（`SNAPSHOT_QUERIES` と verify を同じ PR で）
