# 用語と禁止語・表現の可否

言葉の正本は `.claude/rules/code-style.md`（「競艇」と例外）、`docs/reference/i18n-glossary.md`（4言語の用語）、`sns-video-studio/remotion/risk-rules.json`（SNS のリスク規則）。ここはその補足と運用の知見。数字の言い方は [number-wording.md](number-wording.md)。書き方は [README.md](README.md)。

## 禁止語
- 画面・ブログ本文・見出し・SNS の本文/ナレーション/焼き込み文字で「競艇」は使わず「ボートレース」。役所広告の出稿対象から外れるため（2026-09-29、.claude/rules/code-style.md、memory kyoutei_terminology_ban_rationale）
- 例外は2つだけ。①画面に出ないメタ情報（title・meta description・keywords・OGP/Twitter カード）②SNS のハッシュタグ #競艇。どちらも暫定で、①は役所へ営業する前に外す、②は GA4 の月間ユーザー（直近28日）が1000人になったら止める（2026-09-29・2026-10-08 ユーザー判断、code-style.md）
- ブログの title・description は一覧の h3・本文として画面に出るので、メタの例外に入らない（2026-10-11、ファン役のブログ新記事の評価）
- 「数える」「似た」「似ている」「ふつう」「いつも」は使わない（2026-10-08 ユーザー指摘は「数える」のみ。BOA-271・BOA-815 等のオーケストレーターの指示）
- 「集計」「算出」「対象」は禁止語ではない（2026-10-12 ユーザー確認）。10/8 にユーザーが指摘したのは「数える」で、「集計・算出・対象」は龍神ソナー・思考アシストの言い換え一覧で使わない語として採用しただけであり、全画面の禁止語に広げたのはClaude側の拡大解釈だった。龍神ソナー・思考アシストで「数える」を言い換えるときに限り、この3語も使わない
- 過去レースを比べる相手は「類似レース」。「似たレース」は禁止。パネルの言い換え案でも採らない（2026-10-07 ユーザー判断、memory feedback_term_ruijirace_not_nitarace）
- モックは画面の文字だけでなく周りの説明・価値の欄も禁止語を grep で検査する: grep -nE "ふつう|普通|似た|似て|いつも|数え"（2026-10-09 の差し戻し、memory feedback_banned_words_scan_mock_and_notes）
- 「集計前」の印は禁止語ではない（2026-10-12）。2026-10-11・BOA-830 時点では禁止語を含むとして言い換えを検討していたが、「集計」が禁止語から外れたため前提が変わった
- 廃止済みのモデル名（本命狙いモデル・スタンダードモデル・穴狙いモデル・今日のおすすめ）は使わない（sns-video-studio/remotion/risk-rules.json の deprecated-model-names、scripts/maintenance/check-deprecated-terms.js）
- 禁止語の一覧に足すのはオーナーが指摘した語だけ。出典にオーナーの原文と範囲（画面・チャネル）を書く。ファン役・wording-editor の言い換え案で避けた語は、オーナーが認めるまで入れない（2026-10-12、memory feedback_dont_generalize_wording_bans、BOA-835 を取り消した）

## 呼び方
- 「展示前版」「展示後版」の「版」はファンに分かりにくい。「直前予想」「展示前の予想」と言う（2026-10-12、オーナー）
- 2着の相手は「相手」と言う（2026-10-12、デザイナー役 v10）
- リング交換は「本」を単位にする（2026-10-12、ファン役 v10）
- サービス名は「龍神レーダー」（Ryujin Radar）、サブタイトルは「無料のボートレースAI予想＆データ分析」。ドメイン boat-ai.jp は維持し、表示の名前だけを変えた。「龍神杯」は蒲郡の公式大会名と重なる（2026-08-19 ユーザー決定、memory boatai_rebrand_investigation_2026_08_19）
- 類似レースの機能名は「龍神ソナー」（旧名アナロジー・ファインダー。docs/design/analogy-finder/ 等のパスには旧名が残る）（2026-10-06、memory feedback_boa271_ui_details_user_decides、BOA-271）
- ボートレースの「勝率」は着順点の平均で、1着の割合ではない。1着の割合は「1着率」と書く（2026-09-25、memory morning_data_digest_2026_09_25、BOA-402）

## 用語の対訳
- 4言語の用語は docs/reference/i18n-glossary.md が正本。新しい用語は glossary に足してから訳す（.claude/rules/i18n-new-pages.md）
- 韓国語の「今期」に 금기 を使わない（禁忌と読める）（memory i18n_korean_this_term_not_geumgi）
- ハングル「경정」・繁体字「賽艇」は「競艇」とは別文字列で禁止の外（docs/reference/i18n-glossary.md の方針）
- 韓国語の競技名は本番 UI（src/locales/ko/common.json）と同じ「경정」を使う。並行で翻訳した ko ブログが「보트레이스」と「경정」に分かれた。置き換えるときは받침の有無に合わせて助詞（는/은 等）も直す（2026-08-17、memory ko_blog_full_expansion_2026_08_17、PR #317）
- 多言語の図や翻訳記事の訳語（会場名・券種名・機能名）は、その言語の既存の記事を grep して合わせる（2026-08-17、memory overnight_content_expansion_2026_08_16）
- 新しい語は `docs/reference/i18n-glossary.md` に4言語の対訳を足してから訳す。足さずに訳すと言語間でぶれる。zh-TW の「全期間」（BOA-733 の `gridRows.current`・`periodCaveat`）が、同じ画面の既存の語「全部期間」（`venueRankingNote` 等3か所）と食い違った（2026-10-14、BOA-733 wording-editor）

