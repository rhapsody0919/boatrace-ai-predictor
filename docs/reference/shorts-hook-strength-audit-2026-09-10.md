# Shorts動画フック強度監査（2026-09-10）

YouTube Shorts一覧・Shorts棚がカスタムサムネイルを表示せず動画本編内から任意のフレームを自動選択して表示する制約（`docs/reference/brand-kit.md`「シーンのフック強度均一化」参照）を踏まえ、`sns-video-studio/remotion/src/*CM.jsx` 全26ファイルの全コンポジション・全シーンを対象に行った初回監査の記録。

判定基準・恒久対策・参照実装は `docs/reference/brand-kit.md` の該当節を参照。本ファイルは監査の生データ（ファイル別詳細表）を保存する目的のみ。

---

## バッチ1（9ファイル）: AboutHeroCM / AccuracyProofCM / AnswerCheckHookCM / AshiyaCM / HitCheckCM / KimariteCM / LanguageSwitcherCM / LivePredictionCM / LivePredictionCM2

### AboutHeroCM.jsx（`AboutHeroDesktop` / `AboutHeroMobile`）
全10シーンが同一`SCENES`配列を共有。**全シーンでfontSizeが108px未満**（最大でも88px）。

| シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|
| SceneOpening | 0-120 | 弱い | 1,2 | 「龍神レーダー」(88/64px, WHITE w800)をGOLD＋900に変更しfitHeadline()で108px以上に |
| SceneProblem | 120-270 | 弱い | 1,2 | 「120通り」のGOLDハイライトを行全体に拡張、108px以上・GOLD統一 |
| SceneHome | 270-420 | 弱い | 1,2,3 | Caption(30/34px w700)が最弱。「24会場」を切り出しGOLD・108px以上に |
| ScenePrediction | 420-660 | 弱い | 1,2,3 | 同上パターン |
| SceneDataTable | 660-840 | 弱い | 1,2,3 | 「45項目以上」を数字強調に |
| SceneDataItems | 840-990 | 弱い | 1,2 | 「45項目」をGOLD・108px以上に |
| SceneTools | 990-1200 | 弱い | 1,2,3 | 「16種類以上」を数字強調に |
| SceneAccuracy | 1200-1380 | 弱い | 1,2,3 | 同上Captionパターン |
| SceneBlogTools | 1380-1530 | 弱い | 1,2 | タイトルをGOLD・108px以上に |
| SceneClosing | 1530-1680 | 弱い | 1,2 | ブランド名をGOLD＋900・拡大 |

備考: `Caption`共通コンポーネント（30/34px, WHITE, fontWeight700固定）が5シーンで使い回され、1箇所直せば5シーン一括改善できる。

### AccuracyProofCM.jsx（`AccuracyProofCM_C`）
GOLD定数が存在せず（ACCENT/GREENのみ）、ブランドゴールドを一度も使用していない。

| シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|
| SceneHook | 0-75 | 弱い | 4 | 問いかけのみ。「63.3%」「平均45.4%」を先出しGOLD・108px以上に |
| SceneReveal | 75-350 | 弱い | 1,2 | 「平均より18ポイントも高い…！」(40px GREEN)をGOLD・108px以上に |
| SceneCTA | 350-425 | 弱い | 1,2 | サイズを108px以上に拡大 |

### AnswerCheckHookCM.jsx（`AnswerCheckHookCM_Demo`）
GOLD定数が`#f59e0b`（アンバー）でbrand-kit承認色と異なる独自色。

| シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|
| SceneHook | 0-90 | 弱い | 1 | 62px WHITE w900を108px以上に |
| SceneTurnPrediction | 90-240 | 弱い | 1,2 | 34px ACCENTをGOLD・108px以上に |
| SceneVolatility | 240-420 | 弱い | 1,2 | 40pxをGOLD統一・108px以上に |
| SceneResult | 420-510 | 弱い | 1,2 | 52pxをWHITE+900またはGOLDに変更し拡大 |
| SceneCTA | 510-610 | 弱い | 1 | 44pxを108px以上に |

