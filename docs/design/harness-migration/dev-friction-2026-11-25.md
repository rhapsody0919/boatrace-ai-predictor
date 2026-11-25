# 今日の損に効く4つのハーネス（2026-11-25、窓口の依頼。system-architect の審査「直せば推す」を直した版）

結論: 4つとも今日実際に出た損から作る。
- (3) マージ済みの枝への push を止める: #3430（審査の P1・P2 を直した）
- (1a) APPLIED.md に行を足さない: ADR-0097 の追記と、自動適用の点4の変更が先に要る
- (1b) 新しい verify は台帳に行を足さない: 「未登録の verify は既定で ci」にする（頭の注釈の案はやめた）
- (2) 進捗の1枚と hook: 既存の編集の数え（session-progress.js）に寄せる
- (4) 壁の時計の verify: 静的に禁じる案はやめ、時計をずらして新しい verify をもう2回回す

(3) の後は全部、守りの検査・判定器・`.claude`・ADR・AGENTS.md を変えるので、マージはオーナー。

- 目的（窓口 11/25、オーナー「他のリポジトリの構成を参考に開発の効率を上げる。今日の損に効く物だけ」）: 作り直し・読み直し・赤の master を減らす
- 言われた案が最短か: (1) の「ファイル名の決まりから自動で拾う」は、注釈の tier が守りの外になる（下の 1b）。「未登録は既定で ci」が最短で守りも崩れない。APPLIED.md は「1マイグレーション1ファイル」より「PR では行を足さず db-apply が足す」が最短。ただし自動適用の点4の変更が要る
- 同じ原因で直す物: 今日の作り直しの根は2つあった。(a) 台帳の同じ所への行の追加（#3410・#3380・#3402）(b) 重ねた枝を squash した後に master を取り込んで衝突（#3396〜#3398、#3416〜#3418 の本文）。(b) は 1a・1b では消えない。窓口の決まり（owner-session）に「対話のセッションの PR は重ねず base=master」を1行足す（11/24 の記録 #13 と同じ型。.claude なのでオーナー）

## 0. 今日の損

| 型 | 今日の例 | 損 |
|---|---|---|
| 台帳の衝突で作り直し | verify-registry.json: #3410。APPLIED.md: #3380・#3402（record の [automated] の commit が番号 N の行を書き換え、並走の PR が N+1 の行を隣に足す） | 作り直し（AGENTS.md は衝突したら `-v2` で作り直す） |
| 重ねた枝の squash の後の衝突 | #3396〜#3398 | 作り直し3本 |
| 子の報告の読み直し | 窓口が子の先頭400字の通知から状況を組み直す | 窓口の手番と文脈（11/24 の記録 #7・#9・#10） |
| マージ済みの枝への push | #3377 | 直しが master に入らず消える |
| 壁の時計の verify | #3424 の verify-site-feedback-hourly.js が毎時0〜10分に落ち、master を赤にした（直しは #3428） | master の赤＝定時の release が止まる型（ADR-0106） |

#3385（TrendChart.jsx の衝突）・#3391・#3403 の衝突した所は確かめていない。

## 1. 共通の1ファイルに行を足す衝突をなくす

### 1a. APPLIED.md

```
今:  マイグレーションの PR が表の末尾に「未適用」の行を足す
     → db-apply の record が番号 N の行を書き換える [automated] の commit と、N+1 の行の追加が隣り合って衝突
後:  PR は APPLIED.md を変えない。行が無い＝未適用とみなす。db-apply の record が適用したときに行を足す（今もそう動く、dbApplySql.js:219〜）
```

先に要る物（審査 P1）:
- 自動適用（reconcile）の5点の検査の4は「台帳で『未適用』で始まり、その行が同じ commit で足されている」を求める（scripts/lib/dbReconcile.js:111-125、ADR-0097:61）。`pickNext` は行の無いファイルも未処理に数える（dbReconcile.js:181-183）。点4を変えないと、新しい番号は全部 blocked になる。番号の順なので後ろも止まる（今は DB_APPLY_DRY_RUN で知らせだけ。外すと全部止まる）
- ADR-0097 に追記する: 点4を「行が無い、または同じ commit で足した未適用の行」にする
- 手で先に当てたマイグレーションの書き忘れを防ぐ決まりは残す（審査 P1）。先に当てた物だけは「適用済み」の行を必須にする（verify-migration-numbers.js の3の例外と同じ扱い）。行が無い＝未適用にすると、書き忘れた物を reconcile がもう一度当てうるため
- record が足す行は、内容の欄が定型文になる（dbApplySql.js:241）。人が読む要約は SQL の頭の注釈に置く、と APPLIED.md の運用ルールに書く

