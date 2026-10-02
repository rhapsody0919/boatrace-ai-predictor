# モーターの強さをひと目で比べる（plan）

- 仕様: [spec.md](./spec.md)、画面: [screens.md](./screens.md)（BOA-428）
- 子1（6艇の比較）と子3（会場モーターランキング）を別の PR にする。子2 は作らない

## データ設計

**テーブル・カラムは追加しない。** マイグレーションは無いので、ER 図も要らない（新しいテーブル・外部キーが無い）。読むのは次の既存テーブルだけで、どれも匿名で読める（076・095）。

| テーブル | 使う列 | 用途 |
|---|---|---|
| `venue_motor_stats` | `motor_number, scraped_date, top2_rate, final_count, championship_count` | 会場内順位（子1）、ランキングの2連率・優出・優勝（子3） |
| `race_entries` | `race_id, motor_number, motor_2rate, racer_id, player_name` | 6艇の公式2連率（子1、既存の取得のまま）、今節使用者・データの無い会場の2連率（子3） |
| `motor_pretest_stats` | `race_date, racer_id, motor_number, pretest_time` | 前検（子3） |

### 会場の全モーターのスナップショットを1か所で取る

今の `getVenueMotorRanking(venue, motor, metric, asOfDate)` は、モーター1基ごとに「最新の日付」と「会場全体」の2クエリを投げる。子1 で6基分呼ぶと12クエリになる（キャッシュのキーがモーター単位なので、同じ会場全体の結果を共有できない）。

会場単位の取得を1つの関数にまとめ、3つの呼び出し元で共有する。

```
getVenueMotorSnapshot(venueCode, asOfDate)   … 2クエリ。キャッシュは会場×日付
  ├─ getVenueMotorRanking(...)               … 既存のドリルダウン。中身をこれに差し替え（戻り値は変えない）
  ├─ getVenueMotorRanks(venueCode, asOfDate) … 子1。Map<motor_number, {rank, tied}> と total・scrapedDate
  └─ getVenueMotorList(venueCode)            … 子3。スナップショット＋使用者＋前検
```

- `getVenueMotorSnapshot` の戻り値: `{ scrapedDate, rows: [{ motor_number, win_rate, top2_rate, top3_rate, accident_rate, final_count, championship_count }] } | null`。取得の失敗はログに出して null（今の `getVenueMotorRanking` と同じ。ドリルダウンの `Promise.all` を巻き込まないため）
- 順位は `competitionRank`（`src/utils/competitionRank.js`）。値が null のモーターは順位の対象から外し、total にも数えない（今のドリルダウンと同じ）
- キャッシュキー: `venue-motor-snapshot-v1-${venueCode}-${asOfDate ?? "latest"}`

### 子1 の会場内順位の時点

- 当日のレース: 最新のスナップショット（`asOfDate = null`）。今のドリルダウンの順位と同じ値になる
- 過去のレース: レースの日付以前で最新のスナップショット（`asOfDate = raceDate`。BOA-521 と同じ）
- 会場にデータが無い（戸田・浜名湖・宮島）、またはその日以前のスナップショットが無い: 順位の列を出さない（列ごと畳む。6行とも「-」を並べない）

### 子3 の「今節」の決め方

| 案 | 内容 | 不適合な点 |
|---|---|---|
| A（採用） | その会場で今日以前の最新の開催日を1つ決め（`race_entries` の最新の `race_id` の日付）、その日の出走表のモーター→選手を使用者にする。前検は既存の `fetchPretestByRacer(venue, その日)` で選手から引く | その日に走らない選手（途中帰郷・欠場）が使っていたモーターは「-」になる。数件／節 |
| B | `motor_pretest_stats` の6日ルックバックの行を、モーター単位で最新を採る | 窓に前の節の行が混ざる（2026年で延べ837件、`src/utils/pretestRows.js`）。前の節の使用者を今節として出してしまう |
| C | 節の初日を `findMeetStartDate`（今節タブの方式）で決め、節の全出走表から使用者を集める | 正確だが、種別（`race_conditions`）も引く必要があり、クエリと分岐が増える。差が出るのは A の「-」の数件だけ |

