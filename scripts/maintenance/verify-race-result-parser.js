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
import {
  buildRaceResultRow,
  runForRaces,
  ResultHttpError,
} from "../daily/scrape-results.js";
import * as realParser from "../lib/raceResultParser.js";
import * as realRows from "../lib/raceResultRows.js";
import {
  clearResultSchemaCache,
  detectResultSchema,
} from "../lib/raceResultSchema.js";
import {
  analyzeRaceFromDb,
  compareRaceWithKDay,
  kDayToRaceFacts,
  summarizeDbFindings,
} from "../lib/raceResultAudit.js";
import { applyFixPlan, buildFixPlan } from "../lib/raceResultFix.js";
import { legacyParseRaceResultHtml } from "../lib/__fixtures__/raceresult/legacyParseRaceResultHtml.js";
import { runApply } from "./audit-race-result-anomalies.js";
import { computeResultDigest } from "../lib/scrapeJobs/resultDigest.js";

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

// ---------------------------------------------------------------------------
// フィクスチャの期待値（公式ページの表示・本番DBの actual_course から、2026-09-20に手で確認したもの）
// ---------------------------------------------------------------------------
/**
 * marks: 着順表の行順の着欄。boats: 着順表の行順の枠番。course: 本番DBの actual_course_1〜6（艇Nの進入コース。Kファイル由来）。
 * refund: 返還艇。status: レースの状態。remark: 備考。noRace: 不成立の勝式。
 */
const CASES = [
  {
    file: "raceresult-2026-09-19-02-09-refund-f4.html",
    boats: [1, 2, 3, 4, 5, 6],
    marks: ["1", "2", "F", "F", "F", "F"],
    course: [1, 2, 3, 4, 6, 5],
    refund: [3, 4, 5, 6],
    status: "partial_refund",
    remark: "【返還艇あり】",
    noRace: ["place", "2fuku", "wide", "3tan", "3fuku"],
    legacyDiff: ["rank4", "rank5", "rank6", "payouts"],
  },
  {
    file: "raceresult-2026-09-16-23-12-absent.html",
    boats: [2, 3, 5, 6, 4, 1],
    marks: ["1", "2", "3", "4", "5", "欠"],
    course: [null, 1, 2, 3, 4, 5],
    refund: [1],
    status: "partial_refund",
    remark: "【返還艇あり】",
    noRace: [],
    legacyDiff: ["rank6"],
  },
  {
    file: "raceresult-2026-08-07-24-01-no-race-6f.html",
    boats: [1, 2, 3, 4, 5, 6],
    marks: ["F", "F", "F", "F", "F", "F"],
    course: [1, 4, 2, 3, 6, 5],
    refund: [1, 2, 3, 4, 5, 6],
    status: "no_race",
    remark: "【返還艇あり】",
    noRace: ["win", "place", "2tan", "2fuku", "wide", "3tan", "3fuku"],
    legacyDiff: ["rank4", "rank5", "rank6", "payouts"],
  },
  {
    file: "raceresult-2026-09-14-06-06-no-race-underscore.html",
    boats: [4, 1, 2, 3, 5, 6],
    marks: ["_", "F", "F", "F", "F", "F"],
    course: [1, 2, 3, 4, 5, 6],
    refund: [1, 2, 3, 5, 6],
    status: "no_race",
    remark: "【返還艇あり】",
    noRace: ["win", "place", "2tan", "2fuku", "wide", "3tan", "3fuku"],
    legacyDiff: ["rank4", "rank5", "rank6", "payouts"],
  },
  {
    file: "raceresult-2026-09-17-13-11-tokubarai.html",
    boats: [2, 1, 3, 4, 5, 6],
    marks: ["1", "2", "3", "4", "5", "6"],
    course: [1, 2, 3, 4, 5, 6],
    refund: [],
    status: "normal",
    remark: null,
    noRace: [],
    legacyDiff: [],
  },
  {
    file: "raceresult-2025-12-11-17-01-dead-heat-1st.html",
    boats: [1, 2, 5, 4, 6, 3],
    marks: ["1", "1", "3", "4", "5", "6"],
    course: [1, 2, 3, 4, 6, 5],
    refund: [],
    status: "normal",
    remark: "【同着あり】",
    noRace: [],
    legacyDiff: [],
  },
  {
    file: "raceresult-2026-03-15-18-06-dead-heat-3rd.html",
    boats: [1, 2, 3, 5, 4, 6],
    marks: ["1", "2", "3", "3", "5", "6"],
    course: [1, 2, 3, 4, 5, 6],
    refund: [],
    status: "normal",
    remark: "【同着あり】",
    noRace: [],
    legacyDiff: [],
  },
  {
    file: "raceresult-2026-09-11-20-01-fall-obstruct.html",
    boats: [4, 1, 3, 2, 5, 6],
    marks: ["1", "2", "3", "4", "落", "妨"],
    course: [1, 2, 4, 3, 5, 6],
    refund: [],
    status: "normal",
    remark: null,
    noRace: [],
    legacyDiff: ["rank5", "rank6"],
  },
  {
    file: "raceresult-2026-04-03-21-10-engine-sink-absent.html",
    boats: [6, 2, 3, 1, 4, 5],
    marks: ["1", "2", "3", "エ", "沈", "欠"],
    course: [1, 2, 3, 4, null, 5],
    refund: [5],
    status: "partial_refund",
    remark: "【返還艇あり】",
    noRace: [],
    legacyDiff: ["rank4", "rank5", "rank6"],
  },
  {
    file: "raceresult-2026-06-01-05-05-late-start.html",
    boats: [4, 5, 6, 1, 2, 3],
    marks: ["1", "2", "3", "4", "L", "L"],
    course: [1, 5, 6, 2, 3, 4],
    refund: [2, 3],
    status: "partial_refund",
    remark: "【返還艇あり】",
    noRace: [],
    legacyDiff: ["rank5", "rank6"],
  },
  {
    file: "raceresult-2026-09-10-05-12-fall-capsize-f.html",
    boats: [2, 3, 1, 4, 5, 6],
    marks: ["1", "2", "3", "落", "転", "F"],
    course: [1, 2, 3, 4, 5, 6],
    refund: [6],
    status: "partial_refund",
    remark: "【返還艇あり】",
    noRace: [],
    legacyDiff: ["rank4", "rank5", "rank6"],
  },
  {
    file: "raceresult-2019-04-15-05-03-capsize-2019.html",
    boats: [1, 2, 3, 4, 6, 5],
    marks: ["1", "2", "3", "4", "5", "転"],
    course: [1, 2, 3, 4, 5, 6],
    refund: [],
    status: "normal",
    remark: null,
    noRace: [],
    legacyDiff: ["rank6"],
  },
  {
    file: "raceresult-2026-09-19-05-01.html",
    boats: [1, 6, 2, 3, 5, 4],
    marks: ["1", "2", "3", "4", "5", "6"],
    course: [1, 2, 4, 5, 6, 3],
    refund: [],
    status: "normal",
    remark: null,
    noRace: [],
    legacyDiff: [],
  },
  {
    file: "raceresult-2026-09-19-17-12.html",
    boats: [2, 1, 3, 5, 6, 4],
    marks: ["1", "2", "3", "4", "5", "6"],
    course: [1, 2, 3, 4, 5, 6],
    refund: [],
    status: "normal",
    remark: null,
    noRace: [],
    legacyDiff: [],
  },
];

