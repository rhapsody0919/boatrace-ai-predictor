# sns-hub の Codex パッチ取り込み（引き継ぎ）

Codex（OpenAI、`~/ryujin-codex-dev`）が手元の複製で実装した sns-hub 改修のパッチを、hq 経由で受け取り、このリポジトリに取り込んで PR にするレーンの引き継ぎ。2026-10-08 に、前のセッションが3件（#1302・#1315・#1316）を処理した時点の状態をまとめる。

## 誰が何をするか

| 役割 | セッション | 内容 |
|---|---|---|
| hq | 「state.mdと約束の台帳の続行」 | Codex への依頼、開発の補助による点検、パッチの受け渡し |
| オーケストレーター | 「Orchestrate」（/orchestrate） | マージ判断、本番 SQL のユーザーへの受け渡しと読み取り確認 |
| このレーン | 取り込み担当 | `git am` で取り込み、レビュー、PR、runbook |

- パッチ: `~/ryujin-codex-dev/out/patches/<名前>/`（各フォルダの README に基準と適用順）
- Codex の報告: `~/ryujin-codex-dev/out/reports/`
- 開発の補助の点検: `~/ryujin-dev-assist/out/reports/`
- マージはオーケストレーターかユーザー。本番 SQL の適用はユーザー（このレーンは SQL と runbook を用意するだけ）

## 取り込みの手順

1. `git fetch origin master` → パッチ1件につき `feature/sns-hub-*` を `origin/master` から切る
2. パッチ冒頭の `From <commit>` が、報告に書かれたコミットと一致するか確かめる
3. `git am --3way <パッチ>`。衝突は手で直す。**正規表現の一括置換で衝突マーカーを消さない**（#1302 で台帳の行を1行巻き込んで消した）。直したら `git diff origin/master -- <ファイル>` で、追加した行だけになっているか確かめる
4. `npm run verify:ci` を**全件**回す（下の「毎回引っかかる点」）。`npm run build`、変更ファイルの eslint
5. Codex が「ブラウザが起動できず未検証」と書いた UI テストは、手元で実際に走らせる（#1316 では7件とも、テスト用の仕組みの不具合で落ちる状態だった）
6. Codex は品質ゲート台帳の変更を禁止されているので、テストが CI から呼ばれない場所に置かれていることがある。`scripts/maintenance/verify-*.js` に移し、`scripts/maintenance/verify-registry.json` に登録する
7. 本番 DB の変更があれば、`docs/db-migration/{番号}-runbook.md` を作る。SQL 本体はファイルから機械的に写し、`diff` で一致を確かめる。冒頭に既存の表・トリガーへの影響、マージとの順序を書く（例: `135-runbook.md`・`136-runbook.md`・`137-runbook.md`）。`APPLIED.md` の行から runbook を参照する
8. このレーンの `/code-review` を回し、結果を PR コメントに書く（衝突解消が正しいか、既にマージ済みの PR との整合も見る）
9. PR 本文に「あなたが確認すること／私が確認済みのこと」。Auto-fix を有効にする。オーケストレーターと hq に報告

鍵・認証・費用・本番 DB に当たるパッチは、着手前にオーケストレーターへモデルの格上げを申告する。鍵の値・Basic 認証の資格情報は、出力にもログにも出さない（ヘッダー経由のみ）。

## CI で毎回引っかかる点

| 検査 | 起きること | 直し方 |
|---|---|---|
| `verify-relative-imports` | Vite の build は `api/` を束ねないので、build が通っても api の import 先が存在しないことがある（#1316 で緊急停止 API が本番で読み込めない状態だった） | パスを直す。モジュールを `node` で読み込んで確かめる |
| `verify-migration-rls` | `REVOKE`/`GRANT` の1文に複数の関数を並べると、2番目以降を読めず「権限未設定」になる | 1関数1文に分ける |
| `verify-query-errors` | 画面の `setError(e.message)`（BOA-668） | `errorMessageOf(e)`（`src/utils/errorMessage.js`） |
| `verify-e2e-recorded-network` | 専用サーバーで走る spec が `@playwright/test` の `test` や `route.continue()` を使う | 127.0.0.1 以外を abort し `/api/*` を全てモックしているなら、`verify-e2e-recorded-network-allowlist.json` に理由付きで載せる（`e2e/fixtures.js` に寄せると録画に無い `/api/*` が本番へ素通りしうる） |
| （整形） | `prettier --write` が `verify-registry.json` の既存エントリまで書き換える | 既存エントリは触らず、追加分だけにする |

## 処理済みの PR とマイグレーション

適用・配備・外部接続の段階ごとの一覧は [sns-hub-rollout-status.md](./sns-hub-rollout-status.md)。

