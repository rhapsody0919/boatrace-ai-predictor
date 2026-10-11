# キャッシュ戦略ガイド

キャッシュ時間の誤設定は、本番環境パフォーマンスと Supabase のコスト（EGRESS通信量）に大きく影響します。このドキュメントは**必読**です。

---

## 基本原則

**キャッシュ時間 = バッチ更新間隔**

```
キャッシュ時間が短すぎる   → Supabase への無駄なクエリ → コスト増
キャッシュ時間が長すぎる   → ユーザーが古いデータを見る → UX 劣化
```

---

## キャッシュパターン

### パターン A: 毎日1回更新（バッチ実行）

**対象テーブル：**
- `accuracy_cache` — 精度統計（毎日 JST 23:30 更新）
- `race_history_cache` — レース履歴（毎日 JST 23:30 更新）
- `outcome_distribution` — 出目分布（毎日 JST 00:30 更新）

**推奨キャッシュ設定：**
```javascript
"Cache-Control": "s-maxage=86400, stale-while-revalidate=3600"
```

**解説：**
- `s-maxage=86400`（1日）：バッチ実行から次のバッチ実行まで、同じキャッシュを使用
- `stale-while-revalidate=3600`（1時間）：キャッシュ期限後 1時間は古いデータを返しながらバックグラウンド更新

**Edge Functions：**
- ✅ `api/accuracy/index.js`
- ✅ `api/race-history/summary.js`
- ✅ `api/outcome-distribution/index.js`

---

### パターン B: リアルタイム/頻繁更新

**対象テーブル：**
- `races` — 本日のレース（随時更新）

**推奨キャッシュ設定：**
```javascript
"Cache-Control": "s-maxage=300, stale-while-revalidate=60"
```

**解説：**
- `s-maxage=300`（5分）：短期キャッシュで頻繁な更新に対応
- `stale-while-revalidate=60`（1分）：期限後も古いデータを使いながら更新

**Edge Functions：**
- ✅ `api/races/today.js`

**ボット向け HTML の関数（ADR 0089、Node・syd1）：**
- ✅ `api/bot-page/top.js`・`api/bot-page/venue/[code].js`（ヘッダーは `api/_lib/botPage.js`）

```javascript
"Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60, stale-if-error=3600"
```

- 材料の `api/races/today.js`（s-maxage=300）より短くしても新しくならないので、同じ300秒にする
- `max-age=0`: ブラウザには残さない。CDN だけが持つ
- `stale-if-error=3600`: 関数が 5xx を返したとき、CDN に前回の正常な応答があれば1時間までそれを返す
- 関数の中でも、材料の JSON をモジュールスコープで60秒だけ使い回す。CDN のキャッシュが効かなかった場合も、`/api/races/today` と DB への取得を増やさない
- 失敗（材料が取れない・形が違う）は 503・`Retry-After: 300`・`Cache-Control: no-store`。404・405 も `no-store`（任意のパスで CDN のキーを増やさない）
- CDN のキーにはクエリ文字列が入る。関数はクエリを見ないが、クエリ付きの URL は別のキーになる（材料の取得は上の60秒の使い回しで抑える）

---

## キャッシュ時間を変更する際のチェックリスト

Cache-Control ヘッダーを変更する前に、必ず以下を確認してください：

- [ ] **バッチ更新頻度を確認した**
  ```bash
  grep -r "schedule:" .github/workflows --include="*.yml"
  ```
  該当スクリプトの実行時刻を確認

- [ ] **テーブルの更新スクリプトを確認した**
  ```bash
  grep -r "upsert\|INSERT" scripts/daily/ --include="*.js"
  ```
  実際に毎回データが更新されているか確認

- [ ] **既存パターンと一貫性がある**
  ```bash
  node scripts/verification/verify-cache-config.js
  ```
  検証スクリプトで整合性をチェック

- [ ] **PR でレビュー受けた**
  必ず PR 経由で他者のレビューを受ける

---

## Supabase EGRESS コストへの影響

**キャッシュなし（毎回Supabaseに問い合わせ）：**
```
/races ページ × 100ユーザー × 30秒間隔 = 200リクエスト/分
= 288,000リクエスト/日
```

**1日キャッシュ（毎日1回だけ更新）：**
```
update-race-history-cache.js × 1回/日 = 1リクエスト/日
```

**差分：** 288,000 → 1 **（288,000倍の削減）**

キャッシュ設定の誤りは、直接的にコストの増加につながります。

---

## 検証と監視

### 検証スクリプト
```bash
node scripts/verification/verify-cache-config.js
```

このスクリプトは以下をチェック：
- 各 Edge Function の Cache-Control ヘッダー
- s-maxage と stale-while-revalidate の値
- パターンとの整合性

### CI での自動検証
- PR 作成時に検証スクリプトを実行（`.github/workflows/verify-cache-config.yml`）
- push 時に pre-push hook で検証（セットアップ手順参照）

---

## トラブルシューティング

**症状：** /races ページのデータが古いままになっている

**原因の調査順序：**
1. キャッシュを無視してリクエスト：`?t=$(date +%s)` を追加
2. Supabase から直接取得：Supabase ダッシュボードで確認
3. race_history_cache の更新時刻：`updated_at` フィールドを確認
4. バッチスクリプトの実行：GitHub Actions のログを確認

**解決方法：**
- CDN キャッシュの場合：時間経過で自動解決（最大 1日）
- キャッシュ設定の誤り：このドキュメント参照 → 修正 → PR → デプロイ

---

## 参考

- **キャッシュ検証スクリプト：** `scripts/verification/verify-cache-config.js`
- **バッチ実行スケジュール：** `.github/workflows/calculate-accuracy.yml` など
- **Vercel Cache-Control リファレンス：** https://vercel.com/docs/edge-network/caching
