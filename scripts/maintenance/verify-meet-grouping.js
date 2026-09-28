/**
 * verify-meet-grouping.js - 節推定（`src/utils/meetGrouping.js`）が
 * `race_conditions.series_day` と一致し続けるかを検査する。
 *
 * ## なぜ要るか
 *
 * `groupIntoCurrentMeet` は節の境目を **race_idの日付の連続性**（間が2日を超えたら
 * 別の節）で推定する。実装当時（2026-09-15）は `series_day` / `is_final_day` が
 * 全件nullで他に手が無かったが、現在は2026-02以降100%埋まっている。それでも
 * 推定を続けるという判断（`meetGrouping.js` のモジュールコメント）は、
 * 2026-09-28の実測で**一致率100%**だったことに乗っている。
 *
 * この一致は偶然ではなく「選手は同じ会場の隣接2節に連続で斡旋されない」という
 * 斡旋の性質に依存している。斡旋の運用が変わる・中止順延が増える等でこの性質が
 * 崩れると、推定が黙って前の節を混ぜ始める。画面上は「今節の走りが1〜2走多い」
 * だけで、見て気づけない（[BOA-491](https://linear.app/boat-ai/issue/BOA-491)は
 * 会場単位で同じ推定を使っている `getMeetScoreboard` で実際に起きた例）。
 *
 * ## 何を見るか
 *
 *   A. 選手1人・会場1つに絞った出走履歴で、推定した節が `series_day` 由来の
 *      正解と一致すること（2026-09-28実測: 40,048アンカー中の不一致0件）
 *   B. 推定が誤りうる会場境界（節と節の間が中1日／節の内部が3日以上空く）に、
 *      前の節と次の節の両方に出走した選手が現れないこと
 *      （2026-09-28実測: 危険な境界14箇所すべてで0人）
 *
 * Bが0でなくなったら、Aがまだ通っていても危険水域。`series_day` への切り替えを
 * 検討する合図として見る。
 *
 * ## 使い方
 *
 *   node --env-file=.env.local scripts/maintenance/verify-meet-grouping.js
 *   node --env-file=.env.local scripts/maintenance/verify-meet-grouping.js --since 2026-06-01
 *   node --env-file=.env.local scripts/maintenance/verify-meet-grouping.js --racers 100
 *
 * 読み取り専用。実Supabaseへの接続が要るため tier=manual（CIでは走らない）。
 * 終了コード: 0=合格 / 1=AまたはBの違反。
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAll, VENUE_NAMES } from "../lib/supabaseClient.js";
import { groupIntoCurrentMeet } from "../../src/utils/meetGrouping.js";

/** `series_day` が埋まり始めた月。これより前は行そのものが無いので検査できない */
const DATA_START = "2026-02-01";
/** 検査する選手数の既定値。多いほど厳しいが、そのぶん本番DBを読む */
const DEFAULT_RACERS = 300;
/**
 * 1ページあたりの待ち時間の上限（ms）。共有クライアント
 * （`scripts/lib/supabaseClient.js`）の15秒では `race_conditions` の全件取得が
 * 中断する（2026-09-28に実際に中断した）ため、この検証用に長めのクライアントを作る。
 */
const FETCH_TIMEOUT_MS = 90000;
/**
 * 会場×開催日の下限。これを割ったら「一致率100%」ではなく取得できていないと見る。
 * 2026-02-01以降の実測は3,063件なので、明らかな取得失敗だけを弾く緩い下限にする。
 */
const MIN_VENUE_DAYS = 500;

function makeClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: {
      fetch: (input, init = {}) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        return fetch(input, { ...init, signal: controller.signal }).finally(() =>
          clearTimeout(timer),
        );
      },
    },
  });
}

function parseArgs(argv) {
  const out = { since: DATA_START, racers: DEFAULT_RACERS };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--since" && argv[i + 1]) out.since = argv[++i];
    if (argv[i] === "--racers" && argv[i + 1]) out.racers = Number(argv[++i]);
  }
  if (out.since < DATA_START) out.since = DATA_START;
  if (!Number.isFinite(out.racers) || out.racers <= 0)
    throw new Error("--racers は正の整数で指定する");
  return out;
}

const dayDiff = (a, b) => (new Date(a) - new Date(b)) / 86400000;
/** race_id（YYYY-MM-DD-VV-RR）の会場コード部分 */
const venueOf = (raceId) => raceId.split("-")[3];
const dateOf = (raceId) => raceId.slice(0, 10);

// 取得失敗を「該当0件」と混同しないため、全クエリで throwOnError を立てる
// （.claude/rules/frontend-data-fetch.md §2 と同じ理由。空データで合格すると、
// 一致率100%という結論が「何も読めていないだけ」で出てしまう）
async function readAll(client, table, select, build) {
  return fetchAll(table, select, build, { throwOnError: true, client });
}

