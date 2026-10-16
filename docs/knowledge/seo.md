# 検索・ボット向け HTML・ブログの SEO

正本は `docs/reference/seo-architecture-constraints.md`（SPA の制約）、`docs/adr/0032-ai-crawler-snapshot-delivery.md`・`docs/adr/0089-bot-html-for-daily-pages.md`（ボット向け HTML）、`.claude/rules/content-ops.md`（ブログの運用）。ここはその補足と運用の知見。主に seo-marketer が読む。書き方は [README.md](README.md)。

## SPA とボット向け HTML
- サイトは SSR の無い SPA。title・description・JSON-LD は Googlebot には JS 実行後の値で届くが、JS を実行しないクローラー（Facebook 等）には届かない。施策が「JS 実行後にしか効かないか」を先に分ける（BOA-161、docs/reference/seo-architecture-constraints.md）
- ボット向けの静的 HTML は AI クローラー・SNS のシェア用ボットと bingbot・Applebot・DuckDuckBot に配り、Googlebot には配らない。ブログで対象は日本語の記事だけで、翻訳記事は含まない（2026-10-11、ADR 0032・0089、docs/reference/seo-architecture-constraints.md）
- ブログ記事のボット向け HTML は `/ai-snapshots/blog/{slug}.html` に置かれ、middleware が `/blog/{slug}` をそこへ振り替える（src/config/aiCrawlerBots.js）
- SEO のためのクライアント側のリダイレクトは window.location 系で行う。React Router の Navigate（history.replaceState）は Google にリダイレクトとして扱われない（2026-08-16、memory i18n_technical_and_demand_audit_2026_08_16、PR #309）
- react-helmet-async は React 19 で link・meta を出さない（title だけ出る）。React 19 の head へのホイスティング（JSX に直接 <link> 等を書く）を使う（2026-07-14、memory i18n_project、BOA-129）
- index.html に静的にある meta（robots・keywords・og:*・twitter:*）は、ページで宣言的に <meta> を書いても上書きされず2つ目が足される。src/hooks/useSocialMeta.js・useRobotsMeta.js と同じく querySelector→setAttribute で書き換え、外すときに戻す。description・canonical は静的定義が無いので宣言的でよい（2026-08-25、memory technical_index_html_static_meta_override）
- ボット向け HTML の対象パスを足すときは src/config/aiCrawlerBots.js の resolveSnapshotPath と middleware.js の matcher の2か所に要る。matcher に無いと SPA の殻が返る。ローカルの build は通るので、本番 URL に scripts/verification/verify-ai-snapshots.js を当てて確かめる（2026-09-25、memory technical_middleware_matcher_must_match_snapshot_paths、PR #832）
- ボット向けスナップショットの生成は、ローカルで全件成功しても Vercel のビルドでは失敗しうる（Chromium と共有ライブラリが無い。Vercel では @sparticuz/chromium に分岐）（2026-09-15、memory ai_crawler_snapshot_2026_09_01、scripts/generate-ai-snapshots.js）
- SSR（Next.js 等）への移行は、数万ページ規模のプログラマティック SEO を具体的に検討する段階まで見送り（2026-08-05 ユーザー合意、memory boa_growth_strategy_decision_2026_08。方針が今も有効かは要確認）

## ブログ
- ブログの FAQ の構造化データは src/utils/blogFaqSchema.js、記事ページの出力は src/pages/BlogPost.jsx（2026-10-12、コードで確認）
- 記事の中身は本文（.md）と src/data/blogPosts*.js の title・description・tags の2か所にあり、後者は記事の見出し・関連記事カード・OGP に出る。本文を直したらメタも同じ観点で grep する（2026-08-16、memory feedback_content_metadata_not_just_body、PR #313）
- blogFaqSchema.js の FAQ 見出しの検出は言語ごとの固定の文字列（例: 繁体字の「常見問題」）。新しい言語を足したら見出しの文字列も足す（2026-08-11、memory foreign_audience_growth_strategy_2026_08、PR #279〜281）
- public/sitemap.xml は日次の cron（.github/workflows/update-sitemap.yml）が作り直す。PR には scripts/generate-sitemap.js の変更だけを入れ、生成物は入れない（2026-08-09、memory i18n_p1_analysis_tools_handoff）
- 記事の文字数は表と Markdown の記法を除いた日本語の文字で測る。wc -m だと目安（2,000〜3,500字）を大きく超えて見える（2026-09-28、memory phase_a_content_rollout_2026_09_28、PR #884）

