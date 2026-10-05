/**
 * verify-winning-technique-filled.js - 前日以前のレースで、決まり手（race_results.winning_technique）が欠けていないか（BOA-749）
 *
 * 決まり手は、結果の取得のときに書けないまま残ることがある（2026-09-16 住之江7R: 着順・払戻はあるのに NULL）。
 * 分析（決まり手の傾向・展開予測の検証）では、黙って集計から落ちる。欠けを毎晩見つけ、取り直しのコマンドを出す。
 *
 * 欠けの条件（findMissingTechniques）: 前日以前・race_status が no_race 以外（不成立は決まり手が無いのが正しい）・
 * is_cancelled でない・rank1 あり・winning_technique が NULL。
 *
 *   (a) 判定（純関数）: DBに接続せずに検証する。Quality Gates（PRごと）ではこれだけを実行する
 *   (b) 本番の検知: 環境変数 VERIFY_PRODUCTION=1 のときだけ、本番の race_results を読む（読み取りのみ）。
 *       欠けが1件でもあれば exit 1。nightly-verify-db.yml が毎晩（JST 3:00）実行し、失敗を Slack に流す。
 *       明示を要るようにしているのは、supabaseClient.js が .env.local を自分で読むため。手元の npm run verify:ci が
 *       本番データの状態で赤くならないようにする
 *
 * 直し方: 出力の audit-race-result-anomalies.js --apply（公式の結果ページを取り直し、空の決まり手だけを埋める）を
 * ユーザーが実行する（本番への書き込み）。
 *
 * 実行: node scripts/maintenance/verify-winning-technique-filled.js
 *       VERIFY_PRODUCTION=1 node --env-file=.env.local scripts/maintenance/verify-winning-technique-filled.js   # 本番も見る
 */
import { fileURLToPath } from "node:url";
import {
  fetchAll,
  isSupabaseEnabled,
  supabase,
} from "../lib/supabaseClient.js";

const todayJST = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );

/**
 * 決まり手が欠けているレースを選ぶ（純関数）。
 * @param {Array<{race_id: string, race_status?: string|null, is_cancelled?: boolean|null, rank1?: number|null, winning_technique?: string|null}>} rows
 * @param {string} today YYYY-MM-DD（この日より前だけを見る。当日分は結果の取得中のため）
 * @returns {string[]} race_id（昇順）
 */
export function findMissingTechniques(rows, today) {
  return rows
    .filter(
      (r) =>
        r.race_id.slice(0, 10) < today &&
        r.race_status !== "no_race" &&
        r.is_cancelled !== true &&
        r.rank1 !== null &&
        r.rank1 !== undefined &&
        (r.winning_technique === null || r.winning_technique === undefined),
    )
    .map((r) => r.race_id)
    .sort();
}

/** 取り直しのコマンド（--apply は既定で30件まで） */
export function buildFixCommands(raceIds, maxPerRun = 30) {
  const commands = [];
  for (let i = 0; i < raceIds.length; i += maxPerRun) {
    const chunk = raceIds.slice(i, i + maxPerRun);
    commands.push(
      `node --env-file=.env.local scripts/maintenance/audit-race-result-anomalies.js --apply --race-ids=${chunk.join(",")} --confirm=${chunk.length}`,
    );
  }
  return commands;
}

function selfTest() {
  let failures = 0;
  const check = (label, pass, detail = "") => {
    if (pass) console.log(`✅ ${label}`);
    else {
      failures++;
      console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
    }
  };
  const row = (id, extra = {}) => ({
    race_id: id,
    race_status: "normal",
    is_cancelled: false,
    rank1: 3,
    winning_technique: null,
    ...extra,
  });
  const rows = [
    row("2026-09-16-12-07"), // 欠け（実例）
    row("2026-09-16-12-08", { winning_technique: "逃げ" }), // 決まり手あり
    row("2026-09-17-01-01", { race_status: "no_race" }), // 不成立は対象外
    row("2026-09-17-01-02", { rank1: null }), // 着順なし（結果待ち・中止）は対象外
    row("2026-09-17-01-03", { is_cancelled: true }), // 中止は対象外
    row("2026-10-04-01-01"), // 当日は対象外（取得中）
    row("2026-09-18-01-01", { race_status: "partial_refund" }), // 一部返還でも決まり手はある → 欠け
    row("2026-09-18-01-02", { race_status: null }), // 状態不明（078以前）も欠け扱い
  ];
  const found = findMissingTechniques(rows, "2026-10-04");
  check(
    "(a) 判定: 前日以前・不成立以外・中止でない・1着あり・決まり手 NULL だけを選ぶ",
    JSON.stringify(found) ===
      JSON.stringify([
        "2026-09-16-12-07",
        "2026-09-18-01-01",
        "2026-09-18-01-02",
      ]),
    JSON.stringify(found),
  );
  const ids = Array.from({ length: 31 }, (_, i) => `2026-09-01-01-${i}`);
  const commands = buildFixCommands(ids);
  check(
    "(a) 取り直しのコマンド: --apply の上限（30件）ごとに分け、--confirm を件数と一致させる",
    commands.length === 2 &&
      commands[0].endsWith("--confirm=30") &&
      commands[1].endsWith("--confirm=1"),
    commands.map((c) => c.slice(-12)).join(" / "),
  );
  return failures;
}

async function checkProduction() {
  const today = todayJST();
  // 読み取りのみ。NULL の行だけを読む（件数は通常0〜数件）
  const rows = await fetchAll(
    "race_results",
    "race_id, race_status, is_cancelled, rank1, winning_technique",
    (q) =>
      q
        .is("winning_technique", null)
        .not("rank1", "is", null)
        .lt("race_id", today)
        .order("race_id"),
  );
  const missing = findMissingTechniques(rows, today);
  if (missing.length === 0) {
    console.log(
      `✅ (b) 本番: ${today} より前のレースに、決まり手の欠けは無い（決まり手 NULL・1着ありの ${rows.length}件はすべて不成立・中止）`,
    );
    return 0;
  }
  console.error(
    `❌ (b) 本番: 決まり手が欠けているレースが ${missing.length}件ある（${today} より前・不成立以外・1着あり）`,
  );
  for (const id of missing) console.error(`  ${id}`);
  console.error(
    "直し方（本番への書き込み。公式の結果ページを取り直し、空の決まり手だけを埋める）:",
  );
  for (const c of buildFixCommands(missing)) console.error(`  ${c}`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let failures = selfTest();
  if (process.env.VERIFY_PRODUCTION === "1") {
    if (!isSupabaseEnabled() || !supabase) {
      console.error(
        "❌ (b) VERIFY_PRODUCTION=1 だが、Supabase の環境変数（SUPABASE_URL・SUPABASE_SERVICE_KEY）が無い",
      );
      failures++;
    } else {
      failures += await checkProduction();
    }
  } else {
    console.log(
      "（(b) 本番の検知は VERIFY_PRODUCTION=1 のときだけ。nightly-verify-db.yml が毎晩実行する）",
    );
  }
  if (failures > 0) {
    console.error(`\n${failures}件の検証が失敗しました`);
    process.exit(1);
  }
  console.log("\nALL OK");
}
