# コンテンツ運用フロー統合再設計: システム設計

`spec.md`の要件を実現するための設計。新規スクリプト3本・新規GitHub Actions1本・新規ドキュメント2種・CLAUDE.md再編で構成する。既存DBスキーマの変更はない。

## 全体構成

```
[実装完了時（Claudeの手元）]                [セッション開始時（能動チェック）]        [無人の定期実行]
 実装完了チェックリストに                    session-start-check.js が            GitHub Actions（新規）が
 content-index.json 作成を追加  ──読む──▶  7項目を1回で集約表示          ◀─並走─  同じ機械的チェックを実行し
      │                                         ▲                                Slack通知（滞留時のみ）
      ▼                                         │
 docs/design/{slug}/                    list-visual-assets-age.js
 content-index.json                     verify-content-index-coverage.js
      │                                         │
      └──────────────── 参照 ───────────────────┘
```

- 「セッション開始時チェック」と「GitHub Actions定期チェック」は**同じ判定ロジックを共有**する（`scripts/maintenance/content-ops-checks/`配下に判定関数を切り出し、両方から呼ぶ）。ロジックの二重実装・食い違いを防ぐ
- GitHub Actionsは「機械的に判定できて、かつ外部サイト閲覧を伴わない」項目のみを扱う（spec.md C8）。tweet-drafts/X動画/TikTok/選手ニュース/集客調査スキルの5項目は既存通りセッション開始時チェックのみで扱い、GitHub Actions化しない（これらは投稿実行自体が人間のセッション・Chrome操作を要するため、無人化しても閲覧・生成はできない）

## ファイル構成

```
docs/
  reference/
    brand-kit.md                          # 新規: C1・C2・C3
    deprecated-terms.json                 # 新規: C10の用語マスタ
  design/
    content-ops-flow/
      spec.md / plan.md / tasks.md
    {feature-slug}/
      content-index.json                  # 新規: A2（機能ごとに1ファイル）

scripts/
  maintenance/
    content-ops-checks/
      check-content-index-coverage.js     # 新規: C5のロジック本体
      check-visual-asset-age.js           # 新規: C4のロジック本体
      check-quality-backlog.js            # 新規: C6のロジック本体（Linear API）
      check-recent-flow-a-content.js      # 新規: A4のロジック本体
      check-deprecated-terms.js           # 新規: C10のロジック本体
      nightly-summary.js                  # 新規: C8のGitHub Actionsから呼ぶ集約スクリプト
    session-start-check.js                # 新規: C7（上記5つ＋既存5項目を集約）
    verify-content-index-coverage.js      # 新規: C5のCLIラッパー（build時にも呼べる形）
    check-deprecated-terms.js             # 新規: C10のCLIラッパー

.github/
  workflows/
    content-ops-nightly-check.yml         # 新規: C8
```

## `content-index.json` スキーマ（A2）

1機能=1ファイル。パスは `docs/design/{feature-slug}/content-index.json`。既に`docs/design/{slug}/spec.md`が存在する機能はその隣に置く。

```jsonc
{
  "feature": "BOA-XXX の機能名",
  "released": "2026-09-01",
  "content": {
    "static_pages": [],     // 例: ["/about"] — 言及・更新した静的ページ
    "note_articles": [],    // 例: ["note-articles/xxx.md"]
    "blog_posts": [],       // 例: ["public/blog/xxx.md"]
    "youtube_videos": [],   // 例: ["https://youtube.com/watch?v=..."]
    "x_posts": []           // 投稿URL（判明分のみ、無理に埋めない）
  },
  "not_applicable": false   // true の場合、上記チャネルへの展開が無い機能であることの明示
}
```
実ファイルはコメントを書けない厳密なJSON（`JSON.parse`できる形）とする。上記はスキーマ説明のための注釈付き表記

`not_applicable: true`を許すのは、「このメカニズムは強制するが、全ての機能が全チャネル展開されるわけではない」という現実に合わせるため。空配列のまま放置と`not_applicable`を区別することで、「対象チャネルなしと確認済み」と「確認自体をしていない」を機械的に見分けられるようにする（C5のカバレッジチェックはこの区別を検証する）。

## `verify-content-index-coverage.js`（C5）

`verify-sitemap-coverage.js`と同じ設計思想。ただし「機能の一覧」を機械的に列挙する手段がsitemapのルートほど自明ではないため、判定対象は次の2つに限定する（無理な自動化はしない、spec.mdの非機能要件「形骸化耐性」との整合）。

1. **フォーマット検証**: 既存の`docs/design/*/content-index.json`全てについて、必須キー（`feature`/`released`/`content`/`not_applicable`）の存在とcontent配下の型を検証する
2. **未作成検出の限定運用**: 「本来必要なのに存在しない」の全自動検出はしない。代わりに、実装完了チェックリスト（A3）でその機能のPRごとに人間（多くはClaude自身）が判断し作成する運用に委ねる。本スクリプトは「作られたものの形式が壊れていないか」だけを保証する

