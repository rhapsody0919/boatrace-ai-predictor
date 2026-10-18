# CSSキャッシュ問題（解決済み）

## 症状

`/picks` ページで「運用成績」セクションのテキストと背景色が被って見えづらくなる問題が間欠的に発生。

- 手動で `vercel --prod --force` を実行すると直る
- しかしGitHub Actionsでのデプロイ後に再発する

## 根本原因

**Vercel Edge CDNがHTMLをキャッシュしていた**

1. Viteビルドは正しくCSSファイルにハッシュを付けている（例: `main-CDD7CyI3.css`）
2. しかし `index.html` がCDNレベルでキャッシュされていた
3. 古い `index.html` が古いCSSファイルへの参照を持っていた
4. 新しいCSSファイルがデプロイされても、古いHTMLが配信され続けた

### 問題のあった設定（旧）

```json
{
  "source": "/index.html",
  "headers": [
    { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }
  ]
}
```

`no-cache` はブラウザには効くが、**Vercel Edge CDNには効かない**。

## 解決策

`vercel.json` に以下のヘッダーを追加:

```json
{
  "source": "/",
  "headers": [
    { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate, s-maxage=0" },
    { "key": "CDN-Cache-Control", "value": "no-store" },
    { "key": "Vercel-CDN-Cache-Control", "value": "no-store" }
  ]
}
```

### 追加したヘッダーの説明

| ヘッダー | 対象 | 効果 |
|---------|------|------|
| `s-maxage=0` | プロキシ/CDN | 共有キャッシュの有効期限を0秒に |
| `CDN-Cache-Control: no-store` | 標準CDN | キャッシュしない |
| `Vercel-CDN-Cache-Control: no-store` | Vercel Edge | Vercel固有のキャッシュ制御 |

## 対象ルート

以下のルートにキャッシュ無効化ヘッダーを適用:

- `/` - ルート
- `/index.html` - HTMLファイル直接アクセス
- `/picks` - 今日のおすすめページ
- `/admin/*` - 管理者ページ

## 確認方法

```bash
curl -sI "https://www.boat-ai.jp/picks" | grep -i cache
```

期待される出力:
```
cache-control: no-cache, no-store, must-revalidate, s-maxage=0
cdn-cache-control: no-store
```

## 参考

- [Vercel Edge Network Caching](https://vercel.com/docs/edge-network/caching)
- [Cache-Control Headers](https://vercel.com/docs/edge-network/headers#cache-control-header)
