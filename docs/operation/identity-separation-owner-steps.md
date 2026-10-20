# 身元の分離: オーナーの作業の手順

設計: [ADR-0097](../adr/0097-identity-separation-auto-review-and-db-apply.md)（正本は hq の drafts/identity-separation-20261019.md v5.1）。この手順書がオーナーの作業の正本。hq がオーナーに1つずつ頼む。

## 全体の決まり
- **鍵の値（秘密鍵・API キー・DB の接続文字列）は、チャット・Slack・Linear・PR に貼らない。** Claude には「登録した」「名前は ○○」だけを返す
- 作業は Claude in Chrome の入っていないブラウザ（または別プロファイル）で行う。Claude から操作できるブラウザでは行わない
- ダウンロードした秘密鍵（.pem）は、登録が済んだらすぐ消す（作成の App の鍵だけは置き場が決まるまで別扱い。3 を参照）
- リポジトリ: https://github.com/rhapsody0919/boatrace-ai-predictor

| 順 | 作業 | いつ | 時間 |
|---|---|---|---|
| 1 | ruleset とリポジトリ設定（段取り 0） | 今すぐ | 10分 |
| 2 | 審査の App を作る | 審査の PR（E）の前 | 10分 |
| 3 | 作成の App を作る | 審査の PR（E）の前 | 10分 |
| 4 | Environment を4つ作る | 4-1〜4-3 は E の前、4-4 は S の前 | 20分 |
| 5 | 別ベンダーの API キーと月の上限 | 審査の PR（E）の前 | 15分 |
| 6 | 作成の App の鍵を作り、テスト PR で承認が数えられるか確かめる | E のマージの後、トークンを出す道具ができてから | 15分（hq と） |
| 7 | repo の secret を消す | S（鍵の移し替えの PR）のマージの後 | 5分 |
| 8 | 切替 | D を本当に当てる形にする前 | 15分 |

---

## 1. ruleset とリポジトリ設定（段取り 0）

今の状態（設計時に読み取りで確認）: 承認1件・最後の push の後の承認あり・dismiss_stale なし・必須の check なし・マージは merge/squash/rebase の3つとも可・auto-merge は OFF・bypass は admin ロールと ryujin-bot（どちらも always）。

### 1-1. ruleset master-guard
Settings → Rules → Rulesets → master-guard

1. 「Require a pull request before merging」を開く
   - 「Dismiss stale pull request approvals when new commits are pushed」に印を付ける
   - 「Allowed merge methods」を **Squash だけ** にする（Merge と Rebase を外す）
   - 他（承認1件、Require approval of the most recent reviewable push）は今のまま
2. 「Require status checks to pass」に印を付け、「Add checks」で次の3つを足す。それぞれ右の欄で **GitHub Actions** を選ぶ（他の名義が同じ名前の check を出しても数えないため）
   - `verify`
   - `e2e`
   - `ml-tests`
   - 「Require branches to be up to date before merging」は **付けない**（付けると PR を1本ずつ作り直す待ちになる）
3. Bypass list は **今は触らない**（8 の切替で直す）
4. 「Save changes」
- 注: 必須の check は品質のためのもので、守りにはならない（作成の App は workflow を書き換えられるので、PR の中で check を空で通せる）。守りは審査の App の承認だけ

### 1-2. リポジトリ設定
Settings → General → Pull Requests

- 「Allow merge commits」と「Allow rebase merging」の印を外し、「Allow squash merging」だけ残す
- 「Allow auto-merge」は **まだ OFF のまま**（8 の切替で ON）

### 1-3. 確かめ方
- Claude に「1 が済んだ」と返す。Claude が読み取りで ruleset とリポジトリ設定を確かめる
- 戻し方: 同じ画面で印を戻す

---

## 2. 審査の App（ryujin-reviewer）を作る

Settings（右上のアイコン → Settings）→ Developer settings → GitHub Apps → New GitHub App

| 項目 | 値 |
|---|---|
| GitHub App name | `ryujin-reviewer`（使われていれば末尾に文字を足す。決めた名前を Claude に返す） |
| Homepage URL | `https://github.com/rhapsody0919/boatrace-ai-predictor` |
| Webhook | 「Active」の印を外す |
| Repository permissions | **Pull requests: Read and write**、**Contents: Read-only**（Metadata: Read-only は自動で付く）。他は全部 No access |
| Organization・Account permissions | 全部 No access |
| Where can this GitHub App be installed? | Only on this account |

