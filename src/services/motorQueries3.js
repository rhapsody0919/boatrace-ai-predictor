// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: motor）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { isInMotorGeneration } from "../utils/motorGeneration";
import { isFinalStage } from "../constants/raceStageConfig";
import {
  pastMotorRows,
  recalcMotorRows,
  settleMotorBreakdown,
} from "../pure/raceMotorBreakdown.js";
import { isPastRace, withCache } from "./core.js";
import { beforeKey, getMotorGenerationStart } from "./motorQueries.js";
import {
  fetchPretestByRacer,
  getMotorPowerIndex,
  getRaceMotorFreshness,
} from "./motorQueries2.js";

/**
 * 指定会場・モーター番号の公式サイト発表モーター成績（節数・出走回数・
 * 優出回数・優勝回数等）の最新スナップショットを取得する（BOA-264）。
 * `venue_motor_stats`は日次で会場公式サイトをスクレイピングして書き込まれる
 * （scripts/daily/scrape-venue-motor-stats.js）。会場ごとに公式サイトの
 * 公開項目が異なるため、値が無い項目はnullのまま返す（戸田・平和島は
 * データ自体が無いため常にnull）。「機力指数+16.6だが抽選後8走しかしていない
 * ので信頼度低め」のように、他のモーター指標の信頼度を判断する材料として使う
 *
 * 取得に失敗したときは `{ fetchFailed: true }` を返す（BOA-740）。null（その会場・モーターの行が無い）と
 * 区別し、withCache に保存させない（frontend-data-fetch.md §4）。以前は失敗も null にしていたため、
 * 「会場公式の成績なし」として30分キャッシュに残り、画面も失敗を知らせなかった
 * @returns {Promise<Object|null|{fetchFailed: true}>}
 */
