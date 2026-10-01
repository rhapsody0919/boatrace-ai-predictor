# 過去に発生した割合を見る plan

元: [spec.md](./spec.md)・[screens.md](./screens.md)。技術判断は [ADR-0081](../../adr/0081-past-rate-counted-on-client-from-neighbors.md)（数えるのは画面側、保存は端末内）。土台は BOA-271 の [plan.md](../analogy-finder/plan.md)「get_analogy_neighbors」と [ADR-0080](../../adr/0080-analogy-neighbors-precomputed-in-batch.md)。

## 全体の流れ

```mermaid
flowchart LR
  RPC[get_analogy_neighbors raceId<br/>BOA-271] --> API[api/analogy/neighbors/raceId<br/>BOA-271]
  API --> SV[analogyService.js<br/>BOA-271 T5-2 キャッシュ共有]
  SV --> HK[useAnalogyNeighbors]
  HK --> AI[RaceAiPredictionTab 先頭<br/>PastRateChecker]
  HK --> AF[AnalogyFinderSection<br/>BOA-271 FR-2・FR-3]
  HK --> RR[RaceResult 払戻の下<br/>PastRateReview]
  AI -->|入力| CT[pastRate/count.js<br/>純粋関数]
  CT --> AI
  AI -->|締切前・結果を出したとき| LS[(localStorage<br/>boatai:past-rate-check:v1)]
  LS --> RR
  CT --> RR
  B430[BOA-430 Step2・Step4] -.props で絞って埋め込み.-> AI
```

## データ設計

**新しいテーブル・カラム・RPC・API は作らない。** マイグレーションは無い（ER 図も無い）。

読むのは BOA-271 の `get_analogy_neighbors` の返り値だけ（列は spec「データ（土台）」）。値の約束（`payout_3tan` は3連単、F・出遅れ・欠場の ST は NULL、不成立・特払いの払戻は NULL、実進入不明は NULL）は BOA-271 のマイグレーション案115・plan「値の約束」に反映済み（PR #1039 e3f55d553）。

端末内の保存形式は spec FR-5 のとおり。サーバーには何も送らない。

### 読み取りの量
- 1レースあたり800行 × 約17列。BOA-271 の節と同じ応答を `analogyService` のメモリキャッシュで共有するので、本機能による追加の通信は0回（同じタブで BOA-271 の節が先に取得していれば、そのまま使う）
- 結果タブ（`RaceResult`）を先に開いた場合だけ、そこで1回取得する（キャッシュは同じ）

## フロントエンド

### ファイル構成

| ファイル | 役割 |
|---|---|
| `src/utils/pastRate/patterns.js` | スリット7形の定義（キー・判定関数・効く強さ）、強さの段の線（`SLIT_LEVELS`）、1艇身の秒数（0.13）、全国の出現率（T0-2 で固定した値） |
| `src/utils/pastRate/count.js` | `countPastRate(neighbors, type, input)` → `{ n, count, excluded: { reason, count } \| null, breakdown }`。型ごとの判定（spec FR-1）。`orderPoints(input)`（点数）。`decisionOf(neighborOrResult)`（決着の行用） |
| `src/utils/pastRate/label.js` | `rateLabel(rate)` → `"standard" \| "rare" \| null`。線 x・y は定数（T0-1 で決めた値） |
| `src/utils/pastRate/storage.js` | `loadEntries()`・`saveEntry(entry, { deadline, now })`・`entriesForRace(raceId)`。キー、30日、上限1,000件、壊れた値の作り直し、例外の吸収（console に出す） |
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
- `RaceAiPredictionTab`: BOA-271 T9-1 で、BOA-271 の節の描画を早期 return の分岐の外に出す。同じ外側の位置の**先頭**に `PastRateChecker` を置く（中止のときは出さない）。`neighbors` が0行、または取得中・エラーのときは出さない（エラーは BOA-271 の節と同じく `analogyService` が扱う）
- 締切: `getDeadlineDate(raceId, startTime)`（`src/utils/raceDeadlineStatus.js`）を `PastRateChecker` に `deadline` として渡す。`startTime` は今 `RaceAiPredictionTab` に渡っていないので、`PredictionPanel` から `raceStartTime={selectedRace?.startTime}` を新しい prop として渡す（直前情報タブへ既に同じ値を渡している、`PredictionPanel.jsx:446`）。無ければ null。null のときはレースが確定していなければ保存する（spec FR-5）
- `RaceResult`: 払戻表の下に `PastRateReview`（`raceId`・決着 rank1〜3・`neighbors`）。不成立（`RaceResult` 内で既に求めている `outcome === RACE_OUTCOME.NO_RACE`）とスナップショットなしでは出さない
- 決まり手のキーと DB の日本語の対応は `src/utils/turnPrediction.js` の `TECHNIQUE_NAMES` を使う（新しい対応表を作らない）