// ---------------------------------------------------------------------------
// (a)(b)(c)(d) を、差し替え可能なモジュールに対して評価する（変異検証で、壊した版にも同じ評価をかける）
// ---------------------------------------------------------------------------
const NEW_LEGACY_ONLY_KEYS = new Set(["full"]);

/**
 * @param {{parseRaceResultPage: Function, toLegacyResult: Function, buildTimingRows: Function, buildPayoutRows: Function}} m
 * @returns {string[]} 失敗した項目のラベル
 */
function evaluate(m) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  for (const c of CASES) {
    const html = readFixture(c.file);
    const full = m.parseRaceResultPage(html);
    const name = c.file.replace("raceresult-", "").replace(".html", "");

    expect(
      `${name}: 着順表の枠番の並び`,
      same(
        full.boats.map((b) => b.boat_number),
        c.boats,
      ),
    );
    expect(
      `${name}: 着欄の生表記`,
      same(
        full.boats.map((b) => b.finish_mark),
        c.marks,
      ),
    );
    expect(
      `${name}: 完走の着（数字の着欄だけ。同着は同じ値）`,
      same(
        full.boats.map((b) => b.finish_rank),
        c.marks.map((mark) => (/^[1-6]$/.test(mark) ? Number(mark) : null)),
      ),
    );
    // フライング・出遅れ・レースタイム（秒）は、着欄・レースタイムの表記から独立に計算して比べる
    expect(
      `${name}: フライング(is_flying)は着欄F、出遅れ(is_late_start)は着欄Lの艇だけ`,
      full.boats.every(
        (b) =>
          b.is_flying === (b.finish_mark === "F") &&
          b.is_late_start === (b.finish_mark === "L"),
      ),
    );
    expect(
      `${name}: レースタイム(race_seconds)が、表記（分'秒"十分の一秒）から計算した秒と一致`,
      full.boats.every((b) => {
        const t = /^(\d+)'(\d{2})"(\d)$/.exec(b.race_time ?? "");
        return t
          ? b.race_seconds ===
              Number(t[1]) * 60 + Number(t[2]) + Number(t[3]) / 10
          : b.race_seconds === null;
      }),
    );
    // 実進入: 艇Nの進入コース（スタート情報の行順）が、本番DBの actual_course_N と一致
    const byBoat = new Map(
      full.boats.map((b) => [b.boat_number, b.entry_course]),
    );
    expect(
      `${name}: 進入コースが本番DBの actual_course（Kファイル由来）と一致`,
      same(
        [1, 2, 3, 4, 5, 6].map((n) => byBoat.get(n) ?? null),
        c.course,
      ),
    );
    expect(`${name}: 返還艇`, same(full.refund_boats, c.refund));
    expect(`${name}: レースの状態`, full.race_status === c.status);
    expect(`${name}: 備考`, full.remark === c.remark);
    expect(
      `${name}: 不成立の勝式`,
      same(
        [
          ...new Set(
            full.payouts
              .filter((p) => p.payout_status === "no_race")
              .map((p) => p.bet_type),
          ),
        ].sort(),
        [...c.noRace].sort(),
      ),
    );
    expect(
      `${name}: 想定外の表記（anomalies）が無い`,
      full.anomalies.length === 0,
    );

    // 旧解析との互換
    const oldR = legacyParseRaceResultHtml(html);
    const newR = m.toLegacyResult(full);
    const diffKeys = Object.keys(oldR).filter(
      (k) => !NEW_LEGACY_ONLY_KEYS.has(k) && show(oldR[k]) !== show(newR[k]),
    );
    expect(
      `${name}: 旧解析との差が、想定の項目だけ（想定=${c.legacyDiff.join("・") || "なし"}、実際=${diffKeys.join("・") || "なし"}）`,
      same([...diffKeys].sort(), [...c.legacyDiff].sort()),
    );
    // 旧解析にあった項目のうち、差の無い項目は、値まで同一（rank1〜3・時間・進入・ST・決まり手・気象）
    expect(
      `${name}: rank1〜3・レースタイム・進入・ST・決まり手・気象が旧解析と同じ`,
      [
        "rank1",
        "rank2",
        "rank3",
        "raceTime1",
        "raceTime2",
        "raceTime3",
        "raceTime4",
        "raceTime5",
        "raceTime6",
        "courseInfo",
        "startTimings",
        "winningTechnique",
        "weather",
      ].every((k) => show(oldR[k]) === show(newR[k])),
    );
    // 非完走艇は rank4〜6 に入らない（完走した艇だけが着順の位置に入る）
    const finishers = full.boats
      .filter((b) => b.finish_rank !== null)
      .map((b) => b.boat_number);
    if (finishers.length >= 3) {
      expect(
        `${name}: rank4〜6 は完走艇の4〜6着だけ`,
        same(
          [newR.rank4, newR.rank5, newR.rank6],
          [3, 4, 5].map((i) => finishers[i] ?? null),
        ),
      );
    }

    // 行の組み立て
    const legacyRows = m.buildTimingRows("R", newR, { extended: false });
    const extRows = m.buildTimingRows("R", newR, { extended: true });
    expect(
      `${name}: 旧形式の艇別の行は、STを読めた艇だけ（旧実装と同じ）`,
      same(
        legacyRows,
        oldR.startTimings.map((st) => ({ race_id: "R", ...st })),
      ),
    );
    expect(
      `${name}: 拡張の艇別の行は6艇分（欠場艇を含む）`,
      extRows.length === c.boats.length,
    );
    expect(
      `${name}: 拡張の艇別の行の着欄・進入が、パーサーの出力と同じ`,
      extRows.every((r) => {
        const b = full.boats.find((x) => x.boat_number === r.boat_number);
        return (
          b &&
          r.finish_mark === b.finish_mark &&
          r.finish_rank === b.finish_rank &&
          r.entry_course === b.entry_course &&
          r.race_seconds === b.race_seconds
        );
      }),
    );
    const payoutRows = m.buildPayoutRows("R", newR);
    expect(
      `${name}: 払戻明細の行がDDL案(079)のCHECKの意味に合う`,
      payoutRows.length > 0 && payoutRows.every(payoutRowSatisfiesDdl),
    );
    expect(
      `${name}: 払戻明細の(勝式,seq)が重複しない（主キー）`,
      new Set(payoutRows.map((r) => `${r.bet_type}/${r.seq}`)).size ===
        payoutRows.length,
    );
  }
  return failed;
}

/** マイグレーション079のCHECK制約（chk_race_payouts_*）と同じ意味。DDL案の文言との一致は (f) で確認する */
function payoutRowSatisfiesDdl(r) {
  const betOk = [
    "win",
    "place",
    "2tan",
    "2fuku",
    "wide",
    "3tan",
    "3fuku",
  ].includes(r.bet_type);
  const seqOk = Number.isInteger(r.seq) && r.seq >= 1;
  const statusOk = ["paid", "special", "no_amount", "no_race"].includes(
    r.payout_status,
  );
  const consistent =
    (r.payout_status === "paid" &&
      r.payout !== null &&
      r.combination !== null) ||
    (r.payout_status === "special" && r.payout !== null) ||
    (r.payout_status === "no_amount" &&
      r.payout === null &&
      r.combination !== null) ||
    (r.payout_status === "no_race" &&
      r.payout === null &&
      r.combination === null);
  return betOk && seqOk && statusOk && consistent;
}

