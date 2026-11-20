/**
 * verify-scrape-jobs.js - データ取得基盤の共通ライブラリ（scripts/lib/scrapeJobs/、WS4a）の検証。
 * DBにも取得先にも接続しない（ストア・fetch・時計を差し替える）。
 *
 * 確認すること:
 *   (a) 期限計算: 発走（JST）+ offset_min。実行環境のタイムゾーンに依存しない。不正な形式は例外
 *   (b) レジストリの整合性: リース < 許容幅、再試行の間隔 < 許容幅 等。ensure用の定義の形
 *   (c) resolveTargetDate: 指定時刻から対象日を解決（遅れて起動しても対象日は前日のまま）
 *   (d) 0件エラー: 期待件数>0なのに解析0件は成功にしない。書き込み0件（変更なし）は正常
 *   (e) 予定表・ジョブ状態のテーブル/関数が無い（075未適用）エラーの判定。無関係な不在は握りつぶさない
 *   (f) サーキットブレーカー: 開く条件・半開・閉じる・期間の倍増・store障害時の縮退
 *   (g) politeFetch: タイムアウト・429/503のバックオフ（Retry-After・上限）・ブレーカー連携・UA・並列度の上限
 *   (h) 共通ラッパ: 075未適用・off・行なしは何もしない（誤報なし）/ shadow・live / 完了と再試行の記録 /
 *       0件エラー / 例外の扱い / ブレーカー / ソフトデッドライン / 並列度 / 日次の冪等・リース・shadow
 *   (i) Supabaseストアのクエリの形: 完了・再試行はclaimed_byとstatus=runningの条件付き更新
 *   (j) getRaceSchedule の例外モード: DBエラーを「対象なし」に化けさせない
 *   (k) scrape-scheduled.js（GitHub Actions）: DBに繋がらないとき、「対象レースなし」で正常終了せず exit 1（BOA-352）。
 *       接続先は 127.0.0.1:1（必ず接続拒否になる）で、本物のDBには繋がない
 *
 * 予定表のRPCの意味論（期限・許容幅・リース・奪取）は verify-scrape-slots-sql.js（PGlite）で検証する。
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  toJstDateString,
  jstStartOfDay,
  jstMinutesOfDay,
  addSeconds,
  raceStartInstant,
  slotDeadline,
  slotWindowEnd,
} from "../lib/scrapeJobs/time.js";
import {
  SCRAPE_JOBS,
  graceMinFor,
  graceOverridesOf,
  validateRegistry,
} from "../lib/scrapeJobs/registry.js";









import { getRaceSchedule } from "../lib/raceSchedule.js";
import { fetchAll } from "../lib/supabaseClient.js";

import { runScrapeJobsScenes1 } from "./verifyData/scrape-jobs-scenes-1.js";
import { runScrapeJobsScenes2 } from "./verifyData/scrape-jobs-scenes-2.js";
import { runScrapeJobsScenes3 } from "./verifyData/scrape-jobs-scenes-3.js";
import { runScrapeJobsScenes4 } from "./verifyData/scrape-jobs-scenes-4.js";
import { runScrapeJobsScenes5 } from "./verifyData/scrape-jobs-scenes-5.js";
import { runScrapeJobsScenes6 } from "./verifyData/scrape-jobs-scenes-6.js";
import { runScrapeJobsScenes7 } from "./verifyData/scrape-jobs-scenes-7.js";
import { runScrapeJobsScenes8 } from "./verifyData/scrape-jobs-scenes-8.js";
import { runScrapeJobsScenes9 } from "./verifyData/scrape-jobs-scenes-9.js";

// 検証対象のコードが出す警告・エラーのログ（テストが意図的に起こす失敗）で出力が埋まらないよう、
// 検証中は console.warn・console.error を無効にし、結果の表示だけ元の関数で行う
const printOut = console.log.bind(console);
const printErr = console.error.bind(console);
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (v) => JSON.stringify(v);
const KNOWN_GAPS = [
  {
    input: 'jstMinutesOfDay(new Date("x"))',
    specification: "不正な日時の扱いは未定",
    current: String(jstMinutesOfDay(new Date("x"))),
  },
  {
    input: "addSeconds(B, NaN)",
    specification: "数値でない秒の扱いは未定",
    current: String(addSeconds(new Date("2026-10-26T00:00:00Z"), NaN)),
  },
  {
    input: 'addSeconds(B, "60")',
    specification: "文字列の秒の扱いは未定",
    current: addSeconds(new Date("2026-10-26T00:00:00Z"), "60").toISOString(),
  },
];

// ---------------------------------------------------------------------------
// (a) 期限計算（TZを切り替えても同じ）
// ---------------------------------------------------------------------------
const ORIGINAL_TZ = process.env.TZ;
for (const tz of ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Asia/Kolkata"]) {
  process.env.TZ = tz;
  for (const [input, expected] of [
    ["2026-10-26T00:00:00+09:00", 0],
    ["2026-10-25T15:00:00Z", 0],
    ["2026-10-26T14:59:00Z", 1439],
    ["2026-10-26T15:00:00Z", 0],
    ["2026-10-26T23:59:59.999+09:00", 1439],
    ["2026-10-26T10:34:59+09:00", 634],
    ["2026-10-26T21:30:00+09:00", 1290],
    ["2026-10-26T12:00:00-08:00", 300],
  ]) {
    const actual = jstMinutesOfDay(new Date(input));
    check(
      `[TZ=${tz}] jstMinutesOfDay(${input}) は ${expected}`,
      same(actual, expected),
      show(actual),
    );
  }
  const base = new Date("2026-10-26T00:00:00Z");
  for (const [seconds, expected] of [
    [0, "2026-10-26T00:00:00.000Z"],
    [1, "2026-10-26T00:00:01.000Z"],
    [60, "2026-10-26T00:01:00.000Z"],
    [-60, "2026-10-25T23:59:00.000Z"],
    [3600, "2026-10-26T01:00:00.000Z"],
    [86400, "2026-10-27T00:00:00.000Z"],
    [0.5, "2026-10-26T00:00:00.500Z"],
  ]) {
    const actual = addSeconds(base, seconds).toISOString();
    check(
      `[TZ=${tz}] addSeconds(B, ${seconds}) は ${expected}`,
      same(actual, expected),
      show(actual),
    );
  }
  check(
    `[TZ=${tz}] addSeconds は元の B を変更せず、0秒でも別の Date を返す`,
    same(base.toISOString(), "2026-10-26T00:00:00.000Z") &&
      same(addSeconds(base, 0) !== base, true) &&
      same(base.toISOString(), "2026-10-26T00:00:00.000Z"),
  );
  const d = slotDeadline("2026-09-19", "10:00:00", -60);
  check(
    `[TZ=${tz}] 10:00発走の60分前は 09:00 JST（= 00:00 UTC）`,
    d.toISOString() === "2026-09-19T00:00:00.000Z",
    d.toISOString(),
  );
  check(
    `[TZ=${tz}] 22:45発走の+90分は翌日 00:15 JST（= 15:15 UTC）`,
    slotDeadline("2026-09-19", "22:45", 90).toISOString() ===
      "2026-09-19T15:15:00.000Z",
  );
  check(
    `[TZ=${tz}] JST日付: 2026-09-19T15:00:00Z は 2026-09-20（JST 00:00）`,
    toJstDateString(new Date("2026-09-19T15:00:00Z")) === "2026-09-20" &&
      toJstDateString(new Date("2026-09-19T14:59:59Z")) === "2026-09-19",
  );
}
if (ORIGINAL_TZ === undefined) delete process.env.TZ;
else process.env.TZ = ORIGINAL_TZ;

check(
  "期限は HH:MM でも HH:MM:SS でも同じ",
  slotDeadline("2026-09-19", "10:00", 5).getTime() ===
    slotDeadline("2026-09-19", "10:00:00", 5).getTime(),
);
check(
  "期限+許容幅",
  slotWindowEnd(slotDeadline("2026-09-19", "10:00", -60), 3).toISOString() ===
    "2026-09-19T00:03:00.000Z",
);
check(
  "その日（JST）の0時",
  jstStartOfDay(new Date("2026-09-19T20:00:00Z")).toISOString() ===
    "2026-09-19T15:00:00.000Z",
);
for (const [date, time] of [
  ["2026/09/19", "10:00"],
  ["2026-09-19", "10時"],
  ["2026-09-19", null],
  [undefined, "10:00"],
]) {
  let threw = false;
  try {
    raceStartInstant(date, time);
  } catch {
    threw = true;
  }
  check(`不正な発走時刻は例外（${date} ${time}）`, threw);
}

// ---------------------------------------------------------------------------
// (b) レジストリ
// ---------------------------------------------------------------------------
check(
  "result の最初の窓は発走 +10分",
  same(SCRAPE_JOBS.result.offsets, [10]),
  show(SCRAPE_JOBS.result.offsets),
);
check(
  "pcexpect の claimLimit は6",
  SCRAPE_JOBS.pcexpect.claimLimit === 6,
  show(SCRAPE_JOBS.pcexpect.claimLimit),
);
check(
  "本番のレジストリは整合している",
  same(validateRegistry(), []),
  show(validateRegistry()),
);
{
  const bad = {
    a: { ...SCRAPE_JOBS.odds, leaseSec: 180 }, // 許容幅3分と同じ
    b: { ...SCRAPE_JOBS.odds, retrySec: 200 },
    c: { ...SCRAPE_JOBS.odds, offsets: [-60, -60] },
    d: { ...SCRAPE_JOBS.odds, concurrency: 99 },
    e: { ...SCRAPE_JOBS.point_rank, targetTimeJst: "25:00" },
    f: { ...SCRAPE_JOBS.odds, maxDurationSec: 30 },
    g: { ...SCRAPE_JOBS.odds, claimLimit: 60, concurrency: 4 }, // 15回×12秒 > リース
    h: { ...SCRAPE_JOBS.odds, graceMinByOffset: { [-45]: 30 } }, // 窓（offsets）に無い
    i: { ...SCRAPE_JOBS.odds, graceMinByOffset: { [-60]: 2 } }, // graceMin(3)未満
    j: { ...SCRAPE_JOBS.odds, graceMinByOffset: { [-60]: 31 } }, // 次の窓(-30)の開始を超える
    k: { ...SCRAPE_JOBS.odds, graceMinByOffset: { [-60]: 1.5 } }, // 整数でない
    l: { ...SCRAPE_JOBS.odds, retrySec: 2000, graceMinByOffset: { [-60]: 30 } }, // 再試行が延長後の許容幅より長い
  };
  const problems = validateRegistry(bad);
  check(
    "リース>=許容幅・再試行>=許容幅・窓の重複・並列度超過・不正な指定時刻・短すぎるmaxDuration・リースに収まらない処理量を検出",
    ["a", "b", "c", "d", "e", "f", "g"].every((k) =>
      problems.some((p) => p.startsWith(`${k}:`)),
    ),
    show(problems),
  );
  const graceProblems = validateRegistry(bad).filter((p) =>
    /graceMinByOffset/.test(p),
  );
  check(
    "窓ごとの許容幅の上書き（graceMinByOffset）: 窓に無いキー・graceMin未満・次の窓の開始を超える値・整数でない値・延長後の許容幅より長い再試行を検出",
    ["h", "i", "j", "k", "l"].every((k) =>
      graceProblems.some((p) => p.startsWith(`${k}:`)),
    ) && graceProblems.length >= 5,
    show(graceProblems),
  );
}
{
  const odds = SCRAPE_JOBS.odds;
  check(
    "本番のオッズの窓: -60 だけ許容幅30分（-30の窓の開始まで）、他の窓は3分のまま。上書きは {-60: 30}",
    graceMinFor(odds, -60) === 30 &&
      [-30, -15, -10, -5, 0].every((o) => graceMinFor(odds, o) === 3) &&
      same(graceOverridesOf(odds), { "-60": 30 }) &&
      odds.offsets.includes(-60) &&
      -60 + graceMinFor(odds, -60) <= -30,
    show([odds.graceMin, odds.graceMinByOffset]),
  );
  check(
    "本番のオッズ以外のジョブは、上書きを持たない（許容幅を変えていない）。graceOverridesOf は null",
    Object.entries(SCRAPE_JOBS)
      .filter(([name, def]) => def.kind === "window" && name !== "odds")
      .every(
        ([, def]) =>
          graceOverridesOf(def) === null &&
          def.offsets.every((o) => graceMinFor(def, o) === def.graceMin),
      ),
  );
}

// ---- 後半の場面（verifyData/scrape-jobs-scenes-1.js・scrape-jobs-scenes-2.js・scrape-jobs-scenes-3.js・scrape-jobs-scenes-4.js・scrape-jobs-scenes-5.js・scrape-jobs-scenes-6.js・scrape-jobs-scenes-7.js・scrape-jobs-scenes-8.js） ----
runScrapeJobsScenes1({ check, same, show, ORIGINAL_TZ });
await runScrapeJobsScenes2({ check, same, show });
await runScrapeJobsScenes3({ check, show });
await runScrapeJobsScenes4({ check, same, show });
await runScrapeJobsScenes5({ check, same, show });
await runScrapeJobsScenes6({ check, same, show });
await runScrapeJobsScenes7({ check, show });
await runScrapeJobsScenes8({ check, same, show });

// ---------------------------------------------------------------------------
// (j) getRaceSchedule の例外モード
// ---------------------------------------------------------------------------
{
  const fake = (result) => ({
    from: () => {
      const b = {
        select: () => b,
        like: () => b,
        not: () => Promise.resolve(result),
      };
      return b;
    },
  });
  const dbError = fake({
    data: null,
    error: { message: "connection refused" },
  });
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  const legacy = await getRaceSchedule("2026-09-19", {
    client: dbError,
    throwOnError: false,
  });
  console.error = originalError;
  console.warn = originalWarn;
  check(
    "throwOnError: false を明示したときだけ、DBエラーを空配列にする",
    Array.isArray(legacy) && legacy.length === 0,
  );
  let threwByDefault;
  try {
    await getRaceSchedule("2026-09-19", { client: dbError });
  } catch (e) {
    threwByDefault = e;
  }
  check(
    "既定（BOA-391）: 指定なしでも、DBエラーを空配列にせず例外にする",
    threwByDefault && /connection refused/.test(threwByDefault.message),
  );
  let threw;
  try {
    await getRaceSchedule("2026-09-19", {
      client: dbError,
      throwOnError: true,
    });
  } catch (e) {
    threw = e;
  }
  check(
    "throwOnError: DBエラーを空配列にせず、原因付きで例外にする",
    threw && /connection refused/.test(threw.message),
  );
  console.warn = () => {};
  const empty = await getRaceSchedule("2026-09-19", {
    client: fake({ data: [], error: null }),
    throwOnError: true,
  });
  console.warn = originalWarn;
  check(
    "throwOnError でも、races が未登録（空）なら空配列（エラーではない）",
    Array.isArray(empty) && empty.length === 0,
  );
  const ok = await getRaceSchedule("2026-09-19", {
    client: fake({
      data: [
        { race_id: "2026-09-19-02-03", start_time: "10:30:00" },
        { race_id: "2026-09-19-01-01", start_time: "09:00:00" },
      ],
      error: null,
    }),
    throwOnError: true,
  });
  check(
    "正常: 発走順に並び、JSTの発走時刻を返す",
    ok.length === 2 &&
      ok[0].race_id === "2026-09-19-01-01" &&
      ok[0].start_time.toISOString() === "2026-09-19T00:00:00.000Z",
  );
}

// ---------------------------------------------------------------------------
// (k) scrape-scheduled.js: DB障害で「対象レースなし」に化けず、exit 1 で workflow を失敗させる（BOA-352）
// ---------------------------------------------------------------------------
{
  const proc = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../daily/scrape-scheduled.js", import.meta.url)),
      "--date=2026-09-19",
    ],
    {
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        SUPABASE_URL: "http://127.0.0.1:1",
        SUPABASE_SERVICE_KEY: "dummy",
      },
    },
  );
  const out = `${proc.stdout}${proc.stderr}`;
  check(
    "scrape-scheduled.js: DBに繋がらないとき exit 1 で終わり、「対象レースなし」で正常終了しない（BOA-352）",
    proc.status === 1 && !out.includes("対象レースなし"),
    `status=${proc.status} ${out.slice(-300)}`,
  );
}

// ---------------------------------------------------------------------------
// (l) fetchAll の既定（BOA-391）: 途中のページの失敗で、取得済み分を「全件」として返さない
// ---------------------------------------------------------------------------
{
  // 1ページ目は1000行（続きがある）、2ページ目で失敗する
  const pagedClient = {
    from: () => {
      const b = {
        select: () => b,
        range: (from) =>
          Promise.resolve(
            from === 0
              ? {
                  data: Array.from({ length: 1000 }, (_, i) => ({ id: i })),
                  error: null,
                }
              : { data: null, error: { message: "statement timeout" } },
          ),
      };
      return b;
    },
  };
  let threw;
  try {
    await fetchAll("t", "id", null, {
      client: pagedClient,
      unordered: "偽のクライアント（テスト。2ページ目の失敗だけを確かめる）",
    });
  } catch (e) {
    threw = e;
  }
  check(
    "fetchAll の既定（BOA-391）: 2ページ目の失敗を例外にする（1000行を全件として返さない）",
    threw && /statement timeout/.test(threw.message),
  );
  const originalError = console.error;
  console.error = () => {};
  const partial = await fetchAll("t", "id", null, {
    client: pagedClient,
    throwOnError: false,
    unordered: "偽のクライアント（テスト。2ページ目の失敗だけを確かめる）",
  });
  console.error = originalError;
  check(
    "fetchAll: throwOnError: false を明示したときだけ、取得済みの分を返す",
    partial.length === 1000,
  );
}

// ---- 後半の場面（verifyData/scrape-jobs-scenes-9.js） ----
runScrapeJobsScenes9({ printOut, show, KNOWN_GAPS });

printOut(
  failures === 0 ? "\nALL PASS" : `\n${failures} 件の検証が失敗しました`,
);
process.exit(failures === 0 ? 0 : 1);
