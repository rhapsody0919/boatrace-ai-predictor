# ADR-0113: kb と本体を1レース・1艇1行の facts の表にそろえ、走ごとの値は選手1人ごとの RPC だけで匿名に出す

## ステータス

提案（2026-11-27）。オーナーの決定は 2026-11-27（設計 [docs/design/past-data-backfill/plan.md](../design/past-data-backfill/plan.md) §10 の4点を「推奨通りで良い」、窓口経由）。DB の形は [db-draft.md](../design/past-data-backfill/db-draft.md)（未審査の案）。審査は plan.md §12（system-architect・data-scientist）。

関係する ADR: [ADR-0104](./0104-racer-career-stats-two-layer-tables.md)（kb と本体の2層の件数の表。本 ADR はその「匿名に読ませるのは件数の表だけ」を広げる）、[ADR-0067](./0067-official-site-content-redisplay-policy.md)（公式のコンテンツの再表示。見直しの契機）、[ADR-0101](./0101-official-site-fetch-budget-and-stop-policy.md)（取得の上限と止め方。過去分の取得の追記）、[ADR-0111](./0111-racer-boat-return-baseline-nightly-table.md)（回収率の基準）、[ADR-0066](./0066-scraping-execution-consolidation-to-vercel.md) 改訂1。

## 背景

- 公式の K/B ファイルは `kb_archive_*` に 2019-04-01〜2025-12-02 がある。本体の表（races ほか）は 2025-12-03〜。選手ページの履歴・回収率の基準・会場の集計の多くは本体だけを読み、過去分が画面に出ない（BOA-1719）
- kb と本体をつなぐ所は、190 の SQL・決まり手の期間の表・分析の台本に散り、それぞれが境目の日と定義（着のコード・進入・グレード・優勝戦）を持つ
- 部品化の台帳（2026-11-24）の推奨 D: 元（出所）の行を前もって計算し、指標の値は画面で登録簿の定義から出す
- オーナー（2026-11-27）: 走ごとの kb の値を匿名に読ませてよい。ただし表を直に開けず、選手1人ごとに jsonb を返す SECURITY INVOKER の RPC を通す

## 決定

1. **`race_facts`（1レース1行）・`run_facts`（1艇1行）を新しく作る。** 列 `era`（'kb'・'main'）で出所を持つ。CHECK `(era='kb' AND race_date<='2025-12-02') OR (era='main' AND race_date>='2025-12-03')`。境目の日の正本は `scripts/lib/kbArchiveBoundary.js`（2025-12-02 は kb から作る）。入れるのは出所の値と規則で決まる区分だけで、率は持たない（ADR-0104 決定2）
2. **書き手は1つ。** 組み立ての関数が kb_archive・kb_archive_extra・潮位・本体を毎回全部読んで1行を作り、全列の payload で `upsertChangedRows`。列の一部だけを埋める書き手は作らない（列を省くと PostgREST のバルク upsert が他の行に NULL を書き、全列で書くと他の出所の値を消す）。窓の中の PK の集合の差で消えたレースの行を消す
3. **起動は3つ。** 当日の起動（当日と前日を15〜30分ごと。選手ページの今節の着順を夜まで遅らせない）、毎晩の起動（直近7日と、古い月を1つずつ順に。進みは `scrape_job_state.last_report`）、kb 層の手動の CLI（半月ずつ・夜間・オーナーが `--apply`）。kb-backfill.js は kb_archive に書いた後に kb 層の作り直しを案内する
4. **匿名には表を開けない。走ごとの値は選手1人ごとの RPC だけで出す。** `get_racer_runs(p_racer_id, p_from)` は SECURITY INVOKER で、jsonb を1つ返す（1000行で黙って切れない）。INVOKER の関数は呼んだ人の権限で表を読むので、表には anon・authenticated に SELECT を付け、RLS のポリシーで行を絞る: `USING (racer_id = nullif(current_setting('boatai.facts_racer_id', true), '')::integer)`。RPC だけがその場で `set_config('boatai.facts_racer_id', p_racer_id::text, true)`（トランザクションの中だけ）を立ててから読む。表を直に引くと設定が空なので0行になる。SECURITY DEFINER は使わない（verify-migration-rls 7）。race_facts も同じ RPC の中で race_id でつなぐ
   - 会場・全国の集計は、件数の表（月ごと・条件の軸1つずつ、plan.md §7）に持ち、それは ADR-0104 と同じく表を匿名に SELECT させる
5. **190 の表はそのまま残す。** 後で facts から作るように移すかは、facts が本番に入り照合が通った後に決める（kb の値を2通りに作る期間ができる。どちらも境目の日を kbArchiveBoundary.js と照合する verify で守る）
6. **時点の違う値を条件の軸で混ぜない。** `condition_source` を行ごとに書き手が決める（K = レースの時点、本体は 2026-09-19 からは結果ページの値、それより前は発走前の値の行がある）。条件の軸は時点の違う行を数えない。風向は出所で方位の数が違う（K は8・本体は16）ので、検証済みの扇形にして入れる
7. **2005-01〜2019-03 の K/B は今は取らない**（オーナー 2026-11-27）。2019-04〜をつないで、延びて価値のある統計を見てから決める

## 却下した選択肢

- **本体の表へ kb を入れる**: B の当地勝率など定義が違い、範囲を指定しない集計（aggregate-racer-stats.js）が黙って変わる（kb-longterm-backfill §4.1）
- **画面ごとに kb と本体を足す RPC**: 同じ継ぎ目と定義を画面の数だけ書く
- **kb_archive に racer_id の索引を足して読む**: anon に kb_archive の生の列の SELECT が要り、074 の方針に反する
- **ビューで UNION**: security_invoker でないと RLS を迂回し、verify-migration-rls はビューを見ていない
- **表をそのまま anon に開く**: オーナーの条件（表を直に開けない）に反する。選手単位でなく全件を一度に引ける
- **SECURITY DEFINER の RPC**: anon に DEFINER を開くのは verify-migration-rls 7・ADR-0104 の却下と同じ理由で規則に反する

## 影響と限界

- 匿名に出る範囲が「選手単位の件数」から「選手1人の走ごとの行」に広がる。中身は着順・進入・ST・展示タイム・払戻などの事実データで、文章の再表示ではない。ADR-0067 の現状維持の範囲とオーナーが判断した（2026-11-27）
- RPC を選手ごとに何度も呼べば、全選手の行を集められる。それは今の画面（本体の表を匿名に SELECT させている）と同じ程度の開き方で、表を直に1回で引かれるよりは重い
- RLS の設定の名前（`boatai.facts_racer_id`）を他の関数が立てると絞りが外れる。同じ名前を使う関数を作らないことを verify で見る（マイグレーションの SQL に `set_config('boatai.` が `get_racer_runs` の中にだけあること）
- 容量は約 +0.5GB（推定）。契約のディスクの上限はオーナーが Supabase の画面で確かめる
- kb の期間は複勝の払戻が無い（074 に列が無い）。複勝の回収率の基準は main の期間のまま
- 1選手の全期間の読みが anon の3秒に収まるかは未検証。適用の前に、走の多い選手で EXPLAIN (ANALYZE, BUFFERS) を測る

## 見直しの契機

- ADR-0067 の見直しの契機（公式・会場からの通知、事業形態の変化、表示の量や範囲の大きな変化、規約・法令の変化）
- RPC の読みが3秒を超え始めたとき、容量が契約の上限の8割に届いたとき
- 2005-01〜2019-03 を取ると決めたとき（決定7）
