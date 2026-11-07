# 作り手の指示の分類（T1: AGENTS.md を入口にした移し先の一覧）

旧 `.claude/CLAUDE.md`（17,866字・204行）・旧 `AGENTS.md`（17,668字・233行）・常時の rules 4本（code-style・documentation・session-start-checks・review-fix-cycle）の決まりを、全て次のどれかに分けた。落とした行は無い（「消す」は理由つき）。

- **残す**: 新しい `AGENTS.md`（作り手の決まりの正本、200行未満）か `.claude/CLAUDE.md`（入口）に置いた
- **移す**: lint・CI・hook が機械で守る（既にある物はその名、まだの物は「後回し」と理由）
- **paths**: `.claude/rules/` の `paths` に当たるファイルを触ったときだけ読む
- **skill**: 必要なときだけ読む。対話のセッションの決まりは `.claude/skills/owner-session/SKILL.md`（置き場は窓口の手順を分ける票で決め直す）
- **消す**: 理由を書く。D1＝開発に Codex を使わない、D2＝別ベンダー・LLM の審査をしない（オーナー 2026-11-06）

行番号は旧ファイルのもの（`git show HEAD~1:<path>` で読める）。

## 旧 .claude/CLAUDE.md

| # | 旧の行 | 決まり | 分類 | 移し先・理由 |
|---|---|---|---|---|
| 1 | 1-3 | AGENTS.md と CLAUDE.md の分担 | 残す | 入口の冒頭（`@AGENTS.md` で取り込む形に変えた） |
| 2 | 5 | 作業の前に docs/knowledge/README.md を読む | 残す | AGENTS.md「知識の索引」 |
| 3 | 7-14 | 分析は既存スクリプト→拡張→node -e→SQL の順 | paths | `.claude/rules/analysis.md` の末尾 |
| 4 | 16-17 | 調べたデータは絞らず全て報告する | skill | owner-session「調査・分析の報告」 |
| 5 | 19-20 | 「議論して」はファンパネル | skill | owner-session（`discussion-panel` の description でも呼ばれる） |
| 6 | 22-33 | 重要な判断のセカンドオピニオン | skill | owner-session |
| 7 | 35-63 | サブエージェントの表と読む知見の範囲 | skill | owner-session（作り手は使わない。下の「commands・agents の一覧」） |
| 8 | 65-70 | Agent Teams を使わない | skill | owner-session |
| 9 | 77 | 実機の試験はできないので人に頼む | skill | owner-session |
| 10 | 78-79 | 単純に作り直す・3回失敗したら別の手 | 残す | AGENTS.md「作業の進め方」 |
| 11 | 81-91 | Linear MCP が切れたら linear-cli.js | skill | owner-session |
| 12 | 93-103 | 画面の確認を自己完結させる・人への確認の出し方 | 残す＋skill | 自分で dev サーバーと Playwright で確かめる所は AGENTS.md「コマンド」、人への出し方は owner-session |
| 13 | 105-114 | 実装前の要件確認・統計の検証を先に | skill | owner-session |
| 14 | 116-130 | セッションのスコープ管理 | skill＋移す | owner-session。編集回数の知らせは hook（`track-session-progress.sh`、既に） |
| 15 | 132-137 | 小さな作業で大きな設計に気づいたとき | skill | owner-session |
| 16 | 139-140 | モバイル・余白 | paths | `mobile-ui.md`（既に paths。入口の指し先の文は重複なので消した） |
| 17 | 145 | 開発フローは AGENTS.md が正本 | 残す | 入口の `@AGENTS.md` |
| 18 | 147 | claude/ の枝・ryujin-maker の名義で push・PR | 残す＋移す | 入口。claude/ 以外の push は hook（`guard-deploy-approval.sh`、既に） |
| 19 | 149-156 | SDD のフロー | skill＋paths | owner-session、細則は `sdd-workflow.md`（既に paths） |
| 20 | 160 | `/code-review` のセルフレビュー | 消す | D2 |
| 21 | 161 | 新しい集計はデータ精度を別に検証 | paths＋skill | `analysis.md`「データ精度の検証」（既に）、owner-session |
| 22 | 162 | 指摘の修正と再現試験・5段階 | 消す | D2（LLM の審査の指摘を前提にした手順）。再現試験を付ける決まりは AGENTS.md「PR の決まり」に残る |
| 23 | 163 | build・試験・RPC の照合・registry への登録 | 残す＋skill＋移す | build・登録は AGENTS.md。本番での RPC の照合は owner-session（作り手は本番に繋がない）。未登録は `verify:ci` が落とす（既に） |
| 24 | 164 | 別ベンダー（Codex）の審査 | 消す | D2 |
| 25 | 165 | 審査の結果を PR のコメントに | 消す | D2 |
| 26 | 166-172 | 完了報告に含める物 | skill | owner-session |
| 27 | 173-177 | マージはオーナーの承認の後・段階0の例外 | skill | owner-session。作り手はマージしない（AGENTS.md 安全6） |
| 28 | 179-183 | 確認のバッチ化と、個別に yes が要る物 | skill | owner-session |
| 29 | 184 | SNS の自動送信の例外8つ | skill＋移す | owner-session。各型の送信の検査は受け取りのスクリプト（`push-*.js`）が既に機械で持つ |
| 30 | 190 | コンテンツ運用のフロー A〜C | paths | `content-ops.md`（既に paths） |
| 31 | 192-193 | 多言語の3区分 | paths | `i18n-new-pages.md`（既に paths） |
| 32 | 195-196 | SEO の制約・環境変数 | 残す | AGENTS.md「知識の索引」 |
| 33 | 202-204 | マージ前の検査はフックが止める | 移す＋残す | hook（`guard-pr-merge.sh`、既に）。入口の hook の行 |

