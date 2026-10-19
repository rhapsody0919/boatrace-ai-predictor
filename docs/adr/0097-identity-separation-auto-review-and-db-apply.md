# ADR-0097: PR を作る身元と承認する身元を分け、審査・マージ・軽い SQL の適用を自動にする

- 状態: 提案中（2026-10-19 オーナー採用。実装は段取り A〜D'、切替はオーナー）
- 設計の正本: hq の drafts/identity-separation-20261019.md（v5.1。§0・§0.1 が正）。オーナーの作業の手順は [docs/operation/identity-separation-owner-steps.md](../operation/identity-separation-owner-steps.md)
- 関連: [ADR-0096](./0096-claude-ro-readonly-role.md)（claude_ro）、[docs/operation/db-apply.md](../operation/db-apply.md)（適用のワークフロー）

## 背景

- 今の Claude の `gh` はオーナーと同じ admin のアカウント（rhapsody0919）で、ruleset を bypass でき、db-apply の Environment の承認もできる。止めているのは龍神のフック（文字列の照合）と指示だけ（db-apply.md「Claude（AI）は起動・承認しない」）
- オーナーが本番の SQL の実行と PR の承認を毎回していて、ボトルネックになっている（2026-10-19 オーナー「レビューの仕組みがあれば全部自動でよい」）
- master-guard（ruleset）は承認1件・最後の push の後の承認ありだが、必須の check が無く、dismiss_stale も OFF、マージの方法は3つとも可

## 決定

### 身元

| 身元 | 持つ権限 | すること |
|---|---|---|
| 作成の App `ryujin-maker` | Contents・Pull requests・Workflows の書き込み、Checks・Commit statuses・Actions の読み取り。Administration・Environments・Secrets は無し | AI の PR を全部これで作る。Claude と Codex はブランチの接頭辞（`claude/`・`codex/`）で見分ける |
| 審査の App `ryujin-reviewer` | Pull requests の書き込み、Contents の読み取り（承認が数えられなければ書き込みに上げる） | 承認に数える唯一の AI の身元 |
| ryujin-bot（既存） | Contents の書き込み。ruleset の bypass は always のまま | master への自動コミット（11本の workflow）。鍵は master だけの Environment にある |
| オーナー | admin | 重い SQL の Environment の承認、ruleset、鍵 |

- 切替の後、Claude の `gh` は作成の App の短命のトークン（hq の道具が Keychain の秘密鍵から作る）を使い、admin を持たない
- CODEOWNERS は置かない。仕組みの変更（.github・.claude・AGENTS.md・vercel.json・package.json・DB の適用コード）も審査の App の承認だけで通る（オーナー判断）

### 審査（`.github/workflows/review.yml`、段取り E）

- `pull_request_target`（opened・synchronize・reopened）。master にある定義だけが動くので、PR が審査の定義を書き換えても、その PR の審査には効かない
- 動かす条件: 作者の `user.id`（数値）が作成の App、head のリポジトリが同じ、`base.ref == 'master'`
- PR の head を checkout しない・実行しない。`persist-credentials: false`、`npm ci`・cache を使わない。差分は API で取り、全部取れなければ落とす（fail closed）。symlink・submodule・LFS・バイナリ・`.gitattributes` の変更は機械で落とす
- PR の本文・タイトル・コメントは審査の材料に入れない
- 別ベンダーで審査する（`claude/` は OpenAI、`codex/` は Anthropic）。P0 が0件なら、審査した head SHA に APPROVE を付ける（承認の直前に head を取り直し、違えば付けない）
- LLM を呼ぶ job と、審査の App の鍵で承認する job を分ける。承認の job は判定の JSON だけを受け取る
- 本番の状態（表の定義・行数・索引）を claude_ro で取る job は、PR を扱う job と分ける。表の名前は引数で渡し、件数と定義だけを返す（ADR-0096 の追記）
- 鍵は Environment `pr-review`（master だけ）に置く。この Environment を使える workflow は review.yml だけ、という検査を verify に足す
- 月の件数の上限を置き、超えたら承認せず止めて通知する

