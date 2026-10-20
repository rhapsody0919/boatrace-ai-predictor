# SNS 自動送信の運用と点検

SNS の自動送信（承認 snapshot・claim・runner・通知・容量・cron）の設計と点検で踏みやすい落とし穴。本番 DB の書き込み手順は [db-operations.md](db-operations.md)、cron・CI の一般的な落とし穴は [batch-and-ci.md](batch-and-ci.md)。書き方は [README.md](README.md)。

## SNS の送信（承認・claim・runner）
- SNS の送信を止めるのは許可のリスト（自動送信の job は item が notified かつ mode が自動のときだけ進める）にし、claim・check・begin_post・youtube_publish_begin の全部で見る。拒否のリストや下書きの状態の変更だけでは、送信中・要照合で 148 のガードが RAISE し止まらない（2026-10-12、system-architect、docs/design/sns-pdca-loop/plan.md §3）
- v0 素材の公開保留は5か所にある: sns_bundle_imports の CHECK、取り込みの関数、版×媒体×言語の一意索引、approve の bundle_import_id、transition_sns_send_139・youtube_call_guard の bundle_import_id。外すなら全部を変える（2026-10-12、135:8,26,89・139:137・146:174）
- 送信の契約は、毎日 daily_baseline_date（JST）と YouTube の baseline_day（PT）を当日にしないと claim できない（2026-10-12、139:144・146:143）
- PostgREST の upsert は式の一意索引（COALESCE）を on_conflict に使えない。NULL を含むキーは UNIQUE NULLS NOT DISTINCT の制約にする（本番は PG 17.6、2026-10-12）
- findQualifyingRaces は standard と unified のうち predicted_at の新しい方の1行を使う。unified にしか無いキーを条件にすると黙って0件になる（2026-10-13、system-architect、scripts/lib/snsCampaigns.js:141-158）
- bundle なしの送信単位を足すときは、承認/停止の RPC だけでなく contract の item 参照条件・本人承認時の検査状態・完了時の全件判定も kind ごとに確認する。DB 列を足しただけで呼出し側の接続・段階移行を完了としない（2026-10-13、2026-10-13-plan-review-20261013-08.md）
- 月更新の「1日始まり」はコメントだけでは設定値を保証しない。初期設定/renew が作れる期間・月加算を行う DB 時区・実請求期間を固定の証拠で合わせ、md5 一致と運用前提の成立を分ける（2026-10-13、2026-10-13-plan-review-20261013-08.md）
- 通知依存を持つ共通ヘルパーは、新しい呼出し側が既定の空 notify を使っていないか確認する。診断用の GET でも共通 token 取得が期限前 refresh と DB 保存をするなら、保存失敗の通知は呼出し側まで届く必要がある（2026-10-13、2026-10-13-plan-review-20261013-11.md）
- 通知依存の欠落を直す検査は、notify の mock 注入だけでなく、handler に env/fetch/DB だけを渡して既定の接続を通す。DB・通信 mock の合格を本番 default export・Edge 配備・実配達の成功と読まない（2026-10-14、2026-10-14-plan-review-20261014-02.md）
- 投稿別 risk の検査コードを直しても、版 hash が添付 bytes だけで決まり再登録が DO NOTHING なら、既存版の risk は更新されない。新規作成分の修正と既存下書きへの適用を分ける（2026-10-13、2026-10-13-plan-review-20261013-27.md）
- begin_post 前の媒体 validate が claim の後なら、外部送信は止まっても日次試行/クォータの予約と媒体の読込は進む。held の DB 理由と投げた例外の固有コードも別に確認する（2026-10-13、2026-10-13-plan-review-20261013-10.md）
- 共通の HTTP 応答処理で void RPC の空本文を許容するときは、実 store を通るゼロ長本文・空白のみ・JSON null・通常 JSON・不正 JSON・HTTP 失敗を分け、runner が後続の取得/claim/外部呼出しに進まないことを別々に検証する。SQL の RETURNS void は実 HTTP 本文の保存証拠ではない（2026-10-15、2026-10-15-plan-review-20261015-04.md）
- 受領した v1 検査結果と複製の v0 専用検査を区別する。参照版の容量・schema 拒否は現行 v1 の合否を示さない。警告が再現しないときは id・matchedPattern と版の証拠を依頼する（2026-10-14、2026-10-14-sns-v1-bundle-trial.md）
- 素材取り込み CLI の点検は、取り込み可能・公開可能・運用段階移行を分けて範囲と停止位置を指定する（2026-10-13、2026-10-13-plan-1728.md）
- 同じ SNS の仕組みでも cron の job が違えば、既存 runner の未配達持越しは新 runner へ自動では適用されない。manual/held_manual の再処理除外と、一度きりの通知の失敗時保存を同じ経路で見る（2026-10-14、2026-10-14-plan-review-20261014-01.md）
- runner が失敗結果にも report.alerts を返しても、共通 wrapper が成功時だけ report を保存するなら監視に届かない。未設定＋他媒体失敗の組合せを wrapper/store まで追う（2026-10-14、2026-10-14-plan-review-20261014-03.md）

