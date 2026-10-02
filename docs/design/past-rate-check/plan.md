# 過去に発生した割合を見る plan

元: [spec.md](./spec.md)・[screens.md](./screens.md)。技術判断は [ADR-0081](../../adr/0081-past-rate-counted-on-client-from-layer-rows.md)（層の新しい順最大2,000行を画面側で数え、保存は端末内）。土台は BOA-271 FR-2（層別 S*）の plan とマイグレーション119（ブランチ feature/boa-271-fr2-strat。`get_analogy_similar_races` は FR-2 レーンが119 に足す、2026-10-02 合意）。

## 全体の流れ

```mermaid
flowchart LR
  POOL[(analogy_pool_outcomes<br/>analogy_snapshots<br/>マイグレーション119 BOA-271 FR-2)] --> RPC[get_analogy_similar_races raceId<br/>層の新しい順 最大2,000行]
  RPC --> SV[analogyService.js<br/>getAnalogySimilarRaces 本機能で追加]
  SV --> HK[useAnalogySimilarRaces]
  HK --> AI[RaceAiPredictionTab 先頭<br/>PastRateChecker]
  HK --> RR[RaceResult 払戻の下<br/>PastRateReview]
  AI -->|入力| CT[pastRate/count.js<br/>純粋関数]
  CT --> AI
  AI -->|締切前・結果を出したとき| LS[(localStorage<br/>boatai-user:past-rate-check:v1)]
  LS --> RR
  CT --> RR
  RE[analogyReason.js<br/>BOA-271 FR-2] --> AI
  B430[BOA-430 Step2・Step4] -.props で絞って埋め込み.-> AI
```

## データ設計

**本機能では新しいテーブル・カラム・バッチを作らない。** RPC `get_analogy_similar_races(p_race_id)` は BOA-271 FR-2 がマイグレーション119 に足す（2026-10-02 合意。返り値の形は spec「データ（土台）」）。マイグレーションは本機能に無い（ER 図も無い）。

値の約束（`payout_3tan` は3連単、F・出遅れ・欠場の ST は NULL、実進入不明は NULL、不成立と1〜3着に返還艇が入るレースは母集団に入れない）は119 の `analogy_pool_outcomes` に引き継がれている。

端末内の保存形式は spec FR-5 のとおり。サーバーには何も送らない。

### 読み取りの量
- 1レースあたり最大2,000行 × 8列。gzip 後で約34KB（FR-2 レーンの試算。本番投入後に実測）。取得は部品を出すときに1回で、AI予想タブと結果タブで同じキャッシュを使う
- SQL 側: 深さ4（4条件、使う層の70.5%）は複合索引 `idx_analogy_pool_strata (gap_band, b1_class, venue_code, top_boat, race_date DESC)` の並びで新しい順に最大2,000行を読める。深さ1〜3は索引の並びで読めず、層の全件（最大約7万行）を読んで並べ替える。深さ別の索引（例 `(gap_band, b1_class, race_date DESC)`）を足すかは、119 の本番適用後に深さ1〜4で `EXPLAIN (ANALYZE, BUFFERS)` を取って FR-2 レーンと決める（T0-3）
- 取得は Edge API `GET /api/analogy/similar-races/[raceId]`（新規、本機能で作る。FR-2 の `api/analogy/similar` と同じ流儀）を通し、CDN にキャッシュさせる: スナップショットあり・締切前 `s-maxage=300`、締切後 `s-maxage=86400`、スナップショットなし `s-maxage=300`、NULL・エラーは `no-store`。API が失敗したときは PostgREST の RPC 直読みに切り替える（FR-2 と同じ）。部品は AI予想タブの先頭に常に出るので、直接 RPC だと表示のたびに DB に届く（差分レビュー指摘7）
- ボタンのたびに層の全件を SQL で数える方式は Disk IO を圧迫するので採らない（ADR-0081）
- 注記の期間は、切り詰めていなければ `pool_from`〜`pool_cutoff`、切り詰めたら `rows` の最も古い race_date〜`pool_cutoff`。似ている理由は `analogyReason.js`（BOA-271 FR-2）に `conditions`・`depth`・`n_total` を渡して作る

## フロントエンド

### ファイル構成