- 「逃がしやすい選手」（/today の nigashi）は「1号艇が逃げ切った割合」が高い材料で、鉄板寄り（イン有利）の側。まくりが利く選手と並べるときに荒れる側へ入れない（2026-10-15、/today の向きの誤りの修正、src/data/morningDigestCopy.js・scripts/maintenance/verify-digest-nigashi-direction.js）
- /today で補正しているのはレースのグレード（SG・G1・一般戦）で、選手の級別（A1・A2）ではない。「会場と級別」と書かず「会場とレースグレード」と書く（2026-10-15、同）
- BOA-822 の新しい用語の訳は、英語・繁体字・韓国語とも既存の「イン崩れ」（Lane-1 upset／1號位失守／1코스 이변）を土台に続け、旧「イン崩れ指数」（index／指數／지수）と語尾（caution level／注意度／주의도）で区別する。「崩れやすい」「堅め」は percentileBarMax／Min の訳を続けて使い、「中くらい」は Medium／中等／중간（2026-10-16、wording-editor、docs/reference/i18n-glossary.md）
- 龍神ソナーの「類似レース」は zh-TW で「相似比賽」、思考アシストの「軸（艇）」は zh-TW で「主軸」が既存の訳。新しいキーを訳すときは grep して既存の語に合わせる（2026-10-17、BOA-822 wording-editor、inCaution.sonarButton・assistButton）
- 「同じくらい／about the same as／差不多」のように“似ている”を避けた帯・範囲の文で、1言語だけ避けた語（ko の「비슷한」）を使うと、別の母集団の「유사 레이스」と数が食い違って見える。各言語で避けた語を使っていないか確かめる（2026-10-17、BOA-822 wording-editor、inCaution.range）

## 誇大・保証・射幸心・SNS の規則
- 的中・勝利を保証する表現は全プラットフォームで警告。「当たり」「的中」単独は警告しない（risk-rules.json の guaranteed-hit）
- 配当倍率・金額を主役にする演出、「儲かる」等の射幸心を煽る語は避ける（risk-rules.json の gambling-incitement）
- 予想・賭け事を直接連想させる語・構図の警告は TikTok だけ。X と YouTube は対象外で同じ規則（2026-10-10 ユーザー判断で YouTube を X にそろえた、risk-rules.json の gambling-connotation-words）
- X・YouTube では「本命寄り」・過去の万舟率くらいは可（2026-10-11、オーナー）
- risk-rules.json の検出は警告だけで承認は止めない。生成の指示と自動チェックの両方がこのファイルを読む。食い違う判定をしたら片方だけ直さない（risk-rules.json の _comment）
- note 固有の知見は [note.md](note.md) へ移動（2026-10-13）
- 過去の「回収率1343%」「高精度」等を単独で先に直す提案はしない。AI予想の作り直し（BOA-617）の中でだけ扱う（2026-10-01 ユーザー判断、memory feedback_no_proposals_on_past_accuracy_claims）
- AdSense の表現の決まりはリポジトリに正本が無い。答えるときは Google の公式ポリシーを確かめて出典を付け、決まりができたらここに足す（2026-10-11、オーケストレーター依頼への確認結果）
- サービス名・見出しに運・幸運系の語（「福」等）を使わない。データで見せる差別化の軸と逆向きになる（2026-08-19、memory boatai_rebrand_investigation_2026_08_19）
- meta・llms.txt に「高精度」「的中率」等の精度を誇る語を戻さない。scripts/maintenance/verify-no-accuracy-claims-in-meta.js が CI で止める（2026-10-05、memory ai_agent_era_strategy_2026_10_05、PR #1264・#1265）

## content-qa との分担
- content-qa はブログ記事の公開前6観点（.claude/commands/publish-blog.md）の合否判定。wording-editor は画面・モック・SNS・spec を含む全ての文の言葉の相談と、禁止語・誇大・対訳の判定。ブログの公開前は content-qa、言い換え案は wording-editor（2026-10-11、オーケストレーター依頼）
- 「崩れやすい」「堅め」は旧指数のラベルの語（percentileBarMax 等）の継続で、保証・射幸心の表現に当たらない（直下に免責の併記が前提）（2026-10-12、BOA-822 wording-editor、docs/design/in-collapse-caution/mock-reviews-v1.md）
- 新しい用語は実装の前に docs/reference/i18n-glossary.md に4言語の対訳を登録する（BOA-822 では イン崩れ注意度・勝率差・崩れやすい／中くらい／堅め・段ごとの実績）（2026-10-12、同）
