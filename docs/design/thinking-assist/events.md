# 思考アシスト（BOA-430）の GA4 のイベント

公開（#1379、2026-10-11 05:10 JST）後に、どのレンズ・深掘り・比較が使われ、どこで離れるかを見るための計測。spec には計測の決まりが無かったので、公開後に足した。送り方は龍神ソナー（`docs/design/analogy-reaction-measurement/events.md`）と同じ `trackEvent`（Cookie 同意済みのときだけ送る）。

ページの表示は `page_view`（`/race/{raceId}/assist`、BOA-531 の `trackPageView`）で見る。下のイベントは画面の中の操作だけ。

## イベント

| イベント | パラメータ | いつ送るか |
|---|---|---|
| `assist_view_switch` | race_id, assist_view, assist_entry | 上部の切り替えで、もう一方へ移ったとき（レース詳細・思考アシストの両方）。選択中の方の押し直しは送らない。タブ列のすぐ上の1行・AI用にコピーした直後のトースト（BOA-832）から思考アシストへ移ったときも送る |
| `assist_lens_select` | race_id, assist_lens | レンズを押して変えたとき。選択中のレンズの押し直しは送らない。ガイドの段で変わったときは送らない（`assist_guide_step` で分かる） |
| `assist_deep_open` | race_id, assist_boat, assist_lens | 図の艇を押して深掘りを開いたとき・別の艇に替えたとき、軸の要約の入口1行（「1号艇の差がつく材料 ›」）から開いたとき。開いている艇の押し直しは送らない |
| `assist_metric_compare` | race_id, assist_metric, assist_lens | 値を押して6艇比較にしたとき（図の中・深掘りの中の両方）。比較中の項目の押し直し（戻す）は送らない |
| `assist_sheet_open` | race_id, assist_sheet | シートを開いたとき |
| `assist_target` | race_id, assist_target, assist_lens | 買い目レンズの着順の切り替え（BOA-831。spec D-46 で軸から外し買い目だけ）を押して変えたとき。選択中の着順の押し直しは送らない |
| `assist_place_axis` | race_id, assist_boat, assist_lens | 相手レンズで「{X}号艇を軸にしたときの2着」の軸の艇を選び替えたとき（BOA-845、spec D-48）。選んでいる艇の押し直しは送らない |
| `assist_flow_form` | race_id, assist_form | 展開レンズで、図の上の結論のスリットの形を選び替えたとき（形が2つ以上当てはまるレースだけ。spec D-47、承認モック v2 ④）。選んでいる形の押し直しは送らない |
| `assist_guide_step` | race_id, assist_guide_step | ガイドの段を出したとき（「ガイド」で1段目、「次へ」「戻る」のたび）。閉じたときは送らない |

パラメータの値:

| パラメータ | 値 |
|---|---|
| assist_view | `race`（出走表とタブ）/ `assist`（思考アシスト） |
| assist_entry | `top`（上部の切り替え）/ `tab_row`（タブ列のすぐ上の1行、BOA-832）/ `copy_toast`（AI用にコピーした直後のトースト、BOA-832） |
| assist_lens | `axis`（軸）/ `flow`（展開）/ `power`（機力）/ `place`（相手、spec D-46）/ `bet`（買い目）。`assist_deep_open`・`assist_metric_compare` では押したときのレンズ |
| assist_boat | 1〜6（`assist_deep_open` は深掘りを開いた艇、`assist_place_axis` は軸に選んだ艇） |
| assist_metric | `nat_win` 全国勝率 / `loc_win` 当地勝率 / `st_mean30` 平均ST（直近30走） / `st_course` 平均ST（このコース） / `motor_2` モーター2連率 / `exh_time` 展示タイム / `exh_st` 展示ST（展開レンズの展示後の点の値から。spec D-47 で図から移した） / `series_score` 今節の平均着順点 |
| assist_sheet | `mark` マークシート / `rough` 堅い？荒れる？の材料 / `venue` 会場の特徴 / `theory` セオリーカード / `term` 用語 |
| assist_target | `1`（1着）/ `2`（2着以内）/ `3`（3着以内） |
| assist_guide_step | 1〜（段の番号） |
| assist_form | `flat` 横一線 / `wall` 内3艇そろう / `d2` 2コース凹み / `d3` カド受け凹み / `kado` カド一撃 / `d1` イン凹み / `dash` ダッシュ勢先行 |

## 約束

- 送るかどうかと中身は `src/utils/assistEvents.js` の `assistEventOf`（押す前の状態と操作から決める純関数）。切り替えだけは `AssistViewSwitch.jsx`・`AssistEntryRow.jsx`・`PredictionPanel.jsx`（コピー直後のトースト）
- パラメータ名に GA4 の予約語（source・medium・campaign・term・content・id 等）を使わない。#656 で、カスタムイベントの `source` がセッションの流入元を Unassigned にした
- 再現テスト: `scripts/maintenance/verify-thinking-assist-model.js`（名前・パラメータ・押し直しで送らない）、`e2e/thinking-assist-states.spec.js`「GA4 のイベント」（画面の操作から実際に送られる順と中身）

## GA4 管理画面での登録（ユーザー操作）

イベントのパラメータは、登録しないとレポートにも Data API にも内訳が出ない。登録した日より前のデータには遡らない。手順は `docs/design/analogy-reaction-measurement/ga4-custom-dimensions.md` の「手順」と同じ。

すべて「範囲: イベント」。`race_id` は値の種類が多く (other) に潰れるので登録しない（龍神ソナーと同じ）。

| ディメンション名 | 範囲 | 説明 | イベント パラメータ |
|---|---|---|---|
| アシストの表示 | イベント | 上部の切り替えで移った先（race=出走表とタブ / assist=思考アシスト） | `assist_view` |
| アシストの入口 | イベント | 思考アシストへ移った入口（top=上部の切り替え / tab_row=タブ列のすぐ上の1行 / copy_toast=AI用にコピーした直後のトースト） | `assist_entry` |
| アシストのレンズ | イベント | 思考アシストのレンズ（axis / flow / power / place / bet） | `assist_lens` |
| アシストの艇 | イベント | 思考アシストで深掘りを開いた艇番・相手レンズで軸に選んだ艇番（1〜6。イベント名で分ける） | `assist_boat` |
| アシストの比較項目 | イベント | 思考アシストで6艇比較にした項目（nat_win・st_mean30 等） | `assist_metric` |
| アシストのシート | イベント | 思考アシストで開いたシート（mark・rough・venue・theory・term） | `assist_sheet` |
| アシストの着順 | イベント | 思考アシストの買い目で選んだ着順（1=1着 / 2=2着以内 / 3=3着以内） | `assist_target` |
| アシストのガイドの段 | イベント | 思考アシストのガイドで出した段（1〜） | `assist_guide_step` |
| アシストのスリットの形 | イベント | 思考アシストの展開レンズで選んだスリットの形（d2・kado 等） | `assist_form` |
