# 計測と GA4

何を測るか・GA4 への登録・公開後の読み方。書き方は [README.md](README.md)。

## 仕様の段階で決めること
- 新しい画面・機能は spec の段階で「何を測るか（問い・イベント・パラメータ・GA4 に登録するディメンション）」を書く。思考アシストは spec に計測が無く公開後に足したので、足す前の期間は測れていない（2026-10-11、PR #1381）
- イベントの定義は機能ごとの events.md に置く（docs/design/analogy-reaction-measurement/events.md、docs/design/thinking-assist/events.md）
- 同じイベントで入口を分けたいときはパラメータで分ける。例 assist_view_switch の assist_entry = top / tab_row / copy_toast（BOA-832、docs/design/thinking-assist/events.md）
- GA4 のカスタムイベントのパラメータに source・medium・campaign・term・content・id を使わない。source だけ送ると流入元が上書きされ Unassigned になる（2026-09 に 71→259 件、PR #656 で link_source に改名、memory ga4_unassigned_source_param_collision_2026_09_15）

## GA4 への登録
- イベントのパラメータは GA4 にカスタムディメンションとして登録しないと、レポートにも Data API にも出ない（docs/design/analogy-reaction-measurement/ga4-custom-dimensions.md）
- 登録した日より前のデータには遡らない。公開と同時か前に登録する（同 ga4-custom-dimensions.md）
- 登録の手順は 管理 → データの表示 → カスタム定義 → カスタムディメンションを作成、範囲はイベント。オーナーが PC のブラウザで行う（同 ga4-custom-dimensions.md）
- race_id は値の種類が多く「(other)」にまとめられるので登録しない（同 ga4-custom-dimensions.md）
- イベント範囲のカスタムディメンションは標準プロパティで50件まで（同 ga4-custom-dimensions.md）
- 値がレポート・Data API に出るまで最大24〜48時間（同 ga4-custom-dimensions.md）
- ユーザー範囲のカスタムディメンション app_language は登録済み（2026-07-14、memory i18n_project、BOA-128）
- AdSense Management API はサービスアカウントで使えず、OAuth の refresh token が要る（2026-10-05、memory project_ai_multi_venture_ops_2026_10_05）
- Search Console のドメインプロパティは SEARCH_CONSOLE_SITE_URL を sc-domain:boat-ai.jp の形にする。GCP で Search Console API を別に有効化しないと権限エラーに見える（2026-07-27、memory venue_guide_expansion_project、docs/operation/search-console-report.md）

## 公開後の読み方
- 公開日をまたぐ比較は、登録日より前が欠けていないかを先に確かめる（ga4-custom-dimensions.md の「遡らない」から）
- 「特筆すべき動きが無い」も省略せず報告する（2026-08-25 の多言語 PV の漏れ、.claude/CLAUDE.md「調査・分析結果の報告原則」）
- シェア文・AIコピーは GA4 のイベントを送っていない。表示を変えた前後の利用は比べられないので、比べたいなら変える7日以上前にイベントを足す（2026-10-12、Data API と src/utils/share.js・useAiCopyText.js、docs/design/in-collapse-caution/measurement.md）
- `deep_link_click` の `link_source` と `tab` は GA4 に未登録で、内訳は Data API でも出ない（2026-10-12、getMetadata、同 measurement.md）
- レース詳細の中の動きを前後で比べる基準は 10/11 以降しか使えない（tab_id 登録 10/8、ソナー別タブ化 10/9 09:17、思考アシスト公開 10/11）（2026-10-12、同 measurement.md）
- 9/28 以前の / の PV にはレース詳細が混ざっている。ページ別の比較は 9/29 以降（2026-10-12、BOA-531、同 measurement.md）
- 置き場所を比べる機能は、イベントを共通にしてパラメータで置き場所を区別すると、後で動かしても前後がつながる（2026-10-12、同 measurement.md）
- GA4 の PV は 9/29（page_view の修正）と 10/1（内部トラフィックの除外）で切れる。注記は scripts/lib/ga4MeasurementBreaks.js が出す（2026-10-01、memory seo_keyword_strategy_2026_09_29）
- PV の絶対値は AdSense の PV とも突き合わせる（2026-09-29 の GA4 日本語 PV 29,270 に対し、同時期の AdSense の PV は 10,573）（2026-10-05、memory ai_agent_era_strategy_2026_10_05）
- i18n-demand-report.js 等の月別 PV を JST 9時より前に実行すると、期間の始まりが前月の末日になる（2026-10-06、memory project_ai_multi_venture_ops_2026_10_05）
- AI アシスタント経由の流入は GA4 で30日あたり26→7と小さい。AI 施策の成否は流入でなく、ボットの取得数と引用の定点チェックで見る（2026-10-05、memory ai_agent_era_strategy_2026_10_05）
- 2026-08 時点で直近30日のアクティブユーザーの約48%がリピーター、新規の翌週の定着率は約13%。リピーターは /hit-races・/accuracy をよく見る（2026-08-19、memory boatai_rebrand_investigation_2026_08_19）
- 定点観測は戦略文書に書いた本来の KPI と照合する。X の KPI はサイト送客（docs/operation/x-operations-playbook.md）なのに、/x-growth-report が X の中の指標だけを見ていた（2026-09-05、memory x_growth_report_evolution_2026_09、PR #530）
- sns_strategy_insights に登録するのは型・題材・投稿時間帯のように次の生成に効く知見だけ。操作の手順の改善は入れない（2026-09-06、memory x_growth_report_evolution_2026_09）

