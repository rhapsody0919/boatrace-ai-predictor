/**
 * アナロジー・ファインダー v16 の展示後の段（BOA-271 tasks T4-2・T4-3。plan「展示後の段」）。
 *
 * 朝のバッチ（出走表の段）が作った候補ファイルを、今日の展示の値で並べ直し、Storage の非公開のバケット analogy-v16 の
 * `{日付}/{実行ID}/` に similar-exhibition・today-exhibition を書いてから、analogy_v16_snapshots（stage=exhibition）を
 * 書く（ON CONFLICT DO NOTHING。重複して動いても1回）。欠場が分かったレースは status='absent' だけを書く。
 *
 * 対象: 今日のレースのうち、racecard の snapshot があり、exhibition の snapshot が無く、締切前で、6艇の展示タイムが
 * そろったか欠場が分かったもの（1回の起動で最大 MAX_RACES 件。残りは次の起動）。
 * モード（scrape_job_state の job='analogy_v16_exhibition'）: off は何もしない、shadow は計算だけ、live は書く。
 */
import {
  deadlineOf,
  objectPath,
  readObject,
  rest,
  writeObject,
} from "../../api/_lib/analogyV16.js";
import { buildLiveFeatures } from "../../src/utils/analogyRaceFeatures.js";
import {
  entryType,
  exhibitionForms,
  signedSt,
  windBand,
} from "../../src/utils/analogyScenario.js";
import {
  EXHIBITION_ITEMS,
  exhibitionItemLevels,
  exhibitionPoolRate,
  poolExhDiffs,
  rerankSimilar,
} from "../../src/utils/analogySimilarRerank.js";

export const MAX_RACES = 20;
const BOATS = [1, 2, 3, 4, 5, 6];

const toJstDate = (d) =>
  new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * 対象のレース（純粋関数）
 * @param {{race_id:string, stage:string, status:string}[]} snaps 今日の snapshot
 * @param {{race_id:string, race_date:string, start_time:string|null}[]} races
 * @param {{race_id:string, boat_number:number, exhibition_time:number|null, is_absent:boolean|null}[]} exh
 * @param {{race_id:string, is_absent:boolean|null}[]} entries
 * @param {Date} now
 */
export function selectExhibitionTargets(snaps, races, exh, entries, now) {
  const racecard = new Set(
    snaps.filter((s) => s.stage === "racecard").map((s) => s.race_id),
  );
  const done = new Set(
    snaps.filter((s) => s.stage === "exhibition").map((s) => s.race_id),
  );
  const absent = new Set(
    [...exh, ...entries].filter((r) => r.is_absent).map((r) => r.race_id),
  );
  const timed = new Map();
  for (const r of exh)
    if (r.exhibition_time !== null && !r.is_absent)
      timed.set(r.race_id, (timed.get(r.race_id) ?? 0) + 1);
  return races
    .filter((r) => racecard.has(r.race_id) && !done.has(r.race_id))
    .filter((r) => {
      const deadline = deadlineOf(r);
      return deadline !== null && deadline.getTime() > now.getTime();
    })
    .filter((r) => absent.has(r.race_id) || timed.get(r.race_id) === 6)
    .sort((a, b) => (a.start_time < b.start_time ? -1 : 1))
    .map((r) => ({
      race_id: r.race_id,
      absent: absent.has(r.race_id),
      deadline: deadlineOf(r),
    }));
}

/**
 * 今日の展示の値（today-exhibition。T4-2）: 展示タイムと順位、風速区分、展示の進入の型、展示 ST（F は負）と
 * 展示の形（F.05 までは .00 として判定、F.06 以上か出遅れの艇がいれば判定しない。Q-F6）
 * @param {object[]} exhRows exhibition_data の6行
 * @param {object} live buildLiveFeatures の6艇
 * @param {object} cond race_conditions の行
 */
