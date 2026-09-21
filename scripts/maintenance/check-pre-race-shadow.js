/**
 * check-pre-race-shadow.js - レース情報（A1、job='race_info'）・展示（A2、job='exhibition'）の shadow・live の集計
 * （読み取りのみ。DBへは書き込まない。select しか呼ばない）。
 *
 * 予定表（scrape_slots）の該当ジョブのスロットを日付範囲で集計し、shadow で記録した result_digest
 * （scripts/lib/scrapeJobs/preRaceDigest.js）を、既存基盤（GitHub Actions・従来の展示関数）が race_entries・race_conditions・
 * races・exhibition_data に書いた値から同じ関数で計算したダイジェストと比べる
 * （tasks.md T4b-09-3・T4b-06・verification-runbook.md Q）。
 *
 *   node --env-file=.env.local scripts/maintenance/check-pre-race-shadow.js --job=race_info            # 直近3日（今日を含む）
 *   node --env-file=.env.local scripts/maintenance/check-pre-race-shadow.js --job=exhibition --days=5
 *   node --env-file=.env.local scripts/maintenance/check-pre-race-shadow.js --job=exhibition --date=2026-09-22
 *   node --env-file=.env.local scripts/maintenance/check-pre-race-shadow.js --job=race_info --strict  # 一致率99%未満・不一致ありで終了コード1
 *
 * 出力:
 *   - 日付×run_mode（shadow・live・未着手）×状態・outcome の件数
 *   - shadow の完了（ok）のダイジェストの一致率（一致 / 不一致 / 比べられる既存基盤の行なし / digest未記録）。分母は、比べる行が
 *     あるスロットのみ。値は、出走表・直前情報のページから解析する列に限る（気象・取得時刻は含めない）
 *   - shadow・live の完了時刻の、期限（発走のN分前）からの遅延（p50・p95。分）と、完了時刻の発走前の分数（展示の公開時刻の分布。
 *     展示は最初に取得できた時点＝公開の上限）、試行回数の分布
 *   - expired・未実行（attempts=0のままexpired）の件数
 */
import { createClient } from "@supabase/supabase-js";
import {
  EXHIBITION_DIGEST_COLUMNS,
  RACE_CONDITION_DIGEST_COLUMNS,
  RACE_ENTRY_DIGEST_COLUMNS,
  computeExhibitionDigest,
  computeRaceInfoDigest,
} from "../lib/scrapeJobs/preRaceDigest.js";
import { raceStartInstant, slotDeadline } from "../lib/scrapeJobs/time.js";
import { percentile } from "../lib/scrapeJobs/monitor.js";

const PAGE = 1000;
const CHUNK = 100;

const groupBy = (rows, key) => {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], []);
    map.get(row[key]).push(row);
  }
  return map;
};

/**
 * レース情報: shadow で完了（ok）したスロットのダイジェストと、DBの行から計算したダイジェストを比べる（純粋関数）。
 *
 * @param {Array<{race_id: string, result_digest: string|null}>} slots
 * @param {{entries: Array<Object>, conditions: Array<Object>, races: Array<Object>}} db 該当レースの race_entries・race_conditions・races の行
 */
export function compareRaceInfoShadowDigests(slots, db) {
  const entriesBy = groupBy(db.entries, "race_id");
  const conditionBy = new Map(db.conditions.map((c) => [c.race_id, c]));
  const raceBy = new Map(db.races.map((r) => [r.race_id, r]));
  const out = { matched: 0, mismatched: [], missing: [], noDigest: [] };
  for (const slot of slots) {
    if (!slot.result_digest) {
      out.noDigest.push(slot.race_id);
      continue;
    }
    const entries = entriesBy.get(slot.race_id) ?? [];
    if (entries.length === 0) {
      out.missing.push(slot.race_id);
      continue;
    }
    const dbDigest = computeRaceInfoDigest({
      entries,
      condition: conditionBy.get(slot.race_id) ?? null,
      raceGrade: raceBy.get(slot.race_id)?.race_grade ?? null,
    });
    if (dbDigest === slot.result_digest) out.matched++;
    else
      out.mismatched.push({
        race_id: slot.race_id,
        shadow: slot.result_digest,
        db: dbDigest,
      });
  }
  return out;
}

/**
 * 展示: shadow で完了（ok）したスロットのダイジェストと、exhibition_data の行から計算したダイジェストを比べる（純粋関数）。
 *
 * @param {Array<{race_id: string, result_digest: string|null}>} slots
 * @param {Array<Object>} exhibitionRows 該当レースの exhibition_data の行
 */
export function compareExhibitionShadowDigests(slots, exhibitionRows) {
  const rowsBy = groupBy(exhibitionRows, "race_id");
  const out = { matched: 0, mismatched: [], missing: [], noDigest: [] };
  for (const slot of slots) {
    if (!slot.result_digest) {
      out.noDigest.push(slot.race_id);
      continue;
    }
    const rows = rowsBy.get(slot.race_id) ?? [];
    if (rows.length === 0) {
      out.missing.push(slot.race_id);
      continue;
    }
    const dbDigest = computeExhibitionDigest(rows);
    if (dbDigest === slot.result_digest) out.matched++;
    else
      out.mismatched.push({
        race_id: slot.race_id,
        shadow: slot.result_digest,
        db: dbDigest,
      });
  }
  return out;
}

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