const realModules = {
  parseRaceResultPage: realParser.parseRaceResultPage,
  toLegacyResult: realRows.toLegacyResult,
  buildTimingRows: realRows.buildTimingRows,
  buildPayoutRows: realRows.buildPayoutRows,
};
const realFailures = evaluate(realModules);
check(
  `(a)(b)(c)(d) 全フィクスチャ${CASES.length}件（着欄・進入・返還・払戻明細・状態・旧解析との互換・行の組み立て）の検証が全て成功`,
  realFailures.length === 0,
  realFailures.slice(0, 5).join(" / "),
);
printOut(`   （評価した項目数: ${CASES.length}件 × 約19項目）`);

// 個別の重要な値（評価に埋もれないよう、実例を明示して確認する）
const full = (file) => realParser.parseRaceResultPage(readFixture(file));
{
  const f4 = full("raceresult-2026-09-19-02-09-refund-f4.html");
  const payout = (bet, seq = 1) =>
    f4.payouts.find((p) => p.bet_type === bet && p.seq === seq);
  check(
    "返還・不成立: 戸田9R（F4艇）で、単勝¥100・2連単1-2¥100（人気1）は払戻、3連単・3連複・2連複・拡連複・複勝は不成立（払戻なし）",
    payout("win").payout === 100 &&
      payout("win").payout_status === "paid" &&
      payout("2tan").combination === "1-2" &&
      payout("2tan").popularity === 1 &&
      ["3tan", "3fuku", "2fuku", "wide", "place"].every(
        (b) =>
          payout(b).payout_status === "no_race" && payout(b).payout === null,
      ),
  );
  const row = buildRaceResultRow("R", realRows.toLegacyResult(f4));
  check(
    "返還・不成立: 戸田9Rの race_results の行は、payout_trifecta(3連複)・payout_trio(3連単)が NULL（旧実装は100）、payout_win・payout_exacta は100",
    row.payout_trifecta === null &&
      row.payout_trio === null &&
      row.payout_win === 100 &&
      row.payout_exacta === 100,
  );
  const abs = full("raceresult-2026-09-16-23-12-absent.html");
  const absRow = buildRaceResultRow("R", realRows.toLegacyResult(abs));
  check(
    "BOA-362: 唐津12Rの1号艇（欠場）が rank6 に入らない（旧実装は rank6=1）。rank1〜5 は 2-3-5-6-4",
    absRow.rank6 === null &&
      same(
        [absRow.rank1, absRow.rank2, absRow.rank3, absRow.rank4, absRow.rank5],
        [2, 3, 5, 6, 4],
      ),
  );
  const nr = full("raceresult-2026-08-07-24-01-no-race-6f.html");
  check(
    "不成立: 6艇全てフライングのレースは全勝式が不成立で、race_results の払戻列が全て NULL",
    nr.race_status === "no_race" &&
      (() => {
        const r = buildRaceResultRow("R", realRows.toLegacyResult(nr));
        return [
          "payout_win",
          "payout_place_1",
          "payout_place_2",
          "payout_trifecta",
          "payout_trio",
          "payout_exacta",
          "payout_quinella",
          "payout_wide_1",
        ].every((c) => r[c] === null);
      })(),
  );
  const tk = full("raceresult-2026-09-17-13-11-tokubarai.html");
  check(
    "特払: 単勝は special（払戻70）、複勝の1着艇は no_amount（払戻NULL）。race_results の payout_win=70・payout_place_1=NULL（旧実装と同じ）",
    tk.payouts.find((p) => p.bet_type === "win").payout_status === "special" &&
      tk.payouts.find((p) => p.bet_type === "win").payout === 70 &&
      tk.payouts.find((p) => p.bet_type === "place" && p.seq === 1)
        .payout_status === "no_amount" &&
      (() => {
        const r = buildRaceResultRow("R", realRows.toLegacyResult(tk));
        return (
          r.payout_win === 70 &&
          r.payout_place_1 === null &&
          r.payout_place_2 === 150
        );
      })(),
  );
  const dh = full("raceresult-2025-12-11-17-01-dead-heat-1st.html");
  check(
    "同着: 1着同着の払戻は、3連単が2口（1-2-5=780円・2-1-5=2,430円）、単勝・複勝も2口。旧列（payout_trio）は先頭の1口だけ",
    dh.payouts.filter((p) => p.bet_type === "3tan").length === 2 &&
      dh.payouts.find((p) => p.bet_type === "3tan" && p.seq === 2).payout ===
        2430 &&
      dh.payouts.filter((p) => p.bet_type === "win").length === 2 &&
      buildRaceResultRow("R", realRows.toLegacyResult(dh)).payout_trio === 780,
  );
  const lt = full("raceresult-2026-06-01-05-05-late-start.html");
  const ltBoat = lt.boats.find((b) => b.boat_number === 2);
  check(
    "出遅れ: 着欄「Ｌ」（NFKCでL）の艇は、STが数値でなく（NULL）is_late_start=true・返還艇。旧実装はこの艇の行を作らなかった",
    ltBoat.finish_mark === "L" &&
      ltBoat.start_timing === null &&
      ltBoat.is_late_start === true &&
      lt.refund_boats.includes(2) &&
      realRows.buildTimingRows("R", realRows.toLegacyResult(lt), {
        extended: false,
      }).length === 4 &&
      realRows.buildTimingRows("R", realRows.toLegacyResult(lt), {
        extended: true,
      }).length === 6,
  );
  const sec = full("raceresult-2026-09-19-02-09-refund-f4.html").boats[0];
  check(
    `レースタイム: 1'50"7 は 110.7秒`,
    sec.race_seconds === 110.7 && sec.race_time === `1'50"7`,
  );
  check(
    "着欄の表記の種類: 実ページで確認した F・L・欠・落・転・沈・妨・エ・_（全角の「＿」）が FINISH_MARKS に定義されている",
    ["F", "L", "欠", "落", "転", "沈", "妨", "エ", "_"].every(
      (k) => realParser.FINISH_MARKS[k]?.observed === true,
    ),
  );
  check(
    "返還される艇: F・L・欠は返還、落・転・沈・妨・エは返還されない（実ページの返還表と一致）",
    ["F", "L", "欠"].every((k) => realParser.FINISH_MARKS[k].refunded) &&
      ["落", "転", "沈", "妨", "エ"].every(
        (k) => !realParser.FINISH_MARKS[k].refunded,
      ) &&
      same(
        full("raceresult-2026-09-10-05-12-fall-capsize-f.html").refund_boats,
        [6],
      ),
  );
}
// 未公開ページ・壊れたHTML
{
  const none = realParser.parseRaceResultPage(
    readFixture("raceresult-unpublished-2026-09-25-05-01.html"),
  );
  check(
    "未公開ページ: 例外にせず空の項目を返し、旧形式への変換は null（着順・払戻が無い）",
    none.boats.length === 0 &&
      none.payouts.length === 0 &&
      none.race_status === null &&
      realRows.toLegacyResult(none) === null,
  );
  const weird = readFixture("raceresult-2026-09-19-05-01.html").replace(
    ">１</td>",
    ">怪</td>",
  );
  const w = realParser.parseRaceResultPage(weird);
  check(
    "未知の着欄の表記は、握りつぶさず anomalies に残す（着欄「怪」）",
    w.anomalies.some((a) => a.includes("怪")) &&
      w.boats[0].finish_mark === "怪" &&
      w.boats[0].finish_rank === null,
  );
  const weirdPayout = readFixture("raceresult-2026-09-19-05-01.html")
    .replace('<td rowspan="2">3連単</td>', '<td rowspan="2">3連単</td>')
    .replace(
      /<span class="numberSet1_number is-type1">1<\/span><span class="numberSet1_text">-<\/span><span class="numberSet1_number is-type6">6<\/span><span class="numberSet1_text">-<\/span><span class="numberSet1_number is-type2">2<\/span>/,
      "謎の表記",
    );
  const wp = realParser.parseRaceResultPage(weirdPayout);
  check(
    "未知の組番の表記は、握りつぶさず anomalies に残す",
    wp.anomalies.some((a) => a.includes("未知の組番")),
  );
}