変える物: ADR-0097（追記）・scripts/lib/dbReconcile.js・verify-db-reconcile.js（期待の変更）・verify-migration-numbers.js（4）・APPLIED.md の運用ルール、あとで docs/knowledge/db-operations.md:69・docs/operation/db-apply.md:174。`scripts/lib/dbApplySql.js`・`scripts/db/**` は変えない。
変えずに済む読み手（審査で確かめた）: schemaSnapshot.js・session-start-check.js（「適用済み」の行だけを見る）、verify-rpc-output-keys.js（警告だけ）、verify-boatcast-job.js・verify-pit-report-job.js（既存の行だけ）、verify-db-apply.js。

### 1b. verify-registry.json

```
今:  新しい verify ごとに verify-registry.json（2,291行、名前の順）に5行足す。未登録は run-verify-registry.js が失敗にする
後:  未登録の verify-*.js は既定で tier=ci として回す。行を足すのは manual・args・timeoutSec・runner が要る物だけ（今それを持つのは約17本）
     guards の1行は run-verify-registry.js --list が頭の注釈の1行目から出す
```

- 頭の注釈で tier を書く案はやめた（審査 P1）。guard_weakening は注釈だけの変更を同じ AST とみなして通し（verify_guard.py:1466-1469）、pr-path-rules の weaken は registry の行だけを見る（config/pr-path-rules.json:90）。そのため注釈の ci を manual に書き換える PR が機械で通ってしまう
- 「既定で ci」は厳しい側に倒れる（分類が漏れても CI で回る）。manual に下げる道は今の JSON の行だけなので、guard_weakening・pr-lane は変えずに済む
- 変える物: ADR-0072 の追記（台帳は1つの決まり §1 への例外）・AGENTS.md の PR の決まり「未登録だと verify:ci が落ちる」と安全の4の台帳の1文・run-verify-registry.js（未登録の扱いと --list）・run-verify-pr.js（同じく既定 ci）・検査
- 選ばなかった案:
  - 頭の注釈（上の P1）
  - `.gitattributes` の `merge=union`: APPLIED.md では record が書き換えた行の旧と新が両方残り、JSON ではカンマが壊れうる
  - 1 verify 1 JSON: 読み手を全部直す
  - 生成物にする: PR の間は新しい verify が未登録になる

## 2. 作業ごとの進捗の一枚と hook

目的: 窓口が子の400字の通知から状況を組み直す手間を減らす。子が進捗の1枚を持ち、窓口は枝の名でそれを読む。

### 置き場

| 案 | 利点 | 欠点 |
|---|---|---|
| **A. リポジトリの外 `~/.config/ryujin/progress/<枝の名>.md`（推す）** | commit・PR の大きさ・docs と src の混ぜに当たらない。公開されない。worktree を消しても残る | 同じ親の下に鍵（ryujin-maker.pem）がある。許可は `progress/**` だけに絞る。作業場所の外への Write で毎回確認が出るかは未検証 |
| B. 枝の `docs/design/<slug>/PROGRESS.md` | PR で見える | 安全の5（src と docs を混ぜない）に当たる。進捗の更新ごとに commit。マージで古い進捗が master に残る |
| C. アプリの共有ノートの置き場 | 窓口が既に読む | hook から置き場のパスが分からない |

- 枝の名の `/` はファイルの名では `__` にする
- `-v2` で作り直したら、新しい1枚の頭に旧い枝の名を書く（続きを切らない）

### hook の動き

- SessionStart（`session-start-branch-check.sh` と並べて別に登録）: `claude/` の枝の worktree の対話のセッションだけ。進捗の1枚があれば 8000 バイトまで additionalContext で渡し、無ければ置き場とひな形の見出しを1行で知らせる
- Stop: `stop_hook_active` が true なら通す（**止めるのは1回だけ**）。「変えたか」は transcript を読まず、既存の `.claude/session-state/<session_id>.json`（track-session-progress.sh → session-progress.js の編集の数え）を使う。比べる時刻は「最後に変えた時刻」（Stop は毎ターン走るので、始めの時刻と比べると1回更新した後は止まらなくなる。審査 P2）。最後に変えた時刻が進捗の1枚より新しいときだけ止める。**読んで答えただけのセッションは止めない**。状態が「完了」の1枚は見ない
- 使い捨ての作り手（`claude -p`）は外す（対話でないので止めても誰も直さない）
- 見逃す物（止めない側なので許す）: Bash だけの書き換え（sed -i・python）、「完了」にした後の作業
- ひな形の見出し: 状態（調査中・実行中・待ち・完了）・待ち（誰の何を）・枝と PR・ゴール・完了の条件（[x] と根拠）・分かったこと・次にやること・判断の記録（日付つき）
- 窓口の決まり（owner-session に1行）: 子の通知が切れていたら、進捗の1枚を枝の名で読む

## 3. マージ済みの PR の枝への push を止める（#3430）