A を採る。画面の出典の行は「前検・使用者は {{date}} の出走表」と、使った日付をそのまま書く（モックの「今節（9/24〜）」から変える。節の初日を出すには案 C が要るため）。

### データの無い会場（戸田・浜名湖・宮島）

`getVenueMotorSnapshot` が null のとき、案 A の開催日の出走表に載るモーターだけを、`race_entries.motor_2rate`（BOATRACE 公式の2連率）で並べる。優出・優勝は「-」、出典の行を「BOATRACE 公式の出走表（{{date}}、この日に使われたモーターのみ）」に替える（spec の既定値）。

### クエリ本数

| 画面 | 追加 | 内訳 |
|---|---|---|
| 子1 | +2本（会場×日付でキャッシュ） | スナップショットの日付・会場全体。公式2連率は既存の `getRaceMotorBreakdown` の値を使う。spec の「+1本まで」を超えるので、ここで +2 と改める（日付を決めるクエリを1本にまとめる手段が PostgREST に無い。RPC を足すほどではない） |
| 子3 | 5本 | スナップショット2本、最新の開催日1本、その日の出走表1本、前検1本 |

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
3. **最良（R1）**: 公式2連率の最良1つの札に R1。判定は `bestOf`（`raceIndicators.jsx`。UI統一レーンの FR-2 で外から使えるようにする）。全艇同値・値なしなら付けない
4. **行全体の強調（`.best-motor`、期間の2連率の最大）を外す**: R1 は「最良1つだけ」。行の強調と札の金枠が別の列を指すと、どちらが最良か分からない。UI統一レーンの FR-2（`bestMotor2Rate` を `bestOf` に一本化）と重なるので、どちらの PR で外すかを下の「UI統一レーンとの順番」で決める
5. **会場内順位の列**: 「17位/60」の形。同値は「17位タイ」（既存の `venueRankBadgeTied` の書き方に合わせる）。順位に色は付けない（R5。比べた基準が無い）
6. **注記**: 表の下に2行。「会場内順位は、{{venue}} 公式サイトのモーター成績（{{date}}時点）の2連率で数えた順位です」「モーターの2連率には、乗った選手の実力も混ざります」
7. `MotorConditionChart` は分析ツールの「モーター調子」タブでも使うので、同じ変更が両方に出る（spec のとおり）

### 子3: VenueMotorRanking（`src/components/analysis/VenueMotorRanking.jsx` / `.css`）

- 会場は URL の `venue_code` があればそれ、無ければ既存の会場選択の初期値
- 並べ替え: 機番（昇順）・2連率（降順、初期）・優勝（降順）・前検（昇順）。押すたびに向きを変えるのではなく、列ごとに決まった向き（参考UIと同じ）。値の無い行は常に末尾
- 順位の列は、いま並べている列で `competitionRank` を取る（1, 2, 2, 4）。機番で並べたときは順位を2連率の順位のまま出す（機番に順位は無い）
- R1: 2連率の1位の札だけに付ける（同率なら `bestOf` の決まりと同じく、先頭の1つ）
- 機番 → `?tab=motor&venue_code=..&motor=N`（既存のドリルダウン）、使用者 → `/racer/:id`（`translate="no"`）
- 375px: 表の中だけ横スクロール（`useHorizontalScrollHint`）。順位・機番・2連率が最初の画面に入る
- タブの登録: `TAB_KEYS` の `"motor"` の次に `"motorranking"`、`analysisPage.tabs.motorranking`・`analysisPage.info.motorranking` を4言語に足す。ブログ記事は無いので `BLOG_LINKS` には足さない
- 新しい分析タブなので `docs/design/motor-strength-compare/content-index.json` を作る（`.claude/rules/content-ops.md` フローA-2）

