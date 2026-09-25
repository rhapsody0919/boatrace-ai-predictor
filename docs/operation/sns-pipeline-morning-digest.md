# 「本日のデータ一覧」（morning-digest）型 共通仕様

`sns_topics` の型（`sns_topic_categories.category_key = 'morning-digest'`）で来たネタの、**チャネル横断で共通の**制作仕様。チャネル別の手順（claim・レンダリング・永続化）はそれぞれの `docs/operation/sns-pipeline-{x,blog,note,youtube}.md` に従い、このファイルは「何を材料に、何を書いてよいか」だけを定める。

ネタの出所は `/today`（「本日のデータ一覧」、[BOA-402](https://linear.app/boat-ai/issue/BOA-402)）の日次バッチ。設計は [`docs/design/morning-data-digest/`](../design/morning-data-digest/)（spec/screens/plan/tasks）、[ADR-0070](../adr/0070-morning-digest-precomputed-rows.md)・[ADR-0071](../adr/0071-venue-adjusted-skill-delta.md)。

競合（ボートレース日和）が毎朝Xに出している「本日のデータ一覧」への差別化が出発点。**同じ6項目を並べ直すのではなく、会場・レースグレードの有利不利を除いた比較を見せるのが龍神レーダー側の売り**。

---

## 1. 材料は2表だけ（絶対）

本文・画像・動画の数値は、`morning_digest_days` と `morning_digest_rows` の **`digest_date` が対象日の行だけ**から取る。

```sql
select * from morning_digest_days where digest_date = '{date}';
select * from morning_digest_rows where digest_date = '{date}' order by section, rank;
```

- **`race_results`・`racer_course_technique_stats` 等を引いて計算し直さない。** ページとSNSが同じ行を読むことで値の食い違いを構造的に防ぐのがこの機能の設計（ADR-0070）。再計算するとその保証が消える
- 対象日は `sns_topics.topic_text` の先頭「【本日のデータ一覧 YYYY-MM-DD】」から読む
- 行が無い（バッチ未実行）場合は生成せず、claim したターゲットを `skipped`（理由: 対象日のダイジェストが未生成）にして終わる

### `section` の値

| section | 意味 | 主な列 |
|---|---|---|
| `nige` | 1号艇の選手が1コースで逃げ切った割合が70%以上 | `metric_value` / `metric_venue_baseline` / `sample_size` |
| `makuri` | その選手がそのコースでまくりで1着になった割合が25%以上 | 同上（`course` が1ではない） |
| `nigashi` | 1号艇に逃げ切られる割合が、会場・級別の構成から期待される水準を22pt以上上回る | 同上 |
| `flying` | 前日にフライングがあった選手 | `racer_name` / `venue_code` / `race_number` |
| `returned` | 前日に節の途中で出走表から外れた選手（帰郷） | `racer_name` / `venue_code` |
| `featured` | 当日の注目レース1件。`detail.reason` に理由の文が入っている | 上記＋`volatility_percentile` |

---

## 2. 書いてよいこと・いけないこと

- **`metric_value` 等はすべて過去の実績の集計値。「予測」「予想」として書かない。** AIの予測値は `volatility_percentile`（イン崩れ指数）**だけ**で、これに触れるときは「AIが当日条件から算出した指標」と明示する
- **`metric_predicted`（推定値）は本文に出さない。** 画面からも意図的に消した列で、抽出・並び替えの内部処理にしか使わない（spec FR-4 の改訂、2026-09-24）
- **「勝率」という語を使わない。** ボートレースの勝率は着順点の平均であり1着率ではないため、誤用になる。「逃げ切った割合」「まくりで1着になった割合」のように書く
- **`detail.baselineGrade` はレースのグレード**（`SG`/`G1`/`G2`/`G3`/`ippan`/`ALL`）で、**A1・A2 といった選手の級別ではない**。「本日の級別」等と書くと事実と食い違う（実際にUIでこの誤表記をして直した経緯がある）。`ALL` は「そのグレードの母数が100走未満のため全グレードをまとめた平均」を意味する
- `is_small_sample = true` の行を主役に据えない。触れる場合は母数（`sample_size`）を併記する
- 会場名は `venue_code` から引く。選手名は `racer_name` をそのまま使い、勝敗や実力を揶揄する表現にしない（選手個人のデータを題材にした煽り・ユーモアは2026-09-07に却下済み。`docs/operation/sns-topic-proposer-daily-auto.md` 参照）
- 「競艇」使用禁止（`.claude/rules/code-style.md`。`<title>`・meta description のみ例外で、SNS本文は例外ではない）
- リンクは**常に `https://www.boat-ai.jp/today`**。`?date=` を付けない（日付別URLは canonical を持たず、AIスナップショットの対象でもない）

---

## 3. チャネルごとの切り口

材料は同じでも、そのまま転記すると4チャネルで同じ文章になる。以下の軸で分ける。

| チャネル | 位置づけ | 分量・形式 |
|---|---|---|
| X | その日の朝に「今日どこを見るか」を渡す。`featured` 1件＋数値2〜3個に絞る | 9:16の動画または画像1枚＋短文。問いかけを1つ入れる（`x-operations-playbook.md`） |
| ブログ | 「なぜ会場平均と並べる必要があるのか」を説明する解説記事。**毎日1本は書かない**（同じ主題の薄い記事を量産しないため、週1本程度の頻度で、その週に出た実例を材料にする） | 2,000〜3,500字。表で構造化。FAQセクション（`.claude/CLAUDE.md` フローA-3） |
| note | ブログ本文からの変換が基本（`sns-pipeline-note.md` の依存関係チェックに従う） | ブログに準じる |
| YouTube | `featured` の1レースを、会場平均との比較を軸に解説する | `sns-pipeline-youtube.md` の尺・形式に従う |

いずれも生成前に `getRecentRevisions({platform})`・`getActiveInsights({platform, format, language})` を確認し、`checkRiskRules(text, platform)` に通して該当を `risk_flags` に記録する（ブロックはしない。`.claude/rules/sns-content-generation.md`）。

**最終送信（投稿）は自動化しない。** sns-hub の承認待ちに出すところまでで止め、1件ごとにユーザーの明示承認を得る。

---

## 4. チャネルの増減

対象チャネルは `sns_topic_category_channels`（`category_key='morning-digest'`）のデータで決まる。初期値は x / blog / note / youtube の4つ、TikTok は対象外。**増減はコードを触らず sns-hub 管理画面「ネタ型設定」から `enabled` を切り替える**（毎朝4チャネルぶんの下書きが出る運用が重い場合も同じ画面で減らせる）。