## インデックスと順位
- 2026-04〜07 の自然検索の減少（平均掲載順位 6.0→7.5）は、日本語ブログの新規記事が4月以降ほぼ0になった時期と一致した。記事の鮮度を順位の先行指標とし、最新記事から2週間空いたら次の記事の種を探す（2026-07-28、memory boa_pv_plateau_diagnosis_2026_07・feedback_content_cadence_proactive_check）
- 7/13週〜8/3週の検索クリックの急落（115→14/日）は、7/7 の言語自動判定で Googlebot に / の英語版が登録されたバグ（8/18 修正）。前後比較の基準は 8/31 以降に取る（2026-09-29、memory seo_keyword_strategy_2026_09_29）
- 戻りきらない残りの主因は 8/20 の改名で title から「BoatAI（ボートアイ）」が消えたこと（「ボートai」は順位がほぼ同じで CTR 20.8%→6%前後）。旧名の併記はオーナー判断で不可（2026-10-01、memory seo_keyword_strategy_2026_09_29）
- 新記事が検索に出ないときは、まず Search Console の URL 検査で未インデックスかを分ける。2026-03-12 公開の13本は7本が未インデックスで、内部リンク数・文字数と関係が無かった。一括確認は urlInspection API で1件ごとに300〜400ms 空ける（scripts/analysis/check-venue-indexing.js）（2026-08-26、memory boa_pv_plateau_diagnosis_2026_07、PR #406）
- 選手ページの index の判定は src/utils/racerIndexPolicy.js をページと sitemap で共用する（2026-10-02 時点は現役A1の322人）。/races/:date は sitemap に直近7日だけ、/race/:raceId は sitemap の対象外（2026-10-02、memory seo_keyword_strategy_2026_09_29、PR #1120）
- Search Console の反映は数日〜2週間遅れ、新しい記事や title・description の修正の効果は2〜4週間後に出る。CTR の低いページを改善候補に出す前に git log -- <ファイル> で直近に直していないか確かめる（2026-08〜09、memory feedback_growth_pdca_design・growth_pdca_2026_09_05・growth_report_skills_2026_08）
- Search Console レポートの順位変動は「+ が下落、− が上昇」で、見た目と逆になる（2026-09-05、memory growth_pdca_2026_09_05）

## AI 検索での見え方
- Gemini の検索グラウンディングで固定9問を聞くと boat-ai.jp の引用は0/9。出典に多いのは boatrace.jp・boatrace-db.net・Yahoo!知恵袋・kyoteibiyori（2026-10-06、memory project_ai_multi_venture_ops_2026_10_05、hq の ai_visibility）
- Gemini は Google の索引を見ており、ボット向け HTML の有無に左右されない（選手ページはボット向け212KBでも引用されず、トップは3.5KBでも読めた）。AI で引用されない原因は検索順位として扱う（2026-10-12、memory ai_agent_era_strategy_2026_10_05）

## 検索の需要と競合
- 会場名×AI予想の検索需要は SG 開催週に集中する（桐生 SG 週に1,489表示）。用語のクエリは AI Overview が出て、4〜9位でも CTR 0〜1%（2026-09-29、memory seo_keyword_strategy_2026_09_29）
- 予想サイトを探すクエリの上位5件はアフィリエイトの比較・ランキングサイトが占め、予想を出しているサイトは入っていない（2026-09-05、memory growth_pdca_2026_09_05、data/analysis/serp-snapshots/snapshot-2026-09-05.json）
- 選手の能力を1つの数値にまとめた指数のクエリは、指数ページを持つサイトが上位に入る。龍神レーダーには同じ種類のページが無い（2026-09-05、memory growth_pdca_2026_09_05、要確認）
- 「BoatAI」系の名前のサービスが複数ある（com.boatai・boat.ai・boat-ai.site・boating-ai.com）ほか、boatraceai.com（通称ボートアイ）もある。poseidon-boatrace.net は独自指標「海神指数」を持つ（2026-08-19、memory boatai_rebrand_investigation_2026_08_19）
- search-console-report.js の指名検索の条件「ボートアイ」「boat ai」は競合 boatraceai.com の名前と同じで、指名の比率は実際より高く出る。「ボートアイ」は分けて見る（2026-09-29、memory growth_pdca_2026_09_29）
- キーワードの需要には「会場名＋観光／周辺」の地域の軸を入れる。会場の近くに来た観光客を会場ガイド（/venues/{slug}）へ連れてくる狙い（2026-08-10 オーナーの発案、memory feedback_growth_pdca_design）

## 点検での見落としを防ぐ知見
- URL取得の成功とAIの最終回答のFOUND/UNREADABLEは別に記録し、別UAの取得と食い違う場合も取得条件・時刻を残す。（2026-10-12、2026-10-12-task-36-ai-cited-pages.md）
- AIの引用先が答える期間・区分・条件と質問の条件を照合し、引用の成立だけで適切な回答例としない。（2026-10-12、2026-10-12-task-36-ai-cited-pages.md）
- FAQPageの構造化データを出す案と検索結果でFAQが表示される期待は分け、表示可否は採用時点の公式仕様で確認する。（2026-10-12、2026-10-12-top-faq.md）
- 掲載本文が参照稿と一致していても、記事が案内する現在の画面の表示名は別に照合する。（2026-10-13、2026-10-13-audit-20261013-01.md）
- Search Consoleに実クエリがあることと、新記事を作る露出根拠・既存稿との差があることは別に確認する。（2026-10-13、2026-10-13-plan-1408.md）