## 色の共通ルールの当てはめ（UI統一レーン R1〜R6）

| ルール | 子1 | 子3 |
|---|---|---|
| R1 最良1つだけ金枠＋太字 | 公式2連率の札 | 2連率1位の札 |
| R2 基準との差は緑/赤＋↑↓ | 該当なし（差の値を出さない） | 該当なし |
| R3 向きの無い値は色なし | 機番・選手 | 機番・使用者 |
| R4 棒は艇色のまま | 艇色 | 艇が無いので中立色 |
| R5 一律の緑をやめる | 新しい列（棒・順位）に緑を付けない。既存の `td.rate` の一律緑は UI統一レーンが外す | 付けない |
| R6 色はトークンだけ | 艇色以外はトークン | トークンのみ |

## UI統一レーンとの順番

UI統一レーン（`docs/design/race-detail-ui-unify/`）の PR2（共通部品）と PR4（モータ情報）も `MotorConditionChart` の6艇表を変える。同じ箇所を並行で変えると衝突するので、次の順にする。

1. UI統一 PR2: `bestOf` を外から使えるようにし、R1 の共通クラスを作る。`bestMotor2Rate` の一本化と一律緑の除去もここ
2. **BOA-428 子1**: 上の共通部品を使って、棒・順位・列の並びを入れる。行全体の強調（`.best-motor`）は、PR2 が残していればここで外す
3. UI統一 PR4: モータ情報の残り。FR-5 の「375px で2連率が最初の画面に入る並び」は子1 で済むので、PR4 からは外す
4. BOA-428 子3: PR2 の共通クラスだけに依存する。子1 と並行でよい

PR2 が先にマージされない場合、子1・子3 は R1 の見た目だけ後回しにして（札の金枠なし）先に進めず、PR2 を待つ（同じ見た目を2か所で作らない）。

## 既存サービス層との連携

- 追加・変更は `src/services/supabaseDataService.js` の中だけ（`getVenueMotorSnapshot`・`getVenueMotorRanks`・`getVenueMotorList` を足し、`getVenueMotorRanking` の中身を差し替える）
- 前検は `fetchPretestByRacer`（既存）、順位は `competitionRank`（既存）、艇色は `BOAT_COLORS`（既存）
- `getRaceMotorBreakdown` は変えない（キャッシュのバージョンも上げない）

## ADR

- **ADR-0067 に追記する**（spec の Q4）: 会場公式サイトのモーター成績（2連率・優出・優勝）を、会場の全モーターの一覧として再表示する。表に出典と日付を書く。取得は増やさない（既存の日次の取得を読むだけ）。戸田・浜名湖・宮島は取得していないので、BOATRACE 公式の出走表の値だけで出す
- 新しい ADR は作らない。上の技術判断（スナップショットの共有・今節の決め方）は、サービス層の中に閉じていて、後から変えても画面や他の機能に影響しない

## テスト

- 単体の純関数: 並べ替えと順位（同値・値なし・機番の並べ替えでの順位）を `src/utils/` に切り出し、`scripts/maintenance/verify-*.js` で固定する（`verify-registry.json` に `ci` で登録）
- E2E（`e2e/`、`e2e/fixtures.js` の `test`）:
  - 子1: 棒の長さの比が値の比と一致（最大の行が全長）、最良の札だけに R1 のクラス、会場内順位の列、375px で横スクロールせずに順位まで見える
  - 子3: タブが開く、行数が会場のスナップショットの件数と一致、並べ替えで同値が同じ順位、375px でページに横スクロールが出ない
- `e2e/layout.spec.js` の5軸に新しいタブを足す
- 受け入れE2E（`e2e/acceptance/motor-strength-compare.spec.js`）は `acceptance-test-writer` が spec・screens だけから書く
- データ精度: 子1 の6基の順位を `getVenueMotorRanking`（ドリルダウン）の結果と、子3 の件数・順位を本番 DB の `venue_motor_stats` と、`data-accuracy-verifier` で突き合わせる
