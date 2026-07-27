# 会場別ビジターガイド 全会場化・フル拡充 — タスク分解

spec.md / screens.md / plan.md を踏まえたタスク分解。依存順に並べる。1タスク=1PR目安。

地域区分（plan.mdの`venueRegions.js`、24会場の内訳）:
- **Kanto**: 桐生(1)・戸田(2)・江戸川(3)・平和島(4)・多摩川(5) ※江戸川/平和島/多摩川は実装済み
- **Chubu/Tokai**: 浜名湖(6)・蒲郡(7)・常滑(8)・津(9)・三国(10)
- **Kinki**: びわこ(11)・住之江(12)・尼崎(13) ※住之江は実装済み
- **Shikoku**: 鳴門(14)・丸亀(15)
- **Chugoku**: 児島(16)・宮島(17)・徳山(18)・下関(19)
- **Kyushu**: 若松(20)・芦屋(21)・福岡(22)・唐津(23)・大村(24) ※福岡は実装済み

## Phase A: 基盤整備

- [x] **A1. データスキーマ拡張 + 地域マスタ作成**（[BOA-135](https://linear.app/boat-ai/issue/BOA-135)）
  `venueGuidesEn.js` に `regionGroup`/`nearbyAttractions`/`schedule`/`image` フィールドを追加し、既存5会場分の値を埋める。`src/data/venueRegions.js` を新規作成（6地域のマスタ定義）。既存5会場の画像もこのタスクでCC素材を調査・追加する
- [x] **A2. VenueCard共通コンポーネント抽出**（[BOA-136](https://linear.app/boat-ai/issue/BOA-136)）
  `VenueGuideList` からカードのレンダリングを `VenueCard` として抽出。一覧ページの見た目に変更がないことをPlaywrightで確認（既存英語版・zh-TW版のリグレッションチェック）
- [x] **A3. VenueStructuredData共通コンポーネント作成**（[BOA-137](https://linear.app/boat-ai/issue/BOA-137)）
  `TouristAttraction`（詳細）/`ItemList`（一覧・地域ハブ）+ `BreadcrumbList` のJSON-LDを出力。既存5会場の一覧・詳細ページに適用し、Googleリッチリザルトテストで有効性を確認
- [x] **A4. 地域別ハブページ実装**（[BOA-138](https://linear.app/boat-ai/issue/BOA-138)）
  `VenueRegionHub` コンポーネント + ルーティング（`/en/venues/region/:regionSlug`）を追加。既存5会場のデータ（A1で付与した`regionGroup`）で動作確認。sitemapへの追加も本タスクに含める
- [x] **A5. `scripts/lib/googleServiceAuth.js` 抽出**（[BOA-139](https://linear.app/boat-ai/issue/BOA-139)）
  `i18n-demand-report.js` の認証ロジックを共通化。既存の動作が変わらないことを確認（月次レポート実行で確認）
- [x] **A6. `search-console-report.js` 新規実装**（[BOA-140](https://linear.app/boat-ai/issue/BOA-140)）
  A5の共通認証を使い、Search Console APIから検索順位・CTRを取得するレポートスクリプトを実装。`docs/operation/`にセットアップ手順（サービスアカウント権限付与手順）を追加

## Phase B: 既存5会場のフル化

- [x] **B1. 既存5会場に新規セクション追加**（[BOA-141](https://linear.app/boat-ai/issue/BOA-141)）
  平和島・住之江・江戸川・多摩川・福岡の5会場に、周辺観光・グルメ（`nearbyAttractions`）と開催カレンダー詳細（`schedule`）セクションをWeb調査の上追加。VenueGuideDetailに両セクションの表示部分を実装

## Phase C: 新規19会場のコンテンツ作成（地域別バッチ）

- [x] **C1. Kanto地域の残り2会場を追加**（[BOA-142](https://linear.app/boat-ai/issue/BOA-142)）
  桐生・戸田をWeb調査の上、フルスキーマ（既存5会場と同水準: アクセス・特徴・投注tips・周辺観光・カレンダー・画像）で追加
- [x] **C2. Chubu/Tokai地域の5会場を追加**（[BOA-143](https://linear.app/boat-ai/issue/BOA-143)）
  浜名湖・蒲郡・常滑・津・三国を同水準で追加
- [x] **C3. Kinki地域の残り2会場を追加**（[BOA-144](https://linear.app/boat-ai/issue/BOA-144)）
  びわこ・尼崎を同水準で追加
- [x] **C4. Shikoku地域の2会場を追加**（[BOA-145](https://linear.app/boat-ai/issue/BOA-145)）
  鳴門・丸亀を同水準で追加
- [x] **C5. Chugoku地域の4会場を追加**（[BOA-146](https://linear.app/boat-ai/issue/BOA-146)）
  児島・宮島・徳山・下関を同水準で追加
- [ ] **C6. Kyushu地域の残り4会場を追加**（[BOA-147](https://linear.app/boat-ai/issue/BOA-147)）
  若松・芦屋・唐津・大村を同水準で追加

## Phase D: 仕上げ・検証

- [ ] **D1. sitemap最終反映・全体検証**（[BOA-148](https://linear.app/boat-ai/issue/BOA-148)）
  全24会場+6地域ハブページのURLがsitemapに含まれることを確認。Playwrightで全24会場の title/description/canonical/構造化データを一括チェックするスクリプトを作成し実行
- [ ] **D2. 月次計測の運用開始**（[BOA-149](https://linear.app/boat-ai/issue/BOA-149)）
  `i18n-demand-report.js` と `search-console-report.js` を実行し、ベースラインを記録（`data/analysis/`配下）。3ヶ月後（spec.mdの数値目標判定時期）の比較基準とする

## 備考

- 全15タスクをLinearチケット化済み（BOA-135〜BOA-149）
- Phase Cの各リージョンタスクは、担当venueの一次情報（公式サイト等）をWeb調査するため、他タスクより時間を要する見込み。**論理的な依存関係はないが、全タスクが同一ファイル（`venueGuidesEn.js`）を編集するため、実行は1タスクずつ順にPRをマージしてから次に着手すること**（真の並行実装＝複数ブランチを同時に未マージのまま進めると同一ファイルでのマージコンフリクトが発生する）
