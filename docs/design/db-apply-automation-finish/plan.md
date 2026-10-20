# 自動の適用の仕上げ（ADR-0097 の段取り D → D' と切替）

[ADR-0097](../../adr/0097-identity-separation-auto-review-and-db-apply.md) の「レーンの PR → 審査の App の承認 → db-apply の定期の起動が軽い SQL を当てる」経路を、実際に動く形にする設計。ADR-0097 の決定（身元・審査・当てる対象の5点・軽い／重いの判定）は変えない。変えるのは、起動の出元・PR を作る身元の配線・D' の前に要る3点・その順番。

オーナーの手順の正本は [identity-separation-owner-steps.md](../../operation/identity-separation-owner-steps.md)、適用の手順の正本は [db-apply.md](../../operation/db-apply.md)。この文書は、それらへの変更の設計を1か所にまとめたもの。実装は、オーナーの判断の後に PR を分けて行う（§5）。system-architect の審査（2026-10-20）の指摘を反映済み（§12）。

## 1. 今、動いていない理由（2026-10-20 15:30 JST の実測）

| # | 何が | 実測 | 出典 |
|---|---|---|---|
| 1 | 毎時の起動が来ない | `db-apply.yml` の schedule（`17 * * * *`）は #1674（2026-10-20 01:41Z に master）から 06:32Z までに起動0回（期待5回）。run は workflow_dispatch の2件だけ | `gh run list --workflow db-apply.yml` |
| 1' | 高頻度・新設の schedule は来ない | 直近24時間: Scrape Scheduled（`*/10`、約96回の期待）が4回。10/20 に足した key-canary（`7,37 * * * *`）は0回。日次の schedule は来ている（審査の実測で5日5/5） | `gh run list --event schedule -L 200`、`--workflow key-canary.yml` |
| 2 | 審査が動かない | review.yml の直近15件が全部 `skipped`。gate の条件 `github.event.pull_request.user.id == vars.REVIEW_MAKER_BOT_ID` に、rhapsody0919 名義の PR が当たらない | `gh run list --workflow review.yml`、review.yml の gate の `if` |
| 2' | 作成の App の道具はある | hq の `scripts/app-token.sh`（Keychain の秘密鍵から1時間のインストールのトークン、`gh`・`push` の下位コマンドつき）。App ID は hq の `config/github-apps.json`。龍神の .claude・AGENTS.md・scripts からは呼ばれていない | 読み取りで確認 |
| 2'' | 手順7・8 は未了 | repo の secret に、移す対象の8つ（`SUPABASE_SERVICE_KEY` 等）が残っている。ADR の一覧に無い `GOOGLE_SPREADSHEET_ID` も残る。Claude の `gh` は rhapsody0919（keyring、scope `repo`・`workflow`、git_protocol ssh） | `gh api .../actions/secrets`、`gh auth status` |
| 3 | 試運転のまま | `DB_APPLY_DRY_RUN: "true"`（db-apply.yml の env）。D' は切替の後（ADR-0097「試運転」） | db-apply.yml |

補足:
- 段取り S（鍵を使う job に `environment: prod-jobs`）は済んでいる。repo の secret の8つを参照する workflow で `environment:` を持たないものは0本（grep で確認）
- 1 の結果、試運転の通知も一度も出ていない。さらに 2 の結果、承認の付いた PR が無いので、起動が来ても軽い／重いの判定は1件も動かない（§5「D' の条件」）

## 2. (a) 起動を Vercel Cron からの dispatch に移す

### 形

```mermaid
flowchart LR
  VC["Vercel Cron<br/>毎時17分<br/>/api/cron/db-apply-dispatch"] -->|"POST dispatches<br/>ref=master, inputs.mode=reconcile"| GH["db-apply.yml<br/>(workflow_dispatch)"]
  SCH["schedule 47 * * * *<br/>(予備。来れば同じ動き)"] --> GH
  GH --> R{mode / event}
  R -->|"mode=manual<br/>(人が起動)"| I[inspect → apply<br/>production-db の承認]
  R -->|"mode=reconcile<br/>または schedule"| RC[reconcile → judge → apply-auto / apply-gated → record / hold → notify]
```

### 変えるもの

| 場所 | 変更 |
|---|---|
| `.github/workflows/db-apply.yml` の `on.workflow_dispatch.inputs` | `mode`（choice: `manual`・`reconcile`、既定 `manual`）を足す。`migration` は `required: false` にする（reconcile では空） |
| 同 `inspect` の `if` | `github.event_name == 'workflow_dispatch' && inputs.mode != 'reconcile'`。`migration` が空なら `db-apply.js inspect` のパスの検証で落ちる（今と同じ） |
| 同 `reconcile` の `if` | `github.event_name == 'schedule' \|\| (github.event_name == 'workflow_dispatch' && inputs.mode == 'reconcile')`。ほかの条件（repository・`REVIEWER_BOT_USER_ID`）はそのまま |
| 同 `reconcile` の最初の step | `mode=reconcile` で `migration` が空でなければ落とす（どちらの意図か曖昧な起動を通さない） |
| 同 `notify` の `if` | `github.event_name == 'schedule'` を reconcile と同じ式に置き換える。`needs.judge.outputs.mode != 'wait'` を足す（窓の外で prod-jobs の deployment を毎時作らない）。`needs` に hold を足し、`RESULT_HOLD` を渡す |
| 同 `record` の `MIGRATION`・`SHA256` | `inputs.migration \|\| needs.judge.outputs.file` をやめ、手での起動（`workflow_dispatch` かつ `mode != 'reconcile'`）なら MIGRATION は `inputs.migration`・SHA256 は inspect の出力、それ以外は両方とも judge の出力と、mode で分ける。reconcile の入口の検査に加えた二重の守り（ずれると、別のファイルを台帳に「適用済み」と書く） |
| 同 `schedule` | `17` を `47 * * * *` にずらして残す（予備）。同じ分だと、遅れて来た schedule と dispatch が重なり、互いを busy と見て両方とも何もしない |
| `scripts/lib/analogyDispatch.js` の `DISPATCH_WORKFLOWS` | `db_apply_reconcile: { workflow: "db-apply.yml", inputs: { mode: "reconcile" } }` を足す。起動の関数・失敗の扱いは今のものを使う |
| `api/cron/db-apply-dispatch.js`（新） | `createScrapeCronHandler({ job: "db_apply_dispatch", run: …, modeGated: true })`。in-caution-dispatch.js と同じ形。run は下の「見張り」の確認をしてから `createAnalogyDispatchRun("db_apply_reconcile")` を呼ぶ |
| `scripts/lib/scrapeJobs/registry.js` | `db_apply_dispatch: { kind: "monitor", leaseSec: 60, maxDurationSec: 60, hosts: [], failureAlertAfter: 1 }` |
| `vercel.json` | `{ "path": "/api/cron/db-apply-dispatch", "schedule": "17 * * * *" }`（UTC。JST も毎時17分）。登録は今63本で、上限100本（ADR-0066） |
| `scrape_job_state` | 共通ラッパが初回の起動で `mode='off'` の行を作る（`cronWrapper.js:148`）。オーナーは `INSERT INTO scrape_job_state (job, mode) VALUES ('db_apply_dispatch', 'shadow') ON CONFLICT (job) DO UPDATE SET mode = excluded.mode` を当てる（in-collapse-caution の owner-prod-steps-pr1.sql と同じ形。ラッパが行を作る前でも後でも効く。`ON CONFLICT DO NOTHING` だと off のまま残る）。shadow で1日見てから `live` |
| `scripts/maintenance/verify-analogy-dispatch.js` | 新しい対象の配線（registry・api の job 名・inputs のキーが workflow の inputs にあること）を足す |

- 予備の schedule が来ても、同じ reconcile が動くだけで二重に当てることは無い: reconcile は db-apply の他の run が `in_progress`・`queued`・`waiting` 等なら何もしない（`isBusy`、自分の run は除く）。2本が同時に始まると、互いを busy と見て両方とも何もしない（その回は飛ぶだけ）。最後の守りは §4.1 の主キー
- Vercel Cron の重複配信（まれ）も同じ理由で無害
- Vercel Cron は「リトライ無し・best-effort」。1回抜けても次の時間に拾う（突き合わせなので、抜けた回の分は残らない）

### トークン

