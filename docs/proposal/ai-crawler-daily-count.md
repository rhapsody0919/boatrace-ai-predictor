# AI クローラーの取得数を日次で測る方式（hq AI01、案のみ）

目的: 毎日1回、前日の UA 別の取得数と主なパスの上位を、鍵の無い CSV/JSON で hq が読める所に置く。`docs/proposal/ai-agent-era-strategy.md` §2「計測」の「ボット取得数（主）」（Vercel Pro のログ保持は1日なので、手で書き出す／Log Drain／Observability Plus のどれか）を決める材料。実装はまだしない。

## 1. 今取れる材料（2026-10-20 に実測・確認）

| 材料 | 何が取れるか | 保持・条件 | 出典 |
|---|---|---|---|
| Observability のクエリ（`POST /v2/observability/query`、指標 `vercel.request.count`、イベント `incoming_request`） | **CDN に来た全リクエスト**（静的ファイル・/api・middleware を通らないパスを含む）を `bot_name`・`request_path` 等で集計できる。生の UA は次元に無い（`user_agent` は「supported dimension ではない」と 400） | 開始が36日以内（それより前は 400「Query start must be within the last 36 days」）。このチームは Observability Plus が有効で、課金項目「Observability Events」が既に出ている（10/17 は $0.857/日、10/4 は $0.106/日） | Vercel MCP で実行（下の実測）、`list_billing_charges` |
| ランタイムログ（`get_runtime_logs`） | 関数・middleware の出力行。関数・middleware を通るリクエストだけ。関数のログは CDN にキャッシュされた分（bot-page は s-maxage=300、ADR-0089 決定4）が漏れる。middleware はキャッシュより前で動くので、matcher に入るパスなら HIT でも起動する（ADR-0089:128）。middleware は今ログを出さない（`middleware.js:82-99`） | 「Pro は1日」（ai-agent-era-strategy.md:119）は Observability Plus の契約前の記述。Plus での保持は未確認 | Vercel MCP の説明 |
| Log Drain | 全リクエストの `proxy.userAgent`（生の UA）・`path`・`statusCode` を外部に送れる | 今は0本（`list_drains` が空）。課金項目「Drains Volume」がある（10/17 は $0）。単価は未確認 | Vercel docs（Drains の JSON 形式）、`list_drains` |
| Firewall の traffic（`vercel firewall traffic list`） | 上位の UA・パス・verified bot | 既定は直近24時間。上位 N 件だけ | Vercel docs（CLI） |
| Web Analytics | 人のページビュー。ボットは数えない前提の機能 | — | — |
| middleware の matcher | `/`・`/venue/:path*`・`/blog/:path*`・`/racer/:path*`・`/today`・`/race/:path*`・言語版・`/winning-technique`（完全一致）・管理画面と管理 API（`/api/admin/sns-hub`・`/api/admin/rules`）だけを通す。`/robots.txt`・`/sitemap.xml`・`/llms.txt`・静的ファイル・それ以外の `/api/*`・`/about` 等は通らない | — | `middleware.js:23-60` |

実測（2026-10-19 UTC の1日、`bot_name` 別、全 163,737 リクエスト中。名前の付いたボットは計 2,830）: googlebot 1,008、bingbot 972、adsense 401、googleother 226、ahrefsbot 92、claudebot 48、oai-searchbot 47、chatgpt-user 10、gpt-actions 12、claude-user 4、perplexitybot 4、duckduckbot 4、applebot 1、gptbot 1、ボットと判定されない（`bot_name` が空）160,907。`bot_name × request_path` も1回のクエリで取れる（例: googlebot `/robots.txt` 219、googlebot `/winning-technique` 108）。

注意:
- `bot_name` は Vercel の判定。一覧に無い UA や、ブラウザを名乗るボットは空に入る。名前の付け方（`claude-user`・`chatgpt-user` 等）が依頼の一覧と1対1か、Perplexity-User が別名で出るかは未確認
- `bot_name` が空の 160,907 件は人の静的ファイル取得と区別できないので、名前の付かないボットの漏れの量は見積もれない
- Google-Extended は取得に使う UA ではなく robots.txt の名前（Google の説明）。取得数としては数えられない。Googlebot として数える

## 2. 案

