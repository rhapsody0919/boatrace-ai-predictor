# レース詳細×分析ツールデータ統合 plan

spec: `spec.md` / screens: `screens.md`

## データ設計

- **既存テーブルの変更なし**。`winning_technique_stats`/`top_start_stats`/`losing_technique_stats`/`exhibition_time_top_stats`（`docs/db-migration/023,025,026,028`）はいずれもサンプル数カラム（`total_races`/`race_count`/`total_losses_90days`等）を既に持ち、FR-2のn数併記・閾値運用はこれをそのまま使う。マイグレーション不要
- **API層のみの変更**: `src/services/supabaseDataService.js`の`getTopStartStats`/`getExhibitionTimeTopStats`は現状`last_updated`をレスポンストップレベルに正規化しておらず、`getWinningTechniqueStats`/`getLosingTechniqueStats`と形が不統一（前回のデータエンジニアレビューで判明）。4関数共通で`{venue_code, last_updated, data}`の形に揃える
- FR-1のクリック計測はDBスキーマと無関係（GA4イベント送信のみ）

## コンポーネント構成・データフロー

```
RaceDetail.jsx
  └ PredictionSection
      └ PredictionPanel.jsx（venueCode, raceId, predictionを保持）
          ├ DataRaceTable（既存・無変更、行リンクにtrackEvent追加のみ）
          ├ VenueTendencyPanel（新規、venueCodeのみ必要）
          │   └ useVenueTendencyStats(venueCode) → 4関数をPromise.allで並列取得
          │       マウント時（デフォルト展開のため）即座にフェッチ開始
          ├ EmbeddedAnalysisSection × 7（新規ラッパー、venueCode+raceIdを子へ渡す）
          │   └ expanded=false の間は children を一切マウントしない
          │   └ expanded=true になった瞬間、対応コンポーネントを
          │       embedded=true, initialVenueCode, initialRaceId 付きでマウント
          │       （各関数はwithCache済みのため、開閉を繰り返しても
          │        2回目以降はキャッシュヒットで実質瞬時に再表示される）
          └ AiAnalysisSection（既存・無変更）
```

- `VenueTendencyPanel`は`PredictionPanel`のマウントと同時にデータ取得を開始する（デフォルト展開のため遅延させない）
- `EmbeddedAnalysisSection`はアコーディオンの開閉状態をローカルstateで持ち、子コンポーネントの条件付きレンダリング（`{expanded && <Component embedded .../>}`）でlazy mountを実現する。閉じた際は素朴にunmountする（`display:none`での維持はしない。開くまでデータ取得しないという要件を「マウントしない」という一番単純な形で満たすため）
- FR-1のクリック計測は`DataRaceTable.jsx`/`VolatilityDisplay.jsx`/`OutcomePatternPreview.jsx`の各`Link`に`onClick={() => trackEvent("deep_link_click", { tab, source })}`を追加するのみ。データフローへの影響なし

## 既存サービス層・共通ライブラリとの連携

- `src/services/supabaseDataService.js`: 新規関数追加なし。既存4関数のレスポンス形状統一のみ
- `src/hooks/useRaceAnalysisData.js`: 無変更（ADR-0024参照、責務を分離し会場統計は触れさせない）
- `src/hooks/useVenueTendencyStats.js`: 新規。`useRaceAnalysisData.js`と同じ`src/hooks/`配下に配置し、命名規則を揃える
- `src/utils/analytics.js`: 既存`trackEvent`関数をそのまま呼び出すのみで、関数自体の変更は不要と想定（実装時に既存シグネチャを確認し、必要なら軽微な拡張を行う）

## 主要な技術判断（ADR）

- [ADR-0023: 分析ツールコンポーネントのレース詳細埋め込み方式](../../adr/0023-embedded-analysis-component-mode.md) — `embedded`propによる条件分岐方式を採用。コンテナ/プレゼンテーション分離、コンポーネント複製は却下
- [ADR-0024: 会場統計データ取得フックの分離](../../adr/0024-venue-tendency-stats-hook-separation.md) — `useVenueTendencyStats`を独立フックとして新設。`useRaceAnalysisData`拡張、コンポーネント内直接取得は却下