### 状態の持ち方
- 型ごとの入力は `PastRateChecker` の state に型別に持つ（型を切り替えても他の型の入力は残る。モックどおり）
- 結果は「最後にボタンを押したときの型と入力」から出し、入力が変わったら隠す
- `value`/`onChange` を渡されたときは、その型の入力を外の値で置き換える（BOA-430 Step4 のカート）

### 表示時の計算の量
800行×1型の判定。着順の流しは最大 1×5×4 の点数でも、判定は行ごとに3つの集合の包含だけ。100ms の要件に対して十分小さいので、メモ化（`useMemo`）は入力と `neighbors` の参照だけをキーにする

## 既存サービス層・共通ライブラリとの連携
- データ取得: BOA-271 の `src/services/analogyService.js`・`useAnalogyNeighbors`。本機能から `supabaseDataService.js` は呼ばない
- 締切: `src/utils/raceDeadlineStatus.js` の `getDeadlineDate`
- 決まり手: `src/utils/turnPrediction.js` の `TECHNIQUE_NAMES`
- 艇の色: `src/utils/colors.js` の `BOAT_COLORS`、艇番の表示は BOA-271 T5-1 の `BoatBadge`
- localStorage の扱い: 既存の `src/hooks/useFirstVisit.js` 等は例外を吸収していない。本機能の `storage.js` は try/catch で包む（プライベートモード・容量超過で画面を壊さない）。既存箇所の直しは本機能のスコープ外

## 検証

| 何を | どこで |
|---|---|
| 6つの型の判定・分母・除いた件数・点数・ラベルの境界（x・y ちょうど） | `scripts/maintenance/verify-past-rate-count.js`（固定の近傍データ。`verify-registry.json` に ci で登録）。`src/utils/pastRate/` の純粋関数を import する |
| 保存（置き換え・30日・上限・締切後は保存しない・壊れた値・例外） | 同じ verify に保存の節を足す（localStorage は小さなメモリ実装を差し込む） |
| 画面の件数が実データと一致するか | 実装後の `data-accuracy-verifier`: 本番の数レースで、`get_analogy_neighbors` の行を SQL で数えた値と画面の数字を照合 |
| 受け入れ | `e2e/acceptance/past-rate-check.spec.js`（`acceptance-test-writer`）。近傍は録画再生（ADR-0077）。`/api/analogy/neighbors/*` が録画に無い間は route で固定データを返す |
| レイアウト | `npm run test:layout` に AI予想タブの部品と結果タブの振り返りを足す（375/768/1024/1440/1920px） |

## 定番／レアの線の検証（tasks T0-1。分析のみ）
- 置き場所: `scripts/analysis/past-rate-check/label-threshold.py`。BOA-271 Phase M の MD-6 の近傍を作るコード（`scripts/analysis/analogy-finder-md6/`）を import して、test 28,185R の近傍800件を作る（同じ方式・同じ重み）
- 判定のロジックは `src/utils/pastRate/count.js` と同じ式を Python に持つ（二重実装になるので、固定データ10件で JS と Python の件数が一致することを確かめる小さな検査を同じディレクトリに置く）
- 手順と判定の規則は spec FR-3 で固定済み。結果を `docs/design/past-rate-check/analysis/label-threshold-result.md` に書き、採った x・y を spec と `label.js` に反映する
- 母集団の決着（スリットの ST・実進入・3連単）は、BOA-271 の値の約束（F・出遅れ・欠場は NULL 等）と同じ扱いで作る

## 残る判断（plan では決めない）
- 定番／レアの線の値（T0-1 の結果）
- 形に添える全国の出現率の値（T0-2 の結果）