- 今の Vercel の環境変数 `GITHUB_ACTIONS_DISPATCH_TOKEN` をそのまま使う。fine-grained PAT、boatrace-ai-predictor だけ、Actions: Read and write だけ（[analogy-weekly-train-dispatch.md](../../operation/analogy-weekly-train-dispatch.md) 49行目）。Vercel では Encrypted・Production だけ（審査の実測。Preview のデプロイからは読めない）。新しい鍵は作らない
- 今のトークンでも db-apply は dispatch できる（Actions: write は workflow を選べない）ので、PR-A で今より**できることは増えない**。手での起動（mode=manual）は production-db の承認で止まり、reconcile は審査の App が承認した PR のファイルしか選ばない
- ただし**切替の後の目標の状態と比べると、残る弱み**になる。このトークンは Actions: write を持つ（ADR-0097 は作成の App に Actions: write を付けない、と決めている）。Claude は Vercel CLI の認証（hq の drafts/identity-separation §54）と Vercel MCP に届き、値を読む関数をデプロイすれば読める（Sensitive は画面の表示を止めるだけ）。届いたときにできること: master の任意の workflow を inputs つきで dispatch、prod-jobs の run の rerun、review.yml の無効化。同じ経路で Vercel の SUPABASE_SERVICE_KEY 等にも届く
  - 塞ぐのは切替のとき（§6 の表）: Claude の動くユーザーから Vercel CLI の認証を外す（または書き込みの無いトークンにする）・Vercel MCP を切る。塞がないなら ADR-0097 の「残る弱み」に書いてオーナーが受け入れる（判断5）
- オーナーに設定の画面で確かめてもらうこと（値ではなく）:
  - この PAT に Actions 以外の書き込み、とくに **Deployments・Environments・Administration が付いていない**こと。PAT の持ち主は production-db の required reviewer（オーナー）なので、deployment の承認の権限があると、この PAT で承認できてしまう
  - Environment `production-db`・`production-db-auto`・`prod-jobs`・`ryujin-bot` の Deployment branches が **master だけ**であること。dispatch は任意の ref を指定でき、そのブランチの YAML が動く。鍵に届かせない守りはこの設定だけ（Claude からはフックが Environments の API を止めるので読めない）
- 期限切れ: 401 で dispatch が失敗し、`failureAlertAfter: 1` で1回目から Slack に出る（学習の起動と同じ）

### 見張りの空振り

dispatch は 204 を返すだけで、run が本当に動いたかは分からない。次はどれも黙る: `vars.REVIEWER_BOT_USER_ID` が空で reconcile が skipped（notify も skipped）、run が queued のまま、Vercel Cron 自体が来ない（monitor の job には死活の検知が無い）。
- dispatch の関数で、起動の前に db-apply の run と、その run の jobs（PAT の Actions: Read で読める）を見て、「最初の live の起動（`scrape_job_runs` の db_apply_dispatch の live の最古の行）から3時間を過ぎ、直近3時間に **reconcile の job が success で終わった** run が無い」なら（run の結論で数えると、reconcile が skipped の run も数え、承認待ちの run は reconcile が終わっていても in_progress のままで、空振りする） `outcome: "error"` を返す（起動はする）。`failureAlertAfter: 1` で Slack に出る
- Vercel Cron 自体が来ないことは、内側からは分からない。hq の外の見張り（scrape_job_runs の最終実行の鮮度）に `db_apply_dispatch` を足してもらう
- scrape-monitor は JST 7:00 から通知するので、夜の失敗（§4.3 の窓の中を含む）は朝に出る

### フック・規律との整合

- `.claude/hooks/guard-deploy-approval.sh` は変えない。Claude の Bash からの workflow の起動・承認は今までどおり止める。起動するのは Vercel の関数で、Claude ではない
- db-apply.md「Claude（AI）は起動・承認しない」の節に「定期の突き合わせ（mode=reconcile）は Vercel Cron が起動する。手での起動（mode=manual）はユーザー本人だけ」と1文足す
- Claude が `api/cron/db-apply-dispatch.js` を手で叩く経路: CRON_SECRET が要る（cronWrapper の認証）。届いても、選ばれるのは審査済みのファイルだけ

## 3. (b) レーンの PR と push を作成の App の名義にする

### 考え方

龍神の手順（スキル・AGENTS.md）は `gh` と `git push` を素で呼ぶままにして、**身元は環境の側で差し替える**。理由:
- create-pr・implement・orchestrate・Codex のレーンなど、`gh pr create`・`git push` を書いた場所が多い。各所に `app-token.sh gh ...` を書き込むと、書き漏れの所が rhapsody0919 のまま動き、審査が skipped になるだけで誰も気づかない
- 道具は Mac 全体の身元の道具で、hq の持ち物（hq の drafts §39）。龍神は「どの名義で動いているか」を検査するだけにする

### 形

```mermaid
flowchart TB
  subgraph Mac["terukina の Mac（Claude・Codex が動く）"]
    CC[Claude / Codex のレーン] -->|gh pr create| SHIM["gh の shim（hq）<br/>remote から owner/repo を決め<br/>app-token.sh でトークンを作り GH_TOKEN で gh を exec"]
    CC -->|git push| CH["git の credential helper（hq）<br/>app-token.sh の git-credential の下位コマンド"]
    KC[(Keychain<br/>ryujin-maker-key)] --> SHIM
    KC --> CH
  end
  SHIM --> GHAPI[GitHub: PR の作者 = ryujin-maker bot]
  CH --> GHAPI
  GHAPI --> RV[review.yml の gate が通る → 審査 → 承認]
```

### hq に頼むもの（龍神からは書き換えない）

1. `app-token.sh` に git の credential helper の下位コマンド（`get` に `username=x-access-token`・`password=<token>` を返す）。トークンはファイルに残さない。git の側は `credential.useHttpPath=true` を付ける（付けないとリポジトリを見分けられない）
2. `gh` の shim（PATH の先頭に置く）。カレントの git の remote から `owner/repo` を決め、作成の App が入っているリポジトリならトークンを作って `GH_TOKEN` で本物の `gh` を exec する。入っていないリポジトリ（hq 等）は hq の決めた身元（hq の drafts §108: hq だけの App か deploy key）
3. shim の細部: `-R`/`--repo`・`GH_REPO` の指定があればそれでリポジトリを決める。リポジトリの外の呼び出しは止める（名義が分からないため）。インストールのトークンは1時間で切れるので、長い watch（`/merge-pr` の本番ビルド待ち等）は途中で作り直す
4. 切替のときの片付け（§6 の手順8）

### 龍神の側で変えるもの（切替の PR、§5 の PR-D）

| 場所 | 今 | 変更 |
|---|---|---|
| `.claude/commands/merge-pr.md` 24行目 | `gh pr merge {pr} --squash --admin` | `gh pr merge {pr} --squash --auto`。切替の後は admin の bypass が無く、作成の App にも admin は無い。審査の承認と必須の check がそろったら GitHub がマージする |
| `.claude/skills/orchestrate/SKILL.md` 118・176行目 | 「名義は未決」「`--admin`」 | 作成の App の名義で `--auto`。段階0の自己マージは「auto-merge を付ける」意味になる |
| `.claude/commands/create-pr.md` | `git push -u origin HEAD`・`gh pr create` | 変えない。push・PR の前に「名義の確認」の1行（下の検査）を足す |
| AGENTS.md 47・123行目 | Codex はマージ・auto-merge をしない | 変えない（Codex の PR の auto-merge はオーケストレーターが付ける） |
| AGENTS.md 110行目・`scripts/maintenance/e2e-rerun.js --apply` | 落ちた e2e を `gh run rerun --failed`・cancel で1回だけ再実行 | 作成の App には Actions: write が無い（ADR-0097）ので、切替の後は 403 で壊れる。再実行を空のコミットの push に替える（ADR-0097「切替の後、CI のやり直しは空のコミット」）。止まった shard の cancel はできないので、50分を超えたら「上げる」にする |
| `scripts/maintenance/guard-pr-merge.js` | `--auto` は ruleset が3つの check を必須にしているときだけ GitHub に任せる | 変えない（既に対応） |
| 新: 名義の検査 `scripts/maintenance/check-gh-identity.js` | ― | `gh api /installation/repositories` が通る（＝インストールのトークン）ことと、`gh auth status` に rhapsody0919 が無いことを見る。create-pr の最初と session-start-check に入れる。rhapsody0919 なら止める（審査が skipped になるだけで気づけないため） |

