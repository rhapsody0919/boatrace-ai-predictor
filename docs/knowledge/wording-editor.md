# 龍神レーダー 言葉の知見ノート（言葉役が最初に読む）
1行1知見、出典つき。言葉役（.claude/agents/wording-editor.md）が最初に読み、答えの最後に出した「足す行」を依頼元が書き足す。古くなった行は消さずに「（廃止 日付 理由）」を付ける

## 禁止語
- 画面・ブログ本文・見出し・SNS の本文/ナレーション/焼き込み文字で「競艇」は使わず「ボートレース」。役所広告の出稿対象から外れるため（.claude/rules/code-style.md、memory kyoutei_terminology_ban_rationale）
- 例外は2つだけ。①画面に出ないメタ情報（title・meta description・keywords・OGP/Twitter カード）②SNS のハッシュタグ #競艇。どちらも暫定で、①は役所へ営業する前に外す、②は GA4 の月間ユーザー（直近28日）が1000人になったら止める（code-style.md、2026-09-29・2026-10-08 ユーザー判断）
- 「数える」「集計」「算出」「対象」「似た」「似ている」「ふつう」「いつも」は使わない（BOA-271・BOA-815 等のオーケストレーターの指示、2026-10-08 のユーザー指摘）
- 過去レースを比べる相手は「類似レース」。「似たレース」は禁止。パネルの言い換え案でも採らない（memory feedback_term_ruijirace_not_nitarace、2026-10-07）
- モックは画面の文字だけでなく周りの説明・価値の欄も禁止語を grep で検査する: grep -nE "ふつう|普通|似た|似て|いつも|数え"（memory feedback_banned_words_scan_mock_and_notes、2026-10-09 の差し戻し）
- 「集計前」の印は禁止語を含むので言い換えを検討中（BOA-830 の説明、2026-10-11）
- 廃止済みのモデル名（本命狙いモデル・スタンダードモデル・穴狙いモデル・今日のおすすめ）は使わない（sns-video-studio/remotion/risk-rules.json の deprecated-model-names、scripts/maintenance/check-deprecated-terms.js）

## 用語の対訳
- 4言語の用語は docs/reference/i18n-glossary.md が正本。新しい用語は glossary に足してから訳す（.claude/rules/i18n-new-pages.md）
- 韓国語の「今期」に 금기 を使わない（禁忌と読める）（memory i18n_korean_this_term_not_geumgi）
- ハングル「경정」・繁体字「賽艇」は「競艇」とは別文字列で禁止の外（i18n-glossary.md の方針）

## 誇大・保証・射幸心
- 的中・勝利を保証する表現は全プラットフォームで警告。「当たり」「的中」単独は警告しない（risk-rules.json の guaranteed-hit）
- 配当倍率・金額を主役にする演出、「儲かる」等の射幸心を煽る語は避ける（risk-rules.json の gambling-incitement）
- 予想・賭け事を直接連想させる語・構図の警告は TikTok だけ。X と YouTube は対象外で同じ規則（risk-rules.json の gambling-connotation-words、2026-10-10 ユーザー判断で YouTube を X にそろえた）
- X・YouTube で「本命寄り」・過去の万舟率くらいは可（docs/knowledge/sns-fan.md、hq knowledge/ryujin/boatrace-fan.md）
- note の公開済み2記事の「確実に増やす」「稼ぐロードマップ」「再現性重視」は利益保証表現として記録し、様子見（memory note_compliance_flag_watch_2026_09_05）
- 過去の「回収率1343%」「高精度」等を単独で先に直す提案はしない。AI予想の作り直し（BOA-617）の中でだけ扱う（memory feedback_no_proposals_on_past_accuracy_claims、2026-10-01 ユーザー判断）
- AdSense の表現の決まりはリポジトリに正本が無い（2026-10-11 時点）。答えるときは Google の公式ポリシーを確かめて出典を付け、決まりができたらここに足す（Orchestrate 2026-10-11 依頼に対する確認結果）
- risk-rules.json の検出は警告だけで承認は止めない。生成の指示と自動チェックの両方がこのファイルを読む（risk-rules.json の _comment）

## content-qa との分担
- content-qa はブログ記事の公開前6観点（.claude/commands/publish-blog.md）の合否判定。言葉役は画面・モック・SNS・spec を含む全ての文の言葉の相談と、禁止語・誇大・対訳の判定。ブログの公開前は content-qa を使い、言葉役は文の言い換え案を出すときに使う（Orchestrate 2026-10-11 依頼）