| ファイル | 役割 |
|---|---|
| `src/utils/pastRate/patterns.js` | スリット7形の定義（キー・判定関数・効く強さ）、強さの段の線（`SLIT_LEVELS`、1/100秒の整数）、1艇身の秒数（0.13）、全国の出現率（T0-2 で固定した値）。ST は `Math.round(st*100)` の整数にしてから判定する（浮動小数の境界ずれを避ける。spec 共通の数え方） |
| `src/utils/pastRate/count.js` | `countPastRate(rows, type, input)` → `{ n, count, excluded: { reason, count } \| null, breakdown }`。型ごとの判定（spec FR-1）。`orderPoints(input)`（点数）。`decisionOf(finishOrder)`（決着の行用） |
| `src/utils/pastRate/label.js` | `rateLabel(rate)` → `"standard" \| "rare" \| null`。線 x・y は定数（T0-1 で決めた値） |
| `src/utils/pastRate/storage.js` | `loadEntries()`・`saveEntry(entry, { deadline, now })`・`entriesForRace(raceId, { deadline })`。キー `boatai-user:past-rate-check:v1`（`boatai:` はデータキャッシュの全削除に巻き込まれるので使わない）、30日、上限1,000件、書く直前に読み直す、壊れた値・形の違う Entry を捨てる、例外の吸収（console に出す）、締切以降の Entry を振り返りから外す |
| `src/components/race/pastRate/PastRateChecker.jsx` | 外枠。型の切り替え・入力の状態（非制御／`value`・`onChange` の制御の両対応）・ボタン・結果の表示。保存は `persist` が true で締切前のときだけ |
| `src/components/race/pastRate/{Order,Boat1,Tenkai,Slit,Entry,PayoutBand}Input.jsx` | 型ごとの入力（screens） |
| `src/components/race/pastRate/BoatToggle.jsx` | 艇のボタン（公式色、`aria-pressed`）。このディレクトリ内でだけ使う |
| `src/components/race/pastRate/SlitScene.jsx` | スリットの SVG。props はコース順の ST の差の配列と表示サイズだけ（BOA-430 Step2 でも使える） |
| `src/components/race/pastRate/PastRateResult.jsx` | 結果（主文・ラベル・メーター・内訳・除いた件数・注記） |
| `src/components/race/pastRate/PastRateReview.jsx` | 結果タブの振り返り |
| `src/components/race/pastRate/PastRate.css` | `prc-` 接頭辞のクラス |

```mermaid
flowchart TD
  Tab[RaceAiPredictionTab] --> PRC[PastRateChecker]
  PRC --> IN[型ごとの Input 6つ]
  IN --> BT[BoatToggle]
  IN --> SS[SlitScene]
  PRC --> RES[PastRateResult]
  Res[RaceResult] --> REV[PastRateReview]
  PRC -. 純粋関数 .-> C[utils/pastRate/count.js]
  PRC -. 純粋関数 .-> L[utils/pastRate/label.js]
  PRC -. 保存 .-> S[utils/pastRate/storage.js]
  REV -. 読む .-> S
  REV -. 決着を数える .-> C
  C --> P[utils/pastRate/patterns.js]
```

### 組み込み
- `RaceAiPredictionTab`: BOA-271 T9-1 で、BOA-271 の節の描画を早期 return の分岐の外に出す（BOA-271 の tasks に共有の前提として記載済み。FR-2 の作り直し後も位置は変わらない）。同じ外側の位置の**先頭**に `PastRateChecker` を置く（中止のときは出さない）。`rows` が0行・取得中は出さない。取得に失敗したときは `InlineFetchError`（`onRetry` で `useAnalogySimilarRaces` の再取得）。`frontend-data-fetch.md` の3
- 締切: `getDeadlineDate(raceId, startTime)`（`src/utils/raceDeadlineStatus.js`）を `PastRateChecker` に `deadline` として渡す。`startTime` は今 `RaceAiPredictionTab` に渡っていないので、`PredictionPanel` から `raceStartTime={selectedRace?.startTime}` を新しい prop として渡す（オッズ一覧タブ `RaceOddsListTab` へ既に同じ値を渡している、`PredictionPanel.jsx:446`。値は `races.start_time` の先頭5文字で、締切の時刻と一致する）。無ければ null。null のときはレースが確定していなければ保存する（spec FR-5）
- `RaceResult`: 払戻表の下に `PastRateReview`（`raceId`・決着・`similar`・締切）。決着は `RaceResult` の `buildResultRows` が組み立てた着順（返還艇を外したもの）の position 1〜3 の艇。3着までそろわなければ決着の行を出さない。取得に失敗したときは `InlineFetchError`。不成立（`RaceResult` 内で既に求めている `outcome === RACE_OUTCOME.NO_RACE`）と `rows` が0行では出さない。スナップショットが無いレース（`snapshot: false`）でも出す
- 決まり手のキーと DB の日本語の対応は `src/utils/turnPrediction.js` の `TECHNIQUE_NAMES` を使う（新しい対応表を作らない）