async function fetchByIn(client, table, select, col, ids, chunk = 150) {
  const out = [];
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    out.push(...(await readAll(client, table, select, (q) => q.in(col, slice))));
  }
  return out;
}

/** 会場ごとの「開催日 → series_day」を日付昇順で組み立てる */
async function loadVenueDays(client, since) {
  const rows = await readAll(client, "race_conditions", "race_id, series_day", (q) =>
    q.gte("race_id", since).not("series_day", "is", null),
  );
  const seen = new Set();
  const byVenue = new Map();
  for (const r of rows) {
    const key = `${venueOf(r.race_id)}|${dateOf(r.race_id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const venue = venueOf(r.race_id);
    if (!byVenue.has(venue)) byVenue.set(venue, []);
    byVenue.get(venue).push({ date: dateOf(r.race_id), sd: r.series_day });
  }
  for (const days of byVenue.values())
    days.sort((a, b) => a.date.localeCompare(b.date));
  return byVenue;
}

/**
 * `series_day` を遡って、指定日を含む節の日付一覧を返す。
 * 節の先頭（series_day=1）に到達できない場合はnull（データ開始境界で切れている）。
 */
function realMeetDates(byVenue, venue, date) {
  const days = byVenue.get(venue);
  if (!days) return null;
  const i = days.findIndex((d) => d.date === date);
  if (i < 0) return null;
  const dates = [date];
  let k = i;
  while (days[k].sd !== 1) {
    if (k === 0 || days[k - 1].sd !== days[k].sd - 1) return null;
    k--;
    dates.push(days[k].date);
  }
  return dates;
}

/** 検査A: 選手単位・会場単位に絞った節推定が series_day 由来の正解と一致するか */
async function checkRacerScopedAgreement(client, byVenue, since, racerCount) {
  const recent = await readAll(client, "race_entries", "racer_id", (q) =>
    q.gte("race_id", since).not("racer_id", "is", null),
  );
  const racers = [...new Set(recent.map((r) => r.racer_id))].slice(
    0,
    racerCount,
  );
  const entries = await fetchByIn(
    client,
    "race_entries",
    "racer_id, race_id",
    "racer_id",
    racers.map(String),
    25,
  );
  const byRacer = new Map();
  for (const e of entries) {
    if (e.race_id < since) continue;
    if (!byRacer.has(e.racer_id)) byRacer.set(e.racer_id, []);
    byRacer.get(e.racer_id).push(e.race_id);
  }

  let anchors = 0;
  let skipped = 0;
  const mismatches = [];
  for (const [racerId, ids] of byRacer) {
    const uniq = [...new Set(ids)].sort();
    for (const anchor of uniq) {
      const venue = venueOf(anchor);
      const real = realMeetDates(byVenue, venue, dateOf(anchor));
      if (!real) {
        skipped++;
        continue;
      }
      const realDates = new Set(real);
      const before = uniq.filter(
        (id) => venueOf(id) === venue && id < anchor,
      );
      // 呼び出し元（basicInfoStats.buildMeetResults）と同じく、表示中のレースを
      // 終端の目印として足してから切り出し、目印自身は除く
      const estimated = groupIntoCurrentMeet([
        ...before.map((id) => ({ race_id: id })),
        { race_id: anchor },
      ])
        .map((e) => e.race_id)
        .filter((id) => id !== anchor);
      const expected = before.filter((id) => realDates.has(dateOf(id)));
      anchors++;
      if (estimated.join(",") !== expected.join(",")) {
        mismatches.push({
          racerId,
          anchor,
          estimated: estimated.length,
          expected: expected.length,
        });
      }
    }
  }
  return { anchors, skipped, mismatches, racerCount: byRacer.size };
}

/**
 * 検査B: 推定が誤りうる会場境界に、両方の節へ出走した選手が現れていないか。
 *
 * 誤りうるのは2通りだけ。
 *
 *   繋げる: 節と節の間が中1日（境界の日数ギャップが2日）。推定は2日を境目と
 *           見ないので、前の節まで遡り続ける
 *   切る  : 節の**内部**で3日以上空く（中止順延など）。推定はそこを境目と誤認する
 *
 * 「切る」の判定には `sd` が1つずつ増えていることを要求する。要求しないと、
 * **新しい節の初日（series_day=1）の行が無い**ケース（2026-06-04の江戸川・蒲郡。
 * `races` ごと欠けている）を節の内部と誤って数える。実際はそこは節境界で、
 * 日数ギャップが4日あるため推定は正しく切っている。
 */
async function checkRiskyBoundaries(client, byVenue) {
  const risky = [];
  for (const [venue, days] of byVenue) {
    for (let i = 1; i < days.length; i++) {
      const gap = dayDiff(days[i].date, days[i - 1].date);
      const startsNewMeet = days[i].sd === 1;
      const continuesMeet = days[i].sd === days[i - 1].sd + 1;
      if (startsNewMeet && gap <= 2) {
        risky.push({ venue, prev: days[i - 1].date, next: days[i].date, gap, kind: "繋げる" });
      } else if (continuesMeet && gap > 2) {
        risky.push({ venue, prev: days[i - 1].date, next: days[i].date, gap, kind: "切る" });
      }
    }
  }

  const violations = [];
  for (const b of risky) {
    const prevMeet = realMeetDates(byVenue, b.venue, b.prev) ?? [b.prev];
    const nextMeet = realMeetDates(byVenue, b.venue, b.next) ?? [b.next];
    const span = [...prevMeet, ...nextMeet].sort();
    const entries = await readAll(client, "race_entries", "racer_id, race_id", (q) =>
      q
        .gte("race_id", span[0])
        .lte("race_id", `${span[span.length - 1]}-zz`)
        .like("race_id", `__________-${b.venue}-__`)
        .not("racer_id", "is", null),
    );
    const inPrev = new Set();
    const inNext = new Set();
    for (const e of entries) {
      const d = dateOf(e.race_id);
      if (prevMeet.includes(d)) inPrev.add(e.racer_id);
      if (nextMeet.includes(d)) inNext.add(e.racer_id);
    }
    const both = [...inPrev].filter((r) => inNext.has(r));
    if (both.length > 0) violations.push({ ...b, racers: both });
  }
  return { risky, violations };
}

async function main() {
  const { since, racers } = parseArgs(process.argv.slice(2));
  const client = makeClient();
  if (!client) {
    console.error("Supabase環境変数が未設定（SUPABASE_URL / SUPABASE_SERVICE_KEY）");
    process.exit(1);
  }
  console.log(`節推定の検査（${since} 以降、選手${racers}人まで）\n`);

  const byVenue = await loadVenueDays(client, since);
  const totalDays = [...byVenue.values()].reduce((a, d) => a + d.length, 0);
  console.log(`会場×開催日 = ${totalDays}件 / ${byVenue.size}会場`);
  if (totalDays < MIN_VENUE_DAYS) {
    console.error(
      `\n❌ race_conditions が ${totalDays}件しか読めていない（下限${MIN_VENUE_DAYS}件）。` +
        "\n   検査が成立しないので合格にしない。取得の失敗か、since の指定を疑うこと。",
    );
    process.exit(1);
  }

  const a = await checkRacerScopedAgreement(client, byVenue, since, racers);
  const rate = a.anchors > 0 ? (100 * a.mismatches.length) / a.anchors : 0;
  console.log(
    `\n[A] 選手単位の一致: 判定できたアンカー${a.anchors}件（選手${a.racerCount}人、` +
      `データ開始境界で判定不可${a.skipped}件は除外）`,
  );
  console.log(`    不一致 ${a.mismatches.length}件 = ${rate.toFixed(2)}%`);
  a.mismatches.slice(0, 10).forEach((m) =>
    console.log(
      `      racer=${m.racerId} ${m.anchor} 推定${m.estimated}走 / 実${m.expected}走`,
    ),
  );

  const b = await checkRiskyBoundaries(client, byVenue);
  console.log(
    `\n[B] 推定が誤りうる会場境界: ${b.risky.length}箇所（両節にまたがる選手が居る箇所 ${b.violations.length}）`,
  );
  b.violations.slice(0, 10).forEach((v) =>
    console.log(
      `      ${VENUE_NAMES[Number(v.venue)] ?? v.venue} ${v.prev}→${v.next}` +
        `(${v.gap}日, ${v.kind}) 両節に出走 ${v.racers.length}人: ${v.racers.slice(0, 5).join(",")}`,
    ),
  );

  const failed = a.mismatches.length > 0 || b.violations.length > 0;
  if (failed) {
    console.error(
      "\n❌ 不合格。日付の連続性による節推定が実データと食い違い始めている。" +
        "\n   src/utils/meetGrouping.js のモジュールコメント（切り替えない理由）を" +
        "\n   見直し、race_conditions.series_day への切り替えを検討すること。",
    );
    process.exit(1);
  }
  console.log("\n✅ 合格。日付の連続性による節推定は series_day と一致している");
}

main().catch((err) => {
  console.error("検査に失敗:", err?.message ?? err);
  process.exit(1);
});