- `ryujin-maker-token.js -- git push` の前に、push する先の枝の PR を `GET /pulls?head=rhapsody0919:<枝>&state=all` で読む
- マージ済みの PR があり、**同じ名で開いた PR が無いとき**だけ止める（審査 P1。名前の使い回し）
- 消す push・`--all`・`--mirror`・`--tags` は確かめない。読めなければ警告だけで通す
- 残る穴（審査 P2）: 素の `git push` も `claude/` の枝なら hook が通す（guard-deploy-approval.sh:56-70）。全部の道を塞ぐなら同じ確かめを hook に置く（`.claude`、後の PR）。上流の名前が今の枝と違う push は今の枝の名で見る
- マージ: ryujin-maker-token.js は鍵とトークンを扱う道具なので、オーナー

## 4. 壁の時計に頼る verify を止める

- 静的に禁じる案はやめた（審査 P1）。#3424 を直した後の verify-site-feedback-hourly.js も、製品のトリガーが created_at を now() に上書きするため now() を使い続けている（固定の時刻を渡す手が無い）。11/1 以降に足された verify 117本のうち15本が当たり、正しい使い方も含む
- 代わりに動かして確かめる: guard_weakening は新しい verify を既に1回回している（verify_guard.py:1455）。時計をずらして、正時の直前（HH:59:58）と JST の日付の変わり目の直前でもう2回回し、落ちたら「時刻の区切りで落ちる」と出す
- 先に確かめること: PGlite の now() が、ずらした JS の時計（例: faketime・`TZ` と Date の差し替え）に従うか。従わなければ、SQL の now() の型は動的にも捕まえられず、落とし穴の1行だけになる
- AGENTS.md の落とし穴に1行: 「時刻の区切りをまたぐ確かめは、区切りに依る確かめの後に置く。時刻は固定の値を渡せるなら渡す（#3424・#3428）」
- マージ: guard_weakening は判定器（H1）なのでオーナー

## 5. PR の列

| 順 | PR | 変えるファイル | マージ |
|---|---|---|---|
| 0 | この設計 | docs/design/harness-migration/dev-friction-2026-11-25.md | 窓口 |
| 1 | マージ済みの枝への push を止める（**#3430**） | ryujin-maker-push-guard.js（新）・ryujin-maker-token.js・verify と場面 | オーナー（鍵の道具） |
| 2a | ADR-0097 の追記（点4） | docs/adr/0097 | オーナー |
| 2b | APPLIED.md に行を足さない | dbReconcile.js・verify-db-reconcile.js・verify-migration-numbers.js・APPLIED.md | オーナー（検査の緩め・docs/db-migration は CODEOWNERS） |
| 3a | ADR-0072 の追記と AGENTS.md の台帳の文 | docs/adr/0072・AGENTS.md | オーナー |
| 3b | 未登録の verify は既定で ci | run-verify-registry.js・run-verify-pr.js・検査 | オーナー（run-verify-registry.js） |
| 4 | 進捗の1枚と hook | .claude/hooks・.claude/settings.json・scripts/maintenance/session-progress*.js・検査・owner-session の2行（進捗の読み方・PR を重ねない） | オーナー（.claude）。他の `.claude` の PR と同じ日に重ねない |
| 5 | 時計をずらした2回の確かめ | guard_weakening/verify_guard.py・その試験 | オーナー（判定器）。先に PGlite の now() の確かめ |
| 6 | AGENTS.md の落とし穴に1行 | AGENTS.md | オーナー。3a と1つにしてよい |

2a→2b、3a→3b の順。2・3・4・5 は互いに独立。知見の文書（db-operations.md:69 の直し）は 2b の後の docs の PR。

## 6. 誤りなら原因は何か

| 主張 | 誤りなら | 潰せたか |
|---|---|---|
| 行が無い＝未適用でよい | 手で先に当てて書き忘れた物を reconcile がもう一度当てる | 先に当てた物は「適用済み」の行を必須に残す。決まりと試験で狭めるだけ |
| 未登録は既定で ci にすれば衝突が消える | 新しい verify が args・timeoutSec を要る | その物だけ JSON に行を足す（まれ） |
| push の前に MERGED を見れば #3377 の型が止まる | 素の git push・push の後のマージ | 前者は hook の後の PR、後者は止められない |
| 進捗の1枚で窓口の読み直しが減る | 子が中身の薄い1枚を書く | hook は中身を見ない。減ったかは使って数える |
| 時計をずらせば #3424 の型を捕まえられる | PGlite の now() がずらした時計に従わない | 先に確かめる。従わなければ落とし穴の1行だけ |

## 7. 範囲の外で気づいたこと（持ち主へ）

- APPLIED.md の表を割る関数が4つあり、判定が揃っていない。`isAppliedInLedger`（dbApplySql.js:209）は includes なので「未適用（…適用済み…）」を適用済みと読む。ledgerState・ledgerStatusOf は startsWith（守りの本体 (a) の中。持ち主は窓口）
- guard_weakening の `ALLOWED_WINDOW_RE`（`.css` と locales だけ許す字の窓）が今日の「css の誤検出」2回の元かは見ていない（未検証）