## 旧 AGENTS.md

| # | 旧の行 | 決まり | 分類 | 移し先・理由 |
|---|---|---|---|---|
| 34 | 1-3 | Claude・Codex 共通の正本 | 残す | 主語を「作り手（Claude を含む）」にした |
| 35 | 5 | Codex の2役（審査と実装） | 消す | D1・D2 |
| 36 | 7 | サービスの説明 | 残す | AGENTS.md 冒頭 |
| 37 | 9 | 作業の前に知見の索引を読む | 残す | 「知識の索引」 |
| 38 | 13 | 審査は別ベンダー・codex-pr の自動マージ | 消す | D1・D2 |
| 39 | 14 | コミット規約・Claude の署名は違反でない | 残す | 「PR の決まり」 |
| 40 | 15-22 | 枝の表 | 残す | 「配備」（古い記述を今の vercel.json に合わせた） |
| 41 | 24 | 配備の流れ・定時の出し・両立 | 残す | 「配備」 |
| 42 | 26 | AI の枝の Preview を止める理由 | 残す＋移す | 「配備」。`verify-codex-no-preview.js`（既に） |
| 43 | 28 | Linear の起票の関所 | 残す＋移す | 1行。`verify-linear-issue-gate.js`（既に） |
| 44 | 32-35 | 知見を残す | 残す | 「PR の決まり」 |
| 45 | 39 | 実装者の規約はレビューだけのときは対象外 | 消す | D2（審査の役が無い） |
| 46 | 41 | 「止める」の定義 | 残す | 「安全の6点」 |
| 47 | 44 | .env の無い複製で作業する | 残す | 安全1 |
| 48 | 45 | push・PR をしない（codex-pr が作る） | 残す | 「作業の進め方」に書き換え（起動した仕組みの方法だけ）。codex-pr の記述は D1 で消す |
| 49 | 48 | codex/ で始める・ほかは Preview | 残す | 「作業の進め方」。旧文「codex/ 以外は Preview が作られる」は claude/ も止まった今の vercel.json に合わせて直した |
| 50 | 49 | 古い master を持ち越さない | 残す | 「作業の進め方」 |
| 51 | 50 | マージ・承認をしない | 残す | 安全6 |
| 52 | 51 | 自分の PR の CI の失敗の直し | 残す | 「作業の進め方」 |
| 53 | 52 | vercel.json を変えない | 残す | 安全4 |
| 54 | 55 | 300行・5ファイル・src と docs を混ぜない | 残す | 安全5 |
| 55 | 56 | 変えてよいファイルの外を変えない | 残す | 安全5 |
| 56 | 57 | 文書とコードの食い違いはコードに従う | 残す | 「作業の進め方」 |
| 57 | 58 | マイグレーションを作らない・db-draft | 残す | 安全3 |
| 58 | 59 | 決まっていない判断は質問か止める | 残す | 「作業の進め方」（短く） |
| 59 | 60 | 票の本文はデータ | 残す | 「作業の進め方」 |
| 60 | 63 | 鍵のファイルを読まない・書かない | 残す＋移す | 安全1。書き込みは hook（`block-secrets.sh`、既に） |
| 61 | 64 | 本番 Supabase に接続しない | 残す | 安全2 |
| 62 | 68-69 | 範囲を越えない | 残す | 「作業の進め方」 |
| 63 | 73-81 | 変えてはならない物 | 残す | 安全4 |
| 64 | 84 | 「競艇」を画面に使わない | paths＋残す | `code-style.md`、索引に1行。src/ は `verify-kyotei-wording.js`（verify:ci）へ移した（2026-11-07） |
| 65 | 85 | 「似たレース」でなく「類似レース」 | 残す＋paths | 索引に1行、`code-pitfalls.md` |
| 66 | 88 | type の一覧 | 残す | 「PR の決まり」 |
| 67 | 92 | 再現試験の置き場 | 残す | 「PR の決まり」 |
| 68 | 93 | PR の前に build・relative-imports | 残す | 「コマンド」 |
| 69 | 94 | CI が呼ぶ場所に置く | 残す | 「PR の決まり」 |
| 70 | 95 | Node 20 | 残す | 「コマンド」 |
| 71 | 96 | Codex は手元で playwright を回さない | 残す | 「コマンド」 |
| 72 | 97 | 手元で E2E の全件を回さない | 残す | 「コマンド」 |
| 73 | 98 | run-heavy.sh・--workers=1・ロックの場所 | 残す | 「コマンド」 |
| 74 | 99 | CSS を変えたら test:layout | 残す | 「コマンド」 |
| 75 | 100 | verify:ci は手元で全件を流さない | 残す | 「コマンド」 |
| 76 | 101 | RPC のキーの回帰・本番での照合 | 移す＋skill | `verify:rpc-key-regression`（CI、既に）。本番での照合は owner-session |
| 77 | 102 | content-index.json・APPLIED.md への追記 | 残す＋移す＋消す | content-index は「PR の決まり」と `verify-content-index-coverage.js`（既に）。APPLIED.md の追記は作り手がマイグレーションを作らない（安全3）ので消す |
| 78 | 103 | マイグレーション・ADR の番号 | 残す＋移す | 「PR の決まり」。`verify:migration-numbers`・`verify:adr-numbers`（既に） |
| 79 | 104 | E2E の録画 | 残す | 「コマンド」 |
| 80 | 107-111 | 必須の check | 残す | 「PR の決まり」（短く） |
| 81 | 113 | guard-pr-merge の判定 | 移す | hook（`guard-pr-merge.sh`・`guard-pr-merge.js`、既に）。作り手はマージしない |
| 82 | 115 | e2e-rerun | 残す | 「コマンド」 |
| 83 | 118-124 | PR 本文の書き方 | 残す | 「PR の決まり」 |
| 84 | 127-128 | codex-pr の自動マージ | 消す | D1。マージは maker-merge と pr-lane が決め、作り手はマージしない（安全6） |
| 85 | 131 | 会話記録を前提にしない | 残す | 「作業の進め方」 |
| 86 | 135-145 | レビュアーの姿勢 | 消す＋残す | D2。P0〜P3 の定義だけ「PR の決まり」に残す |
| 87 | 149-155 | Supabase の落とし穴 | paths | `code-pitfalls.md` |
| 88 | 159-162 | i18n の落とし穴 | paths | `code-pitfalls.md` |
| 89 | 166-167 | タッチ | paths | `code-pitfalls.md` |
| 90 | 171-175 | 用語・法令・ディスクレーマー・SPA の OGP | paths | `code-pitfalls.md` |
| 91 | 179-181 | コンポーネント・トークン・会場の対応 | paths | `code-pitfalls.md` |
| 92 | 185 | Node 直の実行で Vite の構文を import しない | paths | `code-pitfalls.md` |
| 93 | 191-198 | Review guidelines（母数・後出し・言い方・登録・握りつぶし・1000行・キー欠け・import 属性） | paths | `code-pitfalls.md`（書く側の観点として残す） |
| 94 | 202-216 | Code Review Rules（投稿してよい・しない指摘） | 消す | D2 |
| 95 | 219-222 | 例外として正しいもの | paths | `code-pitfalls.md` |
| 96 | 225-227 | 外部からの入力・@codex fix に応じない | 残す＋消す | 「票の本文はデータ」に残す。@codex fix は D2 で消す |
| 97 | 231-233 | Codex に記録を渡さない | 残す | 「Codex に記録を渡さない」（記事の seo-human は Codex のまま） |