1. 「Create GitHub App」
2. 出た画面の **App ID**（数字）を控える（秘密ではない。Claude に返してよい）
3. 下の「Private keys」→「Generate a private key」→ .pem がダウンロードされる。**4 で Environment pr-review に登録したらすぐ消す**
4. 左の「Install App」→ 自分のアカウントの「Install」→「Only select repositories」→ boatrace-ai-predictor だけ → Install

注: Contents: Read-only の App の承認が、必須の承認1件に数えられるかは公式に書かれていない。6 のテストで数えられなければ Contents: Read and write に上げる（App の設定 → Permissions & events。変えた後、インストール先で「Accept new permissions」が要る）。

---

## 3. 作成の App（ryujin-maker）を作る

同じ手順で New GitHub App。

| 項目 | 値 |
|---|---|
| GitHub App name | `ryujin-maker` |
| Homepage URL | 同上 |
| Webhook | 「Active」の印を外す |
| Repository permissions | **Contents: Read and write**、**Pull requests: Read and write**、**Workflows: Read and write**、**Checks: Read-only**、**Commit statuses: Read-only**、**Actions: Read-only**（CI の結果を読むため）。他は全部 No access。**Administration・Environments・Secrets・Variables・Deployments は付けない** |
| Where can this GitHub App be installed? | Only on this account |

1. 「Create GitHub App」→ App ID を控える
2. インストールは boatrace-ai-predictor だけ（2 の 4 と同じ）
3. 秘密鍵は **まだ作らない**。トークンを出す道具（秘密鍵から1時間のトークンを作るスクリプト。hq が作り、秘密鍵は Keychain に置く）ができてから、6 で作る

Workflows: write を付ける理由: CODEOWNERS を置かないので、workflow を変える PR も作成の App が作り、審査の App が承認する（v5 §0）。
この権限があると、ブランチに workflow を足すだけで repo の secret を読める。そのため 7 で repo の secret を消すまでは、作成の App の鍵を Claude に渡さない（6 のテスト PR は hq が出す）。

Actions: write は付けない。付けると workflow の手動起動・取り消し・ログの削除まで届く。切替の後に CI をやり直すときは、空のコミットを足す（審査がもう1回走る。1回 0.1〜0.2ドル）。

---

## 4. Environment を4つ作る

Settings → Environments → New environment。4つとも「Deployment branches and tags」は **Selected branches and tags** にし、「Add deployment branch or tag rule」で **Ref type: Branch**、名前 `master` を足す（Tag にしない。`master` という名のタグで通ってしまう）。「Required reviewers」は **付けない**（付けると審査・自動の適用が人の承認を待つ）。

### 4-1. pr-review（審査の鍵）
| 種類 | 名前 | 値 |
|---|---|---|
| Variable | `REVIEWER_APP_ID` | 2 の App ID |
| Secret | `REVIEWER_APP_PRIVATE_KEY` | 2 の .pem の中身全体（`-----BEGIN` から `END … -----` まで）。登録したら .pem を消す |
| Secret | `OPENAI_API_KEY` | 5 で作るキー |
| Secret | `ANTHROPIC_API_KEY` | 5 で作るキー |
| Variable | `REVIEW_OPENAI_MODEL` | Claude の PR の審査に使う OpenAI のモデル名（5-1 で使えるものを選ぶ。空だと審査が失敗して承認されない） |
| Variable | `REVIEW_ANTHROPIC_MODEL` | 任意。空なら `claude-opus-5` |

### 4-1b. repo の変数（Environment の外。Settings → Secrets and variables → Actions → Variables → Repository variables）
| 名前 | 値 |
|---|---|
| `REVIEW_MAKER_BOT_ID` | 作成の App の bot ユーザーの数値の ID。ブラウザで `https://api.github.com/users/ryujin-maker%5Bbot%5D` を開き、`"id"` の数字（App の名前を変えたら、その名前に読み替える）。審査の workflow は、この ID の PR だけを見る |
| `REVIEWER_BOT_USER_ID` | 審査の App の bot ユーザーの数値の ID（同じく `https://api.github.com/users/ryujin-reviewer%5Bbot%5D`）。本番 SQL の突き合わせが、この ID の承認だけを数える |
| `REVIEW_MONTHLY_LIMIT` | 任意。月に審査する上限の回数（既定300） |