// ---------------------------------------------------------------------------
// (e) 書き込み経路: 077〜079の未適用・適用済みの両方
// ---------------------------------------------------------------------------
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * インメモリのSupabaseクライアント（この検証に必要な範囲）。schema に、各テーブルの「存在する列」を渡すと、
 * 存在しない列を含む select・upsert・update は、PostgRESTと同じ形のエラーを返す。
 * tableMissing のテーブルは、PGRST205（テーブルが無い）を返す。writes に書き込みを全て記録する。
 */
function createSchemaAwareDb(
  initial,
  { columns = {}, tableMissing = [], probeError = null } = {},
) {
  const tables = {};
  for (const [name, rows] of Object.entries(initial))
    tables[name] = clone(rows);
  const writes = [];
  const reads = [];
  const unknownColumns = (table, names) =>
    columns[table] ? names.filter((n) => !columns[table].includes(n)) : [];
  const missingTable = (table) =>
    tableMissing.includes(table)
      ? {
          error: {
            code: "PGRST205",
            message: `Could not find the table 'public.${table}' in the schema cache`,
          },
        }
      : null;

  function builder(table) {
    const s = {
      op: "select",
      cols: "*",
      filters: [],
      patch: null,
      rows: null,
      onConflict: null,
      limit: null,
      head: false,
    };
    const q = {
      select(cols, opts = {}) {
        s.cols = cols ?? "*";
        s.head = Boolean(opts.head);
        return q;
      },
      in(col, vals) {
        s.filters.push((r) => vals.includes(r[col]));
        return q;
      },
      eq(col, val) {
        s.filters.push((r) => r[col] === val);
        return q;
      },
      gte() {
        return q;
      },
      lt() {
        return q;
      },
      is(col, val) {
        s.filters.push((r) => (val === null ? r[col] == null : r[col] === val));
        return q;
      },
      not() {
        return q;
      },
      or() {
        return q;
      },
      limit(n) {
        s.limit = n;
        return q;
      },
      range() {
        return q;
      },
      order() {
        return q;
      },
      maybeSingle() {
        s.single = true;
        return q;
      },
      upsert(rows, opts = {}) {
        s.op = "upsert";
        s.rows = rows;
        s.onConflict = opts.onConflict;
        return q;
      },
      update(patch) {
        s.op = "update";
        s.patch = patch;
        return q;
      },
      then(resolve, reject) {
        return Promise.resolve(exec()).then(resolve, reject);
      },
    };
    function exec() {
      const gone = missingTable(table);
      if (gone) return gone;
      const rows = (tables[table] ??= []);
      if (s.op === "select") {
        // 適用状況の確認は select(列).limit(0)（行を取らない）
        const isProbe = s.limit === 0;
        reads.push({ table, cols: s.cols, probe: isProbe });
        if (probeError && isProbe) return { error: { message: probeError } };
        const wanted =
          s.cols === "*" ? null : s.cols.split(",").map((c) => c.trim());
        const unknown = wanted ? unknownColumns(table, wanted) : [];
        if (unknown.length > 0) {
          return {
            data: null,
            error: {
              code: "42703",
              message: `column ${table}.${unknown[0]} does not exist`,
            },
          };
        }
        let out = rows.filter((r) => s.filters.every((f) => f(r)));
        if (s.limit !== null) out = out.slice(0, s.limit);
        const data = clone(out).map((r) =>
          wanted
            ? Object.fromEntries(
                wanted.filter((c) => c in r).map((c) => [c, r[c]]),
              )
            : r,
        );
        return s.single
          ? { data: data[0] ?? null, error: null }
          : { data, error: null };
      }
      const written =
        s.op === "upsert"
          ? s.rows.flatMap((r) => Object.keys(r))
          : Object.keys(s.patch);
      const unknown = unknownColumns(table, [...new Set(written)]);
      if (unknown.length > 0) {
        writes.push({ table, op: s.op, failed: true, unknown });
        return {
          error: {
            code: "PGRST204",
            message: `Could not find the '${unknown[0]}' column of '${table}' in the schema cache`,
          },
        };
      }
      if (s.op === "upsert") {
        const keys = (s.onConflict ?? "").split(",").filter(Boolean);
        for (const row of s.rows) {
          const existing = rows.find((r) => keys.every((k) => r[k] === row[k]));
          if (existing) Object.assign(existing, clone(row));
          else rows.push(clone(row));
        }
        writes.push({
          table,
          op: "upsert",
          count: s.rows.length,
          rows: clone(s.rows),
        });
        return { error: null };
      }
      if (s.op === "update") {
        const targets = rows.filter((r) => s.filters.every((f) => f(r)));
        for (const r of targets) Object.assign(r, clone(s.patch));
        writes.push({
          table,
          op: "update",
          count: targets.length,
          patch: clone(s.patch),
        });
        return { error: null };
      }
      return { error: { message: `未対応: ${s.op}` } };
    }
    return q;
  }
  return { tables, writes, reads, from: (table) => builder(table) };
}

const LEGACY_TIMING_COLUMNS = [
  "race_id",
  "boat_number",
  "start_timing",
  "is_flying",
  "is_late_start",
  "created_at",
  "updated_at",
];
const NEW_TIMING_COLUMNS = [
  "finish_mark",
  "finish_rank",
  "entry_course",
  "race_seconds",
];
const LEGACY_RESULT_COLUMNS = Object.keys(
  buildRaceResultRow(
    "R",
    realRows.toLegacyResult(full("raceresult-2026-09-19-05-01.html")),
  ),
);
const NEW_RESULT_COLUMNS = ["race_status", "refund_boats", "remark"];
const PAYOUT_COLUMNS = [
  "race_id",
  "bet_type",
  "seq",
  "combination",
  "payout",
  "payout_status",
  "popularity",
  "created_at",
  "updated_at",
];

const RACE_F4 = "2026-09-19-02-09";
const RACE_ABSENT = "2026-09-16-23-12";
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

