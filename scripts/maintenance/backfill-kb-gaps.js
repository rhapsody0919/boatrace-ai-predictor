/**
 * K/Bファイル（kb-backfill.js parse の中間JSON）から、本体テーブルの欠落を補う（BOA-271 の前提条件）。
 * 計画: docs/design/scraping-vercel-consolidation/backfill-phase1-kb-2026-10.md（項目3〜6）。
 * 行の組み立ては scripts/lib/kbGapFill.js（純関数）。
 *
 *   --item=st          項目4: race_start_timings に行が無いレースへ、スタートの行を挿入する
 *   --item=exhibition  項目6: 展示タイムが無い艇（行が無い・行はあるが NULL）に、展示タイムの列だけを書く
 *   --item=conditions  項目5: race_conditions の NULL の列（天候・風向・風速・波高・ステージ）だけを埋める
 *   --item=race_status 項目8（BOA-480）: race_results の race_status・refund_boats が NULL のレースを、K から導いて埋める
 *   --item=rate2       項目3: race_entries の2連率（全国・当地）の NULL だけを埋める（登録番号が一致する艇のみ）
 *
 * 書くのは項目ごとに決めた列だけ（kbGapFill.js の GAP_FILL_ITEMS）。書く直前に、すべての行の列の集合が同じかを
 * 検査する（PostgREST の一括 upsert は、行ごとに列が違うと無い列を NULL で書く）。既存の値は上書きしない。
 * 既定は dry-run（DBを読むだけ）。--apply で書く。1文200行以下、文の間に1秒。日付ごとに処理し、途中で止めても
 * 再実行すれば残りだけを書く（対象は都度DBの欠落から導出する）。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/backfill-kb-gaps.js --item=st --from=2026-02-01 --to=2026-02-28
 *   node --env-file=.env.local scripts/maintenance/backfill-kb-gaps.js --item=st --from=2026-02-01 --to=2026-02-28 --apply
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  supabase,
  isSupabaseEnabled,
  fetchAll,
} from "../lib/supabaseClient.js";
import {
  GAP_FILL_ITEMS,
  assertColumnSet,
  buildConditionsRows,
  buildExhibitionRows,
  buildRaceStatusRows,
  buildRate2Rows,
  buildStartTimingRows,
} from "../lib/kbGapFill.js";

export const DEFAULT_ARCHIVE_DIR =
  "/Users/terukina/boatrace-archive-backup/kb-archive";
const BATCH = 200;
const PAUSE_MS = 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** kb-backfill.js の parsedPath と同じ場所の中間JSON（.json.gz か .json）。無ければ null */
export function readParsedDay(dir, date) {
  const base = path.join(dir, "parsed", date.slice(0, 7).replace("-", ""));
  for (const [file, gz] of [
    [path.join(base, `kb-${date}.json.gz`), true],
    [path.join(base, `kb-${date}.json`), false],
  ]) {
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      return JSON.parse(
        gz ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8"),
      );
    }
  }
  return null;
}

function* datesBetween(from, to) {
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    yield d.toISOString().slice(0, 10);
  }
}

const inDay = (date) => (q) => q.gte("race_id", date).lt("race_id", `${date}~`);
const read = (table, columns, date, client) =>
  fetchAll(table, columns, inDay(date), { client, throwOnError: true });

/**
 * 1日分の書く行を作る（DBの読み取りだけ）。
 * @returns {Promise<Object[]>}
 */
export async function planDay(item, day, date, client = supabase, out = {}) {
  const def = GAP_FILL_ITEMS[item];
  if (!def) throw new Error(`--item が不正です: ${item}`);
  if (item === "st") {
    const [races, existing] = await Promise.all([
      read("races", "race_id", date, client),
      read(def.table, "race_id", date, client),
    ]);
    return buildStartTimingRows(day, {
      raceIds: new Set(races.map((r) => r.race_id)),
      withRows: new Set(existing.map((r) => r.race_id)),
    });
  }
  if (item === "exhibition") {
    const [races, existing] = await Promise.all([
      read("races", "race_id", date, client),
      read(def.table, "race_id, boat_number, exhibition_time", date, client),
    ]);
    return buildExhibitionRows(day, {
      raceIds: new Set(races.map((r) => r.race_id)),
      timeByKey: new Map(
        existing.map((r) => [
          `${r.race_id}|${r.boat_number}`,
          r.exhibition_time,
        ]),
      ),
    });
  }
  if (item === "race_status") {
    const rows = await read(def.table, "race_id, race_status", date, client);
    const rows2 = buildRaceStatusRows(
      day,
      new Map(rows.map((r) => [r.race_id, r.race_status ?? null])),
      out,
    );
    return rows2;
  }
  if (item === "conditions") {
    const rows = await read(def.table, def.columns.join(", "), date, client);
    return buildConditionsRows(day, new Map(rows.map((r) => [r.race_id, r])));
  }
  const rows = await read(
    def.table,
    "race_id, boat_number, racer_id, global_2rate, local_2rate",
    date,
    client,
  );
  return buildRate2Rows(
    day,
    new Map(rows.map((r) => [`${r.race_id}|${r.boat_number}`, r])),
  );
}

/**
 * 書く（--apply）。列の集合を検査してから、200行ずつ upsert する。
 * insert は既存の行に触れない（ignoreDuplicates）。update は対象の列だけを送る（既存の行の他の列は変わらない）。
 */