- コミットの author（`git config user.*`）は変えなくてよい。審査の gate は PR の作成者（`pull_request.user.id`）を見る
- ラベル（`gh pr create --label`）が通らなければ作成の App に Issues: Read and write を足す（オーナーの手順6の5、既にある）
- 切替の後、`gh api user` はインストールのトークンでは通らない。龍神の scripts・.claude に使っている所は無い（grep で確認）
- **作業の順番**: hq の shim・credential helper を入れる・PR-D をマージする・手順8の1〜3 は、**1回の作業で続けて**行う。shim を先に入れると admin の keyring と併存する期間ができ（下の「名義を混ぜない」に反する）、PR-D を先にマージすると 8.1 まで check-gh-identity が create-pr を止め、8.3 まで `--auto` のマージも通らない。PR-D は bypass がまだある間（8.2 の前）にオーナーがマージする
- gh の `git_protocol` は今 ssh。手順8で `gh config set git_protocol https` にする

### 切替の前の暫定（入れない）

切替の前に、create-pr だけを `app-token.sh gh ...` に替えて審査を動かす案は採らない。Claude の gh が rhapsody0919 のままだと、作成の App の PR と admin の PR が混ざり、admin の名義で出た PR は審査されずに `--admin` でマージできる。名義を混ぜる期間を作らず、切替で一度に替える。

## 4. (c) D' の前に要る3点

### 4.1 当て直しの防止: DB の側の印

```sql
-- 新しいマイグレーション（重い。CREATE SCHEMA・GRANT を含むので production-db、オーナーの1タップ）
CREATE SCHEMA db_apply;
REVOKE ALL ON SCHEMA db_apply FROM PUBLIC, anon, authenticated;
CREATE TABLE db_apply.applied (
  file        text PRIMARY KEY,            -- docs/db-migration/NNN_xxx.sql のファイル名
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  route       text NOT NULL CHECK (route IN ('manual', 'auto', 'gated')),
  run_id      bigint NOT NULL,             -- GitHub Actions の run
  applied_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE db_apply.applied ENABLE ROW LEVEL SECURITY;  -- policy は作らない（postgres のみ）
REVOKE ALL ON db_apply.applied FROM anon, authenticated, service_role;
GRANT USAGE ON SCHEMA db_apply TO claude_ro;
GRANT SELECT ON db_apply.applied TO claude_ro;            -- 台帳とのずれを Claude が読むため
```

- スキーマ `db_apply` は PostgREST の公開スキーマに入れない。適用の後、claude_ro で `has_table_privilege` を見て anon・authenticated・service_role が false であることを確かめる
- **印は適用と同じトランザクションで、ファイルより先に入れる**: 両方の形（`single-transaction`、`file-transaction`＝ファイル自身の BEGIN〜COMMIT。後者は今 34/159 本）で、psql を `-1 -v db_apply_file=… -v db_apply_sha256=… -v db_apply_route=… -v db_apply_run_id=… -f marker.sql -f <元のファイル>` で動かす
  - `marker.sql` はリポジトリに置く固定のファイルで、`INSERT INTO db_apply.applied (file, sha256, route, run_id) VALUES (:'db_apply_file', :'db_apply_sha256', :'db_apply_route', :'db_apply_run_id'::bigint);` の1文だけ。psql の変数は `-c` では展開されず `-f` の中で展開されるので、ファイルにする。変数名は本文と当たらないよう `db_apply_` を付ける
  - `file-transaction` のファイルの BEGIN は「既にトランザクションの中」の WARNING だけになり、ファイルの最後の COMMIT で印ごと確定する。途中の失敗は ON_ERROR_STOP で印ごと戻る。**元のファイルを書き換えないので、審査した sha256 と流すバイト列がずれない**
  - 印を先に入れるので、ファイルの中の `SET LOCAL ROLE` の影響を受けない
  - **runner の psql 16 で実機確認してから採る**（PR-C の最初の作業。捨てられる DB（runner の postgres の service container）で、両方の形・途中の失敗・同時の2本を試す）。psql の文書には「スクリプト自身が BEGIN・COMMIT を使うと `-1` は意図した効果にならない」とある
  - `TX_BEGIN_RE` は `BEGIN ISOLATION LEVEL …`・`START TRANSACTION READ …` も通す。`-1` の下ではそのオプションが黙って捨てられるので、自動・承認つきの経路ではオプションの付いた BEGIN を「止める」にする（今は該当0本）
  - 実機確認で file-transaction の形が崩れたときの代わり: 切り替えより後の新しいマイグレーションは single-transaction の形だけにする（ファイルに BEGIN/COMMIT を書かない。verify で検査し、judge は file-transaction を「止める」にする）。今の 34 本の file-transaction は全部切り替えより前で、自動の経路の対象外
- **主キーで二重を構造的に止める**: 2本の run が同じファイルを当てても、後の方は印の INSERT が一意制約で失敗し、何も当たらずに戻る。busy の検査や台帳の読みの競合に頼らない
- 当てる前の確認（3つの経路の全部）:
  - 行が無い → 当てる
  - 行があり sha256 が同じ → **当てずに record だけ進める**（当てた後の record の失敗からの自己回復。台帳を「適用済み」にする）。apply の job は成功で終わり、出力 `already_applied=true` を付ける。通知の文は「当てた」ではなく「既に当たっていたので台帳だけ直した」、台帳に書く run の URL は印の `run_id`（元の run）
  - 行があり sha256 が違う → 止めて通知（同じ名前の別の中身。人が見る）
  - 表が無い（`to_regclass('db_apply.applied') IS NULL`）→ 止める（fail closed）。例外は作らない（PR-B は PR-C より前に、印の無い今のコードで当てるため）
- 手での経路（mode=manual）には `requireUnappliedOnMaster`（台帳の確認）を足さない。手で当てる経路は台帳が `不明` の行や切り替え前のファイルにも使っているため。手での経路で足すのは「印の行があれば止める」と「印を入れる」だけ
- 自己回復（sha256 が同じなら record だけ）は印を信じる。印を偽って書ける経路（`.env.local` の SUPABASE_ACCESS_TOKEN の管理 API 等、hq の drafts §54）が残る限り、「当てずに適用済み」にされうる。D' の条件に、その鍵を Claude の届く所から外すことを入れる（§5）
- 既存の適用済みのファイル（170本ほど）は印の表に入れない。対象は「これから当てるもの」だけ。台帳との突き合わせ（APPLIED.md の「適用済み」と表の行）は、表ができた日以降の行だけを verify で見る
- 表ができる前に手で当てて、台帳が `未適用` のまま残った切り替えより後のファイルは、印が無いので自動の経路が当て直しうる。D' の前に claude_ro で実物（表・列・索引）と照合し、当たっているものは台帳を直す（§5）
- PR-B のマイグレーションの冒頭にこの plan.md の参照を書くなら、`verify:er-diagram` のため plan.md に erDiagram を生成して貼る

### 4.2 失敗・却下したファイルの止め印

- 置き場所は**台帳（APPLIED.md）の「適用状況」の先頭の語**。新しい語 `保留` を足す（意味: 自動では当てない。理由と run の URL を括弧の中に書く）
  - DB に置かない理由: 失敗した適用はロールバックで DB に何も残らない。止め印のためだけに別のトランザクションで DB に書くと、鍵を持つ job の仕事が増える
  - PR のコメントに置かない理由: 誰でも書ける（ADR-0097「PR のコメントにある判定の結果は信用しない」）。止める側に倒れるだけとはいえ、正本を増やさない
- **突き合わせの直し**: `LEDGER_STATES` に `保留` を足すだけでは足りない。今の `db-reconcile.js:150` と `pickNext`・`pendingCandidates`（`dbReconcile.js:170`・`:238`）は、状態が null でも `未適用` でもないファイルを候補から外すので、`保留` を飛ばして**後ろの番号が当たる**（審査の P1-1、コードで再現）。`pickNext` は番号の順で先頭が `保留` なら `status: "blocked"`・理由「保留（run の URL）」を返す。verify に「保留の後ろの番号が選ばれない」を足す。これで今の規則「止まったファイルがあれば、以後の番号は当てずに止まる」（番号の順に依存があるため）を保つ。止まった通知は日付を入れて毎日1回
- 書く job: `hold`（新）。`needs: [judge, apply-auto, apply-gated]`、`if: !cancelled() && (apply-auto か apply-gated の result が failure) && その job の出力 attempted == 'true'`（`!cancelled()` が無いと暗黙の success() で skip される。cancelled（timeout・concurrency の取り消し）は `保留` にしない。当てたかどうかは印で分かるので、次の起動の自己回復に任せる）
  - `attempted` は apply-auto・apply-gated が **psql を動かす直前**に出す。当てる前の確認で止まったもの（窓の外・台帳が `未適用` でない・印の表が無い・sha256 が違う・試運転）は `保留` にしない。窓の外は失敗にせず、成功で終えて次の窓で拾う（judge が窓の中で auto を出しても、concurrency の待ちで apply-auto が窓を過ぎてから動くことがあるため）。それ以外の確認の止まりは今どおり失敗にして通知する
  - Environment の却下は steps が動かないので `attempted` が出ない。却下が job の結果でどう出るかを PR-C で実測し、却下も `保留` にする条件を足す
