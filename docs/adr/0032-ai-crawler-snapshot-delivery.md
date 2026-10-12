# ADR 0032: AIクローラー向けスナップショット配信方式

## ステータス
採用

## 背景

boatAIはSSR無しの純粋なSPA（React + Vite）で、ページ固有のコンテンツはJS実行後にしか現れない。GooglebotはJSレンダリングに対応するが、GPTBot・ClaudeBot・PerplexityBot等のAIクローラーやFacebook等のSNSシェア用ボットの多くはJSを実行しないため、これらのボットにはページの実コンテンツが見えていない（`docs/reference/seo-architecture-constraints.md`、`docs/design/ai-crawler-snapshot/spec.md`）。

フルSSR/フレームワーク移行は数週間規模の投資で、現状AI経由の流入が計測上ゼロ（`data/analysis/i18n-demand/report-2026-08-26.json`）のため見送り、代わりに対象ページ（ブログ記事＋`/winning-technique`の説明部分）に限定した静的スナップショットを対象ボットにのみ返す設計とした。

配信方式を決めるにあたり、Vercelの現行ドキュメント（[Routing Middleware](https://vercel.com/docs/routing-middleware)、[Routing Middleware API](https://vercel.com/docs/routing-middleware/api)、2026-08時点）を調査した。

## 決定

**Edge Runtime（デフォルト）のRouting Middleware（`middleware.js`）で、`@vercel/functions`の`rewrite()`ヘルパーを使い、対象ボットのリクエストのみをビルド時生成済みの静的スナップショットHTML（`dist/ai-snapshots/{page}.html`）へrewriteする。**

- `middleware.js`の`matcher`に対象パス（`/blog/:path*`、`/winning-technique`）を追加し、既存のSNSハブBasic認証（`/admin/sns-hub*`）と1ファイル内で共存させる（パスごとに条件分岐）
- ボット判定はUser-Agentヘッダの文字列マッチ（`GPTBot`/`ClaudeBot`/`PerplexityBot`/`Google-Extended`/`facebookexternalhit`/`Twitterbot`等）で行う
- `rewrite()`はURLを書き換えるだけで、実際のファイル配信はVercelの静的アセット配信層に任せる。**ファイルシステム（`fs`）アクセスは不要**なため、Edge Runtimeのデフォルト設定のまま実装できる
- `rewrite()`は`redirect()`と異なりクライアント側のURLを変えない（ボットからは同一URLへのアクセスとして見える）ため、正規URLと配信コンテンツの対応が崩れない

## 却下した選択肢

### 案A: Node.js runtime middleware + `fs`で直接ファイル読み込み
`export const config = { runtime: 'nodejs' }`でNode.js runtimeに切り替え、`fs.readFileSync`でスナップショットHTMLを読んでレスポンスを自作する方式。技術的には可能（Vercelは`middleware.js`でNode.js runtimeをサポート済み、2026-08時点）だが、`rewrite()`で同じ結果が実装コスト・複雑度ともに小さく達成できるため不要。Edge Runtimeよりコールドスタートが重くなる可能性もある。

### 案B: フルSSR/フレームワーク移行（Next.js化等）
全ページがAIクローラーからも人間ユーザーからも同じ経路で正しく見える、最も根本的な解決。ただし`AppRouter.jsx`のルート数（27+）×4言語＋動的ページを考えると数週間規模の再構築になり、現状ゼロの計測データでは投資対効果を正当化できない。既存の「SSR移行はPhase3まで見送り」判断（`boa_growth_strategy_decision_2026_08`）とも矛盾する。将来、本ADRの施策でAI経由流入の増加が確認できた場合の次の投資候補として保留する。

### 案C: リクエスト時オンデマンドレンダリング＋キャッシュ
ボットのリクエストごとにPlaywright等でその場レンダリングし、Vercel KV/Blob等にキャッシュする方式。常に最新のコンテンツを返せるが、キャッシュ層の新規導入・レンダリング処理のサーバーレス実行時間コスト・キャッシュ無効化ロジックが必要になり複雑度が大きく上がる。対象ページ（ブログ記事＋機能説明）はいずれも更新頻度が低い静的コンテンツのため、ビルド時生成で十分（`spec.md`のスコープ判断と一致）。

## 影響

- ビルドパイプラインに、Playwrightで対象ページをレンダリングしHTMLファイルを出力するステップが追加される（ビルド時間が数十秒〜1、2分程度増加する見込み）
- `middleware.js`が複数の関心事（SNSハブ認証・ボット判定）を1ファイルで扱うことになる。今後さらに用途が増える場合は関数分割を検討する
- スナップショットは次回デプロイまで更新されない。ブログ記事修正時は再デプロイが必要（通常のデプロイフローに乗るため追加の運用負荷は無い）
- Edge Runtimeの制約（Node.js API不可）を受けるが、`rewrite()`のみで完結するため実装上の支障は無い

## 追記: 選手ページ（BOA-848）

`docs/proposal/ai-agent-era-strategy.md` §10 Phase 1 の K。オーナーの決定（2026-10-12）で作って公開する。

- **出すページ**: `/racer/{4桁の登録番号}`。言語の接頭辞は付けない（選手ページは ja 専用）。出すのは sitemap に載る選手だけ（`src/utils/racerIndexPolicy.js` の `isRacerIndexable`。ビルドは `public/sitemap.xml` の選手 URL を読む。sitemap は毎日 `update-sitemap.yml` が書き直す）。描いたページが noindex なら保存しない
- **作り方**: ブログと同じ。Playwright で dist の `/racer/{番号}` を描き、プロフィールと成績が揃った目印（`RacerProfile.jsx` の `data-snapshot-ready`）が付いてから HTML をそのまま保存する。人の画面を描いたものなので、人の画面に無い文言は入らない（ADR 0089 決定3）
- **ビルドが本番 DB を読む**: 描くページが、公開の anon キーで本番の Supabase を読む（1人あたり十数リクエスト）。書き込みは無い
- **本番のビルドだけで作る**（`VERCEL_ENV=production`）。Preview・手元のビルドでは作らない（Preview のたびに本番 DB へ数千のリクエストを送らないため）。確かめるときだけ `RACER_SNAPSHOT_LIMIT`（正の整数）でその人数を作る。本番では `RACER_SNAPSHOT_LIMIT` を無視する（`scripts/lib/racerSnapshotPlan.js`）
- **失敗したら SPA**: 描けなかった・成績が取れなかったページは保存しない。ファイルが無いので vercel.json の catch-all で SPA の外枠が返る（ブログと同じ）。ビルドは止めない
- **並列数**: 4（ブログと同じ）。Vercel のビルドの Chromium は単一プロセスなので、並列を増やしても使うコアは増えず、1ページが落ちたときに巻き添えになるページが増える。待ち時間の大半は Supabase の応答なので、4 で足りる
- **ビルド時間**: Preview（4コア 8GB、`RACER_SNAPSHOT_LIMIT=20`）で 20人 22.8秒（1人 約1.1秒）。全員（2026-10-12 時点の sitemap で325人）では約6分の見込みで、ビルド全体は今の約2分から約8分になる。Vercel のビルドの上限（45分）までは余裕がある
- **中身の古さ**: 次のデプロイまで変わらない。sitemap の自動コミットで毎日1回は本番がデプロイされるので、最大でおよそ1日前の内容（「今節のモーター状況」も同じ）
- **戻し方**: `resolveSnapshotPath` と `middleware.js` の matcher から `/racer` を外す（ファイルが残っても配られない）。または PR を revert
