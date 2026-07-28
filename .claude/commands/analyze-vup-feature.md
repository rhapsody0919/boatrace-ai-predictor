---
name: analyze-vup-feature
description: kyoteibiyori.com/vup/ の指定機能を boatAI 向けに詳細分析＆Linearチケット化
---

# ボートレース日和 機能詳細分析 & Linearチケット化

kyoteibiyori.com/vup/ の指定機能をboatAI向けに詳細分析し、Linearチケット化案を提案します。

## 実行手順

1. **生データ取得**（スクレイピングのみ、評価はしない）
   ```bash
   node scripts/analysis/analyze-vup-feature.js "$ARGUMENTS"
   ```
   `{title, date, description, imageUrl, section}` が返る。見つからない場合はエラーと
   `/analyze-vup-features` での確認を促すメッセージが返る。

2. **Claude自身が分析する**（キーワードマッチではなく実際の判断で行う）
   取得した生データと、現在のboatAIコードベース（`src/components/race/`, `src/services/`,
   既存の予想根拠の見せ方等）を踏まえて、以下を判断する。

   | 視点 | 説明 |
   |-----|------|
   | **既存デザイン・UX向上** | スマホ対応？既存UIと調和？ |
   | **買い目予想・根拠提示** | 予想精度向上？信頼度向上？ |
   | **分析に役立つ** | データ分析、統計情報の活用度 |
   | **「この舟は来ない根拠」** | 除外判断の根拠として機能？（最重視⭐） |

   各視点についてスコア（4点満点）と根拠を一言で示す。機械的な最低保証点は設けず、
   内容が薄ければ低いスコアを付ける。

3. **UI/UX実装案・技術的実装案を提示**
   - 推奨コンポーネント・配置場所・既存パターンとの連携・モバイル対応方針
   - データソース（Supabaseテーブル等）・API/RPC関数・キャッシング戦略・推定工数
   - `.claude/rules/component-reuse.md` を踏まえ、既存コンポーネント拡張で足りるかを明記する

4. **Linearチケット案を提示**（チケットはまだ作成しない。ユーザー確認後 `/create-vup-ticket` へ）
   - チケットタイトル（`[boatAI提案] {機能名}` 形式）
   - 説明文（概要・機能説明・適用可能性・実装検討項目・参考URL）
   - 推奨ラベル（Linearの「Boat-ai」チームに実在するラベルのみ指定可能: `Improvement`, `Feature`, `Bug`。
     存在しないラベル名を指定してもチケット作成時に自動でスキップされるため、細分類が必要な場合は
     タイトルの `[boatAI提案]` プレフィックスやチケット本文の分類記述で代替する）
   - ストーリーポイント見積もり

---

## 使用例

```
/analyze-vup-feature スロー／ダッシュ表示
```

↓ スクリプトが生データを返す ↓ Claudeが上記4項目を会話で提示する

---

## 関連スキル

- `/analyze-vup-features` — 全機能リスト表示（機能名を確認してからこのスキルを使用）
- `/create-pr` — チケット実装後のPR作成

## 参考資料

- 本家サイト: https://kyoteibiyori.com/vup/
- boatAI目的: モダンなUIでシンプルに買い目を予想＆予想根拠を提示
