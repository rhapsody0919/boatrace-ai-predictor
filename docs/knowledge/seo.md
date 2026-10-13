# 検索・ボット向け HTML・ブログの SEO

正本は `docs/reference/seo-architecture-constraints.md`（SPA の制約）、`docs/adr/0032-ai-crawler-snapshot-delivery.md`・`docs/adr/0089-bot-html-for-daily-pages.md`（ボット向け HTML）、`.claude/rules/content-ops.md`（ブログの運用）。ここはその補足と運用の知見。主に seo-marketer が読む。書き方は [README.md](README.md)。

## SPA とボット向け HTML
- サイトは SSR の無い SPA。title・description・JSON-LD は Googlebot には JS 実行後の値で届くが、JS を実行しないクローラー（Facebook 等）には届かない。施策が「JS 実行後にしか効かないか」を先に分ける（BOA-161、docs/reference/seo-architecture-constraints.md）
- ボット向けの静的 HTML は AI クローラー・SNS のシェア用ボットと bingbot・Applebot・DuckDuckBot に配り、Googlebot には配らない。ブログで対象は日本語の記事だけで、翻訳記事は含まない（2026-10-11、ADR 0032・0089、docs/reference/seo-architecture-constraints.md）
- ブログ記事のボット向け HTML は `/ai-snapshots/blog/{slug}.html` に置かれ、middleware が `/blog/{slug}` をそこへ振り替える（src/config/aiCrawlerBots.js）

## ブログ
- ブログの FAQ の構造化データは src/utils/blogFaqSchema.js、記事ページの出力は src/pages/BlogPost.jsx（2026-10-12、コードで確認）

## 点検での見落としを防ぐ知見
- URL取得の成功とAIの最終回答のFOUND/UNREADABLEは別に記録し、別UAの取得と食い違う場合も取得条件・時刻を残す。（2026-10-12、2026-10-12-task-36-ai-cited-pages.md）
- AIの引用先が答える期間・区分・条件と質問の条件を照合し、引用の成立だけで適切な回答例としない。（2026-10-12、2026-10-12-task-36-ai-cited-pages.md）
- FAQPageの構造化データを出す案と検索結果でFAQが表示される期待は分け、表示可否は採用時点の公式仕様で確認する。（2026-10-12、2026-10-12-top-faq.md）
- 掲載本文が参照稿と一致していても、記事が案内する現在の画面の表示名は別に照合する。（2026-10-13、2026-10-13-audit-20261013-01.md）
- Search Consoleに実クエリがあることと、新記事を作る露出根拠・既存稿との差があることは別に確認する。（2026-10-13、2026-10-13-plan-1408.md）
