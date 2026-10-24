/**
 * /today の X 投稿の「型の列」（日付→その日の型の中身）を sns_today_type_schedule（マイグレーション 174）に入れる（PD02、2026-10-25）。
 * hq の毎日の PDCA（~/hq/platform/pdca_daily.py）が週1回、先の7日分を作って実行する（push-full-picture.js と同じく、
 * 同じ Mac の本リポジトリで、鍵は本リポジトリの .env.local の SUPABASE_URL・SUPABASE_SERVICE_KEY だけ）。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/push-today-types.js <型の列の JSON> [--dry-run]
 *
 * JSON: { "types": [ { "day": "YYYY-MM-DD", "type_id": "t03-conclusion-heading",
 *                      "post": { "heading": "…{date}…", "link_lead": "…", "link_position": "after_heading|end|reply" } } ] }
 *   post に書けるのは heading（必須、1行・80字まで・{date} を含む）・link_lead（リンクと同じ行の前の文、80字まで）・
 *   link_position（既定 after_heading）だけ。ほかの項目（thumb 等）は作れない型として、その行を入れない（type_unsupported:<項目>）
 *
 * 1. 検査: 形（snsTodayVariants.js の normalizeTypeScheduleRow、cron が読むときと同じ）・日付（JST の今日〜13日後、同じ日の重複なし）・
 *    禁止表現（risk-rules.json）。1行でも落ちたら何も入れない（hq が直して入れ直す）。--dry-run はここまで
 * 2. 日付ごとに upsert（同じ日の行は置き換える）。今日より前の行は書かない（送った日の型は下書きの source_data.content_type に残る）
 *
 * cron は、行が無い・壊れている日は config/today-variants.json の a・b で送る（止めない）。返信（reply）は自動（mode=auto）の日だけ
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { matchRiskRules } from "../lib/riskRuleMatcher.js";
import { normalizeTypeScheduleRow } from "../lib/snsTodayVariants.js";

export const SCHEDULE_MAX_AHEAD_DAYS = 13;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const jstToday = (now) =>
  new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
const addDays = (day, n) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);

/**
 * 型の列を検査する（純粋関数）。返り値 { rows, reasons }。reasons が空のときだけ rows を入れる
 */
export function checkTypeSchedule(
  input,
  { now = new Date(), riskRules = [] } = {},
) {
  const items = Array.isArray(input?.types) ? input.types : null;
  if (!items || !items.length)
    return { rows: [], reasons: ["types が空か配列でない"] };
  const today = jstToday(now);
  const last = addDays(today, SCHEDULE_MAX_AHEAD_DAYS);
  const reasons = [];
  const rows = [];
  const seen = new Set();
  for (const [i, item] of items.entries()) {
    const at = `types[${i}]${item?.day ? `（${item.day}）` : ""}`;
    // 暦に無い日（2026-02-30 等。Date.parse は 3/2 にずらして受ける）も落とす
    if (
      !DAY.test(item?.day ?? "") ||
      Number.isNaN(Date.parse(item.day)) ||
      new Date(`${item.day}T00:00:00Z`).toISOString().slice(0, 10) !== item.day
    ) {
      reasons.push(`${at}: day が YYYY-MM-DD でない`);
      continue;
    }
    if (item.day < today || item.day > last) {
      reasons.push(
        `${at}: day は ${today}〜${last}（JST の今日〜${SCHEDULE_MAX_AHEAD_DAYS}日後）`,
      );
      continue;
    }
    if (seen.has(item.day)) {
      reasons.push(`${at}: 同じ日が2回ある`);
      continue;
    }
    seen.add(item.day);
    const checked = normalizeTypeScheduleRow(item, item.day);
    if (!checked.post) {
      reasons.push(`${at}: ${checked.reason}`);
      continue;
    }
    const hits = matchRiskRules(
      [checked.post.heading, checked.post.link_lead ?? ""].map((text) => ({
        text,
        field: "body",
      })),
      "x",
      riskRules,
    );
    if (hits.length) {
      reasons.push(`${at}: 禁止表現 ${hits.map((h) => h.id).join(",")}`);
      continue;
    }
    rows.push({
      day: item.day,
      type_id: checked.type_id,
      post: checked.post,
      source: "hq",
      updated_at: now.toISOString(),
    });
  }
  return { rows, reasons };
}

/** PostgREST の upsert（service_role）。失敗は投げる */
export async function upsertTypeSchedule(
  rows,
  { url, key, fetchImpl = fetch },
) {
  const response = await fetchImpl(
    `${url}/rest/v1/sns_today_type_schedule?on_conflict=day`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(rows),
    },
  );
  if (!response.ok)
    throw new Error(
      `型の列を入れられない: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`,
    );
  return response.json();
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error(
      "使い方: node --env-file=.env.local scripts/sns/push-today-types.js <型の列の JSON> [--dry-run]",
    );
    process.exit(2);
  }
  const riskRules = JSON.parse(
    await readFile(
      new URL(
        "../../sns-video-studio/remotion/risk-rules.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).rules;
  let input;
  try {
    input = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    console.error(`型の列の JSON を読めない: ${error.message}`);
    process.exit(1);
  }
  const { rows, reasons } = checkTypeSchedule(input, { riskRules });
  if (reasons.length) {
    console.log(JSON.stringify({ ok: false, reasons }, null, 2));
    process.exit(1);
  }
  if (dryRun) {
    console.log(JSON.stringify({ ok: true, dry_run: true, rows }, null, 2));
    return;
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が無い（.env.local）");
    process.exit(2);
  }
  const saved = await upsertTypeSchedule(rows, { url, key });
  console.log(
    JSON.stringify(
      { ok: true, days: saved.map((r) => `${r.day} ${r.type_id}`) },
      null,
      2,
    ),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
