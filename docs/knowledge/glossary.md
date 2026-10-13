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

## 呼び方
- 「展示前版」「展示後版」の「版」はファンに分かりにくい。「直前予想」「展示前の予想」と言う（2026-10-12、オーナー）
- 2着の相手は「相手」と言う（2026-10-12、デザイナー役 v10）
- リング交換は「本」を単位にする（2026-10-12、ファン役 v10）

## 用語の対訳
- 4言語の用語は docs/reference/i18n-glossary.md が正本。新しい用語は glossary に足してから訳す（.claude/rules/i18n-new-pages.md）
- 韓国語の「今期」に 금기 を使わない（禁忌と読める）（memory i18n_korean_this_term_not_geumgi）
- ハングル「경정」・繁体字「賽艇」は「競艇」とは別文字列で禁止の外（docs/reference/i18n-glossary.md の方針）

## 誇大・保証・射幸心・SNS の規則
- 的中・勝利を保証する表現は全プラットフォームで警告。「当たり」「的中」単独は警告しない（risk-rules.json の guaranteed-hit）
- 配当倍率・金額を主役にする演出、「儲かる」等の射幸心を煽る語は避ける（risk-rules.json の gambling-incitement）
- 予想・賭け事を直接連想させる語・構図の警告は TikTok だけ。X と YouTube は対象外で同じ規則（2026-10-10 ユーザー判断で YouTube を X にそろえた、risk-rules.json の gambling-connotation-words）
- X・YouTube では「本命寄り」・過去の万舟率くらいは可（2026-10-11、オーナー）
- risk-rules.json の検出は警告だけで承認は止めない。生成の指示と自動チェックの両方がこのファイルを読む。食い違う判定をしたら片方だけ直さない（risk-rules.json の _comment）
- note の公開済み2記事の「確実に増やす」「稼ぐロードマップ」「再現性重視」は利益保証表現として記録し、様子見（2026-09-05 ユーザー判断、memory note_compliance_flag_watch_2026_09_05）
- 過去の「回収率1343%」「高精度」等を単独で先に直す提案はしない。AI予想の作り直し（BOA-617）の中でだけ扱う（2026-10-01 ユーザー判断、memory feedback_no_proposals_on_past_accuracy_claims）
- AdSense の表現の決まりはリポジトリに正本が無い。答えるときは Google の公式ポリシーを確かめて出典を付け、決まりができたらここに足す（2026-10-11、オーケストレーター依頼への確認結果）

## content-qa との分担
- content-qa はブログ記事の公開前6観点（.claude/commands/publish-blog.md）の合否判定。wording-editor は画面・モック・SNS・spec を含む全ての文の言葉の相談と、禁止語・誇大・対訳の判定。ブログの公開前は content-qa、言い換え案は wording-editor（2026-10-11、オーケストレーター依頼）
- 「崩れやすい」「堅め」は旧指数のラベルの語（percentileBarMax 等）の継続で、保証・射幸心の表現に当たらない（直下に免責の併記が前提）（2026-10-12、BOA-822 wording-editor、docs/design/in-collapse-caution/mock-reviews-v1.md）
- 新しい用語は実装の前に docs/reference/i18n-glossary.md に4言語の対訳を登録する（BOA-822 では イン崩れ注意度・勝率差・崩れやすい／中くらい／堅め・段ごとの実績）（2026-10-12、同）
