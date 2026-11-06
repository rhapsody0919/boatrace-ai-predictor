# ADR 0032: AIクローラー向けスナップショット配信方式

## ステータス
採用

## 背景

boatAIはSSR無しの純粋なSPA（React + Vite）で、ページ固有のコンテンツはJS実行後にしか現れない。GooglebotはJSレンダリングに対応するが、GPTBot・ClaudeBot・PerplexityBot等のAIクローラーやFacebook等のSNSシェア用ボットの多くはJSを実行しないため、これらのボットにはページの実コンテンツが見えていない（`docs/reference/seo-architecture-constraints.md`、`docs/design/ai-crawler-snapshot/spec.md`）。

フルSSR/フレームワーク移行は数週間規模の投資で、現状AI経由の流入が計測上ゼロ（当時の i18n-demand の定点。生データは 2026-11-06 に hq へ移した）のため見送り、代わりに対象ページ（ブログ記事＋`/winning-technique`の説明部分）に限定した静的スナップショットを対象ボットにのみ返す設計とした。

配信方式を決めるにあたり、Vercelの現行ドキュメント（[Routing Middleware](https://vercel.com/docs/routing-middleware)、[Routing Middleware API](https://vercel.com/docs/routing-middleware/api)、2026-08時点）を調査した。

## 決定

**Edge Runtime（デフォルト）のRouting Middleware（`middleware.js`）で、`@vercel/functions`の`rewrite()`ヘルパーを使い、対象ボットのリクエストのみをビルド時生成済みの静的スナップショットHTML（`dist/ai-snapshots/{page}.html`）へrewriteする。**

- `middleware.js`の`matcher`に対象パス（`/blog/:path*`、`/winning-technique`）を追加し、既存のSNSハブBasic認証（`/admin/sns-hub*`）と1ファイル内で共存させる（パスごとに条件分岐）
- ボット判定はUser-Agentヘッダの文字列マッチ（`GPTBot`/`ClaudeBot`/`PerplexityBot`/`Google-Extended`/`facebookexternalhit`/`Twitterbot`等）で行う（Google-Extended は UA を持たず一致しなかった。追記「Google の取得器の扱い」）
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
- **ビルドが本番 DB を読む**: 描くページが、公開の anon キーで本番の Supabase を読む（1人あたり十数リクエスト）。書き込みは無い。全員を描くのは1日に1回で、ほかの本番ビルドは写せなかった選手だけを描く（下の「追記: 描くのは1日1回、ほかは今の本番から写す」）
- **本番のビルドだけで作る**（`VERCEL_ENV=production`。全員を描くのは1日1回、ほかは今の本番から写す。下の追記）。Preview・手元のビルドでは作らない（Preview のたびに本番 DB へ数千のリクエストを送らないため）。確かめるときだけ `RACER_SNAPSHOT_LIMIT`（正の整数）でその人数を作る。本番では `RACER_SNAPSHOT_LIMIT` を無視する（`scripts/lib/racerSnapshotPlan.js`）
- **失敗したら SPA**: 描けなかった・成績が取れなかったページは保存しない。ファイルが無いので vercel.json の catch-all で SPA の外枠が返る（ブログと同じ）。ビルドは止めない
- **並列数**: 4（ブログと同じ）。Vercel のビルドの Chromium は単一プロセスなので、並列を増やしても使うコアは増えず、1ページが落ちたときに巻き添えになるページが増える。待ち時間の大半は Supabase の応答なので、4 で足りる
- **ビルド時間**: Preview（4コア 8GB、`RACER_SNAPSHOT_LIMIT=20`）で 20人 22.8秒（1人 約1.1秒）。全員（2026-10-12 時点の sitemap で325人）では約6分の見込みだった。本番の実測は 317人 755.5秒（2026-11-05 の調査、本番ビルドの CPU の約74%）で、見込みの2倍だった
- **中身の古さ**: 描いた時刻から最大で「20時間＋次の本番ビルドまでの間隔」（下の追記）。「今節のモーター状況」も同じ。sitemap の自動コミット（`update-sitemap.yml`）は sitemap・llms.txt に差分があるときだけなので、毎日1回の本番ビルドの保証にはならない。本番ビルドは普段は日に数十本ある
- **戻し方**: `resolveSnapshotPath` と `middleware.js` の matcher から `/racer` を外す（ファイルが残っても配られない）。または PR を revert

## 追記: 描くのは1日1回、ほかは今の本番から写す（Vercel の費用、2026-11-05）

Vercel の従量がオーナーの決めた月の上限を超えた（額と調査は hq。2026-11-06 オーナー決定で費用の額を公開のリポジトリに置かない）。本番ビルド1本の CPU の約74%が選手ページを描く時間（317人 755.5秒）で、本番ビルドは日に70〜90本ある。オーナーの線は「ボット向けの選手ページの古さは最大1日」。system-architect の審査を通した（P0・P1 なし。P2 の4件は同じ PR で直した）。

- **決定**: 本番のビルドは、まず今の本番の `/ai-snapshots/status.json` を読む。`racer` が「見た目の版（`templateVersion`）が同じ・途中で止まっていない・描いた時刻（`renderedAt`）が20時間以内」なら、sitemap の選手ごとに今の本番の `/ai-snapshots/racer/{id}.html` を写す。満たさなければ今までどおり全員を描く（`scripts/lib/racerSnapshotPlan.js` の `decideRacerSnapshotSource`）
- **写すときの検査**（`adaptCopiedRacerHtml`）: main の js・css の参照（ビルドごとに hash が変わる）をこのビルドの `dist/index.html` のものに書き換える。`/` で始まる拡張子つきの src・href がすべてこのビルドの dist に在ること、保存の目印（`canSaveRacerSnapshot`）があり noindex でないこと。満たさない選手（新しく sitemap に入った・前回失敗・取得の失敗）だけを描く。本番に無い番号を取ると catch-all で 200 の SPA の外枠（約5KB）が返るので、「200 なら在る」と見ない
- **描いた時刻**: 写したときは元の `renderedAt` を引き継ぐ（写し続けても新しくならない）。写し終えた後に status.json を読み直し、古い方を残す（写している間に alias が別の版へ切り替わることがある）。読み直した版の見た目の版が違う・途中で止まっていたら、写した HTML を消して全員を描く（`sourceChangedDuringCopy`）
- **20時間の理由**: オーナーの線24時間から、越えた後の次の本番ビルドまでの余裕を4時間とった。本番ビルドが少ない日（10/31 は11本）は24時間を少し越えることがある
- **人の画面を変えたとき**: RacerProfile とその部品（スナップショットに入る画面）を変える PR では `RACER_SNAPSHOT_TEMPLATE_VERSION` を1つ上げる。本番の版と違えば、その PR の本番ビルドで全員を描き直す（ADR 0089 決定3: 人の画面に無い節をボットに残さない）。`<head>` の計測のタグ等は最大1日古いまま残ることを受け入れる。手で描き直すときは環境変数 `RACER_SNAPSHOT_FORCE_RENDER=1`（入れたままにすると毎回全員を描く）
- **監視**: status.json の `racer` に `mode`（copy・render）・`renderedAt`・`templateVersion`・`copied`・`rendered`・`copyFailures`（理由ごとの件数）を書く。毎日の照合（`verify-bot-html-parity.js`）が、`renderedAt` が24時間を越えた・途中で止まったときに落とす（`racerSnapshotProblems`）
- **今の本番に依存する**: 写す元は `https://www.boat-ai.jp`（手元で確かめるときだけ `RACER_SNAPSHOT_SOURCE_ORIGIN`）。取れない・403・Deployment Protection 等で写せなければ描く側に倒れる（費用が今までに戻るだけ）。Instant Rollback の後は戻した版から写すが、古さは `renderedAt` で測るので20時間で描き直しに倒れる。`/ai-snapshots/` は middleware の matcher の外で、関門も通らない
- **同時に走るビルド**: On-Demand Concurrent Builds のままだと、20時間を越えた直後に同時に走る本番ビルドはどれも古い status を読み、全員を描く（その時間帯だけ今までの動き）。「Run up to one build per branch」（オーナーが 2026-11-05 に入れる）なら本番ビルドは1本ずつなので起きない
- **却下**: 並列を4→8〜12に上げる（Chromium は単一プロセスで縮む保証が無く、DB の同時の要求が増え anon の3秒で落ちる恐れが増す。毎回の費用は残る）。bot-page の関数で都度作る（RacerProfile の中身を関数で組み直す規模が大きく、決定3の照合も要る）。Vercel の build cache に置く（同時のビルドの間で共有されず、消えた日の動きも読めない。今の本番から写す方が元が見えて確かめやすい）
- **費用**: 写す道の取得は gzip で約27KB/人（実測 3256）。317人×日90本で約0.8GB/日・Edge Requests 約2.9万/日。関数の呼び出しは起きない

## 追記: Preview ではブログ・翻訳・一覧を作らない（Vercel の費用、2026-11-05）

Preview 1本の CPU の約4割がブログ（155件）・翻訳記事・ブログ一覧のスナップショット。Preview でボット向け HTML を確かめる決まった審査は無い（2026-11-05 に `.claude`・`e2e`・`.github` を grep して確認）。

- **決定**: `VERCEL_ENV=preview` では既定で作らない（`scripts/lib/previewSnapshotPlan.js`）。確かめたい PR だけ、最新のコミットのメッセージに `[bot-html]` を入れる（空のコミットでよい）か、その枝の Preview の環境変数 `BOT_SNAPSHOTS_ON_PREVIEW=1` で作る。本番・手元のビルドは今までどおり作る
- 作らなかったときの status.json は `ok: true`・`blog.skipped` に理由を残す（毎日の照合は本番だけを見るので影響しない）。/winning-technique・/today・図の PNG（ADR 0099）は Preview でも作る

## 追記: Google の取得器の扱い（BOA-899）

一次情報（確認日 2026-11-02）: Google の [common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) と [user-triggered fetchers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers) の文書。

| UA の名前 | 何か | 配るか |
|---|---|---|
| Googlebot | 検索のクローラー。JS を描画する | 配らない（ADR 0089 のオーナー決定。Google は動的レンダリングを推奨しない回避策としている） |
| Google-InspectionTool | URL 検査・リッチリザルトテスト | 配らない（Googlebot と同じ画面を見せる） |
| GoogleOther | 製品を決めない汎用のクローラー | 配らない |
| Google-Agent | 利用者の代わりにページを操作する代理 | 配らない（操作できる SPA のままにする） |
| Google-GeminiNotebook | Gemini Notebook の利用者が出典に渡した URL を取る。UA は Chrome の文字列に `(compatible; Google-GeminiNotebook; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-gemininotebook)` が付く。旧名 Google-NotebookLM は文書で「2026年8月まで」とされ、足さない | **配る**（ChatGPT-User・Claude-User と同じ利用者起点の取得） |
| Google-Extended | robots.txt の印。「doesn't have a separate HTTP request user agent string」 | 一覧から外した。この名前を名乗る取得は無く、UA の照合では何にも一致しなかった（当初の決定の誤り） |

- Gemini API の url_context の取得 UA は公式文書（ai.google.dev/gemini-api/docs/url-context）に書かれていない。文書は「まず内部の索引キャッシュ、無ければその場で取得」とだけ書く。2026-11-02 の hq の試験で /blog/meet-score-rate-guide は本文が取れ、/blog/toda-losing-makuri-share と /racer/3256 は殻だったが、3つとも配信の経路は同じ（人・Google の各 UA に殻、上の配る UA に描画済み）。この追記は url_context の差を直すものではない
- 一覧を変えるときは、`vercel.json` の no-store 規則の `missing` の UA 正規表現（6か所）も同じに直す（`scripts/maintenance/verify-middleware-routing.js` [7] が一致を確かめる）

## 追記: middleware の範囲が /api に広がった（BOA-1110 段階3、ADR-0103）

- `middleware.js` の `matcher` に `/api/:path*` を足し、`/api/*` の要求すべてで middleware が動く（関門の判定は `api/_lib/apiGate.js`、観測の1行ログ）。スナップショットの振り分けとは別の分岐で、`/api/cron`・`/api/admin`・`/api/bot-page` は関門の除外のまま既存の分岐へ進む
- 実行の環境は**未確認**（runtime の指定は無い）。2026-11-04 の Preview のビルドの記録には「middleware.js uses the deprecated "edge" runtime」と出たが、同じデプロイの Runtime Logs の middleware の行は `runtime=nodejs24.x` だった。ADR-0089 の「既定は Node.js」もこの上の「Edge Runtime（デフォルト）」も、どちらとも決められない。Edge の束ねは JSON の import 属性（`with { type: "json" }`）を読めず、ビルドが落ちた（段階3の初回）。関門の範囲の表は JS のモジュール（`api/_lib/searchBotIpRanges.js`）にした