どれも秘密ではない。ただし変えられるのは admin だけにしておく（作成の App には Variables の権限を付けない）

### 4-2. production-db-auto（軽い SQL の自動の適用）

**先に Environments の一覧に `production-db-auto` が既に無いかを見る。** GitHub は、workflow が参照した名前の Environment が無いと、保護なし（どのブランチからも使える）で自動で作る。既にあれば、「Deployment branches and tags」が Ref type: Branch・`master` だけになっているかを必ず見て、なっていなければ消して作り直してから鍵を入れる（他の Environment も同じ）

| 種類 | 名前 | 値 |
|---|---|---|
| Secret | `SUPABASE_DB_URL` | 既存の Environment production-db と同じ接続文字列。Environment の secret は後から読めないので、Supabase の画面（Project Settings → Database → Connection string）から取り直す |

- 鍵を回すときは production-db と production-db-auto の **2か所** を直す
- 既存の production-db（Required reviewers＝オーナー）は今のまま

### 4-3. db-readonly（審査の材料。claude_ro）
| 種類 | 名前 | 値 |
|---|---|---|
| Secret | `CLAUDE_RO_DB_URL` | claude_ro の接続文字列（SQL 166 で作ったロール。手元の .env.local に入れたものと同じ） |

- repo の Secrets（Environment の外）には置かない。pull_request_target の全 job から読めてしまうため
- claude_ro の接続は2本までで、手元の ro-query.js と取り合う

### 4-4. prod-jobs（定期実行の書き込みの鍵。S の前）
今 repo の secret（Environment の外）にある鍵を、master だけの Environment に移す。repo の secret は、どのブランチの workflow からも読めるため（作成の App に Workflows: write を付けると、審査を通らずに本番へ書ける）。

1. 次の名前で、repo の Secrets（Settings → Secrets and variables → Actions → Repository secrets）と同じ値を `prod-jobs` に入れる。値は元の画面（Supabase・Slack・Vercel・Linear・Google Cloud）から取り直す
   - `SUPABASE_URL`・`SUPABASE_SERVICE_KEY`・`SLACK_WEBHOOK_URL`・`VERCEL_DEPLOY_HOOK`・`LINEAR_API_KEY`・`LINEAR_TEAM_ID`・`GOOGLE_SERVICE_ACCOUNT_KEY`・`SEARCH_CONSOLE_SITE_URL`
2. 既にある Environment `ryujin-bot` にも、次の6つを同じ値で入れる。master に自動でコミットする11の job（scrape・train・sitemap 等）は Environment `ryujin-bot` を使っていて、job に置ける Environment は1つだけのため
   - `SUPABASE_URL`・`SUPABASE_SERVICE_KEY`・`SLACK_WEBHOOK_URL`・`VERCEL_DEPLOY_HOOK`・`GOOGLE_SERVICE_ACCOUNT_KEY`・`SEARCH_CONSOLE_SITE_URL`
   - あわせて `ryujin-bot` の「Deployment branches and tags」が Ref type: Branch・`master` だけになっていることを見る
3. PR の通知専用の Slack webhook を作り（Slack の Incoming Webhooks で、PR の通知を流すチャンネル宛てに新しく作る。本番の通知の webhook とは別のもの）、**repo の secret**（Repository secrets）に `SLACK_PR_WEBHOOK_URL` として入れる。PR が作られたときの通知（slack-notify-pr）は pull_request で動き、Environment を使えないため。漏れても、そのチャンネルに投稿されるだけ
4. repo の secret は **まだ消さない**（7 で消す。先に消すと定期実行が止まる）
- 鍵を回すときは、repo の secret が消えた後は `prod-jobs` と `ryujin-bot` の2か所（DB の接続文字列は `production-db` と `production-db-auto` の2か所）を直す

### 確かめ方
Claude に「4 が済んだ。名前は〜」と返す。Claude は Environment の画面を操作しない（フックで止めている）。値が正しいかは、E・D の PR のテスト（試運転）で分かる。

---

## 5. 別ベンダーの API キーと月の上限

審査は、Claude が作った PR を OpenAI で、Codex が作った PR を Anthropic で見る。見込みは1件 0.1〜0.2ドル、月300件で 30〜60ドル（推測）。

