# モーターの強さをひと目で比べる（plan）

- 仕様: [spec.md](./spec.md)、画面: [screens.md](./screens.md)（BOA-428）
- 子1（6艇の比較）と子3（会場モーターランキング）を別の PR にする。子2 は作らない

## データ設計

**テーブル・カラムは追加しない。** マイグレーションは無いので、ER 図も要らない（新しいテーブル・外部キーが無い）。読むのは次の既存テーブルだけで、どれも匿名で読める（076・095）。

| テーブル | 使う列 | 用途 |
|---|---|---|
| `venue_motor_stats` | `motor_number, scraped_date, top2_rate, final_count, championship_count` | 会場内順位（子1）、ランキングの2連率・優出・優勝（子3） |
| `race_entries` | `race_id, motor_number, motor_2rate, racer_id, player_name` | 6艇の公式2連率（子1、既存の取得のまま）、使用者の名前と今節走った直近のレース（子3） |
| `motor_pretest_stats` | `race_date, racer_id, motor_number, motor_2rate, pretest_time` | 使用者・前検・データの無い会場の2連率（子3） |

### 会場の全モーターのスナップショットを1か所で取る

今の `getVenueMotorRanking(venue, motor, metric, asOfDate)` は、モーター1基ごとに「最新の日付」と「会場全体」の2クエリを投げる。子1 で6基分呼ぶと12クエリになる（キャッシュのキーがモーター単位なので、同じ会場全体の結果を共有できない）。

会場単位の取得を1つの関数にまとめ、3つの呼び出し元で共有する。

```
getVenueMotorSnapshot(venueCode, asOfDate)   … 2クエリ。キャッシュは会場×日付
  ├─ getVenueMotorRanking(...)               … 既存のドリルダウン。中身をこれに差し替え（戻り値は変えない）
  ├─ getVenueMotorRanks(venueCode, asOfDate) … 子1。Map<motor_number, {rank, tied}> と total・scrapedDate
  └─ getVenueMotorList(venueCode)            … 子3。スナップショット＋使用者＋前検
```

- `getVenueMotorSnapshot` の戻り値: `{ state: "ok", scrapedDate, rows: [{ motor_number, win_rate, top2_rate, top3_rate, accident_rate, final_count, championship_count }] }` / `{ state: "empty" }`（その日以前のスナップショットが無い）/ `{ state: "error" }`。例外は投げない（ドリルダウンの `Promise.all` を巻き込まないため）。「無い」と「失敗」を分けるのは、失敗を「データの無い会場」と取り違えて違う出典で並べないため（設計レビュー指摘5）
- `getVenueMotorRanking` は `state !== "ok"` を今と同じ null に戻す（戻り値・キャッシュキーは変えない）。`withCache` は null・error を実質キャッシュしないので、失敗が残らない
- 順位は `competitionRank`（`src/utils/competitionRank.js`）。値が null のモーターは順位の対象から外し、total にも数えない（今のドリルダウンと同じ）
- キャッシュキー: `venue-motor-snapshot-v1-${venueCode}-${asOfDate ?? "latest"}`

### 子1 の会場内順位の時点

- 当日のレース: 最新のスナップショット（`asOfDate = null`）。今のドリルダウンの順位と同じ値になる
- 過去のレース: レースの日付以前で最新のスナップショット（`asOfDate = raceDate`。BOA-521 と同じ）
- 会場にデータが無い（戸田・平和島）、またはその日以前のスナップショットが無い（`empty`）: 順位の列を出さない（列ごと畳む。6行とも「-」を並べない）
- 取得に失敗（`error`）: 列は出し、セルに「取得できませんでした」の印（列が黙って消えると、データが無い会場と区別できない）
- スナップショットに載っていないモーター（丸亀は入れ替え後の19基が欠けている）: その行だけ「-」
- 表記: 「20位/60」、同値は「17位タイ/60」（児島 9/30 7R の69・22・68号機はそれぞれ2基同値）

### 子3 の「今節」の決め方

