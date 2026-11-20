/**
 * verify-race-result-parser.js - 結果ページの全項目パーサー・艇別/払戻明細の行・DDL案・書き込み経路・Q6の監査の検証
 * （docs/design/race-result-full-fields/plan.md）。DBにも取得先にも接続しない（フィクスチャとインメモリのクライアントだけ）。
 *
 * 確認すること:
 *   (a) 全項目の解析: 実ページ（フィクスチャ12件+既存2件）で、着欄の生表記・完走の着・進入・レースタイム・返還艇・備考・
 *       払戻明細（同着の複数口・特払・不成立）・レースの状態が、公式ページの表示どおりに取れる
 *   (b) 実進入: 進入コース（スタート情報の行順）が、本番DBの actual_course（Kファイル由来）と全フィクスチャで一致する
 *   (c) 旧解析との互換: 旧実装（凍結。__fixtures__/raceresult/legacyParseRaceResultHtml.js）と、rank1〜3・レースタイム・
 *       払戻・人気・進入・ST・決まり手・気象が同じ。違うのは、非完走艇の rank4〜6 と、不成立の払戻だけ
 *   (d) 行の組み立て: 旧形式（077未適用）と拡張（適用済み）。払戻明細の行が、DDL案（079）のCHECKの意味に合う
 *   (e) 書き込み経路: 077〜079が未適用のDBで、旧実装と同じ列だけを書き、壊れない。適用済みのDBで、全艇の行・払戻明細・
 *       race_status を書く。再実行は書き込み0件（変更の無い行は書かない）。確認の通信エラーは、旧形式で書く
 *   (f) DDL案とコードの整合: 077〜079が追加する列・CHECKの値が、コードが書く列・値と一致する
 *   (g) Q6の監査: DBの行だけで分かる範囲の判定・Kファイルとの突合・修正計画（変更のある列だけ書く）・--apply の中止条件
 *   (h) 変異検証: パーサー・行の組み立てを壊した版で、上の検証が失敗する
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRaceResultRow, ResultHttpError } from "../daily/scrape-results.js";
import * as realParser from "../lib/raceResultParser.js";
import * as realRows from "../lib/raceResultRows.js";


import { applyFixPlan } from "../lib/raceResultFix.js";
import { runApply } from "./audit-race-result-anomalies.js";


import { createSchemaAwareDb } from "./verifyData/race-result-parser-db.js";
import {
  LEGACY_TIMING_COLUMNS,
  NEW_TIMING_COLUMNS,
  NEW_RESULT_COLUMNS,
  PAYOUT_COLUMNS,
  RACE_F4,
  RACE_ABSENT,
  runRaceResultParserScenes2,
  runRaceResultParserScenes3,
  runRaceResultParserScenes4,
} from "./verifyData/race-result-parser-scenes-2.js";
import { runRaceResultParserScenes1 } from "./verifyData/race-result-parser-scenes-1.js";
import { runRaceResultParserScenes5, runRaceResultParserScenes6 } from "./verifyData/race-result-parser-scenes-3.js";
import { runRaceResultParserScenes7 } from "./verifyData/race-result-parser-scenes-4.js";
import { runRaceResultParserScenes8 } from "./verifyData/race-result-parser-scenes-5.js";
import {
  runRaceResultParserScenes9,
  runRaceResultParserScenes10,
  runRaceResultParserScenes11,
  runRaceResultParserScenes12,
} from "./verifyData/race-result-parser-scenes-6.js";

// 検証対象のコードが出す警告・進捗のログで出力が埋まらないよう、検証中は無効にし、結果の表示だけ元の関数で行う
const printOut = console.log.bind(console);
const printErr = console.error.bind(console);
console.log = () => {};
console.warn = () => {};
console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    printOut(`✅ ${label}`);
  } else {
    failures++;
    printErr(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const same = (a, b) => show(a) === show(b);

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const FIXTURE_DIR = path.join(ROOT, "scripts/lib/__fixtures__/raceresult");
const readFixture = (name) =>
  fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");

// ---- 後半の場面（verifyData/race-result-parser-scenes-1.js） ----
runRaceResultParserScenes1({ printOut, check, readFixture });

// 個別の重要な値（評価に埋もれないよう、実例を明示して確認する）
const full = (file) => realParser.parseRaceResultPage(readFixture(file));

// ---- 後半の場面（verifyData/race-result-parser-scenes-2.js） ----
runRaceResultParserScenes2({ check, same, readFixture, full });
const LEGACY_RESULT_COLUMNS = Object.keys(
  buildRaceResultRow(
    "R",
    realRows.toLegacyResult(full("raceresult-2026-09-19-05-01.html")),
  ),
);

// ---- 後半の場面（verifyData/race-result-parser-scenes-2.js） ----
runRaceResultParserScenes3({ check, same, readFixture, full });
const HTML_BY_RACE = {
  [RACE_F4]: readFixture("raceresult-2026-09-19-02-09-refund-f4.html"),
  [RACE_ABSENT]: readFixture("raceresult-2026-09-16-23-12-absent.html"),
};
const RACES = [
  {
    race_id: RACE_F4,
    venue_code: 2,
    race_number: 9,
    start_time: new Date("2026-09-19T05:00:00Z"),
  },
  {
    race_id: RACE_ABSENT,
    venue_code: 23,
    race_number: 12,
    start_time: new Date("2026-09-16T05:00:00Z"),
  },
].map((r) => ({ ...r }));
const fetchHtmlFor = async (url) => {
  if (url.includes("jcd=02") && url.includes("rno=9"))
    return HTML_BY_RACE[RACE_F4];
  if (url.includes("jcd=23") && url.includes("rno=12"))
    return HTML_BY_RACE[RACE_ABSENT];
  throw new Error(`想定外のURL: ${url}`);
};
const seedRaces = RACES.map((r) => ({
  race_id: r.race_id,
  start_time: "10:00",
}));

// ---- 後半の場面（verifyData/race-result-parser-scenes-2.js・race-result-parser-scenes-3.js） ----
runRaceResultParserScenes4({ check, same, readFixture, full, RACES, fetchHtmlFor });
await runRaceResultParserScenes5({ check, show, same, readFixture, full, LEGACY_RESULT_COLUMNS, RACES, fetchHtmlFor, seedRaces });

// 適用済み（077〜079）
const fullColumns = {
  race_results: LEGACY_RESULT_COLUMNS.concat(
    ["created_at"],
    NEW_RESULT_COLUMNS,
  ),
  race_start_timings: LEGACY_TIMING_COLUMNS.concat(NEW_TIMING_COLUMNS),
  race_payouts: PAYOUT_COLUMNS,
};

// ---- 後半の場面（verifyData/race-result-parser-scenes-3.js） ----
await runRaceResultParserScenes6({ check, show, same, readFixture, full, LEGACY_RESULT_COLUMNS, RACES, fetchHtmlFor, seedRaces, fullColumns });

const K190415_TEXT = fs.readFileSync(
  path.join(ROOT, "scripts/lib/__fixtures__/kbfile/k190415.txt"),
  "utf8",
);
// ---------------------------------------------------------------------------
// (f) DDL案とコードの整合
// ---------------------------------------------------------------------------
// (f)・(g) の本文の読みは verify に置く（(f)・(g) の塊は verifyData/ へ移すため。読む物と回数は前と同じ）
const sql = (name) =>
  fs.readFileSync(path.join(ROOT, "docs/db-migration", name), "utf8");

// ---- 後半の場面（verifyData/race-result-parser-scenes-4.js・race-result-parser-scenes-5.js・race-result-parser-scenes-6.js） ----
runRaceResultParserScenes7({ check, show, same, full, sql });
runRaceResultParserScenes8({ printOut, check, show, same, K190415_TEXT });
runRaceResultParserScenes9({ printOut, check, show, same, full, LEGACY_RESULT_COLUMNS, seedRaces, withMutant });
{
  // --apply: 実行の流れ（インメモリ）。汚れた2レースを直す。2回目は変更なし
  const dirtyF4 = {
    race_id: RACE_F4,
    ...buildRaceResultRow(
      RACE_F4,
      realRows.toLegacyResult(
        full("raceresult-2026-09-19-02-09-refund-f4.html"),
      ),
    ),
    rank4: 4,
    rank5: 5,
    rank6: 6,
    payout_trifecta: 100,
    payout_trio: 100,
    race_status: null,
    refund_boats: null,
    remark: null,
  };
  const dirtyAbs = {
    race_id: RACE_ABSENT,
    ...buildRaceResultRow(
      RACE_ABSENT,
      realRows.toLegacyResult(full("raceresult-2026-09-16-23-12-absent.html")),
    ),
    rank6: 1,
    race_status: null,
    refund_boats: null,
    remark: null,
  };
  const db = createSchemaAwareDb(
    { races: seedRaces, race_results: [dirtyF4, dirtyAbs] },
    { columns: { ...fullColumns } },
  );
  const waits = [];
  const opts = {
    client: db,
    fetchHtml: fetchHtmlFor,
    wait: async (ms) => waits.push(ms),
    intervalMs: 3000,
    log: () => {},
  };
  const first = await runApply([RACE_F4, RACE_ABSENT], opts);
  const rF4 = db.tables.race_results.find((r) => r.race_id === RACE_F4);
  const rAbs = db.tables.race_results.find((r) => r.race_id === RACE_ABSENT);
  check(
    "--apply: 2レースを修正（戸田9R: rank4〜6・3連単/3連複が NULL、状態=partial_refund。唐津12R: rank6=NULL）。失敗なし。レースの間に3秒以上の待機",
    first.results.every((r) => !r.error) &&
      rF4.rank6 === null &&
      rF4.payout_trifecta === null &&
      rF4.payout_trio === null &&
      rF4.race_status === "partial_refund" &&
      rAbs.rank6 === null &&
      waits.length === 1 &&
      waits[0] >= 3000,
    show(first.results),
  );
  const writesBefore = db.writes.filter(
    (w) => w.table === "race_results",
  ).length;
  const second = await runApply([RACE_F4, RACE_ABSENT], opts);
  check(
    "--apply: 2回目は race_results を書かない（変更なし）",
    second.results.every((r) => !r.error && r.wrote.results === false) &&
      db.writes.filter((w) => w.table === "race_results").length ===
        writesBefore,
  );
  const dbStop = createSchemaAwareDb(
    { races: seedRaces, race_results: [dirtyF4, dirtyAbs] },
    { columns: { ...fullColumns } },
  );
  let calls = 0;
  const stopped = await runApply([RACE_F4, RACE_ABSENT], {
    ...opts,
    client: dbStop,
    fetchHtml: async (url) => {
      calls++;
      throw new ResultHttpError(url, 429);
    },
  });
  check(
    "--apply: 429で即中止（2件目を取得しない・何も書かない）",
    stopped.stopped?.includes("429") &&
      calls === 1 &&
      dbStop.writes.length === 0,
  );
  const dbBad = createSchemaAwareDb(
    { races: seedRaces, race_results: [] },
    { columns: { ...fullColumns } },
  );
  const missing = await runApply([RACE_F4], { ...opts, client: dbBad });
  check(
    "--apply: race_results に行が無いレースは、書かずにエラーとして返す",
    missing.results[0].error?.includes("race_results の行を読めません") &&
      dbBad.writes.length === 0,
  );
  const applyFail = await applyFixPlan(
    createSchemaAwareDb({ race_results: [dirtyF4] }, { columns: fullColumns }),
    {
      race_id: RACE_F4,
      resultUpdate: { no_such_column: 1 },
      timingRows: [],
      payoutRows: [],
    },
  );
  check(
    "--apply: 書き込みの失敗は、握りつぶさず error として返す",
    typeof applyFail.error === "string" &&
      applyFail.error.includes("race_results 更新エラー"),
  );
}

// ---------------------------------------------------------------------------
// (h) 変異検証: 壊した版で、(a)〜(d) の評価が失敗する
// ---------------------------------------------------------------------------
const MUTANT_DIR = path.join(ROOT, "scripts/lib");
/**
 * 変異ごとに別モジュールとして読み込むための通し番号。以前は import の URL を `?t=${Date.now()}` で区別していたが、
 * 同じファイルの変異が同じミリ秒に続くと URL が一致し、ESM のキャッシュから直前の変異が返る（BOA-648/BOA-671と同種）。
 * 時刻ではなく通し番号で区別する
 */
