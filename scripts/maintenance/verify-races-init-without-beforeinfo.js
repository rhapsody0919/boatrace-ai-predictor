/**
 * verify-races-init-without-beforeinfo.js - 朝の初期化（races-init・scrape-to-json）が、公式の直前情報（beforeinfo）に
 * 依らずに races を作れることの検証（BOA-1145 の予防。2026-10-26 から当社の beforeinfo の取得だけ HTTP 403）。
 * DBにも取得先にも接続しない（保存済みの実ページ・インメモリのSupabaseクライアント）。
 *
 * 確認すること:
 *   (a) scrapeVenue（strict）: beforeinfo が 403 でも、出走表（racelist）と発走時刻だけで12レース・各6艇を返す。
 *       beforeinfo の URL を1回も取りに行かない。直前情報の欄（気象・展示）は null
 *   (b) races-init（live）: beforeinfo が 403 でも、会場を「済み」にし、races 12行・race_entries 72行を書く。
 *       race_conditions に気象を書かない（後で展示の取得が書く）・exhibition_data を書かない
 *
 * 実行: node scripts/maintenance/verify-races-init-without-beforeinfo.js
 */
import fs from "node:fs";
import { scrapeVenue } from "../scrape-to-json.js";
import { runRacesInitJob } from "../lib/racesInit/job.js";
import { createFakeSupabaseClient } from "../lib/scrapeJobs/testing/fakeSupabaseClient.js";

const out = { log: console.log, error: console.error };
console.log = console.warn = console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) out.log(`✅ ${label}`);
  else {
    failures++;
    out.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const FX = new URL("../lib/racesInit/__fixtures__/", import.meta.url);
const fixture = (name) => fs.readFileSync(new URL(name, FX), "utf8");
const DATE = "2026-09-21";
// 発走済みのレースは書かない（BOA-628）ため、対象日の朝に固定する
const NOW = new Date("2026-09-21T05:00:00+09:00");

const PAGES = [
  ["/race/raceindex", fixture("raceindex-01.html")],
  ["/race/racelist", fixture("racelist-01-05.html")],
  ["/race/index", fixture("index-2026-09-21.html")],
];

/** beforeinfo だけ 403 を返す取得（呼び出しの記録つき） */
function createFetch() {
  const log = [];
  async function fetchHtml(url) {
    log.push(String(url));
    if (String(url).includes("/race/beforeinfo"))
      throw new Error(`HTTP 403 for ${url}`);
    const page = PAGES.find(([p]) => String(url).includes(p));
    if (!page) throw new Error(`未対応のURL: ${url}`);
    return page[1];
  }
  fetchHtml.log = log;
  return fetchHtml;
}

const BEFOREINFO_FIELDS = [
  "weather",
  "airTemp",
  "windDirection",
  "windVelocity",
  "waterTemp",
  "waveHeight",
  "exhibitionData",
];

// ---------------------------------------------------------------------------
// (a) scrapeVenue
// ---------------------------------------------------------------------------
{
  const fetchHtml = createFetch();
  let venue = null;
  let error = null;
  try {
    venue = await scrapeVenue(DATE, 1, { fetchHtml, strict: true });
  } catch (e) {
    error = e;
  }
  check(
    "(a) strict: beforeinfo が 403 でも例外にしない",
    error === null,
    error?.message,
  );
  check(
    "(a) 12レース・全レースに6艇・発走時刻・レース名あり",
    venue?.races?.length === 12 &&
      venue.races.every(
        (r, i) =>
          r.raceNo === i + 1 &&
          r.racers.length === 6 &&
          /^\d{1,2}:\d{2}$/.test(r.startTime) &&
          r.raceTitle,
      ),
    `races=${venue?.races?.length}`,
  );
  check(
    "(a) beforeinfo を1回も取りに行かない",
    fetchHtml.log.length > 0 &&
      !fetchHtml.log.some((u) => u.includes("beforeinfo")),
    fetchHtml.log.filter((u) => u.includes("beforeinfo")).length + "回",
  );
  check(
    "(a) 直前情報の欄（気象・展示）は null",
    venue?.races?.every((r) => BEFOREINFO_FIELDS.every((k) => r[k] === null)),
  );
}

// ---------------------------------------------------------------------------
// (b) races-init（live）
// ---------------------------------------------------------------------------
{
  const fetchHtml = createFetch();
  const politeFetch = async (url) => {
    try {
      const body = await fetchHtml(url);
      return new Response(body, { status: 200 });
    } catch (e) {
      return new Response(e.message, {
        status: /403/.test(e.message) ? 403 : 500,
      });
    }
  };
  const client = createFakeSupabaseClient({
    tables: {
      venues: [{ code: 1, avg_first_win_rate: 0.5 }],
      racer_aggregated_stats: [],
      scrape_job_state: [{ job: "races_init", mode: "live" }],
    },
  });
  const ctx = {
    job: "races_init",
    targetDate: DATE,
    mode: "live",
    query: {},
    state: null,
    client,
    politeFetch,
    now: () => NOW,
    shouldStop: () => false,
  };
  const result = await runRacesInitJob(ctx, {
    getVenues: async () => [1],
    existingVenueCodes: async () => new Set(),
    ensureSlots: async () => ({ jobs: [], created: 0 }),
    ensureUnified: async () => ({ missing: 0, generated: 0 }),
    triggerDeployHook: async () => ({ triggered: false, reason: "verify" }),
    checkNoProgram: async () => false,
  });
  check(
    "(b) 会場を済みにし、失敗にしない",
    result.outcome !== "error" &&
      result.cursor?.settled?.includes(1) &&
      result.cursor?.done === true,
    JSON.stringify(result.report?.failures ?? result.error),
  );
  const races = client.data.races ?? [];
  check(
    "(b) races 12行・race_entries 72行を書く",
    races.length === 12 && (client.data.race_entries ?? []).length === 72,
    `races=${races.length} entries=${client.data.race_entries?.length}`,
  );
  check(
    "(b) races.start_time は発走時刻（HH:MM:00）",
    races.length === 12 &&
      races.every((r) => /^\d{2}:\d{2}:00$/.test(r.start_time)),
  );
  const conds = client.data.race_conditions ?? [];
  check(
    "(b) race_conditions はレース名・開催ステージだけ（気象の列を送らない）",
    conds.length === 12 &&
      conds.every(
        (r) =>
          !("weather" in r) && !("wind_speed" in r) && !("temperature" in r),
      ),
  );
  check(
    "(b) exhibition_data を書かない（展示は後で展示の取得が書く）",
    (client.data.exhibition_data ?? []).length === 0,
  );
  check(
    "(b) beforeinfo を1回も取りに行かない",
    !fetchHtml.log.some((u) => u.includes("beforeinfo")),
  );
}

if (failures > 0) {
  out.error(`\n❌ ${failures}件の検証に失敗しました`);
  process.exit(1);
}
out.log("\n✅ 全ての検証に成功しました");