async function fetchByRaceIds(client, table, columns, ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await client
      .from(table)
      .select(columns.join(","))
      .in("race_id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

const jstToday = () =>
  new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmt = (v) => (v === null ? "-" : v.toFixed(1));

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const strict = args.includes("--strict");
  const job = arg("job");
  if (job !== "race_info" && job !== "exhibition") {
    console.error(
      "❌ --job=race_info または --job=exhibition を指定してください",
    );
    process.exit(1);
  }
  const date = arg("date");
  const days = Number(arg("days") ?? 3);
  const to = date ?? jstToday();
  const from = date ?? addDays(to, -(days - 1));

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("❌ SUPABASE_URL・SUPABASE_SERVICE_KEY が必要です");
    process.exit(1);
  }
  const client = createClient(url, key);

  const slots = await fetchAll(() =>
    client
      .from("scrape_slots")
      .select(
        "race_id,race_date,offset_min,status,attempts,outcome,run_mode,first_attempt_at,done_at,result_digest,last_error,races(start_time,cancellation_status)",
      )
      .eq("job", job)
      .gte("race_date", from)
      .lte("race_date", to)
      .order("race_date")
      .order("race_id"),
  );
  console.log(`${job} のスロット ${from}〜${to}: ${slots.length}件\n`);

  // 日付×run_mode×状態・outcome
  const tally = new Map();
  for (const s of slots) {
    const k = `${s.race_date}  ${(s.run_mode ?? "未着手").padEnd(6)} ${s.status.padEnd(8)} ${s.outcome ?? "-"}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...tally].sort()) console.log(`  ${k}: ${v}`);

  const expired = slots.filter((s) => s.status === "expired");
  const unexecuted = expired.filter((s) => (s.attempts ?? 0) === 0);
  console.log(
    `\nexpired: ${expired.length}件（うち未実行 attempts=0: ${unexecuted.length}件）`,
  );

  // shadow のダイジェストの一致率
  const shadowOk = slots.filter(
    (s) =>
      s.run_mode === "shadow" &&
      s.status === "done" &&
      ["ok", "skipped_have_data"].includes(s.outcome),
  );
  const ids = [...new Set(shadowOk.map((s) => s.race_id))];
  let cmp;
  if (job === "race_info") {
    const [entries, conditions, races] = await Promise.all([
      fetchByRaceIds(
        client,
        "race_entries",
        RACE_ENTRY_DIGEST_COLUMNS.concat("race_id"),
        ids,
      ),
      fetchByRaceIds(
        client,
        "race_conditions",
        ["race_id", ...RACE_CONDITION_DIGEST_COLUMNS],
        ids,
      ),
      fetchByRaceIds(client, "races", ["race_id", "race_grade"], ids),
    ]);
    cmp = compareRaceInfoShadowDigests(shadowOk, {
      entries,
      conditions,
      races,
    });
  } else {
    const rows = await fetchByRaceIds(
      client,
      "exhibition_data",
      EXHIBITION_DIGEST_COLUMNS.concat("race_id"),
      ids,
    );
    cmp = compareExhibitionShadowDigests(shadowOk, rows);
  }
  const denominator = cmp.matched + cmp.mismatched.length;
  const rate = denominator === 0 ? null : cmp.matched / denominator;
  console.log(
    `\nshadow の完了（ok）: ${shadowOk.length}件 → ダイジェスト 一致 ${cmp.matched} / 不一致 ${cmp.mismatched.length} / 比べる行なし ${cmp.missing.length} / digest未記録 ${cmp.noDigest.length}`,
  );
  console.log(
    `一致率: ${rate === null ? "算出不能（比較できる行が0件）" : `${(rate * 100).toFixed(2)}%（${cmp.matched}/${denominator}）`}`,
  );
  for (const m of cmp.mismatched.slice(0, 20)) {
    console.log(`  不一致 ${m.race_id}: shadow=${m.shadow} db=${m.db}`);
  }

  // 完了時刻の、期限からの遅延と、発走前の分数（shadow・live それぞれ）
  for (const mode of ["shadow", "live"]) {
    const doneSlots = slots.filter(
      (s) =>
        s.run_mode === mode &&
        s.status === "done" &&
        ["ok", "skipped_have_data"].includes(s.outcome) &&
        s.done_at &&
        s.races?.start_time,
    );
    const delays = [];
    const minBefore = [];
    const attempts = new Map();
    for (const s of doneSlots) {
      const deadline = slotDeadline(
        s.race_date,
        s.races.start_time,
        s.offset_min,
      );
      delays.push((new Date(s.done_at) - deadline) / 60000);
      minBefore.push(
        (raceStartInstant(s.race_date, s.races.start_time) -
          new Date(s.done_at)) /
          60000,
      );
      attempts.set(s.attempts, (attempts.get(s.attempts) ?? 0) + 1);
    }
    if (doneSlots.length === 0) continue;
    delays.sort((a, b) => a - b);
    minBefore.sort((a, b) => a - b);
    console.log(
      `\n${mode} の完了（n=${doneSlots.length}）: 遅延（完了−期限）p50 ${fmt(percentile(delays, 50))}分 / p95 ${fmt(percentile(delays, 95))}分。` +
        ` 完了の発走前の分数 最小 ${fmt(minBefore[0])} / p05 ${fmt(percentile(minBefore, 5))} / p50 ${fmt(percentile(minBefore, 50))} / p95 ${fmt(percentile(minBefore, 95))}分`,
    );
    console.log(
      `  試行回数の分布: ${
        [...attempts]
          .sort((a, b) => a[0] - b[0])
          .map(([k, v]) => `${k}回=${v}`)
          .join(", ") || "-"
      }`,
    );
  }

  if (strict && (cmp.mismatched.length > 0 || (rate !== null && rate < 0.99))) {
    console.error("\n❌ --strict: 一致率が99%未満、または不一致があります");
    process.exit(1);
  }
}

// スタンドアローン実行時のみ実行する（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error("❌", error.message);
    process.exit(1);
  });
}