- notify の `needs` に hold を足し、`保留` にしたこと（ファイル・run の URL）と hold の失敗を Slack に出すrecord と同じく Environment `ryujin-bot` の名義で master に直接コミットする（`push-with-retry.sh`）。行の書き換えは `db-apply.js mark-held <file> <run の URL>`（mark-applied と同じ書き方）。**`未適用` の行だけを書き換える**（record と競合して `適用済み` を上書きしない）
- 外し方:
  - 一時的な原因（lock 等）: 行を `未適用` に戻す PR（審査を通る）。検査4は SQL を足したコミットの差分しか見ない（`db-reconcile.js:164`）ので、戻す PR とはぶつからない
  - SQL の中身が誤り: 中身を直すと検査2（PR の head と master の blob の一致）で永久に通らない。**新しい番号で出し直し、古い行は `廃止`** にする
  - オーナーが手で当てて `適用済み` にする
- `hold` の job が失敗したとき（push の失敗等）: 次の時間にもう一度同じファイルが選ばれる。自動の経路はもう一度失敗する（トランザクションで戻るので DB は変わらない）、承認つきはもう一度オーナーに承認を求める。どちらも Slack に出る。害は通知の重複だけ
- `lock_timeout` 切れの扱い: 一時的な原因でも1回目で `保留` にする。数えて再試行する仕組みは作らない（KISS）。1行の PR で再開する

### 4.3 開催の無い時間帯に限るか

- 自動の経路（承認なし）の lock は10秒で、待つ間は後ろの読み取りも並ぶ（ADD COLUMN の ACCESS EXCLUSIVE）。statement は120秒（CREATE INDEX は表への書き込みを止める）。`dbApplySql.js` の `AUTO_TIMEOUTS`
- 取得の Cron は UTC 20〜14時台（JST 5:00〜23:59）に集まっている（vercel.json）。JST 0:00〜5:00 は夜の集計（in-caution 2:30 等）だけ
- 案:

| 案 | 自動で当てる時間 | 良い点 | 悪い点 |
|---|---|---|---|
| **A（推奨）** | JST 1:00〜4:59 だけ。他の時間は judge まで動いて当てない | 開催中のロック待ちが起きない。窓は4回の起動ぶんあり、1回抜けても当たる | 新しい列に頼るコードは、SQL のマージから最大で約1日待つ（ADR-0097「SQL を先の PR で入れる」と同じ運用で吸収） |
| B | いつでも | 早い | lock の10秒の間、取得とページの読み取りが並ぶ。開催中に ADD COLUMN が当たると、取得の Cron が10秒待つことがある |

- 重いもの（承認つき）は時間を限らない。オーナーが承認を押す時間を選べる
- 実装: judge が `mode=auto` を出す条件に「JST の窓の中」を足し、窓の外なら `mode=wait`（何もしない、毎時の notify も出さない）。apply-auto でも当てる直前に窓を確かめ直す（判定と同じ2段）。窓は workflow の env に、始まりを含み終わりを含まない形で固定する（`DB_APPLY_AUTO_WINDOW_JST_FROM: "1"`・`DB_APPLY_AUTO_WINDOW_JST_UNTIL: "5"`＝JST 1:00 以上 5:00 未満）

## 5. PR の分け方

| PR | 中身 | 触る所 | マージ | 前提 |
|---|---|---|---|---|
| PR-0 | この設計（docs だけ） | docs | オーナー | ― |
| PR-A | 起動の移し替え（§2） | .github・api・scripts・vercel.json | オーナー（.github） | 判断1・2 |
| PR-A' | `scrape_job_state` の mode を shadow → 1日後に live（UPDATE） | 本番 DB | オーナーが SQL エディタで当てる。docs/db-migration の番号つきファイルにはしない（in-caution と同じく `docs/design/…/owner-prod-steps` の形。番号つきにすると、切り替えより後に審査なしで足されたファイルとして reconcile の列の先頭で blocked になり、後ろの番号を止める） | PR-A のデプロイの後（ラッパが off の行を作った後） |
| PR-B | 印の表のマイグレーション（§4.1 の SQL） | docs/db-migration | オーナー（手で当てる、重い） | 判断3 |
| PR-C | 印・止め印・時間の窓のコード（§4）。最初に psql の実機確認 | scripts/db・scripts/lib・.github・verify | オーナー（.github） | PR-B の適用 |
| PR-D | 名義の切替の龍神の側（§3） | .claude・scripts/maintenance | オーナー。切替の作業の中で、8.2 の前にマージ | hq の道具 |
| PR-F | ④ 審査の関門の画像の例外（§9.1）と再現テスト、ADR-0097 の追記 | scripts/lib/reviewPr.js・scripts/review・verify・docs/adr | オーナー（審査の仕組みの変更、段階2） | 判断8 |
| PR-H | §11 の機械化（`decideAction` の P1・観点、月の上限、draft の検査、`config/dev-gate.json`） | scripts/lib/reviewPr.js・scripts/review・scripts/maintenance・config・.github | オーナー（段階2） | 判断13〜16。切替の前 |
| PR-G | ⑥ orchestrate の段階0 F・案Z の書き直し（§9.3） | .claude/skills/orchestrate/SKILL.md | オーナー（.claude） | 判断11 |
| PR-E | `DB_APPLY_DRY_RUN: "false"`（D'）と、急ぎの止め方の repo の変数 `DB_APPLY_AUTO_ENABLED`（apply-auto の `if` とコードの両方で見る。`== 'true'` のときだけ当てる。未設定・消したときは当てない） | .github | オーナー | 下の「D' の条件」 |

### D' の条件（審査の P1-2）

切替の前は、承認の付いた PR が無いので reconcile の pending は全部 `ok:false` になり、`judge-all` は `ok:true` しか判定しない（`db-apply.js:241`）。PR-A の後も、軽い／重いの判定は実物で1件も動かず、出るのは「5点の検査を通らない」の通知だけ。試運転の評価は**切替の後から**始まる。D' に進む条件:
- `DB_APPLY_SWITCH_SHA` より後に、審査の App の承認なしで足された `未適用` のファイルが無い（手で当てるか `廃止` にする）。今 `171_sns_today_heading_variants.sql` が該当する（台帳 `未適用`、rhapsody0919 名義）。残ると `pickNext` が先頭で blocked を出し続け、後ろの審査済みのファイルが1本も当たらない。`judge-all` も先頭10本（`MAX_PENDING`）しか見ないので、10本たまると下の「5本判定」も満たせない。あわせて切替の PR で `DB_APPLY_SWITCH_SHA` を切替のコミットに進めるかを決める（判断12）
- 切替の後7日以上、試運転が動いている
- 審査済みの SQL を5本以上、judge-all が判定し、オーナーが Slack の「当てるはずだった」に誤りが無いと見た
- PR-C が入っている
- 印を偽れる鍵（`.env.local` の SUPABASE_ACCESS_TOKEN 等）を Claude の届く所から外した（§4.1）
- 切り替えより後に手で当てたファイルの台帳を、claude_ro で実物と照合した（§4.1）

## 6. 順番と戻し方

```mermaid
flowchart TD
  S0["PR-0 設計（今）"] --> S1["PR-A 起動の移し替え<br/>＋PR-A' shadow→live"]
  S1 -->|"通知の配線が動く<br/>（審査済みの PR が無いので判定はまだ）"| S2["PR-B 印の表（オーナーが手で当てる）"]
  S2 --> S3["PR-C 印・止め印・窓（まだ試運転）"]
  S1 --> S4["手順7: repo の secret を消す<br/>（prod-jobs の定期実行が2〜3日緑の後）"]
  S4 --> S7["1回の作業で続けて:<br/>hq の shim・credential helper → PR-D をマージ（bypass がある間に）<br/>→ 手順8: gh から admin を外す・bypass を外す・auto-merge ON"]
  S7 -->|"ここから試運転の評価が始まる"| S8
  S3 --> S8["PR-E: D'（試運転を外す）<br/>「D' の条件」を全部満たしたら"]
```

