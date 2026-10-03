/**
 * verify-missing-venue-day.js - races が丸1日無い会場日の補完（backfill-missing-venue-day.js、BOA-721）の検証。
 * DBにも取得先にも接続しない（DBクライアント・出走表の取得・書き込みは差し替える）。
 *
 *   (a) 既定（--apply なし）は書かない
 *   (b) その会場日に races が1件でもあれば、書かない（既存の行を上書きしない）
 *   (c) 出走表が12レースそろわなければ、例外で止める
 *   (d) --apply --cancelled: 書いた後に、全レースへ中止の確定（cancellation_status='confirmed'）を立てる。予想が書かれていれば例外
 *   (e) 引数の検査
 */
import {
  backfillMissingVenueDay,
  parseArgs,
} from "./backfill-missing-venue-day.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const DATE = "2026-06-03";

/** races・predictions だけを持つ最小の偽クライアント（このスクリプトが使う呼び方だけ） */
function fakeClient({ races = [], predictions = [] } = {}) {
  const db = { races: [...races], predictions: [...predictions] };
  const updates = [];
  const from = (table) => {
    const filters = [];
    const q = {
      select: () => q,
      eq: (c, v) => (filters.push((r) => r[c] === v), q),
      in: (c, vs) => (filters.push((r) => vs.includes(r[c])), q),
      is: (c, v) => (filters.push((r) => (r[c] ?? null) === v), q),
      limit: () => q,
      update: (patch) => ((q.patch = patch), q),
      then: (resolve) => {
        const rows = db[table].filter((r) => filters.every((f) => f(r)));
        if (q.patch) {
          rows.forEach((r) => Object.assign(r, q.patch));
          updates.push({ table, patch: q.patch, n: rows.length });
        }
        resolve({ data: rows.map((r) => ({ ...r })), error: null });
      },
    };
    return q;
  };
  return { from, db, updates };
}
const venue = (code, n = 12) => ({
  placeCd: code,
  races: Array.from({ length: n }, (_, i) => ({
    raceNo: i + 1,
    startTime: "11:00",
    racers: Array.from({ length: 6 }, (_, b) => ({ lane: b + 1 })),
  })),
});
const raceIdOf = (v, r) =>
  `${DATE}-${String(v).padStart(2, "0")}-${String(r).padStart(2, "0")}`;
/** 書き込み（generateAndWriteFromRacesData の代わり）: races を作る。withPredictions なら予想も作る */
const writer = (client, { withPredictions = false } = {}) => {
  const calls = [];
  const fn = async (venues) => {
    calls.push(venues.map((v) => v.placeCd));
    for (const v of venues)
      for (const r of v.races) {
        client.db.races.push({
          race_id: raceIdOf(v.placeCd, r.raceNo),
          race_date: DATE,
          venue_code: v.placeCd,
          cancellation_status: null,
        });
        if (withPredictions)
          client.db.predictions.push({
            race_id: raceIdOf(v.placeCd, r.raceNo),
          });
      }
  };
  fn.calls = calls;
  return fn;
};
const quiet = () => {};

// (a) dry-run
{
  const client = fakeClient();
  const w = writer(client);
  const res = await backfillMissingVenueDay(
    { date: DATE, venues: [3, 7], apply: false, cancelled: true },
    {
      client,
      scrapeVenue: async (d, c) => venue(c),
      writeVenues: w,
      log: quiet,
    },
  );
  check(
    "(a) --apply なしは書かない（races 24・出走表 144 を数えるだけ）",
    w.calls.length === 0 &&
      client.db.races.length === 0 &&
      res.races === 24 &&
      res.entries === 144,
    show(res),
  );
}

// (b) 既存の races があれば書かない
{
  const client = fakeClient({
    races: [{ race_id: raceIdOf(7, 1), race_date: DATE, venue_code: 7 }],
  });
  const w = writer(client);
  const res = await backfillMissingVenueDay(
    { date: DATE, venues: [3, 7], apply: true, cancelled: true },
    {
      client,
      scrapeVenue: async (d, c) => venue(c),
      writeVenues: w,
      log: quiet,
    },
  );
  check(
    "(b) races が1件でもある会場（蒲郡）は書かない。無い会場（江戸川）だけ書く",
    show(w.calls) === "[[3]]" &&
      res.skipped.length === 1 &&
      res.skipped[0].venue === 7 &&
      res.written.length === 12,
    show(res),
  );
}

// (c) 出走表が12レースそろわない
{
  const client = fakeClient();
  const w = writer(client);
  let error = null;
  try {
    await backfillMissingVenueDay(
      { date: DATE, venues: [3], apply: true, cancelled: true },
      {
        client,
        scrapeVenue: async (d, c) => venue(c, 11),
        writeVenues: w,
        log: quiet,
      },
    );
  } catch (e) {
    error = e;
  }
  check(
    "(c) 出走表が11レースしか取れない: 例外で止め、何も書かない",
    error !== null && /12のはず/.test(error.message) && w.calls.length === 0,
    String(error?.message),
  );
}

// (d) --apply --cancelled
{
  const client = fakeClient();
  const w = writer(client);
  const res = await backfillMissingVenueDay(
    { date: DATE, venues: [3, 7], apply: true, cancelled: true },
    {
      client,
      scrapeVenue: async (d, c) => venue(c),
      writeVenues: w,
      log: quiet,
    },
  );
  check(
    "(d) --apply --cancelled: 24レースを書き、全レースに中止の確定を立てる",
    res.written.length === 24 &&
      client.db.races.every((r) => r.cancellation_status === "confirmed"),
    show(client.updates),
  );
  const client2 = fakeClient();
  let error = null;
  try {
    await backfillMissingVenueDay(
      { date: DATE, venues: [3], apply: true, cancelled: true },
      {
        client: client2,
        scrapeVenue: async (d, c) => venue(c),
        writeVenues: writer(client2, { withPredictions: true }),
        log: quiet,
      },
    );
  } catch (e) {
    error = e;
  }
  check(
    "(d) 予想が書かれていれば例外（過去の日付に予想を作らない）",
    error !== null && /予想が書かれています/.test(error.message),
    String(error?.message),
  );
}

// (e) 引数
{
  const ok = parseArgs(["--date=2026-06-03", "--venues=3,7", "--cancelled"]);
  let bad = 0;
  for (const argv of [
    ["--venues=3"],
    ["--date=2026-6-3", "--venues=3"],
    ["--date=2026-06-03"],
  ]) {
    try {
      parseArgs(argv);
    } catch {
      bad++;
    }
  }
  check(
    "(e) 引数: --date と --venues が必須。既定は dry-run",
    ok.date === DATE &&
      show(ok.venues) === "[3,7]" &&
      ok.cancelled === true &&
      ok.apply === false &&
      bad === 3,
    show(ok),
  );
}

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nALL OK");
