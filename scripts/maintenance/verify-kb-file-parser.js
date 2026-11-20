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
  classifyKFileVenues,
  buildKbDay,
  decodeLzhText,
  summarizeKbDay,
  parseKText,
  _internal as kbInternal,
  PENDING_MARKER,
} from "../lib/kbFileParser.js";
import { buildArchiveRows } from "../lib/kbArchiveRows.js";


import { cmdDownload } from "./kb-backfill.js";
import { runKbFileParserScenes1 } from "./verifyData/kb-file-parser-scenes-1.js";
import { runKbFileParserScenes2, runKbFileParserScenes3 } from "./verifyData/kb-file-parser-scenes-2.js";

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

// ---- 後半の場面（verifyData/kb-file-parser-scenes-1.js） ----
runKbFileParserScenes1({ read, check, eq, DAYS, days });

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

// ---- 後半の場面（verifyData/kb-file-parser-scenes-2.js） ----
runKbFileParserScenes2({ check, eq, days });

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

// ---- 後半の場面（verifyData/kb-file-parser-scenes-2.js） ----
await runKbFileParserScenes3({ check, eq, days });

// 9. Kファイルの確定状況は、会場ブロック単位で判定する（中止・順延の会場があるだけの日を、捨てない）
{
  const P = "データは、この場の全レース終了後に登録されます。";
  const block = (code, body) => `${code}KBGN\n${body}\n${code}KEND`;
  const done = (code) =>
    block(code, "津［成績］ 7/30 x\n  1R 予選 H1800m 晴 風 北 2m 波 1cm");
  const pend = (code) => block(code, `ボートレース\n${P}`);
  const mixed = [done("10"), pend("09"), done("08")].join("\n\n");
  const c1 = classifyKFileVenues(mixed);
  check(
    "K確定状況: 一部の会場だけ未確定（中止・順延）の日は、日全体を未確定にしない",
    c1.total === 3 &&
      eq(c1.pendingVenues, [9]) &&
      eq(c1.completeVenues, [10, 8]) &&
      c1.allPending === false,
    JSON.stringify(c1),
  );
  const c2 = classifyKFileVenues([pend("01"), pend("02")].join("\n"));
  check(
    "K確定状況: 全会場が未確定の日（全レース終了前）は、日全体を未確定にする",
    c2.total === 2 && c2.allPending === true && c2.completeVenues.length === 0,
    JSON.stringify(c2),
  );
  const c3 = classifyKFileVenues(P);
  check(
    "K確定状況: 会場ブロックが読めない形式は、確定とみなさない（allPendingにしない。呼び出し側がファイル全体のマーカーで判定）",
    c3.total === 0 && c3.allPending === false,
    JSON.stringify(c3),
  );
  const real = await decodeLzhText(
    fs.readFileSync(new URL("k260920-pending.lzh", FIX)),
  );
  const c4 = classifyKFileVenues(real);
  check(
    "K確定状況: 実物のプレースホルダ（k260920-pending.lzh、321バイト）は、日全体が未確定として扱われる",
    c4.allPending === true || (c4.total === 0 && real.includes(P)),
    JSON.stringify(c4),
  );
}

// ---------------------------------------------------------------------------
// 中止のレース（BOA-412）: 払戻金の要約の「NR 中\u3000止」を cancelled_race_numbers に取る
// フィクスチャは実物の K の抜粋: 2025-12-12 江戸川（全日中止）と 2025-12-03 鳴門（11・12R が中止の途中打ち切り）
// ---------------------------------------------------------------------------
{
  const k = parseKText(read("k251212-03-k251203-14-cancelled.txt"));
  const edogawa = k.venues.find((v) => v.venue_code === 3);
  const naruto = k.venues.find((v) => v.venue_code === 14);
  check(
    "中止: 全日中止（江戸川 2025-12-12）は、成績0レース・中止 1〜12R",
    edogawa?.races.length === 0 &&
      JSON.stringify(edogawa?.cancelled_race_numbers) ===
        JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    JSON.stringify(edogawa?.cancelled_race_numbers),
  );
  check(
    "中止: 途中打ち切り（鳴門 2025-12-03）は、成績 1〜10R・中止 11・12R（重ならず、合わせて12）",
    naruto?.races.length === 10 &&
      JSON.stringify(naruto?.cancelled_race_numbers) === "[11,12]" &&
      !naruto.races.some((r) =>
        naruto.cancelled_race_numbers.includes(r.race_number),
      ),
    JSON.stringify({
      races: naruto?.races.length,
      c: naruto?.cancelled_race_numbers,
    }),
  );
  check(
    "中止: 要約の行は、従来どおり payout_summary_lines にも残す（既存の挙動を変えない）",
    edogawa?.payout_summary_lines.some((l) => /1R\s+中/.test(l)),
  );
  const normal = parseKText(read("k260315.txt"));
  check(
    "中止: 中止の無い日（k260315）は、全会場で cancelled_race_numbers が空。払戻の要約行を中止と取り違えない",
    normal.venues.length > 0 &&
      normal.venues.every((v) => v.cancelled_race_numbers.length === 0),
  );
  const re = kbInternal.K_SUMMARY_CANCELLED_RE;
  check(
    "中止の行の正規表現: 全角スペースの有無を問わず取り、払戻の要約（組番と金額）は取らない",
    re.test("           1R  中　止") &&
      re.test("          12R  中止") &&
      !re.test("           1R  3-1-2    2340  3-1-2   680"),
  );
  check(
    "中止: summarizeKbDay に k_cancelled_races（中止のレース数）が出る",
    summarizeKbDay({ date: "x", k, b: null }).k_cancelled_races === 14,
  );
}

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nすべての検証に成功しました");