### AshiyaCM.jsx（`AshiyaCM` / `AmagasakiCM`、共通`VenueIntroTemplate`）
**唯一、合格シーンが存在するファイル。**

| シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|
| SceneHook | 0-75 | 弱い | 1 | 40px WHITE w900、108px以上に拡大のみ |
| **SceneStat** | 75-165 | **合格** | なし | 「60.4%」GOLD・130px・w900。参照実装として推奨 |
| SceneCompare | 165-255 | 弱い | 1 | 32pxを108px以上に |
| SceneCTA | 255-330 | 弱い | 1 | 44pxを108px以上に |

### HitCheckCM.jsx / KimariteCM.jsx / LivePredictionCM.jsx / LivePredictionCM2.jsx
いずれもGOLD定数なし（ACCENT/GREEN/WARNのみ）。「マスコットテスト」系列で骨格共通。

| ファイル | シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|---|
| HitCheckCM.jsx | SceneHook | 0-70 | 弱い | 1 | 52px→108px以上 |
| HitCheckCM.jsx | SceneTease | 70-115 | 弱い | 1,2 | 58px ACCENT→GOLD・108px以上 |
| HitCheckCM.jsx | SceneReveal | 115-315 | 弱い | 1,2 | 38px GREEN→GOLD/WHITE+900・拡大 |
| HitCheckCM.jsx | SceneCTA | 315-390 | 弱い | 1,2 | 32px GREEN→GOLD/WHITE+900・拡大 |
| KimariteCM.jsx | SceneHook | 0-75 | 弱い | 1 | 46px→108px以上 |
| KimariteCM.jsx | SceneReveal | 75-350 | 弱い | 1,2 | 40px GREEN→GOLD・拡大 |
| KimariteCM.jsx | SceneCTA | 350-425 | 弱い | 1,2 | 34px GREEN→GOLD/WHITE+900・拡大 |
| LivePredictionCM.jsx | SceneHook | 0-75 | 弱い | 1 | 46px→108px以上 |
| LivePredictionCM.jsx | SceneReveal | 75-350 | 弱い | 1,2 | 44px WARN→GOLD・拡大 |
| LivePredictionCM.jsx | SceneCTA | 350-425 | 弱い | 1,2 | 34px GREEN→GOLD/WHITE+900・拡大 |
| LivePredictionCM2.jsx | SceneHook | 0-75 | 弱い | 1 | 46px→108px以上 |
| LivePredictionCM2.jsx | SceneReveal | 75-350 | 弱い | 1,2 | 44px WARN→GOLD・拡大 |
| LivePredictionCM2.jsx | SceneCTA | 350-425 | 弱い | 1,2 | 34px GREEN→GOLD/WHITE+900・拡大 |

### LanguageSwitcherCM.jsx
`noteVideoShared.jsx`のGOLD(`#d4af37`)・`snsVideoShared.jsx`のSceneCTAを使用、brand-kit準拠度は他より高い。

| シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|
| SceneHook | 0-75 | 弱い | 1,4 | 76px GOLD w900だが問いかけのみ。108px以上＋断定要素の追加 |
| SceneScreenshot | 75-315 | 弱い | 1 | 64px GOLD w900、108px以上に |
| SceneCTA | 315-420 | 弱い | 1 | 44px WHITE w900、108px以上に |

備考: `SceneHook`背景の`RadarDecoration`（六角形装飾）はbrand-kit.mdで明示的に却下済みのコンポーネントと同名・同一実装。別途確認要。

### 横断所見（バッチ1）
1. 9ファイル・約35シーン中、108px以上は`AshiyaCM.jsx`の`SceneStat`(130px)のみ
2. `AccuracyProofCM`・`HitCheckCM`・`KimariteCM`・`LivePredictionCM`・`LivePredictionCM2`の5ファイルはGOLD定数が一切定義されておらず、ACCENT/GREEN/WARNを主役色に使用
3. `AshiyaCM.jsx`のSceneStatパターンが他シーン改善のリファレンス実装として使える
4. 改善は文字サイズ・色の変更のみで解決可能。新トークンの発明は不要