| 案 | 内容 | 不適合な点 |
|---|---|---|
| A | 会場の最新の開催日の出走表（`race_entries`）のモーター→選手 | その日に走らない選手のモーターが欠ける。節全体のモーターに対して平均96.9%、最小74.5%（設計レビューの実測） |
| B | `motor_pretest_stats` の6日ルックバックの行を、モーター単位で最新を採る | 窓に前の節の行が混ざる（2026年で延べ837件、`src/utils/pretestRows.js`） |
| C（採用） | `motor_pretest_stats` の**会場の最新の `race_date` 1日分**だけを取る。その日の行で節の全選手がそろい、`motor_number`・`racer_id`・`motor_2rate`・`pretest_time` を持つ | 1日分だけなので前の節は混ざらない（B の不適合に当たらない）。選手名は別に引く（`race_entries` の同じ節） |

- 実測（2026-10-02）: 児島 10/02 は前検52基、平和島 10/02 は47基、宮島の最新は 9/23（46基）。24会場すべてに行がある
- 最新の `race_date` が今日でない会場（10/02 時点で10会場）は、列見出しを「直近の節の使用者（{{date}}）」にする
- 機番のリンク用に、その節の `race_entries` から「モーターが走った直近のレース」を引く（`race_id` が無いと `?motor=` でドリルダウンが開かない。`MotorConditionChart.jsx:150-158`）。走っていない（使われていない）モーターはリンクにしない

### データの無い会場（戸田・平和島）

`getVenueMotorSnapshot` が `empty` のとき、案 C の前検の行に載るモーターだけを `motor_pretest_stats.motor_2rate`（BOATRACE 公式の2連率）で並べる。優出・優勝は「-」、出典の行を「BOATRACE 公式の前検データ（{{date}}、直近の節で使われたモーターのみ）」に替える。`error` のときは並べずエラーを出す。

浜名湖・宮島（会場サイトに著作権条項がある）の扱いはユーザー確認中（spec「未確定事項」）。「出さない」になった場合は、この2会場もここと同じ扱いにする（会場コードの一覧で切り替える）。

### クエリ本数

| 画面 | 追加 | 内訳 |
|---|---|---|
| 子1 | +2本（会場×日付でキャッシュ） | スナップショットの日付・会場全体。公式2連率は既存の `getRaceMotorBreakdown` の値を使う。spec の「+1本まで」を超えるので、ここで +2 と改める（日付を決めるクエリを1本にまとめる手段が PostgREST に無い。RPC を足すほどではない） |
| 子3 | 5本 | スナップショット2本、最新の前検日1本、その日の前検1本、その節の出走表1本（選手名・直近のレース） |

## コンポーネント構成

```
MotorConditionChart（既存、6艇表）
  ├─ RateBar（新規 common）… 公式2連率の棒。艇色、値ラベル、最良なら R1
  └─ 会場内順位のセル … getVenueMotorRanks の Map から引く

WinningTechniqueAnalysis（既存）
  └─ tab "motorranking"
       └─ VenueMotorRanking（新規 analysis）
            ├─ 会場の選択（useVenueRaceSelector の会場部分）
            ├─ 出典・日付の行
            └─ 表（並べ替え、RateBar を中立色で、useHorizontalScrollHint）
```

### RateBar（`src/components/common/RateBar.jsx` / `.css`）

- props: `value`（数値）, `max`（全長にする値）, `fill`（塗りの色。CSS の値）, `best`（R1 を付けるか）, `label`（表示する文字列。桁の決め方は呼び出し側）
- 棒の長さは `value / max` の %（`max` が 0 や null なら棒を描かない）
- 値ラベルは棒の右端に重ねた小さな札にし、札の背景を `--surface-card` にする。2号艇（黒）・4号艇（青）の塗りの上でも文字が読める。札を棒の外に置くと、375px で列幅が約36px増えて6艇表が横スクロールに入る（モックで実測した 317/317px の余裕が無い）
- `best` が true の札が複数あってよい（同じ値の最良は全部光らせる。2026-10-02 ユーザー承認）
- 塗り: 子1 は `BOAT_COLORS[n].bg`、子3 は中立色 `--text-secondary` を薄めたもの（`color-mix`）
  - 1号艇の白はトラックの上で見えないので、塗りに `--border-hairline` の内側の線を引く（バッジと同じ扱い）
  - R6（色はトークンだけ）との関係: 艇色は R4 が「BOAT_COLORS のまま」と決めている。ここで新しい直書きは作らない
