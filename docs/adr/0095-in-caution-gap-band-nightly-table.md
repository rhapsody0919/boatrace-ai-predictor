# ADR-0095: イン崩れ注意度は勝率差の帯ごとの全国実績にし、日ごとの件数の表を夜の Python で作って朝に RPC で合計する

- 状態: 提案中（2026-10-13、BOA-822 /step2。design-reviewer の後に採用にする）
- 置き換えるもの: [ADR-0012](./0012-ai-model-redesign-volatility-continuous-score.md)（イン崩れ指数の連続値統合方式）の、画面に出す値（会場内の直近90日のパーセンタイル）。合成値の計算は旧キーをやめるまで残る
- 関連: [ADR-0085](./0085-analogy-v16-daily-batch-to-storage.md)（完全レースの判定を Python の features.py だけに置く）、[ADR-0070](./0070-morning-digest-precomputed-rows.md)（/today は 05:30 に事前計算。変えない）、[ADR-0074](./0074-rpc-key-regression-check.md)（RPC のキーの回帰検査）
- 設計: [docs/design/in-collapse-caution/plan.md](../design/in-collapse-caution/plan.md)

## 背景

ユーザーが案Y を選んだ（2026-10-12、`docs/design/in-collapse-caution/decisions.md`）。イン崩れ注意度の値を「1号艇の全国勝率 − 2〜6号艇の最高の全国勝率を 0.5 刻みの帯にし、その帯（準優・優勝戦・それ以外で分ける）の全国の過去レース（2019-04〜前日）で1号艇が1着を逃した割合」に替える。値を作る時刻・保存・画面への流れ（朝の unified の生成 → predictions → RPC → 一覧・ホーム・/today・SNS）は今の指数のまま残す。

決めることは、帯ごとの率を朝 5時台の生成の中でどう出すか。母集団は約48万レース（2019-04〜）、完全レースの判定（欠場・返還・不成立・中止・1〜3着の返還艇）は統計検証と同じでなければならない。

## 決定

- 夜（JST 2:30、Vercel Cron → workflow_dispatch）に Python（`scripts/ml/analogy/in_caution_bands.py`）が、`features.py` の `race_ok` で完全レースを決め、「日 × ラウンド × 帯」の件数と1号艇の非1着数を表 `in_caution_gap_band_daily`（マイグレーション 155、約5万行）に書く。毎晩は直近14日を upsert する
- 朝の生成（`generate-unified-predictions.js`）は RPC `get_in_caution_band_rates(p_from, p_through)`（service_role のみ）で期間を合計した約45行を1回読み、レースごとに `feature_contributions.inCaution`（率・件数・段・勝率差・through・定義の版）を書く。段（35%・55%、画面に出す整数の%で判定）は生成のときに1つの関数で決めて保存する
- 期間は表に入れず RPC の引数で決める。勝率差は 1/100 の整数で計算する
- 新しいキー `inCaution` を足し、`volatilityPercentile` の意味は変えない。読み手を全部切り替えてから旧キーをやめる
- /accuracy の実績（公開前の検証・公開後）も同じ夜のジョブが `accuracy_cache.in_caution_accuracy` に書く

## 却下した選択肢

| 案 | 不適合 |
|---|---|
| A. 朝の生成の中で、過去レースを全部読んで JS で率を出す | 約48万レース×6艇を毎朝読む（Disk IO、races-init の時間）。完全レースの判定を JS に書き直すことになり、統計検証（Python）とずれる（ADR-0085 と同じ理由） |
| B. 帯ごとの率の小さな表（約45行）だけを夜に作る | 期間を変えるたびに作り直しが要る。/accuracy の「公開前の検証」は日ごとの累積が要るので、別に日ごとの表が要る |
| C. 日ごとの表を PostgREST で読み、JS で合計する | GROUP BY できず、約5万行を読むと1000行で黙って切れる（BOA-301・BOA-372）。ページングしても毎朝5万行を読む |
| D. SQL（マテリアライズドビュー・RPC）で完全レースを判定して帯ごとに数える | 完全レースの判定（長期の kb_archive と本体で列が違う、返還の扱い、F・L）を SQL に書き直すことになり、統計検証とずれる。長期と本体をまたぐ重いクエリを本番で走らせる |
| E. 帯の率を固定値（統計検証の時点の表）としてコードに置く | 前日までの実績にならない（spec FR-2）。/accuracy の公開後の実績も出せない |
| F. `volatilityPercentile` に新しい値を入れて使い回す | RPC の 0.7/0.3・/today の 50・集計・SNS 企画の閾値が古い意味のまま動く。値の意味の変化は `verify-rpc-key-regression` でも検知できない（ADR-0074「限界」） |

## 影響

- 夜のジョブが1本増える（GitHub Actions、`export_pool.js --daily` と週次の学習のキャッシュに依存。v16 の朝のバッチと同じ前提）。失敗しても値は前日の合計のまま（6年分なので差はほぼ無い）
- 完全レースの判定と帯の作り方が Python にあり、段の判定と帯の作り方は JS（生成・画面）にもある。両言語で同じ固定の入力を通す verify で一致を固定する。閾値と期間は `src/data/inCautionConfig.json` の1か所に置く
- 2〜6号艇の朝の後の欠場は反映されない（展示後の出し直しをしない）
- 旧キーを書き続ける期間（公開後の掃除まで）は、朝の生成が旧指数と新しい値の両方を計算する
