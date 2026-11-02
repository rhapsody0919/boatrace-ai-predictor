# ADR 0104: 選手ページの場別・期別・進入コース別・優勝戦の集計を、kb と本体の2層の件数の表に持ち、匿名に読ませる

## ステータス

採用（2026-10-31）。オーナーの決定は 2026-10-28（案2を「進めて良い」）。設計の正本は [docs/design/racer-period-stats/plan.md](../design/racer-period-stats/plan.md) §14、仕様は [spec.md](../design/racer-period-stats/spec.md)。審査は [analysis/aggregate-tables-review.md](../design/racer-period-stats/analysis/aggregate-tables-review.md)（system-architect、設計 C）。マイグレーションは [190](../db-migration/190_racer_career_stats.sql)。

関係する ADR: [ADR-0067](./0067-official-site-content-redisplay-policy.md)（公式のコンテンツの再表示、見直しの契機）、[ADR-0088](./0088-venue-winning-technique-counts-by-period.md)（kb_archive を会場の集計として匿名に出した先例）、[ADR-0066](./0066-scraping-execution-consolidation-to-vercel.md) 改訂1（DB の中の集計を Vercel Cron で回す線引き）。

## 背景

- GS00: 選手ページを、艇国データバンク（公式の選手の長期成績の検索）を使っていた人の受け皿にする。場別・優勝歴・期別・2019年以降の進入コース別が要る
- 公式の期別成績（fan、`racer_period_stats`）は期ごと・全国の値だけで、会場別・優勝戦の一覧を持たない。会場別・優勝歴は着順の生の記録から数えるしかない
- 生の記録は2つの表にある
  - `kb_archive_*`（K/B ファイル、2019-04-01〜2025-12-02、書き手の cron が無く止まっている）
  - 本体（`races`・`race_entries`・`race_start_timings`・`race_results`・`race_conditions`、2025-12-03〜）
- `kb_archive_*` は匿名に読ませていない（074 のコメント「アーカイブを公開APIへ出さない」）。ADR-0088 は会場の集計だけを匿名に出した
- 選手ページを開くたびに 221万行（`kb_archive_boats` 412MB）を引く RPC は、Small の Disk IO の予算に響き、SECURITY DEFINER の RPC を匿名に開くこともできない（`verify-migration-rls` 7、113）

### ADR-0067 の確認（2026-10-28）

- 選手単位の kb の値を匿名に出すのは、ADR-0067 の見直しの契機「取得・表示の量や範囲が大きく変わる場合」に当たりうる（system-architect の審査）
- 中身は着順・出走の事実データの集計で、文章の再表示ではない。現状維持の範囲と読むのが自然だが、公開の方針に関わるので、オーナーに1行で確かめた
- オーナーの答え（2026-10-28）: 進めて良い。ADR-0067 の現状維持の範囲として扱う。専門家への確認は引き続き行わない

## 決定

1. **表を2層にする。** 各表に `era`（`kb` = race_date ≤ 2025-12-02、`main` = race_date ≥ 2025-12-03）を持たせ、主キーに入れる。境目の日は `scripts/lib/kbArchiveBoundary.js` が正本（kb-backfill.js も読む）。2025-12-02 は両方の表にあるので、kb だけから数える
   - `racer_venue_stats`（選手×会場×層×グレード×優勝戦か）
   - `racer_term_stats`（選手×期×層×グレード×優勝戦か。期は公式の算出期間の 5〜10月・11〜4月で、`term_start` は 5/1 か 11/1。暦の年では持たない）
   - `racer_course_stats`（選手×進入コース×期×層）
   - `racer_championships`（優勝戦に出た艇、PK は (race_id, racer_id)）
   - `racer_career_meta`（層ごとの計算の記録と、元の表の指紋）
