/**
 * hq の config/x-slots.json（X の日の枠の取り置きの正本）と、龍神の DB の写し（sns_x_kind_reserves・sns_x_send_control.daily_limit_x、
 * マイグレーション 182）を比べる。読み取りだけ。違えば直す SQL を出す（当てるのはオーナー、SQL Editor）。
 * 本番の送り手（Vercel）は hq のファイルを読めないので、DB の写しが送るときの正。hq が同じ Mac でこれを回して写しのずれを見る。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/x-slots-check.js <x-slots.json>
 * exit: 0 一致・1 違いがある（または取り置きの合計が上限を越える）・2 使い方・鍵の不足・読めない
 * 設計: docs/design/x-daily-slots/plan.md §2.1
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/**
 * hq の出し物の名前 → sns_auto_send_items.kind（数字で見たらは #1978 の research_image）。ここに無い名前は unknown として知らせる（黙って飛ばさない）
 */
export const HQ_KIND = {
  full_picture: "full_picture",
  today: "digest",
  finals: "finals_image",
  research_rank: "research_image",
};
const DOW = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

/** hq の reserve を表の行（kind・daily_count・weekdays）にする（純粋関数） */
export function hqReserveRows(config, extraKinds = {}) {
  const names = { ...HQ_KIND, ...extraKinds };
  const rows = [];
  const unknown = [];
  for (const [name, value] of Object.entries(config?.reserve ?? {})) {
    if (!names[name]) {
      unknown.push(name);
      continue;
    }
    const count = typeof value === "number" ? value : value?.count;
    const weekdays = Array.isArray(value?.weekdays)
      ? value.weekdays.map((d) => {
          if (!DOW[d]) throw new Error(`${name} の曜日 ${d} が不正`);
          return DOW[d];
        })
      : null;
    if (!Number.isInteger(count) || count < 0)
      throw new Error(`${name} の本数 ${count} が不正`);
    rows.push({ kind: names[name], daily_count: count, weekdays });
  }
  return { rows, unknown };
}

const sortedDays = (days) => (days ? [...days].sort((x, y) => x - y) : null);
const sameDays = (a, b) =>
  JSON.stringify(sortedDays(a)) === JSON.stringify(sortedDays(b));
const sqlDays = (days) => (days ? `'{${days.join(",")}}'` : "NULL");

/** /today の返信の型（親と返信の2本、どちらも kind=digest）に要る取り置き */
export const TODAY_REPLY_RESERVE = 2;

/**
 * hq の行と DB の行を比べ、違いの説明と直す SQL を返す（純粋関数）。各曜日の取り置きの合計が上限を越えるかも見る。
 * todayReplyEnabled（龍神の config/today-variants.json の reply_enabled）が true なのに /today（digest）の取り置きが2未満なら違いとして出す
 * （返信を始めたとき、取り置かれていない残りが無い日に親も返信も止まるのを先に見つける。hq 2026-10-27）
 */
export function reserveDiff(
  hqRows,
  dbRows,
  { hqLimit, dbLimit, todayReplyEnabled = false },
) {
  if (!Number.isInteger(hqLimit) || hqLimit < 1)
    throw new Error(`hq の daily_limit_x が不正（${hqLimit}）`);
  const lines = [];
  const sql = [];
  const db = new Map(dbRows.map((r) => [r.kind, r]));
  for (const row of hqRows) {
    const cur = db.get(row.kind);
    if (!cur) {
      lines.push(`DB に ${row.kind} の行が無い（hq ${row.daily_count}本）`);
      sql.push(
        `INSERT INTO public.sns_x_kind_reserves(kind, daily_count, weekdays) VALUES ('${row.kind}', ${row.daily_count}, ${sqlDays(row.weekdays)});`,
      );
    } else if (
      cur.daily_count !== row.daily_count ||
      !sameDays(cur.weekdays, row.weekdays)
    ) {
      lines.push(
        `${row.kind}: DB ${cur.daily_count}本（曜日 ${cur.weekdays ?? "毎日"}）・hq ${row.daily_count}本（曜日 ${row.weekdays ?? "毎日"}）`,
      );
      sql.push(
        `UPDATE public.sns_x_kind_reserves SET daily_count = ${row.daily_count}, weekdays = ${sqlDays(row.weekdays)}, updated_at = now() WHERE kind = '${row.kind}';`,
      );
    }
  }
  for (const cur of dbRows)
    if (!hqRows.some((r) => r.kind === cur.kind)) {
      lines.push(`DB の ${cur.kind}（${cur.daily_count}本）は hq に無い`);
      sql.push(
        `DELETE FROM public.sns_x_kind_reserves WHERE kind = '${cur.kind}';`,
      );
    }
  if (hqLimit !== dbLimit) {
    lines.push(`daily_limit_x: DB ${dbLimit}・hq ${hqLimit}`);
    sql.push(
      `UPDATE public.sns_x_send_control SET daily_limit_x = ${hqLimit} WHERE id = true;`,
    );
  }
  if (todayReplyEnabled)
    for (const [where, rows] of [
      ["hq", hqRows],
      ["DB", dbRows],
    ]) {
      const count = rows.find((r) => r.kind === "digest")?.daily_count ?? 0;
      if (count < TODAY_REPLY_RESERVE)
        lines.push(
          `/today の返信の型が有効（config/today-variants.json の reply_enabled=true）なのに、${where} の digest の取り置きが ${count}（2本要る。親と返信が止まる）`,
        );
    }
  for (let dow = 1; dow <= 7; dow++) {
    const sum = hqRows
      .filter((r) => !r.weekdays || r.weekdays.includes(dow))
      .reduce((n, r) => n + r.daily_count, 0);
    if (sum > hqLimit)
      lines.push(
        `曜日 ${dow}（1=月）の取り置きの合計 ${sum} が上限 ${hqLimit} を越える（後から送る出し物が止まる）`,
      );
  }
  return { ok: lines.length === 0, lines, sql };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error(
      "使い方: node --env-file=.env.local scripts/sns/x-slots-check.js <x-slots.json>",
    );
    process.exit(2);
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が無い（.env.local）");
    process.exit(2);
  }
  const get = async (p) => {
    const response = await fetch(`${url}/rest/v1/${p}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!response.ok)
      throw new Error(
        `DB を読めない: HTTP ${response.status} ${p.split("?")[0]}（182 の適用前なら表が無い）`,
      );
    return response.json();
  };
  try {
    const config = JSON.parse(await readFile(file, "utf8"));
    const { rows, unknown } = hqReserveRows(config);
    const dbRows = await get(
      "sns_x_kind_reserves?select=kind,daily_count,weekdays",
    );
    const [control] = await get("sns_x_send_control?select=daily_limit_x");
    const todayVariants = JSON.parse(
      await readFile(
        new URL("../../config/today-variants.json", import.meta.url),
        "utf8",
      ),
    );
    const diff = reserveDiff(rows, dbRows, {
      hqLimit: config.daily_limit_x,
      dbLimit: control?.daily_limit_x ?? null,
      todayReplyEnabled: todayVariants.reply_enabled === true,
    });
    for (const name of unknown)
      diff.lines.push(
        `hq の ${name} に対応する kind が未定（x-slots-check.js の HQ_KIND に足す）`,
      );
    if (!diff.lines.length) {
      console.log("一致: hq の取り置きと DB の写しは同じ");
      return;
    }
    console.log(diff.lines.join("\n"));
    if (diff.sql.length)
      console.log(
        `\n直す SQL（オーナー、SQL Editor）:\n${diff.sql.join("\n")}`,
      );
    process.exit(1);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
