# ADR 0103: /api は自サイトと自分の処理だけが使う

## ステータス

提案（2026-10-27）。設計の正本は [docs/design/public-api-lockdown/plan.md](../design/public-api-lockdown/plan.md)（BOA-1110）。

関係する ADR: [ADR-0032](./0032-ai-crawler-snapshot-delivery.md)（AI クローラー向けスナップショットと middleware）、[ADR-0059](./0059-new-endpoint-timeout-security-monitoring-standards.md) §2（ブラウザから呼ぶ口は CRON_SECRET と別の方式、IP ごとの上限）、[ADR-0066](./0066-scraping-execution-consolidation-to-vercel.md)（cron の基盤）、[ADR-0089](./0089-bot-html-for-daily-pages.md)（ボット HTML の材料と監視）。

## 背景

- `/api/*` に `Access-Control-Allow-Origin: *`（`vercel.json` と各関数）があり、鍵なしで誰でも取れた。龍神ソナー（`/api/analogy/facts・similar・scenario・layer`）はサービスキーで非公開の Storage を読む独自の集計で、外から丸ごと取れた。`/api/odds/live` は呼ばれるたびに boatrace.jp を取りに行く
- 外部の AI 向けに API・MCP でデータを出す案（`docs/proposal/ai-agent-era-strategy.md` の E・J）があった
- オーナーの決定（2026-10-27）: 外部の AI 向けにデータを出す方針はやめる。API は自分のサイトで使う分だけにし、外からの呼び出しは一旦禁止する

## 決定

1. `/api/*` は自サイトの画面と自分の処理（Vercel の関数・cron、オーナーの Mac の hq、GitHub Actions の監視）だけが使う。外部への公開の API・MCP は出さない。AI 検索向けの HTML（ボット HTML・静的スナップショット）は公開ページの写しなので続ける
2. 関門は `middleware.js` に置き、`/api/*` を既定で通し、除外（`/api/cron/*`・`/api/admin/*`・`/api/bot-page/*`。それぞれ既存の守りがある）だけを名指しする。除外の判定はデコードしたパスで行う
3. 通すのは、合言葉のヘッダ（`x-ryujin-internal-key`、環境ごとに別の値、新旧2つを受け付けて回し替える）が一致する要求と、`Sec-Fetch-Site: same-origin`（無ければ同じ host の `Referer`）のブラウザの要求と、UA と公開の IP 範囲の両方で確かめた検索ボット（Googlebot・bingbot）の要求だけ。観測（通してログ）→強制（403 no-store）の2段で入れ、強制の前に検索ボットの疎通試験を通す
4. CORS の `*` を外す
5. 最後に Vercel Firewall で IP ごとの回数の上限を置く（合言葉の付いた要求は外す）

## 却下した選択肢

- **CORS だけで絞る**: ブラウザの別サイトの JS にしか効かず、curl・サーバー・AI のツールは止まらない
- **画面に短命の署名つきトークン**: ページを開けば誰でも取れるので、ヘッダの確認より止められる相手がほとんど増えず、全ページの HTML を middleware に通す手間と壊れ方が大きい。ヘッダを偽る取得がログで目立ったら再検討
- **Cloudflare を前に置く**: DNS の切り替え・二重のキャッシュで後戻りしにくい。Vercel Firewall で足りる

## 影響と限界

- ヘッダを偽る相手・本物のブラウザで取る相手は止まらない。回数の上限で速度を落とすところまで
- **Supabase の匿名キーで取れるデータは範囲外**。`/api/predictions`・`races/today`・`accuracy`・`outcome-distribution`・`race-history/summary`・`analogy/contribution` の元のデータは匿名キーで読める（公開バンドルに匿名キーがある）。閉じるなら別の設計（匿名の GRANT と画面の RPC 直のフォールバック）とオーナーの判断が要る
- ボット HTML の関数（ADR-0089）と SNS の cron、全貌動画の材料、hq の取得、GitHub Actions の `bot-html-parity` は合言葉が前提になる