async function runLive(
  db,
  races = RACES.filter(
    (r) => r.race_id === RACE_F4 || r.race_id === RACE_ABSENT,
  ),
) {
  clearResultSchemaCache(db);
  const outcomes = await runForRaces(races, {
    date: "2026-09-19",
    mode: "live",
    fetchHtml: fetchHtmlFor,
    client: db,
    now: () => new Date("2026-09-19T08:00:00Z"),
  });
  return outcomes;
}

// 未適用（077〜079いずれも無い）
{
  const db = createSchemaAwareDb(
    { races: seedRaces },
    {
      columns: {
        race_results: LEGACY_RESULT_COLUMNS.concat(["created_at"]),
        race_start_timings: LEGACY_TIMING_COLUMNS,
      },
      tableMissing: ["race_payouts"],
    },
  );
  const outcomes = await runLive(db);
  const timings = db.tables.race_start_timings ?? [];
  const results = db.tables.race_results ?? [];
  check(
    "未適用のDB（077〜079なし）: 結果取得が成功（error なし）",
    outcomes.every((o) => o.outcome === "partial" || o.outcome === "ok") &&
      outcomes.every((o) => !o.error),
    show(outcomes.map((o) => [o.race_id, o.outcome, o.error])),
  );
  check(
    "未適用のDB: 書き込みの失敗（列が無いエラー）が1件も無い（旧実装と同じ列だけを書いた）",
    db.writes.every((w) => !w.failed),
    show(db.writes.filter((w) => w.failed)),
  );
  check(
    "未適用のDB: race_start_timings は、STを読めた艇の行だけ（戸田9R=6行、唐津12R=5行。欠場艇の行は作らない）、新しい列を含まない",
    timings.filter((r) => r.race_id === RACE_F4).length === 6 &&
      timings.filter((r) => r.race_id === RACE_ABSENT).length === 5 &&
      timings.every((r) => NEW_TIMING_COLUMNS.every((c) => !(c in r))),
  );
  check(
    "未適用のDB: race_results は新しい列（race_status・refund_boats・remark）を含まない。払戻の¥100は入らず、欠場艇は rank に入らない",
    results.length === 2 &&
      results.every((r) => NEW_RESULT_COLUMNS.every((c) => !(c in r))) &&
      results.find((r) => r.race_id === RACE_F4).payout_trifecta === null &&
      results.find((r) => r.race_id === RACE_ABSENT).rank6 === null,
  );
  check(
    "未適用のDB: race_payouts へ書かない（テーブルが無い）",
    !db.writes.some((w) => w.table === "race_payouts"),
  );
}

// 適用済み（077〜079）
const fullColumns = {
  race_results: LEGACY_RESULT_COLUMNS.concat(
    ["created_at"],
    NEW_RESULT_COLUMNS,
  ),
  race_start_timings: LEGACY_TIMING_COLUMNS.concat(NEW_TIMING_COLUMNS),
  race_payouts: PAYOUT_COLUMNS,
};
{
  const db = createSchemaAwareDb(
    { races: seedRaces },
    { columns: fullColumns },
  );
  const outcomes = await runLive(db);
  const timings = db.tables.race_start_timings ?? [];
  const results = db.tables.race_results ?? [];
  const payouts = db.tables.race_payouts ?? [];
  check(
    "適用済みのDB（077〜079）: 結果取得が成功し、書き込みの失敗が無い",
    outcomes.every((o) => !o.error) && db.writes.every((w) => !w.failed),
    show(db.writes.filter((w) => w.failed)),
  );
  check(
    "適用済みのDB: race_start_timings は全艇の行（戸田9R・唐津12Rとも6行。欠場艇を含む）。欠場艇は着欄「欠」・進入NULL・STなし",
    timings.filter((r) => r.race_id === RACE_F4).length === 6 &&
      timings.filter((r) => r.race_id === RACE_ABSENT).length === 6 &&
      (() => {
        const absent = timings.find(
          (r) => r.race_id === RACE_ABSENT && r.boat_number === 1,
        );
        return (
          absent.finish_mark === "欠" &&
          absent.entry_course === null &&
          absent.start_timing === null &&
          absent.finish_rank === null
        );
      })() &&
      timings.every(
        (r) =>
          r.updated_at === "2026-09-19T08:00:00.000Z" ||
          typeof r.updated_at === "string",
      ),
  );
  check(
    "適用済みのDB: race_results に race_status・refund_boats・remark が入る（戸田9R=partial_refund・[3,4,5,6]、唐津12R=partial_refund・[1]）",
    results.find((r) => r.race_id === RACE_F4).race_status ===
      "partial_refund" &&
      same(
        results.find((r) => r.race_id === RACE_F4).refund_boats,
        [3, 4, 5, 6],
      ) &&
      results.find((r) => r.race_id === RACE_ABSENT).race_status ===
        "partial_refund" &&
      same(results.find((r) => r.race_id === RACE_ABSENT).refund_boats, [1]) &&
      results.find((r) => r.race_id === RACE_ABSENT).remark ===
        "【返還艇あり】",
  );
  check(
    "適用済みのDB: race_payouts に払戻明細（戸田9R=単勝1・複勝1・2連単1・他の不成立の行を含む。唐津12R=拡連複3口・複勝2口を含む）",
    payouts.filter((r) => r.race_id === RACE_F4).length === 7 &&
      payouts.filter((r) => r.race_id === RACE_ABSENT).length === 10 &&
      payouts.filter((r) => r.race_id === RACE_ABSENT && r.bet_type === "wide")
        .length === 3 &&
      payouts.filter((r) => r.race_id === RACE_F4).every(payoutRowSatisfiesDdl),
  );
  // 再実行: 完了済みのレースは取得しない（skipped_have_data）。ここでは、変更の無い行を書かないことを、行の書き込み側で確認する
  const before = db.writes.length;
  const finished = new Set(); // 何も追加しない
  void finished;
  const again = await runForRaces(
    RACES.filter((r) => r.race_id === RACE_F4),
    {
      date: "2026-09-19",
      mode: "live",
      fetchHtml: fetchHtmlFor,
      client: db,
      now: () => new Date("2026-09-19T09:00:00Z"),
    },
  );
  check(
    "適用済みのDB: 完了済みのレースを再実行しても、取得も書き込みもしない（skipped_have_data）",
    again[0].outcome === "skipped_have_data" && db.writes.length === before,
  );
}

// 077だけ適用（078・079は未適用）
{
  const db = createSchemaAwareDb(
    { races: seedRaces },
    {
      columns: {
        race_results: LEGACY_RESULT_COLUMNS.concat(["created_at"]),
        race_start_timings: LEGACY_TIMING_COLUMNS.concat(NEW_TIMING_COLUMNS),
      },
      tableMissing: ["race_payouts"],
    },
  );
  const outcomes = await runLive(db);
  check(
    "部分適用（077のみ）: 艇別の行は全艇分を書き、race_results は新しい列を含まず、race_payouts へは書かない。失敗なし",
    outcomes.every((o) => !o.error) &&
      db.writes.every((w) => !w.failed) &&
      (db.tables.race_start_timings ?? []).filter(
        (r) => r.race_id === RACE_ABSENT,
      ).length === 6 &&
      (db.tables.race_results ?? []).every((r) =>
        NEW_RESULT_COLUMNS.every((c) => !(c in r)),
      ) &&
      !db.writes.some((w) => w.table === "race_payouts"),
  );
}

