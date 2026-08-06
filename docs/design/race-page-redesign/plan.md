# レースページ再設計 plan

spec: `docs/design/race-page-redesign/spec.md`

## コンポーネント構成

```
PredictionSection（既存・App/RaceDetail共通）
├── <h2> 📊 {会場} {N}R
├── PredictionPanel（既存・並び替え）
│   ├── 公式サイトリンク（既存のまま）
│   ├── ★ DataRaceTable（新規）データ出走表 … FR-1
│   ├── ★ AiAnalysisSection（新規ラッパー）… FR-2
│   │   └── 既存のAI予想ブロック群を無変更で内包
│   │       （VolatilityDisplay / ModelDescription / ModelSwitcher /
│   │         AnimatePresence[PredictionFlash / FirstMarkAnimation /
│   │         BettingValueSection / AttackDefenseTable /
│   │         OutcomePatternPreview / PredictionTable]）
│   ├── SocialShareButtons（既存のまま）
│   └── 会場攻略ガイドリンク（既存のまま）
├── RaceResult（既存のまま）
└── ★ RaceReview（新規）データで振り返る … FR-3
```

ページ側（App.jsx / RaceDetail.jsx）は無改修。`PredictionSection`/`PredictionPanel`が両ページ共通のため、新コンポーネントの配置だけで両対応が完了する（調査結果6-1〜6-3）。

## データフロー

### 新規フック `useRaceAnalysisData(raceId)`（src/hooks/）

```js
// raceId が null なら何もしない
// Promise.allSettled で6関数を並列取得。個別失敗は該当キーが null
{
  motor,            // getRaceMotorBreakdown
  racerForm,        // getRaceRacerFormBreakdown
  stPredictability, // getRaceStPredictabilityBreakdown
  exhibitionTime,   // getRaceExhibitionTimeBreakdown
  techniqueProfile, // getRaceTechniqueProfileBreakdown
  returnRate,       // getRaceRacerBoatReturnRate
  loading,          // 全体ロード中フラグ
}
```

- `DataRaceTable`と`RaceReview`の両方がこのフックを使う。サービス層の`withCache`（30分TTL・localStorage併用）により、2回目以降の呼び出しはキャッシュヒットでコストゼロ
- raceId導出: `selectedRace.id`が無い場合（おすすめ自動選択パス）は`rawData`の`date`/`placeCd`/`raceNo`から`YYYY-MM-DD-VV-RR`を組み立てる。導出不能ならnullを渡し分析行は非表示

### 技術判断（複数案の比較）

**A. データ取得の場所**
- 案1: 各コンポーネントが個別にサービス関数を呼ぶ → 呼び出しが分散し重複ロジックが増える
- 案2: `useRaceAnalysisData`フックに集約（採用）→ DataRaceTable/RaceReviewで共有、キャッシュ前提で自然
- 案3: PredictionSectionでまとめて取得しprops渡し → props肥大（既に8個）が悪化

**B. デスクトップとモバイルのレイアウト**
- 案1: 通常テーブル（列=指標）+ モバイルで横スクロール → 既存PredictionTableで既にmin-width 1100pxの問題があり、指標追加で悪化
- 案2: 転置テーブル（行=指標、列=6艇）を全ビューポート共通（採用）→ 6艇固定なので幅が予測可能、`AttackDefenseTable`の実績パターンを流用、メンテするレイアウトが1つ
- 案3: モバイルのみカード展開式 → レイアウト2系統のメンテコスト

**C. 色分けの基準**
- 案1: 絶対閾値（例: 回収率100%以上は緑）→ 指標ごとに閾値の妥当性検証が必要になり恣意性が入る
- 案2: レース内相対順位（採用）→ 行ごとに6艇中の順位で機械的に色付け。恣意的判断ゼロ
- ※回収率の100%基準のみ「購入原資を上回るか」という客観的意味があるため例外的に併用

## CSS

- 新規: `DataRaceTable.css` / `AiAnalysisSection.css` / `RaceReview.css`（各コンポーネント専用。App.css/RaceDetail.cssには追記しない — 調査で発見した二重定義問題Hを繰り返さない）
- design-tokens.cssの変数を使用（`--color-primary-500`系、`--color-success`/`--color-error`、`--spacing-*`、`--radius-*`）
- 転置テーブルのモバイル縮小は`AttackDefenseTable.css`の実績値を踏襲

## i18n

`src/locales/{ja,en,zh-TW,ko}/common.json`に以下のキー群を追加:
- `dataTable.*`（データ出走表のタイトル・行ラベル・凡例）
- `aiSection.*`（AIデータ分析のヘッダ・本命サマリー・展開/折りたたみ）
- `review.*`（振り返りのタイトル・整合/相違ラベル・AI検証文）

## e2e

- 既存テスト「トップページ（本日の予想）からデータ分析ツールへの導線がある」は`analysis-tools-link`を参照 → リンクは残すため影響なし
- 新規: トップページでレース選択→データ出走表が表示される / AIデータ分析セクションが展開できる
- 新規: 過去日付ページ（既存テストで実績のある日付を使用）でレース選択→「データで振り返る」が表示される

## リスク

- `getRaceRacerBoatReturnRate`は最重量（180日+ページネーション、過去に1度statement timeout観測）→ allSettledで個別失敗を許容し「—」表示
- FirstMarkAnimation（1209行）を折りたたみ内に移動することでアニメーション初期化タイミングが変わる可能性 → 展開時に正常動作するかPlaywrightで確認
- ModelSwitcherのframer-motion `layoutId`が折りたたみ内で動くか → 同上
