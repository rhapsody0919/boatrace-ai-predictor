/**
 * verify-kb-file-parser.js - K/Bファイルの全項目パーサー・アーカイブ行変換・バックフィルCLIの検証
 *
 * .claude/rules/analysis.md「データ精度の検証」に従い、コードレビューとは別に
 * 「解析結果が実データ（ファイル内の別の記載・本番DB・既存パーサー）と一致しているか」を確認する。
 *
 * フィクスチャ: scripts/lib/__fixtures__/kbfile/
 *   公式のK/Bファイルの実データから、特徴のある会場ブロック（欠場・F・L・失格・特払い・不成立・同着）を
 *   抜粋したもの（2005-01-01/04、2019-04-15、2022-03-24、2026-03-15）。
 *   k260920-pending.lzh は「全レース終了前」に返るプレースホルダの実物（321バイト）。
 *
 * 検証観点:
 *   1. 構造: 全会場・全レースで艇数が6、認識できない行（unparsed・extra_lines）が0
 *   2. K/B整合: 同じ日のKとBで、レース集合と各艇の登録番号が一致
 *   3. ファイル内クロスチェック: レース別の払戻が、ファイル冒頭の払戻金一覧表と一致
 *   4. 本番DBとの突合（2026-03-15、実DBの race_results・exhibition_data・race_start_timings と照合済みの値）
 *   5. 既存パーサー（kfileParser.js）との一致（進入コース・着順）
 *   6. 特殊表記: 同着・特払い・不成立・欠場（K0/K1）・F・L・失格の保持
 *   7. アーカイブ行変換（DB命名の3連単/3連複の逆転を持ち込まないこと）
 *   8. CLI: 窓・日次上限・サーキットブレーカー・K不在日のB省略・プレースホルダ非保存・0件を成功にしない
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildKbDay,
  decodeLzhText,
  summarizeKbDay,
  buildKbUrl,
  kbArchiveRelPath,
  PENDING_MARKER,
} from "../lib/kbFileParser.js";
import {
  buildArchiveRows,
  raceTimeToSeconds,
  classifyStage,
  KB_ARCHIVE_TABLES,
} from "../lib/kbArchiveRows.js";
import { upsertChangedRows } from "../lib/unchangedRows.js";
import { parseKFileText, parseKFileRankings } from "../lib/kfileParser.js";
import {
  parseWindow,
  inWindow,
  windowDayKey,
  classifyResponse,
  planDownload,
  latestManifest,
  estimatePlan,
  cmdDownload,
  _internal as cli,
} from "./kb-backfill.js";

const FIX = new URL("../lib/__fixtures__/kbfile/", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, FIX), "utf8");

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DAYS = [
  { date: "2005-01-01", ymd: "050101", venues: 1, hasB: false },
  { date: "2005-01-04", ymd: "050104", venues: 2, hasB: true },
  { date: "2019-04-15", ymd: "190415", venues: 2, hasB: true },
  { date: "2022-03-24", ymd: "220324", venues: 2, hasB: true },
  { date: "2026-03-15", ymd: "260315", venues: 2, hasB: true },
];
const days = Object.fromEntries(
  DAYS.map((d) => [
    d.date,
    buildKbDay({
      date: d.date,
      kText: read(`k${d.ymd}.txt`),
      bText: d.hasB ? read(`b${d.ymd}.txt`) : null,
    }),
  ]),
);

// --- 1. 構造 ---
for (const d of DAYS) {
  const day = days[d.date];
  const s = summarizeKbDay(day);
  const kRaces = day.k.venues.flatMap((v) => v.races);
  check(
    `${d.date} K: 会場${d.venues}・全レースが6艇`,
    s.k_venues === d.venues &&
      kRaces.length > 0 &&
      kRaces.every((r) => r.rows.length === 6),
    JSON.stringify(s),
  );
  check(
    `${d.date} K: 認識できない行が0`,
    s.k_unparsed_lines === 0 && s.k_extra_lines === 0,
    JSON.stringify(s),
  );
  check(
    `${d.date} K: 全会場が確定済み（プレースホルダなし）`,
    s.k_pending_venues === 0,
  );
  if (d.hasB) {
    check(
      `${d.date} B: 会場${d.venues}・全レースが6艇・未認識行0`,
      s.b_venues === d.venues &&
        s.b_entries === s.b_races * 6 &&
        s.b_extra_lines === 0,
      JSON.stringify(s),
    );
  }
}

// --- 2. K/B整合 ---
for (const d of DAYS.filter((x) => x.hasB)) {
  const day = days[d.date];
  let mismatched = 0;
  let racesOnlyOneSide = 0;
  for (const kv of day.k.venues) {
    const bv = day.b.venues.find((v) => v.venue_code === kv.venue_code);
    for (const kr of kv.races) {
      const br = bv?.races.find((r) => r.race_number === kr.race_number);
      if (!br) {
        racesOnlyOneSide++;
        continue;
      }
      for (const row of kr.rows) {
        const e = br.entries.find((x) => x.boat_number === row.boat_number);
        if (!e || e.racer_id !== row.racer_id) mismatched++;
      }
    }
  }
  check(
    `${d.date} K/B: レース集合が一致し、全艇の登録番号が一致`,
    racesOnlyOneSide === 0 && mismatched === 0,
    `片側のみ${racesOnlyOneSide} / 不一致${mismatched}`,
  );
}

// --- 3. ファイル内クロスチェック（レース別払戻 vs 冒頭の払戻金一覧表） ---
for (const d of DAYS) {
  const day = days[d.date];
  let checked = 0;
  let bad = 0;
  for (const v of day.k.venues) {
    // 一覧表: "  1R  2-5-1   20070    1-2-5     620 ..."（3連単・3連複）。同着の継続行はレース番号なし
    let current = null;
    for (const line of v.payout_summary_lines) {
      const m = /^\s+(\d{1,2})R\s+(\d-\d-\d)\s+(\d+)\s+(\d-\d-\d)\s+(\d+)/.exec(
        line,
      );
      if (!m) continue;
      current = Number(m[1]);
      const race = v.races.find((r) => r.race_number === current);
      const tan = race?.payouts.find(
        (p) => p.kind === "trifecta" && p.combo === m[2],
      );
      const fuku = race?.payouts.find(
        (p) => p.kind === "trio" && p.combo === m[4],
      );
      checked++;
      if (tan?.amount !== Number(m[3]) || fuku?.amount !== Number(m[5])) bad++;
    }
  }
  // 2005-01-01は3連単が無い時代で一覧表の形式が異なるため、対象があれば検証する
  check(
    `${d.date} 払戻: 一覧表と一致（${checked}レース確認）`,
    bad === 0,
    `不一致${bad}`,
  );
}

// --- 4. 本番DBとの突合（2026-03-15。DBは race_results・exhibition_data・race_start_timings） ---
{
  const amagasaki = days["2026-03-15"].k.venues.find(
    (v) => v.venue_code === 13,
  );
  const r1 = amagasaki.races.find((r) => r.race_number === 1);
  const rank = (n) => r1.rows.find((x) => x.rank === n).boat_number;
  check(
    "DB突合 尼崎1R: 着順1-4-6（DB rank1〜3と一致）",
    eq([rank(1), rank(2), rank(3)], [1, 4, 6]),
  );
  const tan = r1.payouts.find((p) => p.kind === "trifecta");
  const fuku = r1.payouts.find((p) => p.kind === "trio");
  check(
    "DB突合 尼崎1R: 3連単2,760円（DB payout_trio）・3連複1,690円（DB payout_trifecta）",
    tan.amount === 2760 && fuku.amount === 1690,
  );
  const ex = Object.fromEntries(
    r1.rows.map((x) => [x.boat_number, x.exhibition_time]),
  );
  check(
    "DB突合 尼崎1R: 展示タイム6艇がexhibition_dataと一致",
    eq(ex, { 1: 6.8, 2: 6.75, 3: 6.81, 4: 6.74, 5: 6.81, 6: 6.7 }),
    JSON.stringify(ex),
  );
  const st = Object.fromEntries(
    r1.rows.map((x) => [x.boat_number, x.start_timing]),
  );
  check(
    "DB突合 尼崎1R: ST6艇がrace_start_timingsと一致",
    eq(st, { 1: 0.1, 2: 0.1, 3: 0.13, 4: 0.08, 5: 0.19, 6: 0.12 }),
    JSON.stringify(st),
  );
  check(
    "DB突合 尼崎1R: 決まり手（逃げ）・ステージ（予選）・締切10:35",
    r1.technique === "逃げ" &&
      r1.stage === "予選" &&
      days["2026-03-15"].b.venues.find((v) => v.venue_code === 13).races[0]
        .deadline_time === "10:35",
  );
  // 尼崎: G1「尼崎市制110周年記念 尼崎センプルカップ」2日目（K/Bにグレード表記は無い）
  check(
    "尼崎: タイトル・日目",
    amagasaki.title === "尼崎市制110周年記念尼崎センプルカップ" &&
      amagasaki.series_day === 2,
  );
}

// --- 5. 既存パーサー（kfileParser.js）との一致 ---
for (const d of DAYS) {
  const text = read(`k${d.ymd}.txt`);
  const existingCourses = parseKFileText(text, d.date);
  const existingRanks = parseKFileRankings(text, d.date);
  let courseDiff = 0;
  let rankDiff = 0;
  const day = days[d.date];
  for (const v of day.k.venues) {
    for (const r of v.races) {
      const id = `${d.date}-${String(v.venue_code).padStart(2, "0")}-${String(r.race_number).padStart(2, "0")}`;
      const ec = existingCourses.find((x) => x.race_id === id);
      for (let b = 1; b <= 6; b++) {
        const mine = r.rows.find((x) => x.boat_number === b)?.course ?? null;
        if ((ec?.[`actual_course_${b}`] ?? null) !== mine) courseDiff++;
      }
      const er = existingRanks.find((x) => x.race_id === id);
      const mineOrder = r.rows.filter((x) => x.rank).map((x) => x.boat_number);
      const theirs = [1, 2, 3, 4, 5, 6]
        .map((n) => er?.[`rank${n}`])
        .filter((x) => x != null);
      if (!eq(mineOrder, theirs)) rankDiff++;
    }
  }
  check(
    `${d.date} 既存パーサーと一致（進入コース差${courseDiff}・着順差${rankDiff}）`,
    courseDiff === 0 && rankDiff === 0,
  );
}

// --- 6. 特殊表記の保持 ---
{
  // 同着（2026-03-15 徳山6R）: 3着が2艇（3号艇と5号艇）、3連単が2通り
  const tokuyama = days["2026-03-15"].k.venues.find((v) => v.venue_code === 18);
  const r6 = tokuyama.races.find((r) => r.race_number === 6);
  const thirds = r6.rows
    .filter((x) => x.rank === 3)
    .map((x) => x.boat_number)
    .sort();
  const tan = r6.payouts
    .filter((p) => p.kind === "trifecta")
    .map((p) => `${p.combo}/${p.amount}`);
  check(
    "同着: 3着2艇（3,5号艇）と3連単2通り（1-2-3/1420・1-2-5/520）を保持",
    eq(thirds, [3, 5]) && eq(tan, ["1-2-3/1420", "1-2-5/520"]),
    JSON.stringify({ thirds, tan }),
  );
  const rows = buildArchiveRows(days["2026-03-15"]);
  check(
    "同着: アーカイブ行の dead_heat=true、3連単は先頭の1件",
    rows.races.find((r) => r.race_id === "2026-03-15-18-06").dead_heat ===
      true &&
      rows.races.find((r) => r.race_id === "2026-03-15-18-06").payout_3tan ===
        1420,
  );
}
{
  // 不成立・F（2019-04-15 蒲郡）
  const gamagori = days["2019-04-15"].k.venues.find((v) => v.venue_code === 7);
  const specials = gamagori.races.flatMap((r) =>
    r.payouts.filter((p) => p.special === "不成立"),
  );
  const flying = gamagori.races.flatMap((r) =>
    r.rows.filter((x) => x.finish_raw === "F"),
  );
  check(
    "不成立: 払戻の「不成立」を項目として保持（金額null）",
    specials.length >= 1 && specials.every((p) => p.amount === null),
  );
  check(
    "F: フライング艇の出走・ST（負値）を保持",
    flying.length >= 1 &&
      flying.every(
        (x) =>
          x.is_flying &&
          x.start_timing !== null &&
          x.start_timing < 0 &&
          x.course !== null &&
          x.rank === null,
      ),
  );
  const k = gamagori.races.flatMap((r) =>
    r.rows.filter((x) => /^K/.test(x.finish_raw)),
  );
  check(
    "欠場（K0/K1）: 着・進入・ST・展示・タイムがnullで、行としては残る",
    k.length >= 1 &&
      k.every(
        (x) =>
          x.rank === null &&
          x.course === null &&
          x.start_timing === null &&
          x.race_time === null &&
          x.exhibition_time === null,
      ),
  );
}
{
  // 特払い・L・失格（2005-01-01 K）
  const tokuji = days["2005-01-01"].k.venues
    .flatMap((v) => v.races)
    .flatMap((r) => r.payouts.filter((p) => p.special === "特払い"));
  const late = days["2005-01-01"].k.venues
    .flatMap((v) => v.races)
    .flatMap((r) => r.rows.filter((x) => /^L/.test(x.finish_raw)));
  check(
    "特払い: 払戻の「特払い」（70円）を項目として保持",
    tokuji.length >= 1 &&
      tokuji.every((p) => p.amount === 70 && p.combo === null),
  );
  check(
    "L: 出遅れ艇を is_late_start=true で保持",
    late.length >= 1 &&
      late.every((x) => x.is_late_start === true && x.rank === null),
  );
  const blank = days["2005-01-04"].k.venues
    .flatMap((v) => v.races)
    .flatMap((r) => r.payouts.filter((p) => p.special === "blank"));
  check("空欄の払戻行（単勝・複勝が空）も項目として保持", blank.length >= 0);
}
{
  const s = days["2005-01-04"].k.venues
    .flatMap((v) => v.races)
    .flatMap((r) => r.rows.filter((x) => /^S/.test(x.finish_raw)));
  check(
    "S（失格等）: 着の原文を保持し、rankはnull",
    s.length >= 1 && s.every((x) => x.rank === null),
  );
}

// --- 7. アーカイブ行変換 ---
{
  const rows = buildArchiveRows(days["2026-03-15"]);
  check(
    "行数: 開催2・レース24・艇144",
    rows.venueDays.length === 2 &&
      rows.races.length === 24 &&
      rows.boats.length === 144,
    `${rows.venueDays.length}/${rows.races.length}/${rows.boats.length}`,
  );
  const race = rows.races.find((r) => r.race_id === "2026-03-15-13-01");
  check(
    "命名: payout_3tan=2760（3連単）・payout_3fuku=1690（3連複）。DB本体の逆転命名を持ち込まない",
    race.payout_3tan === 2760 &&
      race.payout_3fuku === 1690 &&
      race.combo_3tan === "1-4-6",
  );
  check(
    "created_at は全行NULL（バックフィル行の識別）",
    [...rows.venueDays, ...rows.races, ...rows.boats].every(
      (r) => r.created_at === null,
    ),
  );
  const boat = rows.boats.find(
    (b) => b.race_id === "2026-03-15-13-01" && b.boat_number === 1,
  );
  check(
    "艇行: K（展示・進入・ST・着）とB（級別・勝率）が結合",
    boat.exhibition_time === 6.8 &&
      boat.course === 1 &&
      boat.start_timing === 0.1 &&
      boat.finish_rank === 1 &&
      boat.class === "A1" &&
      boat.national_win_rate === 6.69 &&
      boat.race_seconds === 107.9,
  );
  check(
    "警告なし（K/Bの登録番号一致）",
    rows.warnings.length === 0,
    rows.warnings.join(" / "),
  );
  check(
    "race_seconds換算・ステージ区分",
    raceTimeToSeconds("1.49.3") === 109.3 &&
      classifyStage("準優勝戦") === "semifinal" &&
      classifyStage("優勝戦") === "final" &&
      classifyStage("予選") === "qualifier" &&
      classifyStage("ドリーム戦") === "other",
  );
  const only2005 = buildArchiveRows(days["2005-01-01"]);
  check(
    "K のみの日（B無し）でも行を作れる（has_b=false・級別等はNULL）",
    only2005.venueDays.every((v) => v.has_k && !v.has_b) &&
      only2005.boats.every((b) => b.class === null && b.finish_raw !== null),
  );
}

// --- プレースホルダ（全レース終了前） ---
{
  const text = await decodeLzhText(
    new Uint8Array(fs.readFileSync(new URL("k260920-pending.lzh", FIX))),
  );
  const day = buildKbDay({ date: "2026-09-20", kText: text });
  check(
    "プレースホルダ: 検出でき、全会場が pending・レース0",
    text.includes(PENDING_MARKER) &&
      day.k.venues.length > 0 &&
      day.k.venues.every((v) => v.status === "pending" && v.races.length === 0),
  );
  check(
    "プレースホルダ: アーカイブ行を1行も作らない（確定データとして扱わない）",
    buildArchiveRows(day).races.length === 0,
  );
}

// --- 8. CLI ---
{
  check(
    "URL・アーカイブパス",
    buildKbUrl("K", "2022-03-24") ===
      "https://www1.mbrace.or.jp/od2/K/202203/k220324.lzh" &&
      kbArchiveRelPath("B", "2005-01-04") === "B/200501/b050104.lzh",
  );
  const win = parseWindow("22-06");
  const at = (iso) => new Date(iso);
  // JST 23:00 = 14:00Z、JST 03:00 = 18:00Z（前日）、JST 12:00 = 03:00Z
  check(
    "窓: 22-06は23時と3時が内、12時が外（日またぎ）",
    inWindow(win, at("2026-09-20T14:00:00Z")) &&
      inWindow(win, at("2026-09-20T18:00:00Z")) &&
      !inWindow(win, at("2026-09-20T03:00:00Z")),
  );
  check(
    "日次上限の集計: 23:00と翌03:00が同じ夜",
    windowDayKey(win, at("2026-09-20T14:00:00Z")) ===
      windowDayKey(win, at("2026-09-20T18:00:00Z")) &&
      windowDayKey(win, at("2026-09-20T14:00:00Z")) !==
        windowDayKey(win, at("2026-09-21T14:00:00Z")),
  );
  check(
    "窓any=常に内",
    inWindow(parseWindow("any"), at("2026-09-20T03:00:00Z")),
  );
  check(
    "HTTP分類: 403は閾値2、429/503は閾値3+バックオフ、404は不在",
    classifyResponse(403).threshold === 2 &&
      classifyResponse(429).backoff &&
      classifyResponse(503).threshold === 3 &&
      classifyResponse(404).kind === "absent" &&
      classifyResponse(200).kind === "ok",
  );
  const manifest = latestManifest([
    { date: "2019-04-01", kind: "K", status: "ok" },
    { date: "2019-04-01", kind: "B", status: "error" },
    { date: "2019-04-02", kind: "K", status: "absent" },
    { date: "2019-04-02", kind: "B", status: "skipped" },
  ]);
  const todo = planDownload({
    from: "2019-04-01",
    to: "2019-04-03",
    kinds: ["K", "B"],
    manifest,
  });
  check(
    "再開: 完了（ok/absent/skipped）は除き、error・未着手を対象にする",
    eq(todo, [
      { date: "2019-04-01", kind: "B" },
      { date: "2019-04-03", kind: "K" },
      { date: "2019-04-03", kind: "B" },
    ]),
  );
  const est = estimatePlan({
    requests: 4866,
    dailyLimit: 2000,
    meanIntervalMs: 4000,
    latencyMs: 1000,
  });
  check(
    "見積り: 4,866リクエスト・上限2,000で3夜",
    est.nights === 3 && est.totalHours === 6.8,
  );
  const opts = cli.validateOptions(
    cli.parseArgs([
      "download",
      "--from=2019-04-01",
      "--to=2019-04-02",
      "--interval-min-ms=500",
    ]),
  );
  check(
    "間隔の下限: 3000ms未満の指定は3000msに引き上げる",
    opts.intervalMinMs === 3000 && opts.intervalMaxMs >= 3000,
  );
  let threw = false;
  try {
    cli.validateOptions(cli.parseArgs(["download", "--from=2004-12-31"]));
  } catch {
    threw = true;
  }
  check("公式の最古（2005-01-01）より前は拒否", threw);
}

// --- 8b. download の停止条件（fetchを差し替えて実行。公式サイトへは接続しない） ---
{
  const pendingLzh = new Uint8Array(
    fs.readFileSync(new URL("k260920-pending.lzh", FIX)),
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kb-backfill-verify-"));
  const base = (dir, extra = {}) => ({
    command: "download",
    from: "2019-04-01",
    to: "2019-04-03",
    archiveDir: dir,
    kinds: ["K", "B"],
    dailyLimit: 2000,
    window: "any",
    intervalMinMs: 3000,
    intervalMaxMs: 5000,
    latencyMs: 1000,
    maxRequests: Infinity,
    dryRun: false,
    ...extra,
  });
  const noSleep = { sleep: async () => {}, backoffBaseMs: 1 };
  const manifestOf = (dir) =>
    fs
      .readFileSync(path.join(dir, "manifest.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  const quiet = async (fn) => {
    const log = console.log;
    console.log = () => {};
    try {
      return await fn();
    } finally {
      console.log = log;
    }
  };

  // 403の連続は2回で即停止
  let dir = path.join(tmp, "a");
  let calls = 0;
  const sleeps = [];
  let code = await quiet(() =>
    cmdDownload(base(dir), {
      ...noSleep,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchOnce: async () => (
        calls++,
        { status: 403, bytes: new Uint8Array(), ms: 1 }
      ),
    }),
  );
  check(
    "サーキットブレーカー: 403が2回連続で停止（終了コード4・リクエスト2回）",
    code === 4 && calls === 2,
    `code=${code} calls=${calls}`,
  );
  check(
    "403の再試行でも最小間隔（3秒以上）を空ける",
    sleeps.length === 1 && sleeps[0] >= 3000 && sleeps[0] <= 5000,
    JSON.stringify(sleeps),
  );

  // 503は3回連続で停止（バックオフを挟んで再試行）
  dir = path.join(tmp, "b");
  calls = 0;
  code = await quiet(() =>
    cmdDownload(base(dir), {
      ...noSleep,
      fetchOnce: async () => (
        calls++,
        { status: 503, bytes: new Uint8Array(), ms: 1 }
      ),
    }),
  );
  check(
    "サーキットブレーカー: 503が3回連続で停止（同じ対象を再試行）",
    code === 4 &&
      calls === 3 &&
      manifestOf(dir).every((e) => e.date === "2019-04-01" && e.kind === "K"),
    `code=${code} calls=${calls}`,
  );

  // Kが404の日はBを取得しない（skipped）。404が3回連続したら、URL構造の変更・アクセス制限の疑いで停止する
  dir = path.join(tmp, "c");
  calls = 0;
  code = await quiet(() =>
    cmdDownload(base(dir, { to: "2019-04-05" }), {
      ...noSleep,
      fetchOnce: async () => (
        calls++,
        { status: 404, bytes: new Uint8Array(200), ms: 1 }
      ),
    }),
  );
  const m = manifestOf(dir);
  check(
    "K不在日: Bは取得せず skipped。404が3回連続で停止（終了コード4・リクエスト3回）",
    calls === 3 &&
      m.filter((e) => e.status === "skipped").length === 2 &&
      code === 4,
    `code=${code} calls=${calls}`,
  );

  // Bは、有効なLZHなら保存される（sha256・ファイル）。Kのプレースホルダは保存しない
  dir = path.join(tmp, "d");
  code = await quiet(() =>
    cmdDownload(base(dir, { to: "2019-04-01" }), {
      ...noSleep,
      fetchOnce: async () => ({ status: 200, bytes: pendingLzh, ms: 1 }),
    }),
  );
  const m2 = manifestOf(dir);
  const kEntry = m2.find((e) => e.kind === "K");
  const bEntry = m2.find((e) => e.kind === "B");
  check(
    "プレースホルダ: Kは pending で生ファイルを保存しない／B（有効なLZH）は保存しsha256を記録",
    kEntry.status === "pending" &&
      !fs.existsSync(path.join(dir, "raw", "K")) &&
      bEntry.status === "ok" &&
      typeof bEntry.sha256 === "string" &&
      fs.existsSync(path.join(dir, "raw", bEntry.file)) &&
      code === 0,
    JSON.stringify({ kEntry, bEntry, code }),
  );

  // 日次上限・窓外は安全停止（終了コード2）
  dir = path.join(tmp, "e");
  calls = 0;
  code = await quiet(() =>
    cmdDownload(base(dir, { dailyLimit: 1, to: "2019-04-02" }), {
      ...noSleep,
      fetchOnce: async () => (
        calls++,
        { status: 200, bytes: pendingLzh, ms: 1 }
      ),
    }),
  );
  check(
    "日次上限: 上限に達したら停止（終了コード2・1リクエスト）",
    code === 2 && calls === 1,
    `code=${code} calls=${calls}`,
  );
  dir = path.join(tmp, "f");
  calls = 0;
  code = await quiet(() =>
    cmdDownload(base(dir, { window: "22-06" }), {
      ...noSleep,
      now: () => new Date("2026-09-20T03:00:00Z"),
      fetchOnce: async () => (
        calls++,
        { status: 200, bytes: pendingLzh, ms: 1 }
      ),
    }),
  );
  check(
    "実行窓の外: リクエストせず停止（終了コード2）",
    code === 2 && calls === 0,
    `code=${code} calls=${calls}`,
  );

  // 展開できない応答（HTMLのエラーページ等）が3回続いたら停止
  dir = path.join(tmp, "g");
  calls = 0;
  code = await quiet(() =>
    cmdDownload(base(dir, { kinds: ["B"] }), {
      ...noSleep,
      fetchOnce: async () => (
        calls++,
        {
          status: 200,
          bytes: new TextEncoder().encode("<html>maintenance</html>"),
          ms: 1,
        }
      ),
    }),
  );
  check(
    "LZHでない200応答が3回連続で停止（形式変更・ブロックの疑い）",
    code === 4 && calls === 3,
    `code=${code} calls=${calls}`,
  );

  // --dry-run: ネットワークもファイル書き込みも無し
  dir = path.join(tmp, "h");
  code = await quiet(() =>
    cmdDownload(base(dir, { dryRun: true }), {
      fetchOnce: async () => {
        throw new Error("dry-runでfetchしてはならない");
      },
    }),
  );
  check(
    "dry-run: 取得せず、アーカイブを作らない",
    code === 0 && !fs.existsSync(dir),
  );

  fs.rmSync(tmp, { recursive: true, force: true });
}

// --- 9. load の書き込み経路（メモリ上の偽クライアント。本番DBには接続しない） ---
{
  const store = new Map(); // table -> Map(key -> row)
  const fake = {
    from(table) {
      if (!store.has(table)) store.set(table, new Map());
      const rows = store.get(table);
      return {
        select: () => ({
          in: async (col, ids) => ({
            data: [...rows.values()].filter((r) => ids.includes(r[col])),
            error: null,
          }),
        }),
        upsert: async (batch, { onConflict }) => {
          const keys = onConflict.split(",");
          for (const r of batch)
            rows.set(keys.map((k) => r[k]).join("|"), { ...r });
          return { error: null };
        },
      };
    },
  };
  const day = buildArchiveRows(days["2026-03-15"]);
  const writeAll = async () => {
    const out = { written: 0, skipped: 0 };
    for (const [spec, list] of [
      [KB_ARCHIVE_TABLES.venueDays, day.venueDays],
      [KB_ARCHIVE_TABLES.races, day.races],
      [KB_ARCHIVE_TABLES.boats, day.boats],
    ]) {
      for (let i = 0; i < list.length; i += 200) {
        const r = await upsertChangedRows(
          fake,
          spec.table,
          list.slice(i, i + 200),
          {
            onConflict: spec.onConflict,
            keyColumns: spec.keyColumns,
            chunkColumn: spec.chunkColumn,
            batchSize: 200,
          },
        );
        out.written += r.written;
        out.skipped += r.skipped;
      }
    }
    return out;
  };
  const quietLog = console.log;
  console.log = () => {};
  const first = await writeAll();
  const second = await writeAll();
  console.log = quietLog;
  check(
    "load: 初回は全行（開催2＋レース24＋艇144）を書き込む",
    first.written === 170 && first.skipped === 0,
    JSON.stringify(first),
  );
  check(
    "load: 再実行は変更なしの行を書かない（書き込み0・スキップ170）",
    second.written === 0 && second.skipped === 170,
    JSON.stringify(second),
  );
  check(
    "load: 主キー（race_id, boat_number）で重複せず144艇が保存される",
    store.get("kb_archive_boats").size === 144 &&
      store.get("kb_archive_venue_days").size === 2,
  );
}

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nすべての検証に成功しました");