export async function writeRows(
  item,
  rows,
  {
    client = supabase,
    pause = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => new Date(),
  } = {},
) {
  const def = GAP_FILL_ITEMS[item];
  if (def.mode === "groupUpdate")
    return writeGrouped(def, rows, { client, pause });
  const at = now().toISOString();
  const stamped = def.stampUpdatedAt
    ? rows.map((r) => ({ ...r, updated_at: at }))
    : rows;
  assertColumnSet(
    stamped,
    def.stampUpdatedAt ? [...def.columns, "updated_at"] : def.columns,
  );
  let written = 0;
  for (let i = 0; i < stamped.length; i += BATCH) {
    if (i > 0) await pause(PAUSE_MS);
    const batch = stamped.slice(i, i + BATCH);
    const { error } = await client.from(def.table).upsert(batch, {
      onConflict: def.keyColumns.join(","),
      ignoreDuplicates: def.mode === "insert",
    });
    if (error) {
      throw new Error(
        `${def.table} の書き込みに失敗しました（${written}行は書き込み済み。再実行すれば残りだけ書く）: ${error.message}`,
      );
    }
    written += batch.length;
  }
  return written;
}

/**
 * 同じ値（キー以外の列）ごとにまとめて update().in(key) で書く（race_results のように NOT NULL の列が多く、
 * 対象の列だけの upsert ができない表）。nullGuardColumn が NULL の行だけを更新する（既存の値を上書きしない）。
 */
async function writeGrouped(def, rows, { client, pause }) {
  assertColumnSet(rows, def.columns);
  const key = def.keyColumns[0];
  const groups = new Map();
  for (const row of rows) {
    const { [key]: id, ...values } = row;
    const g = JSON.stringify(values);
    if (!groups.has(g)) groups.set(g, { values, ids: [] });
    groups.get(g).ids.push(id);
  }
  let written = 0;
  let calls = 0;
  for (const { values, ids } of groups.values()) {
    for (let i = 0; i < ids.length; i += BATCH) {
      if (calls++ > 0) await pause(PAUSE_MS);
      const chunk = ids.slice(i, i + BATCH);
      const { data, error } = await client
        .from(def.table)
        .update(values)
        .in(key, chunk)
        .is(def.nullGuardColumn, null)
        // 実際に更新した行を数える（既に値の入った行は条件で外れるので、chunk の件数とは限らない）
        .select(key);
      if (error) {
        throw new Error(
          `${def.table} の書き込みに失敗しました（${written}行は書き込み済み。再実行すれば残りだけ書く）: ${error.message}`,
        );
      }
      written += (data ?? []).length;
    }
  }
  return written;
}

function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

async function main() {
  if (!isSupabaseEnabled()) throw new Error("Supabaseが設定されていません");
  const item = getArg("item");
  const from = getArg("from");
  const to = getArg("to") ?? from;
  const dir = getArg("archive-dir") ?? DEFAULT_ARCHIVE_DIR;
  const apply = process.argv.includes("--apply");
  if (!GAP_FILL_ITEMS[item]) {
    throw new Error(
      `--item=${Object.keys(GAP_FILL_ITEMS).join("|")} を指定してください`,
    );
  }
  if (!DATE_RE.test(from ?? "") || !DATE_RE.test(to ?? "") || from > to) {
    throw new Error("--from=YYYY-MM-DD [--to=YYYY-MM-DD] を指定してください");
  }
  const def = GAP_FILL_ITEMS[item];
  console.log(
    `${apply ? "[APPLY]" : "[DRY-RUN]"} ${item}（${def.table}・${def.mode}・列 ${def.columns.join(",")}）${from}〜${to}`,
  );
  let total = 0;
  let written = 0;
  const out = { anomalies: [] };
  const tally = {};
  const missingDays = [];
  for (const date of datesBetween(from, to)) {
    const day = readParsedDay(dir, date);
    if (!day) {
      missingDays.push(date);
      continue;
    }
    const rows = await planDay(item, day, date, supabase, out);
    total += rows.length;
    for (const r of rows) {
      if (r.race_status) tally[r.race_status] = (tally[r.race_status] ?? 0) + 1;
    }
    if (rows.length > 0) console.log(`  ${date}: ${rows.length}行`);
    if (apply && rows.length > 0) written += await writeRows(item, rows);
  }
  console.log(
    `\n${apply ? "[APPLY]" : "[DRY-RUN]"} ${item}: 書く行 ${total}${apply ? `・書いた行 ${written}` : ""}${missingDays.length > 0 ? `・中間JSONの無い日 ${missingDays.length}（${missingDays.slice(0, 5).join(", ")}${missingDays.length > 5 ? " ほか" : ""}）` : ""}`,
  );
  if (Object.keys(tally).length > 0) {
    console.log(`  値の内訳: ${JSON.stringify(tally)}`);
  }
  if (out.anomalies.length > 0) {
    console.log(
      `  書かなかったレース（異常）: ${out.anomalies.length}件 ${JSON.stringify(out.anomalies.slice(0, 10))}${out.anomalies.length > 10 ? " ほか" : ""}`,
    );
  }
  if (missingDays.length > 0) process.exitCode = 1;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((e) => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
}