| 段 | 戻し方 | 戻したときの状態 |
|---|---|---|
| PR-A | `scrape_job_state` の mode を `off`（オーナーの SQL エディタ、同じ ON CONFLICT の形）。急ぎなら Vercel の Cron を外す PR | 予備の schedule だけに戻る（今と同じ） |
| PR-B | 表は残してよい（読まれなければ害は無い）。消すなら `DROP SCHEMA db_apply CASCADE` を手で（重い） | ― |
| PR-C | revert の PR。止め印 `保留` の行は手で `未適用` に戻す | 試運転なので当てる動きは変わらない |
| 手順7 | 消した secret を repo に入れ直す（オーナー） | 今と同じ |
| PR-D・手順8 | 手順書の「戻し方（逆の順）」。auto-merge を OFF → bypass に Repository admin を足す → `gh auth login`（rhapsody0919）→ PR-D を revert | 今と同じ |
| PR-E | 急ぎは repo の変数 `DB_APPLY_AUTO_ENABLED` を `false`（オーナー。作成の App は Variables を書けない、ADR-0097）。後で `DB_APPLY_DRY_RUN: "true"` に戻す PR。Environment `production-db-auto` を消すのは効かない（参照された Environment は GitHub が保護なしで作り直す。owner-steps 4-2） | 試運転に戻る |

### 手順7・8 への追記（owner-steps に足す）

- 手順7の前提に「job-watch・key-canary が prod-jobs の鍵で緑」を足す（10/20 の Invalid API key の再発の確認。key-canary が schedule で来ない間は、prod-jobs を使う日次の job の緑で見る）
- 手順8の1（gh から admin を外す）を、届く経路ごとに分けて書く。Claude が動く Mac のユーザーから rhapsody0919 の書き込みや本番の鍵に届く経路は、`gh` の keyring だけではない（hq の drafts §54）:

| 経路 | 今 | 切替でどうするか |
|---|---|---|
| `gh` の keyring（rhapsody0919、`repo`・`workflow`） | あり | `gh auth logout -u rhapsody0919`（オーナー）。`gh config set git_protocol https` |
| git の credential | `/opt/homebrew/etc/gitconfig` の osxkeychain を `~/.gitconfig` の空の `credential.helper=` で打ち消し、その後に `gh auth git-credential` を置いている | gh の helper の行だけを hq の helper に替え、**空のリセット行は残す**（消すと osxkeychain が戻り、インストールのトークンを Keychain に保存する。期限切れのトークンが先に返る原因にもなる）。Keychain に残る github.com のエントリは消す |
| SSH の鍵（`~/.ssh/github_rsa`、ssh.github.com:443） | ある。どのアカウントの鍵かは未確認 | rhapsody0919 に登録されていれば、GitHub の設定から外す（オーナー）。龍神の remote は https なので、龍神の作業には要らない |
| ブラウザ（Claude in Chrome・アプリのブラウザ）の GitHub のログイン | オーナーとして操作できる | Claude が操作できるブラウザで GitHub からログアウトする。オーナーの作業は別のプロファイルで行う（手順書の「全体の決まり」と同じ） |
| Vercel CLI の認証・Vercel MCP → Vercel の環境変数（dispatch の PAT・SUPABASE_SERVICE_KEY 等） | 届く（Sensitive でもデプロイしたコードからは読める） | Vercel CLI をログアウトするか書き込みの無いトークンにする、Vercel MCP を切る（§2） |
| `.env.local` の SUPABASE_ACCESS_TOKEN（管理 API）・VERCEL_OIDC_TOKEN 等。**全 worktree の写し（`.claude/worktrees/*/.env.local`）を含む** | 届く | Claude の届く所から外す（印を偽れるため。D' の条件） |
| Vercel の環境変数 `GITHUB_MERGE_TOKEN`（ADR-0034、PR の書き込み権限の PAT、オーナーの名義） | ある | **失効させる（手順8の前提）**。ruleset は書き込み権限のある身元の承認を数えるので、この PAT で作成の App の PR を承認でき、審査の App を迂回できる（§9.2） |

- どこまで外すかはオーナーの判断（判断5）。全部は外せない（terukina は macOS の admin で、sudo のパスワードを入れた後の操作には届く。hq の drafts §128）

### 決まった後の ADR-0097 の追記

- 「失敗・却下したファイルは次の起動でまた選ばれる」（ADR-0097 の「本番 SQL の適用」）を、`保留` の止め印に合わせて書き直す
- 「残る弱み」に、dispatch の PAT がオーナーとして動く経路と、外さなかった経路（判断5）を足す

## 7. 別スコープ（Linear に起票する）

- BOA-917: key-canary・job-watch の前提の定期の起動が来ない（10/20 に key-canary 0回）。同じ dispatch の形で Vercel Cron から起こすか、hq の見張りに寄せる。schedule が来ない原因そのものは未調査（この設計は迂回だけ）

## 8. オーナーに決めてもらう点

| # | 点 | 推奨 |
|---|---|---|
| 1 | 起動を Vercel Cron の dispatch にする（PR-A）。今の PAT を流用する | はい。今よりできることは増えない（切替の後の弱みは判断5で扱う） |
| 2 | PAT の権限が Actions だけか、Environment 4つの Deployment branches が master だけかを、設定の画面で確かめる | 確かめる（PAT に承認の権限があると production-db を承認でき、Deployment branches が広いと dispatch の ref で鍵に届く） |
| 3 | D' の前の3点を §4 の形で作る（印は DB の主キー、止め印は台帳の `保留`） | はい |
| 4 | 自動の経路を JST 1:00〜4:59 に限る（§4.3 案 A） | 案 A |
| 5 | 切替で、§6 の表の経路をどこまで外すか | gh・git の credential・ブラウザの GitHub のログイン・Vercel CLI と MCP・全 worktree の `.env.local` の管理の鍵は外す。`GITHUB_MERGE_TOKEN` は失効させる（手順8の前提）。SSH の鍵は登録先を確かめてから。外さないものは ADR-0097 の「残る弱み」に書く |
| 6 | 名義の差し替えを環境の側（hq の shim・credential helper）で行い、切替の前の暫定は置かない（§3） | はい |
| 7 | D' の条件（§5: 切替の後7日・審査済みの SQL を5本判定 等） | この条件 |
| 8 | ④ 審査の関門の画像の例外を §9.1 の条件（jpg だけ・印の欄の許可のリスト・EOI まで歩く・縦横の上限・F のパスだけの PR に限る）で入れ、同じ PR で ADR-0097 に追記する（段階2） | はい |
| 9 | ② で寸法の表がビルドで作られる形になったときの関門の条件 | ② のレーンと合わせて決める。それまでは PR の head の表で照合 |
| 10 | 画像の中身が LLM の審査に渡らないこと・polyglot を防ぎきれないこと・作成の App が自分で `--auto` を付けられることを受け入れるか | 受け入れて ADR-0097 の残る弱みに書く（グラフ・表の画像で、記事の本文は審査に入る。`nosniff` を足す） |
| 11 | ⑥ SKILL.md の段階0 F・案Z の5点の書き直し（§9.3。5点目の P0/P1 の扱いはオーナー決定済み、文案の承認が要る） | はい。PR-D とは別の PR |
| 12 | 切替の PR で `DB_APPLY_SWITCH_SHA` を切替のコミットに進めるか（切替の前に足した未承認の `未適用` を自動の対象から外す） | 進める。外れたものは手で当てる（今の手順のまま） |
| 13 | P1 を機械で止めるか（§11.1） | 案 A: コードの PR は P1 も止める、記事の PR は content-qa・wording の P1 だけ止める（(a)）。同じ P1 が2回出たら上げる |
| 14 | 審査の月の上限（§11.2） | 1500 に上げ、80% で知らせる。費用の守りはベンダーの月の上限 |
| 15 | auto-merge でのマージ順（§11.3） | 後ろ側の PR を draft にし、前が入ったら ready にする。up to date の要求は付けない |
| 16 | 例外の線の正本（§11.4） | `config/dev-gate.json`（仮）を master から読む。名前と置き場所は hq の v2 と合わせる |
| 17 | orchestrate のクラスを機械で分けるか（§11.4） | 分けるまでは owner と同じ。分けるならオーケストレーター用の別の App |
| 18 | owner のクラス（.github・.claude・AGENTS.md・審査の仕組み等）で ADR-0097 の「仕組みの変更も審査の App だけで通る」を改めるか | 審査の仕組みそのもの（config/dev-gate.json・scripts/review・reviewPr.js・.github/workflows）は改める。.claude・AGENTS.md は hq の分類の数を見て決める |
| 19 | dev-gate を全員に効かせるか社員だけか | 全員 |

## 9. 中身の PR（ブログ記事）を同じ道に乗せる（2026-10-20 夕の追加）

