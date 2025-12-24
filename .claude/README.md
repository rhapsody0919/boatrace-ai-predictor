# .claude/ ディレクトリについて

`.claude/` ディレクトリは、**Cursor（Claude Code）の設定ディレクトリ**です。

## 📋 目的

このディレクトリには、CursorでAIアシスタント（Claude）が動作する際の設定ファイルが格納されます。

## 📁 ファイル構成

### `settings.local.json`

AIアシスタントが実行できるコマンドの権限を設定するファイルです。

**主な内容:**
- `allow`: AIが実行を許可されたコマンドのリスト
- `deny`: AIが実行を禁止されたコマンドのリスト
- `ask`: AIが実行前に確認が必要なコマンドのリスト

**例:**
```json
{
  "permissions": {
    "allow": [
      "Bash(npm install:*)",
      "Bash(git add:*)",
      "Bash(node scripts/linear-cli.js:*)"
    ]
  }
}
```

この設定により、AIは以下のコマンドを実行できます：
- `npm install`
- `git add`
- `node scripts/linear-cli.js`（Linear CLI）

### `linear-integration.md`

Linear統合のためのプロンプトテンプレートファイルです。

Claude Codeを実行する際に、このファイルを参照してLinearチケットの自動管理を行います。

**使用方法:**
```bash
claude-code --prompt .claude/linear-integration.md "機能を実装してください"
```

## 🔒 セキュリティ

このディレクトリの設定により、AIが実行できるコマンドが制限されます。

**重要なポイント:**
- 許可されていないコマンドは実行できません
- セキュリティ上のリスクがあるコマンドは明示的に許可する必要があります
- プロジェクトごとに異なる権限を設定できます

## 📝 カスタマイズ

プロジェクトのニーズに応じて、以下のようにカスタマイズできます：

1. **新しいコマンドを許可**
   - `settings.local.json` の `allow` 配列に追加

2. **プロンプトテンプレートを追加**
   - `.claude/` ディレクトリに新しい `.md` ファイルを作成

3. **権限を制限**
   - 特定のコマンドを `deny` に追加

## 🚀 使用例

### 基本的な使い方

CursorでAIアシスタントを使用すると、自動的にこの設定が読み込まれます。

### ターミナルでClaude Codeを使用する場合

```bash
# プロンプトファイルを参照
claude-code --prompt .claude/linear-integration.md "機能を実装してください"

# 直接プロンプトを指定
claude-code "機能を実装してください"
```

## 📚 参考

- [Cursor Documentation](https://cursor.sh/docs)
- [Claude Code統合ガイド](../docs/claude-code-linear-integration.md)

---

このディレクトリは、AIアシスタントの動作を制御する重要な設定ディレクトリです。