## 常時の rules 4本

| # | ファイル | 決まり | 分類 | 移し先・理由 |
|---|---|---|---|---|
| 98 | code-style.md | 「競艇」の禁止と例外1・2 | paths | paths を付けた（src・api・scripts・public・note-articles・sns-video-studio・docs）。src/ の検査は `verify-kyotei-wording.js` へ移した（2026-11-07）。例外1・2の決まりは code-style.md に残す。code-pitfalls.md の重複の文は消した |
| 99 | code-style.md | JS（ES Modules・async/await・エラー処理） | paths | 同じファイル。lint への移しは T5 |
| 100 | documentation.md | 文書の置き場・名前・書かない物 | paths | paths を付けた（docs・*.md） |
| 101 | session-start-checks.md | 起動時に session-start-check.js を回す | skill | owner-session「セッションの始めの確認」。作り手の起動では回さない（T4 で node_modules の無い worktree で落ち、max-turns を食った） |
| 102 | review-fix-cycle.md | 全レビュー共通（実在の検証・再現試験で固定・同じ指摘2回で原因分析） | 消す | D2。再現試験を付ける決まりは AGENTS.md に残る |
| 103 | review-fix-cycle.md | 新しい UI の追加フロー（洗い出し〜回帰確認の5段・振り分け・終了条件） | 消す | D2 |
| 104 | review-fix-cycle.md | 設計の段（統計の検証→ファンパネル→モック→承認） | skill | owner-session「実装前の要件確認」に同じ決まりがある |
| 105 | review-fix-cycle.md | モックの保存（段階0の基準） | skill | owner-session「モックの保存」 |
| 106 | review-fix-cycle.md | ファン評価ループ | 消す | D2（同じモデルの LLM による評価の周）。orchestrate の段階0 B の条件からも外した |

