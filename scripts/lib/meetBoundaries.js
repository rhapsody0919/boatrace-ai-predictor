/**
 * 節（開催）の切り出しと、全レースの一括取得。
 *
 * 得点率は**予選終了時点で確定**する（公式の得点率一覧が「◯日目12R終了時点」で
 * 止まる）。そのため「どこまでが予選か」を節ごとに出す必要があるが、節の境目は
 * `race_id` だけでは分からない（同じ会場で前節と翌節が連続する）。
 * `race_conditions.series_day`（何日目か）が1に戻るところを節の始まりとして使う。
 *
 * scripts/ 側の分析・検証でだけ使う。画面側は `getMeetScoreboard` が表示中レースの
 * 節だけを引くので、節の切り出し自体が要らない。予選の締めの判定は
 * `src/components/race/seriesPoints.js` の `prelimEndRaceIdOf` を共有する
 * （同じ判定を2つ持たない。BOA-457）。
 *
 * 節内のグルーピングは `src/utils/meetGrouping.js` の `groupIntoCurrentMeet`
 * （表示中レースから遡って今節だけを取る）とは用途が違う。こちらは
 * **全期間の全節を列挙する**ためのもの。
 */
import { parseRaceId } from "../../src/utils/raceId.js";
import { prelimEndRaceIdOf } from "../../src/components/race/seriesPoints.js";

/**
 * `race_conditions` の行を節ごとにまとめる。
 *
 * @param {Array<{race_id: string, race_stage: string|null, series_day: number|null,
 *   is_final_day: boolean|null}>} conds `race_id` 昇順でなくてもよい
 * @returns {Array<{venueCode: number, dates: string[], rows: Array<Object>,
 *   prelimEndRaceId: string|null}>}
 */
export function buildMeets(conds) {
  const byVenue = new Map();
  for (const row of conds) {
    const parsed = parseRaceId(row.race_id);
    if (!parsed) continue;
    if (!byVenue.has(parsed.venueCode)) byVenue.set(parsed.venueCode, []);
    byVenue.get(parsed.venueCode).push(row);
  }

  const meets = [];
  for (const [venueCode, rows] of byVenue) {
    rows.sort((a, b) => a.race_id.localeCompare(b.race_id));
    // 日ごとに畳んでから、series_day が増えていない日を節の始まりとする
    const days = new Map();
    for (const row of rows) {
      const d = row.race_id.slice(0, 10);
      if (!days.has(d)) days.set(d, []);
      days.get(d).push(row);
    }
    let current = null;
    let prevDay = null;
    for (const [d, dayRows] of [...days.entries()].sort()) {
      const seriesDay = dayRows.find((r) => r.series_day != null)?.series_day;
      const prevFinal = prevDay?.some((r) => r.is_final_day) ?? false;
      // series_day が無い日（実データで0.4%）は日付の連続で判定する。
      // **同じ日目が翌日に続くのは順延で、節の続き**（BOA-506）。公式は丸一日中止の
      // 翌日に同じ日目を振り直す（江戸川・戸田 9/21→22 が 4→4、津 9/22→23 が 2→2）。
      // 以前は `<=` で新しい節にしていて、中止の日で節を2つに割り、前半の予選の締めを
      // 早い日で確定させていた。日付が空いた同値は、従来どおり別の節とする
      const last = current?.lastSeriesDay ?? 0;
      const isNewMeet =
        current === null ||
        prevFinal ||
        (seriesDay != null &&
          (seriesDay < last ||
            (seriesDay === last && !isNextDay(current.dates.at(-1), d)))) ||
        (seriesDay == null && !isNextDay(current.dates.at(-1), d));
      if (isNewMeet) {
        current = { venueCode, dates: [], rows: [], lastSeriesDay: null };
        meets.push(current);
      }
      current.dates.push(d);
      current.rows.push(...dayRows);
      if (seriesDay != null) current.lastSeriesDay = seriesDay;
      prevDay = dayRows;
    }
  }

  for (const m of meets) {
    delete m.lastSeriesDay;
    m.prelimEndRaceId = prelimEndRaceIdOf(m.rows);
  }
  return meets;
}

/**
 * `race_id` をキーにした追跡ページング。
 *
 * `supabaseClient.js` の `fetchAll` は `range(offset, …)` で送るため、
 * `race_conditions`（3.6万行）や `race_entries`（28万行）を全件引くと後半の
 * ページで15秒のfetchタイムアウトに当たる。最後に読んだ `race_id` より大きい
 * ものを1000行ずつ取る形にするとオフセットが伸びず一定時間で返る。
 *
 * **`race_id` は一意とは限らない**（`race_entries` は1レース6行）。ページの
 * 境目が同じ `race_id` の途中に落ちると、単純に「最後の行のIDより大きいもの」
 * を次のページの起点にした時点で**残りの行が黙って捨てられる**。1000は6の
 * 倍数でないので毎ページ起きる（実測: `race_entries` 281,664行に対し274行の
 * 欠落。1レースが4行しか取れず、その節の選手2名の走数が1つ減っていた）。
 * そのため**末尾の `race_id` のぶんは丸ごと捨てて次のページで取り直す**。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} table
 * @param {string} select `race_id` を必ず含めること
 * @param {{pageSize?: number}} [options] `pageSize` はテスト用
 * @returns {Promise<Array<Object>>} `race_id` 昇順
 */
export async function fetchAllByRaceId(client, table, select, options = {}) {
  const pageSize = options.pageSize ?? 1000;
  const all = [];
  let cursor = "";
  for (;;) {
    // 15秒でfetchを中断する仕組み（undiciが無期限にハングする既知の不具合への
    // 対策）が入っているため、30回以上のリクエストのうち1回が中断されるだけで
    // 落ちる。ページ単位で3回まで再試行する
    let data = null;
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await client
        .from(table)
        .select(select)
        .gt("race_id", cursor)
        .order("race_id")
        .limit(pageSize);
      if (!res.error) {
        data = res.data;
        lastError = null;
        break;
      }
      lastError = res.error;
    }
    if (lastError) throw new Error(`${table}取得エラー: ${lastError.message}`);
    if (!data || data.length === 0) break;
    if (data.length < pageSize) {
      // 最後のページ。途中で切れていないのでそのまま足す
      all.push(...data);
      break;
    }
    // 満杯のページは末尾の `race_id` が途中で切れている可能性がある。
    // その `race_id` の行は捨てて、次のページで最初から取り直す
    const lastId = data[data.length - 1].race_id;
    const complete = data.filter((r) => r.race_id !== lastId);
    if (complete.length === 0) {
      // 1つの `race_id` が1ページに収まらない。この方式では進めないので、
      // 黙って取りこぼすのではなく落とす
      throw new Error(
        `${table}: race_id=${lastId} の行が ${pageSize} 件を超えるためページングできない`,
      );
    }
    all.push(...complete);
    cursor = complete[complete.length - 1].race_id;
  }
  return all;
}

function isNextDay(prev, next) {
  if (!prev) return false;
  const p = new Date(`${prev}T00:00:00Z`);
  p.setUTCDate(p.getUTCDate() + 1);
  return p.toISOString().slice(0, 10) === next;
}
