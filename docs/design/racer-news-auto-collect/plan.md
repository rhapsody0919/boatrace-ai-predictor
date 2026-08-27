# racer-news-auto-collect システム設計（plan.md）

対応spec: [spec.md](./spec.md)

## 1. データ設計

### 1.1 新規マイグレーションは不要
`racer_news`（[036_create_racer_news.sql](../../db-migration/036_create_racer_news.sql)）は既存カラム（`racer_id`/`title`/`summary`/`source_url`/`source_name`/`published_at`）だけでFR2/FR5の挿入要件を満たせる。新規テーブル・カラムは追加しない。

**注: FR1（自社DBのグレードレース優勝自動生成）は実装・検証後に見送った**（spec.md「却下した要件」参照）。以下の記述に残るFR1への言及は経緯として残しているが、現在は実装対象外。

### 1.2 処理済み判定は新規テーブルを作らず既存データを再利用する
新規の「処理済みID管理テーブル」は作らず、以下の既存データで冪等性を担保する（詳細は[ADR-0025](../../adr/0025-racer-news-dedup-without-new-table.md)）。

- **公開済みかどうか**: `racer_news.source_url`の一意性で判定する。挿入前に`SELECT 1 FROM racer_news WHERE source_url = ?`を必ず行う
- **保留中かどうか**: `data/analysis/racer-news-pending-review/pending.json`（FR3で後述）に同一`sourceUrl`のエントリが`status: "pending"`で存在するか確認する

`source_url`は各ソースで一意になるよう設計する:
| ソース | source_urlの構成 |
|---|---|
| FR2（節目記録記事） | `boatrace.jp`記事URL（記事ごとに一意） |
| FR5（選手コメント、方針未確定） | `会場公式サイトの選手コメントページURL#racerId-YYYYMMDD`（同じページを複数選手・複数節で参照するため、フラグメントで一意化） |

### 1.3 pending.json 構造
```json
{
  "items": [
    {
      "id": "grade-announcement-51234-2026-08-26",
      "source": "grade-race-win | grade-announcement | venue-comment",
      "reason": "racer_profilesに一致する選手が見つからない（該当0件）",
      "candidate": {
        "racerId": null,
        "name": "○○○○",
        "branch": "群馬",
        "extractedText": "..."
      },
      "sourceUrl": "https://www.boatrace.jp/owpc/pc/site/news/2026/08/51234/",
      "sourceName": "BOAT RACEオフィシャルウェブサイト",
      "detectedAt": "2026-08-26",
      "status": "pending"
    }
  ]
}
```
`status`は`pending` → ユーザー判断後に`approved`（`racer_news`へ投入し済み）または`rejected`に更新する。既存のTikTok/X history.jsonと同様、消化済みのエントリも履歴として残す（削除しない）。

## 2. スクリプト構成

```
scripts/lib/racerNews/
  ├── dedup.js               # source_url重複チェック（racer_news + pending.json）
  ├── pendingReview.js        # pending.json の読み書き
  ├── templates.js            # FR2の定型テンプレート生成
  ├── officialGradeAnnouncements.js  # FR2: boatrace.jp「レーサーデータ」記事の取得・突合
  └── venueComments/
        ├── index.js           # 会場コード→パーサーのレジストリ、共通マッチングロジック
        └── {venueCode}.js      # 会場ごとの専用パーサー（FR5の方針確定後に着手）

scripts/daily/
  └── collect-racer-news.js   # オーケストレーター。FR2→FR5の順に実行し、
                                 それぞれ独立してtry/catchする（1つの失敗が他を止めない）
```

### 2.2 FR2: `officialGradeAnnouncements.js`
**`/step2`実装着手時の実HTML調査で判明した事実により、当初案（記事本文取得＋氏名+支部の曖昧一致＋勝率整合性チェック）から設計を変更した。**

