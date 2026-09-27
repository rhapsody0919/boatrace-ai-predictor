#!/usr/bin/env node
/**
 * race_entries の branch・hometown を racer_profiles から復旧するCLI
 *
 * 【なぜ要るか】2026-09-27、N19（racelist-backfill）の load で、`upsertChangedRows` の
 * バッチ送信の欠陥により、既存の branch・hometown が 1,729行で NULL に上書きされた。
 * PostgREST のバルク upsert は1リクエスト内でカラムを揃える必要があるため、キーの集合が
 * 異なる行を混ぜると、その列を持たない行に NULL が書かれる（`buildFillRow` は「既存値が
 * NULLの列だけ」を行に入れるため、行ごとにキーの集合が変わる）。欠陥自体は
 * `scripts/lib/unchangedRows.js` の `diffRows` で修正済み（payload の列にそろえる）。
 *
 * branch・hometown は選手の属性で、DB内の正本は `racer_profiles`。ここから引き直せば戻せる。
 * レースごとに変わる列（weight_kg・f_count・l_count・is_absent）はここでは扱わない
 * （出走表アーカイブからの再 load で埋める）。
 *
 * 【新規の公式サイトアクセスは無い】（DBの読み書きのみ）。既定はDRY-RUNで、--apply のときだけ書く。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/restore-entries-branch-hometown.js          # 検証のみ
 *   node --env-file=.env.local scripts/maintenance/restore-entries-branch-hometown.js --apply  # 書き込み（要承認）
 *
 * オプション:
 *   --since=<ISO8601>  この時刻以降に更新された行だけを対象にする（既定: 全期間）
 *   --limit=<n>        対象の上限（動作確認用）
 */
import { fetchAll, supabase } from "../lib/supabaseClient.js";
import { upsertChangedRows } from "../lib/unchangedRows.js";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const APPLY = process.argv.includes("--apply");
const SINCE = arg("since", null);
const LIMIT = Number(arg("limit", "0")) || null;

/** branch か hometown が NULL で、racer_id がある行 */
async function loadTargets() {
  const rows = await fetchAll(
    "race_entries",
    "race_id, boat_number, racer_id, branch, hometown",
    (q) => {
      let query = q
        .not("racer_id", "is", null)
        .or("branch.is.null,hometown.is.null")
        .order("race_id")
        .order("boat_number");
      if (SINCE) query = query.gte("updated_at", SINCE);
      return query;
    },
    { throwOnError: true },
  );
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

/** 対象の racer_id 分の racer_profiles をまとめて引く */
async function loadProfiles(racerIds) {
  const ids = [...racerIds];
  const profiles = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = await fetchAll(
      "racer_profiles",
      "racer_id, branch, hometown",
      (q) => q.in("racer_id", chunk).order("racer_id"),
      { throwOnError: true },
    );
    for (const r of rows) profiles.set(r.racer_id, r);
  }
  return profiles;
}

async function main() {
  const targets = await loadTargets();
  const profiles = await loadProfiles(new Set(targets.map((r) => r.racer_id)));

  const rows = [];
  let noProfile = 0;
  let nothingToFill = 0;
  for (const t of targets) {
    const p = profiles.get(t.racer_id);
    if (!p) {
      noProfile++;
      continue;
    }
    const branch = t.branch ?? p.branch ?? null;
    const hometown = t.hometown ?? p.hometown ?? null;
    if (branch === t.branch && hometown === t.hometown) {
      nothingToFill++;
      continue;
    }
    rows.push({
      race_id: t.race_id,
      boat_number: t.boat_number,
      branch,
      hometown,
    });
  }

  console.log(
    JSON.stringify(
      {
        since: SINCE,
        targetsWithNull: targets.length,
        rowsToRestore: rows.length,
        skippedNoProfile: noProfile,
        skippedNothingToFill: nothingToFill,
      },
      null,
      2,
    ),
  );

  if (rows.length === 0) {
    console.log("\n復旧できる行がありません。");
    return 0;
  }

  const result = await upsertChangedRows(supabase, "race_entries", rows, {
    onConflict: "race_id,boat_number",
    keyColumns: ["race_id", "boat_number"],
    chunkColumn: "race_id",
    label: "race_entries（支部・出身地の復旧）",
    dryRun: !APPLY,
    stampUpdatedAt: true,
  });
  console.log(
    JSON.stringify(
      { written: result.written, skipped: result.skipped, stats: result.stats },
      null,
      2,
    ),
  );
  if (result.error) {
    console.error(`書き込みに失敗しました: ${result.error.message}`);
    return 1;
  }
  if (!APPLY)
    console.log(
      "\n実際に書き込むには --apply を付けて再実行してください（要承認）。",
    );
  return 0;
}

process.exit(await main());
