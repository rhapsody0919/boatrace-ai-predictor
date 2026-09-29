#!/usr/bin/env node
/**
 * 管理画面 /admin/rules の運用成績（BOA-567）が、旧実装と同じ値を出すかを検証する。
 *
 * 旧実装: 画面が predictions（2026-01-16以降の standard）と race_results を全件ページングして
 *   ブラウザで集計していた（ruleMatchService.getTopPerformingRules / getOverallPerformance、
 *   adminRuleService.getWeeklyPerformance）。ルールは会場ごとのクロージャ（check 関数）だった。
 * 新実装: 集計は RPC get_admin_rule_performance（docs/db-migration/111）、整形は
 *   src/services/adminRulePerformance.js の shapeRulePerformance、ルールは src/config/venueRules.js。
 *
 * 旧実装は git の LEGACY_COMMIT から取り出し、supabase を anon クライアントに差し替えてそのまま実行する
 * （匿名の公開ポリシー is_shadow = false が効く、画面と同じ経路）。
 *
 * モード（どれか1つ以上）:
 *   --rules              ルールのデータ化の一致。旧クロージャ（getMatchingRules）と ruleMatches のマッチ集合を、
 *                        (a) 全会場×艇番の並び120通り×confidence の境界値×1〜12R の合成データ（DB不要）と
 *                        (b) 実データの全予想（standard・2026-01-16以降）で突き合わせる
 *   --print-sql          111 の関数本体（「-- BEGIN QUERY」〜「-- END QUERY」）に p_rules・p_start_date を
 *                        埋めた読み取り専用の SELECT を標準出力に出す（RPC の本番適用前の検証用）
 *   --sql-result <file>  上の SELECT の結果（jsonb 1値。JSON そのもの、または [{"列名": {...}}] 形式）を
 *                        新しい整形に通し、旧実装の出力と比べる。結果は日中に増えるので、SELECT の直後に実行する
 *   --rpc                本番の RPC を service key で呼び、旧実装と比べる（本番適用後）。旧実装→RPC の順に続けて実行する
 *
 * 実行例:
 *   node --env-file=.env.local scripts/maintenance/verify-admin-rule-performance.js --rules
 *   node --env-file=.env.local scripts/maintenance/verify-admin-rule-performance.js --rpc
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

// 旧実装の週の区切り（new Date(...).getDay()）はローカル時刻に依存する。画面の利用者と同じ JST で動かす
process.env.TZ = "Asia/Tokyo";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
// 旧実装（クロージャ・画面側集計）が残っている最後のコミット（BOA-567 の分岐元）
const LEGACY_COMMIT = "62748a2dfe4eec2f99b067da68c95f9eccd492d1";
const START_DATE = "2026-01-16";
const MIGRATION = path.join(
  ROOT,
  "docs/db-migration/111_admin_rule_performance_rpc.sql",
);

const { VENUE_RULES, ruleMatches, toRpcRules } = await import(
  pathToFileURL(path.join(ROOT, "src/config/venueRules.js")).href
);
const { shapeRulePerformance } = await import(
  pathToFileURL(path.join(ROOT, "src/services/adminRulePerformance.js")).href
);

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!["--rules", "--print-sql", "--sql-result", "--rpc"].some(has)) {
  console.error(
    "使い方: --rules | --print-sql | --sql-result <file> | --rpc（ファイル冒頭を参照）",
  );
  process.exit(2);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `環境変数 ${name} が未設定です（--env-file=.env.local を付けて実行する）`,
    );
  return value;
}

// ---------- SQL（111 の関数本体をそのまま使う） ----------
function buildReadOnlySql() {
  const source = readFileSync(MIGRATION, "utf8");
  const match = /-- BEGIN QUERY\n([\s\S]*?)\n-- END QUERY/.exec(source);
  if (!match)
    throw new Error(
      `${MIGRATION} に「-- BEGIN QUERY」〜「-- END QUERY」がありません`,
    );
  const rulesLiteral = `'${JSON.stringify(toRpcRules()).replaceAll("'", "''")}'::jsonb`;
  const body = match[1]
    .replace(/\bp_rules\b/g, rulesLiteral)
    .replace(/\bp_start_date\b/g, `'${START_DATE}'::date`);
  return `${body}\n;\n`;
}

if (has("--print-sql")) {
  process.stdout.write(buildReadOnlySql());
}

// ---------- 旧実装の読み込み ----------
let legacyDir;
async function loadLegacy() {
  if (legacyDir) return legacyDir.modules;
  const dir = mkdtempSync(path.join(os.tmpdir(), "legacy-rules-"));
  const show = (file) =>
    execFileSync("git", ["-C", ROOT, "show", `${LEGACY_COMMIT}:${file}`], {
      encoding: "utf8",
    });
  const stubSupabase = (source) => {
    const replaced = source.replace(
      /import \{ supabase \} from ['"]\.\/supabaseClient['"];?/,
      "const supabase = globalThis.__legacySupabase;",
    );
    if (replaced === source)
      throw new Error("旧実装の supabase の import を差し替えられませんでした");
    return replaced;
  };
  writeFileSync(
    path.join(dir, "ruleMatchService.mjs"),
    stubSupabase(show("src/services/ruleMatchService.js")),
  );
  writeFileSync(
    path.join(dir, "adminRuleService.mjs"),
    stubSupabase(show("src/services/adminRuleService.js")).replace(
      /from ['"]\.\/ruleMatchService['"]/,
      "from './ruleMatchService.mjs'",
    ),
  );
  globalThis.__legacySupabase = createClient(
    requireEnv("VITE_SUPABASE_URL"),
    requireEnv("VITE_SUPABASE_ANON_KEY"),
  );
  const modules = {
    rms: await import(
      pathToFileURL(path.join(dir, "ruleMatchService.mjs")).href
    ),
    ars: await import(
      pathToFileURL(path.join(dir, "adminRuleService.mjs")).href
    ),
  };
  legacyDir = { dir, modules };
  return modules;
}

async function runLegacyPerformance() {
  const { rms, ars } = await loadLegacy();
  const started = Date.now();
  // 旧画面（AdminRules.loadInitialData）と同じ呼び方
  const [rules, overall, weekly] = await Promise.all([
    rms.getTopPerformingRules({ minSamples: 0 }),
    rms.getOverallPerformance(),
    ars.getWeeklyPerformance(),
  ]);
  console.log(`旧実装: ${((Date.now() - started) / 1000).toFixed(1)}秒`);
  return { overall, rules, weekly };
}

// ---------- 比較 ----------
const failures = [];
function comparePerformance(label, legacy, shaped) {
  let compared = 0;
  const diffs = [];
  const eq = (where, a, b) => {
    compared += 1;
    if (a !== b)
      diffs.push(`${where}: 旧=${JSON.stringify(a)} 新=${JSON.stringify(b)}`);
  };
  const fields = (where, a, b) => {
    const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
    for (const key of keys) eq(`${where}.${key}`, a?.[key], b?.[key]);
  };
  fields("overall", legacy.overall, shaped.overall);
  eq("rules.length", legacy.rules.length, shaped.rules.length);
  // 並び順（回収率の降順・同率は定義順）も画面に出るので位置ごとに比べる
  legacy.rules.forEach((r, i) => fields(`rules[${i}]`, r, shaped.rules[i]));
  eq("weekly.length", legacy.weekly.length, shaped.weekly.length);
  legacy.weekly.forEach((w, i) => fields(`weekly[${i}]`, w, shaped.weekly[i]));

  console.log(
    `[${label}] 比較 ${compared} 値（overall ${Object.keys(legacy.overall).length}・ルール ${legacy.rules.length}件・週 ${legacy.weekly.length}件）、不一致 ${diffs.length}`,
  );
  console.log(
    `  total: samples=${shaped.overall.samples} hits=${shaped.overall.hits} payout=${shaped.overall.totalPayout} recovery=${shaped.overall.recovery}%`,
  );
  for (const d of diffs.slice(0, 30)) console.log(`  DIFF ${d}`);
  if (diffs.length > 0) failures.push(`${label}: 不一致 ${diffs.length} 値`);
}

function unwrapSqlResult(json) {
  // MCP・SQL Editor の出力 [{"jsonb_build_object": {...}}] と、値そのものの両方を受ける
  const value = Array.isArray(json) ? Object.values(json[0])[0] : json;
  return typeof value === "string" ? JSON.parse(value) : value;
}

if (has("--sql-result")) {
  const file = valueOf("--sql-result");
  if (!file) throw new Error("--sql-result にファイルを指定する");
  const raw = unwrapSqlResult(JSON.parse(readFileSync(file, "utf8")));
  const legacy = await runLegacyPerformance();
  comparePerformance(
    "SQL（111 の本体・読み取り専用）",
    legacy,
    shapeRulePerformance(raw, START_DATE),
  );
}

if (has("--rpc")) {
  const legacy = await runLegacyPerformance();
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_KEY");
  const started = Date.now();
  const response = await fetch(
    `${url}/rest/v1/rpc/get_admin_rule_performance`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_rules: toRpcRules(), p_start_date: START_DATE }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `RPC 呼び出しエラー: ${response.status} ${await response.text()}`,
    );
  }
  const text = await response.text();
  console.log(
    `RPC: ${((Date.now() - started) / 1000).toFixed(1)}秒・応答 ${text.length} バイト`,
  );
  comparePerformance(
    "RPC（本番）",
    legacy,
    shapeRulePerformance(JSON.parse(text), START_DATE),
  );
}

// ---------- ルールのデータ化の一致 ----------
function matchIdsNew(prediction, venueCode, raceNo) {
  return VENUE_RULES.filter((r) =>
    ruleMatches(r, prediction, venueCode, raceNo),
  )
    .map((r) => r.id)
    .sort()
    .join(",");
}
function matchIdsOld(rms, prediction, venueCode, raceNo) {
  return rms
    .getMatchingRules(prediction, venueCode, raceNo)
    .map((r) => r.id)
    .sort()
    .join(",");
}

function permutations(items, k) {
  if (k === 0) return [[]];
  return items.flatMap((x, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)], k - 1).map(
      (rest) => [x, ...rest],
    ),
  );
}

async function fetchAllPredictions(client) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client
      .from("predictions")
      .select("race_id, confidence, top_pick, top_2nd, top_3rd, predicted_at")
      .eq("model_id", "standard")
      .gte("predicted_at", START_DATE)
      .order("race_id")
      .order("predicted_at")
      .range(offset, offset + 999);
    if (error) throw new Error(`predictions の取得に失敗: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

if (has("--rules")) {
  const { rms } = await loadLegacy();
  const oldRuleIds = new Set();

  // (a) 合成データ（DB不要）
  const venues = Array.from({ length: 24 }, (_, i) =>
    String(i + 1).padStart(2, "0"),
  );
  const orders = permutations([1, 2, 3, 4, 5, 6], 3);
  const confidences = [null, 0, 50, 69.9, 70, 74.9, 75, 79.9, 80, 84.9, 85, 99];
  let synthetic = 0;
  let syntheticMatched = 0;
  const syntheticDiffs = [];
  for (const venueCode of venues) {
    for (const top3 of orders) {
      for (const confidence of confidences) {
        for (let raceNo = 1; raceNo <= 12; raceNo += 1) {
          const prediction = { confidence, topPick: top3[0], top3 };
          const a = matchIdsOld(rms, prediction, venueCode, raceNo);
          const b = matchIdsNew(prediction, venueCode, raceNo);
          synthetic += 1;
          if (a) {
            syntheticMatched += 1;
            a.split(",").forEach((id) => oldRuleIds.add(id));
          }
          if (a !== b && syntheticDiffs.length < 20) {
            syntheticDiffs.push(
              `${venueCode} ${raceNo}R conf=${confidence} ${top3.join("-")}: 旧=[${a}] 新=[${b}]`,
            );
          }
        }
      }
    }
  }
  console.log(
    `[ルール・合成] ${synthetic} 通り（うち旧でマッチあり ${syntheticMatched}）、不一致 ${syntheticDiffs.length}、旧で1回以上マッチしたルール ${oldRuleIds.size}/${VENUE_RULES.length}`,
  );
  syntheticDiffs.forEach((d) => console.log(`  DIFF ${d}`));
  if (syntheticDiffs.length > 0) failures.push("ルール・合成データで不一致");
  if (oldRuleIds.size !== VENUE_RULES.length)
    failures.push("合成データで一度もマッチしないルールがある");

  // (b) 実データの全予想
  const predictions = await fetchAllPredictions(globalThis.__legacySupabase);
  let pairs = 0;
  let matches = 0;
  const realDiffs = [];
  for (const p of predictions) {
    const [, , , venueCode, raceNoText] = p.race_id.split("-");
    const raceNo = parseInt(raceNoText);
    const prediction = {
      confidence: p.confidence,
      topPick: p.top_pick,
      top3: [p.top_pick, p.top_2nd, p.top_3rd],
    };
    const a = matchIdsOld(rms, prediction, venueCode, raceNo);
    const b = matchIdsNew(prediction, venueCode, raceNo);
    pairs += VENUE_RULES.length;
    if (a) matches += a.split(",").length;
    if (a !== b && realDiffs.length < 20)
      realDiffs.push(`${p.race_id}: 旧=[${a}] 新=[${b}]`);
  }
  console.log(
    `[ルール・実データ] 予想 ${predictions.length} 件 × ${VENUE_RULES.length} ルール = ${pairs} 組、マッチ ${matches}、不一致 ${realDiffs.length}`,
  );
  realDiffs.forEach((d) => console.log(`  DIFF ${d}`));
  if (realDiffs.length > 0) failures.push("ルール・実データで不一致");
}

if (legacyDir) rmSync(legacyDir.dir, { recursive: true, force: true });

if (has("--rules") || has("--sql-result") || has("--rpc")) {
  if (failures.length > 0) {
    console.error(`NG: ${failures.join(" / ")}`);
    process.exit(1);
  }
  console.log("OK: 旧実装と全値一致");
}
