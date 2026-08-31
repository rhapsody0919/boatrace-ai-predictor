# ADR 0023: 分析ツールコンポーネントのレース詳細埋め込み方式

## ステータス
採用

## 背景

レース詳細×分析ツールデータ統合（`docs/design/race-detail-analysis-integration/`）のFR-3〜9で、`/winning-technique`の7コンポーネント（`MotorConditionChart`/`RacerFormChart`/`StPredictabilityChart`/`ExhibitionTimeTrendChart`/`RacerTechniqueProfileChart`/`RacerBoatReturnRateChart`/`AttackDefenseAnalysis`）をレース詳細ページ内に折りたたみで埋め込む。これらは全て単独ページ利用を前提に、自前の会場・レース選択プルダウン（state込み）を内包している。レース詳細側では会場・レースは既に確定しているため、このプルダウンをどう扱うかの実装方式を決める必要がある。

## 決定

各コンポーネントに`embedded`（真偽値、デフォルト`false`）propを追加する。`embedded=true`の場合:
- 会場・レース選択プルダウンのJSXをレンダリングしない
- `selectedVenue`/`selectedRace`のstateは`initialVenueCode`/`initialRaceId`propで固定し、ユーザー操作による変更を受け付けない
- それ以外のデータ取得・表示ロジックは無変更

既存の`initialVenueCode`/`initialRaceId`props自体は7コンポーネントとも既に持っているため、追加の変更は`embedded`prop 1つと、プルダウンJSXを囲む条件分岐のみで済む。

## 却下した選択肢

- **コンテナ/プレゼンテーション分離**: 各コンポーネントを「会場・レース選択ロジック（コンテナ）」と「データ表示のみ（プレゼンテーション）」に分割し、埋め込み側は表示コンポーネントを直接使う。責務分離としては最も筋が良いが、7コンポーネント全てをリファクタする工数が大きく、`/winning-technique`側の既存動作を壊すリスクも増える。「1つずつ段階的に改修」という合意済みの実装順序とも相性が悪い（1コンポーネントごとに大規模リファクタが発生する）
- **埋め込み専用コンポーネントを複製**: 7つの新規コンポーネントを別途作成する。既存コンポーネントを一切変更しないため安全に見えるが、DRY原則に反し、表示ロジック（n数表示・データ不足時の扱い等）が2箇所で管理されることになり、将来の仕様変更のたびに2箇所修正が必要になる

## 影響

- 各コンポーネントへの変更は最小限（prop追加+条件分岐）で、既存の`/winning-technique`ページの動作に影響しない
- 将来、埋め込み側でも会場・レースを切り替えたいという要望が出た場合は、この設計では対応できない（`embedded=true`時は選択不可の前提のため）。その場合は改めて設計判断が必要
