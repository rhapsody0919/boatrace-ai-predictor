# 龍神レーダー 改善TODO

## 優先度: 高

### パフォーマンス改善
**詳細計画**: [PERFORMANCE_IMPROVEMENT_PLAN.md](./PERFORMANCE_IMPROVEMENT_PLAN.md)

| Phase | 内容 | 工数 | 状態 |
|-------|------|------|------|
| 1 | localStorage永続化キャッシュ | 1.5時間 | **完了** (2026-01-12) |
| 2 | Supabase RPC関数 + Vercel Edge | 4時間 | **実装済み** (2026-01-12) ※RPC関数の登録が必要 |
| 3 | 静的JSON生成（過去データ） | 半日 | 未着手 |
| 4 | スキーマ拡張性（JSONB化） | 1日 | 未着手 |

---

## 優先度: 低

### 予想根拠の改善
**現状**: フロントエンドでルールベースのテンプレートから動的生成
- `supabaseDataService.js`の`generateReasoning`関数でif文による条件分岐
- 実際の予測ロジック（AIスコア計算）とは無関係
- 「なぜこの選手が選ばれたか」の本当の理由ではない

**改善案**:
1. **バックエンドで生成** - 予想生成時(`generate-predictions.js`)に、実際のスコア計算過程から根拠を生成してDBに保存
2. **feature_contributions活用** - DBの`feature_contributions`カラムに各要素の寄与度を保存し、それを元に根拠を生成

**関連ファイル**:
- `src/services/supabaseDataService.js` - `generateReasoning`関数
- `scripts/generate-predictions.js` - 予想生成ロジック
- Supabase `predictions`テーブル - `feature_contributions`カラム

---

## 優先度: 中

### CSSリファクタリング (Phase 4)
- `!important`削除 (57箇所)
- インラインスタイル整理 (175+箇所)
- 共通スタイル(`shared.css`)作成

### サービス層更新 (Phase 5)
- `supabaseDataService.js`の定数を`constants/index.js`からimport
- ページネーションヘルパー関数の抽出

---

## 完了済み

### コードベースリファクタリング (2026-01-12)
- [x] Phase 1: 共通ユーティリティ作成（constants, formatters, colors, dateUtils）
- [x] Phase 2: バックエンドライブラリ作成（dateUtils, hitCalculator, payoutCalculator）
- [x] Phase 3: 大規模コンポーネント分割
  - RaceDetail.jsx: 1023→457行
  - AccuracyDashboard.jsx: 698→340行
  - HitRaces.jsx: 663→306行
