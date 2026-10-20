# GA4 のイベント定義（レース詳細 → 龍神ソナー・思考アシスト）と計測の切れ目

出典は git（`origin/master` e395e3ccf、2026-10-20 11:40 JST。src は作業ツリーの HEAD 6104d9e50 と差分なし）と docs。日時は JST。計測開始日は、イベントを送るコードが master に入った日時（squash の commit 日時＝master 入り）。
ファイル:行は commit 済みの HEAD（6104d9e50）の行番号。docs/operation/search-console-report.md はこの PR で末尾に節を足しただけで、既存の行番号は変わらない

## 1. 送り方の共通部分
| 項目 | 内容 | 出典 |
|---|---|---|
| 送信関数 | `trackEvent(name, params)` → `window.gtag("event", …)`。gtag が無ければ送らない | src/utils/analytics.js:90〜94 |
| Cookie 同意 | 今は gtag を同意済み（`accepted`）のときだけ読み込む。同意しない・未回答の人のイベントと page_view は GA4 に来ない。ただし 2026-09-29 までは別経路があった（6章） | src/utils/analytics.js:20〜25、3a7ef6d6c（2026-02-16 09:42）、253b97f75 本文 |
| page_view | `trackPageView` だけが送る（`send_page_view: false`）。レース詳細の `?tab=`・`?boat=` は除いた URL で1件。ルート変化から 500ms 後 | src/utils/analytics.js:55・74〜87、src/AppRouter.jsx:138〜150、src/utils/raceUrlState.js:57、253b97f75（#935、2026-09-29 12:45） |
| 管理画面 | /admin 系（言語接頭辞付きも）では gtag を読み込まない・page_view を送らない | src/utils/analytics.js:37〜39・60〜61（#935） |
| 予約語 | パラメータ名に source・medium・campaign・term・content・id を使わない | docs/design/analogy-reaction-measurement/events.md:44、docs/knowledge/measurement.md:9 |

## 2. 龍神ソナー（sonar、BOA-271）
公開: #1312（68a91ee3d、2026-10-08 11:25、`ANALOGY_FINDER_PUBLIC=true`）。それより前は `?analogy=1` のプレビューだけ（src/config/featureFlags.js:15・45）。2026-10-09 09:17（#1333、5b5219a82）に AI予想タブの中から独立タブ（tab_id=`sonar`、src/utils/raceUrlState.js:21）へ移った。

| イベント | パラメータ | 送る場所 | いつ | 計測開始（master 入り） |
|---|---|---|---|---|
| `race_tab_select` | tab_id（ソナーは `sonar`）, from_tab_id, tab_count | src/components/race/RaceTabs.jsx:139〜143 | タブを押したとき。AI予想タブの中の案内（onOpenSonar・onOpenSonarSimilar）から移ったときも同じ（src/components/race/PredictionPanel.jsx:574〜595 → requestedTab） | 2026-09-28 15:07（d3c0a9fb7、#890）。tab_id=`sonar` が出るのは 10/09 09:17（#1333）から |
| `race_tab_initial` | tab_id | src/components/race/RaceTabs.jsx:63 | `?tab=` のリンクで開きマウントしたとき1回（共有リンク・外部からの来訪・再読み込み） | 2026-10-08 14:07（dd05b2a51、#1320） |
| `analogy_section_view` | race_id, analogy_stage | src/components/race/analogy/AnalogyFinderSection.jsx:120 | 節の中身が出たらレースごとに1回 | 2026-10-08 11:25（68a91ee3d、#1312） |
| `analogy_section_visible` | race_id, analogy_stage | 同 :138 | 節が画面に入ったらレースごとに1回。localStorage `boatai-user:analogy-last-seen` を記録 | 2026-10-08 14:07（#1320） |
| `analogy_tab_select` | race_id, analogy_tab | 同 :278 | 節の中のタブを押したとき | 2026-10-08 11:25（#1312） |
| `analogy_control_change` | race_id, analogy_tab, analogy_control | 同 :154・:189 | 条件を変えたとき（値の一覧は events.md:24〜40） | 2026-10-08 14:07（#1320） |
| `analogy_return_visit` | analogy_days_since（0〜7） | src/utils/analytics.js:136 | 最初の page_view で、前回ソナーを見てから30分超・7日以内なら1回 | 2026-10-08 14:07（#1320） |
| `analogy_feedback_view` / `_vote` / `_send` | race_id（vote・send は analogy_verdict も） | src/components/race/analogy/AnalogyFeedback.jsx:92・112・147 | 画面の中の声 | 2026-10-09 09:17（#1333） |

定義の正本: docs/design/analogy-reaction-measurement/events.md:7〜20・54〜62。切り替え日をまたいで「開いた」・section_view を比べない（同 :22）。

## 3. 思考アシスト（assist、BOA-430）
公開: #1379（34ac2ebb8、2026-10-11 05:10、`THINKING_ASSIST_PUBLIC=true`）。ja だけ（src/components/race/assist/AssistEntryRow.jsx:19、PredictionPanel.jsx の判定）。ページは `/race/{raceId}/assist`（src/AppRouter.jsx:197）。

