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
- 開催向けの記事の slug に年号を入れない。開催後に古く見えるため。同じテーマの既存記事の slug の型（会場名＋テーマ。例 -water-wind-guide）にそろえる（2026-10-13、#1548 の SEO P2）

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
- ブログの metaTitle・metaDescription は <title>・meta description・OGP/Twitter にだけ効く。AI 向けスナップショットは描画後の HTML を保存するのでビルドで自動的に反映されるが、llms.txt（generate-llms-txt.js）・トップのブログ欄の bot 向け HTML（api/_lib/botPage.js）・BlogPosting の JSON-LD は画面用の title・description を使い、「競艇」を入れない（2026-10-19、PR #1673 の seo-marketer 調査）
- 会場記事の新稿の前に、一般ガイドだけでなく会場名を含む固有分析 slug・データ記事・開催日別稿を公開 sitemap と照合する（2026-10-13、2026-10-13-plan-1636.md・2026-10-13-venue-20261013-05-edogawa.md）
- 問いと答えが同じなら、会場名・母数・大会名だけを替えた同型稿を作らない。同一会場・同一日程の複数大会は1依頼にまとめる（2026-10-13、2026-10-13-venue-20261013-08-hamanako.md・2026-10-13-plan-1739.md）
- 会場記事の問いは、その会場の公開比較（全体との上下、強さ別の件数）から決める。既存ガイドに定性記述があっても固有の問いに答えられるかを確認し、別会場の問いへ数字だけ替えて流用しない（2026-10-13、2026-10-13-venue-20261013-10-wakamatsu.md・2026-10-13-venue-20261013-12-tamagawa.md）
- 年内の対象が尽きたら、公式日程の翌年表の公開を確認する。年越しの先行稿は大会当日の成績にせず、公開前に日程・データを更新確認する（2026-10-13、2026-10-13-plan-1840.md）
- 将来の大会向けの会場稿は、公式表（日程・季節別表）の年・期間と大会の年を別に確認する（2026-10-13、2026-10-13-venue-20261013-06-shimonoseki.md）
- 承認範囲が SG・G1 の計画では、公式の「SG・PGⅠ」表の分類名だけで PGⅠ を GⅠ として起票しない（2026-10-13、2026-10-13-plan-1840.md）
- 自動計画は、前の計画の未制作一覧で止めず、その後の完成報告と専用出力先を照合する。再起動だけを新しい制作根拠にしない（2026-10-13、2026-10-13-plan-1739.md・2026-10-13-plan-2201.md）
- 根拠のある新規記事を確保できない回は起票 0 件とし、監査・採否待ちの note や別名の重複主題で枠を埋めない。再開条件（全クエリ明細・日程の更新）を残す（2026-10-13、2026-10-13-plan-2057.md・2026-10-13-plan-2201.md）
- 依頼の呼び名（Search Console 等）やファイル名だけでデータ種別を決めず、JSON のキー（byLanguage・bySource 等）で中身を確認する（2026-10-13、2026-10-13-plan-2057.md）
- 既存記事の数値と評価語の整合は、別レースの最新値を取らず保存本文だけで照合できる。限定訂正は元の問い・URL を維持し、旧閾値の妥当性や記事全体の正確性まで認定しない（2026-10-13、2026-10-13-audit-20261013-06.md）
- 新稿から一般ガイドへ内部リンクを張るときは、リポジトリ上の本文だけでなく公開本文とメタを確認する。新稿の一次資料と矛盾する説明が旧ガイドに残るなら、リンク付近に相違と採用する出典を示す（2026-10-13、2026-10-13-venue-20261013-11-tsu.md・2026-10-13-venue-20261013-03-gamagori.md）
- 会場ガイドの事実訂正は、同じ事実を出す全箇所（場別記事・総合観戦ガイドと翻訳・開催時間表・開催場表・schedule 等の別欄・title/description/tag）で完了を判断する。場別記事の修正を総合ガイドの同じ誤りの解消に読み替えない（2026-10-13、2026-10-13-venue-guide-fact-audit.md・2026-10-13-plan-review-20261013-17.md）
- 記事修正の追跡に行番号だけを使わない。別の行の追加で位置が動く（2026-10-13、2026-10-13-plan-review-20261013-21.md）
- 修正 PR が「N 点解消」と申告していても、元の照合報告が無ければ、差分の整合確認と解消の認定を分ける（2026-10-13、2026-10-13-plan-2033.md）
- SPA の /blog URL は HTTP 200 でも記事の実在の証拠にならない。指定 URL で記事の見出し・本文か「記事なし」表示かを確認する。翻訳名を直結した URL の不成立から翻訳全体の非公開を推定しない（2026-10-13、2026-10-13-venue-guide-fact-audit.md）
- ブログ JSON の date がレース日でも、現行 BlogPost は datePublished と dateModified に同値を出す。レース日を初回公開日・更新日とみなす前に制作・公開履歴を確認する（2026-10-13、2026-10-13-plan-review-20261013-07.md）
- 再計画では前回報告の候補状態に加え、同日付の制作稿と引継ぎを照合し、制作済みの記事を再び新規候補にしない。（2026-10-19、2026-10-19-plan-1758.md）
- 会場記事の候補は保存稿一覧と今後の開催会場を突き合わせ、一般ガイドと水面・風の記事の主題を区別する。期間を限った確認結果を恒久的な需要なしへ広げない。（2026-10-19、2026-10-19-plan-2103.md）
