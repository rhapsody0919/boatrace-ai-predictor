# キャッシュ検証セットアップ

キャッシュ設定の誤りは、ドキュメントと GitHub Actions の CI（`verify-cache`）で防ぐ。

---

## GitHub Actions CI（PR 作成時）

### 自動実行

- **ファイル**: `.github/workflows/verify-cache-config.yml`
- **トリガー**: PR 作成時、Edge Function ファイル（`api/**/*.js`）が変更された場合
- **実行内容**: `node scripts/verification/verify-cache-config.js`
- **結果**: PR チェックとして表示される

### PR チェック画面

PR が作成されると、GitHub の PR 画面に以下のようなチェックが表示されます：

```
Verify Cache Configuration ✅ passed
```

キャッシュ設定に誤りがある場合、PR の「Checks」タブに詳細が表示され、マージボタンが無効化されます。

---

## 防御の層

| レイヤー | 実行タイミング | 対象 | 効果 |
|---------|-------------|------|-----|
| **ドキュメント** | コード変更前 | 開発者 | キャッシュルールの理解 |
| **GitHub Actions** | PR 作成後 | PR | 誤った設定をマージさせない |

---

## トラブルシューティング

### CI 検証を再実行したい

```bash
# PR の「Re-run jobs」ボタンから実行（GitHub UI）
# または

gh run rerun <run-id>
```

---

## 参考資料

- **キャッシュ戦略**: `docs/reference/cache-strategy.md`
- **検証スクリプト**: `scripts/verification/verify-cache-config.js`
- **CI ワークフロー**: `.github/workflows/verify-cache-config.yml`
