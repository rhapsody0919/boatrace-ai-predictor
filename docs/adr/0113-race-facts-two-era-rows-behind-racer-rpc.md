# ADR-0113: kb と本体を1レース・1艇1行の facts の表にそろえ、走ごとの値は選手1人ごとの RPC だけで匿名に出す

## ステータス

提案（2026-11-27）。オーナーの決定は 2026-11-27（設計 [docs/design/past-data-backfill/plan.md](../design/past-data-backfill/plan.md) §10 の4点を「推奨通りで良い」、窓口経由）。DB の形は [db-draft.md](../design/past-data-backfill/db-draft.md)（未審査の案）。審査は plan.md §12（system-architect・data-scientist）。

関係する ADR: [ADR-0104](./0104-racer-career-stats-two-layer-tables.md)（kb と本体の2層の件数の表。`kb_archive_*` そのものは本 ADR の後も service_role だけ。開くのは、作った行を選手1人ずつ出す RPC だけ）、[ADR-0067](./0067-official-site-content-redisplay-policy.md)（公式のコンテンツの再表示。見直しの契機）、[ADR-0101](./0101-official-site-fetch-budget-and-stop-policy.md)（取得の上限と止め方。過去分の取得の追記）、[ADR-0111](./0111-racer-boat-return-baseline-nightly-table.md)（回収率の基準）、[ADR-0066](./0066-scraping-execution-consolidation-to-vercel.md) 改訂1。

## 背景

- 公式の K/B ファイルは `kb_archive_*` に 2019-04-01〜2025-12-02 がある。本体の表（races ほか）は 2025-12-03〜。選手ページの履歴・回収率の基準・会場の集計の多くは本体だけを読み、過去分が画面に出ない（BOA-1719）
- kb と本体をつなぐ所は、190 の SQL・決まり手の期間の表・分析の台本に散り、それぞれが境目の日と定義（着のコード・進入・グレード・優勝戦）を持つ
- 部品化の台帳（2026-11-24）の推奨 D: 元（出所）の行を前もって計算し、指標の値は画面で登録簿の定義から出す
- オーナー（2026-11-27）: 走ごとの kb の値を匿名に読ませてよい。ただし表を直に開けず、選手1人ごとに jsonb を返す SECURITY INVOKER の RPC を通す

## 決定

1. **`race_facts`（1レース1行）・`run_facts`（1艇1行）を新しく作る。** 列 `era`（'kb'・'main'）で出所を持つ。CHECK `(era='kb' AND race_date<='2025-12-02') OR (era='main' AND race_date>='2025-12-03')`。境目の日の正本は `scripts/lib/kbArchiveBoundary.js`（2025-12-02 は kb から作る）。入れるのは出所の値と規則で決まる区分だけで、率は持たない（ADR-0104 決定2）
2. **書き手は1つ。** 組み立ての関数が kb_archive・kb_archive_extra・潮位・本体を毎回全部読んで1行を作り、全列の payload で `upsertChangedRows`。列の一部だけを埋める書き手は作らない（列を省くと PostgREST のバルク upsert が他の行に NULL を書き、全列で書くと他の出所の値を消す）。窓の中の PK の集合の差で消えたレースの行を消す
3. **起動は3つ。** 当日の起動（当日と前日を15〜30分ごと。選手ページの今節の着順を夜まで遅らせない）、毎晩の起動（直近7日と、古い月を1つずつ順に。進みは `scrape_job_state.last_report`）、kb 層の手動の CLI（半月ずつ・夜間・オーナーが `--apply`）。kb-backfill.js は kb_archive に書いた後に kb 層の作り直しを案内する
4. **匿名には表を開けない。走ごとの値は選手1人ごとの RPC だけで出す。**
   - `get_racer_runs(p_racer_id, p_from)` は SECURITY INVOKER・plpgsql で、jsonb を1つ返す（1000行で黙って切れない）。p_racer_id が NULL なら空を返さず例外（ADR-0069）。p_from は race_id の範囲で絞る（索引の2列目を使う）。既定の p_from は jsonb の大きさを測ってから決める
   - INVOKER の関数は呼んだ人の権限で読むので、両方の表に anon・authenticated の SELECT を付け、RLS で行を絞る。**本当の歯止めは RLS**: `run_facts` は `USING (racer_id = nullif(current_setting('boatai.facts_racer_id', true), '')::integer)`、`race_facts` は `USING (EXISTS (SELECT 1 FROM run_facts r WHERE r.race_id = race_facts.race_id))`（run_facts の RLS がその中でも効く）。この式は1トランザクションに1選手しか通さないので、誰がその設定を立てても、出る量は RPC と同じ1選手まで。表を直に引くと設定が空で0行
   - 設定は関数の中に閉じる: 関数に `SET boatai.facts_racer_id = ''` の句を付け、本文で `PERFORM set_config('boatai.facts_racer_id', p_racer_id::text, true)` を読みの文と分けて先に置く（1つの SQL 文の中に並べると評価の順が保証されない）。第3引数は必ず true（false だとプールの接続で次の人に残る）
   - SECURITY DEFINER は使わない（verify-migration-rls 7）
   - 検査は新しい `verify-facts-racer-guc.js` に置く（既存の verify は変えない）: (a) `boatai.facts_racer_id` がマイグレーションに出てよいのは get_racer_runs の本文と SET 句、2表のポリシーだけ (b) `SET [LOCAL] boatai.`・`ALTER ROLE|DATABASE … SET boatai.` は NG (c) public の関数で set_config の第1引数が文字列の直書きでない物は NG (d) get_racer_runs の set_config の第3引数が true で、SET 句がある (e) schema-snapshot.json の関数の定義・設定も同じ規則で照らす
   - 適用前の読み取り（人）: pg_roles の rolconfig（pgrst.db_pre_request の有無）、pg_graphql の有無、anon が EXECUTE できる public の関数で set_config・SET LOCAL・動的な EXECUTE を含む物、走の多い選手の RPC の EXPLAIN (ANALYZE, BUFFERS)（SET ROLE anon で。claude_ro は BYPASSRLS なので anon の見え方を表さない）
   - 冷えたキャッシュで3秒を超えうる（kb は race_id の順に入り、1選手の行が散る。未検証）。kb 層を入れ終えたら1回 `CLUSTER run_facts USING` (racer_id, race_id) の索引を当てるか、読む列を INCLUDE した索引で表本体を読まない
   - **会場・全国の集計は facts を直に数えない。** この絞りの下では会場単位に読めないので、件数の表（月ごと・条件の軸1つずつ、plan.md §7）に持ち、それは ADR-0104 と同じく表を匿名に SELECT させる。facts を会場単位で匿名に読ませる変更は、この ADR の追記とオーナーの確かめが要る