export function todayExhibition(exhRows, live, cond) {
  const byBoat = new Map(exhRows.map((r) => [Number(r.boat_number), r]));
  const course = BOATS.map((b) => {
    const c = byBoat.get(b)?.exhibition_course;
    return c === null || c === undefined ? null : Number(c);
  });
  const stByCourse = [null, null, null, null, null, null];
  BOATS.forEach((b, i) => {
    const r = byBoat.get(b);
    const st = r?.start_timing;
    if (course[i] && st !== null && st !== undefined)
      stByCourse[course[i] - 1] = signedSt(Number(st), r.start_flag === "F");
  });
  const hasLate = BOATS.some((b) => byBoat.get(b)?.start_flag === "L");
  const { forms, excluded } = exhibitionForms(stByCourse, hasLate);
  return {
    exh_time: live.map((v) => (Number.isNaN(v.exh_time) ? null : v.exh_time)),
    exh_time_rank: live.map((v) =>
      Number.isNaN(v.exh_time_rank) ? null : v.exh_time_rank,
    ),
    exh_time_diff: live.map((v) =>
      Number.isNaN(v.exh_time_diff) ? null : v.exh_time_diff,
    ),
    weather_code: Number.isNaN(live[0]?.weather_code)
      ? null
      : (live[0]?.weather_code ?? null),
    wind_x: Number.isNaN(live[0]?.wind_x) ? null : (live[0]?.wind_x ?? null),
    wind_y: Number.isNaN(live[0]?.wind_y) ? null : (live[0]?.wind_y ?? null),
    wind_speed: cond?.wind_speed ?? null,
    wave_height: cond?.wave_height ?? null,
    wind_band: windBand(cond?.wind_speed ?? null),
    course_by_boat: course,
    entry_type: entryType(course),
    st_by_course: stByCourse,
    forms,
    // F.06 以上か出遅れの艇がいるので展示の形を判定しなかった（Q-F6）
    forms_excluded: excluded,
  };
}

/**
 * 並べ直した上位に、33項目（展示で決まる5項目は今日の展示で判定し直す）と結果と、表示用の値（similar-display の列。
 * 無ければ付けない）を付ける
 */
export function exhibitionNeighbors(file, reranked, today, display = null) {
  const index = new Map(file.candidates.map((id, c) => [id, c]));
  return reranked.neighbors.map(({ race_id, d2 }) => {
    const c = index.get(race_id);
    const items = Object.fromEntries(
      Object.entries(file.items_racecard).map(([k, v]) => [k, v[c]]),
    );
    const cand = {
      race: Object.fromEntries(
        Object.entries(file.exhibition_raw.race).map(([k, v]) => [k, v[c]]),
      ),
      exh_time: file.exhibition_raw.boats.exh_time[c],
    };
    const exhLevels = exhibitionItemLevels(today, cand);
    for (const k of EXHIBITION_ITEMS) items[k] = exhLevels[k];
    return {
      race_id,
      distance: Math.round(Math.sqrt(d2) * 1e4) / 1e4,
      items,
      ...(display ? { display: displayRow(display.columns, c) } : {}),
      ...file.results[c],
    };
  });
}

/** similar-display の列の c 件目（Python の v16_similar.display_row と同じ） */
export function displayRow(columns, c) {
  return Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, v[c]]));
}

/**
 * 朝のバッチの回ごとの母集団の展示の値（pool/exhibition）と展示タイムの差。1回の起動で回ごとに1回だけ読む
 * （約41万レース。無い回＝このファイルを足す前の回は null で、展示で決まる項目の pool_rate を付けない）
 */
function poolLoader() {
  const cache = new Map();
  return (raceId, runId) => {
    if (!cache.has(runId))
      cache.set(
        runId,
        readObject(objectPath(raceId, runId, "pool", "exhibition")).then(
          (pool) =>
            pool ? { pool, diffs: poolExhDiffs(pool.exh_time) } : null,
        ),
      );
    return cache.get(runId);
  };
}

async function buildRace(raceId, racecardSnap, ctx, runId, loadPool) {
  const rc = racecardSnap;
  const [file, todayRc, exhRows, conds, display, pool] = await Promise.all([
    readObject(objectPath(raceId, rc.run_id, "similar", raceId)),
    readObject(objectPath(raceId, rc.run_id, "today", raceId)),
    rest(
      `exhibition_data?race_id=eq.${raceId}&select=boat_number,exhibition_time,exhibition_course,start_timing,start_flag,is_absent`,
    ),
    rest(
      `race_conditions?race_id=eq.${raceId}&select=weather,wind_direction,wind_speed,wave_height`,
    ),
    // 表示用の値（無い回＝この列を足す前の朝のバッチの回は、値なしで並べ直す）
    readObject(objectPath(raceId, rc.run_id, "similar-display", raceId)),
    loadPool(raceId, rc.run_id),
  ]);
  if (!file || !todayRc)
    throw new Error(
      `${raceId}: 出走表の段のファイルが無い（run ${rc.run_id}）`,
    );
  const cond = conds[0] ?? {};
  const offset = todayRc.wind_offset_deg ?? NaN;
  const live = buildLiveFeatures({
    boatNumbers: BOATS,
    exhibition: exhRows,
    conditions: cond,
    windOffset: offset,
  });
  const today = {
    boats: {
      exh_time: live.map((v) => v.exh_time),
      exh_time_diff: live.map((v) => v.exh_time_diff),
      exh_time_rank: live.map((v) => v.exh_time_rank),
    },
    race: {
      weather_code: live[0].weather_code,
      wind_x: live[0].wind_x,
      wind_y: live[0].wind_y,
      wind_speed: live[0].wind_speed,
      wave_height: live[0].wave_height,
    },
  };
  const reranked = rerankSimilar(file, today);
  const todayExh = { race: today.race, exh_time: today.boats.exh_time };
  const similar = {
    race_id: raceId,
    racecard_run_id: rc.run_id,
    n_layer: file.n_layer,
    exact: reranked.exact,
    // 展示で決まる5項目の「全レースで同じ割合」（出走表の段は今日の値が無いので0になる。API が上書きする）
    ...(pool
      ? { pool_rate: exhibitionPoolRate(pool.pool, pool.diffs, todayExh) }
      : {}),
    neighbors: exhibitionNeighbors(file, reranked, todayExh, display),
  };
  const exhibition = todayExhibition(exhRows, live, cond);
  if (ctx.mode === "live") {
    await writeObject(
      objectPath(raceId, runId, "similar-exhibition", raceId),
      similar,
    );
    await writeObject(
      objectPath(raceId, runId, "today-exhibition", raceId),
      exhibition,
    );
  }
  return { exact: reranked.exact };
}

