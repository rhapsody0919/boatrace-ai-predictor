# GS04 お気に入り（選手・会場の☆）と「お気に入り選手の出走」（BOA-1265）

見た目の正本は承認済みのモック（`mock/APPROVED.md`・`mock/gs04-375.png`・`mock/gs04-1440.png`）。この文書は、モックに描けない決まりだけを書く。

## 1. 保存のキーと形

- 保存はこの端末のブラウザの localStorage だけ。ログイン・サーバーへの保存はしない
- キーは `boatai-user:favorites:v1` の1つ。`boatai:` で始めない（`boatai:` はデータのキャッシュの全削除 `dataService.clearCache()` で消える。ユーザーの保存は `boatai-user:`。例 `src/utils/raceView.js`・`src/utils/pastRate/storage.js`）
- 値は JSON

```json
{ "racers": [4320, 3941], "venues": [12, 1] }
```

  - `racers`: 選手の登録番号（整数）。追加した順（古い順）。重複なし
  - `venues`: 会場コード（1〜24 の整数）。追加した順。重複なし
- 読むときの扱い（純関数で書き、`scripts/maintenance/verify-favorites-store.js` で固定する）
  - キーが無い → `{racers: [], venues: []}`
  - JSON として読めない・形が違う → `{racers: [], venues: []}` として扱い、`console.error` に理由を出す。読めなかった値は、次に☆を押して書くまで消さない
  - 整数でない値・範囲外の会場コード・重複は落とす。`racers` が31件以上あれば先頭の30件だけ使う
  - localStorage が使えない（プライベートモード等で例外）→ 空として扱い、☆を押したら「保存できない」の知らせを出す（書けなかったことを握りつぶさない）
- 同じ端末の別のタブで変えたら `storage` イベントで追随する。同じタブの中の別の☆（トップと出走表など）は、1つの購読（`useSyncExternalStore`）で同時に変わる

## 2. 上限と、上限を超えたときの知らせ

| 種類 | 上限 | 上限で☆を押したとき |
|---|---|---|
| 選手 | 30人 | 追加しない。知らせ「お気に入りの選手は30人まで。追加するには、ほかの選手を外す。」を6000ms 出して消す。閉じるボタンは無し（2026-11-04 Orchestrate の決定。閉じるボタンは別の起票）。`src/components/Toast.jsx` の `duration` を使う |
| 会場 | 無し（24場すべて可） | ― |

- 外す（★を押す）は上限に関係なくいつでもできる
- 追加したときの知らせ（選手ページ）: 「お気に入りに追加した。今日の出走はトップの『お気に入り選手の出走』に出る。」

## 3. GA4 の事象

送るのは `src/utils/analytics.js` の `trackEvent`。引数に `source`・`medium`・`campaign`・`term`・`content`・`id`・`utm_*` を使わない（`docs/knowledge/measurement.md`）。

| 事象 | いつ | 引数 |
|---|---|---|
| `favorite_add` | ☆を押して追加できたとき（上限で追加しなかったときは送らない） | `fav_type`: `racer` / `venue`、`fav_entry`: 入口（下）、`fav_count`: 追加した後のその種類の件数 |
| `favorite_remove` | ★を押して外したとき | 同上（`fav_count` は外した後の件数） |
| `favorite_limit` | 選手の上限30で追加できなかったとき | `fav_type`: `racer`、`fav_entry` |
| `today_row_click` | トップの区画の中の入口を押したとき | `row_kind`: `run`（選手の出走の行）/ `fav_venue`（☆の会場の行）/ `grade_venue`（SG・G1 の場）、`row_link`: `racer_page` / `sonar` / `assist` / `venue_page` / `venue_list`、`row_state`: `upcoming` / `past`（`run` 以外は `none`）、`fav_state`: `runs`（出走あり）/ `no_runs`（☆はあるが出走なし）/ `no_favorites`（☆0件） |

- 入口 `fav_entry` の値: `racer_header`（選手ページの見出し）、`venue_header`（会場ページの見出し）、`race_table`（データ出走表の名前の欄）
- 選手の登録番号・会場コードは送らない（値の種類が多く、GA4 で「(other)」にまとめられる）
- GA4 のカスタムディメンション（範囲はイベント）に `fav_type`・`fav_entry`・`row_kind`・`row_link`・`row_state`・`fav_state` を登録する。登録はオーナーが GA4 の管理画面で、公開の前に行う（登録した日より前に遡らない）。`fav_count` は数値なので登録しない（必要になったらカスタム指標）