## 容量・上限
- 容量・上限の境界は、上限より十分短い正常例と超過例だけで済ませない。ちょうどの正常例と+1の拒否を、生成→承認 snapshot→送信の各入口で分けて確認する（2026-10-15、2026-10-15-plan-review-20261015-03.md・2026-10-13-plan-review-20261013-23.md）
- 上限の単位（添付 file.size の和・multipart 全体・UTF-16 長・加重長・完成本文）は入口ごとに違う。どれに適用するかを明記する（2026-10-13、2026-10-13-plan-review-20261013-27.md・2026-10-15-plan-review-20261015-03.md）
- 再帰的な容量走査は、階層ごとの Promise.all を8にしても全体の同時取得数は8に収まらない。上限は共有キューで管理する（2026-10-13、2026-10-13-plan-review-20261013-13.md）
- 日ごとの容量の控えは、掃除が変えた古い日も無効化する。最近9日だけの再測定では、遅れた掃除後の合計が古いまま残る（2026-10-13、2026-10-13-plan-review-20261013-13.md）
- 保存期限の削除に探索下限（30日）を付けるなら、長期停止や後追加で残った分を回収する復旧経路も要る（2026-10-13、2026-10-13-plan-review-20261013-13.md）

## 巡回・時刻・監視
- 巡回候補の失敗理由は、検査なら job 単位、token なら実際に取得した channel 単位で保持/解消を分ける。dry_run で token を取らない回を token 回復としない（2026-10-14、2026-10-14-plan-review-20261014-04.md）
- 候補走査をページ循環へ変えると、各 tick で作り直していた失敗理由が次ページでは生成されず、監視前の report 上書きで消える。候補の進行と理由の保持を一緒に追う（2026-10-13、2026-10-13-plan-review-20261013-28.md）
- 要照合の通知を DB 状態から毎回作り直すなら、解消されず累積する状態は既定の上限を越えても回収できるページングか、明示した超過対応が要る（2026-10-14、2026-10-14-plan-review-20261014-04.md）
- sweep 直前の対象一覧を app の captured now で読み、SQL が別の now() で状態を移す場合、両時刻の間に期限に達した行が通知一覧から落ちる。固定時計の正常試験だけで境界を解消としない（2026-10-13、2026-10-13-plan-review-20261013-28.md）
- cron の稼働延長は、cron 最終起動予定・runner の処理継続・死活監視の終了を別々に記す。activeHoursJst が監視専用なら runner の時刻ガードの根拠にならない（2026-10-15、2026-10-15-plan-review-20261015-02.md）
- 新しい投稿時刻を保存する処理を既存 runner へ接続するときは、job 予定時刻だけでなく実 cron の UTC 式と監視の JST 開始も照合する。固定時計で DB の claim を直接呼ぶ検証は、定時起動を保証しない（2026-10-15、2026-10-15-plan-review-20261015-08.md）
- 「期間終了から自動切替」は、関数の定義だけでなく、その関数を呼ぶ cron の live 条件・適用版・次の実行時刻を合わせて読む。shadow では呼ばれず、終了時刻ちょうどの独立起動でもない（2026-10-14、2026-10-14-plan-review-20261014-05.md）
- job の live/shadow 切替は、チャネルの manual/auto・claim 前の dry_run・送信の paused/期間と別に確認する。shadow へ戻しても起動済みの run は取り消されず、DB の job 行数と実装された cron の種類数も一致するとは限らない（2026-10-14、2026-10-14-plan-review-20261014-06.md）
- 再生成処理の冪等性は下書きの版だけで判定せず、後続の tracking・item 検査結果・通知の完了まで区別する（2026-10-15、2026-10-15-plan-review-20261015-08.md）
- 複数レースを載せる投稿は、投稿自体の queue 期限と各候補の公式締切を分けて保存・照合する（2026-10-15、2026-10-15-plan-review-20261015-09.md）
- headless の回数上限は job 数と一致しない。runner の claim 前・送信内部・外部 API 直前を通算し、任意 cover など正常経路の最後まで枠が残るか確認する（2026-10-13、2026-10-13-plan-review-20261013-33.md）

