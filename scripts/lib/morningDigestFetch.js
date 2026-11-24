/** generate-morning-digest.js から字のまま移した DB の読み（ページング・レース・出走表・モーター・選手の成績・基準・コース別1着率・荒れ度）と日付の線。書かない */

import { supabase } from "./supabaseClient.js";
import {
  buildCourseWinNotes,
  courseWinRowsFromJson,
} from "../../src/utils/todayCourseWin.js";

/** PostgRESTの1ページあたりの行数 */
const PAGE_SIZE = 1000;

/**
 * 選手集計（racer_course_technique_stats.window_end）に許容する遅れの日数。
 *
 * 2 なのは構造上の下限。前日ぶんの進入コースが埋まるのは Kファイル同期の当日 JST 07:00 で、
 * 夜間集計（JST 01:10）はそれより前に走るため、window_end は必ず「前々日」までになる。
 * 1 にすると永久に満たせない（2026-09-25 に本番で発生）。
 * 3 以上にすると「集計が止まっている」という本来検知したい異常を見逃す。
 *
 * 影響: 朝の時点の選手集計には前日のレースが入っていない。集計窓は約295日・
 * 1選手1コースあたり中央値26走なので、1日ぶん（最大1〜2走）の欠落は実質的に無視できる。
 */
const STATS_MAX_LAG_DAYS = 2;

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/**
 * `.range()` によるページ分割取得。
 *
 * ⚠️ 呼び出し側は必ず `.order()` を付けること。ORDER BY の無い LIMIT/OFFSET は
 * 行順が保証されず、ページ間で同じ行が重複したり抜けたりしうる。
 * 1チャンク200レース × 6艇 = 1200行のように、2ページ以上になるクエリが実際にある。
 */
async function fetchAll(buildQuery) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) throw new Error("配列が返りませんでした");
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

// ---------------------------------------------------------------------------
// 取得
// ---------------------------------------------------------------------------

async function fetchRaces(date) {
  return fetchAll((from, to) =>
    supabase
      .from("races")
      .select("race_id, venue_code, race_number, start_time, race_grade")
      .eq("race_date", date)
      .order("race_id", { ascending: true })
      .range(from, to),
  );
}

/**
 * @param {string[]} raceIds
 * @param {{includeAbsent?: boolean}} [opts] 帰郷判定では欠場者も名簿に含める。
 *   欠場（is_absent）は帰郷の前段であることが多く、除外すると**帰郷した選手そのものを
 *   取りこぼす**（2026-09-24の実測: 黄金井力良（津、racer_id=4432）が 9/23 に
 *   is_absent=true で、除外すると帰郷が6名になり競合掲載の7名と合わなかった）。
 *   指標セクション（逃げ・まくり・逃がし）は「本日走る選手」が対象なので除外する。
 */
async function fetchEntries(raceIds, { includeAbsent = false } = {}) {
  const all = [];
  for (let i = 0; i < raceIds.length; i += 200) {
    const chunk = raceIds.slice(i, i + 200);
    const rows = await fetchAll((from, to) =>
      supabase
        .from("race_entries")
        .select(
          "race_id, boat_number, racer_id, player_name, grade, motor_number, motor_2rate, is_absent",
        )
        .in("race_id", chunk)
        .order("race_id", { ascending: true })
        .order("boat_number", { ascending: true })
        .range(from, to),
    );
    all.push(...rows);
  }
  return all.filter(
    (e) => e.racer_id !== null && (includeAbsent || !e.is_absent),
  );
}

/**
 * 会場公式のモーター出走数（venue_motor_stats.race_count）を、対象日以前で最新のスナップショットから引く（BOA-702）。
 * データ出走表の getVenueMotorStats(venueCode, motorNumber, asOfDate) と同じ条件。
 * 1件ずつ引くのは、会場によってスナップショットの日がモーターごとにずれうるため（会場単位で最新日を決めると、
 * その日に載っていないモーターを「分からない」にしてしまう）。対象は1日数十艇。
 *
 * 取得に失敗したモーターは Map に入れない（＝分からない。画面は従来どおり 0.0% を出す）。生成自体は止めない
 * （この列は表示の補助で、他の列の正しさには関わらないため）。失敗数は戻り値で返し、呼び出し側が記録する。
 *
 * @param {string} date 対象日（YYYY-MM-DD）
 * @param {Array<{venue_code: number, motor_number: number}>} targets
 * @returns {Promise<{counts: Map<string, number|null>, failed: number}>} キーは `${venue_code}|${motor_number}`。
 *   値が null は「スナップショットはあるが出走数の列が空（その会場のサイトに出走数が無い）」
 */
export async function fetchMotorRaceCounts(date, targets) {
  const keys = [
    ...new Set(targets.map((t) => `${t.venue_code}|${t.motor_number}`)),
  ];
  const counts = new Map();
  let failed = 0;
  for (let i = 0; i < keys.length; i += 20) {
    await Promise.all(
      keys.slice(i, i + 20).map(async (key) => {
        const [venueCode, motorNumber] = key.split("|").map(Number);
        const { data, error } = await supabase
          .from("venue_motor_stats")
          .select("race_count")
          .eq("venue_code", venueCode)
          .eq("motor_number", motorNumber)
          .lte("scraped_date", date)
          .order("scraped_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) {
          failed += 1;
          console.warn(
            `  ⚠️ venue_motor_stats の取得に失敗（会場${venueCode} モーター${motorNumber}）: ${error.message}`,
          );
          return;
        }
        if (data) counts.set(key, data.race_count ?? null);
      }),
    );
  }
  return { counts, failed };
}

