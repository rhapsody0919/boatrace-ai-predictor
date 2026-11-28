/**
 * 選手の性別の表 racer_sex（214）の書き手。fan（期別成績、1=男・2=女）から、選手1人に1行を書く。
 * 設計: docs/design/data-gaps/db-draft.md §1.5（M5）。女子戦（facts の field_gender）の出所。
 *
 * 決まり（db-draft §1.5、system-architect 2026-11-28）:
 *   - 書くのは sex が 1・2 の行だけ（読めない値で既知の値を消さない）
 *   - 変わったかの比較は sex だけ。source_fan は比べない（比べると期ごとに全行を書き直す）。
 *     なので source_fan は「最初にその値を書いた fan」になる
 *   - 既にある値と男女が逆なら、書かずに警告を返す（fan の誤りか登番の付け替えか、人が見る）
 *   - updated_at は書き手が入れる（214 にトリガーは無い）
 * 呼び手: fanPeriodJob.js（毎日の Cron、racer_period_stats より先）と scripts/maintenance/racer-sex-backfill.js（過去分）
 */

export const RACER_SEX_TABLE = "racer_sex";
const PAGE = 1000;
const BATCH_SIZE = 500;

/** 解析した fan → racer_sex の行（純関数）。1・2 以外は数だけ返す。登番の重複は例外 */
export function buildRacerSexRows(fan) {
  const rows = [];
  let skipped = 0;
  const seen = new Set();
  for (const r of fan.records ?? []) {
    if (r.racer_id === null || r.racer_id === undefined) continue;
    if (seen.has(r.racer_id))
      throw new Error(`${fan.id}: 登番 ${r.racer_id} が重複しています`);
    seen.add(r.racer_id);
    if (r.sex !== 1 && r.sex !== 2) {
      skipped++;
      continue;
    }
    rows.push({ racer_id: r.racer_id, sex: r.sex, source_fan: fan.id });
  }
  return { rows, skipped };
}

/**
 * 既存の行と比べて、書く行・変わらない数・男女が逆の行を分ける（純関数）
 * @param {{racer_id: number, sex: number}[]} existing
 * @param {{racer_id: number, sex: number, source_fan: string}[]} rows
 * @param {string} updatedAt ISO 8601
 */
export function planRacerSexWrites(existing, rows, updatedAt) {
  const known = new Map(existing.map((e) => [e.racer_id, e.sex]));
  const toWrite = [];
  const conflicts = [];
  let unchanged = 0;
  for (const row of rows) {
    const before = known.get(row.racer_id);
    if (before === undefined) toWrite.push({ ...row, updated_at: updatedAt });
    else if (before === row.sex) unchanged++;
    else conflicts.push({ racer_id: row.racer_id, before, after: row.sex });
  }
  return { toWrite, unchanged, conflicts };
}

async function readAllRacerSex(client) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from(RACER_SEX_TABLE)
      .select("racer_id,sex")
      .order("racer_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error)
      throw new Error(`${RACER_SEX_TABLE} の取得に失敗: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/**
 * fan 1つ分を racer_sex へ書く。読み・書きの失敗は例外（呼び手は racer_period_stats を書かずに止まる）
 * @param {object} client Supabase（service_role）
 * @param {object} fan parseFanFile の戻り値・中間JSON
 * @param {{dryRun?: boolean, now?: Date}} [options] dryRun は数えるだけで書かない
 * @returns {Promise<{rows: number, skipped: number, written: number, unchanged: number, conflicts: object[], warnings: string[]}>}
 */
export async function syncRacerSex(
  client,
  fan,
  { dryRun = false, now = new Date() } = {},
) {
  const { rows, skipped } = buildRacerSexRows(fan);
  const existing = await readAllRacerSex(client);
  const { toWrite, unchanged, conflicts } = planRacerSexWrites(
    existing,
    rows,
    now.toISOString(),
  );
  let written = 0;
  if (!dryRun) {
    for (let i = 0; i < toWrite.length; i += BATCH_SIZE) {
      const part = toWrite.slice(i, i + BATCH_SIZE);
      const { error } = await client
        .from(RACER_SEX_TABLE)
        .upsert(part, { onConflict: "racer_id" });
      if (error)
        throw new Error(
          `${RACER_SEX_TABLE} への書き込みに失敗（${written}/${toWrite.length}行で停止）: ${error.message}`,
        );
      written += part.length;
    }
  }
  const warnings = conflicts.map(
    (c) =>
      `${fan.id}: 登番 ${c.racer_id} の性別が既存（${c.before}）と逆（${c.after}）のため書きません`,
  );
  return {
    rows: rows.length,
    skipped,
    written,
    unchanged,
    conflicts,
    warnings,
  };
}
