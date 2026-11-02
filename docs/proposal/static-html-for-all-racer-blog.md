# 選手ページ・記事を全員に描画済み HTML で返す案（BOA-899）

## 問い

選手ページ（`/racer/N`、GS00 の選手名検索の受け皿）と記事（`/blog/*`）は SPA。人・Googlebot・Google の各取得器には 5KB の殻（共通の title と空の `#root`）が返り、描画済みの HTML は `src/config/aiCrawlerBots.js` の UA だけに返る（ADR 0032・0089）。Gemini API の url_context で戸田の記事と `/racer/3256` が殻として取られた（hq の試験、2026-11-02）。

## 分かっていること（2026-11-02）

| 項目 | 結果 | 出典 |
|---|---|---|
| 人・Googlebot・Google-InspectionTool・GoogleOther・Google-Agent・Google-GeminiNotebook の UA | 3 URL とも 200・5,054 bytes の殻 | curl |
| GPTBot の UA | 描画済み（u1 27,546・toda 26,071・racer/3256 252,120 bytes） | curl |
| u1 `/blog/meet-score-rate-guide` | 配信の経路は toda・racer と同じ。それでも url_context は本文を取れた | curl、hq の試験 |
| URL 検査 API | toda・racer/3256 とも PASS・登録済み・canonical 自己（最終クロール toda 09-08、racer 10-03、u1 10-22） | BOA-899 の診断票 |
| 選手ページの検索 | 10月に選手ページ42件で選手名の検索に表示。平均順位30前後、クリック0 | Search Console（query+page、10/1〜10/31） |
| url_context の取得 | 「まず内部の索引キャッシュ、無ければその場で取得」。取得 UA・JS 実行は書かれていない | ai.google.dev/gemini-api/docs/url-context |

読み: Google 検索は JS を描画して索引している（選手名は描画後にしか無い）。殻が返ることは検索の索引を止めていない。url_context の差は UA の一覧では説明できず、索引キャッシュの状態の差が候補（未確認）。

## Google の方針（一次情報）

- 動的レンダリング: "Dynamic rendering was a workaround and not a long-term solution"。代わりに "server-side rendering, static rendering, or hydration" を勧める。"As long as your dynamic rendering produces similar content, Googlebot won't view dynamic rendering as cloaking"（developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering）
- Google-Extended は UA を持たない robots.txt の印（google-common-crawlers）

## 案

| 案 | 中身 | 効く見込み | 危うさ | 見積り |
|---|---|---|---|---|
| A | Google の取得器を UA の一覧に足す | Googlebot は足さない（ADR 0089 のオーナー決定、Google は動的レンダリングを推奨しない）。足したのは Google-GeminiNotebook だけ（PR、Google-Extended の死んだ行も外す）。url_context の取得 UA は不明で、効くとは言えない | Googlebot に足すと、推奨しない回避策を Google 検索に当てる。人の画面と食い違えばクローキング | 済（小） |
| B1 | 選手ページ・記事は全員に、ビルド時のスナップショット（`dist/ai-snapshots/`）を返し、SPA が上から描き直す（`createRoot` のまま） | Google が勧める static rendering に近い。最初の HTML に本文があるので、どの取得器でも本文が取れる | 描き直しで画面が一瞬差し替わる（CLS・LCP の悪化を測る要あり）。選手ページのスナップショットは最大約1日古い（SPA が直後に新しい値で描き直す）。スナップショットが無い選手・記事は今の殻のまま。人向けの応答のキャッシュの方針（今は no-store）を決め直す | 3〜5日（middleware の振り分け・E2E・layout・Web Vitals の前後比較・ADR） |
| B2 | SSR／フレームワーク移行（Next.js 等）、または `hydrateRoot` で使えるプリレンダー | 根本の解決 | ルート27以上×4言語の作り直し。ADR 0032 案B と同じ理由で保留中 | 数週間 |
| C | Search Console で toda・racer/3256 の再クロールを依頼し、2〜4週後に hq の読み取りが変わるかを見る | url_context の索引キャッシュの鮮度が原因なら効く（仮説） | 無し（オーナーの画面の操作が要る） | 10分 |
| D | 選手ページへの内部リンク（記事・レース詳細・会場から）と中身を厚くする | 順位30前後の改善は描画ではなく競争力の問題という見方（seo-marketer） | 無し | 別チケット |

## 推奨

1. A は PR の範囲で止める（Google 検索向けの出し分けは足さない）
2. C を先に行う（費用0、url_context の原因の切り分けにもなる）
3. GS00 の順位は D を先に。B1 は C の結果と、選手ページの表示・順位の推移を見てから、SDD で設計する。B1 に進むなら、描き直しによる CLS・LCP を Preview で前後比較することを関門にする