let mutantSeq = 0;
async function withMutant(fileName, replacements, run) {
  const source = fs.readFileSync(path.join(MUTANT_DIR, fileName), "utf8");
  let mutated = source;
  for (const [from, to] of replacements) {
    if (!mutated.includes(from))
      throw new Error(
        `変異の対象が見つかりません（${fileName}）: ${from.slice(0, 50)}`,
      );
    mutated = mutated.replace(from, to);
  }
  const tmp = path.join(
    MUTANT_DIR,
    `${fileName.replace(/\.js$/, "")}.mutant-${process.pid}-${++mutantSeq}.tmp.mjs`,
  );
  fs.writeFileSync(tmp, mutated);
  try {
    return await run(await import(tmp));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ---- 後半の場面（verifyData/race-result-parser-scenes-6.js） ----
await runRaceResultParserScenes10({ printOut, check, show, same, full, LEGACY_RESULT_COLUMNS, seedRaces, withMutant });
// 書き込み経路・DDLの変異
{
  const s079 = fs.readFileSync(
    path.join(ROOT, "docs/db-migration/079_race_payouts.sql"),
    "utf8",
  );
  const mutatedDdl = s079.replace(
    "'special', 'no_amount', 'no_race'",
    "'special', 'no_race'",
  );
  const list = (s) =>
    /payout_status\s+IN\s*\(([^)]*)\)/i
      .exec(s.replace(/--[^\n]*/g, ""))?.[1]
      .match(/'[^']*'/g)?.length;
  check(
    "変異検証: DDL案のCHECKから状態を1つ落とすと、値の数が変わり整合の検証が失敗する",
    list(s079) === 4 && list(mutatedDdl) === 3,
  );
}

// ---- 後半の場面（verifyData/race-result-parser-scenes-6.js） ----
await runRaceResultParserScenes11({ printOut, check, show, same, full, LEGACY_RESULT_COLUMNS, seedRaces, withMutant });

if (failures > 0) {
  printErr(`\n❌ ${failures}件の検証に失敗しました`);
  process.exit(1);
}

// ---- 後半の場面（verifyData/race-result-parser-scenes-6.js） ----
runRaceResultParserScenes12({ printOut, check, show, same, full, LEGACY_RESULT_COLUMNS, seedRaces, withMutant });