export function getVenueMotorStats(venueCode, motorNumber, asOfDate = null) {
    return withCache(
      // asOfDate（YYYY-MM-DD）を渡すと、その日以前で最新のスナップショットを返す
      // （過去レースの一覧表をレース時点の公式値にする、BOA-329）
      asOfDate === null
        ? `venue-motor-stats-${venueCode}-${motorNumber}`
        : `venue-motor-stats-asof-${venueCode}-${motorNumber}-${asOfDate}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return null;
        }

        // このメソッドはRaceDetailの機力指数・モーター調子ドリルダウンの
        // Promise.allに同居させて呼ぶ想定のため、例外（クライアントの .throwOnError()）が
        // Promise.all全体を巻き込んで他の取得済みデータまで消さないよう、内部で捕まえる。
        // ただし null（行なし）には倒さず、失敗と分かる値を返す（BOA-740）
        const failed = { fetchFailed: true };
        try {
          const { data } = await supabase
            .from("venue_motor_stats")
            .select("*")
            .eq("venue_code", venueCode)
            .eq("motor_number", motorNumber)
            .lte("scraped_date", asOfDate ?? "9999-12-31")
            .order("scraped_date", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!data) return null;

          return {
            scrapedDate: data.scraped_date,
            meetCount: data.meet_count,
            raceCount: data.race_count,
            finalCount: data.final_count,
            championshipCount: data.championship_count,
            firstPlaceCount: data.first_place_count,
            secondPlaceCount: data.second_place_count,
            thirdPlaceCount: data.third_place_count,
            winRate: data.win_rate,
            top2Rate: data.top2_rate,
            top3Rate: data.top3_rate,
            accidentRate: data.accident_rate,
            bestTime: data.best_time,
            avgExhibitionTime: data.avg_exhibition_time,
            statsPeriodStart: data.stats_period_start,
            statsPeriodEnd: data.stats_period_end,
          };
        } catch (err) {
          console.error("venue_motor_stats取得エラー(例外):", err.message);
          return failed;
        }
      },
    );
  }

/**
 * 指定レースの枠番別モーター調子（2連率/3連率）を取得する（BOA-151）
 * 「このレースのどの艇のモーターが調子いいか」を直接示す
 * venueCodeを渡すと各艇のモーターの機力指数（BOA-265）も合わせて取得する
 *
 * ## 前検タイムと「節時点の公式2連率」（BOA-451 / FR-4a）
 *
 * この関数が返す `motor_2rate` は**選択期間（過去90日・直近1ヶ月）で再計算した値**に
 * 差し替えている（下の注記）。一方、出走表に印刷され他サイトにも載っている
 * 「モーター2連対率」は**節の開始時点（前検日）の公式値**で、両者は別物。
 * 同じタブの中で見比べられないと「なぜ基本情報タブと数字が違うのか」になるため、
 * 差し替え前の公式値を `official_2rate` として残す（**追加クエリ0本**。
 * `race_entries` から既に取っている値をそのまま持ち回るだけ）。
 *
 * 前検タイム（`pretest_time` / `pretest_rank`）は機力の**起点**で、
 * `motor_pretest_stats` から**1クエリ**で節の全選手分を引く。
 *
 * 行の選び方（実測で決めた。2026-09-28）:
 *   同じ会場・同じ選手で `race_date <= 表示レースの日付` かつ `>= 日付 - 6日` の
 *   **最新の行**を採る。理由は3つとも実データで確かめた。
 *     1. 節の中で `pretest_time` / `pretest_rank` が変わる例は **0件**
 *        （31,268の連続区間すべてで単一値）。どの行を採っても値は同じ
 *     2. 6日ルックバックで、**その日に走る選手について前の節の行を引く例は0件**
 *        （2026年1月〜9月の出走241,427件。採った行のモーター番号が
 *        `race_entries.motor_number` と食い違う例も9月の24,842件で0件）。
 *        返るMap自体には「前の節にしか出ていない選手」の行が残ることはあるが、
 *        引き当てには使われない（詳細は `src/utils/pretestRows.js`）
 *     3. 日付完全一致だけだと当たるのは30.9%（節の中の一部の日にしか行が無い）。
 *        6日ルックバックで94.6%に上がる
 *   今節タブ（`getMeetScoreboard`）は「節の最も古い行」を採るが、1の理由で
 *   両者は必ず同じ値になる。`npm run verify:pretest-row-pick` がこの不変条件を守る
 *
 * ## 過去レースは出走表時点の公式値（BOA-329、2026-09-29 ユーザー判断(c)）
 *
 * 再計算（機力指数・期間の2連率）は「今日から遡るN日」の集計なので、過去レースに
 * 使うとレース後のデータが混ざり、入れ替え前のレースでは別モーターの成績になる。
 * そのため過去レース（race_idの日付 < 今日JST）では再計算をせず、
 * - motor_2rate / motor_3rate は race_entries の値（そのレース時点の公式値）のまま
 * - power_index は null（公式に相当する値が無い。画面は「—」と注記）
 * - 優出・優勝・1着率は、レース日以前で最新の venue_motor_stats（公式サイトの
 *   その時点のスナップショット）。無ければ null
 * とし、rate_source: "official" を付ける（当日以降は "recalc"）。
 * 当日のレースの再計算は、期間を現行モーターの世代で切り詰める（getMotorPowerIndex）
 *
 * 戻り値は `{ rows, fetchFailed? }`。会場公式サイトのモーター成績（優出・優勝・1着率・出走数）の取得に
 * 失敗した行は `venue_stats_failed: true` を付け、そのときは fetchFailed を付けて withCache に保存させない
 * （BOA-740。他の列は出し、その列だけ「取得失敗」と表示する）
 * @returns {Promise<{rows: Array<Object>, fetchFailed?: boolean}>}
 */
export function getRaceMotorBreakdown(raceId, venueCode = null, days = 90) {
    const past = isPastRace(raceId);
    return withCache(
      // raceIdを末尾に置く: inferTtlFromKey()は末尾の「YYYY-MM-DD-会場-レース番号」
      // パターンで過去レースを検知し7日キャッシュを付与する。venueCode/daysを
      // 末尾に付けるとこのパターンにマッチしなくなり、過去レースでも30分キャッシュに
      // 格下げされてしまうため、raceIdより前に置く。
      // v2: motor_2rate/3rateを選択期間に応じた値に差し替えるよう変更(BOA-283)。
      // v3: 優出回数・優勝回数・1着率を追加(BOA-264追加調査、日和比較)。
      // v4: 前検タイム・前検順位・公式2連率（節時点）を追加(BOA-451)。
      // 旧キーのままだと古いキャッシュが新フィールド無しの形状のまま返る
      // （過去レースは7日TTLなので、上げ忘れると1週間「前検」列が出ない）
      // v5: 過去レースは公式値（rate_source）、当日は世代で切り詰め（BOA-329）。
      // 過去/当日をキーに含める: 当日に保存した再計算の値が、日付が変わって
      // 過去レース扱い（7日TTL）になった後も読まれ続けないようにする
      // v6: 当日のレースの行に sample_count（初下ろしの判定）を追加（BOA-513）
      // v7: 当日のレースの行に official_3rate（「集計前」の判定）を追加
      // v8: 過去レースの行にも official_3rate を追加し、当日の機力指数を
      //     「このレースの直前まで」にした（BOA-557）
      // v9: 前検の取得失敗を空の前検として保存しないようにした（BOA-686）。v8 には、失敗が
      //     「前検なし」として最長7日残っている可能性があるため読まない
      // v10: 戻り値を { rows, fetchFailed? } にし、会場公式のモーター成績の取得失敗を行に印として残す
      //     （BOA-740）。v9 は配列の形で、失敗も「成績なし」として最長7日残っている可能性があるため読まない
      // v11: 新しいモーターの最初の開催向けに、自前の値（generation_*）・前の節までの走数
      //     （prior_meet_runs）・freshness を追加（BOA-830）。v10 には無い列なので読まない
      `race-motor-breakdown-v11-${past ? "official" : "recalc"}-${venueCode}-${days}-${raceId}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return { rows: [] };
        }

        const { data } = await supabase
          .from("race_entries")
          .select(
            "boat_number, player_name, racer_id, motor_number, motor_2rate, motor_3rate",
          )
          .eq("race_id", raceId)
          .order("boat_number");

        const rows = data ?? [];
        if (venueCode === null) return { rows };
        // 新しいモーターの最初の開催で、公式の2連率が 0 の艇に出す自前の値（BOA-830）。
        // 過去レース・当日のレースで同じ値を足す
        const freshPromise = getRaceMotorFreshness(
          raceId,
          venueCode,
          rows,
        );
        // 会場公式のモーター成績が1艇でも取れなかったら、結果を保存させない（BOA-740）。
        // 自前の値の材料（使用開始日・節の初日）が取れなかったときも同じ（BOA-830）
        const settle = async (out) =>
          settleMotorBreakdown(out, await freshPromise);

        if (past) {
          const raceDate = raceId.slice(0, 10);
          const [statsAsOf, pretestAsOf] = await Promise.all([
            Promise.all(
              rows.map((row) =>
                getVenueMotorStats(venueCode, row.motor_number, raceDate),
              ),
            ),
            fetchPretestByRacer(venueCode, raceDate),
          ]);
          const out = pastMotorRows(rows, statsAsOf, pretestAsOf);
          return await settle(out);
        }

        const [powerIndexes, venueMotorStatsList, pretestByRacer] =
          await Promise.all([
            Promise.all(
              // このレースの直前まで（BOA-557）。終了後に開いてもそのレース自身の
              // 結果を含めず、翌日に開いたときと数字をそろえる
              rows.map((row) =>
                getMotorPowerIndex(
                  venueCode,
                  row.motor_number,
                  days,
                  raceId,
                ),
              ),
            ),
            Promise.all(
              rows.map((row) =>
                getVenueMotorStats(venueCode, row.motor_number),
              ),
            ),
            fetchPretestByRacer(venueCode, raceId.slice(0, 10)),
          ]);
        // 2連率/3連率も選択中の期間（過去90日/直近1ヶ月）に応じた値に差し替える
        // （組み立ては src/pure/raceMotorBreakdown.js の recalcMotorRows）
        const out = recalcMotorRows(
          rows,
          powerIndexes,
          venueMotorStatsList,
          pretestByRacer,
        );
        return await settle(out);
      },
    );
  }