/**
 * Cron の本体（createScrapeCronHandler の run）
 * @param {{mode:string, now:() => Date}} ctx
 */
export async function runAnalogyV16Exhibition(ctx) {
  const now = ctx.now();
  const date = toJstDate(now);
  const runId = `exh-${now
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14)}`;
  const like = encodeURIComponent(`${date}-*`);
  const [snaps, races] = await Promise.all([
    rest(
      `analogy_v16_snapshots?race_id=like.${like}&select=race_id,stage,status,run_id,n_layer,pool_cutoff,model_version`,
    ),
    rest(`races?race_date=eq.${date}&select=race_id,race_date,start_time`),
  ]);
  const ids = races.map((r) => r.race_id).join(",") || "none";
  const [exh, entries] = await Promise.all([
    rest(
      `exhibition_data?race_id=in.(${ids})&select=race_id,boat_number,exhibition_time,is_absent`,
    ),
    rest(
      `race_entries?race_id=in.(${ids})&is_absent=is.true&select=race_id,is_absent`,
    ),
  ]);
  const targets = selectExhibitionTargets(
    snaps,
    races,
    exh,
    entries,
    now,
  ).slice(0, MAX_RACES);
  const rcBy = new Map(
    snaps.filter((s) => s.stage === "racecard").map((s) => [s.race_id, s]),
  );
  const report = {
    date,
    mode: ctx.mode,
    targets: targets.length,
    written: 0,
    failed: [],
    late: [],
  };
  const loadPool = poolLoader();
  for (const t of targets) {
    // 関数の上限の手前（共通ラッパのソフトデッドライン）で止める。残りは次の起動（2分後）が拾う。
    // 候補が3万件になり1レースの読み込みが大きくなったため（T2-4）
    if (ctx.shouldStop?.()) {
      report.stopped = true;
      break;
    }
    const rc = rcBy.get(t.race_id);
    const base = {
      race_id: t.race_id,
      stage: "exhibition",
      run_id: runId,
      pool_cutoff: rc.pool_cutoff,
      model_version: rc.model_version,
      n_layer: rc.n_layer,
    };
    try {
      let row;
      if (t.absent) row = { ...base, status: "absent", exact: null };
      else if (rc.status !== "ok")
        row = { ...base, status: "empty_layer", exact: true };
      else {
        const { exact } = await buildRace(t.race_id, rc, ctx, runId, loadPool);
        row = { ...base, status: "ok", exact };
      }
      // 締切は書く直前に確かめ直す（起動時は締切前でも、前のレースの処理やこのレースの読み込みの間に締切を
      // 越えうる。plan「締切前だけ書く」。朝のバッチの late_for と同じ）。Storage のファイルは置いたまま
      const at = ctx.now();
      if (t.deadline.getTime() <= at.getTime()) {
        report.late.push(t.race_id);
        continue;
      }
      row.computed_at = at.toISOString();
      if (ctx.mode === "live") {
        await rest("analogy_v16_snapshots?on_conflict=race_id,stage", {
          method: "POST",
          body: [row],
          prefer: "resolution=ignore-duplicates,return=minimal",
        });
        report.written += 1;
      }
    } catch (e) {
      report.failed.push({ race_id: t.race_id, error: String(e.message ?? e) });
    }
  }
  if (report.failed.length > 0 && report.written === 0 && targets.length > 0)
    throw new Error(
      `展示後の段を1件も作れなかった: ${JSON.stringify(report.failed.slice(0, 3))}`,
    );
  return { rowsWritten: report.written, report, body: report };
}
