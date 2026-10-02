# レース詳細ページのスマホ幅・色分け統一 screens

spec: [spec.md](./spec.md)。新しい画面は無く、レース詳細ページ（`/race/:raceId`・各言語版）の既存8タブと、基本情報タブ外の分析セクションの見た目だけを変える。

## 画面

| 画面 | 役割 | 変更 |
|---|---|---|
| レース詳細（`src/pages/RaceDetailPage.jsx`） | 1レースの出走表・分析・オッズ・結果をタブで見せる | 480px以下の余白（FR-1）。ページ側の CSS に置く |

## コンポーネント（タブ順）

すべて既存コンポーネントの修正で足りる。新規コンポーネントは作らない（App.jsx と RaceDetail.jsx の重複は無い。全タブが `PredictionPanel` の中にある）。

| タブ | コンポーネント | 役割 | 変更（ルール） | PR |
|---|---|---|---|---|
| 共通 | `RaceDetailPage.css` | ページの余白・端まで広げる指定 | 480px以下でページ 8px、セクション 0、カードの内余白 10px、表・グラフをカードの枠まで。`--rdp-bleed` を再計算（FR-1） | 1 |
| 共通 | `raceIndicators.jsx`（`bestOf`） | 最良値の判定 | 判定の一本化（FR-2） | 2 |
| 共通 | `DataRaceTable.css` | 出走表の見た目（`.drt-best` 等） | `.drt-up` / `.drt-down` を緑・赤に（FR-3） | 2 |
| 基本情報 | `RaceBasicInfoTab.jsx/.css` | 6艇の横棒、展開時の直近10走・得意会場・条件別・前期 | 横棒の最良ラベル R1、条件別 R1、前期の差 R2、得意会場の背景をトークンへ | 2 |
| 基本情報（タブ外） | `DataRaceTable.jsx` | データ出走表 | 調子の色のみ（R2） | 2 |
| 基本情報（タブ外） | `VenueTendencyPanel.jsx` | 会場の枠番別傾向 | 余白のみ（R3、向き無し） | 1 |
| 基本情報（タブ外） | `analysis/RacerFormChart.jsx` ほか埋め込み分析5つ、`AttackDefenseTable.jsx`、`analysis/MotorConditionChart.css` | 選手調子・STのズレ・展示推移・決まり手傾向・回収率・超展開 | R5（一律緑）、Δ矢印 R2、回収率100% R2、直書き色→トークン、凡例文言 | 2 |
| AI予想 | `TurnPatternList.jsx`、`VolatilityDisplay.jsx`、`OutcomePatternPreview.jsx`、`RaceAiPredictionTab.jsx` | 展開予測、イン崩れ注意度、出現パターン、確定後の検証 | 直書き→トークン、検証の的中/不的中 R2、BOA-619 の残り | 5 |
| 今節 | `RaceMeetTab.jsx/.css`、`RaceHistoryTable.jsx` | 6艇の今節・得点率早見・推移・選んだ1艇の走り | 前検 R1、早見の rgba→トークン、判定文 R2、日別の走りの着順色 | 3 |
| 直前情報 | `RaceBeforeInfoTab.jsx/.css`、`EntryCourseDistributionCard.jsx`、`RacePitReportSection.jsx` | 水面・展示タイム棒・展示情報・進入・ピットレポート | 展示タイムの最速印（R4）、展示情報の未判定行 R1。#1127 のマージ後 | 4 |
| 枠別情報 | `RaceWakuInfoTab.jsx/.css`、`RaceStConsiderationCard.jsx`、`NigeSimulationCard.jsx`、`RecentRunsBar.jsx` | コース別成績・全コース・ST考察・逃げたとき・決まり手傾向 | コース別成績・全コース R1、ST考察の抜出 R2 | 3 |
| モータ情報 | `analysis/MotorConditionChart.jsx/.css`、`MotorWakuStatsGrid.jsx` | モーター一覧・枠番別成績・推移・使用履歴 | R5、375pxの列の並び（未確定 → モックで決める）、展示推移の縦軸の向き | 4 |
| オッズ一覧 | `RaceOddsListTab.jsx/.css` | 全組み合わせの表・単複・推移 | 濃淡の固定水色→トークン（R6）。良し悪しの色は付けない | 5 |
| 結果 | `RaceResult.jsx`、`App.css`、`VenueDaySummaryCard.jsx` | 着順・払戻・その日の水面傾向 | rgba 直書き→トークン、BOA-619 の残り、水面傾向カードの二重の余白 | 5 |

## 共通化の方針

- R1 の見た目は `.drt-best` を元にした共通クラスを1つ作り、各表がそれを付ける。判定は `bestOf` を呼ぶ。個別の CSS に金の背景を書き足さない
- R2 の見た目（緑・赤＋記号）も共通クラスにする。既存の `.rsc-diff.is-better/.is-worse`、`.drt-motor-badge-up/-down` と同じトークンを使う
- 置き場所は plan（`/step2`）で決める（候補: `DataRaceTable.css` から切り出して `src/components/race/` の共通 CSS へ）

## トークン

- 既存トークンで表現できる: 最良（`--brand-accent-primary`）、良い（`--color-success-text`）、悪い（`--color-error-text`）、注意（`--color-warning-text`）、余白（`--spacing-2` = 8px）
- 新規に要る: 最良の背景・枠の濃さ（今は `color-mix(--brand-accent-primary 14%/40%)` を `.drt-best` に直書き）、R2 の背景（`--color-success-bg` は参照されているが未定義）、オッズの濃淡（今は固定の `--color-primary-alpha-*` でテーマ非対応）、カードの内余白 10px（`--spacing-*` に 10px が無い。ページ側の変数にする）
- 新規 CSS が要るのは、480px以下の余白（ページ側）と共通クラスだけ

## ワイヤー（375px）

### 余白（FR-1）

```
今                                         案B
|12|16|1|12|   表 293px   |12|1|16|12|      |8|1|      表 357px       |1|8|
```

### モータ情報の列（未確定）

```
今（数値が画面外）                  候補1: 左の列を1つにまとめる          候補2: データ出走表と同じ縦横
枠番|選手名|モーター番号|2連率→     ①権藤 15号機|2連率|3連率|前検|機力   指標 |①|②|③|④|⑤|⑥
                                    行を押すと推移（今のまま）            2連率|55.0|41.9|...
                                                                          列見出しを押すと推移
```

## 未確定

- モータ情報の列の並び（候補1・2）: モックでユーザーが決める
- 展開予測の最も高い確率に R1 を付けるか: モックでユーザーが決める
- 同値の最良（例: 展示タイム 1号艇と6号艇がともに 6.71）: `bestOf` は艇番の若い方1つだけを光らせる。両方を光らせるかをモックでユーザーが決める（参考の表の挙動も変わる）