### ruleset とマージ

- 必須の check: `verify`・`e2e`・`ml-tests`（出元は GitHub Actions）。マージは squash だけ。dismiss_stale を ON
- 必須の check は品質のためのもの。作成の App は PR の中で workflow を書き換えられるので、守りにはならない。守りは審査の App の承認だけ
- auto-merge は切替のときに ON。admin の bypass は切替のときに外す

### 鍵の移し替え（段取り S）

repo の secret（Environment の外）は、同じリポジトリのどのブランチの workflow からも読める。作成の App は Workflows を書けるので、ブランチを push するだけで本番の鍵を使える。
そこで、定期実行が使う書き込みの鍵（`SUPABASE_SERVICE_KEY`・`SUPABASE_URL`・`SLACK_WEBHOOK_URL`・`VERCEL_DEPLOY_HOOK`・`LINEAR_*`・`GOOGLE_SERVICE_ACCOUNT_KEY`・`SEARCH_CONSOLE_SITE_URL`）を、master だけの Environment `prod-jobs` に移す。鍵を使う job に `environment: prod-jobs` を付け、repo の secret には anon（`VITE_SUPABASE_*`）だけを残す。切替の前に済ませる。

### 本番 SQL の適用（段取り B・C・D）

- 起動は push ではなく定期の突き合わせ（`scripts/db/db-reconcile.js`）。push の起動は concurrency の待ち枠1本で黙って取りこぼすため
- 当てる対象は次を全部満たすファイルだけ。番号の順に1本ずつ当て、失敗したらそこで止めて通知する
  1. 切り替えのコミット（workflow に固定する）より後に、マージされた PR で足された（A だけ。変更・改名は対象外）。squash だけなので `merge_commit_sha^1..merge_commit_sha` の差分で判定する
  2. その PR が merged・base master で、ファイルの blob が、PR の head と **当てる時点の master HEAD** で同じ
  3. その PR の head SHA に審査の App の APPROVE がある（ryujin-bot の直接 push で足されたものは対象外）
  4. 台帳 APPLIED.md の行の「適用状況」が `未適用` で始まり、その行も同じ PR で足されている
  5. 同じ番号の `NNN-runbook.md` が無い（あれば当てずに通知）
- db-apply が実行中・承認待ちなら、突き合わせは何もせず終わる
- PR のコメントにある判定の結果は信用しない（e2e-smoke-test は PR のコードを pull-requests: write で動かすので、見せかけのコメントを書ける）。当てる時点で判定し直す

### 軽い・重いの判定（`classifyMigration`、`scripts/lib/dbApplySql.js`）

許可のリスト方式。ファイルの全部の文が次の列挙に丸ごと当てはまるときだけ「軽い」（Environment `production-db-auto`、承認なし）。1文でも外れたら「重い」（`production-db`、オーナーの1タップ）。

- 軽い: `CREATE TABLE`、`CREATE INDEX`（式の索引を除く）、`ADD COLUMN`（既定値なし・NOT NULL なし）、`COMMENT`、同じファイルで作った表への `ENABLE ROW LEVEL SECURITY`・SELECT だけの policy・`REVOKE`、`NOTIFY pgrst`
- 重い（例。これに限らない）: `CREATE OR REPLACE FUNCTION`（BOA-363・431 の事故）、DO ブロック、DROP の全種類、`DISABLE TRIGGER`、RENAME、`TRUNCATE`・`DELETE`・`UPDATE`・`MERGE`・`ON CONFLICT DO UPDATE`、型の変更、`GRANT`・`ALTER DEFAULT PRIVILEGES`・`SECURITY DEFINER`・RLS の無効・書き込みの policy、`CREATE RULE`・`TRIGGER`・`EXTENSION`、`ALTER ROLE`・`SET ROLE`、最上位の `SELECT fn()`・`CALL`、`CREATE TABLE AS`・`MATERIALIZED VIEW`、関数を呼ぶ DEFAULT・CHECK、verify-migration-rls の除外マーカーを含むもの
- 止める（当てずに通知）: 個人情報らしい列（email・phone・address・birth・氏名 等）を足すもの、判定できない文
- 判定は鍵を持たない job で行う。既存の全 SQL を読ませてラベルの一覧を固定する検査を verify-db-apply に足す
- 自動の経路では `lock_timeout` と `statement_timeout` を手で当てるときより短くし、超えたら失敗として止める（判定は行数を見られないため）