---

## バッチ2（9ファイル）: LivePredictionCM3 / LivePredictionHookCM / MascotCM / NoteExplainerCM / NoteExplainerLanguageSwitcherCM / OnboardingFlowCM / OutcomeDistributionCM / RaceInsightYoutubeCM / ReturnRateCM

キャンバス幅の確認: `NoteExplainerCM.jsx`・`NoteExplainerLanguageSwitcherCM.jsx`・`RaceInsightYoutubeCM.jsx`は1920×1080（横型）と`Root.jsx`で確認、閾値192pxで判定。他は1080×1920（閾値108px）。

### LivePredictionCM3.jsx（`LivePredictionCM_C`）
GOLD定数が未定義。

| シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|
| SceneHook | 0-75 | 弱い | 1 | 「33%」を切り出しfontSize180〜200px・GOLD・900に |
| SceneReveal | 75-350 | 弱い | 1,2 | 「100」をGOLD・200px級に拡大 |
| SceneCTA | 350-425 | 弱い | 1 | `noteVideoShared.jsx`のSceneCTAに差し替え |

### LivePredictionHookCM.jsx（`LivePredictionHookCM_Demo`）
GOLD定数が`#f59e0b`（アンバー、brand-kit承認色と異なる）。

| シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|
| SceneHook | 0-75 | **合格** | なし | 逃げ確率180px・GOLD・900。GOLD値の統一のみ推奨 |
| SceneTurnPrediction | 75-225 | 弱い | 1 | TOP1確率を150px級GOLDで再掲 |
| SceneVolatility | 225-405 | 弱い | 1 | パーセンタイルを150px級GOLDで再掲 |
| SceneCTA | 405-505 | 弱い | 1 | 44px→`noteVideoShared.jsx`のSceneCTAに差し替え |

### MascotCM.jsx（9コンポジション共通テンプレート）
GOLD定数が存在せず、ブランドゴールドを一切使用していない。

| シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|
| SceneHook | 0-75 | 弱い | 1,4 | 実数値を先出しし200px級GOLDに |
| SceneWarning | 75-155 | 弱い | 1,2 | 76px WARN→150px級GOLD |
| SceneReveal | 155-350 | 弱い | 1,2 | 90px GREEN→150px級GOLD |
| SceneCTA | 350-425 | 弱い | 1 | `noteVideoShared.jsx`のSceneCTAに統一 |

### NoteExplainerCM.jsx / NoteExplainerLanguageSwitcherCM.jsx（1920×1080、note埋め込み専用の可能性）
GOLD=`#d4af37`（ブランド準拠）。**note記事埋め込み用の限定公開運用のため、Shorts棚の対象外の可能性が高い。**

| ファイル | シーン | frame範囲 | 判定 | 該当基準 | 備考 |
|---|---|---|---|---|---|
| NoteExplainerCM.jsx | SceneHook | 0-90 | 弱い(形式上) | 1 | 96px、192px閾値未達。運用上の対象外判断が先 |
| NoteExplainerCM.jsx | SceneFeatures | 90-1290 | 弱い(形式上) | 1 | 実画面スクショが画面の73%を占め情報量は担保 |
| NoteExplainerCM.jsx | SceneCTA | 1290-1500 | 弱い(形式上) | 1 | GOLD・900の組み合わせは正しい |
| NoteExplainerLanguageSwitcherCM.jsx | SceneHook | 0-90 | 弱い | 1,4 | 「4言語」を数字として抜き出す案 |
| NoteExplainerLanguageSwitcherCM.jsx | SceneFeatures | 90-690 | 弱い | 1 | 同上 |
| NoteExplainerLanguageSwitcherCM.jsx | SceneCTA | 690-900 | 弱い(形式上) | 1 | 同上 |