(a)(a') は同じ材料（Observability のクエリ）で、取りに行く人と鍵の置き場所だけが違う。36日さかのぼれるので、数える粒度（日次）と取りに行く頻度は分けられる。

| | (a') hq が手元で週1回まとめて取る | (a) 毎日 Actions から取る | (b) middleware で数えて DB に upsert | (c) Log Drain |
|---|---|---|---|---|
| 仕組み | hq（オーナーの Mac）が Vercel CLI か Vercel MCP（OAuth、ログイン済み）で直近7日を日次の粒度で取り、`bot_name` 別・`bot_name × request_path` 上位の CSV/JSON を `data/analysis/` に PR で入れる | GitHub Actions が毎日、前日（JST）分を REST（`/v2/observability/query`）で取り、artifact か `data/analysis/` に置く | ボットの UA のときだけ `waitUntil` で `(日, UA の種類, パス)` の数を Supabase に足し、Actions が CSV に書き出す | Vercel が全リクエストのログを受け口（自前の関数 or 外部）に送り、そこで数える |
| 数え漏れ | 静的・/api・robots.txt・CDN HIT を含め全部数える。日の区切りは `bucketTimezone: "Asia/Tokyo"` で JST に揃えられる（確認済み: oai-searchbot は 10/18 JST 92 件・10/19 JST 61 件。上の実測表は UTC の1日）。漏れるのは Vercel が名前を付けない UA（生の UA は見られない）。hq が4週間続けて止まると36日を超えて欠ける | (a') と同じ。止まっても36日以内なら取り直せる | matcher に無いパス（robots.txt・sitemap・llms.txt・静的・/api・/about 等）を落とす。生の UA は見られる | 最も少ない（生の UA・全パス）。受け口が落ちた日は戻らない |
| 費用 | 追加なし。前提は Observability Plus の契約を続けること（外すと36日さかのぼりも止まる）。クエリ自体の課金は未確認 | (a') と同じ | Supabase の書き込み（1日数千件）。middleware を全パスに広げると TTFB と実行費用が全リクエストに乗る（ADR-0089:95 影響の節） | Drains Volume（単価未確認）＋受け口の実行。オーナー判断 |
| 本番への上乗せ | なし | なし | ボットのリクエストに書き込み（`waitUntil` の失敗は黙って消え、外で例外にするとボット向けページが 500） | 応答には乗らない |
| 鍵 | 増えない（hq の手元のログイン） | Vercel のトークンを新しく置く。トークンはプロジェクト単位・期限つきで作れる（`POST /v3/user/tokens` の `projectId`・`expiresAt`）が、読み取りだけに絞れるかは docs で見つからない。絞れなければ、そのプロジェクトの環境変数（`SUPABASE_SERVICE_KEY` 等）の読み出しやデプロイができ、今 Actions にあるどの鍵より強い。置くなら repo の secret ではなく master だけの Environment `prod-jobs`（ADR-0097:48-49）、`scripts/watch/job-watch.json` への登録（`verify-job-watch.js:181-188` が登録漏れで落とす）、key-canary への読み取り1回の追加（ADR-0097:128）、期限切れの扱い、ADR-0097 の鍵の一覧への追記が要る | 既存の Supabase の鍵。ただし middleware には service key を置けないので、anon で実行できる SECURITY DEFINER の RPC になる。UA は偽れる（ADR-0089 決定6）ので誰でも数を水増しでき、`/race/{id}` 等でパスの種類が毎日増える。PostgREST の upsert では `n = n + 1` が書けず RPC が要る | Drain の作成（チーム設定の変更）＋受け口の秘密 |
| 置き場所 | `data/analysis/` に PR（マージで本番デプロイが1回走る。hq が他の変更とまとめて入れれば増えない） | artifact は既存の保持が1〜7日で、hq が読むには Actions を読めるトークンが要る。`data/analysis/` への自動コミットは ryujin-bot の Environment が要り（update-sitemap.yml:24,61-68）、push のたびに本番デプロイが走る（vercel.json の除外は `codex/**` だけ。update-sitemap.yml:79-81 のようにデプロイフックも叩く作りだと2回。本番ビルド約8分・本番 DB を数千回読む、ADR-0032 追記） | Supabase → CSV（PostgREST の1000行上限は `.range()` で） | 受け口次第 |
| PR の規模 | 小: 取得スクリプト1本＋集計関数の verify（CI）＋手順。ワークフローなし | 小〜中: (a') ＋ワークフロー＋prod-jobs・job-watch・key-canary の登録 | 中: マイグレーション・RPC・middleware・書き出し・verify | 大: 受け口・署名検証・保存・集計・Vercel 設定 |
| 過去分 | 36日まで | 36日まで | 入れた日から | 入れた日から |

## 3. 推奨

**(a')**（Observability のクエリで数え、hq が手元で週1回、日次の粒度で取る）。理由:
- 静的ファイル・robots.txt・/api・CDN HIT まで数えられるのは Observability だけ（(c) を除く）で、本番に手を入れず、クエリ自体に課金が無ければ追加の費用は無い（§4 で確かめる）
- 36日さかのぼれるので、毎日取りに行く必要がない。週1回なら Vercel の強い鍵を GitHub に置かずに済む
- 生の UA が要るとわかったら (c) を足す（(a') の数字で必要性を判断する）。hq に依存したくなったら (a) に移す（条件は上の「鍵」の欄）
- (b) は数え漏れが大きく、水増しを防げず、本番に書き込みが乗るので採らない

ADR-0089 の監視の節（Vercel Observability でパス別件数を見る）と同じ方向で、ADR-0032・0089・0097 と矛盾しない。採用したら ai-agent-era-strategy.md:119 の「どれか」を (a') に書き換える。

決めてもらうこと（オーナー）:
1. Observability Plus を、この計測のために続ける前提でよいか（今の課金: 10/17 の Observability Events $0.857/日）
2. (a') hq が週1回取る（鍵は増えない。hq が止まると4週間で欠け始める）か、(a) Actions で毎日取る（Vercel のトークンを prod-jobs に置く。読み取りだけに絞れない可能性が高い）か

## 4. 未確認（実装の前に確かめる）

- Observability のクエリ自体に課金があるか（請求の「Observability Events」がクエリで増えるか）
- `/v2/observability/query` が公開・安定の API か、値が抽出・丸めでないか（1日分を (a') で手で取り、2026-10-19 の実測と同じ数が出るかで確かめる）
- `bot_name` の値の一覧（Perplexity-User、Claude-SearchBot、Applebot-Extended 等の名前）
- `bucketTimezone` で JST の日に区切った値が、UTC で時間単位に取って足し直した値と一致するか
- Vercel のトークンを読み取りだけに絞れるか（(a) を選ぶときだけ）
- Observability Plus でのランタイムログの保持期間