async function fetchRacerStats(racerIds) {
  const unique = [...new Set(racerIds)];
  const all = [];
  for (let i = 0; i < unique.length; i += 300) {
    const chunk = unique.slice(i, i + 300);
    const rows = await fetchAll((from, to) =>
      supabase
        .from("racer_course_technique_stats")
        .select("*")
        .in("racer_id", chunk)
        .order("racer_id", { ascending: true })
        .order("course", { ascending: true })
        .range(from, to),
    );
    all.push(...rows);
  }
  return all;
}

async function fetchBaseline() {
  return fetchAll((from, to) =>
    supabase
      .from("venue_course_technique_baseline")
      .select("*")
      .range(from, to),
  );
}

/**
 * /today の X 投稿の型 b の材料（級別の全国のコース別1着率と今日の選手のコース別の1着数、RPC 183）。
 * 窓は前々日まで（STATS_MAX_LAG_DAYS と同じ理由）。関数がまだ無い（マイグレーション 183 の適用前）・読めないときは
 * 一覧の生成を止めず、notes.courseWin を unavailable にする（/today は型 a で送り、Slack の知らせに理由が出る）。
 * notes（匿名でも読める）には理由のコードだけを入れ、エラーの本文はログにだけ出す（system-architect の審査 P3）
 */
export async function fetchCourseWin(
  date,
  races,
  entries,
  rpc = (args) => supabase.rpc("compute_today_course_win_stats", args),
) {
  const until = addDays(date, -STATS_MAX_LAG_DAYS);
  const racerIds = [...new Set(entries.map((e) => e.racer_id))];
  const unavailable = (reason, message) => {
    console.error(
      `  ⚠️ コース別1着率の材料を作れない（${reason}: ${message}）。/today の型 b は出さない`,
    );
    return { v: 1, status: "unavailable", reason };
  };
  const startedMs = Date.now();
  const { data, error } = await rpc({
    p_until: until,
    p_racer_ids: racerIds,
  });
  if (error)
    return error.code === "PGRST202"
      ? unavailable("rpc_missing", "関数が無い。マイグレーション183が未適用")
      : unavailable("rpc_error", error.message);
  // 窓が全期間なので、時間はデータとともに伸びる。通信を含むこの値が6秒を超えたら窓の上限を入れて見直す（183 の注記）
  console.log(`  コース別1着率の RPC: ${Date.now() - startedMs}ms`);
  try {
    return buildCourseWinNotes({
      races,
      entries,
      rpcRows: courseWinRowsFromJson(data),
      until,
    });
  } catch (buildError) {
    // 材料の形が想定と違う（窓がそろわない等）。一覧の a の材料は壊さず、型 b だけを止める
    return unavailable("build_error", buildError.message);
  }
}

/**
 * イン崩れ指数。**0〜1で保存されているので ×100 して返す**（plan.md §2.2、レビュー指摘H-1）。
 * volatilityPercentileIsFallback（会場内サンプル不足のプレースホルダ）の行は除外する。
 * predictions が未生成でも落とさない（plan.md §3.2、レビュー指摘H-7）。
 */
async function fetchVolatility(raceIds) {
  const map = new Map();
  for (let i = 0; i < raceIds.length; i += 200) {
    const chunk = raceIds.slice(i, i + 200);
    const rows = await fetchAll((from, to) =>
      supabase
        .from("predictions")
        .select("race_id, feature_contributions")
        .eq("model_id", "unified")
        .in("race_id", chunk)
        .order("race_id", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) {
      const fc = r.feature_contributions;
      const p = fc?.volatilityPercentile;
      if (typeof p !== "number") continue;
      if (fc?.volatilityPercentileIsFallback) continue;
      map.set(r.race_id, Math.round(p * 100 * 100) / 100);
    }
  }
  return map;
}

/**
 * イン崩れ注意度（BOA-822）。朝の unified の feature_contributions.inCaution の pct・n・level をそのまま写す
 * （画面に出す%と段を同じ整数から出す。plan §1・§5）。値の無いレース（中止・1号艇の欠場・sparse_cell 等）は Map に入れない。
 */
async function fetchInCaution(raceIds) {
  const map = new Map();
  for (let i = 0; i < raceIds.length; i += 200) {
    const chunk = raceIds.slice(i, i + 200);
    const rows = await fetchAll((from, to) =>
      supabase
        .from("predictions")
        .select("race_id, feature_contributions")
        .eq("model_id", "unified")
        .in("race_id", chunk)
        .order("race_id", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) {
      const ic = r.feature_contributions?.inCaution;
      if (!ic || typeof ic.pct !== "number") continue;
      map.set(r.race_id, { pct: ic.pct, n: ic.n, level: ic.level });
    }
  }
  return map;
}

/** レースごとの当日の値（旧のイン崩れ指数と注意度）。注目レースの方向一致度と行の列に使う */
async function fetchRaceSignals(raceIds) {
  const [volatilityMap, inCautionMap] = await Promise.all([
    fetchVolatility(raceIds),
    fetchInCaution(raceIds),
  ]);
  return { volatilityMap, inCautionMap };
}

export {
  STATS_MAX_LAG_DAYS,
  addDays,
  fetchAll,
  fetchRaces,
  fetchEntries,
  fetchRacerStats,
  fetchBaseline,
  fetchVolatility,
  fetchInCaution,
  fetchRaceSignals,
};