### 5-1. OpenAI（Claude の PR の審査）
1. platform.openai.com → Projects → Create project → 名前 `ryujin-review`
2. そのプロジェクトの Limits で月の上限（推奨 **60ドル**）と通知（推奨 40ドル）を置く
3. そのプロジェクトで API key を作る（権限は Restricted にできれば Model capabilities の書き込みだけ）
4. 4-1 の `OPENAI_API_KEY` に登録。画面を閉じたら値は残さない

### 5-2. Anthropic（Codex の PR の審査）
1. console.anthropic.com → Settings → Workspaces → 新しい workspace `ryujin-review`
2. その workspace の Limits で月の上限（推奨 **30ドル**）を置く
3. その workspace で API key を作る
4. 4-1 の `ANTHROPIC_API_KEY` に登録

### 上限に当たったとき
OpenAI のプロジェクトの上限は、通知だけで止まらないことがある（未確認）。本当の上限は、審査の側で月の件数を数えて止める仕組み（E で入れる）。
審査の Actions は API の失敗で承認を出さない（自動マージされず待ちになる）。審査の側でも月の件数を数え、超えたら止めて通知する（E で入れる）。上限を上げるか待つかはオーナーが決める。

### 1 run の usage の読み方（hq、plan.md §10.7）
review.yml の llm の job は、終わるとき（失敗も含む）にログへ `::notice title=review-usage::{JSON}` を1行出す（`scripts/review/usage.js`）。check run の annotation として残る。JSON のキーは `v`・`run_id`・`attempt`・`pr`・`head_sha`・`vendor`・`model_req`・`model`・`at`・`in`・`out`・`cached_in`・`cache_write`・`reasoning`・`http`・`outcome`・`p0`・`p1`。トークンは形が違えば null、`outcome` は `ok`・`unreadable`・`incomplete`・`refused`・`http`・`timeout`・`mechanical`・`error` のどれか。

作成の App は自分のブランチの workflow で同じ名前の job と notice を出せるので、`/commits/{sha}/check-runs` を job 名で引かない。master の review.yml の run から辿る。

1. `gh api --paginate 'repos/rhapsody0919/boatrace-ai-predictor/actions/workflows/review.yml/runs?event=pull_request_target&created=<JST の1日の範囲>&per_page=100'` で run を集め、各 run の `path == ".github/workflows/review.yml"` を確かめる（1日ずつ引く。runs の API は 2500 件で頭打ち、§10.2）
2. **base が master の PR の run だけを数える**。pull_request_target は PR の base のブランチにある workflow で動くので、作成の App が自分のブランチの review.yml を書き換え、そのブランチを base にした PR を開くと、1 の条件を全部通る偽の行を出せる（承認には効かず、集計だけが狂う）。行の `pr` で `gh api 'repos/rhapsody0919/boatrace-ai-predictor/pulls/{pr}'` を引き、`base.ref == "master"` と、run の `head_sha` が行の `head_sha` と同じことを確かめる
3. `gh api 'repos/rhapsody0919/boatrace-ai-predictor/actions/runs/{run_id}/jobs?filter=all'` で `name == "llm"` の job を取り、その `check_run_url` から check run の id を取る（`filter=all` で再実行の前の試行も入る）
4. `gh api 'repos/rhapsody0919/boatrace-ai-predictor/check-runs/{check_run_id}/annotations'` の `title == "review-usage"` の `message` を JSON として読み、`v == 1` を確かめる
5. 単価を掛けて日ごとに合計し、hq の手元（`ledger/costs.jsonl`）に貯める。annotation の保持は run と同じ（既定90日）
   - トークンの意味はベンダーで違う。**OpenAI は内訳**: `in` は `cached_in` を含み、`out` は `reasoning` を含む（通常の入力の単価は `in − cached_in` に掛ける）。**Anthropic は別建て**: `in` はキャッシュの読み書きを含まないので、`in`・`cached_in`・`cache_write` をそれぞれの単価で足す
   - `p1` は答えを上限（30件）で切った後の数（`p0` は切る前の数）
- llm の job に行が無いときは「usage 不明」として別に数える（課金はされうる）。新しい push での取り消し（`conclusion == "cancelled"`）のほか、`timeout-minutes` の打ち切りや runner の停止でも、プロセスが exit の処理を通らず行が出ない
- llm が skipped（関門で落ちた）の run は LLM を呼んでいない

---

## 6. 作成の App の鍵とテスト PR（E のマージの後、hq と）

前提: トークンを出す道具ができている。