オーナーの yes（10/20 夕、hq 経由「記事を集客だけで出す道を作ってよい」、オーケストレーター経由）で、記事の PR も「作成の App → 審査の App → auto-merge」に乗せる。この節は ④ 審査の関門の画像の例外と ⑥ orchestrate の段階0 F・案Z の書き直し。② 翻訳のメタの JSON 化・寸法をビルドで作る、③ `scripts/content/check-content-pr.js`（manifest の形を含む）、⑤ ADR-0034（`GITHUB_MERGE_TOKEN` の PAT で記事の PR をマージする古い道）の廃止と PAT の失効は、別のレーンが受け持つ。§9 は system-architect の2回目の審査（P1 6件・P2 10件・P3 5件）を反映済み（§12）。

**時期**: 記事の PR が作成の App の名義で出るのは、切替（§6 の一連の作業）の後。切替までは PR の作者が rhapsody0919 で review.yml は skipped になるので（§1）、9.1 の例外も 9.2 の判定も効く PR が無い。**切替までは F の記事を案Z の束に入れない**（今の F のまま、オーケストレーターが4つのレビューを見てマージする）。

### 9.1 ④ 審査の関門に画像の狭い例外を入れる（段階2、オーナーが直接承認）

今は `scripts/lib/reviewPr.js:57-60` が、本文の無い差分（バイナリ）を消したファイル以外は全部落とす。記事の画像はバイナリなので、記事の PR は全部落ちる。

**例外を効かせる PR**: PR の変更したファイルが**全部** F の許可のパス（9.3 の 90 行目の一覧）の中にあるときだけ。コードを含む PR では、画像も今どおり落とす（claude/ の PR を全部審査するので、例外を全 PR に効かせない）。許可のパスの正本は1か所（§11.4 の `config/dev-gate.json`、master から読む）に置き、③ の機械（push の前の照合）も同じものを読む。

**例外にする画像の条件**（全部を満たすファイルだけ、本文の無い差分の理由から外す）:

| 条件 | 確かめ方（PR の head は checkout しない。API で取って読むだけ） |
|---|---|
| `status === "added"`（変更・改名・複製は対象外。`previous_filename` があれば対象外） | compare の files |
| パスが `^public/images/blog/[a-z0-9-]{1,100}\.jpg$`（webp は既存0枚なので入れない） | 正規表現。大文字・`..`・入れ子は当たらない。既存 183 枚は全部小文字の jpg |
| mode が `100644` | 今の `headModes`（head の木） |
| 大きさが 400KB（409,600 バイト）以下 | head の木の項目の `size` で先に判定し、blob は sha を木の項目から取って compare の `sha` と一致を確かめる。`GET /git/blobs/{sha}` は `encoding === "base64"`・復号した長さが `size` と同じ |
| **JPEG の印の欄（marker segment）が許可のリストだけ** | SOI から**1つ目の EOI まで全部を歩く**（プログレッシブはスキャンの間に APPn・COM を置けるので、SOS の前だけでは足りない）。スキャンの中は `FF 00` と RST0〜7 を飛ばす。埋め草の `FF` の連続は飛ばす。印の欄の長さは2以上でファイルの中に収まること。通すのは SOI、APP0（`JFIF\0` で、サムネイルが 0×0。JFXX は拒否）、APP2（`ICC_PROFILE\0` だけ）、DQT・DHT・DRI、SOF（C0・C1・C2 のどれか**1つだけ**）、SOS、RST0〜7、EOI。他（APP1 の EXIF・XMP、APP13 の Photoshop・IPTC、APP3〜15、COM、DNL・DHP・EXP、他の SOF）は全部落とす。C4（DHT）・C8・CC（DAC）を SOF と取り違えない |
| EOI がファイルのちょうど終わり、SOI と EOI が1つずつ | 1つ目の EOI の後ろに2枚目の JPEG・任意のデータを付けたものを落とす |
| 縦横の上限 | SOF の縦横が 幅 2000 以下・高さ 4000 以下、高さ 0（DNL の形）は拒否。既存の最大は幅 1200・高さ 2439 |
| 縦横が寸法の表と一致 | PR の head の `src/data/blogImageDimensions.js` を API で取り（実行しない）、画像名をエスケープして完全一致で探す。一致する行が**ちょうど1つ**で、`"/images/blog/<name>": { width: N, height: M },` の形 |
| 同じ PR で表の行を足している | 表の patch の `+` の行が、上の1行と同じ文であること（コメントに足した `+` の行で騙されない）。表の patch が省かれた（大きすぎる）ときは既存の規則で落ちる |

- 実装: 純粋関数 `jpegCheck(bytes)`・`imageException(...)` を `reviewPr.js` に足す。Node の組み込みだけ。解析の例外は落とす理由として返し、プロセスを止めない（gate が exit 1 で終わると approve の job が skipped になり、REQUEST_CHANGES も理由も残らない。review.yml:138）
- **`mechanicalRejections` は `scripts/review/gate.js:45` と `scripts/review/llm.js:113` の2か所から呼ばれる**。引数（blob・寸法の表）を足すなら両方で同じものを取って渡す。引数を省略したときは画像を落とす側（今と同じ）にする。verify に「2か所が同じ引数で呼ぶ」の検査を足す。`llm.js` の job は Environment pr-review（API キーあり）で動くので、そこで PR の画像のバイト列を解析することになる（純粋な解析で許容。ADR の追記に書く）
- `buildReviewPrompt`（`reviewPr.js:147`）で、画像は「機械で検査済みのバイナリ、本文なし」と注記する
- 再現テスト（`verify-review-workflow.js` か新しい verify）: 通るもの（ベースライン・ICC つき・プログレッシブ）、落ちるもの（EXIF・XMP・APP13・COM・JFXX のサムネイル・MPF の APP2・スキャンの間の APPn・EOI の後ろのデータ・SOF が2つ・SOF3・高さ0・長さ0/1 の印の欄・400KB 超・上限超えの縦横・拡張子と中身の不一致・改名・modified・入れ子のパス・大文字・寸法の不一致・表の行が無い／2つある・コメントの `+` だけ・symlink・コードを含む PR の画像）
- **既存の画像183枚のうち、APP1（EXIF）と APP13 が各 99 枚、APP2 の ICC が 41 枚、プログレッシブが 27 枚**（実測）。記事の画像を作る側（③ のレーン、または画像の生成の道具）で、コミットの前に許可のリストの外の印の欄を全部外す（EXIF だけを外す道具では APP13 が残って落ちる）
- 改稿で画像を差し替えると、GitHub が改名（renamed）や modified として扱い、落ちる。F の文に「画像は別の名前で足す（差し替えはオーナー）」と書く（8月以降の画像の変更は3件）
- ② で寸法の表がビルドで作られる形に変わると、PR の head に表が無くなる。そのときの照合は ② と合わせて決める（判断9）。縦横の上限はそれまでも効く
- 画像の中身（写っているもの・文字）は、LLM の審査に渡らない（判断10）。画像と他の形式を兼ねたファイル（polyglot）は ICC・DQT・スキャンの中に任意のバイトを置けるので防ぎきれない。配信は `image/jpeg` で、ブラウザは画像をスクリプトとして実行せず、使うにはコードの側に参照が要り、それは審査の LLM が見る。念のため `vercel.json` の `/images/*` に `X-Content-Type-Options: nosniff` を足す（今は無い）
- ADR-0097:31・34（バイナリは機械で落とす）への追記は、**コードと同じ PR（PR-F）**で入れる（食い違う期間を作らない）

### 9.2 中身の PR を流すときの守り

- **前提: 切替の作業より前に、作成の App の名義で中身の PR を出さない**。手順7の前は repo の secret がどのブランチの workflow からも読め、作成の App は Workflows の書き込みを持つため（system-architect の審査の P0）。§6 の順番（手順7 → 切替の一連の作業）ならこれは起きない。順番を変えて手順7の前に流すなら、PR を作る機械（③）が push の前に、変えたパスの全部（改名の元・mode・削除を含む）を 9.1 の許可のパスと照合する。関門（review.yml）での照合は push の時点の workflow を止められないので、この守りにはならない
- **束のマージは、マージする時点で判定し直す**。見るのは、PR の作者の bot の ID（`REVIEW_MAKER_BOT_ID`）、今の head SHA に審査の App の APPROVE があること、変えたパスが許可のパスの中、CI が全部緑。束を作った時点の判定を使わない
- **CI が赤でもすぐ閉じない**。空のコミットで1回だけ再実行してから決める（切替の後は Actions: write が無い。ADR-0097「影響」）
- **`--auto` を付けるのは、F の確認（下の5点目）が済んだ後のオーケストレーターだけ**。ただし作成の App は自分で `--auto` を付けられ、審査の LLM の指示文は禁止語・誇大表現を見ないので、機械では守れない。ADR-0097 の残る弱みに足す
- **古い道の `GITHUB_MERGE_TOKEN`**（ADR-0034、PR の書き込み権限のある PAT、オーナーの名義、Vercel の環境変数）は、ruleset が書き込み権限のある身元の承認を誰のものでも数えるので（ADR-0097:109）、切替の後も作成の App の PR を承認でき、審査の App を迂回できる。Claude は Vercel に届く（§6 の表）。**PAT の失効を手順8の前提条件にする**（§6 の表と判断5に入れた。ADR-0034 の状態を「廃止」にするのは ⑤ のレーン）