/**
 * 指定会場・モーター番号が「優勝戦」で実際に1着になった日付・選手を
 * 取得する（BOA-264追加調査、BOA-226のrace_stage列が前提）。
 * venue_motor_statsの優勝数は公式サイト側の集計期間内の合計回数のみで
 * 日付・選手の内訳が無いため、自社データ（race_conditions.race_stage=
 * 優勝戦を含む×race_entries×race_results）から逆算する。
 * race_stageはBOA-226実装後に取得したレースに入るほか、BOA-347の
 * scripts/maintenance/backfill-race-conditions.js で過去分も遡及取得している
 * （2025-12〜2026-02-02分を2026-09-28に実施する方針）。
 *
 * モーターは会場ごとに概ね年1回入れ替わり、番号は再利用されるため、
 * 現行モーターの世代（venue_motor_start_datesの最新の使用開始日以降）の
 * レースに限る。使用開始日が取れない会場（行が無い）は、別モーターの記録を
 * 混ぜないよう履歴を出さず generationStart: null を返す。
 * @returns {Promise<{generationStart: string|null, wins: Array<{raceId:string,date:string,racerId:number|null,playerName:string|null}>, fetchFailed?: boolean}>}
 */
export function getVenueMotorChampionshipHistory(
    venueCode,
    motorNumber,
    beforeRaceId = null,
  ) {
    return withCache(
      // 戻り値を配列から{generationStart, wins}に変えたため、キーを変えて
      // localStorageに残る旧形式（配列）を読まない
      `venue-motor-championship-generation-${venueCode}-${motorNumber}${beforeKey(beforeRaceId)}`,
      async () => {
        const failed = { generationStart: null, wins: [], fetchFailed: true };
        if (!supabase) {
          console.error("Supabase client not initialized");
          return failed;
        }
        try {
          const generationStart = await getMotorGenerationStart(venueCode);
          if (generationStart === null) return { generationStart, wins: [] };

          const { data: stageRows } = await supabase
            .from("race_conditions")
            .select("race_id, race_stage, races!inner(venue_code)")
            // 「優勝戦」で終わるものをDBで粗く絞り、「準優勝戦」「準々優勝戦」の
            // 除外は `isFinalStage` に任せる。完全一致だと会場固有の接頭が付く
            // 「ツッキー優勝戦」「ＭＤ優勝戦」「団体・優勝戦」を取りこぼす
            // （旧コメントは「優勝戦/準優勝戦の2値のみ」と書いていたが、
            //  実データの race_stage は349種あった。BOA-457）
            .like("race_stage", "%優勝戦")
            .eq("races.venue_code", venueCode);
          const raceIds = (stageRows ?? [])
            .filter((r) => isFinalStage(r.race_stage))
            .map((r) => r.race_id)
            .filter((raceId) => isInMotorGeneration(raceId, generationStart))
            // 過去レースのドリルダウンは、そのレースより前の優勝に限る（BOA-521）
            .filter((raceId) => beforeRaceId === null || raceId < beforeRaceId);
          if (raceIds.length === 0) return { generationStart, wins: [] };

          const { data: entries } = await supabase
            .from("race_entries")
            .select("race_id, boat_number, racer_id, player_name")
            .in("race_id", raceIds)
            .eq("motor_number", motorNumber);
          if (!entries || entries.length === 0) {
            return { generationStart, wins: [] };
          }

          const { data: results } = await supabase
            .from("race_results")
            .select("race_id, rank1")
            .in(
              "race_id",
              entries.map((e) => e.race_id),
            );
          const rank1ByRaceId = new Map(
            (results ?? []).map((r) => [r.race_id, r.rank1]),
          );

          const wins = entries
            .filter((e) => rank1ByRaceId.get(e.race_id) === e.boat_number)
            .map((e) => ({
              raceId: e.race_id,
              date: e.race_id.slice(0, 10),
              racerId: e.racer_id,
              playerName: e.player_name,
            }))
            .sort((a, b) => b.date.localeCompare(a.date));
          return { generationStart, wins };
        } catch (err) {
          // 権限エラー（使用開始日が読めない）は getMotorGenerationStart が
          // null（世代不明）に倒すため、ここに来るのは取得失敗だけ
          console.error("優勝履歴取得エラー(例外):", err.message);
          return failed;
        }
      },
    );
  }