### 削除の前の控え

- データを消す文（DROP TABLE・TRUNCATE・DELETE・DROP COLUMN）は、同じファイル（＝同じトランザクション）の前の文で、API に出ないスキーマ `db_backup` に `CREATE TABLE db_backup._bak_<番号>_<表> AS TABLE <表>` と写してから消す。DELETE も表全体を写す（WHERE の一致を文で照合するのは壊れやすいため）。DROP COLUMN は主キーとその列を含む `AS SELECT … FROM <表>` でもよい。判定はこの形があることを検査し、無ければ止める
- 秘密を含む表は `-- db-apply: no-backup <表> <理由>` で控えの要求を外す（外しても重いので、オーナーの1タップは残る）
- DROP SCHEMA・TYPE・DOMAIN・EXTENSION の CASCADE と DROP OWNED は、どの表・列が消えるかを文から決められず、控えで守れないので止める
- `db_backup` スキーマは最初の削除のマイグレーションで作る（CREATE SCHEMA は重い）
- 大きい表（行数の上限を超える）は写さず止める（オーナーへ）。秘密を含む表は控えを作らない
- 期限切れの控えは一覧にして通知し、まとめて1タップで消す（消すのも重い）
- PITR は入れない（オーナー判断）。戻しは日次のバックアップ7日分と控え

### 試運転

D はまず1〜2週間、当てずに「当てるはずだった」を通知するだけで動かす。試運転の印を外す（D'）のは、切替（Claude の `gh` が admin でなくなる）の後。

## 却下した選択肢

| 案 | 不適合 |
|---|---|
| CODEOWNERS で仕組みの変更をオーナー必須にする | 直近30日で該当223本（1日約7回）。オーナーが承認から外れる目的に合わない（オーナー判断） |
| 審査を Mac の別ユーザーで動かす | 審査のコードを terukina の Claude が書き換えられ、terukina は admin グループで sudo で届く |
| 拒否のリスト方式（危ない文を列挙して止める） | 列挙の漏れがそのまま自動の適用になる。今の解析は `$$` の中・ALTER TABLE の中の操作を読まない |
| CREATE OR REPLACE FUNCTION を軽いにする | キーの消失の事故（BOA-363・431）。121〜166 のうち15本がこの形 |
| ryujin-bot の bypass を pull_request モードにする | master に直接 push する11本の workflow が止まる |
| PITR を入れて削除を軽いにする | 月約100ドル。戻しはプロジェクト全体の巻き戻しで、SNS の送信の状態も戻る |
| db-apply を push で起動する | concurrency の待ち枠1本で、続けてマージされたものを黙って取りこぼす |

## 残る弱み（オーナーが受け入れた）

- 審査が指示の注入で騙されると、仕組みの変更（判定・審査の workflow を含む）が通る。その場合、重い SQL の1タップの関門も後から外せ、本番の鍵を持ち出されうる
- 必須の check は守りにならない（上記）
- 別ベンダーの API の従量の課金

## 影響

- 自動で当たる SQL は、最近の33本で5〜7本の見込み。残りはオーナーの1タップ（スマホの GitHub の Environment の承認）。承認待ちが6時間を超えたら通知する
- 新しいコードが新しい列に頼るときは、SQL を先の PR で入れる（Vercel はマージで即デプロイし、適用は定期の突き合わせを待つため）
- 切替の後、オーナーが自分で書いた PR は審査が見ないので、ruleset を一時 Disabled にしてマージする
- 切替の後、CI のやり直しは空のコミットで行う（作成の App に Actions: write を付けない）