## 4. i18n の区分

`.claude/rules/i18n-new-pages.md` の3区分で、**翻訳対象（4言語）**。

- ☆が出る画面のうち、トップ（`/`）・会場ページ（`/venue/...`）・レース詳細（`/race/...`）は `src/config/languages.js` の `TRANSLATED_PATHS` に入っている。選手ページ（`/racer/...`）は ja 専用だが、☆は同じ部品なので文言は同じキーを使う
- 新しいページは作らないので `TRANSLATED_PATHS` は変えない
- 文言は全部 `favorites.*` のキーで、4言語（ja・en・zh-TW・ko）を先に1つの PR で足す。JSX に日本語を直書きしない（`scripts/maintenance/verify-jsx-japanese.js`）
- 選手名には `translate="no"`、会場名は `venues.*` のキーを使う。締切の時刻は非 ja で `t("home.jstNote")` の JST を添える
- 思考アシスト（`/race/:id/assist`）は ja 専用なので、区画の「思考アシスト」の入口は ja のときだけ出す（トップの「本日のデータ一覧」の導線と同じ扱い）。選手ページの入口は全言語で出す（レース詳細の `RacerPageLink` と同じ）
- 用語: 「お気に入り」「出走数」は `docs/reference/i18n-glossary.md` に足した訳を使う。「2連率」は既存の「全国2連率」の行（ko は 연대율）に合わせる

## 5. 出さないもの

- 印・買い目・当たり外れの集計・収支・回収率
- AI の並び（思考アシストの「6艇中N番目」等の順位）。行の中で印・記号にしない
- ☆の人数・人気の順位（ほかの人の☆は数えない。保存は端末だけ）
- 知らせ（プッシュ・メール）、ログイン、端末をまたぐ同期
- ☆の選手の次の出走日（モックの別案B）
- 進入コースの成績（公式・直近3期）。サイトに予想進入の値が無いため、一言は枠（艇番）の成績だけ
- タブの上の出走6艇の帯の☆（承認で名前の欄に移した）
- 空の区画（出すものが無い状態の区画）。代わりの表示を出す

## 6. 画面ごとの決まり（モックに無い細部）

- 区画はトップの今日の表示だけ。過去の日付（`/races/:date`）には出さない。置き場所は `IntroBanner`（初回のガイド）の下、SG開催中の帯（`SgNowBanner`）の上
- 出走の行は、今日の出走表（`dataService.getRaces()` の `races[].entries[].racerId`）から☆の選手を拾う。新しい API は作らない。中止のレース（`cancellationStatus` あり）は出さない
- 並びは締切（`startTime`）の早い順、同じ時刻は会場コード・レース番号の順。締切を過ぎた行（今の JST の時:分 ≧ 締切）は「締切を過ぎた N件」に畳む。375px（〜767px）は締切前を4件まで出して「あと N件を見る」で開く。768px 以上は全部出す
- 成績の一言は、選手ページと同じ取り方と同じ計算（`supabaseDataService.getRacerRaceHistory(racerId)` を `aggregateRacerCrossStats(rows, {}, "boat", null, null)` で数え、その号艇の行の `n` と `top2Rate`）。出走30未満は件数だけ。取得は今日出走する☆の選手だけ、区画が画面に入ってから（`useVisibleOnce`）。取得に失敗した選手は一言を出さず「成績を読めなかった」と1行出す（握りつぶさない）
- 今節の着順は、レース詳細の今節タブと同じ取り方（`supabaseDataService.getRacerScopedRaceStats(racerId)` を `buildMeetResults(records, {raceId, venueCode})` で切る）。初日は「初日（成績なし）」
- SG・G1 の判定は会場の先頭レースの `raceGrade`（`SG` / `G1`。PG1 は `G1` で入っている）。トップの会場カード・`getSgNowVenues` と同じ
- 龍神ソナーの入口は、ソナーの機能フラグ（`isAnalogyFinderEnabled()`）が切れているときは出さない

## 7. 統計検証

新しい指標は出さない。成績の一言は選手ページの枠番別成績の値をそのまま写す（数え方・30未満の扱いも同じ）。AI の並びは出さないので、並びと着順の関係の検証は要らない。

## 8. 未定（質問で決める）

- 「お気に入りの管理」の行き先（区画の右上のリンクと、上限の知らせの「お気に入りの管理を開く」）。管理の画面はモックに無い。決まるまで、どちらも出さない。外すのは各☆（選手ページ・会場ページ・出走表）で行う
