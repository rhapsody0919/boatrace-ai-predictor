---
name: create-vup-ticket
description: kyoteibiyori.com/vup/ の機能を分析してLinear チケットを自動作成
---

# VUP機能 → Linearチケット化

kyoteibiyori.com/vup/ の機能を boatAI 向けに分析して、**Linear チケットを作成**します。

機能名：**$ARGUMENTS**

競合機能をそのまま模倣しない大原則は `/analyze-vup-feature` と共通（詳細はそちらを参照）。
チケットの実装案も「boatAIらしく昇華させた案」であることを前提に書く。

## 実行手順

1. **分析**（`/analyze-vup-feature $ARGUMENTS` と同じ内容）
   まだ分析していなければ `/analyze-vup-feature $ARGUMENTS` を先に実行し、
   評価・実装案・チケット案（タイトル・説明文・ラベル・見積もり）をユーザーに提示して確認を得る。

2. **チケット内容をJSONファイルに書き出す**
   確認が取れたチケット案を `{title, description, labels, estimate}` の形式で
   一時ファイル（例: `/tmp/vup-ticket.json`）に書き出す。

3. **Linearへ登録**
   ```bash
   node scripts/analysis/create-vup-linear-ticket.js /tmp/vup-ticket.json
   ```
   ラベルはLinear側の既存ラベル名と一致するものだけが自動で解決・付与される
   （存在しないラベル名は警告付きでスキップされる）。

## 出力結果

```
✅ チケット作成成功！
📋 チケットID: BOA-121
🔗 URL: https://linear.app/boat-ai/issue/BOA-121/...
📝 タイトル: [boatAI提案] 1マークの展開がわかる切り抜き動画追加
```

---

## 一連の流れ

### 1️⃣ 機能リスト確認
```
/analyze-vup-features
```

### 2️⃣ 気になる機能を分析してチケット化
```
/create-vup-ticket 展示STと本番STのズレ
```

### 3️⃣ Linear で確認して実装判断
チケットを Linear で確認 → 実装優先度を決定 → `/implement` で実装開始

---

## 関連スキル

- `/analyze-vup-features` — 全機能リスト表示
- `/analyze-vup-feature` — 詳細分析のみ（チケット作成なし）
- `/implement` — Linear チケット実装

## 参考資料

- 本家サイト: https://kyoteibiyori.com/vup/
- boatAI目的: モダンなUIでシンプルに買い目を予想＆予想根拠を提示
