# 計測の設計（BOA-822、2026-10-12 measurement-planner）

## 要点
- 展開予測を消しても GA4 から消えるイベントはほとんど無い（シェア・AIコピーはもともと送っていない）。消えるのは `race_tab_select`/`race_tab_initial` の `tab_id=aiPrediction`（置き場所の案B のとき）と `deep_link_click`（`link_source=volatility_display`）
- 注意度を測るイベントは今は無い。新しく `caution_visible`・`caution_click` を作り、カスタムディメンション4件を公開の前日までに登録する
- 置き場所の2案は同じイベントで測り、`caution_placement` で区別する
- 基準の期間は 10/11 から公開前日まで（10/8 tab_id 登録、10/9 ソナー別タブ化、10/11 思考アシスト公開）。7日以上、できれば14日取ってから公開する

## 問いと指標

| # | 問い | 指標 |
|---|---|---|
| Q1 | 注意度は見られているか | `caution_visible` の人数 / レース詳細の人数 |
| Q2 | 注意度から次（ソナー・思考アシスト・/accuracy）に進むか | `caution_click`（行き先別）の人数 / `caution_visible` の人数 |
| Q3 | ソナー・思考アシストに届く人は増えたか | `race_tab_select` tab_id=sonar・`assist_view_switch` assist_view=assist の人数 / レース詳細の人数 |
| Q4 | 注意度の高いレースに閲覧が寄るか | ホーム・一覧・/today からの `caution_click`（target=race）の帯別件数 |
| Q5 | AI予想タブの閲覧の変化（案A）／タブが無くなって離れた人はいないか（案B） | `race_tab_select` tab_id=aiPrediction の人数・レース詳細の1人あたり PV |
| Q6 | 作り替えた /accuracy は見られているか | /accuracy の PV・人数（301 を含む）、自然検索の着地 |
| Q7 | 古い `?tab=aiPrediction` のリンクの取りこぼし | page_location に `tab=aiPrediction` を含む page_view |

## イベント

| イベント | パラメータ | いつ送るか |
|---|---|---|
| `caution_visible` | race_id, caution_surface, caution_band, caution_placement | レース詳細の注意度が画面に入ったとき、レースごとに1回。ホーム・/today・/accuracy は欄が画面に入ったときにページごとに1回（race_id・band なし） |
| `caution_click` | race_id, caution_surface, caution_target, caution_band, caution_placement | 注意度の表示から次へ移ったとき |

| パラメータ | 値 |
|---|---|
| caution_surface | `race_detail` / `home_highlight` / `race_list` / `today` / `accuracy` / `assist_rough` |
| caution_target | `sonar` / `assist` / `accuracy` / `race` |
| caution_band | 3段のキー `low` / `mid` / `high`、件数不足は `insufficient`（生の%は送らない） |
| caution_placement | `ai_tab`（案A）/ `basic_top`（案B）。race_detail 以外は付けない |

送るかは純関数で決め（思考アシストの `assistEventOf` と同じ形）、再現テストを e2e と verify に置く。予約語（source・medium・campaign・term・content・id）は使わない。

## GA4 に登録する行（範囲はすべてイベント、race_id は登録しない）

| ディメンション名 | パラメータ |
|---|---|
| 注意度の場所 | `caution_surface` |
| 注意度の行き先 | `caution_target` |
| 注意度の帯 | `caution_band` |
| 注意度の置き場所 | `caution_placement` |

登録済み14件＋1件に足して18件（上限50）。

## 読む時期と判断

| 時期 | 見ること | 判断 |
|---|---|---|
| 公開の翌々日 | 新イベントと4ディメンションに値が入っているか | 入っていなければ直す |
| 7日後 | 母数、Q1〜Q3、Q7 | レース詳細の人数が基準より20%以上動いたら外の要因を疑い、判定を14日後に延ばす |
| 14日後 | Q2〜Q6 を基準と比べる | 成功: Q3 が基準以上かつレース詳細の1人あたり PV が下がらず、`caution_click` の行き先に sonar・assist が出る。見直し: PV か Q3 が目安10pt以上下がる、visible 100人超で click がほぼ0、案B で `?tab=aiPrediction` の直帰が目立つ |
| 28日後 | /accuracy の自然検索の着地、/hit-races の表示回数が移ったか | 移っていなければ 301・canonical を確かめる |

人数が少ない（13日でレース詳細 224人）ので、割合の差が約10pt未満は読み取れない前提。注意度が「当たる」と思われたかは GA4 では測れない。

## 参考（Data API、2026-09-29〜10-11、www.boat-ai.jp）

| 項目 | PV・件数 | 人数 |
|---|---|---|
| レース詳細 | 5,716 | 224 |
| /today | 260 | 45 |
| /accuracy | 116 | 48 |
| /hit-races | 71 | 38 |
| race_tab_select tab_id=aiPrediction（10/8〜） | 666 | 63 |
| race_tab_select tab_id=sonar（10/8〜） | 458 | 53 |

## 依頼元で決めること
- `ai_copy`・`race_share` のイベントを公開の7日以上前に足すか（足さないと、AIコピーの展開予測の節・シェア文を消した影響は比べられない）