// 確認の通信エラー
{
  const db = createSchemaAwareDb(
    { races: seedRaces },
    { columns: fullColumns, probeError: "network down" },
  );
  const outcomes = await runLive(db);
  check(
    "適用状況の確認が通信エラー: 旧形式で書く（STを読めた艇の行だけ・新しい列なし）。結果取得は失敗にしない",
    outcomes.every((o) => !o.error) &&
      (db.tables.race_start_timings ?? []).filter(
        (r) => r.race_id === RACE_ABSENT,
      ).length === 5 &&
      (db.tables.race_results ?? []).every((r) =>
        NEW_RESULT_COLUMNS.every((c) => !(c in r)),
      ) &&
      !db.writes.some((w) => w.table === "race_payouts"),
  );
}
// 判定のキャッシュ
{
  const db = createSchemaAwareDb({}, { columns: fullColumns });
  let clock = 0;
  const first = await detectResultSchema(db, { now: () => clock, ttlMs: 1000 });
  const readsAfterFirst = db.reads.length;
  await detectResultSchema(db, { now: () => clock + 500, ttlMs: 1000 });
  const cachedNoRead = db.reads.length === readsAfterFirst;
  await detectResultSchema(db, { now: () => clock + 1500, ttlMs: 1000 });
  check(
    "適用状況の判定: 3つとも適用済みと判定し、TTL内はキャッシュ（再確認しない）、TTL後に再確認する",
    first.timings &&
      first.results &&
      first.payouts &&
      cachedNoRead &&
      db.reads.length === readsAfterFirst * 2,
  );
}
// 不成立のレースは、決まり手が出なくても完了（毎分再取得し続けない）
{
  const raceId = "2026-08-07-24-01";
  const html = readFixture("raceresult-2026-08-07-24-01-no-race-6f.html");
  const db = createSchemaAwareDb(
    { races: [{ race_id: raceId, start_time: "10:00" }] },
    { columns: fullColumns },
  );
  clearResultSchemaCache(db);
  const [outcome] = await runForRaces(
    [
      {
        race_id: raceId,
        venue_code: 24,
        race_number: 1,
        start_time: new Date("2026-08-07T01:00:00Z"),
      },
    ],
    {
      date: "2026-08-07",
      mode: "live",
      fetchHtml: async () => html,
      client: db,
      now: () => new Date("2026-08-07T02:00:00Z"),
    },
  );
  check(
    "不成立（全勝式が不成立）のレースは、決まり手が無くても完了（ok）。旧実装は決まり手が未公開として再取得し続けた",
    outcome.outcome === "ok" && !outcome.error,
    show(outcome),
  );
}
// result_digest の互換: 拡張の艇別の行（STなし）が混ざっても、解析側とDB側で同じダイジェスト
{
  const parsed = realRows.toLegacyResult(
    full("raceresult-2026-09-16-23-12-absent.html"),
  );
  const row = buildRaceResultRow(RACE_ABSENT, parsed);
  const parsedSide = computeResultDigest(
    row,
    parsed.startTimings.map((st) => ({ race_id: RACE_ABSENT, ...st })),
  );
  const dbSide = computeResultDigest(
    row,
    realRows.buildTimingRows(RACE_ABSENT, parsed, { extended: true }),
  );
  const legacyDbSide = computeResultDigest(
    row,
    realRows.buildTimingRows(RACE_ABSENT, parsed, { extended: false }),
  );
  check(
    "result_digest: 077適用後のDB（STなしの艇の行を含む6行）でも、旧形式（5行）・解析側と同じダイジェスト",
    parsedSide === dbSide && parsedSide === legacyDbSide,
  );
}

// ---------------------------------------------------------------------------
// (f) DDL案とコードの整合
// ---------------------------------------------------------------------------
{
  const sql = (name) =>
    fs.readFileSync(path.join(ROOT, "docs/db-migration", name), "utf8");
  const stripComments = (s) => s.replace(/--[^\n]*/g, "");
  const addedColumns = (s) =>
    [...stripComments(s).matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/g)].map(
      (m) => m[1],
    );
  const inList = (s, name) => {
    const m = new RegExp(`${name}\\s+IN\\s*\\(([^)]*)\\)`, "i").exec(
      stripComments(s),
    );
    return m ? [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).sort() : null;
  };
  const s077 = sql("077_race_start_timings_boat_result.sql");
  const s078 = sql("078_race_results_status_refund.sql");
  const s079 = sql("079_race_payouts.sql");
  check(
    "DDL 077: 追加する列が、コードが書く艇別の新しい列（finish_mark・finish_rank・entry_course・race_seconds）と一致",
    same(addedColumns(s077).sort(), [...NEW_TIMING_COLUMNS].sort()),
  );
  check(
    "DDL 078: 追加する列が、コードが書く race_results の新しい列と一致",
    same(addedColumns(s078).sort(), [...NEW_RESULT_COLUMNS].sort()),
  );
  const createBody =
    /CREATE TABLE IF NOT EXISTS race_payouts \(([\s\S]*?)\n\);/.exec(
      stripComments(s079),
    )[1];
  const ddlPayoutColumns = createBody
    .split("\n")
    .map((l) =>
      /^\s{2}(\w+)\s+(varchar|text|smallint|integer|timestamptz)/.exec(l),
    )
    .filter(Boolean)
    .map((m) => m[1])
    .sort();
  check(
    "DDL 079: race_payouts の列が、コードが書く払戻明細の行のキーと一致",
    same(ddlPayoutColumns, [...PAYOUT_COLUMNS].sort()),
  );
  check(
    "DDL 079: bet_type のCHECKの値が、パーサーの勝式（BET_TYPE_BY_LABEL）と一致",
    same(
      inList(s079, "bet_type"),
      Object.values(realParser.BET_TYPE_BY_LABEL).sort(),
    ),
  );
  const producedStatuses = new Set(
    CASES.flatMap((c) =>
      realRows
        .buildPayoutRows("R", realRows.toLegacyResult(full(c.file)))
        .map((r) => r.payout_status),
    ),
  );
  const ddlStatuses = inList(s079, "payout_status");
  check(
    "DDL 079: payout_status のCHECKの値が、フィクスチャから作れる4状態（paid・special・no_amount・no_race）と一致",
    same(ddlStatuses, ["no_amount", "no_race", "paid", "special"]) &&
      [...producedStatuses].every((s) => ddlStatuses.includes(s)) &&
      producedStatuses.size === 4,
    show([...producedStatuses]),
  );
  check(
    "DDL 078: race_status のCHECKの値が、classifyRaceStatus の出力（normal・partial_refund・no_race）と一致",
    same(inList(s078, "race_status"), [
      "no_race",
      "normal",
      "partial_refund",
    ]) &&
      same([...new Set(CASES.map((c) => full(c.file).race_status))].sort(), [
        "no_race",
        "normal",
        "partial_refund",
      ]),
  );
  check(
    "DDL 079: 新規テーブルはRLS有効・anon/authenticated の権限を剥奪・書き込みポリシーなし（ポリシー自体を作らない）",
    /ENABLE ROW LEVEL SECURITY/.test(s079) &&
      /REVOKE ALL ON race_payouts FROM anon, authenticated/.test(s079) &&
      !/CREATE POLICY/i.test(stripComments(s079)),
  );
  check(
    "DDL 077〜079: 列の追加は NULL可・DEFAULTなし（メタデータのみの変更。race_results の追加で trg_update_predictions が発火しない）",
    ![s077, s078].some((s) => /ADD COLUMN[^;]*DEFAULT/i.test(stripComments(s))),
  );
  const apply079Negative = {
    bet_type: "win",
    seq: 1,
    combination: "1",
    payout: null,
    payout_status: "paid",
  };
  check(
    "DDL 079のCHECKの意味（ミラー）: paid で払戻NULLは違反、no_race で組番ありは違反",
    !payoutRowSatisfiesDdl(apply079Negative) &&
      !payoutRowSatisfiesDdl({
        bet_type: "win",
        seq: 1,
        combination: "1",
        payout: null,
        payout_status: "no_race",
      }),
  );
}

