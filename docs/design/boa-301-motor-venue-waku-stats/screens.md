# モーター単体の会場内比較・枠番別成績 screens

対応: [spec.md](./spec.md)

## 影響する画面・コンポーネント一覧

| コンポーネント | パス | 役割 | 新規/拡張 |
|---|---|---|---|
| `MotorConditionChart` | `src/components/analysis/MotorConditionChart.jsx` | モーター調子の中心コンポーネント。既に`embedded`プロパティでレース詳細ページの「モータ情報」タブ（PR #661）と分析ツール「モーター調子」タブの両方に埋め込まれている（BOA-265/283で確立済みの共通コンポーネント方式）。今回のFR-1〜FR-4のデータ取得・状態管理・レイアウト分岐をここに追加する | **拡張** |
| `MotorVenueRankBadge`（新設） | `src/components/analysis/` | FR-1（会場内ランキング）専用の小さな順位バッジ（例:「会場内3位／24機中」）。`MotorStatBadgeRow`の`badges`配列に渡す1要素として実装できないか先に検討し、専用コンポーネントが要る場合のみ新設する | 新規（`MotorStatBadgeRow`の拡張で足りる場合は不要） |
| `MotorWakuStatsGrid`（新設） | `src/components/analysis/` | FR-2/FR-3（枠番別1着率/2連率/3連率・展示タイム推移）の6コース分グリッド。`embedded=true`時は「今日の艇番」の1行のみ強調表示＋タップで全6コース展開、`embedded=false`時は最初から6コース全部表示 | 新規 |
| `MotorRacerWakuDrillDown`（新設） | `src/components/analysis/` | FR-4（選手×モーター×枠）のドリルダウン。`DrillDownHeader`を流用し、その配下に選手別・枠番別の成績リスト（n数併記）を表示 | 新規 |
| `MotorStatBadgeRow` | `src/components/MotorStatBadgeRow.jsx` | 既存の汎用バッジ行コンポーネント（`{ icon, label, badges }`という素直なprops）。FR-1の順位バッジもこの`badges`配列に追加するだけで対応できる可能性が高い | 拡張（propsのみ、コンポーネント本体の変更なし） |
| `MotorRecordStatCards` | `src/components/MotorRecordStatCards.jsx` | 既存の汎用カードコンポーネント（`{ cards }`）。会場内ランキングのサマリーカード等に流用できる | 拡張（propsのみ） |
| `DrillDownHeader` | `src/components/analysis/DrillDownHeader.jsx` | 既存のドリルダウン見出し。`MotorRacerWakuDrillDown`から流用 | 既存のまま利用 |
| `PredictionPanel.jsx` | `src/components/race/` | レース詳細ページの「モータ情報」タブから`MotorConditionChart`を`embedded=true`で呼び出している箇所（PR #661で実装済み）。propsの追加が必要なら変更するが、基本的に呼び出し側の変更は不要な設計にする | 変更なし想定 |
| `supabaseDataService.js` | `src/services/` | 新規データ取得関数を追加: `getVenueMotorRanking(venueCode, metric)`（FR-1、`venue_motor_stats`から）、`getMotorWakuStats(venueCode, motorNumber)`（FR-2/3、`race_entries`×`race_results`×`exhibition_data`から自社集計）、`getMotorRacerWakuStats(venueCode, motorNumber)`（FR-4、選手別内訳） | 新規関数追加 |

## コンポーネント再利用方針（`.claude/rules/component-reuse.md`準拠）

- 同じUIパターンを`App.jsx`と`RaceDetail.jsx`相当の箇所に別々実装しない、という原則は既に`MotorConditionChart`の`embedded`プロパティ分岐で満たされている。今回追加する`MotorWakuStatsGrid`・`MotorRacerWakuDrillDown`も同じ`embedded`フラグで表示範囲を切り替える設計にし、新規に別コンポーネントを作らない
- `MotorStatBadgeRow`・`MotorRecordStatCards`は既に汎用的なprops設計（配列を渡すだけ）のため、コンポーネント自体の変更なしにFR-1のデータを流し込める見込み。実装時に本当に専用コンポーネントが必要か再確認すること

## デザイントークンで表現できる部分・新規CSSが必要な部分

- 色・余白・カード装飾は既存の意味トークン（`--surface-card`、`--text-primary`等）でそのまま表現できる
- **枠番（コース）を表す色について新規の判断が必要**: 既存の`BOAT_COLORS`（艇番1-6の白/黒/赤/青/黄/緑）をそのまま「コース番号」の色として流用すると、BOA-257解消後に「艇番」と「進入コース」が一致しないケースが可視化された際に誤解を招く（艇番の色なのかコースの色なのか混同する）。**対応方針**: 枠番別グリッド（`MotorWakuStatsGrid`）では艇番色を使わず、中立的な連番スタイル（例: 番号バッジ＋グレースケールの棒）にする。艇番そのものを表示する箇所（今日のレースの艇番強調表示等）でのみ`BOAT_COLORS`を使う
- `MotorWakuStatsGrid`の展示タイム推移（スパークライン）は新規CSS（SVGベース、`枠別情報タブ`で確立予定のバー描画パターンを流用）が必要

## 未確定事項の扱い（spec.mdから継続）

- BOA-257（進入コース精度）は実装着手済み（別Agent）。本画面のFR-2〜FR-4は、BOA-257解消前は艇番＝進入コースという前提で暫定実装し、解消後にデータソースを差し替えられるよう、コンポーネント側は「コース番号」を抽象的なpropとして受け取る設計にする（艇番と直結させない）
- モーター交換の扱い（BOA-329で別途検証中）は、本画面では暫定的に「直近N走」等の窓を設けることでリスクを緩和する方向で`/step2`にて具体化する