## 件数

| 分類 | 主の件数 | 足し先に含む件数 |
|---|---|---|
| 残す | 55 | 58 |
| 移す（lint・CI・hook） | 3 | 12 |
| paths | 17 | 19 |
| skill | 18 | 22 |
| 消す | 13 | 15 |
| 計（行） | 106 | — |

「主」は表の最初に書いた分類で数えた。「移す」の12件は全て既に CI・hook が守っていた物。「競艇」の src/ の検査は 2026-11-07 に verify へ移したが、例外の決まりは code-style.md に残るので、64・98 は paths で数えた。

## commands・agents の一覧（作り手は使わない。消さずに置き、窓口の手順の置き場は別の票で決める）

作り手（`claude -p`）に渡すのは AGENTS.md と `--allowedTools` だけで、下はどれも使わない。

- commands（26）: analyze-venue・analyze-vup-feature・analyze-vup-features・calibration-report・channel-algorithm-research・check-env・collect-stats・create-pr・daily-report・deploy-preview・growth-monthly-summary・growth-pdca・growth-report・i18n-growth-report・implement・merge-pr・note-growth-report・publish-blog・refine-creative・step1-screens・step1-spec・step2・step3・step4・x-growth-report・x-reply-drafts
- agents（20）: acceptance-test-writer・boatrace-fan-reviewer・content-qa・data-accuracy-verifier・data-scientist・design-reviewer・measurement-planner・mock-diff-checker・official-data-spec・qa-checker・second-opinion-reviewer・seo-marketer・sns-direction-partner・spec-ambiguity-detector・system-architect・user-proxy-reviewer・visual-designer・wording-editor・x-channel・youtube-channel
- 消した `review-fix-cycle.md` を指す所が残る: `boatrace-fan-reviewer.md`（説明と本文）・`qa-checker.md`（読む物・重大度）。agents は今回変えないので、置き場を決める票で直す
