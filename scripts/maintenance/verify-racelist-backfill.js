#!/usr/bin/env node
/**
 * verify-racelist-backfill.js - 出走表（racelist）過去分バックフィルCLIの検証
 *
 * DB・公式サイトに接続しない（fetch・DBクライアントは差し替える）。
 * 設計: docs/design/pre-race-full-fields/plan.md §6（N19）
 *
 * 検証観点:
 *   1. race_id の分解・URL・アーカイブパス（純関数）
 *   2. buildFillRow: 既存値がNULLの列だけを埋める（既に値のある列には、entryの値が異なっていても触れない）
 *   3. buildFillRowsForRace: 艇番での対応付け、対応の無い艇の検出
 *   4. loadTargetRaceIds: ページング・from/to絞り込み・重複排除（本番相当のフェイクSupabaseクライアント）
 *   5. CLI: 引数のパース・検証（日付形式・間隔の下限）
 *   6. 実ページのフィクスチャ（scripts/lib/__fixtures__/raceInfo/）で、欠場艇を含め全項目が解析できること
 *   7. load: 既存行の取得〜upsertまで（フェイククライアント）。DRY-RUNで書き込みが起きないこと、
 *      既に埋まっている列を含む行はupsertされないこと（列単位の上書き禁止の統合確認）
 *   8. 変異検証: buildFillRow の「既存値があれば上書きしない」判定を壊すと、検証が失敗する
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import {
  RACELIST_BACKFILL_COLUMNS,
  buildFillRow,
  buildFillRowsForRace,
  buildRacelistUrl,
  loadTargetRaceIds,
  parseRaceId,
  racelistArchiveRelPath,
} from "../lib/racelistBackfillRows.js";
import * as cli from "./racelist-backfill.js";
import { runRacelistBackfillScenes1, runRacelistBackfillScenes2 } from "./verifyData/racelist-backfill-scenes.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURES = path.join(ROOT, "scripts/lib/__fixtures__/raceInfo");

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.log(`❌ ${label}${detail ? `\n     ${detail}` : ""}`);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// 1. race_id の分解・URL・アーカイブパス
// ---------------------------------------------------------------------------

{
  const r = parseRaceId("2025-12-03-01-07");
  check(
    "parseRaceId: 日付・会場コード・レース番号に分解する",
    same(r, { date: "2025-12-03", venueCode: 1, raceNumber: 7 }),
    JSON.stringify(r),
  );
  let threw = false;
  try {
    parseRaceId("2025-12-03");
  } catch {
    threw = true;
  }
  check("parseRaceId: 形式が不正なら例外", threw);
}
{
  const url = buildRacelistUrl("2025-12-03-01-07");
  check(
    "buildRacelistUrl: rno・jcd（2桁）・hd（YYYYMMDD）を組み立てる",
    url ===
      "https://www.boatrace.jp/owpc/pc/race/racelist?rno=7&jcd=01&hd=20251203",
    url,
  );
}
{
  const url = buildRacelistUrl("2026-01-15-14-08");
  check(
    "buildRacelistUrl: 会場コード2桁・当日パディングなしのレース番号",
    url ===
      "https://www.boatrace.jp/owpc/pc/race/racelist?rno=8&jcd=14&hd=20260115",
    url,
  );
}
{
  const rel = racelistArchiveRelPath("2025-12-03-01-07", "html.gz");
  check(
    "racelistArchiveRelPath: 年月ディレクトリ + race_id + 拡張子",
    rel === "2025-12/2025-12-03-01-07.html.gz",
    rel,
  );
}

// ---------------------------------------------------------------------------
// 2〜3. buildFillRow / buildFillRowsForRace（最重要: 既存値の上書き禁止）
// ---------------------------------------------------------------------------

const existingAllNull = {
  race_id: "2025-12-03-01-07",
  boat_number: 1,
  global_3rate: null,
  local_3rate: null,
  motor_3rate: null,
  boat_3rate: null,
  f_count: null,
  l_count: null,
  weight_kg: null,
  branch: null,
  hometown: null,
  is_absent: null,
};
const entry = {
  boat_number: 1,
  racer_id: 4214,
  is_absent: false,
  global_3rate: 57.33,
  local_3rate: 80,
  motor_3rate: 49.57,
  boat_3rate: 0,
  f_count: 0,
  l_count: 0,
  weight_kg: 56.4,
  branch: "岡山",
  hometown: "岡山",
  // CLIが絶対に書いてはならない列（既存値を上書きするリスクがある列）。entryに含めても無視されるべき
  win_rate: 999,
  motor_number: 999,
  boat_number_id: 999,
};

{
  const row = buildFillRow(existingAllNull, entry);
  check(
    "buildFillRow: 既存が全てNULLなら、対象列を全て埋める",
    row &&
      RACELIST_BACKFILL_COLUMNS.every((c) => row[c] === entry[c]) &&
      row.race_id === "2025-12-03-01-07" &&
      row.boat_number === 1,
    JSON.stringify(row),
  );
  check(
    "buildFillRow: win_rate・motor_number・boat_number_id等、対象外の列は行に含めない",
    !("win_rate" in row) &&
      !("motor_number" in row) &&
      !("boat_number_id" in row),
    JSON.stringify(row),
  );
}
{
  // 実データで確認した状況の再現: global_3rateはNULLだが、motor_3rate・boat_3rateは既に別の値が入っている
  // （節の途中のモーター・ボート交換等で、再取得すると値が変わりうる列）。この2列には絶対に触れてはならない
  const existingPartial = {
    ...existingAllNull,
    motor_3rate: 49.57, // entryと同じ値でも、既存が非NULLなら書き込み対象に含めないのが正しい
    boat_3rate: 12.34, // entryの値(0)と異なる。ここが上書きされたら重大なバグ
  };
  const row = buildFillRow(existingPartial, entry);
  check(
    "buildFillRow: 既存値が非NULLの列（motor_3rate・boat_3rate）には触れない",
    row && !("motor_3rate" in row) && !("boat_3rate" in row),
    JSON.stringify(row),
  );
  check(
    "buildFillRow: 他のNULL列（global_3rate等）は引き続き埋める",
    row &&
      row.global_3rate === 57.33 &&
      row.f_count === 0 &&
      row.branch === "岡山",
    JSON.stringify(row),
  );
}
{
  // 全列が既に埋まっている行は、書く列が無いので null を返す（呼び出し側が除外できる）
  const existingFull = Object.fromEntries(
    RACELIST_BACKFILL_COLUMNS.map((c) => [c, c === "is_absent" ? false : 1]),
  );
  const row = buildFillRow(
    { race_id: "x", boat_number: 1, ...existingFull },
    entry,
  );
  check("buildFillRow: 埋める列が無ければ null を返す", row === null);
}
{
  // entry側の値がnull/undefined（出走表からも取れない）なら、既存がNULLでも書かない
  const row = buildFillRow(existingAllNull, {
    ...entry,
    global_3rate: null,
    f_count: undefined,
  });
  check(
    "buildFillRow: entry側もNULL/undefinedなら、その列は書かない",
    row &&
      !("global_3rate" in row) &&
      !("f_count" in row) &&
      "local_3rate" in row,
    JSON.stringify(row),
  );
}
{
  // is_absent=false は「値が無い」ではない（booleanのfalseを正しく埋める）
  const row = buildFillRow(existingAllNull, { ...entry, is_absent: false });
  check(
    "buildFillRow: is_absent=false を正しく埋める（falseをnull扱いしない）",
    row && row.is_absent === false,
    JSON.stringify(row),
  );
}
{
  const existingRows = [1, 2, 3, 4, 5, 6].map((boat_number) => ({
    ...existingAllNull,
    boat_number,
  }));
  const entries = [1, 2, 3, 5, 6].map((boat_number) => ({
    ...entry,
    boat_number,
  })); // 4号艇のentryが無い（解析漏れ等の異常系）
  const { rows, unmatchedBoats } = buildFillRowsForRace(existingRows, entries);
  check(
    "buildFillRowsForRace: 艇番で対応付け、対応の無い艇を検出する",
    rows.length === 5 && same(unmatchedBoats, [4]),
    JSON.stringify({ n: rows.length, unmatchedBoats }),
  );
}

// ---------------------------------------------------------------------------
// 4. loadTargetRaceIds（ページング・from/to・重複排除）
// ---------------------------------------------------------------------------

function fakeTargetClient(raceEntryRows) {
  return {
    from(table) {
      if (table !== "race_entries")
        throw new Error(`unexpected table ${table}`);
      let nullFilter = false;
      let orNullCols = null;
      let gte = null;
      let lte = null;
      const chain = {
        select() {
          return chain;
        },
        is(col, val) {
          if (col === "global_3rate" && val === null) nullFilter = true;
          return chain;
        },
        or(expr) {
          // 本番の PostgREST と同じ意味: カンマ区切りの「列.is.null」のいずれか
          const cols = expr.split(",").map((part) => {
            const m = /^([a-z_0-9]+)\.is\.null$/.exec(part);
            if (!m) throw new Error(`unexpected or() ${expr}`);
            return m[1];
          });
          orNullCols = cols;
          return chain;
        },
        order() {
          return chain;
        },
        gte(col, val) {
          if (col === "race_id") gte = val;
          return chain;
        },
        lte(col, val) {
          if (col === "race_id") lte = val;
          return chain;
        },
        async range(a, b) {
          let rows = raceEntryRows;
          if (nullFilter) rows = rows.filter((r) => r.global_3rate === null);
          if (orNullCols)
            rows = rows.filter((r) => orNullCols.some((c) => r[c] === null));
          if (gte !== null) rows = rows.filter((r) => r.race_id >= gte);
          if (lte !== null) rows = rows.filter((r) => r.race_id <= lte);
          rows = [...rows].sort(
            (x, y) =>
              (x.race_id > y.race_id ? 1 : x.race_id < y.race_id ? -1 : 0) ||
              x.boat_number - y.boat_number,
          );
          return { data: rows.slice(a, b + 1), error: null };
        },
      };
      return chain;
    },
  };
}

{
  // 3レース x 6艇 = 18行。うち1レースはglobal_3rateが埋まっている（対象外）
  const rows = [];
  for (const raceId of [
    "2025-12-01-01-01",
    "2025-12-02-01-01",
    "2025-12-03-01-01",
  ]) {
    for (let boat_number = 1; boat_number <= 6; boat_number++) {
      rows.push({
        race_id: raceId,
        boat_number,
        global_3rate: raceId === "2025-12-02-01-01" ? 50 : null,
      });
    }
  }
  const client = fakeTargetClient(rows);
  const ids = await loadTargetRaceIds(client, { pageSize: 1000 });
  check(
    "loadTargetRaceIds: global_3rateがNULLの行を持つレースだけを、重複なく返す",
    same(ids, ["2025-12-01-01-01", "2025-12-03-01-01"]),
    JSON.stringify(ids),
  );
}
{
  // BOA-417: 2026-02 以降は3連率が埋まっていて、F数だけが NULL のレースがある。これも対象にする。
  // 3連率・F数とも埋まっているレースは対象外
  const rows = [];
  for (const [raceId, g3, f] of [
    ["2026-03-01-01-01", 50, null],
    ["2026-03-01-01-02", 50, 0],
    ["2026-03-01-01-03", null, 1],
  ]) {
    for (let boat_number = 1; boat_number <= 6; boat_number++) {
      rows.push({
        race_id: raceId,
        boat_number,
        global_3rate: g3,
        f_count: f,
      });
    }
  }
  const ids = await loadTargetRaceIds(fakeTargetClient(rows), {
    pageSize: 1000,
  });
  check(
    "loadTargetRaceIds: 3連率が埋まっていても F数が NULL のレースは対象（BOA-417）。両方埋まったレースは対象外",
    same(ids, ["2026-03-01-01-01", "2026-03-01-01-03"]),
    JSON.stringify(ids),
  );
}
{
  const rows = [];
  for (const raceId of [
    "2025-12-01-01-01",
    "2025-12-05-01-01",
    "2025-12-10-01-01",
  ]) {
    rows.push({ race_id: raceId, boat_number: 1, global_3rate: null });
  }
  const client = fakeTargetClient(rows);
  const ids = await loadTargetRaceIds(client, {
    from: "2025-12-02",
    to: "2025-12-09",
  });
  check(
    "loadTargetRaceIds: from/toで絞り込む（race_idの文字列比較が日付順になる）",
    same(ids, ["2025-12-05-01-01"]),
    JSON.stringify(ids),
  );
}
{
  // ページング境界: pageSize=2 で 5行（重複あり）を3ページで読む
  const rows = [];
  for (let i = 1; i <= 5; i++) {
    const raceId = `2025-12-0${i}-01-01`;
    rows.push({ race_id: raceId, boat_number: 1, global_3rate: null });
    rows.push({ race_id: raceId, boat_number: 2, global_3rate: null });
  }
  const client = fakeTargetClient(rows);
  const ids = await loadTargetRaceIds(client, { pageSize: 2 });
  check(
    "loadTargetRaceIds: ページサイズより多い件数でも全件を取得する（重複排除・昇順）",
    ids.length === 5 && same(ids, [...ids].sort()),
    JSON.stringify(ids),
  );
}

// ---------------------------------------------------------------------------
// 5. CLI引数
// ---------------------------------------------------------------------------

{
  const opts = cli._internal.parseArgs(["plan"]);
  check(
    "parseArgs: 既定値（from/toなし、archiveDirはdata/racelist-backfill-archive）",
    opts.from === null &&
      opts.to === null &&
      opts.archiveDir.endsWith("data/racelist-backfill-archive") &&
      opts.dailyLimit === 2000,
    JSON.stringify(opts),
  );
}
{
  let threw = false;
  try {
    cli._internal.validateOptions(
      cli._internal.parseArgs(["plan", "--from=2025/12/01"]),
    );
  } catch {
    threw = true;
  }
  check("validateOptions: --fromの日付形式が不正なら例外", threw);
}
{
  let threw = false;
  try {
    cli._internal.validateOptions(
      cli._internal.parseArgs(["plan", "--from=2026-01-01", "--to=2025-12-01"]),
    );
  } catch {
    threw = true;
  }
  check("validateOptions: --from > --to なら例外", threw);
}

// ---- 後半の場面（verifyData/racelist-backfill-scenes.js） ----
runRacelistBackfillScenes1({ FIXTURES, check, existingAllNull, entry, withTmpArchive, writeParsedFixture });

async function withTmpArchive(fn) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "racelist-backfill-verify-"),
  );
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeParsedFixture(dir, raceId, entries) {
  const rel = racelistArchiveRelPath(raceId, "json.gz");
  const file = path.join(dir, "parsed", rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    zlib.gzipSync(
      JSON.stringify({
        schema: "racelist-backfill/v1",
        race_id: raceId,
        entries,
        anomalies: [],
      }),
    ),
  );
}

// ---- 後半の場面（verifyData/racelist-backfill-scenes.js） ----
await runRacelistBackfillScenes2({ FIXTURES, check, existingAllNull, entry, withTmpArchive, writeParsedFixture });

// ---------------------------------------------------------------------------

console.log(`\n${failures === 0 ? "✅ 全て合格" : `❌ ${failures}件失敗`}`);
process.exitCode = failures === 0 ? 0 : 1;