| イベント | パラメータ | 送る場所 | いつ | 計測開始（master 入り） |
|---|---|---|---|---|
| `page_view`（/race/{id}/assist） | page_location | src/utils/analytics.js:81 | ページ表示 | 公開と同時（2026-10-11 05:10） |
| `assist_view_switch` | race_id, assist_view（race / assist）, assist_entry（top / tab_row / copy_toast） | top: src/components/race/assist/AssistViewSwitch.jsx:31、tab_row: AssistEntryRow.jsx:23、copy_toast: src/components/race/PredictionPanel.jsx:228 | レース詳細⇄思考アシストを移ったとき | イベント 2026-10-11 07:18（c4b4dadb9、#1381）。tab_row は 10-11 09:43（78808361a、#1385）、copy_toast は 10-11 10:39（c3d7e668c、#1387） |
| `assist_lens_select` | race_id, assist_lens | src/utils/assistEvents.js:18〜24 → src/pages/ThinkingAssistPage.jsx:250（race_id を付ける） | レンズを変えたとき | 2026-10-11 07:18（#1381） |
| `assist_deep_open` | race_id, assist_boat, assist_lens | assistEvents.js:25〜32 | 深掘りを開いた・替えたとき | 同 |
| `assist_metric_compare` | race_id, assist_metric, assist_lens | assistEvents.js:33〜39 | 6艇比較にしたとき | 同 |
| `assist_sheet_open` | race_id, assist_sheet | assistEvents.js:70〜81 | シートを開いたとき | 同 |
| `assist_guide_step` | race_id, assist_guide_step | assistEvents.js:63〜69 | ガイドの段を出したとき | 同 |
| `assist_target` | race_id, assist_target, assist_lens | assistEvents.js:40〜46 | 買い目の着順を変えたとき | 2026-10-11 19:18（549aa644f、#1391） |
| `assist_flow_form` | race_id, assist_form | assistEvents.js:47〜54 | 展開レンズの形を変えたとき | 2026-10-12 15:19（7676c4c5d、#1411） |
| `assist_place_axis` | race_id, assist_boat, assist_lens | assistEvents.js:55〜62 | 相手レンズの軸の艇を変えたとき | 2026-10-12 19:28（e4c99930b、#1412） |

定義の正本: docs/design/thinking-assist/events.md:9〜33。

## 4. 参考: ソナー・アシストへ移る他のイベント（未公開）
| イベント | パラメータ | 送る場所 | 状態 |
|---|---|---|---|
| `caution_visible` / `caution_click`（caution_target に `sonar`・`assist`） | race_id, caution_surface, caution_target, caution_band, caution_placement | src/utils/cautionEvents.js:61〜84、src/components/race/InCautionCard.jsx:82・93・250・267、src/components/race/assist/RoughCard.jsx:67 | コードは 2026-10-18 08:46（822c334c6、#1611）から。`IN_CAUTION_PUBLIC=false`（src/config/featureFlags.js:22）で一般には出ていない。定義は docs/design/in-collapse-caution/measurement.md:18〜28 |

## 5. GA4 のカスタムディメンション登録の記録
| ディメンション（パラメータ） | 範囲 | 登録日 | 出典 |
|---|---|---|---|
| app_language | ユーザー | 2026-07-14 | docs/knowledge/measurement.md:18（memory i18n_project） |
| tab_id | イベント | 2026-10-08 | docs/design/in-collapse-caution/measurement.md:7、docs/knowledge/measurement.md:27 |
| analogy_stage・analogy_tab・analogy_control・analogy_days_since・analogy_verdict | イベント | 不明・登録手順（docs/design/analogy-reaction-measurement/ga4-custom-dimensions.md）はあるが、登録した日の記録が無い | 同 ga4-custom-dimensions.md:5〜16、events.md:50〜52 |
| assist_view・assist_entry・assist_lens・assist_boat・assist_metric・assist_sheet・assist_guide_step・assist_target（・assist_form） | イベント | 2026-10-11（assist_form は report.js の一覧に無く、登録日不明） | scripts/analysis/assist-ga4/report.js:34〜50・186、docs/design/thinking-assist/events.md:47〜57 |
| caution_surface・caution_target・caution_band・caution_placement | イベント | 不明・未登録か登録済みかの記録が無い（計画は「公開の前日まで」） | docs/design/in-collapse-caution/measurement.md:37〜46 |
| link_source・tab（deep_link_click） | — | 未登録（2026-10-12 時点、getMetadata で確認） | docs/knowledge/measurement.md:26 |

- 登録日より前には遡らない（docs/design/analogy-reaction-measurement/ga4-custom-dimensions.md:3）
- docs/design/in-collapse-caution/measurement.md:46 に「登録済み14件」とあるが、14件の内訳は書かれていない
- 公開後の読み取り: `scripts/analysis/assist-ga4/report.js`（本番ホストだけ、Preview は excludedHosts）、結果 data/analysis/assist-ga4/2026-10-11.json（docs/design/thinking-assist/events.md:61〜67）。ソナーの読み取りスクリプトは repo に無い（週1回のまとめは hq が作る、events.md:3）

