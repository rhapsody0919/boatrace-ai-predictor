/**
 * BOA-271 アナロジー・ファインダー v16 の夜の確認（tasks T5-3・T3-3。plan「夜の確認」、data-acquisition.md の完了の定義）。
 * Nightly DB Verify（JST 3:00）が実行し、失敗を Slack に流す。本番 DB は読み取りだけ（--cleanup のときだけ Storage を消す）。
 *
 * 前日（JST）の開催レース（中止を除く）について数える:
 *   - 出走表の段: racecard の snapshot があり、締切前に作られた割合（閾値 99%）。欠場が分かったレースは分母から除く
 *   - 展示後の段: 6艇の展示タイムがそろったレースのうち、exhibition の snapshot が締切前に作られた割合（閾値 95%）、
 *     並べ直しが厳密だった割合（参考）
 * まだ一度も snapshot が無い（公開前・朝のバッチの起動前）ときは「未稼働」として通す（毎晩の誤報を出さない）。
 * 展示後の段の Cron がまだ一度も書いていないときは、展示後の段の閾値を見ない。
 *
 * --cleanup: Storage の非公開のバケット analogy-v16 の、7日より前の日付の similar/（候補ファイル）を消す（plan「Storage」）
 * --date YYYY-MM-DD: 数える日（省略時は前日）
 *
 * 使い方: node --env-file=.env.local scripts/maintenance/verify-analogy-v16.js [--date 2026-10-05] [--cleanup]
 */
import {
  deadlineOf,
  deleteObjects,
  listObjects,
  rest,
} from "../../api/_lib/analogyV16.js";

export const RACECARD_MIN = 0.99;
export const EXHIBITION_MIN = 0.95;
export const KEEP_SIMILAR_DAYS = 7;

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const jstDate = (d) =>
  new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (date, n) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);

/**
 * 1日分の数（純粋関数）
 * @returns {{eligible:number, racecard:number, racecardOnTime:number, exhEligible:number, exhibition:number,
 *   exhibitionOnTime:number, exact:number, missingRacecard:string[], missingExhibition:string[]}}
 */
export function summarizeDay(races, snaps, exh, entries) {
  const absent = new Set(
    [...exh, ...entries].filter((r) => r.is_absent).map((r) => r.race_id),
  );
  const timed = new Map();
  for (const r of exh)
    if (r.exhibition_time !== null && !r.is_absent)
      timed.set(r.race_id, (timed.get(r.race_id) ?? 0) + 1);
  const snap = new Map(snaps.map((s) => [`${s.race_id}|${s.stage}`, s]));
  const onTime = (s, race) => {
    const d = deadlineOf(race);
    return s && d !== null && new Date(s.computed_at).getTime() < d.getTime();
  };
  const out = {
    eligible: 0,
    racecard: 0,
    racecardOnTime: 0,
    exhEligible: 0,
    exhibition: 0,
    exhibitionOnTime: 0,
    exact: 0,
    missingRacecard: [],
    missingExhibition: [],
  };
  for (const race of races) {
    if (race.cancellation_status || absent.has(race.race_id)) continue;
    out.eligible += 1;
    const rc = snap.get(`${race.race_id}|racecard`);
    if (rc) out.racecard += 1;
    else out.missingRacecard.push(race.race_id);
    if (onTime(rc, race)) out.racecardOnTime += 1;
    if (timed.get(race.race_id) === 6 && rc) {
      out.exhEligible += 1;
      const ex = snap.get(`${race.race_id}|exhibition`);
      if (ex) out.exhibition += 1;
      else out.missingExhibition.push(race.race_id);
      if (onTime(ex, race)) out.exhibitionOnTime += 1;
      if (ex?.exact) out.exact += 1;
    }
  }
  return out;
}

/** 7日より前の日付のフォルダ（`YYYY-MM-DD`）を選ぶ（純粋関数） */
export function datesToClean(folders, today, keepDays = KEEP_SIMILAR_DAYS) {
  const limit = addDays(today, -keepDays);
  return folders.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f) && f < limit);
}

async function cleanup(today) {
  const top = await listObjects("");
  const dates = datesToClean(
    top.filter((r) => r.id === null).map((r) => r.name),
    today,
  );
  let n = 0;
  for (const date of dates) {
    for (const run of (await listObjects(`${date}/`)).filter(
      (r) => r.id === null,
    )) {
      const files = await listObjects(`${date}/${run.name}/similar/`);
      const paths = files
        .filter((f) => f.id !== null)
        .map((f) => `${date}/${run.name}/similar/${f.name}`);
      await deleteObjects(paths);
      n += paths.length;
    }
  }
  return n;
}

const pct = (a, b) => (b === 0 ? "—" : `${((100 * a) / b).toFixed(1)}%`);

async function main() {
  const today = jstDate(new Date());
  const date = argOf("--date") ?? addDays(today, -1);
  const ever = await rest("analogy_v16_snapshots?select=stage&limit=1");
  if (ever.length === 0) {
    console.log("ℹ️ analogy_v16_snapshots が0行（v16 は未稼働）。数えない");
  } else {
    const like = encodeURIComponent(`${date}-*`);
    const [races, snaps, exhEver] = await Promise.all([
      rest(
        `races?race_date=eq.${date}&select=race_id,race_date,start_time,cancellation_status`,
      ),
      rest(
        `analogy_v16_snapshots?race_id=like.${like}&select=race_id,stage,status,exact,computed_at`,
      ),
      rest("analogy_v16_snapshots?stage=eq.exhibition&select=race_id&limit=1"),
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
    const s = summarizeDay(races, snaps, exh, entries);
    console.log(
      `${date}: 出走表の段 ${s.racecard}/${s.eligible}（${pct(s.racecard, s.eligible)}、締切前 ${pct(s.racecardOnTime, s.eligible)}）` +
        `、展示後の段 ${s.exhibition}/${s.exhEligible}（締切前 ${pct(s.exhibitionOnTime, s.exhEligible)}、厳密 ${pct(s.exact, s.exhibition)}）`,
    );
    const problems = [];
    if (s.eligible > 0 && s.racecardOnTime / s.eligible < RACECARD_MIN)
      problems.push(
        `出走表の段が締切前にそろったのは ${pct(s.racecardOnTime, s.eligible)}（閾値 ${RACECARD_MIN * 100}%）。欠け: ${s.missingRacecard.slice(0, 10).join(",")}`,
      );
    if (
      exhEver.length > 0 &&
      s.exhEligible > 0 &&
      s.exhibitionOnTime / s.exhEligible < EXHIBITION_MIN
    )
      problems.push(
        `展示後の段が締切前にそろったのは ${pct(s.exhibitionOnTime, s.exhEligible)}（閾値 ${EXHIBITION_MIN * 100}%）。欠け: ${s.missingExhibition.slice(0, 10).join(",")}`,
      );
    if (problems.length) {
      console.error(`❌ ${problems.join("\n❌ ")}`);
      process.exitCode = 1;
    }
  }
  if (argv.includes("--cleanup"))
    console.log(
      `🧹 similar/ を ${await cleanup(today)} 件消した（${KEEP_SIMILAR_DAYS}日より前）`,
    );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("❌", e.message ?? e);
    process.exit(1);
  });
}