### 9.3 ⑥ orchestrate の段階0 F と案Z の書き直し（段階2、.claude）

`.claude/skills/orchestrate/SKILL.md` を次の5点で直す（表の4点と、下の5点目）。文案は .claude なので、オーナーが直接承認してから書く。

| 行 | 今 | 直した後 |
|---|---|---|
| 69（A） | 「別ベンダーの審査（Claude の PR は Codex。止まっているときは代わりの審査）」 | review.yml の審査も「別ベンダーの審査」に含める。ただし review.yml は **P0 が0件なら P1 が残っていても APPROVE する**（`reviewPr.js:261-270`）。A の条件は「APPROVE があり、承認の本文の指摘に P1 が無い。P1 があれば実在を確かめて直す」 |
| 90（F のパス） | `public/blog/`・`src/data/blog-posts/`・`public/images/blog/`・`src/data/blogImageDimensions.js`・`src/data/blogPostsEn.js` | `src/data/blogPostsKo.js`・`src/data/blogPostsZhTw.js` を足す（記事の翻訳のメタ。② で JSON に移るなら、移った先のパスに置き換える）。「画像は別の名前で足す（差し替えはオーナー）」を足す |
| 116（案Z の束） | 束に入れてよいのは段階0（A〜E） | A〜F。ただし F は切替の後だけ。F の束は 9.2（マージの時点の判定し直し・空のコミットで1回だけ再実行）に従う。`codex/*` には Vercel Preview が無いので（115 行目）、Codex の記事の PR のファンのレビューは discussion-panel だけ |
| 118 | 「自動マージをどの名義で行うかは未決」 | 消す（ADR-0097 v5 で決着）。書き直しは **PR-D に一本化**する（§3 の表の 118・176 行目と同じ行のため）。PR-G は 118 行目を触らない |

- 5点目（オーナー決定、10/20 19:3x、オーケストレーター経由）: F の「4つのレビューで P0・P1 が0」（91〜96行目）を変える。文案:

```
  - content-qa（`.claude/agents/content-qa.md`）・wording-editor・ファンのレビュー（boatrace-fan-reviewer か discussion-panel）・seo-marketer の4つの観点で審査する
  - P0 は4つの観点のどれで出ても止める
  - P1 は content-qa と wording-editor の分だけ止める。ファン・seo-marketer の P1 は助言として扱い、件数を PR コメントとダイジェストに記録する
  - 4つの役を別々に呼ばず、1回の審査が観点ごとに分けて結果を出す形でもよい。役と観点の表の対応は契約に固定する（どの文書に置くかは ③ のレーンと hq で決める）
  - 本文の数値を出典（DB・分析結果・公式）と照合済み
  - 止まる指摘が出たら直して、その観点の審査を回し直す
```

- PR-G（9.3）は切替の前にマージしてよい（F を束に入れるのは切替の後、と文に書くため）。PR-D（merge-pr の `--auto` 等）は切替の作業の中でマージする。別の PR

## 11. auto-merge に移る前に決めること（2026-10-20 夜の追加、オーケストレーター経由の system-architect の別の審査）

切替（手順8の3）で auto-merge を ON にすると、今はオーケストレーターのマージと Claude のフックが受け持っている判定が、効かなくなる。切替の前に、どれを機械に移すかを決める。

### 11.1 P1 が残った PR がそのまま本番に出る

- `decideAction`（`scripts/lib/reviewPr.js:254-270`）は P0 が1件以上なら REQUEST_CHANGES、それ以外は P1 が残っていても APPROVE を返す。段階0 A の「実在する P0・P1 が0件」は、今はオーケストレーターが手でマージするときにしか効いていない
- 案:

| 案 | 中身 | 良い点 | 悪い点 |
|---|---|---|---|
| **A（推奨）** | `decideAction` を「P0 は全部の PR で止める。P1 は、コードの PR では止める。F の許可のパスだけの PR（記事）では、観点が content-qa・wording の P1 だけ止める（オーナー決定 (a)）」にする。記事の PR では審査の指示文に content-qa・wording の観点を足し、指摘に観点（`viewpoint`）を付けさせる（`VERDICT_SCHEMA` に足す） | 段階0 A と F の (a) が、オーケストレーターの手を通らずに機械で効く。判定は鍵を持つ側（review.yml）にあり、作成の App が書き換えられない（master の定義で動く） | LLM が P1 を出しすぎると、レーンが止まる。同じ P1 が2回出たら直すのをやめてオーケストレーターに上げる（review-fix-cycle.md の「同じ指摘が2回」と同じ）。費用は同じ（呼ぶ回数は変わらない） |
| B | P1 は止めない（今のまま）。オーケストレーターだけが `--auto` を付ける | 変更が無い | 作成の App は自分で `--auto` を付けられる（§9.2）。P1 の残った PR が機械では止まらない |
| C | ③ の `check-content-pr.js` の結果を gate が読む | 記事の観点を Claude 側の4役で見られる | ③ の結果は作成の App の名義で書かれる（Claude が動く身元と同じ）ので、偽れる。守りにならない |

- A の場合、F の (a) の「ファン・seo-marketer の P1 は助言で件数を記録」は、審査の承認の本文に観点ごとの件数を出す形で記録する

### 11.2 審査の月の上限

- `scripts/review/gate.js:26`: `REVIEW_MONTHLY_LIMIT`（既定 300）。数えるのは作成の App が起こした review.yml の run の数で、**PR ごとではなく push ごと**に1回数える（`monthlyRunsPath`）。超えると fail closed で、全レーンの PR が承認されなくなる
- 過去30日の PR は 223 本（オーケストレーター経由の実測）。1本の PR は審査の指摘の修正等で複数回 push するので、切替の後に全レーンが乗ると run は 300 を超えうる
- 案（推奨）: 費用の守りは別ベンダーの月の上限（OpenAI 60ドル・Anthropic 30ドル、owner-steps 5）が受け持つので、run の上限は暴走の止め役に下げて扱う。`REVIEW_MONTHLY_LIMIT` を 1500 にし、80%（1200）で Slack に知らせる（gate の job に足す。鍵なしで出せる通知が無ければ approve の job で）。切替の後1か月の実測で見直す
- 上限に当たったときの手順（owner-steps の「上限に当たったとき」）に、「repo の変数を上げる（オーナー。作成の App は Variables を書けない）」を足す

### 11.3 マージ順の台帳が効かなくなる

- マージ順の台帳（`scripts/maintenance/merge-order.js`）を守っているのは、Claude の PreToolUse のフック（`guard-pr-merge.js`）だけ。auto-merge は GitHub がマージするので、フックを通らない
- 「Require branches to be up to date before merging」は、owner-steps 1-1 の手順2で意図して付けていない（PR を1本ずつ作り直す待ちになる）。付けても順番は守れない（先に up to date になった方が先に入る）
- 案（推奨）: **後に入るべき PR は draft にしておく**。auto-merge は draft をマージしない。前の PR が master に入ったら、オーケストレーター（または台帳を読む機械）が `gh pr ready` にする。`merge-order.js` に「制約の後ろ側の PR が draft でなければ知らせる」検査を足す（定期の見回り `patrol.sh` で）
- 台帳に制約がある PR は少ない（多くは制約なし）。制約の無い PR は今までどおり auto-merge

### 11.4 例外の線の正本（`config/dev-gate.json`、hq の開発の社員化 v2 の案）

- §9.1 の「許可のパス」「画像の条件」と §11.1 の「どの観点の P1 を止めるか」は、どれも審査の関門の例外の線。案は `config/dev-gate.json`（仮）に置き、gate.js・llm.js が **master の checkout（`github.sha`）から**読む。PR が書き換えても、その PR の審査には効かない（review.yml の今の守りと同じ）
- この設計と合わせる: §9.1 で「許可のパスの正本は `reviewPr.js` に1か所」と書いた所を、`config/dev-gate.json` に置き換える。`reviewPr.js` は値を引数で受ける純粋関数のままにする。③ の機械（push の前の照合）も同じファイルを読む
- `config/dev-gate.json` を変える PR は、仕組みの変更として段階2（オーナー）。verify で形（JSON Schema）を固定する
- 置き場所・名前は hq の v2 の審査と合わせて決める（判断16）