## `session-start-check.js`（C7）

既存5項目の判定ロジック（tweet-drafts未投稿件数、X/TikTok本日投稿状況、選手ニュースpending、集客調査スキル鮮度）は、現状CLAUDE.mdの文章指示としてClaude自身が都度ファイルを読んで判断している。これをスクリプト化し、判定結果をJSON1本で返す形にする。

```
$ node scripts/maintenance/session-start-check.js
{
  "tweetDrafts": { "pendingCount": 12, "oldestDate": "2026-08-20" },
  "xVideo": { "postedToday": 1, "target": 3 },
  "tiktok": { "postedToday": false },
  "racerNews": { "pendingCount": 0 },
  "growthSkills": { "xGrowthAgeDays": 9, "tiktokGrowthAgeDays": 4 },
  "contentIndexCoverage": { "invalidFiles": [] },
  "qualityBacklog": { "openCount": 5, "surfaceCount": 3, "items": [...] }
}
```

CLAUDE.mdの指示は「セッション開始時にこのスクリプトを実行し、結果を報告する」の1行に集約する（既存5節の文章は本スクリプトの実装コメントに転記し、削除はしない。C9のCLAUDE.md再編で参照する）。

`qualityBacklog`はLinearの`content-quality`ラベル付きIssueを取得し、tweet-draftsと同じ鮮度優先ロジック（起票日が古いもの優先、毎回2〜3件）で`surfaceCount`件だけ抽出する。

## `content-ops-nightly-check.yml`（C8）

```yaml
on:
  schedule:
    - cron: '0 15 * * *'   # JST 深夜0:00
  workflow_dispatch:
jobs:
  check:
    steps:
      - checkout / setup-node / npm ci
      - run: node scripts/maintenance/content-ops-checks/check-content-index-coverage.js --json > result.json
      - run: node scripts/maintenance/content-ops-checks/check-visual-asset-age.js --json >> result.json
      - run: node scripts/maintenance/content-ops-checks/check-quality-backlog.js --json >> result.json
      - Slack通知: 閾値超過時のみ（visual assetが90日超・quality backlogが10件超）。`slack-notify-pr.yml`と同じ`SLACK_WEBHOOK_URL`を使う
```

X/TikTok/tweet-drafts/選手ニュース/集客調査スキルはこのワークフローに含めない（spec.mdスコープ外、外部閲覧を要するため）。

## `docs/reference/brand-kit.md`（C1・C2・C3）

トークン集ではなく実例ギャラリー。構成:

```markdown
# ブランドキット

## トークン
（色・フォント・ロゴファイルパスの一覧。Header.jsx/design-tokens.cssの実値を正とし、ここは参照用のミラー）

## チャネル別ギャラリー

### note ヘッダー画像
- 採用: header-e（2026-09-01）— 実ロゴを1650pxまで拡大しキャンバス右端でブリード配置。理由: ...
- 却下: header-c2 — 独自紋章バッジ・分割ウェイトのロゴテキストで実際のヘッダーと不一致のため作り直し
- 却下: 初回案（絵文字🐉ベース） — 環境依存でカラフルに表示され浮く

### note アイコン
- 採用: icon-a（2026-09-01）— 実ロゴをそのまま正方形紺背景に配置

（以降、X/YouTube/TikTok/ブログのカバー画像等を承認のたびに追記）
```

各制作プロンプト（`note-video-producer-prompt.md`等）冒頭に「着手前に`docs/reference/brand-kit.md`のギャラリーを確認すること」を追記する（C2）。

## CLAUDE.md再編（C9）

現状の該当セクションを次のように移動する（文面はほぼ維持、見出し構造のみ変更）。

| 現在の見出し | 移動先 |
|---|---|
| 新機能リリース時のブログ記事ルール | フローA配下 |
| セッション開始時のXツイート下書き投稿確認 | フローC配下（session-start-check.jsの説明に置換） |
| セッション開始時のX動画投稿確認 | フローC配下（同上） |
| セッション開始時のTikTok投稿確認 | フローC配下（同上） |
| セッション開始時の選手ニュース要確認リスト提示 | フローC配下（同上） |
| セッション開始時の集客調査スキル実行確認 | フローC配下（同上） |
| 新規ページ追加時のsitemap登録 | フローA配下（トレーサビリティ索引と並記） |

既存ルールの「挙動」は変えない。5つの「セッション開始時確認」節は本文をなくし、「`session-start-check.js`を実行し結果を報告する」という1行＋スクリプトへのリンクに置き換える（詳細ロジックはスクリプト側のコメントに移す）。