| PR | 内容 | マイグレーション | 状態（2026-10-08） |
|---|---|---|---|
| #1302 | ① 展望 bundle の取り込み口 | 135 | マージ済み・135 適用済み。本番で取り込み1件を確認し、テストの下書き2件は archive 済み |
| #1315 | 48h/7d 観測・型比較 | 136 | レビュー済み・PR コメントあり。136 未適用。**適用前にマージしても新しいタブがエラーになるだけ** |
| #1316 | 承認後の X 送信（送信は無効のまま） | 137 | 段階2（ユーザー確認）。137 未適用。**137 を適用してからマージする**（未適用だと承認済みの X 下書き全件で手動投稿ボタンが隠れる） |

- #1315 と #1316 は `package.json`・`verify-registry.json`・`APPLIED.md` の末尾に追記しているので、後からマージする方は master を取り込んで衝突を直す必要がある
- #1315 のレビューで hq に回した事項: UTM の保存先（`sns_post_tracking`）は型の ID 必須だが、#1302 の下書きは型の ID が NULL のまま／尺の無い X 投稿が比較から外れる／比較対象のチャネル
- #1316 で hq に回した事項: 承認失効のトリガーは投稿済みの X 下書きにも効く（今は影響なし。将来、投稿済みの本文や媒体パスを変える処理を足すと承認者の記録が消える）

## 残りのパッチ（2026-10-08 時点、全て点検済み）

番号は 135〜141 が使用済み。取り込む前に master とオープン PR で番号を確かめる。

| パッチ | 内容 | SQL | 基準・注意 |
|---|---|---|---|
| `sns-hub-existing-fixes` 0001〜0002 | 既存の弱点の修正（承認・YouTube 公開・修正依頼の排他確保、外部成功後の DB 失敗、ブログ PR の SHA 固定） | 138 | master `91702dec` 基準。`approve.js`・`publish-youtube.js`・`redo.js`・`merge-blog-pr.js` が #1302・#1316 と衝突する。SQL を API より先に適用 |
| `sns-hub-deadline-queue` 0001〜0009 | 締切つき予約 | 139 | **0001〜0006 は Codex 版の依頼1・依頼3**（マージ済みの #1302・#1316 とは別物）。新しいのは 0007〜0009 |
| `sns-hub-risk-rules-unify` 0001 | リスク判定の一本化（BOA-795） | なし | #1302 の途中の head 基準。Edge から `scripts/lib` を import できるかは取り込み側の build・Vercel で確かめる |
| `sns-hub-risk-rules-add` 0001〜0003 | 禁止表現の追加（オーナー承認済み） | なし | unify の上。edit-assist の 0015/0016/0018 と同じ内容なので**両方は重ねない** |
| `sns-hub-mobile-approval` 0001〜0011 | スマホ承認の一画面化 | 140 | 0001〜0009 は依頼1・3・5 の Codex 版。新しいのは 0010〜0011。画面の変更なので、モック承認が要るかを判断して報告する |
| `sns-hub-edit-assist` 0001〜0018 | 編集補助・読みやすさ点検 | 141 | 140 と禁止表現の追加を含む累積 |
| `sns-hub-shorts-send` 0001〜0021 | YouTube Shorts の送信、ハッシュタグ例外 | — | 0001〜0018 は他の依頼の Codex 版。新しいのは 0019〜0021。0021 は「#競艇」ハッシュタグ例外（下記） |

**累積パッチの扱い（重要）**: 累積の前半には、既にマージした PR の「Codex 版」が入っている。前半をそのまま重ねると、取り込み時に直した修正（#1302 の F01/F02・自己申告ファイルの扱い、#1316 の import パス・ハーネス修正など）を巻き戻す。次のどちらかにする。

- hq に、最新の master（#1315・#1316 のマージ後）を基準に、新しい部分だけのパッチを作り直してもらう（推奨）
- 新しい部分（上の表の「新しいのは」）だけを `git am --3way` し、前提の衝突を手で直す

### 「#競艇」ハッシュタグの例外（2026-10-08 ユーザー決定）

GA4 の月間ユーザー（直近28日）が1000人になるまで、SNS のハッシュタグに「#競艇」を使ってよい。本文・動画内の文字・タイトルは「ボートレース」のまま。`risk-rules.json` の例外（ハッシュタグの欄の「#競艇」だけ通す、設定値1つで切れる）は `sns-hub-shorts-send` の 0021 にある。取り込むときに、`banned-term-kyoutei` の description も同じ内容（終了条件つき）に直す。`.claude/rules/code-style.md` と `docs/reference/sns-brand-guideline.md` はオーケストレーター側の別 PR。