### OnboardingFlowCM.jsx（サイト埋め込み専用の可能性）
GOLD=`#c9a227`（ブランド準拠）。**FirstVisitGuideCard・HowToUse.jsx埋め込み用のオンボーディング動画で、YouTube配信は想定されていない可能性が高い。**

全5シーンが共通`Caption`コンポーネント（44px, fontWeight700, WHITE）のみで構成され基準1・3に該当。対応要否は運用側で先に確認すべき。

### OutcomeDistributionCM.jsx / ReturnRateCM.jsx
GOLD=`#d4af37`（ブランド準拠）。同一著者・同一構成パターン。

| ファイル | シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|---|
| OutcomeDistributionCM.jsx | SceneHook | 0-75 | **合格** | なし | 「42.7%」fontSize200・GOLD・900 |
| OutcomeDistributionCM.jsx | SceneRanking | 75-280 | 弱い | 1 | 1位を大きく再掲してから一覧展開 |
| OutcomeDistributionCM.jsx | SceneTwist | 280-380 | 弱い | 1 | 44px→150px級GOLD |
| OutcomeDistributionCM.jsx | SceneCTA | 380-450 | 弱い | 1 | 40px→`noteVideoShared.jsx`パターンに |
| ReturnRateCM.jsx | SceneHook | 0-75 | **合格** | なし | 「1」fontSize560・GOLD・900 |
| ReturnRateCM.jsx | SceneRanking | 75-280 | 弱い | 1 | 1位を先に大きく見せてから一覧展開 |
| ReturnRateCM.jsx | SceneTwist | 280-380 | 弱い | 1 | 40px→150px級GOLD |
| ReturnRateCM.jsx | SceneCTA | 380-450 | 弱い | 1 | 40px→`noteVideoShared.jsx`パターンに |

### RaceInsightYoutubeCM.jsx（1920×1080、16:9通常動画枠）
GOLD=`#d4af37`、`fitHeadline()`導入済み（技術ルール準拠の唯一の対象ファイル）。**16:9アップロードはカスタムサムネイル設定が可能な運用のため、依頼の前提と異なる可能性がある。**

| シーン | frame範囲 | 判定 | 該当基準 | 備考 |
|---|---|---|---|---|
| SceneHook | 0-90 | 弱い(形式上) | 1 | `fitHeadline()`のmaxFontSize:128が192px閾値未達。適用するならmaxFontSizeを160〜200に |
| SceneStats | 90-270 | 弱い(形式上) | 1 | 3枚StatCard、各96px |
| SceneTurnPrediction | 270-450 | 弱い | 1 | 46px、TOP1のみ強調案 |
| SceneCTA | 450-600 | 弱い(形式上) | 1 | 54px/68px |

### 横断的な所見（バッチ2）
1. `LivePredictionHookCM`・`OutcomeDistributionCM`・`ReturnRateCM`はSceneHookのみ合格、以降のシーンは軒並み36〜46px。SceneHookで確立済みの「1要素を巨大化してGOLDで見せる」パターンを各シーンの最重要数値に繰り返し適用するのが再現性の高い改善策
2. GOLD定数の不統一: `LivePredictionHookCM.jsx`は`#f59e0b`（amber系）、`LivePredictionCM3.jsx`・`MascotCM.jsx`はGOLD自体が存在しない
3. `NoteExplainerCM`系・`RaceInsightYoutubeCM`（1920×1080）・`OnboardingFlowCM`（サイト埋め込み）はYouTube Shorts棚の対象外の可能性が高く、運用確認が先

---

## バッチ3（10ファイル）: RivalryCM / TechniqueConsistencyCM / TodaysMotorFormCM / TodaysRacerFormCM / ToolCM / ToolShowcaseCM / ToolTallyCM / TriviaCM / VenueRankingCM / YoungPersonaCM

