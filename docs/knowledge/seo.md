# 検索・ボット向け HTML・ブログの SEO

正本は `docs/reference/seo-architecture-constraints.md`（SPA の制約）、`docs/adr/0032-ai-crawler-snapshot-delivery.md`・`docs/adr/0089-bot-html-for-daily-pages.md`（ボット向け HTML）、`.claude/rules/content-ops.md`（ブログの運用）。ここはその補足と運用の知見。主に seo-marketer が読む。書き方は [README.md](README.md)。

## SPA とボット向け HTML
- サイトは SSR の無い SPA。title・description・JSON-LD は Googlebot には JS 実行後の値で届くが、JS を実行しないクローラー（Facebook 等）には届かない。施策が「JS 実行後にしか効かないか」を先に分ける（BOA-161、docs/reference/seo-architecture-constraints.md）
- ボット向けの静的 HTML は AI クローラー・SNS のシェア用ボットと bingbot・Applebot・DuckDuckBot に配り、Googlebot には配らない。ブログで対象は日本語の記事だけで、翻訳記事は含まない（2026-10-11、ADR 0032・0089、docs/reference/seo-architecture-constraints.md）
- ブログ記事のボット向け HTML は `/ai-snapshots/blog/{slug}.html` に置かれ、middleware が `/blog/{slug}` をそこへ振り替える（src/config/aiCrawlerBots.js）

## ブログ
- ブログの FAQ の構造化データは src/utils/blogFaqSchema.js、記事ページの出力は src/pages/BlogPost.jsx（2026-10-12、コードで確認）