- R1 の見た目は UI統一レーンの共通クラス（FR-2 で `.drt-best` から作るもの）を札に付ける。新しい色は作らない
- クラス名は `.rate-bar-*`

### 子1: MotorConditionChart の変更

1. **列の並び（375px で最初の画面に入れる）**: 枠 / 選手 / 機番 / 公式2連率（棒） / 会場内順位 / 期間の2連率（自社の再計算。当日のみ） / 3連率 / 前検 / 1着率 / 機力指数 / 優出 / 優勝
   - 今は「期間の2連率」が公式2連率より左にある。棒と順位を最初の画面に入れるため、公式2連率を左に出す。期間の2連率は消さず、順位の右に移す（情報は減らさない）
   - 過去のレース（`officialMode`）は、今と同じく2連率の列そのものが公式値なので、その列を棒にする
   - コード中の「2連率より左に列を足さない」コメント（BOA-451）を、新しい並びの理由に書き換える
2. **棒**: 公式2連率のセルを RateBar にする。`max` は6基の公式2連率の最大。数字の桁は今の `toFixed(1)` のまま（BOA-474）
3. **最良（R1）**: 公式2連率の最良の札に R1。判定は `bestOf`（UI統一レーンの PR2a で export され、**艇の集合**を返す形に変わる）。同じ値の最良は全部、全艇同値・値なしなら付けない
4. **行全体の強調（`.best-motor`、期間の2連率の最大）を外す**: 行の強調と札の金枠が別の列を指すと、どちらが最良か分からない。UI統一レーンの PR2a は `.best-motor` を残すので、子1 で外す（オーケストレーター経由で合意済み）
5. **会場内順位の列**: 「20位/60」、同値は「17位タイ/60」。順位に色は付けない（R5。比べた基準が無い）
6. **注記**: 表の下に2行。「会場内順位は、{{venue}} 公式サイトのモーター成績（取得日 {{date}}）の2連率で数えた順位です」「モーターの2連率には、乗った選手の実力も混ざります」
7. `MotorConditionChart` は分析ツールの「モーター調子」タブでも使うので、同じ変更が両方に出る（spec のとおり）

### 子3: VenueMotorRanking（`src/components/analysis/VenueMotorRanking.jsx` / `.css`）

- 会場は URL の `venue_code` があればそれ、無ければ既存の会場選択の初期値
- 並べ替え: 機番（昇順）・2連率（降順、初期）・優勝（降順）・前検（昇順）。押すたびに向きを変えるのではなく、列ごとに決まった向き（参考UIと同じ）。値の無い行は常に末尾
- 順位の列は、いま並べている列で `competitionRank` を取る（1, 2, 2, 4）。機番で並べたときは順位を2連率の順位のまま出す（機番に順位は無い）
- R1: 2連率1位の札に付ける（同率1位は全部）
- 出典の行は「取得日 {{date}}」（`scraped_date` は取得日で、会場によっては節ごとにしか中身が変わらない。児島は 9/23 から同じ値）
- 機番 → `?tab=motor&venue_code=..&race_id=..&motor=N`（今節走った直近のレース）、使われていないモーターはリンクなし。使用者 → `/racer/:id`（`translate="no"`）
- 375px: 表の中だけ横スクロール（`useHorizontalScrollHint`）。順位・機番・2連率が最初の画面に入る
- タブの登録: `TAB_KEYS` の `"motor"` の次に `"motorranking"`、`analysisPage.tabs`・`analysisPage.info`・`analysisPage.features.motorranking.name/description`（JSON-LD が引く。`WinningTechniqueAnalysis.jsx:105-109`）を4言語に足す。`scripts/lib/contentTopics/dataInsightSource.js:22-24` のタブ一覧にも足す。ブログ記事は無いので `BLOG_LINKS` には足さない
- 新しい分析タブなので `docs/design/motor-strength-compare/content-index.json` を作る（`.claude/rules/content-ops.md` フローA-2）

## 色の共通ルールの当てはめ（UI統一レーン R1〜R6）