### RivalryCM.jsx（`RivalryCM`）

| シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|
| SceneHook | 0-70 | **合格** | なし | 「1」560px GOLD/900 |
| SceneCompare | 70-210 | 弱い | 1 | 52px→「全国勝率+2.65pt上」を108px級に |
| SceneTwist | 210-320 | **合格** | なし | 「1号艇」160px WHITE/900 |
| SceneCTA | 320-390 | 弱い | 1 | 42px→GOLDの巨大語句を108px級に |

### TechniqueConsistencyCM.jsx（1920×1080、閾値192px）
`RadarDecoration`（brand-kit.mdで却下済みの六角形紋章）をCTA背景に使用している点も別途記録。

| シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|
| Hook(`DataQuoteCard`) | 0-90 | 弱い | 1 | 統計値をGOLD192px級で追加表示 |
| VenueBarChartScene(1号艇) | 90-320 | 弱い | 1 | 1位数値をGOLD192px級に |
| VenueBarChartScene(4号艇) | 320-580 | 弱い | 1 | 「会場差は約30pt」をGOLD192px級に |
| CompareScene | 580-740 | 弱い | 1 | 「5倍以上」をGOLD/900で192px級に |
| SceneCTA(`noteVideoShared`) | 740-950 | 弱い | 1 | CTA核をGOLDで192px級に |

### TodaysMotorFormCM.jsx / TodaysRacerFormCM.jsx

| ファイル | シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|---|
| TodaysMotorFormCM.jsx | SceneHook | 0-75 | **合格** | なし | 「53.16%」150px GOLD/900 |
| TodaysMotorFormCM.jsx | SceneTop | 75-263 | 弱い | 1 | 1位数値を108px級GOLDで追加 |
| TodaysMotorFormCM.jsx | SceneWorst | 263-450 | 弱い | 1 | ワースト1位をRED108px級に |
| TodaysMotorFormCM.jsx | SceneCTA | 450-600 | 弱い | 1 | GOLD強調語を108px級に |
| TodaysRacerFormCM.jsx | SceneHook | 0-75 | **合格** | なし | 「+1.26pt」150px GOLD/900 |
| TodaysRacerFormCM.jsx | SceneRising | 75-263 | 弱い | 1 | 1位delta数値をGOLD108px級に |
| TodaysRacerFormCM.jsx | SceneFalling | 263-450 | 弱い | 1 | RED108px級に |
| TodaysRacerFormCM.jsx | SceneCTA | 450-600 | 弱い | 1 | GOLD強調語を108px級に |

### ToolCM.jsx / ToolShowcaseCM.jsx（GOLD不使用、本バッチ内で最も弱いファイル群）

| ファイル | シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|---|
| ToolCM.jsx | SceneHook | 0-75 | 弱い | 1 | 「急上昇」をGOLD108px級に切り出す |
| ToolCM.jsx | SceneReveal | 75-350 | 弱い | 1,2 | 34px ACCENT→GOLD108px級 |
| ToolCM.jsx | SceneCTA | 350-425 | 弱い | 1,2 | GREEN→GOLD/900・108px級 |
| ToolShowcaseCM.jsx | SceneHook | 0-65 | 弱い | 1,2 | 96px ACCENT→GOLD108px以上 |
| ToolShowcaseCM.jsx | SceneProof | 65-135 | 弱い | 1,2 | 30px ACCENT→GOLD108px級の帯に |
| ToolShowcaseCM.jsx | SceneMontage | 135-300 | 弱い | 1,2 | labelをGOLD108px級に統一 |
| ToolShowcaseCM.jsx | SceneCTA | 300-390 | 弱い | 1,2 | GREEN→GOLD108px級 |

### ToolTallyCM.jsx

| シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|
| SceneHook | 0-75 | **合格** | なし | 「17」460px GOLD/900 |
| SceneReveal | 75-330 | 弱い | 1 | 「17種類」を再掲GOLD108px級に |
| SceneCTA | 330-405 | 弱い | 1 | 「17種類」をGOLD108px級に切り出す |

