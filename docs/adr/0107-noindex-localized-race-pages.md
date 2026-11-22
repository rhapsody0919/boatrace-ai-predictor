# ADR-0107: 他言語の /race を検索に出さない（ページは残す）

## 状況

- GSC の「重複・Google が別の正規を選択」と「検出 - 未登録」の例の大半が他言語（/en・/zh-TW・/ko）の /race だった
- 他言語の /race の検索流入はほぼ無く、ja の /race は自然検索の主な入口の1つ
- /race の取得（クロール）のほぼ半分が他言語に向き、ja の /race の取得されていない割合が大きい
- 実数は hq（非公開）の票D（PV10、BOA-1701）。決定の正本は hq の docs/decisions/localized-race-deindex.md（オーナー 2026-11-22 yes）

## 決定

1. 他言語の /race（/en/race/・/zh-TW/race/・/ko/race/ の配下）は検索に出さない。ページは残す（人の言語の切り替えは今のまま、`getAvailableLanguages` は変えない）
2. 検索に出す・出さないの表は `src/config/languages.js` の `NOINDEX_LOCALIZED_PREFIXES` と `isSearchIndexed(basePath, lang)` の1か所。応答のヘッダ・sitemap・hreflang はこの表に従う
   - 応答のヘッダ: `vercel.json` の headers に `X-Robots-Tag: noindex` の1規則（source `/((?:en|zh-TW|ko)/race/.*)`、言語の接頭は必須。has・missing は付けず、人・Googlebot・bot 向け HTML の全経路に付ける）
   - sitemap: `scripts/generate-sitemap.js` は他言語の /race を載せない。検索に出さない URL が混じれば黙って落とさず throw する
   - hreflang: `getHreflangAlternates` は検索に出す言語だけで組む。/race/<id> は ja だけになり空（画面の HreflangTags・sitemap の xhtml:link・bot 向け HTML が同時に変わる）
3. 外し方は X-Robots-Tag: noindex で、robots.txt では塞がない。塞ぐと Google は noindex を読めず、登録済みの URL が消えない（https://developers.google.com/search/docs/crawling-indexing/block-indexing 、https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag ）。`Disallow` を足すのは、登録済みが0になった後の別の決定
4. BOA-1459 の「ja の /race の言語版を sitemap に足して対を閉じる」は、「対を両側（sitemap と hreflang）から外して閉じる」に置き換える
5. 守り: `scripts/maintenance/verify-search-index-policy.js`（tier ci）が、見本の URL × 4言語の期待の表と、表・sitemap・hreflang・vercel.json の規則・robots.txt を突き合わせる。ja の /race を巻き込む形（接頭が任意の source 等）で落ちる

## 戻し方

`NOINDEX_LOCALIZED_PREFIXES` から `/race/` を外し、`vercel.json` の X-Robots-Tag の1規則を消す（sitemap の他言語の /race を戻すなら `generate-sitemap.js` の言語版の展開も戻す）。verify の期待の表も同じ PR で直す。

## 選ばなかった案

- sitemap だけ外す: ja の /race の hreflang と言語版のリンクから毎日見つかり続け、取得も索引も変わらない
- JS で入る `<meta name="robots" content="noindex">`: 描画しないと読まれず、言語の判定を誤ると ja の /race に掛かる
- robots.txt の Disallow: 取得は止まるが、登録済みの URL を中身の取り直しで外せない（上の 3）
- canonical を ja へ向ける: canonical は JS で入るので読まれないことが在り、取得も止まらない