## 目標と収益
- 集客の目標は月間100万PV。基準は 2026-10-01〜12 の13,313PV（月に直して約3.3万、約30倍の差）。集客・SEO・SNS の施策は PV の伸びへの効き方で順位を付ける（2026-10-13 オーナー確認、memory project_pv_goal_1m_2026_10_13）
- AdSense は月約¥550、ページ RPM ¥52、広告が出るのは広告コードが動いたページの約3割（2026-10-05、memory ai_agent_era_strategy_2026_10_05、docs/proposal/ai-agent-era-strategy.md）

## 点検での見落としを防ぐ知見
- 制作完了・投稿承認・実投稿・指標取得は別の状態として記録し、実投稿を承認だけで補わない。（2026-10-13、2026-10-13-plan-1413.md）
- 広告向け動画の推奨を通常投稿の必須条件や効果の保証とせず、制作上の採用と公開後の観測を分ける。（2026-10-13、2026-10-13-task-46-x-entry-video.md）
- cronの稼働窓の終了と監視終了を別に確認し、終盤の停止でも監視閾値に達して検出できるか点検する。（2026-10-13、2026-10-13-plan-review-snsrunner-20261013-04.md）
- fakeのpublishedAt切替は実公開時刻の外部仕様の検証とせず、認可チャンネル・候補ID・承認版・実公開後の読取証跡で計測起点を確認する。（2026-10-13、2026-10-13-plan-review-youtube-20261013-01.md）
- 読取専用の初期選択クエリもpage_viewのURLへの混入を点検し、レース詳細で除く範囲と他ページで保持する範囲を確認する。（2026-10-13、2026-10-13-task-62-check-boa-847.md）
- sns-hubのX型比較のurl_link_clicks/impressionsは尺NULLや尺の違いを比較条件に使わず、その他のX指標・YouTubeの尺条件を維持し、サイト流入へ合算しない。（2026-10-13、2026-10-13-task-69-check-codex-patches.md）
- 動画の可読性・配置の改善は、共通素材への適用範囲を優先根拠にできるが、PV 増分の順位や月間目標に届く規模の根拠にならない。投稿後指標が欠測の間、品質レビューの合格数や比較案の数を集客の進捗として報告しない（2026-10-13、2026-10-13-plan-1826.md・2026-10-13-plan-2027.md）
- 目標値の指定期間と、受領した月次資料の終端が違うときは、同じ PV 値でも同一期間と断定しない（2026-10-13、2026-10-13-plan-2201.md）
- UTM campaign の DB 許可拡張は、URL への付与・content のキー・送信時刻・GA4 結合・レーン別集計がつながった証拠にならない（2026-10-13、2026-10-13-plan-review-20261013-08.md）
- クエリ除外は、通常の PageViewTracker と Cookie 同意直後の初回送信を別々に対応付ける。同意時に生の location.search を渡す経路があれば、通常経路の正規化だけでは艇選択を全送信から除外できない（2026-10-16、2026-10-16-review-20261016-06.md）
- 公開の規模一覧では閲覧日と出典側のデータ取得時点を別に残し、古い表示を現在の実数として扱わない。（2026-10-19、2026-10-19-competitor-discovery.md）
- 報告冒頭の合格表示と本文の未修正の重大指摘が食い違うときは、合格表示だけを次の制作計画の品質根拠にしない。（2026-10-19、2026-10-19-plan-1450.md）
- GA4の人数指標の要求に次元を足してから、その次元を落としてtotalUsersを加算すると同じ人を重複する。既存キーの人数は元の粒度で要求し、分割値の和を重複排除人数として保存しない。（2026-10-19、2026-10-19-review-20261019-04.md）