/**
 * 会場の全モーターの会場公式サイトの成績（`venue_motor_stats`）を、1つのスナップショット
 * （その日以前で最新の `scraped_date`）で返す（BOA-428）。2クエリ、会場×日付でキャッシュ。
 *
 * 戻り値は3通り。「無い」と「失敗」を分けるのは、失敗を「データの無い会場」と取り違えて、
 * 違う出典の一覧に差し替えないため（BOA-428 設計レビュー）:
 *   - `{ state: "ok", scrapedDate, rows }`
 *   - `{ state: "empty" }` … 会場にデータが無い（戸田・平和島）、またはその日以前に無い
 *   - `{ state: "error", fetchFailed: true }` … 取得の失敗。fetchFailed なので withCache は保存しない
 * 例外は投げない（ドリルダウンの Promise.all を巻き込まない）。
 * 浜名湖・宮島を出さない判断（VENUE_SITE_STATS_HIDDEN）は呼び出し側で行う。既存のドリルダウン
 * （getVenueMotorRanking）の表示は変えないため
 * @param {number} venueCode
 * @param {string|null} asOfDate YYYY-MM-DD。null なら最新
 */
export function getVenueMotorSnapshot(venueCode, asOfDate = null) {
    return withCache(
      `venue-motor-snapshot-v1-${venueCode}-${asOfDate ?? "latest"}`,
      async () => {
        const failed = { state: "error", fetchFailed: true };
        if (!supabase) {
          console.error("Supabase client not initialized");
          return failed;
        }
        try {
          const { data: latestRow } = await supabase
            .from("venue_motor_stats")
            .select("scraped_date")
            .eq("venue_code", venueCode)
            .lte("scraped_date", asOfDate ?? "9999-12-31")
            .order("scraped_date", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!latestRow) return { state: "empty" };

          const { data } = await supabase
            .from("venue_motor_stats")
            .select(
              "motor_number, win_rate, top2_rate, top3_rate, accident_rate, final_count, championship_count, race_count, stats_period_end",
            )
            .eq("venue_code", venueCode)
            .eq("scraped_date", latestRow.scraped_date);
          if (!data || data.length === 0) return { state: "empty" };
          return {
            state: "ok",
            scrapedDate: latestRow.scraped_date,
            rows: data,
          };
        } catch (err) {
          console.error("venue_motor_stats取得エラー(例外):", err.message);
          return failed;
        }
      },
    );
  }