### TriviaCM.jsx

| シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|
| SceneHook | 0-70 | **合格** | なし | 「30代」260px GOLD/900 |
| SceneCompare | 70-270 | 弱い | 1 | ピーク数値「19.87%」をGOLD108px級に追加 |
| SceneExample | 270-330 | 弱い | 1 | 90px→108px以上に（僅かに未達） |
| SceneCTA | 330-420 | 弱い | 1 | 「無料」をGOLD108px級に切り出す |

### VenueRankingCM.jsx（20コンポジション、共通コンポーネント経由）
共通コンポーネントの判定（本PRで`SceneTop5`/`SceneWorst5`/`SceneVenueBars`/`SceneCTA`は修正済み。`SceneHook`（案A）は元々合格。`SceneHookDiagonal`（案B）・`SceneHookCompareTwo`（案C）は今回未対応）:

- `SceneHook`（案A）: **合格**（400px＋108px GOLD/WHITE・900）
- `SceneHookDiagonal`（案B）: 弱い（92px WHITE/900、基準1） — 未対応
- `SceneHookCompareTwo`（案C、`fitHeadline`使用）: 弱い（maxFontSize100が108px未達） — 未対応
- `SceneTop5`/`SceneWorst5`/`SceneVenueBars`/`SceneCTA`: **本PRで修正済み**（HeroStat追加・fitHeadline化）

影響コンポジション（20）: `VenueRankingCM`/`VenueRankingCM_EN`/`VenueRankingCM_Manshu`/`VenueRankingCM_Manshu_EN`/`VenueRankingCM_Manshu_EN_VariantB`/`VenueRankingCM_WinRate`/`VenueRankingCM_WinRate_VariantB`/`VenueRankingCM_WinRateCompareDemo`/`TriviaCM_GradeWinRateCompareDemo`/`VenueRankingCM_Motor2Rate`/`VenueRankingCM_TopStart`/`VenueRankingCM_TopStart_EN`/`VenueRankingCM_ExTime`/`VenueRankingCM_EdogawaLosing`/`VenueRankingCM_Top3Rate`/`BoatRankingCM_PlaceReturn`/`BoatRankingCM_RunnerUp`/`BoatRankingCM_TechniqueShare`/`BoatRankingCM_NarutoNigeWin`/`BoatRankingCM_TechniqueConsistency`

### YoungPersonaCM.jsx
`Logo`コンポーネントが「BoatAI」＋🚤絵文字を使用しており、他ファイルの「龍神レーダー」＋🐉と別ブランド名になっている（別途是正候補）。

| シーン | frame範囲 | 判定 | 該当基準 | 改善案 |
|---|---|---|---|---|
| SceneHook | 0-70 | 弱い | 2 | 「41%」200px ACCENT→GOLDに変更のみ |
| SceneBridge | 70-105 | 弱い | 1 | 64px WHITE/900→108px以上 |
| SceneScreen | 105-315 | 弱い | 1 | バッジ・反応文をGOLD108px級に |
| SceneCTA | 315-390 | 弱い | 1,2 | 30px GREEN→GOLD108px級に統一 |

### 横断所見（バッチ3）
1. ほぼ全ファイルで「本編中盤のランキング/データリストシーン」と「CTAシーン」が26〜54px程度のみで基準未達
2. `ToolCM.jsx`・`ToolShowcaseCM.jsx`・`YoungPersonaCM.jsx`はGOLDを一切使わずACCENT/GREENのみで主役テキストを構成
3. `TechniqueConsistencyCM.jsx`（1920×1080）は横型専用の主役テキストサイズ規定がbrand-kit.mdに無いため、今回の192px閾値運用は暫定
4. `VenueRankingCM.jsx`の共通コンポーネント経由の修正が最も費用対効果が高い（本PRで対応済み）