1. 作成の App の設定 → Private keys → Generate a private key。.pem は道具の置き場（hq の手順）に置き、他の場所の写しは消す
2. hq が道具で、作成の App の名義のテスト PR を1本出す（7 が済むまで Claude には鍵を渡さない）
3. 審査の Actions が APPROVE を付けた後、PR の画面で承認1件として数えられているかを見る
4. テスト PR に1コミット足し、古い承認が外れることを見る。審査がすぐ承認し直すので画面では分かりにくい。Claude が API（PR の reviews）で古い承認が DISMISSED になったかを読む
5. ラベルを付けられるかも一緒に見る（`gh pr create --label`）。通らなければ作成の App に Issues: Read and write を足す
6. テスト PR はマージせずに閉じる
7. 承認が数えられなければ、2 の注のとおり審査の App を Contents: Read and write に上げて、もう一度

---

## 7. repo の secret を消す（S のマージの後）

1. S の PR（鍵を使う job に `environment: prod-jobs` を足すもの）がマージされ、次の定期実行が緑で動いたことを Claude が確かめる
2. Settings → Secrets and variables → Actions → Repository secrets から、4-4 で移した8つを消す。残すのは `VITE_SUPABASE_URL`・`VITE_SUPABASE_ANON_KEY`（anon、公開してよい値）だけ
   - 残す repo の secret は、ほかに `SLACK_PR_WEBHOOK_URL`（PR の通知専用）
3. Claude が翌朝、定期実行が全部緑かを確かめる。落ちたものがあれば、その job の environment の付け忘れ
- 戻し方: 消した secret を repo に入れ直す

---

## 8. 切替（D を本当に当てる形にする前）

### 前提（全部そろってから）
- 6 で承認が数えられると確かめた
- 7 で repo の secret が anon だけになった
- E の審査が数日止まらずに動いている
- **hq の push の身元が決まり、動いている**（Claude の gh から rhapsody0919 を外すと、同じユーザーの hq・他のプロジェクトの push も止まる。作成の App は龍神にしか入れないため）
- **作者が rhapsody0919・tinaba96 の開いている PR が無い**（マージするか、作成の App で出し直す。審査は作成の App の PR しか見ないので、admin の bypass を外すとマージできなくなる）
- 切替の前に、Claude が rhapsody0919 のまま ruleset・リポジトリ設定を読み、今の状態を控えておく（切替の後の App では bypass の一覧などが読めない見込み）

### 手順
1. **Claude の gh を作成の App にする**: hq の手順で、Claude の gh と git push が道具のトークンを使う形にする。Claude の gh から rhapsody0919（admin）を外す。確かめは、テスト PR の作者が `ryujin-maker[bot]` になること（インストールのトークンでは `gh api user` は通らない）
2. **bypass を直す**: Settings → Rules → Rulesets → master-guard → Bypass list
   - 「Repository admin」ロールを **外す**（v5 §0）
   - **ryujin-bot は always のまま残す**。v5 §0 は「pull_request モード」としているが、そうすると db-apply の台帳の記録・機械生成の文書・sitemap・録画の撮り直し・学習の結果など11本の workflow の master への直接の push が全部止まる。ryujin-bot の鍵は master だけの Environment にあり、審査を通った workflow からしか使えない
3. **auto-merge を ON**: Settings → General → Pull Requests →「Allow auto-merge」に印
4. オーナーの画面で 2・3 の状態を見る。Claude はテスト PR が審査→承認→auto-merge まで通るかを見る

### 切替の後の決まり
- オーナーが自分で書いた PR は、自分で承認できず審査も見ないので、マージするときは ruleset を一時 Disabled にして戻す
- 急ぎで止めたいときも ruleset を Disabled にする

### 戻し方（逆の順）
1. 「Allow auto-merge」の印を外す
2. Bypass list に「Repository admin」（always）を足し直す
3. Claude の gh を rhapsody0919 に戻す（オーナーが Claude の動くユーザーで `gh auth login`）。作成の App の秘密鍵は App の設定画面で消す
- 戻しても、自動の適用（D）は審査の App の承認が無い PR のファイルを当てないので、止まるだけで壊れない

---

## Claude に返すもの（値は返さない）
- 1: 済んだ
- 2・3: App の名前と App ID
- 4: Environment の名前と、入れた Secret・Variable の名前
- 5: 上限の金額
- 6〜8: 済んだ