#### 中身の案（[dev-gate.draft.json](./dev-gate.draft.json)、2026-10-20 夜。hq が過去30日の PR を分類して数を出す）

- クラスは強い順に deny（承認しない・オーナーが入れる）> owner（審査は動くが承認せず、オーナーの APPROVE で入る）> orchestrate > prodWrite > content（記事、§9.1）> frontendSmall > employee。PR は、変えたファイル（改名の元・削除を含む）のうち一番強いクラスになる
- deny には、審査で出た抜けを全部入れた（DB の適用・マージ順とフック・verify の台帳・e2e の録画と fixtures・リスクの規則・送信の設定・管理画面と認証・Cron の入口・下の階層の依存の宣言・ADR と知見・承認済みのモック・機械が作る文書）。パスは全部実在を確かめた
- owner には、審査の仕組みそのもの（`config/dev-gate.json`・`scripts/review/**`・`reviewPr.js`・`.github/**`）と仕組みの変更（`.claude/**`・AGENTS.md・vercel.json・ルートの package.json 等）を入れた。**これは ADR-0097 の「CODEOWNERS は置かない。仕組みの変更も審査の App の承認だけで通る（オーナー判断）」を一部覆す**。仕組みの変更は直近30日で223本中の多数（ADR-0097 の却下した選択肢の表）なので、オーナーの承認の数が増える（判断18）
- **orchestrate のクラスは機械では区別できない**。オーケストレーターも社員も同じ作成の App の名義で、ブランチの接頭辞は作成の App が選べる。区別する身元（オーケストレーター用の別の App）を作るまでは owner と同じ扱いにする（判断17）
- prodWrite（本番を書く経路）は、手の一覧にせず、gate が master の上で毎回作る: Environment が prod-jobs・ryujin-bot・production-db・production-db-auto の job の run の行にある `scripts/**`・`api/**`（実測63本）と、vercel.json の crons の `api/cron/*.js` を入口にし、静的な import をたどった全部。審査は承認できるが、P1 も止め、10ファイル・300行を超えたら owner。PR が prod の入口のファイルに新しい import を足すと、入口のファイル自身が変わるので prodWrite に当たる（新しいファイルが閉包の外でも見逃さない）
- frontendSmall（`src/**`・`public/**`、管理画面と記事を除く）は 5ファイル・150行（テストの spec を除く）まで。超えたら orchestrate（＝今は owner）。数は hq の分類の結果で直す
- P1 はクラスを問わず止める（§11.1 案 A）。content だけは content-qa・wording の観点の P1 だけ止める

#### ADR の追記の案（番号は PR 作成時に origin/master の最大＋1）

> 審査の関門の線（dev-gate）: 作成の App の PR を、変えたパスでクラスに分ける（deny・owner・prodWrite・content・frontendSmall・employee）。線の正本は `config/dev-gate.json` で、審査（review.yml）が master の定義から読む。線を変える PR は owner のクラス。**全員（claude/・codex/・hq の社員）に効かせる**（同じ名義で、社員だけを機械で見分けられないため）。orchestrate のクラスは、オーケストレーターの別の身元ができるまで owner と同じ。ADR-0097 の「仕組みの変更も審査の App の承認だけで通る」は、owner のクラスに当たるパスについて改める。

- 全員に効かせるのを推奨（判断19）。社員だけにすると、同じ PR を claude/ の接頭辞で出せば線を外せる

## 12. 審査（system-architect、2026-10-20）の指摘と対応

| 指摘 | 重大度 | 対応 |
|---|---|---|
| `保留` を「当てない」に足すと、`pickNext` が飛ばして後ろの番号が当たる | P1 | 採用（コードで再現）。§4.2 で `pickNext` が blocked を返す形と verify を明記 |
| 切替の前は judge-all が何も判定せず、PR-A から試運転の時計は動かない | P1 | 採用（`db-apply.js:241` で再現）。§5「D' の条件」を新設、図を直した |
| Vercel の経路は Sensitive では閉じない（デプロイしたコードから読める） | P1 | 採用。§2・§6 で切替のときに Vercel CLI・MCP を外す形にし、外さない場合は ADR の残る弱みに書く |
| record の MIGRATION が `inputs.migration \|\| …` に頼る | P2 | 採用。mode で分ける（§2） |
| psql の `-c` は変数を展開しない、file-transaction の差し込みは sha がずれる | P2 | 採用。`-1 -f marker.sql -f 本体`（印が先）に変更。実機確認を PR-C の最初に置く |
| 表が無いときの抜け道が恒久になる | P2 | 採用。PR-B のファイル名に固定 |
| 手での経路に台帳の確認を足すと運用が変わる | P2 | 採用。手での経路は印の確認だけ |
| hold の `!cancelled()`・`未適用` だけを書き換える・中身の修正は新しい番号 | P2 | 採用（§4.2） |
| Environment の削除は急ぎの止め方として効かない | P2 | 採用。repo の変数 `DB_APPLY_AUTO_ENABLED` |
| PR-A' は素の INSERT だと失敗する（ラッパが off の行を作る） | P2 | 採用。UPDATE にした |
| 見張りの空振り（dispatch 成功でも run が動かない） | P2 | 採用。dispatch の関数で直近3時間の reconcile の完了を見る、Cron の死活は hq の外の見張り |
| schedule と dispatch が同じ17分 | P2 | 採用。schedule を47分にずらして予備に |
| PR-D・shim・手順8 の順番 | P2 | 採用。1回の作業で続けて行う |
| 印を信じる自己回復の弱み、表の前の手での適用 | P2 | 採用。D' の条件に入れた |
| dispatch の ref と Environment の Deployment branches | P2 | 採用。判断2に足した |
| ADR の追記 | P2 | 採用。決まった後に追記（§6） |
| （/code-review）hold が当てる前の止まり（窓の外等）も保留にする・notify が hold を拾わない・見張りが run と job を区別しない・file-transaction の代わりの案が無い・PR-A' を番号つきにすると列を塞ぐ・窓の境界が曖昧 | P1〜P3 | 採用。`attempted` の出力、notify の needs、job の結果で数える、single-transaction だけにする代わりの案、owner-prod-steps の形、FROM/UNTIL |
| （代わりの審査、Codex は未接続）切替の前の未承認の 171 が D' の後の列を止める・PR-D に e2e-rerun（Actions: write）が漏れ・cancelled を保留にしない・PR-B の例外は要らない・PR-A' の SQL の形・notify の wait と hold・BEGIN のオプション・`DB_APPLY_AUTO_ENABLED` の未設定・shim の `-R` とトークンの期限・git の credential の空のリセット行・全 worktree の `.env.local`・record の MIGRATION の書き分け | P2〜P3 | 採用（171・e2e-rerun はコードと台帳で再現）。D' の条件・判断12・PR-D の表・§6 の表に反映。「Encrypted と Sensitive の揺れ」は別の概念（Encrypted は Vercel の保存の形、Sensitive は表示の可否）なので直さない。「§6 の図で PR-B が PR-A の後」は推奨の順で、前提ではないので直さない |
| （§9 の2回目の審査）JPEG を禁止のリストで見ている（APP13 等が通る）・SOS の前だけ／末尾 FF D9 では足りない・`llm.js` の2か所目の呼び出し・review.yml の APPROVE は P1 を残しうる・切替の前は F の PR が存在しない・`GITHUB_MERGE_TOKEN` で審査を迂回できる・SOF の扱い・webp・縦横の上限・表の読み方・関門の許可のリストがどの PR に効くか・差し替えの画像・118 行目の二重・`--auto` は機械で守れない・codex の Preview・ADR の追記の時期・blob の sha・解析の例外・指示文の注記・polyglot と nosniff・ファイル名の長さ | P1〜P3 | 全部採用（APPROVE の条件 `reviewPr.js:261-270`、2か所の呼び出し `gate.js:45`・`llm.js:113`、APP13 99枚を再現）。§9 を書き直した |
| §1 の 1' の言い過ぎ、git_protocol、useHttpPath、細部（mode=wait の notify、already_applied の文、REVOKE service_role、SET LOCAL ROLE、erDiagram） | P3 | 採用（該当箇所を直した。SET LOCAL ROLE は印を先に入れることで解消） |