| ルール | 子1 | 子3 |
|---|---|---|
| R1 最良を金枠＋太字（同じ値の最良は全部） | 公式2連率の最良の札 | 2連率1位の札 |
| R2 基準との差は緑/赤＋↑↓ | 該当なし（差の値を出さない） | 該当なし |
| R3 向きの無い値は色なし | 機番・選手 | 機番・使用者 |
| R4 棒は艇色のまま | 艇色 | 艇が無いので中立色 |
| R5 一律の緑をやめる | 新しい列（棒・順位）に緑を付けない。既存の `td.rate` の一律緑は UI統一レーンが外す | 付けない |
| R6 色はトークンだけ | 艇色以外はトークン | トークンのみ |

## UI統一レーンとの順番

UI統一レーン（`docs/design/race-detail-ui-unify/`）の PR2a（共通部品）も `MotorConditionChart` を変える。オーケストレーター経由で次の順に合意した（2026-10-02）。

1. UI統一 PR2a: `bestOf` を export し、艇の集合を返す形にする。R1・R2 の共通クラス、`bestMotor2Rate` の一本化、`td.rate` の一律緑の除去。`.best-motor` は残す
2. **BOA-428 子1**: 共通部品を使って、棒・順位・列の並びを入れ、`.best-motor` を外す。モータ情報の列の並びは承認済みの BOA-428 モックで確定（UI統一側の候補1・2は採らない）
3. UI統一 PR4: モータ情報の残り（列の並びは子1 で済み）
4. BOA-428 子3: PR2a の共通クラスだけに依存する。子1 と並行でよい

R1 の見た目は PR2a のマージを待つ（同じ見た目を2か所で作らない）。UI統一レーンの screens.md に「モータ情報の列の並びは BOA-428 の承認済みモックに従う」と書いてもらう（設計レビュー指摘8、オーケストレーターに依頼）。

## 既存サービス層との連携

- 追加・変更は `src/services/supabaseDataService.js` の中だけ（`getVenueMotorSnapshot`・`getVenueMotorRanks`・`getVenueMotorList` を足し、`getVenueMotorRanking` の中身を差し替える）
- 前検は `fetchPretestByRacer`（既存）、順位は `competitionRank`（既存）、艇色は `BOAT_COLORS`（既存）
- `getRaceMotorBreakdown` は変えない（キャッシュのバージョンも上げない）

## ADR

- **ADR-0067 に追記する**（spec の Q4）: 会場公式サイトのモーター成績（2連率・優出・優勝）を、会場の全モーターの一覧として再表示する。表に出典と取得日を書く。取得は増やさない（既存の日次の取得を読むだけ）。戸田・平和島は会場サイトにページが無いので、BOATRACE 公式の前検データの値だけで出す。浜名湖・宮島の扱いはユーザーの判断を待って書く（ADR-0067:21 の「除外済み」と、`venue_motor_stats` が2会場を取得している実装の食い違いも、この追記で記録する）
- 新しい ADR は作らない。上の技術判断（スナップショットの共有・今節の決め方）は、サービス層の中に閉じていて、後から変えても画面や他の機能に影響しない

## テスト

- 単体の純関数: 並べ替えと順位（同値・値なし・機番の並べ替えでの順位）を `src/utils/` に切り出し、`scripts/maintenance/verify-*.js` で固定する（`verify-registry.json` に `ci` で登録）
- E2E（`e2e/`、`e2e/fixtures.js` の `test`）:
  - 子1: 棒の長さの比が値の比と一致（最大の行が全長）、最良の札だけに R1 のクラス、会場内順位の列、375px で横スクロールせずに順位まで見える
  - 子3: タブが開く、直近の節の前検にあるモーターがすべて一覧にある、並べ替えで同値が同じ順位、375px でページに横スクロールが出ない、取得失敗でエラーが出る（出典を差し替えない）
- `e2e/layout.spec.js` の5軸に新しいタブを足す
- 受け入れE2E（`e2e/acceptance/motor-strength-compare.spec.js`）は `acceptance-test-writer` が spec・screens だけから書く
- データ精度: 子1 の6基の順位を `getVenueMotorRanking`（ドリルダウン）の結果と、子3 の件数・順位を本番 DB の `venue_motor_stats` と、使用者・前検を `motor_pretest_stats` と、`data-accuracy-verifier` で突き合わせる