// ---------------------------------------------------------------------------
// (g) Q6の監査・修正計画・--apply
// ---------------------------------------------------------------------------
{
  const base = {
    race_id: "2026-09-19-02-09",
    rank1: 1,
    rank2: 2,
    rank3: 3,
    rank4: 4,
    rank5: 5,
    rank6: 6,
    payout_trio: 100,
    payout_trifecta: 100,
    actual_course_1: 1,
    actual_course_2: 2,
    actual_course_3: 3,
    actual_course_4: 4,
    actual_course_5: 6,
    actual_course_6: 5,
    fBoats: [3, 4, 5, 6],
  };
  const a = analyzeRaceFromDb(base);
  check(
    "監査（DBのみ）: F4艇のレース（rank1〜6=1〜6・3連単/3連複=100）を、rank4〜6の汚染・rank1〜3の汚染（完走2艇）・3連単100・疑いの払戻として検出",
    same(a.rank456Polluted, [4, 5, 6]) &&
      same(a.rank123Polluted, [3]) &&
      a.trio100 &&
      a.suspectPayoutColumns.length === 2 &&
      a.finishers === 2,
  );
  const abs = analyzeRaceFromDb({
    race_id: "2026-09-16-23-12",
    rank1: 2,
    rank2: 3,
    rank3: 5,
    rank4: 6,
    rank5: 4,
    rank6: 1,
    actual_course_1: null,
    actual_course_2: 1,
    actual_course_3: 2,
    actual_course_4: 3,
    actual_course_5: 4,
    actual_course_6: 5,
    fBoats: [],
  });
  check(
    "監査（DBのみ）: BOA-362（唐津12R、欠場の1号艇が rank6）を absentInRanks=[6] として検出",
    same(abs.absentBoats, [1]) && same(abs.absentInRanks, [6]),
  );
  const ok = analyzeRaceFromDb({
    race_id: "2026-09-19-05-01",
    rank1: 1,
    rank2: 6,
    rank3: 2,
    rank4: 3,
    rank5: 5,
    rank6: 4,
    payout_trio: 1480,
    payout_trifecta: 330,
    actual_course_1: 1,
    actual_course_2: 2,
    actual_course_3: 4,
    actual_course_4: 5,
    actual_course_5: 6,
    actual_course_6: 3,
    fBoats: [],
  });
  check(
    "監査（DBのみ）: 正常なレースは検出しない",
    ok.rank456Polluted.length === 0 &&
      ok.rank123Polluted.length === 0 &&
      !ok.trio100 &&
      ok.suspectPayoutColumns.length === 0,
  );
  const legit = analyzeRaceFromDb({
    race_id: "2026-06-25-22-07",
    rank1: 2,
    rank2: 1,
    rank3: 4,
    rank4: 3,
    rank5: 5,
    rank6: 6,
    payout_trio: 1020,
    payout_trifecta: 100,
    actual_course_1: 1,
    actual_course_2: 2,
    actual_course_3: 3,
    actual_course_4: 4,
    actual_course_5: 5,
    actual_course_6: 6,
    fBoats: [],
  });
  check(
    "監査（DBのみ）: 非完走艇の無いレースの3連複100円（低配当の正しい払戻）は、疑いにしない",
    legit.suspectPayoutColumns.length === 0 &&
      !legit.trio100 &&
      legit.trifecta100,
  );
  const sum = summarizeDbFindings([a, abs, ok, legit], 4);
  check(
    "監査の集計: 対象4件のうち、疑いは2件（F4艇・欠場）。月別・会場別の内訳を持つ",
    sum.flagged === 2 &&
      sum.flaggedByMonth["2026-09"] === 2 &&
      sum.flaggedByVenue["02"] === 1 &&
      sum.flaggedByVenue["23"] === 1,
  );

  // Kファイルとの突合（実ファイル由来のフィクスチャ）
  const kText = fs.readFileSync(
    path.join(ROOT, "scripts/lib/__fixtures__/kbfile/k190415.txt"),
    "utf8",
  );
  const facts = kDayToRaceFacts(kText, "2019-04-15");
  const f = facts.get("2019-04-15-07-01");
  check(
    "Kファイル突合: 蒲郡1R（F4艇）の確定情報（完走=3→1、返還艇=2・4・5・6、不成立=複勝・2連複・拡連複・3連単・3連複）",
    same(f.finisherBoats, [3, 1]) &&
      same(f.refundBoats, [2, 4, 5, 6]) &&
      same([...f.noRaceKinds].sort(), [
        "2fuku",
        "3fuku",
        "3tan",
        "place",
        "wide",
      ]),
    show(f),
  );
  const polluted = {
    race_id: "2019-04-15-07-01",
    rank1: 3,
    rank2: 1,
    rank3: 2,
    rank4: 4,
    rank5: 5,
    rank6: 6,
    payout_trifecta: 100,
    payout_trio: 100,
    payout_quinella: 100,
    payout_win: 280,
  };
  const defects = compareRaceWithKDay(polluted, f);
  check(
    "Kファイル突合: 蒲郡1Rの汚れた行（非完走艇が rank3〜6、不成立の3連単・3連複・2連複が100）を、rank456・refund_payout（3連単・3連複・2連複）として確定",
    defects.some((d) => d.kind === "rank456") &&
      ["3tan", "3fuku", "2fuku"].every((b) =>
        defects.some((d) => d.kind === "refund_payout" && d.bet === b),
      ),
    show(defects),
  );
  const clean = {
    race_id: "2019-04-15-07-01",
    rank1: 3,
    rank2: 1,
    rank3: 2,
    rank4: null,
    rank5: null,
    rank6: null,
    payout_win: 280,
  };
  check(
    "Kファイル突合: 修正後の行（rank4〜6=NULL・払戻100なし）は誤りなし。rank1〜3 は完走が2艇のため比べない",
    compareRaceWithKDay(clean, f).length === 0,
  );
}
{
  // 修正計画: 変更のある列だけ書く。再取得した結果ページ（戸田9R）から
  const parsed = realRows.toLegacyResult(
    full("raceresult-2026-09-19-02-09-refund-f4.html"),
  );
  const newRow = buildRaceResultRow(RACE_F4, parsed);
  const existing = {
    ...newRow,
    rank4: 4,
    rank5: 5,
    rank6: 6,
    payout_trifecta: 100,
    payout_trio: 100,
    payout_quinella: 100,
    payout_place_1: 100,
    payout_wide_1: 100,
    race_status: null,
    refund_boats: null,
    remark: null,
  };
  const plan = buildFixPlan(existing, newRow, parsed, {
    results: true,
    timings: true,
    payouts: true,
  });
  check(
    "修正計画: 汚れた行から、変更のある列だけを更新（rank4〜6・不成立の払戻をNULL・race_status・refund_boats・remark）。rank1〜3・単勝・2連単は触れない",
    same(
      Object.keys(plan.resultUpdate).sort(),
      [
        "payout_place_1",
        "payout_quinella",
        "payout_trifecta",
        "payout_trio",
        "payout_wide_1",
        "race_status",
        "rank4",
        "rank5",
        "rank6",
        "refund_boats",
        "remark",
      ].sort(),
    ) &&
      plan.resultUpdate.rank4 === null &&
      plan.resultUpdate.payout_trifecta === null &&
      plan.resultUpdate.race_status === "partial_refund" &&
      !("rank1" in plan.resultUpdate) &&
      !("payout_win" in plan.resultUpdate),
    show(plan.resultUpdate),
  );
  const planNoExt = buildFixPlan(existing, newRow, parsed, {
    results: false,
    timings: false,
    payouts: false,
  });
  check(
    "修正計画: 078未適用なら race_status・refund_boats・remark を含めない。077・079未適用なら艇別・払戻明細を書かない",
    !("race_status" in planNoExt.resultUpdate) &&
      planNoExt.timingRows.length === 0 &&
      planNoExt.payoutRows.length === 0,
  );
  const fixed = buildFixPlan(
    {
      ...newRow,
      race_status: "partial_refund",
      refund_boats: [3, 4, 5, 6],
      remark: "【返還艇あり】",
    },
    newRow,
    parsed,
    { results: true, timings: false, payouts: false },
  );
  check(
    "修正計画: 既に正しい行は、race_results を書かない（変更の無い行を書かない）",
    Object.keys(fixed.resultUpdate).length === 0,
  );
}
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
    `${fileName.replace(/\.js$/, "")}.mutant-${process.pid}.tmp.mjs`,
  );
  fs.writeFileSync(tmp, mutated);
  try {
    return await run(await import(`${tmp}?t=${Date.now()}`));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
const PARSER = "raceResultParser.js";
const ROWS = "raceResultRows.js";
const mutants = [
  [
    "進入コースを行順でなく艇番にする（旧実装の誤り）",
    PARSER,
    [["entryCourse: index + 1,", "entryCourse: boatNumber,"]],
    "parser",
  ],
  [
    "進入コースを0始まりにする",
    PARSER,
    [["entryCourse: index + 1,", "entryCourse: index,"]],
    "parser",
  ],
  [
    "不成立を払戻として扱う（¥100を払戻にする）",
    PARSER,
    [['if (comboText.startsWith("不成立")) {', "if (false) {"]],
    "parser",
  ],
  [
    "特払を払戻なしにする",
    PARSER,
    [['} else if (comboText.startsWith("特払")) {', "} else if (false) {"]],
    "parser",
  ],
  [
    "着欄を読まない（先頭6行を着順とみなす）",
    PARSER,
    [
      [
        "finish_rank: /^[1-6]$/.test(mark) ? Number(mark) : null,",
        "finish_rank: 1,",
      ],
    ],
    "parser",
  ],
  [
    "返還艇を読まない",
    PARSER,
    [
      [
        "if (n >= 1 && n <= 6 && !refundBoats.includes(n)) refundBoats.push(n);",
        "",
      ],
    ],
    "parser",
  ],
  [
    "レースの状態を、返還艇があっても normal にする",
    PARSER,
    [
      [
        'if (noRace > 0 || refundBoats.length > 0) return "partial_refund";',
        'if (noRace > 0) return "partial_refund";',
      ],
    ],
    "parser",
  ],
  [
    "全勝式が不成立でも partial_refund にする",
    PARSER,
    [['if (noRace === payoutRows.length) return "no_race";', ""]],
    "parser",
  ],
  [
    "同着の複数口を捨てる（seq を常に1にする）",
    PARSER,
    [["const seq = (seqByType.get(betType) ?? 0) + 1;", "const seq = 1;"]],
    "parser",
  ],
  [
    "出遅れ（L）を読まない",
    PARSER,
    [['isLateStart: m[1] === "L",', "isLateStart: false,"]],
    "parser",
  ],
  [
    "レースタイムを秒にしない",
    PARSER,
    [["Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 10", "Number(m[2])"]],
    "parser",
  ],
  [
    "rank4〜6 に非完走艇を入れる（旧実装の誤り）",
    ROWS,
    [
      [
        "rank456 = [3, 4, 5].map((i) => finishers[i]?.boat_number ?? null);",
        "rank456 = [3, 4, 5].map((i) => rowOrder[i] ?? null);",
      ],
    ],
    "rows",
  ],
  [
    "旧形式の払戻から特払を落とす",
    ROWS,
    [
      [
        'if (row.payout_status !== "paid" && row.payout_status !== "special") {',
        'if (row.payout_status !== "paid") {',
      ],
    ],
    "rows",
  ],
  [
    "拡張の艇別の行に進入コースを入れない",
    ROWS,
    [["    entry_course: b.entry_course,\n", ""]],
    "rows",
  ],
  [
    "拡張の艇別の行から欠場艇を落とす",
    ROWS,
    [[".filter((b) => b.entry_course === null)", ".filter(() => false)"]],
    "rows",
  ],
];
for (const [label, file, replacements, kind] of mutants) {
  const failed = await withMutant(file, replacements, (mod) =>
    evaluate(
      kind === "parser"
        ? { ...realModules, parseRaceResultPage: mod.parseRaceResultPage }
        : {
            ...realModules,
            toLegacyResult: mod.toLegacyResult,
            buildTimingRows: mod.buildTimingRows,
            buildPayoutRows: mod.buildPayoutRows,
          },
    ),
  );
  check(
    `変異検証: 「${label}」で検証が失敗する（${failed.length}項目が失敗）`,
    failed.length > 0,
  );
}
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
{
  // 未適用のDBに拡張の行を書く版（確認をしない）は、失敗する: 077の列が無いDBで、新しい列を含む書き込みがエラーになることの確認
  const db = createSchemaAwareDb(
    { races: seedRaces },
    {
      columns: {
        race_start_timings: LEGACY_TIMING_COLUMNS,
        race_results: LEGACY_RESULT_COLUMNS.concat(["created_at"]),
      },
    },
  );
  const parsed = realRows.toLegacyResult(
    full("raceresult-2026-09-16-23-12-absent.html"),
  );
  const { error } = await db
    .from("race_start_timings")
    .upsert(realRows.buildTimingRows(RACE_ABSENT, parsed, { extended: true }), {
      onConflict: "race_id,boat_number",
    });
  check(
    "変異検証: 適用状況を確認せず拡張の行を書くと、未適用のDBでは書き込みが失敗する（確認が必要な理由）",
    Boolean(error) && error.code === "PGRST204",
  );
}

if (failures > 0) {
  printErr(`\n❌ ${failures}件の検証に失敗しました`);
  process.exit(1);
}
printOut("\nALL PASS");
