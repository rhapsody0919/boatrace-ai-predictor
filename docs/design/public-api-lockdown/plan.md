# 公開 API（/api/*）を自サイト専用に絞る設計（BOA-1110）

## 0. 前提と目的

- オーナーの決定（2026-10-27、直接）: 外部の AI 向けにデータを出す方針はやめる。`/api/*` は自分のサイト（画面・自分の処理）が使う分だけにし、外からの呼び出しは一旦禁止する
- これで `docs/proposal/ai-agent-era-strategy.md` の E（MCP の自己配布）・J（有料 API）は取り下げ。AI 検索向けの HTML（`/api/bot-page/*`・`dist/ai-snapshots/`、ADR-0032・0089）は人と同じ公開ページの写しなので残す（API ではない）
- 目的は3つ: ①非公開・廃止の値を外に出さない ②龍神ソナー（`/api/analogy/*`）の集計を丸ごと持っていかれない ③外からの呼び出しで Vercel・Supabase・公式（`/api/odds/live` は boatrace.jp への取得を伴う）の負荷と費用が増えない
- この文書は設計だけ。コード・`vercel.json`・`.github`・本番の設定は変えない

### 先に言うべき限界（実効性）

**`/api/*` を閉じても、同じデータの半分は Supabase の匿名キーで直接取れる。** 画面の配信物には Supabase の URL と匿名キーが入っており（公開バンドル）、`/api/predictions`・`/api/races/today`・`/api/accuracy`・`/api/outcome-distribution` は中で匿名キーの RPC・REST を呼んでいるだけ（`api/predictions/[date].js:17`、`api/races/today.js:11,28`、`api/accuracy/index.js:13`、`api/outcome-distribution/index.js:13`）。画面にも RPC 直のフォールバックがある（`src/services/supabaseDataService.js:1387,1513`）。

| データ | `/api` を閉じれば守れるか | 理由 |
|---|---|---|
| 龍神ソナー（`/api/analogy/facts・similar・scenario・layer`） | 守れる | サービスキーで非公開の Storage を読む（`api/_lib/analogyV16.js:21-22,63`）。外から直接は取れない |
| 寄与度（`/api/analogy/contribution`） | **守れない** | 関数が匿名キーで読む（`api/analogy/contribution.js:30-31`）。表 `analogy_contribution_profiles` は匿名に SELECT がある（`docs/db-migration/118_analogy_contribution_tables.sql:97-98`）。画面も直接読む（`src/services/analogyService.js:66`） |
| ライブオッズ（`/api/odds/live`） | 守れる（踏み台の防止） | 関数が boatrace.jp を取りに行く。外から叩かれると公式への取得が増える（ADR-0059 §2） |
| 予想・出走表・成績（`/api/predictions`・`races/today`・`accuracy`・`outcome-distribution`） | **守れない**（`/api` の口だけ閉じる） | 同じ RPC を匿名キーで直接呼べる。`inCaution` 等も RPC の応答に入っている |
| `race-history/summary` | **守れない** | 関数はサービスキーを優先する（`api/race-history/summary.js:13`）が、表 `race_history_cache` は匿名に SELECT がある（`docs/db-migration/020_race_history_cache.sql:16`）。`accuracy_cache` も同様（013・013b） |

DDL での確認。本番の実際の権限は `scripts/maintenance/check-anon-access.js` で確かめる（今回は未実行）。

予想系まで本当に閉じるには、Supabase 側（匿名ロールの RPC の GRANT・RLS）と画面の RPC 直のフォールバックを外す別の設計が要る。費用・画面への影響が大きいので、この設計の範囲外とし、別チケットで扱う（§8）。

## 1. エンドポイントと呼び出し元（読み取りの結果）

### 1.1 エンドポイントの分類

```mermaid
flowchart LR
  subgraph A[閉じる対象: 公開の読み取り API]
    P["/api/predictions/{date}"]
    T["/api/races/today"]
    AC["/api/accuracy"]
    RH["/api/race-history/summary"]
    OD["/api/outcome-distribution"]
    AN["/api/analogy/facts・similar・scenario・layer・contribution"]
    OL["/api/odds/live"]
  end
  subgraph B[別扱い: 既に守りがある]
    CR["/api/cron/* (44本)<br/>Bearer CRON_SECRET"]
    AD["/api/admin/*<br/>Basic 認証 (middleware + requireAdminAuth)"]
  end
  subgraph C[別扱い: ボット向け HTML]
    BP["/api/bot-page/*<br/>middleware が UA で rewrite"]
  end
```

- `/api/cron/*` は44本すべてが `Authorization: Bearer ${CRON_SECRET}` を定数時間で比べる（`scripts/lib/scrapeJobs/cronWrapper.js:71,631` の共通ラッパ、または各ファイルの `CRON_SECRET` 判定。2026-10-27 に全ファイルを grep で確認）。呼び手は Vercel Cron（`vercel.json` の `crons`）と cron-job.org（`docs/operation/external-cron-setup.md`、同じ Bearer）。**この設計では変えない**。新しい関門からは外す（二重に判定しない）
- `/api/admin/*` は middleware の Basic 認証（`middleware.js` の `ADMIN_PATH_PREFIXES`）と関数側の `requireAdminAuth`。**変えない**。関門から外す
- `/api/bot-page/*` は AI クローラーの UA のとき middleware が rewrite する先。中身は公開ページの HTML で、閉じる目的（データの丸ごとの取得）に当たらない。関門から外す。ただし中で自分の `/api/races/today`・`/api/predictions` を取りに行くので、その内部の呼び出しには §2 の合言葉が要る