2. **率・勝率の点は持たない。** 着のコード（01〜06・F・L0・L1・K0・K1・S0・S1・S2・00、知らないコードは other_code）ごとの件数だけを持つ。勝率・出走は `src/pure/racerCareerStats.js`（BOA-1193）の純関数で読み手の側が計算する。勝率の着順点はグレードと優勝戦かで変わる（official-data-spec、fan と3期 4,673人で全員一致）ので、場別・期別はその2つをキーに入れる
3. **優勝戦の判定は `src/pure/raceStageConfig.js` の `isFinalStage`（v2）だけで行う。** 書き手が範囲の種別の原文を判定し、RPC に一覧で渡す。`kb_archive_races.stage_kind`・`is_final_day`・`race_series.end_date` は使わない（GP優勝戦・賞金女王決定・〜優 を落とす）
4. **グレードの補正は書き手が決めて RPC に渡す。** 元は kb が `kb_archive_venue_days.race_grade`、本体が `races.race_grade`、無ければ `race_series.grade`、それも無ければ `race_series.class_code`（Lady・Takumi は G3、Rookie・Venus は ippan。2025-12-03〜2026-02-02 の876レース）。同じ開催日に2つの格が混ざる QC/QCシリーズ（G1/G3）・CC/レディースCC（SG/G2）は、同じレースに出た選手のつながりで組に分ける。唐津 2024-10-12〜14 のバトルトーナメントは G1（公式がそう数えた）
5. **kb 層は1回だけ計算する。** 手動の CLI（`scripts/maintenance/racer-career-backfill.js --era=kb`）をオーナーが実行する。`kb_archive_boats` は race_id の範囲（PK の先頭）で半月ずつ読み、racer_id の索引は足さない。開催日・レースの数・最大の日付の指紋を `racer_career_meta` に残す（行数・日付が変わる再投入だけを検知する）
6. **main 層は毎晩「計算し直す」。** Vercel Cron（`api/cron/racer-career-main.js`、23:30・01:00 JST）が、直近3日に出走表に載った選手と着のコードが直近3日に書き換わった選手について、main の全期間を数え直して upsert する。差分を足す方式は取らない（重複配信で倍にならず、未配信は次の晩の窓が拾う）。件数が0になったセルは消す
7. **書き手は service_role だけ。** 集計の RPC 3つは STABLE・SECURITY INVOKER・service_role だけ（1関数1文で REVOKE と GRANT）。表は RLS を有効にし、anon・authenticated に SELECT だけを付ける
8. **照合を関門にする。** `verify-racer-career-gate.js`（manual）が、選手×期の出走・1着・2着・勝率・優勝・優出と進入コース別の着のコードを `racer_period_stats` と比べる。一致しない選手を完了報告に出す。2019〜2023-10 と 2025-05〜12-02 の勝率の定義は、この関門で初めて確かめる

## 却下した選択肢

- **選手ページを開くたびに生の記録から数える RPC を匿名に開く（設計 B）**: SECURITY DEFINER を匿名に開くのは 113・ADR-0088 の却下の理由と同じで規則に反する。1回ごとに 221万行の表を引く
- **毎晩、その日の差分を足す（叩き台 A）**: Cron の重複配信で倍になり、未配信で欠ける。後からの訂正（K ファイルの書き換え）が直らない
- **勝率・率を表に持つ**: 定義（グレード別の加点・優勝戦の加点）を SQL と JS の2か所に書くことになる。件数を持てば、定義を変えても表は作り直さずに済む
- **期でなく暦の年で持つ**: 公式の期別成績と照合できない。画面で「年別」と言わない（data-scientist）。5月〜翌4月は2期を足せば出る
- **`kb_archive_boats` に racer_id の索引を足す**: 1回だけの計算のために 412MB の表へ索引を足すと、書き込み・容量が増える。PK の範囲読みで足りる

## 影響と限界

- 匿名に読ませるのは件数の表だけで、`kb_archive_*` そのものは今までどおり service_role だけ
- 毎晩の対象は「直近3日」なので、それより前のレースの種別・グレードの訂正（race_conditions・race_series の書き換え）は拾わない。拾うには CLI の `--era=main --all` を流す。規則を変えたら `RULE_VERSION` を上げ、kb と main を計算し直す
- kb_archive を誰かが load し直すと kb 層は古いまま残る。毎晩の Cron の指紋（開催日・レースの数・最大の日付）は、行数・日付が変わる再投入だけを検知して error にする。値だけを書き換える再投入は検知しないので、kb-backfill.js は kb_archive に書いたら終わりに「racer-career-backfill.js --era=kb を再実行する」と出す（自動では計算し直さない。412MB を読むのはオーナーの判断で）
- CC の SG の組は「最終日の 12R の組」と置いた。照合の関門の勝率（SG と G2 は加点が1違う）で確かめる。外れたら規則を直す
- 優出に S0・K0・L0 を含めるかは未決（BOA-1193 の質問）。`racer_championships` は着のコードを持つので、読み手が後から決められる
- RPC が打ち切り（57014）で落ちても、範囲・人数を半分にしてやり直す仕組みは無い。今は8秒に余裕がある（main の50人は1回目 5.6秒・2回目以降 0.34〜0.54秒、kb の半月は約0.5〜0.8秒）。落ちたら半分にしてやり直す処理を足す
- 特別な節は「同じ題で連続した日」だけでまとめる。丸一日の中止で日が欠けると節が割れ、基準のレースが無い側で止まる。main は「レースごとの題」で日を拾うので、同じ日に題が2種類あると日が二重に入るおそれがある（どれも黙って壊れず、止まって知らせる）
- 毎晩の対象は今の出走表に載っている選手だけ。race_entries の racer_id が後から直されると、前の選手の main の行が残る（`--era=main --all` で直る）
- 公式の照合を待つもの: 津 2026-10-10〜12 のバトルトーナメントは両方の元で ippan のまま。唐津 2024 の規則は会場と日付の決め打ちなので、2026-05 の期の公式が出たら関門で見る。GP と GPシリーズのように同じ日に格が同居する節は規則に無い。11月期の関門でずれたら規則に足す
- 見直しの契機は ADR-0067 と同じ（公式・会場からの通知、事業形態の変化、表示の量や範囲の大きな変化、規約・法令の変化）
