# ADR 0024: 会場統計データ取得フックの分離

## ステータス
採用

## 背景

FR-2「この会場の枠番別傾向」パネルは、`venue_code`単位で完結する4つの会場統計関数（`getWinningTechniqueStats`/`getTopStartStats`/`getLosingTechniqueStats`/`getExhibitionTimeTopStats`、いずれも`src/services/supabaseDataService.js`、`withCache`済み）を並列取得する必要がある。既存の`src/hooks/useRaceAnalysisData.js`は`raceId`を唯一の引数として7つの分析関数を束ねるフックだが、`SOURCES`の各関数は`fn(raceId)`という契約で呼ばれており、`venueCode`引数を取る関数をそのまま混ぜ込むことができない。

## 決定

新規フック`src/hooks/useVenueTendencyStats.js`を作成し、`venueCode`を引数に4関数を個別に`.then()`で並列発火する（`useRaceAnalysisData`と同じprogressive loadingパターン。各クエリは独立して解決され、取得できたものから順次stateに反映される）。`useRaceAnalysisData`とは完全に独立したフックとし、`VenueTendencyPanel`コンポーネントから呼び出す。

## 却下した選択肢

- **`useRaceAnalysisData`のcontractを拡張し`venueCode`も受け付ける**: 既存フックの`SOURCES`契約（`fn(raceId)`固定）が汚れ、可読性が低下する。`raceId`単位のデータと`venueCode`単位のデータでは更新頻度・キャッシュ粒度・呼び出しタイミングの性質が異なり（前者はレースごとに変わる、後者は同じ会場なら複数レースで共有できる）、同じフックで扱うと「なぜこの関数だけraceIdを無視するのか」が分かりにくくなる
- **フックを作らずコンポーネント内に直接`useEffect`で書く**: `VenueTendencyPanel`単体では動くが、将来他の画面（例: 会場一覧ページ）で同じ会場統計が必要になった場合に再利用できない。ロジックのテストもしにくくなる

## 影響

- `useRaceAnalysisData`は無変更。既存のレース詳細の主要機能（DataRaceTable等）への影響はゼロ
- `useVenueTendencyStats`は`venueCode`が変わらない限り（同じ会場の別レースを連続で開く場合等）、`withCache`によりキャッシュヒットし再フェッチが発生しない