### 1.2 呼び出し元の一覧と、閉じたときに壊れるもの

凡例: 「関門の判定」は §2 の推奨（同じサイトのブラウザか、合言葉のヘッダか）で通るかどうか。

| # | 呼び出し元 | どこで動く | 叩く API | 判定の材料 | 閉じたら | 直す所（誰が） |
|---|---|---|---|---|---|---|
| a1 | 画面（`src/services/supabaseDataService.js:1365,1482,1536,1941,2079`・`analogyService.js`・`liveOddsService.js`・`adminRulePerformance.js`・`snsHubService.js`） | 利用者のブラウザ（www.boat-ai.jp・Preview の `*.vercel.app`） | predictions・races/today・accuracy・race-history・outcome-distribution・analogy/*・odds/live（admin は別扱い） | `Sec-Fetch-Site: same-origin`（相対 URL の fetch） | 通る | なし |
| a2 | 画面の自動の閲覧（Playwright・Chromium）: `verify-bot-html-parity.js` の人の画面の描画部分、`api/admin/sns-hub/send-probe.js`・`snsHeadless.js`（Vercel の中の Chromium）、hq の `~/full-picture/.../collect-screen.cjs`・`screen-browser.cjs`（Mac） | 本物のブラウザで www.boat-ai.jp を開く | 画面と同じ | 画面と同じ | 通る（`screen-browser.cjs` は `route.continue()` でブラウザのヘッダのまま送る） | なし |
| b1 | ボット向け HTML の関数（`api/_lib/botPage.js:207`・`botRace.js:151`。`botToday.js` は Supabase REST を直接読むので対象外、`:157-171`） | Vercel の中から自分の origin を fetch | races/today・predictions?light=true | なし（サーバー間） | **壊れる**（AI クローラーに 5xx） | 関数の fetch に合言葉のヘッダを足す（Claude、コード） |
| b2 | SNS の cron（`api/cron/sns-auto-plan.js:131` → `snsClaimCheck.checkClaims`、`api/cron/sns-send.js:86` → `createReadCurrent`） | Vercel の中から `https://www.boat-ai.jp/api/analogy/*` を fetch（`snsClaimCheck.js:81,176`） | analogy/facts・similar・scenario・layer | なし | **壊れる**（自動送信の照合が落ち、投稿が止まる） | 同上 |
| b3 | `/api/cron/*` の中の処理 | Vercel の中 | 公開 API は叩かない（Supabase・公式を直接） | — | 影響なし | なし |
| c1 | 全貌動画の材料（`sns-video-studio/remotion/scripts/full-picture/fetch-materials.mjs:1058,1094-1121`・`daily.mjs:238`） | オーナーの Mac（hq の launchd から） | analogy/facts・similar・scenario、predictions、outcome-distribution（24会場） | なし | **壊れる**（全貌動画が作れない） | `getJson` に合言葉のヘッダ、鍵は環境変数から（Claude、コード）＋ Mac の環境変数（オーナー） |
| c2 | hq の優勝戦の選び（`~/hq/platform/finals_run.py:47,125`） | Mac | predictions | なし | **壊れる**（優勝戦の思考投稿が止まる） | hq が直す（読むだけで確認、書き込みはしない） |
| c3 | hq の全貌動画の番組表と材料（`~/hq/scripts/full-picture-daily.sh:94`・`full-picture-lib.sh:11` → `~/full-picture/.../analysis/fetch.cjs:4,10`、`stage.cjs:3` の `preflight()`、hq の作業中の worktree にある `scripts/full-picture-nightly.sh:33`） | Mac（Node の `fetch`・`https.get`。UA を送らないものもある） | predictions・analogy/facts・similar・scenario | なし | **壊れる** | hq が直す |
| c3b | ボット HTML の監視（`scripts/maintenance/verify-bot-html-parity.js:88,169`、GHA `bot-html-parity.yml` が毎日 JST 12:00） | GHA。`/api/races/today` は Node の素の `fetch`（UA は人を装うが `Sec-Fetch-Site` は付かない） | races/today | なし | **壊れる**（ADR-0089 の監視が落ちて Slack に流れる） | 取得に合言葉のヘッダ（Claude）＋ GHA の secret（`.github`、オーナー承認） |
| c4 | 手元の開発サーバー・E2E（`vite.config.js:12-13,47` の proxy が `/api/` の読み取りの7種 を本番へ転送） | 手元の Mac、GHA の `e2e-smoke-test.yml`（録画に無い分の素通し）・`e2e-live.yml`・`e2e-rerecord.yml` | 読み取り API の全部 | ブラウザのヘッダのまま転送（`changeOrigin` で Host だけ本番に書き換わる）。同じ origin の GET なので `Origin` は付かず、`Sec-Fetch-Site: same-origin`。`Referer` は `http://localhost:…` | 通る（§2 の判定は `Sec-Fetch-Site` があるときは `Referer` を見ない） | なし。合言葉は配らない（e2e-smoke-test は PR ごとに動くので、secret を渡すと鍵がすべての PR の CI に広がる）。段階3のログで `browser` として数えられることだけ確かめる |
| c5 | 分析の手作業スクリプト（`scripts/analysis/full-picture-answer-stage/collect*.mjs`、`past-rate-check/*.mjs`、`analogy-judge-open-cards.js`、`in-collapse-caution/round1/fetch_c2.mjs`、`url-index-render-check.js`） | 手元 | analogy/*・predictions | なし | **壊れる**（手で回すときだけ） | 共通の取得に合言葉（Claude）。急がない |
| c6 | GitHub Actions のその他 | GHA | workflow が呼ぶスクリプトまで grep して、本番の `/api` を叩くのは c3b だけ（e2e は c4） | — | 影響なし | なし |
| c7 | AI クローラー向けの静的スナップショット（`middleware.js` → `dist/ai-snapshots/`） | ビルド時に生成、配信は静的 | API は叩かない | — | 影響なし | なし |
| c8 | cron-job.org | 外部 | `/api/cron/*` だけ（Bearer CRON_SECRET） | 別扱い | 影響なし | なし |
| d1 | 外部の第三者（AI エージェント・スクレイパー・hq の壁打ち中の読み、BOA-1110 の5） | 不明 | 全部 | `Sec-Fetch-Site` 無し・`none`・`cross-site` | 拒む（目的どおり） | — |
| d2 | 検索ボットのレンダリング（Googlebot の WRS 等。ADR-0089:110 のとおり Googlebot には SPA を返している） | Google 等 | 画面と同じ | WRS が `Sec-Fetch-Site` を送るかは**未確認** | **止めるおそれ**。予想系は Supabase 直のフォールバックで描けるが、`/api/analogy/*`・`/api/odds/live` にはフォールバックが無く、検索に見える race ページの中身が欠ける | 段階3で `ua_class=search_bot` を別に数え、段階4へ進む条件にする。止めていたら Vercel Firewall の verified bots で通す（UA だけで通すと偽装に負ける。オーナー承認） |

c 群のうち hq（c2・c3）は hq のファイルなので、この設計では書き換えない。hq に「合言葉のヘッダを付ける」受け渡しを出す（§5 の段階1）。

## 2. 止め方の比較と推奨

### 2.1 比べた案

| 案 | 外からの呼び出しを止める力 | 壊れ方 | 費用 | 手間 |
|---|---|---|---|---|
| ① CORS を自サイトの origin に絞る | **ほぼ無い**。ブラウザの別サイトの JS が応答を読めなくなるだけ。curl・サーバー・AI のツールは止まらない | 無し（画面は同じ origin） | 0 | 小。ただし `vercel.json` の headers と、関数の中で `*` を付けている所（`api/predictions/[date].js:25,47,82,96`・`api/analogy/contribution.js:33`・`api/_lib/analogyV16.js:161`・`api/accuracy/index.js:20,54,71`・`api/outcome-distribution/index.js:47,131,148`・`api/race-history/summary.js:22,61,77`・`api/races/today.js:19,48,63`）の両方を直す。`api/` に `Access-Control-Allow-Origin: *` が残らないことを verify で固定する。観測の段階が無く、その場で効く（別サイトの JS からの読み取りが止まる） |
| ② `Sec-Fetch-Site`・`Origin`・`Referer` の確認 | 中。普通の AI のツール・`curl`・`fetch` は `Sec-Fetch-Site` を送らないので止まる。わざとヘッダを偽る相手は止まらない | `Sec-Fetch-Site` があるのに `Referer` まで見ると c4（開発サーバー）が落ちる（見ないので落ちない）。`Sec-Fetch-Site` を送らない素の Node の呼び出し（b1・b2・c1〜c3b）は落ちる（③で救う）。検索ボットのレンダリング（d2）は未確認。Preview の `*.vercel.app` を固定の一覧にすると落ちる（自分の host と比べれば落ちない） | 0（middleware の起動は今も多くのページで動いている。`/api/*` に広げた分の起動回数の費用は未確認） | 小 |
| ③ 内部の呼び出し元に合言葉のヘッダ（環境変数の鍵） | サーバー間の呼び出しを確実に区別できる（②と組む） | 配り漏れの呼び出し元が落ちる → 段階1で先に配り、観測で拾う | 0 | 中（Vercel・Mac・GHA に配る。鍵の新設はオーナー） |
| ④ 画面の呼び出しに短命の署名つきトークン（cookie） | ②より少し強い。ただしトークンはページを開けば誰でも取れるので、ブラウザを真似る相手は止まらない。IP ごとに数える材料にはなる | トークンの発行の経路（全ページの HTML を middleware に通すか、発行の API）を足す。期限切れ・cookie を拒む端末で画面が落ちうる | middleware をほぼ全ページで起動（費用は未確認） | 大 |
| ⑤ Vercel Firewall のカスタムルール・回数の上限 | 回数の上限で「丸ごとの取得」の速度を落とせる。条件でヘッダを見て拒むこともできる（CLI・API で `rate_limit` の窓10〜3600秒・数え方 `ip`・`ja4`・ヘッダ。Vercel 公式 CLI 文書） | 上限が低すぎると画面（1画面で数本の API）と hq の連続取得が 429 になる | Pro に含まれる範囲・超過の単価は**未確認**（公式の料金ページで確かめる） | 小（ダッシュボード）。設定は本番の変更なのでオーナー |
| ⑥ Cloudflare を前に置く | ⑤と同等以上（Bot 対策・回数の上限） | DNS の切り替え、Vercel の CDN と二重のキャッシュ、証明書。失敗するとサイト全体が落ちる | 無料枠あり。有料機能は未確認 | 大。後戻りしにくい |

補足:
- **関門は関数の中ではなく middleware に置く。** 公開 API の多くは `s-maxage` で CDN にキャッシュされる（`api/_lib/predictionsCache.js:11-12`・`analogyV16.js:151`・`accuracy/index.js:56` 等）。関数の中で拒んでも、キャッシュに当たった要求は関数まで届かない。Vercel の Routing Middleware がキャッシュの前で動くことは、今回の公式文書の検索では明記を確かめられなかった（**未確認**。既存の Basic 認証の `/api/admin/*` は no-store なので根拠にならない）。段階3で「キャッシュ済みの URL をヘッダ無しの curl で叩いても関門のログが出る」を実測して確かめ（§6 の確認3）、出なければ置き場所を見直す（その場合の代わり: Vercel Firewall のカスタムルールでヘッダを見て拒む。Firewall は要求の入口で効くとされるが、これも同じ curl で実測する）
- `/api/odds/live` はキャッシュの前に置かないと踏み台の防止にならない点も同じ

### 2.2 推奨

**②＋③を middleware で行い、①を同時に、⑤を最後に足す。④・⑥は採らない。**

- 理由: 目的（外部の普通の呼び出し・AI のツールを止める、龍神ソナーの丸ごとの取得を止める）に対して、費用0・手間が小さく、壊れ方が観測で拾える。④は②に比べて止められる相手がほとんど増えないのに手間と壊れ方が大きい（YAGNI。ヘッダを偽る取得がログで目立ったら再検討）。⑥は後戻りしにくく、Vercel の中の機能（⑤）で足りる
- 正直な限界: ヘッダを偽る・本物のブラウザで取る相手は止まらない。それは⑤の回数の上限で速度を落とすところまで。予想系は §0 のとおり Supabase から取れる

判定（middleware）。対象は `/api/*` の全部で、除外（cron・admin・bot-page）だけを名指しする（A の7種を列挙すると、後で足した API が関門の外に出る）:

```mermaid
flowchart TD
  R[要求 /api/...] --> D{パスをデコードできる?}
  D -- いいえ --> DENY0[400 no-store]
  D -- はい --> X{デコード後が<br/>cron・admin・bot-page?}
  X -- はい --> PASS0[関門を通さない<br/>既存の守りのまま]
  X -- いいえ --> K{x-ryujin-internal-key が<br/>INTERNAL_API_KEY か<br/>INTERNAL_API_KEY_NEXT と一致?<br/>定数時間比較}
  K -- はい --> OK1[通す reason=internal]
  K -- 付いているが不一致 --> BAD[段階に従う reason=bad_key]
  K -- 無し --> S{Sec-Fetch-Site = same-origin<br/>かつ Origin が無いか<br/>自分の host と同じ?}
  S -- はい --> OK2[通す reason=browser]
  S -- いいえ --> L{Sec-Fetch-Site が無く<br/>Referer の host が自分の host?<br/>古いブラウザ}
  L -- はい --> OK3[通す reason=browser_legacy]
  L -- いいえ --> M{段階}
  M -- 観測 --> LOG[通す + 1行のログ<br/>reason=would_deny]
  M -- 強制 --> DENY[403 no-store + 1行のログ<br/>reason=deny]
```

- `Sec-Fetch-Site` を送らない古いブラウザ（Safari 16.4 より前など）は `Referer` で救う（`reason=browser_legacy` で別に数え、少なければ段階4の後に外してよい）。偽れる強さは `Sec-Fetch-Site` と同じ
- 自分の host は `new URL(request.url).host` から取る（固定の一覧にしない。Preview の `*.vercel.app` でも同じ判定で通る）
- **matcher はデコード前のパスで照合される**（`api/_lib/adminAuth.js:4-8`。2026-09-29 に `/api/admin/sns-h%75b/` が middleware を素通りした実例）。matcher には `/api/:path*` を足し、除外の判定は `new URL(request.url).pathname` をデコードしたパスで行う。`/%61pi/predictions/…` のように `api` 自体をエンコードした要求が関数に届くかは事前に Preview で実測する（§4 の段階0）。届くなら middleware だけでは穴になるので、Vercel Firewall のルールで塞ぐ（関数の入口に置いてもキャッシュに当たった要求には効かない）
- 今の `middleware.js` に runtime の指定は無く、既定は Node.js（ADR-0089:98）。定数時間比較は `api/_lib/adminAuth.js:34-48` の `constantTimeEqual`（Web Crypto、どちらのランタイムでも動く）を export して使う（DRY）
- 既存の分岐（`isAdminPath` が先、次に `resolveSnapshotPath`）の前に `/api` の分岐を置く。rewrite 先の `/api/bot-page/*` を直接叩かれても除外なので干渉しない
- 判定は純関数にし、`verify-*.js` で固定する（エンコードしたパス・`/%61pi/`・鍵が空・鍵の不一致・`Sec-Fetch-Site` 無しで `Referer` あり・`Origin` が別）。`verify-middleware-routing.js`（CI）に `/api` の振り分けを足す
- `OPTIONS`（プリフライト）は同じ origin では発生しない。別 origin の `OPTIONS` は CORS を絞った後は許可のヘッダを返さないだけでよい（拒んでも同じ）
- 鍵が未設定のときは「合言葉の経路が無い」だけにする（fail-closed。鍵が空のとき空のヘッダで通さない）。ブラウザの経路は鍵に依らない
- 403 には `Cache-Control: no-store` を付ける（拒んだ結果を CDN に残さない）
- ログは1要求1行の JSON（`{"api_gate":reason,"path":…,"sfs":…,"origin_host":…,"ua_class":…}`）。IP・UA の全文・鍵は書かない。UA は「ブラウザ／検索ボット（Googlebot・bingbot 等）／AI ボット名／node・python・curl／無し／その他」に丸める。`reason=browser` は件数が多い（odds/live のポーリング）ので抜き取りにし、それ以外は全件出す
- 段階（観測／強制）は環境変数 `API_GATE_MODE`（`observe`／`enforce`、既定 `observe`）で切り替える。**Vercel の環境変数は既存のデプロイには効かず、Redeploy が要る**（数分。`ignoreCommand` の `scripts/vercel-ignore-build.js` が手動の Redeploy に効くかは未確認なので、Preview で一度試してから段階4に進む）。即時に切り替えたいなら Edge Config で持つ案もあるが、新しい資源なのでオーナー判断（§7）。KISS で環境変数＋Redeploy を推奨

鍵の名前（案）: `INTERNAL_API_KEY`、ヘッダは `x-ryujin-internal-key`。値は Vercel の環境変数と Mac の環境変数、GHA の secret にだけ置き、ログ・PR・チャットに出さない。
- **環境ごとに別の値**: Preview はどのブランチのコードでも鍵を読めるので、Production と同じ値を置かない（Mac・GHA が叩くのは Production だけなので、配るのは Production の値）
- **回し替え**: Vercel・Mac・hq・GHA は同時に更新できないので、`INTERNAL_API_KEY_NEXT` も受け付ける。新しい値を NEXT に置く → 呼び出し元を新しい値にする → `bad_key` と旧い値の利用が0になったら入れ替える

## 3. 非公開・廃止の項目を応答から外す

#1906（2026-10-25、`api/_lib/predictionsResponse.js`）で、`entries[].aiScoreStandard・aiScoreSafeBet・aiScoreUpsetFocus` と `races[].predictionOdds` は外し済み。残りを次の表で扱う（2026-10-27 に本番の `/api/predictions/2026-10-26` の応答のキーを確かめた: races の欄は `inCaution`・`volatility`・`predictions{standard,safeBet,upsetFocus,unified}` 等、各予想に `turnPrediction`・`racerStats`・`volatilityPercentile`・`volatilityReasons`）。

**依頼の前提と食い違う点**: `IN_CAUTION_PUBLIC=false`（`src/config/featureFlags.js:22`）の間、公開中の画面は「今の画面（展開予測・旧イン崩れ指数）」のまま（同 7-8 行のコメント）。つまり **`predictions.unified.turnPrediction` と、`races[].volatility`・`unified.volatilityPercentile`・`volatilityReasons` は今も公開画面で描いている**。廃止で読み手が無いのは standard・safeBet・upsetFocus の3モデルの方。

画面への入口は `transformEdgeResponse`（`src/services/supabaseDataService.js:1026-1165`）。

| 欄 | 公開画面の読み手 | 他の読み手（ボット HTML・SNS・全貌動画・hq） | 判定 | 理由 |
|---|---|---|---|---|
| `predictions.safeBet`・`upsetFocus` | 無し。`supabaseDataService.js:1106-1119` の汎用ループで `raceData.predictions.<model>` に写すが、読むコンポーネントが0件（`AccuracyHistory.jsx:76,128` が読むのは `/api/accuracy` の集計で、この欄ではない） | 無し（`botRace.js:118-134` は見出しと `result.rank1` だけ、`fetch-materials.mjs:1110-1145`・`daily.mjs:47-53` は見出し・出走・展示・天候・結果だけ、hq の `select-daily.py`・`finals_run.py:61-66` は見出し系だけ） | **外す**（段階2） | 廃止モデル。読み手0 |
| `predictions.standard` | 無し。`supabaseDataService.js:1050-1063,1092` で race 直下の `turnPrediction`・`racerStats` に写すが、写した先の読み手が0件（画面の選手の成績は `useRaceAnalysisData.js:42` が DB から直接読む） | 無し（全貌動画の racerStats は API ではなく Supabase の predictions を直接読む、`fetch-materials.mjs:642`） | **外す**（段階2）。同じ PR で `supabaseDataService.js:1050-1063,1092` と `RaceDetailPage.jsx:88` の写しも消し、`:1106-1119` の汎用ループでも外す3モデルを飛ばす（RPC 直のフォールバックでも同じ形にする） | 廃止モデル。画面の写しを残すと RPC 直のフォールバックとの形の差になる |
| `predictions.*.racerStats` | 無し（unified のものも読まれない） | 無し | **外す**（段階2） | 読み手0 |
| `predictions.unified`（`topPick`・`top3`・`turnPrediction`・`volatilityPercentile(IsFallback)`・`volatilityReasons`） | **有り**。`supabaseDataService.js:1126-1149` → `RaceDetailPage.jsx:70-85`・`RaceAiPredictionTab.jsx:146,284-309`（展開予測・荒れ度）・`RaceCard.jsx:93-103`・`HitRaces.jsx:24`（`/hit-races`）・`PredictionPanel.jsx:292`（共有文）・`aiCopyText.js:110-154`（AI用にコピー） | 無し | **残す** | 現行のモデルで、公開画面が描いている。`turnPrediction`・荒れ度は `IN_CAUTION_PUBLIC=true` の PR で外す（その PR の範囲） |
| `races[].volatility` | **有り**。`supabaseDataService.js:1085-1090` → `RaceCard.jsx:41,59-62,79`（荒れ・堅いの札、会場の一覧） | 無し | **残す** | 同上 |
| `races[].inCaution` | プレビュー（`?caution=1`）のときだけ。`RaceAiPredictionTab.jsx:80-89`・`PredictionPanel.jsx:282-306`・`RaceCard.jsx:67-71,133`・`ThinkingAssistPage.jsx:464-465` | 無し（ホームの注意度は `/api/races/today` から） | **残す**（公開の時まで） | 外すと本番でのプレビュー（オーナーの内部確認）が壊れる。しかも同じ値は Supabase の RPC を匿名キーで直接呼べば取れる（§0）ので、`/api` から外しても露出は減らない。露出は段階4（関門）で `/api` の口を閉じて止め、RPC 側は §8 の別チケットで扱う |

段階2で同時に直すもの:
- `scripts/maintenance/verify-predictions-response.js:36-72`（`predictions.safeBet` が「残る」ことを確かめている。外す欄に移す）
- E2E で safeBet・upsetFocus・standard・racerStats を確かめるものは無い（2026-10-27 grep）。unified・inCaution・volatility を使う E2E（`in-caution-*.spec.js`・`race-outcome-display.spec.js`・`race-share-text.spec.js`・`layout.spec.js:605-636` 等）は残す欄なので影響なし
- `scripts/maintenance/verify-rpc-output-keys.js` は RPC 側のキーを見るので変えない（RPC は変えない、#1906 と同じ流儀）
- hq: 「hq に `predictions.safeBet` の参照がある」という前の調べは、2026-10-27 の grep では再現しなかった（§5）。段階2の前に hq に最終の確認を頼む

## 4. 入れる順

壊さない順。各段階の後に §6 の観測を見てから次へ進む。

```mermaid
flowchart LR
  S1[段階1<br/>合言葉を配る] --> S2[段階2<br/>非公開の項目を外す]
  S2 --> S3[段階3<br/>関門を観測で入れる<br/>+ CORS を絞る]
  S3 --> S4[段階4<br/>外部を拒む<br/>API_GATE_MODE=enforce]
  S4 --> S5[段階5<br/>回数の上限<br/>Vercel Firewall]
```

| 段階 | やること | 変える所 | 誰の承認 | 進む条件 |
|---|---|---|---|---|
| 0 事前（コードのみ） | 判定の純関数と verify、`verify-middleware-routing.js` の拡張。Preview で `/%61pi/predictions/…` が関数に届くか、キャッシュに当たった要求（`x-vercel-cache: HIT`）でも middleware のログが出るかを実測 | `api/_lib/` に判定の関数、`scripts/maintenance/verify-*.js`（matcher にはまだ足さない） | 段階0の PR | 実測の結果で §2 の置き場所が成り立つ |
| 1 合言葉を配る | 鍵を環境ごとに作り、Vercel・Mac・GHA（`bot-html-parity.yml` の `environment: prod-jobs`）に置く。b1（botPage・botRace）・b2（snsClaimCheck）、c1（fetch-materials・daily）、c3b（verify-bot-html-parity）、c5 の取得にヘッダを足す（鍵が無ければ付けないだけ。関門が無いので何も変わらない）。c4 には配らない。hq（c2・c3）に受け渡し | `api/_lib/botPage.js`・`botRace.js`・`snsClaimCheck.js`、`sns-video-studio/.../fetch-materials.mjs`・`daily.mjs`、`scripts/maintenance/verify-bot-html-parity.js`、`scripts/analysis/*`。`.github/workflows/bot-html-parity.yml` に env を1行 | 鍵の新設と配布・`.github` はオーナー。コードは段階0の PR | hq が c2・c3 を直したと返す |
| 2 非公開の項目を外す | §3 で「外す」にした欄を `stripUnusedPredictionFields` に名指しで足す（今と同じ流儀）。再現テストを `verify-predictions-response.js` に足す | `api/_lib/predictionsResponse.js` | §3 の判定どおり（画面・hq が読まない欄だけ） | E2E・verify:ci が緑、hq の読み手が外れている |
| 3 観測で入れる＋CORS | middleware の matcher に `/api/:path*` を足し、`API_GATE_MODE=observe` で判定とログだけ。同時に `Access-Control-Allow-Origin: *` を `vercel.json` と関数の中（§2.1 ①の一覧）から外す（同じ origin の画面には CORS ヘッダは要らない。CORS はその場で効く） | `middleware.js`、`vercel.json`、関数の CORS 定数 | `vercel.json` はオーナー | §6 の `would_deny`・`bad_key` のうち自分の呼び出し元が0件の日が、平日・土日を含めて連続2日。かつ `ua_class=search_bot` の `would_deny` が0件、または扱いを決め済み |
| 4 外部を拒む | Vercel の環境変数 `API_GATE_MODE=enforce` → Redeploy | 本番の環境変数（コード変更なし） | オーナー | — |
| 5 回数の上限 | Vercel Firewall に `/api/`（cron・admin を除く）の IP ごとの上限。`x-ryujin-internal-key` が付いた要求は上限から外す（Vercel の関数の出口と Mac の hq は連続で取るので、IP で数えると先に 429 になる。偽の値を付けた要求は middleware が `bad_key` で拒むので抜け道にならない）。値は段階3のログの「画面の利用者1人あたりの最大の要求数」の実測から決める（根拠なしの数で決めない） | Vercel Firewall（本番） | オーナー（費用・プランの確認を含む） | — |

戻し方: 段階4は `API_GATE_MODE=observe` に戻して Redeploy（数分）。段階3は matcher を戻す PR。段階5は Firewall のルールを無効にする。

## 5. 受け渡し（hq）

hq（c2・c3）は hq のファイルなので、こちらからは書き換えない。段階1で次を渡す。

- `~/hq/platform/finals_run.py:125`（`urllib.request.urlopen(SCHEDULE_URL…)`）と `~/hq/scripts/full-picture-daily.sh:94`・`full-picture-lib.sh:11`・`~/full-picture/out/full-picture-template/*/analysis/fetch.cjs`・`stage.cjs:3`（`preflight()`）、hq の作業中の `scripts/full-picture-nightly.sh:33` の取得に、環境変数 `INTERNAL_API_KEY` があれば `x-ryujin-internal-key` を付ける
- §3 で外す欄を hq が読んでいないことの確認（前の調べでは hq に `predictions.safeBet` の参照がある、とされた。2026-10-27 の grep では `~/hq` の .py・.sh・.js・.cjs の本体に `safeBet`・`turnPrediction`・`inCaution` の参照は見当たらず、`company/tests/seo-human/fixtures/src/constants/index.js:43` の写しだけ。`~/full-picture/.../vendor/` の `hitCalculator.js`・`basicInfoStats.js` は本体の写しで、読むのは自前の材料。hq に最終の確認を頼む）

## 6. 誤って止めていないかを見る手順

1. **数える**: middleware の1行ログ（`api_gate`）を Vercel の Runtime Logs（または Observability）で、`reason` × `path` の先頭2段 × `ua_class` × 時間帯で数える。Runtime Logs の保持は短い（Pro の保持期間は未確認）ので、1日1回では取りこぼす。数える処理をスクリプトにして数時間ごとに回し（`scripts/maintenance/` に置く。作るのは段階3の PR）、結果を hq の朝の報告に載せる。保持が足りなければ Log Drain（新しい設定。オーナー承認）
2. **自分の呼び出し元を見分ける**: `bad_key` は配り間違い（外部と見分けるため別に数える）。`would_deny` のうち、`ua_class` が `node`・`python`・`curl`・無し で、時刻が hq の launchd の時刻（全貌動画・優勝戦）や cron の時刻と重なるものは配り漏れを疑う。§1.2 の表と照らして1件ずつ潰す
3. **キャッシュの前で効いているか・抜け道が無いか**（段階0の Preview と段階3の直後に1回）: キャッシュ済みの `/api/accuracy` をヘッダ無しの curl で2回叩き、2回目（`x-vercel-cache: HIT`）も `would_deny` のログが出る（強制の後は 403）こと。`/api/accur%61cy`・`/%61pi/accuracy` も関門に掛かるか、関数に届かないこと。どちらかが外れたら関門の置き場所を見直す（§2.1 補足）
4. **画面が通っているか**: 段階3の間、`reason=browser` が今までの API の要求数と同じ桁で出ていること。E2E（`e2e-live.yml`・c4 の素通し）と `bot-html-parity.yml` が緑。`ua_class=search_bot` の `would_deny` を別に見る（d2）
5. **強制の後**: 403 の件数を `ua_class` 別に毎日見る。`ua_class=browser` の 403 が出たら（古い端末で `Sec-Fetch-Site` を送らない等）、その UA を調べ、多ければ段階4を戻す
6. **回数の上限の後**: 429 の件数（Firewall のログ）。画面の利用者の 429 が出たら上限を上げる

## 7. オーナーの承認が要る所

| # | 何 | 段階 | なぜ承認が要るか |
|---|---|---|---|
| 1 | 鍵 `INTERNAL_API_KEY` の新設と配布（Vercel の Production・Preview、オーナーの Mac、GHA の secret） | 1 | 鍵とセキュリティ |
| 2 | `.github/workflows/bot-html-parity.yml` に secret を env で渡す1行（`environment: prod-jobs`）。e2e の3本には渡さない | 1 | `.github` の変更 |
| 3 | `vercel.json` の `/api/(.*)` の CORS ヘッダを外す | 3 | `vercel.json` の変更 |
| 4 | Vercel の環境変数 `API_GATE_MODE` の追加と `enforce` への切り替え | 3・4 | 本番の設定。外からの呼び出しを実際に止める |
| 5 | Vercel Firewall の回数の上限（含まれる範囲と超過の単価を先に確かめる。未確認）。検索ボットを止めていた場合の verified bots の許可。`/%61pi/` が関数に届いた場合に塞ぐルール | 3〜5 | 本番の設定・費用 |
| 5b | 任意: 即時の切り替えを Edge Config で持つ、ログの保持が足りなければ Log Drain | 3・4 | 新しい資源・費用の可能性 |
| 6 | 予想系を Supabase 側でも閉じるかどうか（§0、別チケット） | — | 費用・画面への影響、公開の方針 |

## 8. 範囲の外（別に扱う）

- **Supabase の匿名ロールで取れる範囲**（§0）。閉じるなら、匿名の RPC の GRANT を外し、画面の RPC 直のフォールバックをやめる設計が要る。オーナーの判断（§7 の6）
- BOA-1110 の4（公式の出走表・結果の再配布に当たる範囲と規約）。外への API を閉じれば API による再配布は無くなるが、画面に出す範囲の規約の確認は別
- 署名つきトークン（④）・Cloudflare（⑥）は、段階4の後のログでヘッダを偽る取得が目立ったら再検討

## 9. ADR と関係文書

- 新しい ADR: `docs/adr/0102-api-same-site-only.md`（この PR で追加。番号は PR 作成時の master の最大＋1）
- ADR-0089（ボット HTML）: 材料の取得（自分の `/api/races/today`・`/api/predictions`）と監視（`bot-html-parity`）が合言葉を前提にすることを、段階1の PR で注記する
- ADR-0032: matcher が `/api` に広がる注記と、「Edge Runtime（デフォルト）」の誤りの注記（ADR-0089:98 で既に指摘済み）を段階3の PR で足す
- ADR-0059 §2（ブラウザから呼ぶ公開の口は CRON_SECRET と別の方式、IP ごとの上限）: 段階5がこの未実装分を埋める
- `docs/proposal/ai-agent-era-strategy.md` の E（MCP）・J（有料 API）の取り下げを、その文書の冒頭に注記する（この PR）

## 10. 審査（system-architect、2026-10-27）の指摘と対応

| 重大度 | 指摘 | 確かめた根拠 | 対応 |
|---|---|---|---|
| P1 | 呼び出し元の漏れ: `verify-bot-html-parity.js` が Node の素の fetch で `/api/races/today` を叩く（GHA 毎日） | `:88,169` を読んで再現 | §1.2 に c3b を追加、段階1・§7 の2 を `bot-html-parity.yml` に |
| P1 | matcher はデコード前のパスで照合。エンコードで関門を外せる | `api/_lib/adminAuth.js:4-8` の実例 | §2.2 の判定を「`/api/*` 既定で関門、除外を名指し、デコード後で判定、失敗は 400」に。`/%61pi/` を段階0で実測、§6 の3 |
| P1 | 「環境変数を戻すだけで即時に戻る」は誤り。Redeploy が要る | Vercel の環境変数の仕様（既知） | §2.2・§4 の戻し方に Redeploy を明記。Edge Config は任意の案（§7 の5b） |
| P1 | Googlebot のレンダリングを止めるおそれ（ソナー・ライブオッズはフォールバック無し） | ADR-0089:110、WRS のヘッダは未確認 | §1.2 に d2、`ua_class=search_bot`、段階3の進む条件、verified bots（§7 の5） |
| P2 | hq の漏れ: `stage.cjs:3` の `preflight()`、作業中の `full-picture-nightly.sh:33` | `stage.cjs` を読んで再現 | §1.2 の c3、§5 に追加 |
| P2 | c4（vite proxy）に合言葉は要らない。PR ごとの CI に鍵を広げない | `vite.config.js:13,47`、同じ origin の GET の Fetch Metadata | 採用。c4 は配らない、§7 の2 から e2e を外した |
| P2 | middleware の既定は Node.js。定数時間比較は `constantTimeEqual` を再利用 | ADR-0089:98、`adminAuth.js:34-48` | §2.2 に追記 |
| P2 | 鍵の回し替え（新旧2つ）・環境ごとに別の値・`bad_key` の区分 | — | §2.2 の図と鍵の節、§6 の2 |
| P2 | Runtime Logs の保持が短い。1日1回の集計では取りこぼす | 保持期間は未確認 | §6 の1 を数時間ごとに、Log Drain は任意（§7 の5b） |
| P2 | 回数の上限で自分の呼び出し元が先に 429 | — | 段階5で合言葉の付いた要求を外す |
| P2 | `analogy/contribution`・`race-history/summary` は「守れる／一部」ではなく「守れない」 | `118_...sql:97-98`、`020_...sql:16`、`contribution.js:30-31` | §0 の表を直した |
| P3 | `botToday.js` は自分の /api を叩かない | `botToday.js:130-171` | b1 から外した |
| P3 | 汎用ループでも外す3モデルを飛ばす | `supabaseDataService.js:1106-1119` | §3 の standard の行に追記 |
| P3 | `ua_class` に「無し」、`browser` は抜き取り | `fetch.cjs:4`（https.get） | §2.2 に追記 |
| P3 | CORS は観測の段階が無くその場で効く。外す場所の一覧が不足 | `api/predictions/[date].js:25,47,82,96` 等 | §2.1 ①の一覧を補い、verify で固定 |
| P3 | `verify-middleware-routing.js` に `/api` の振り分け | — | §2.2・段階0 |
| — | 新しい ADR が要る | — | ADR-0102 をこの PR で追加、提案文書に取り下げを注記 |