5. **190 の表はそのまま残す。** kb の値を2通りに作る期間ができる（着のコード・グレード・優勝戦の判定も2か所）。境目の日の照合に加え、manual の関門（何人かの選手で run_facts から数えた件数と racer_venue_stats・racer_term_stats を照らす）を足す。関門が通った後に、190 を facts から作るよう移すかを窓口がオーナーに聞く
6. **時点の違う値を条件の軸で混ぜない。** `condition_source` を行ごとに書き手が決める（K = レースの時点、本体は 2026-09-19 からは結果ページの値、それより前は発走前の値の行がある）。条件の軸は時点の違う行を数えない。風向は出所で方位の数が違う（K は8・本体は16）ので、検証済みの扇形にして入れる
7. **2005-01〜2019-03 の K/B は今は取らない**（オーナー 2026-11-27）。2019-04〜をつないで、延びて価値のある統計を見てから決める

### 追記 2026-11-27: 関数の SET 句をやめる（決定4 の直し）

- マイグレーション 212 の最初の db-apply（run 45937058925）が、get_racer_runs の `SET boatai.facts_racer_id = ''` 句で `permission denied to set parameter` になり全部戻った。本番で当てる役 postgres は superuser でなく、未知の独自の設定の SET 句（保存される設定）を作れない（supautils.privileged_role_allowed_configs に boatai.* が無い）。PGlite は superuser で動くので見えなかった
- 決定4 の「設定は関数の中に閉じる」を次に替える: 本文で `PERFORM set_config('boatai.facts_racer_id', p_racer_id::text, true)` を読みの前に置き、読んだら `PERFORM set_config('boatai.facts_racer_id', '', true)` で空に戻してから返す。第3引数は必ず true（トランザクションの中だけ）。例外のときはトランザクションごと戻り、セーブポイント・EXCEPTION 節で捕まえても set_config(…, true) の値は戻る。本当の歯止めは今までどおり RLS（1トランザクションに1選手）
- verify (b) は関数の SET 句も NG にし、(d) は「立てる set_config と空に戻す set_config があり、第3引数は true だけ」にする。superuser でない役で当てる試験を `verify-race-facts-nonsuper-apply.js` に置く
- 番号は 212 のまま直す（未適用で台帳に行が無い。docs/operation/db-apply.md「失敗したとき」）。採らなかった: `GRANT SET ON PARAMETER`（postgres が付与できる見込みが低く、役に恒久の権限が増える）、supautils の設定を足す（Supabase の管理で SQL から変えられない見込み）
- 本番の anon が本文の set_config で未知の設定を立てられるかは、適用後に anon のキーで `rpc/get_racer_runs` がエラーでなく `[]` を返すことで確かめる（適用前はオーナーの SQL Editor の `BEGIN READ ONLY; SET LOCAL ROLE anon; SELECT set_config(…, true); ROLLBACK;` で見られる）
- 新しい表に anon の SELECT だけを付ける前に `REVOKE ALL … FROM anon, authenticated` を置く（Supabase の既定の権限で ALL が付いていると、RLS の外の権限が残る。205・208 の形）

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
- 設定の名前（`boatai.facts_racer_id`）を他の関数が立てても、RLS が1選手しか通さないので出る量は変わらない。それでも同じ名前を立てる道を作らないことを決定4の verify (a)〜(e) で見る
- 容量は約 +0.5GB（推定）。契約のディスクの上限はオーナーが Supabase の画面で確かめる
- kb の期間は複勝の払戻が無い（074 に列が無い）。複勝の回収率の基準は main の期間のまま
- 1選手の全期間の読みが anon の3秒に収まるかは未検証。適用の前に、走の多い選手で EXPLAIN (ANALYZE, BUFFERS) を測る

## 見直しの契機

- ADR-0067 の見直しの契機（公式・会場からの通知、事業形態の変化、表示の量や範囲の大きな変化、規約・法令の変化）
- RPC の読みが3秒を超え始めたとき、容量が契約の上限の8割に届いたとき
- 2005-01〜2019-03 を取ると決めたとき（決定7）