- `boatrace.jp/owpc/pc/site/news/racer/{年}/{月}/`（当月＋前月の2ページ、月境界の取りこぼし対策）を取得し、`ul.news4_newsList > li > a`から見出し・日付・記事URLを抽出（cheerioでHTML解析）。**記事本文の個別取得は不要**（一覧の見出し文字列だけで完結する）
- 見出しを`/登録第(\d+)号/`（登録番号＝racer_id）・`/（(.+?)支部）/`（支部）・`/支部）\s*(.+?)達成/`（達成内容の自由文字列、例:「2,000勝」「24場制覇」）の3つの正規表現で抽出する。登録番号が抽出できない見出し（「選手期別成績に◯年後期のデータをアップ」等）は個別選手の記録ではないためスキップする（エラーにもpendingにもしない）
- `dedup.js`で記事URL単位の既処理チェック→未処理のみ処理
- 登録番号（racer_id）で`racer_profiles`を直接検索。存在しない、または支部が記事記載と一致しない場合は`pendingReview`へ「登録番号不一致/支部不一致」として記録
- 一意特定できたら`templates.js`で定型文を生成し投入（勝率等の数値整合性チェックは不要になった。登録番号自体が一次キーであり曖昧性が無いため）

### 2.3 FR5: `venueComments/`（方針未確定、以下は当初設計。実装未着手）
- 初回実装時点で開催中（または直近開催予定）の会場を1つ選んで検証する。会場を固定で決め打ちしない（開催スケジュールは常に変動するため、`/step3`着手時に`races`テーブルの直近開催会場を確認してから対象を選ぶ）
- 選定会場の「全選手コメント」ページ構造を調査し専用パーサー（`venueComments/{venueCode}.js`）を実装。共通インターフェースは`{ scrape(venueCode): Promise<{ name: string, comment: string }[]> }`
- 抽出した`name`を、`races`（`venue_code`=対象会場、`race_date`が直近開催期間内）と`race_entries`を結合して得られる「今節この会場に出走している選手名一覧」と突合
- 一致が1件なら`racer_id`確定、0件/複数件は`pendingReview`へ
- `summary`は原文ママ格納（テンプレート化しない。[spec.md](./spec.md) FR5参照）
- 開催期間外でページが空（プレースホルダーのみ）の場合は何もせず正常終了する

**`/step4`タスク4着手時の実会場調査で判明**: 「選手コメント」ページは唐津・芦屋の2会場でしか確認できず、他会場は第三者編集記事（「レース展望」）が中心だった。上記設計は前提が崩れているため、方針確定まで実装を保留している（spec.md FR5参照）。

## 3. GitHub Actions ワークフロー

`.github/workflows/collect-racer-news.yml`を新規作成。既存の`aggregate-stats.yml`/`calculate-accuracy.yml`と同じ構成パターン（`workflow_dispatch`併用、`continue-on-error`、`TZ: Asia/Tokyo`）を踏襲する。

```yaml
on:
  schedule:
    - cron: '10 14 * * *'  # JST 23:10（calculate-accuracy.ymlの23:30より前、当日結果確定後）
  workflow_dispatch:

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - name: Collect racer news
        run: node scripts/daily/collect-racer-news.js
        continue-on-error: true   # 他の日次ジョブに影響させない
        env:
          TZ: 'Asia/Tokyo'
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
      - name: Commit pending-review updates if changed
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          git add data/analysis/racer-news-pending-review/pending.json
          git diff --staged --quiet || git commit -m "chore: 選手ニュース要確認リストを更新 [automated]"
          git pull --rebase
          git push
```
（`update-sitemap.yml`と同じ「変更があればcommit&push」パターン）

## 4. FR3: セッション開始時提示ルール
`.claude/CLAUDE.md`に以下を追記する（TikTok/X投稿確認と同じ節構成）:

> `data/analysis/racer-news-pending-review/pending.json`に`status: "pending"`の項目があれば、セッション開始時の最初の応答で自発的に提示し、`racer_news`への投入可否を確認する。承認されたら`scripts/maintenance/add-racer-news.js`でINSERTし該当項目を`status: "approved"`に、却下されたら`status: "rejected"`に更新する。

## 5. 定型テンプレート（FR2、実装・検証済み）
- `「{name}選手が{achievement}を達成」`（`achievement`は見出しから抽出した達成内容の文字列、例:「2,000勝」「24場制覇」をそのまま使用）

## 6. 既存サービス層との連携
`src/services/racerService.js`の`getRacerPageData`は`racer_news`を`created_at`降順で取得するだけの実装のため、**変更不要**。自動投入されたニュースも既存の`/racer/:racerId`ページにそのまま表示される。

## 7. ADR
- [ADR-0024](../../adr/0024-racer-news-auto-publish-safety-net.md): 自動公開の安全弁を人手承認から自動チェックへ置き換える設計
- [ADR-0025](../../adr/0025-racer-news-dedup-without-new-table.md): 処理済み判定に新規テーブルを作らず既存データを再利用する設計