## 6. 内部トラフィック・タイムゾーン・計測の切れ目
| 日付 | 内容 | 比較への影響 | 出典 |
|---|---|---|---|
| 2025-12-17〜2026-09-29 | src/App.jsx が Cookie 同意を見ずに gtag を初期化し、`config`（page_path 付き）とタブごとの `page_view` を送っていた（#935 本文「App.jsx の同意なしGA二重初期化とタブ毎の page_view 送信を削除」）。App を描画するのは /、/hit-races、/accuracy、/picks、/privacy、/terms、/contact（5月時点）。同意の経路（analytics.js の initGA）は 2026-02-16 から別にある | 同意しない人もこれらのページを開くと計測されていた | 222e615d2（2025-12-17）、52dc28762:src/App.jsx:86〜123、52dc28762:src/AppRouter.jsx、253b97f75（#935） |
| 2026-08-29 21:02 | / の描画が App から VenueGridPage に変わった（#415）。以後、/ に着地した同意しない人は、App を描画するページ（/hit-races 等）へ移らない限り計測されない。**コードからの帰結で、docs・ga4MeasurementBreaks.js・seo-measures.json に記録なし**。自然検索の着地の多い / の GA4 の数がこの日から下がって見えうる | この日の前後で / の PV・ユーザー数を比べない候補 | 6c5683315:src/AppRouter.jsx:165、a2900cfe0（8/29 20:00 時点の master）の AppRouter.jsx（path="/" は `<App tab="races">`） |
| 2026-02-16〜 | 同意の経路（initGA）。9/29 以後はこれだけ | 9/29 以後の GA4 の数は同意した人だけの母集団 | src/utils/analytics.js:20〜25、3a7ef6d6c |
| 2026-07-14 | user property `app_language` を送り始めた | 切れ目ではない | 5233da24d → 53f33b731（#119、07-14 13:41）、src/utils/analytics.js:143〜146 |
| 2026-08-31 12:00〜09-15 18:52 | `deep_link_click` の `source` パラメータが GA4 の予約語と衝突し、送った人のセッションの流入元が Unassigned に上書きされた（9月に Unassigned 259セッション）。Organic Search 等のチャネル別の数がこの期間だけ減って見えうる | **ga4MeasurementBreaks.js・seo-measures.json に未登録** | 6ceba491c（#435）、ad9cea7f5（#656）本文 |
| 2026-09-29 13時ごろ | page_view を1経路に統一、拡張計測「ブラウザの履歴イベント」OFF。以前は会場・レース詳細の閲覧が "/" に混ざっていた | 前後で PV を比べない | scripts/lib/ga4MeasurementBreaks.js:12〜18、253b97f75（#935）、data/analysis/search-console/seo-measures.json |
| 2026-10-01 | GA4 管理画面で運営者の内部トラフィックを除外（ユーザー設定） | 前後で PV・ユーザー数を比べない | scripts/lib/ga4MeasurementBreaks.js:19〜24、docs/operation/search-console-report.md:100、seo-measures.json `ga4-internal-traffic-filter` |
| 2026-10-08〜11 | tab_id 登録（10/8）、ソナー別タブ化（10/9 09:17）、思考アシスト公開（10/11） | レース詳細の中の動きの前後比較は 10/11 以降 | docs/knowledge/measurement.md:27、docs/design/in-collapse-caution/measurement.md:7 |

- 内部トラフィック除外の条件（IP 等）・設定時刻: 不明・記録はユーザー設定としての日付だけ。Admin API v1alpha で読めない（scripts/analysis/ga4-organic-weekly-export.js の notes.internalTraffic）
- GA4 プロパティのタイムゾーン: 不明・docs・コミット済みのコードに記録なし。scripts/analysis/ga4-organic-weekly-export.js（この PR）が `settings.property.timeZone` を読む作りだが、同じフォルダの ga4-organic-0427-1019.json・ga4-organic-0928-1019.json の `settings.property` は「Google Analytics Admin API has not been used in project … or it is disabled」のエラーで読めていない（GCP で Admin API を有効にすれば読める）
- 参考: 月別 PV を出す i18n-demand-report.js 等を JST 9時より前に走らせると期間の始まりが前月末になる（スクリプト側の日付計算の話で、GA4 のタイムゾーンとは別）（docs/knowledge/measurement.md:32）
- 参考: GA4 の PV は AdSense の PV と大きく食い違う（9/29 時点 GA4 ja 29,270 に対し AdSense 10,573）（docs/knowledge/measurement.md:31）
- 5〜8月の GA4 の計測コードの変更: 7/14 の app_language、7/31 の src/App.jsx の GA 初期化の書式変更（#160。中身は同じ）、8/29 の / の描画元の変更（#415、上表）、8/31 の deep_link_click（`git log -G'trackEvent\(|gtag\(' -- src`）