### 状態の持ち方
- 型ごとの入力は `PastRateChecker` の state に型別に持つ（型を切り替えても他の型の入力は残る。モックどおり）
- 結果は「最後にボタンを押したときの型と入力」から出し、入力が変わったら隠す
- `value`/`onChange` を渡されたときは、その型の入力を外の値で置き換える（BOA-430 Step4 のカート）

### 表示時の計算の量
最大2,000行×1型の判定。着順の流しは最大 1×5×4 の点数でも、判定は行ごとに3つの集合の包含だけ。100ms の要件に対して十分小さいので、メモ化（`useMemo`）は入力と `neighbors` の参照だけをキーにする

## 既存サービス層・共通ライブラリとの連携
- データ取得: BOA-271 の `src/services/analogyService.js` に `getAnalogySimilarRaces(raceId)` を足し、フック `useAnalogySimilarRaces` を作る。RPC の呼び出しは同ファイルの既存の流儀（Supabase クライアントの入口を1つに閉じる、`frontend-data-fetch.md` の1）に従う。キャッシュは `raceId` 単位で、NULL・エラーは残さない。本機能から `supabaseDataService.js` は呼ばない
- 似ている理由の文: BOA-271 FR-2 の `src/utils/analogyReason.js`
- 締切: `src/utils/raceDeadlineStatus.js` の `getDeadlineDate`
- 決まり手: `src/utils/turnPrediction.js` の `TECHNIQUE_NAMES`
- 艇の色: `src/utils/colors.js` の `BOAT_COLORS`、艇番の表示は BOA-271 で切り出す `BoatBadge`
- localStorage の扱い: 既存の `src/hooks/useFirstVisit.js` 等は例外を吸収していない。本機能の `storage.js` は try/catch で包む（プライベートモード・容量超過で画面を壊さない）。既存箇所の直しは本機能のスコープ外

## 検証

| 何を | どこで |
|---|---|
| 6つの型の判定・分母・除いた件数・点数・ラベルの境界（x・y ちょうど） | `scripts/maintenance/verify-past-rate-count.js`（固定の行データ。`verify-registry.json` に ci で登録）。`src/utils/pastRate/` の純粋関数を import する |
| 保存（置き換え・30日・上限・締切後は保存しない・壊れた値・例外） | 同じ verify に保存の節を足す（localStorage は小さなメモリ実装を差し込む） |
| 画面の件数が実データと一致するか | 実装後の `data-accuracy-verifier`: 本番の数レースで、`analogy_pool_outcomes` の同じ層の新しい順2,000件を SQL で数えた値と画面の数字を照合 |
| 受け入れ | `e2e/acceptance/past-rate-check.spec.js`（`acceptance-test-writer`）。行は録画再生（ADR-0077）。`get_analogy_similar_races` が録画に無い間は route で固定データを返す |
| レイアウト | `npm run test:layout` に AI予想タブの部品と結果タブの振り返りを足す（375/768/1024/1440/1920px） |

## 定番／レアの線の検証（tasks T0-1。分析のみ）
- 置き場所: `scripts/analysis/past-rate-check/label-threshold.py`。test 2026-04〜09 の各レースの比べる行は、BOA-271 FR-2 の層別 S* と同じ規則（自動の深さの層、そのレースの日より前の母集団、新しい順最大2,000件）で作る。FR-2 の分析スクリプト（層の条件・自動の深さ）を import するか、同じ規則を書き、固定データで `get_analogy_similar_races` と同じ行が選ばれることを確かめる
- 判定のロジックは `src/utils/pastRate/count.js` と同じ式を Python に持つ（二重実装になるので、固定データで JS と Python の件数が一致することを確かめる小さな検査を同じディレクトリに置く。両方とも1/100秒の整数で比べ、固定データには差が線ちょうどの行を入れる。両方が浮動小数で一致したまま SQL とずれる、を防ぐため、固定データの期待値は SQL の numeric で出したものを使う）
- 手順と判定の規則は spec FR-3 で固定済み。結果を `docs/design/past-rate-check/analysis/label-threshold-result.md` に書き、採った x・y を spec と `label.js` に反映する
- 母集団の決着（スリットの ST・実進入・3連単）は、BOA-271 の値の約束（F・出遅れ・欠場は NULL 等）と同じ扱いで作る

## 残る判断（plan では決めない）
- 定番／レアの線の値（T0-1 の結果）
- 形に添える全国の出現率の値（T0-2 の結果）