## 点検での見落としを防ぐ知見
- 同一jobの後続成功や通知開始前の成功で先行失敗を消すと未通知になるため、未通知alertの保持を点検する。（2026-10-13、2026-10-13-plan-review-incaution-20261013-05.md）
- queueの先頭N件を毎回切る処理では、失敗や親待ちが候補枠を塞がないか、送信件数・検査件数・走査進捗を別々に確認する。（2026-10-13、2026-10-13-plan-review-snsrunner-20261013-04.md）
- 監視より短い周期で上書きするreportの一度きり事象は、即時通知だけに依存せず未配達の永続記録と後処理からの要照合の受け渡しを確認する。（2026-10-13、2026-10-13-plan-review-snsrunner-20261013-04.md）
- 媒体処理STATUSの応答欠落と正規の省略成功を区別し、空応答を完了に正規化して投稿へ進まないか点検する。（2026-10-13、2026-10-13-plan-review-xadapter-20261013-02.md）
- 分割アップロードのchunkサイズを変えたら、最大媒体のchunk数と1試行の費用上限の積算も照合する。（2026-10-13、2026-10-13-plan-review-xadapter-20261013-02.md）
- refresh成功後の条件付き保存が不成立のときは、確認用の再読取の失敗も通知対象に含め、再読取例外で元の理由や再連携案内が脱落しないか点検する。（2026-10-13、2026-10-13-plan-review-xoauth-20261013-03.md）
- 再連携とrefreshの競合は古いrefreshの保存0行と古いrefreshの失敗を分け、新行利用か停止かがspec未定義なら競合全体を解消済みとしない。（2026-10-13、2026-10-13-plan-review-xoauth-20261013-03.md）
- IDなしlookupの外部通信抑止と読取台帳の消費は別に確認し、外部通信0を台帳消費0としない。（2026-10-13、2026-10-13-plan-review-youtube-20261013-01.md）
- 全貌の YouTube の job（カバー画像なし）は、1回の実行で Chromium を6回使う（runner の検査1・送信の中の検査1・videos.insert の直前1・公開の準備の後の検査1・videos.update の直前1・videos.list の直前1）。上限6をちょうど使い切るので、同じ実行で前に何かが検査を使うと、非公開のまま残る（retain）（2026-10-20、system-architect、snsDeadlineQueue.js:100-143・snsHeadless.js:55）
- YouTube の upload→処理の確認→公開は1回の実行の中で終わり、終わらなければ youtube_retain。後の実行で続きをする経路は無い（dueJobs は queued だけを読む）（2026-10-20、system-architect、snsSendRunner.js:232-262,297）
- job の順番の待ち合わせは parent_job_id を使う。pickDueJobs で Chromium を使わずに外し、transition_sns_send_139 が claim で parent_not_posted として止める。claim の後に JS で待つと、日次の枠とクォータを使ったまま held で終わる（2026-10-20、system-architect、158:144-145・snsSendRunner.js:323-331。全貌の Shorts はこれで完全版を待つ、172）
- 期限切れの queued は sweep で held/deadline_expired になるが、Slack に知らせる経路は無かった。親を待つ子は、送る前の検査の alert も出ないまま切れるので、runner が期限の10分前から parent_waiting で知らせる（2026-10-20、system-architect、139:204-205）
- claim が日次の上限で例外になると、job は queued のまま残り、runner が2分ごとに Slack へ「送信が止まった」を送り続ける。全貌の YouTube が1レース2件になると daily_limit_youtube=2 は1日1レースで使い切る（2026-10-20、system-architect、158:169・snsSendRunner.js:203-210、本番の値は同日の読み取り）
