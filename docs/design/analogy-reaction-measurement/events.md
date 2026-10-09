# 龍神ソナー（BOA-271）の反応の計測

公開（#1312、2026-10-08）後の反応を測るための計測の約束。週1回のまとめと答え合わせは hq が作る。ここはデータが取れる状態までの定義。

設計1枚（オーケストレーターに送ったもの）: https://claude.ai/artifact/Jn3wusiii3Nzo2SZEz93fQ

## ファネルと GA4 のイベント

| 段 | イベント | パラメータ | いつ送るか |
|---|---|---|---|
| 着地 | `session_start`（GA4 自動） | — | — |
| レース詳細 | `page_view` | page_location | ページごと（BOA-531）。`?tab=`・`?boat=` は除いた URL で数える |
| AI予想タブ（押した） | `race_tab_select` | tab_id, from_tab_id, tab_count | タブを押したとき（BOA-454） |
| AI予想タブ（リンクで開いた） | `race_tab_initial` | tab_id | `?tab=` のリンクでタブを開いて、マウントしたとき1回。アプリ内のレースへのリンクは `?tab=` を付けないので、共有リンク・外部からの来訪と再読み込み |
| ソナー描画 | `analogy_section_view` | race_id, analogy_stage | 節の中身（facts）が出たらレースごとに1回（#1312） |
| ソナーが画面に入った | `analogy_section_visible` | race_id, analogy_stage | 節が画面に入ったらレースごとに1回。最後に見た時刻を localStorage `boatai-user:analogy-last-seen` に残す |
| タブ切り替え | `analogy_tab_select` | race_id, analogy_tab | 節の中のタブを押したとき（#1312） |
| 条件変更 | `analogy_control_change` | race_id, analogy_tab, analogy_control | 下の操作のどれかを変えたとき。選択中のものの押し直しは数えない（押し直しで選択を外す部品は `data-af-toggle` を付けて数える）。SVG の role="button" はキーボードの Enter・Space も数える。スライダー・選択肢は値が決まったとき（change）だけ |
| 2ページ目 | `page_view` | — | ファネル探索（Data API なら runFunnelReport）で `analogy_section_visible` → `page_view` |
| 7日以内の再訪 | `analogy_return_visit` | analogy_days_since（0〜7） | ページを開いた最初の page_view で、前回ソナーが画面に入ってから30分より後・7日以内なら1回（30分以内は同じ来訪とみなす。見た直後に別レースを新しいタブで開いただけで再訪にしない）。同じタブの再読み込みでは送らない（sessionStorage）。新しいタブは新しい来訪として数える |

`analogy_control` の値（部品に `data-af-control` で付ける。足すときはここにも足す）:

| 値 | 操作 | 場所 |
|---|---|---|
| stage | 時点（出走表・展示） | 上部 |
| target | 着順（1着・2着以内・3着以内） | 上部 |
| facts_boat | 艇 | 条件別の事実 |
| facts_radar_boat | 七角形の凡例で太くする艇（2艇まで。2026-10-09 に facts_compare（もう1艇と比べる）を置き換え。太い艇を押し直して外すのも数える） | 条件別の事実 |
| facts_radar_item | 七角形の項目名（6艇の表を開く・閉じる。Enter・Space も数える） | 条件別の事実 |
| facts_scope | 範囲（当地・全国 等） | 条件別の事実 |
| similar_range | 似ている範囲のスライダー | 類似レース |
| similar_boat | ソナーの扇（艇） | 類似レース |
| scenario_scope | 範囲 | 展開シナリオ |
| entry_pattern | 進入 | 展開シナリオ |
| slit_version | 手がかりの出どころ | 展開シナリオ |
| slit_form | 手がかりの形 | 展開シナリオ |
| slit_shape | スリットの形 | 展開シナリオ |

## 約束

- パラメータ名に GA4 の予約語（source・medium・campaign・term・content・id 等）を使わない。#656 で、カスタムイベントの `source` がセッションの流入元を Unassigned にした
- GA4 へ送るのは Cookie 同意済みのときだけ（`trackEvent` が `window.gtag` の有無で担保）
- 再現テスト: `e2e/analogy-contribution.spec.js`（イベント名・回数・パラメータ名）

## GA4 管理画面での登録（ユーザー操作）

2026-10-08 時点で GA4 に登録済みのカスタム定義は `app_language`（ユーザー範囲）だけ。イベントのパラメータは登録しないと、Data API でも画面でも内訳が出ない。登録前の過去分には遡らない。

イベント範囲で登録するもの: `tab_id`・`analogy_stage`・`analogy_tab`・`analogy_control`・`analogy_days_since`（画面の中の声を入れたら `analogy_verdict` も）。`race_id` は値の種類が多く (other) に潰れるので登録しない。

## 画面の中の声（マイグレーション143、モック承認 2026-10-08）

保存先は `analogy_feedback`（`docs/db-migration/143_analogy_feedback.sql`）。1回の回答は最大2行で、1段目を押した時点の `vote` と、「送る」の時点の `detail`。選び直した場合は `detail` の verdict が正。読むのは service_role（hq のまとめ）だけ。自由記述は原文保存・期限なし（2026-10-08 ユーザー決定）。まとめで引用するときはメール・電話番号らしい文字列を伏せる。

| イベント | パラメータ | いつ送るか |
|---|---|---|
| `analogy_feedback_view` | race_id | 質問が画面に入ったら1回（押下率の分母） |
| `analogy_feedback_vote` | race_id, analogy_verdict | 1段目を押したとき（選び直しも毎回） |
| `analogy_feedback_send` | race_id, analogy_verdict | 2段目の「送る」が保存できたとき |

押下率の注意: GA4 のイベントは Cookie 同意済みの人だけ、DB の行は同意に関係なく保存される。押下率は GA4 の view と vote（同じ母集団）で出し、DB の件数とは混ぜない。
